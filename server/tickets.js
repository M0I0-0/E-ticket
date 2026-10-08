import { randomBytes } from 'node:crypto';
import { qrSvg, ticketPdf, prettyCode, longDate, money } from './pdf.js';
import { round } from './catalog.js';

const DAY = 86400000;
const OPEN = "('active','paying')";
const LIVE = "('valid','used')";
// Crockford base32: no I, L, O or U, so a code typed by hand is hard to get wrong.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// RN-13: 20 random characters = 100 bits, impossible to guess or derive from the order.
export const newCode = () => Array.from(randomBytes(20), byte => ALPHABET[byte & 31]).join('');
export function normalizeCode(input) {
  let text = String(input ?? '').trim().toUpperCase();
  const tag = text.lastIndexOf('ETICKET:');
  if (tag >= 0) text = text.slice(tag + 8);
  return text.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
}
// Splits an amount in cents so the parts always add up to the order total.
const split = (total, n) => {
  const cents = Math.round(total * 100), each = Math.floor(cents / n), rest = cents - each * n;
  return Array.from({ length: n }, (_, i) => (each + (i < rest ? 1 : 0)) / 100);
};
const STATUS = { valid: 'Vigente', used: 'Utilizado', refunded: 'Reembolsado', cancelled: 'Evento cancelado' };
const dateTime = ms => new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

export function createTickets(db, { failure, clock = Date.now, catalog, mailer, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS orders(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), hold_id TEXT,
      event_id TEXT NOT NULL, function_id TEXT NOT NULL, zone TEXT NOT NULL,
      unit_price REAL NOT NULL, fee_rate REAL NOT NULL, quantity INTEGER NOT NULL,
      base REAL NOT NULL, fee REAL NOT NULL, vat REAL NOT NULL, total REAL NOT NULL,
      payment_id TEXT, last4 TEXT, brand TEXT,
      status TEXT NOT NULL DEFAULT 'paid', refunded REAL NOT NULL DEFAULT 0, created INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS orders_event ON orders(event_id, function_id);
    CREATE INDEX IF NOT EXISTS orders_created ON orders(created);
    CREATE TABLE IF NOT EXISTS tickets(
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES orders(id),
      owner_id TEXT NOT NULL REFERENCES users(id), owner_name TEXT NOT NULL,
      event_id TEXT NOT NULL, function_id TEXT NOT NULL, zone TEXT NOT NULL, seat TEXT NOT NULL, kind TEXT NOT NULL,
      base REAL NOT NULL, fee REAL NOT NULL, vat REAL NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'valid', used_at INTEGER, used_gate TEXT, used_by TEXT,
      created INTEGER NOT NULL, updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tickets_owner ON tickets(owner_id);
    CREATE INDEX IF NOT EXISTS tickets_function ON tickets(event_id, function_id, status);
    CREATE TABLE IF NOT EXISTS ticket_codes(code TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scans(
      id TEXT PRIMARY KEY, created INTEGER NOT NULL, code TEXT NOT NULL, ticket_id TEXT,
      event_id TEXT, function_id TEXT, gate TEXT NOT NULL DEFAULT '', staff_id TEXT NOT NULL,
      result TEXT NOT NULL, reason TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS scans_function ON scans(event_id, function_id, created);
    CREATE TABLE IF NOT EXISTS staff_assignments(
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL, function_id TEXT NOT NULL,
      assigned_by TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id, event_id, function_id)
    );
    CREATE TABLE IF NOT EXISTS function_changes(
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, function_id TEXT NOT NULL,
      old_date TEXT NOT NULL, old_hour TEXT NOT NULL, new_date TEXT NOT NULL, new_hour TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', changed_by TEXT NOT NULL, created INTEGER NOT NULL, refund_until INTEGER NOT NULL
    );`);

  const id = () => randomBytes(12).toString('hex');
  const ticket = ticketId => db.prepare('SELECT * FROM tickets WHERE id=?').get(String(ticketId));
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const canManage = (actor, ev) => actor?.role === 'administrador' || (actor?.role === 'organizador' && ev?.ownerId === actor.id);
  const lastChange = (eventId, functionId) => db.prepare('SELECT * FROM function_changes WHERE event_id=? AND function_id=? ORDER BY created DESC LIMIT 1').get(eventId, functionId);

  // ---- Issuing (T09.1). Runs inside the payment transaction.
  function issue({ user, hold, orderId, breakdown, payment }) {
    const now = clock();
    const seats = hold.kind === 'seat' ? JSON.parse(hold.seats) : Array.from({ length: hold.quantity }, (_, i) => `Acceso ${i + 1}`);
    db.prepare(`INSERT INTO orders(id,user_id,hold_id,event_id,function_id,zone,unit_price,fee_rate,quantity,base,fee,vat,total,payment_id,last4,brand,status,refunded,created)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',0,?)`)
      .run(orderId, user.id, hold.id, String(hold.event_id), String(hold.function_id), hold.zone, breakdown.basePrice, breakdown.feeRate, seats.length, breakdown.base, breakdown.fee, breakdown.vat, breakdown.total, payment.transactionId, payment.last4, payment.brand, now);
    const bases = split(breakdown.base, seats.length), fees = split(breakdown.fee, seats.length), vats = split(breakdown.vat, seats.length);
    const insert = db.prepare(`INSERT INTO tickets(id,code,order_id,owner_id,owner_name,event_id,function_id,zone,seat,kind,base,fee,vat,price,status,created,updated)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'valid',?,?)`);
    seats.forEach((seat, i) => {
      for (let attempt = 0; ; attempt++) {
        try { insert.run(id(), newCode(), orderId, user.id, user.name, String(hold.event_id), String(hold.function_id), hold.zone, seat, hold.kind, bases[i], fees[i], vats[i], round(bases[i] + fees[i] + vats[i]), now, now); break; }
        catch (error) { if (attempt > 3) throw error; }
      }
    });
    return orderView(db.prepare('SELECT * FROM orders WHERE id=?').get(orderId), user.id);
  }

  // ---- Views
  function orderView(row, viewerId) {
    const ev = catalog.event(row.event_id), f = catalog.fn(ev, row.function_id);
    const rows = db.prepare('SELECT * FROM tickets WHERE order_id=? ORDER BY rowid').all(row.id);
    return {
      id: row.id, eventId: Number(row.event_id) || row.event_id, eventName: ev?.name || '', holdId: row.hold_id,
      time: new Date(row.created).toISOString(), total: row.total, refunded: row.refunded, status: row.status,
      breakdown: { basePrice: row.unit_price, zoneName: row.zone, fnDate: f?.date, fnHour: f?.hour, count: row.quantity, base: row.base, fee: row.fee, vat: row.vat, total: row.total, feeRate: row.fee_rate },
      payment: { method: 'card', last4: row.last4, brand: row.brand, transactionId: row.payment_id },
      zone: row.zone, functionId: row.function_id, functionDate: f?.date, functionHour: f?.hour,
      tickets: rows.map(t => ({
        id: t.id, seat: t.seat, owner: t.owner_name, transferred: t.owner_id !== row.user_id, status: t.status, statusLabel: STATUS[t.status], price: t.price,
        code: t.owner_id === viewerId && (t.status === 'valid' || t.status === 'used') ? prettyCode(t.code) : '',
      })),
    };
  }

  // Orders bought by the user (history). Purchases saved by the old prototype are returned as they were stored.
  function ordersFor(user) {
    const current = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC').all(user.id).map(row => orderView(row, user.id));
    const legacy = JSON.parse(db.prepare('SELECT payload FROM user_orders WHERE user_id=?').get(user.id)?.payload || '[]');
    return [...current, ...legacy].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  }

  function ticketView(t, now = clock()) {
    const ev = catalog.event(t.event_id), f = catalog.fn(ev, t.function_id), change = lastChange(t.event_id, t.function_id);
    const open = t.status === 'valid' && ev?.status === 'published';
    return {
      id: t.id, code: prettyCode(t.code), status: t.status, statusLabel: STATUS[t.status] || t.status,
      eventId: t.event_id, eventName: ev?.name || 'Evento', venue: ev?.venue || '', city: ev?.city || '',
      functionId: t.function_id, date: f?.date || '', hour: f?.hour || '', startsAt: f?.startsAt || null,
      zone: t.zone, seat: t.seat, kind: t.kind, owner: t.owner_name, orderId: t.order_id, price: t.price,
      usedAt: t.used_at, usedGate: t.used_gate,
      // T11.1: transfers close 24 hours before the function starts.
      transferable: Boolean(open && f && f.startsAt - now > DAY), transferDeadline: f ? f.startsAt - DAY : null,
      // T11.6: after a date change the holder has 10 days to ask for a refund.
      refundUntil: open && change && change.refund_until > now ? change.refund_until : null,
      rescheduled: change ? { from: `${change.old_date} ${change.old_hour}`, to: `${change.new_date} ${change.new_hour}`, reason: change.reason, refundUntil: change.refund_until } : null,
      eventCancelled: ev?.status === 'cancelled',
    };
  }
  const ticketsFor = user => db.prepare('SELECT * FROM tickets WHERE owner_id=? ORDER BY created DESC').all(user.id).map(t => ticketView(t))
    .sort((a, b) => (a.startsAt || 0) - (b.startsAt || 0));

  const owned = (user, ticketId) => {
    const t = ticket(ticketId);
    if (!t || t.owner_id !== user.id) throw failure(404, 'No encontramos ese boleto en tu cuenta.');
    return t;
  };
  const pdfData = t => {
    const ev = catalog.event(t.event_id), f = catalog.fn(ev, t.function_id);
    return { code: t.code, eventName: ev?.name || 'Evento', venue: ev?.venue, city: ev?.city, date: f?.date, hour: f?.hour, zone: t.zone, seat: t.seat, kind: t.kind, owner: t.owner_name, orderId: t.order_id };
  };
  const qr = (user, ticketId) => qrSvg(owned(user, ticketId).code);
  const pdf = async (user, ticketId) => {
    const t = owned(user, ticketId);
    return { filename: `boleto-${t.seat.replace(/\s+/g, '')}-${t.code.slice(0, 4)}.pdf`, content: await ticketPdf(pdfData(t)) };
  };
  const attachmentsFor = rows => async () => Promise.all(rows.map(async (t, i) => ({ filename: `boleto-${i + 1}-${t.seat.replace(/\s+/g, '')}.pdf`, content: await ticketPdf(pdfData(t)), contentType: 'application/pdf' })));

  // ---- T09.3: receipt by e-mail with one PDF per ticket.
  function sendConfirmation(orderId) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order) return;
    const buyer = db.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
    const ev = catalog.event(order.event_id), f = catalog.fn(ev, order.function_id);
    const rows = db.prepare('SELECT * FROM tickets WHERE order_id=? ORDER BY rowid').all(order.id);
    const text = [
      `Hola, ${buyer.name}:`, '', 'Tu pago fue confirmado. Este es tu comprobante de compra.', '',
      `Orden: ${order.id}`, `Fecha de compra: ${dateTime(order.created)}`,
      `Evento: ${ev?.name}`, `Función: ${f ? `${longDate(f.date)} · ${f.hour} h` : ''}`, `Lugar: ${[ev?.venue, ev?.city].filter(Boolean).join(', ')}`,
      `Zona: ${order.zone}`, `Boletos: ${rows.map(t => t.seat).join(', ')}`, '',
      `Subtotal: ${money(order.base)}`, `Cargo por servicio (${round(order.fee_rate * 100)} %): ${money(order.fee)}`, `IVA (16 %): ${money(order.vat)}`, `Total cobrado: ${money(order.total)}`,
      `Tarjeta: ${order.brand} •••• ${order.last4}`, `Referencia de la pasarela: ${order.payment_id}`, '',
      'Adjuntamos un PDF por cada boleto. También puedes descargarlos cuando quieras en «Mis boletos».', '', 'eTicket',
    ].join('\n');
    mailer.send({ to: buyer.email, subject: `Tus boletos para ${ev?.name} · Orden ${order.id}`, text, kind: 'confirmacion', attachments: attachmentsFor(rows) });
  }

  // ---- T09.4: staff and the functions assigned to them.
  const assigned = (staffId, eventId, functionId) => Boolean(db.prepare('SELECT 1 FROM staff_assignments WHERE user_id=? AND event_id=? AND function_id=?').get(staffId, String(eventId), String(functionId)));
  function assign(actor, data, remove = false) {
    const ev = catalog.event(data.eventId);
    if (!ev) throw failure(404, 'Evento no encontrado.');
    if (!canManage(actor, ev)) throw failure(403, 'Solo la administración o el organizador del evento asignan personal.');
    const f = catalog.fn(ev, data.functionId);
    if (!f) throw failure(400, 'La función no pertenece al evento.');
    const staff = db.prepare('SELECT * FROM users WHERE id=? OR email=?').get(String(data.userId || ''), String(data.email || '').trim().toLowerCase());
    if (!staff || staff.role !== 'taquilla') throw failure(400, 'La cuenta debe tener el rol de taquilla.');
    if (remove) db.prepare('DELETE FROM staff_assignments WHERE user_id=? AND event_id=? AND function_id=?').run(staff.id, ev.id, f.id);
    else db.prepare('INSERT OR IGNORE INTO staff_assignments VALUES(?,?,?,?,?)').run(staff.id, ev.id, f.id, actor.id, clock());
    audit.record(actor, remove ? 'personal.retirado' : 'personal.asignado', { targetType: 'usuario', targetId: staff.email, eventId: ev.id, details: `${ev.name} · ${f.date} ${f.hour}` });
    return { ok: true };
  }
  const assignmentsFor = staff => db.prepare('SELECT * FROM staff_assignments WHERE user_id=? ORDER BY created').all(staff.id).map(a => {
    const ev = catalog.event(a.event_id), f = catalog.fn(ev, a.function_id);
    return ev && f ? { eventId: ev.id, functionId: f.id, eventName: ev.name, venue: ev.venue, city: ev.city, date: f.date, hour: f.hour, status: ev.status, counter: counter(ev.id, f.id) } : null;
  }).filter(Boolean);
  const staffFor = eventId => db.prepare('SELECT a.function_id, u.id, u.email, u.name FROM staff_assignments a JOIN users u ON u.id=a.user_id WHERE a.event_id=? ORDER BY u.name').all(String(eventId))
    .map(r => ({ functionId: r.function_id, userId: r.id, email: r.email, name: r.name }));
  const candidates = () => db.prepare("SELECT id, email, name FROM users WHERE role='taquilla' ORDER BY name").all();

  // ---- T09.6 to T09.8: scanning.
  function counter(eventId, functionId) {
    const row = db.prepare(`SELECT SUM(status='used') AS entered, COUNT(*) AS sold FROM tickets WHERE event_id=? AND function_id=? AND status IN ${LIVE}`).get(String(eventId), String(functionId));
    return { entered: row.entered || 0, sold: row.sold || 0 };
  }
  const summary = t => {
    const ev = catalog.event(t.event_id), f = catalog.fn(ev, t.function_id);
    return { seat: t.seat, zone: t.zone, kind: t.kind, owner: t.owner_name, eventName: ev?.name || '', date: f?.date || '', hour: f?.hour || '' };
  };
  function scan(staff, data) {
    const eventId = String(data.eventId ?? ''), functionId = String(data.functionId ?? '');
    const gate = String(data.gate || '').trim().slice(0, 40) || 'Puerta sin nombre';
    if (!assigned(staff.id, eventId, functionId)) throw failure(403, 'No tienes asignada esta función. Pide a la administración que te la asigne.');
    const code = normalizeCode(data.code);
    if (!code) throw failure(400, 'Escanea el QR o escribe el código del boleto.');
    const now = clock();
    let t = db.prepare('SELECT * FROM tickets WHERE code=?').get(code), outcome;
    const invalid = (reason, key) => ({ result: 'invalid', title: 'No válido', reason, key });
    const used = row => ({ result: 'used', title: 'Ya utilizado', reason: `Entró el ${dateTime(row.used_at)} por ${row.used_gate}.`, key: 'usado' });
    if (!t) {
      const old = db.prepare('SELECT * FROM ticket_codes WHERE code=?').get(code);
      if (old) t = ticket(old.ticket_id);
      outcome = old ? invalid('Es el código anterior de un boleto transferido. El titular actual tiene un QR nuevo.', 'transferido') : invalid('El boleto no existe.', 'no existe');
    } else if (t.event_id !== eventId) outcome = invalid(`El boleto es de otro evento: ${catalog.event(t.event_id)?.name || t.event_id}.`, 'otro evento');
    else if (t.function_id !== functionId) outcome = invalid(`El boleto es de otra función: ${catalog.label(catalog.event(t.event_id), t.function_id)}.`, 'otra función');
    else if (t.status === 'refunded') outcome = invalid('El boleto fue reembolsado.', 'reembolsado');
    else if (t.status === 'cancelled') outcome = invalid('El evento fue cancelado.', 'cancelado');
    else if (t.status === 'used') outcome = used(t);
    else {
      // T09.8: only the first scan finds the ticket still valid, even if two arrive at once.
      const changed = db.prepare("UPDATE tickets SET status='used', used_at=?, used_gate=?, used_by=?, updated=? WHERE id=? AND status='valid'").run(now, gate, staff.id, now, t.id).changes;
      t = ticket(t.id);
      outcome = changed ? { result: 'valid', title: 'Acceso válido', reason: `Bienvenido. ${t.kind === 'seat' ? `Asiento ${t.seat}` : t.seat} · ${t.zone}.`, key: 'valido' } : used(t);
    }
    db.prepare('INSERT INTO scans(id,created,code,ticket_id,event_id,function_id,gate,staff_id,result,reason) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id(), now, code, t?.id ?? null, eventId, functionId, gate, staff.id, outcome.result, outcome.key);
    return { ...outcome, code: prettyCode(code), ticket: t ? summary(t) : null, usedAt: t?.used_at ?? null, usedGate: t?.used_gate ?? null, counter: counter(eventId, functionId) };
  }

  // ---- T09.9: the organizer undoes a scan made by mistake; the audit log keeps who did it.
  function revertScan(actor, ticketId, data) {
    const t = ticket(ticketId);
    if (!t) throw failure(404, 'Boleto no encontrado.');
    if (!canManage(actor, catalog.event(t.event_id))) throw failure(403, 'Solo el organizador del evento o la administración pueden revertir un escaneo.');
    if (t.status !== 'used') throw failure(409, 'Este boleto no está marcado como utilizado.');
    const reason = String(data?.reason || '').trim().slice(0, 200);
    if (!reason) throw failure(400, 'Escribe el motivo de la reversión.');
    const now = clock();
    transaction(() => {
      db.prepare("UPDATE tickets SET status='valid', used_at=NULL, used_gate=NULL, used_by=NULL, updated=? WHERE id=? AND status='used'").run(now, t.id);
      db.prepare("INSERT INTO scans(id,created,code,ticket_id,event_id,function_id,gate,staff_id,result,reason) VALUES(?,?,?,?,?,?,?,?,'reverted',?)").run(id(), now, t.code, t.id, t.event_id, t.function_id, t.used_gate || '', actor.id, reason);
      audit.record(actor, 'escaneo.revertido', { targetType: 'boleto', targetId: prettyCode(t.code), eventId: t.event_id, details: `${t.kind === 'seat' ? 'Asiento ' : ''}${t.seat} · ${reason}` });
    });
    return { ok: true, ticket: summary(ticket(t.id)) };
  }

  function scansFor(eventId, limit = 60) {
    return db.prepare(`SELECT s.*, u.email AS staff_email, t.seat, t.zone, t.status AS ticket_status FROM scans s LEFT JOIN users u ON u.id=s.staff_id LEFT JOIN tickets t ON t.id=s.ticket_id
      WHERE s.event_id=? ORDER BY s.created DESC LIMIT ?`).all(String(eventId), limit)
      .map(s => ({ id: s.id, created: s.created, code: prettyCode(s.code), ticketId: s.ticket_id, functionId: s.function_id, gate: s.gate, staff: s.staff_email, result: s.result, reason: s.reason, seat: s.seat, zone: s.zone, ticketStatus: s.ticket_status }));
  }

  // ---- T11.1 and T11.2: transfer to another registered account with a brand-new QR.
  function transfer(user, ticketId, data) {
    const t = owned(user, ticketId), ev = catalog.event(t.event_id), f = catalog.fn(ev, t.function_id);
    if (t.status !== 'valid' || ev?.status !== 'published') throw failure(409, 'Solo puedes transferir boletos vigentes.');
    if (!f || f.startsAt - clock() <= DAY) throw failure(409, 'Ya no se puede transferir: faltan menos de 24 horas para el evento.');
    const email = String(data?.email || '').trim().toLowerCase();
    const to = db.prepare('SELECT * FROM users WHERE email=? AND verified=1').get(email);
    if (!to) throw failure(404, 'No hay una cuenta registrada con ese correo.');
    if (to.id === user.id) throw failure(400, 'No puedes transferirte un boleto a ti mismo.');
    const now = clock(), code = newCode();
    transaction(() => {
      db.prepare('INSERT INTO ticket_codes(code,ticket_id,reason,created) VALUES(?,?,?,?)').run(t.code, t.id, 'transferido', now);
      db.prepare('UPDATE tickets SET code=?, owner_id=?, owner_name=?, updated=? WHERE id=?').run(code, to.id, to.name, now, t.id);
      db.prepare('INSERT INTO transfers(id,ticket_id,from_user,to_user,created) VALUES(?,?,?,?,?)').run(id(), t.id, user.id, to.id, now);
      audit.record(user, 'boleto.transferido', { targetType: 'boleto', targetId: t.id, eventId: t.event_id, details: `${t.seat} → ${to.email}` });
    });
    const fresh = ticket(t.id), when = f ? `${longDate(f.date)} · ${f.hour} h` : '';
    mailer.send({
      to: to.email, kind: 'transferencia', subject: `${user.name} te transfirió un boleto para ${ev.name}`,
      text: [`Hola, ${to.name}:`, '', `${user.name} te transfirió un boleto.`, '', `Evento: ${ev.name}`, `Función: ${when}`, `Lugar: ${[ev.venue, ev.city].filter(Boolean).join(', ')}`, `Zona: ${t.zone} · ${t.seat}`, '', 'Adjuntamos tu boleto en PDF con un QR nuevo. También lo verás en «Mis boletos».', '', 'eTicket'].join('\n'),
      attachments: attachmentsFor([fresh]),
    });
    mailer.send({ to: user.email, kind: 'transferencia', subject: `Transferiste tu boleto para ${ev.name}`, text: [`Hola, ${user.name}:`, '', `Transferiste el boleto ${t.seat} de ${ev.name} (${when}) a ${to.email}.`, 'Tu QR anterior ya no es válido para entrar.', '', 'eTicket'].join('\n') });
    return { ok: true, to: { email: to.email, name: to.name } };
  }

  // ---- Releasing a seat after a refund puts it back on sale (T11.7, T11.8).
  function releaseSeat(t) {
    if (t.kind === 'seat') {
      db.prepare("DELETE FROM hold_seats WHERE event_id=? AND function_id=? AND zone=? AND seat=? AND hold_id IN (SELECT id FROM holds WHERE status='completed')").run(t.event_id, t.function_id, t.zone, t.seat);
      db.prepare('DELETE FROM event_function_seats WHERE event_id=? AND function_id=? AND zone=? AND seat=?').run(t.event_id, t.function_id, t.zone, t.seat);
    }
    db.prepare('UPDATE event_function_sales SET sold=MAX(0,sold-1) WHERE event_id=? AND function_id=? AND zone=?').run(t.event_id, t.function_id, t.zone);
    db.prepare('UPDATE event_sales SET sold=MAX(0,sold-1) WHERE event_id=? AND zone=?').run(t.event_id, t.zone);
  }

  // ---- Availability per function, shared by the catalog, reports and notifications.
  function soldIn(ev, functionId, zone) {
    if (ev.sample) return db.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE event_id=? AND function_id=? AND zone=? AND status IN ${LIVE}`).get(ev.id, String(functionId), zone.name).n;
    return db.prepare('SELECT sold FROM event_function_sales WHERE event_id=? AND function_id=? AND zone=?').get(ev.id, String(functionId), zone.name)?.sold || 0;
  }
  function heldIn(ev, functionId, zone) {
    if (zone.type === 'seat') return db.prepare(`SELECT COUNT(*) AS n FROM hold_seats s JOIN holds h ON h.id=s.hold_id WHERE s.event_id=? AND s.function_id=? AND s.zone=? AND h.status IN ${OPEN}`).get(ev.id, String(functionId), zone.name).n;
    return db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM holds WHERE event_id=? AND function_id=? AND zone=? AND status IN ${OPEN}`).get(ev.id, String(functionId), zone.name).n;
  }
  function functionStats(ev, functionId) {
    const zones = ev.zones.map(zone => {
      const sellable = zone.type === 'seat' ? zone.seats.filter(seat => !zone.taken.includes(seat) && !zone.blocked.includes(seat)).length : zone.capacity;
      const capacity = zone.type === 'seat' ? Math.min(zone.capacity || sellable, sellable) : zone.capacity;
      const sold = soldIn(ev, functionId, zone), held = heldIn(ev, functionId, zone);
      return { zone: zone.name, type: zone.type, price: zone.price, capacity, sold, held, courtesies: zone.type === 'seat' ? zone.blocked.length : 0, available: Math.max(0, capacity - sold - held) };
    });
    const sum = key => zones.reduce((total, z) => total + z[key], 0);
    const capacity = sum('capacity'), sold = sum('sold'), held = sum('held'), available = sum('available');
    return { zones, capacity, sold, held, available, soldOut: available === 0, soldOutBySales: capacity > 0 && sold >= capacity };
  }
  // T11.8: whether each listed event and function is sold out right now.
  function catalogStatus() {
    return Object.fromEntries(catalog.listed().filter(Boolean).map(ev => {
      const functions = Object.fromEntries(ev.functions.map(f => { const s = functionStats(ev, f.id); return [f.id, { available: s.available, soldOut: s.soldOut }]; }));
      const all = Object.values(functions);
      return [ev.id, { soldOut: all.length > 0 && all.every(f => f.soldOut), available: all.reduce((n, f) => n + f.available, 0), functions }];
    }));
  }

  // For the administrator's individual refunds: an order with every ticket, whoever owns it now.
  function findOrder(orderId) {
    const row = db.prepare('SELECT * FROM orders WHERE id=? COLLATE NOCASE').get(String(orderId).trim());
    if (!row) return null;
    const buyer = db.prepare('SELECT email, name FROM users WHERE id=?').get(row.user_id);
    const owners = new Map(db.prepare('SELECT t.id, u.email FROM tickets t JOIN users u ON u.id=t.owner_id WHERE t.order_id=?').all(row.id).map(r => [r.id, r.email]));
    const view = orderView(row, null);
    return { ...view, buyer: buyer?.email || '', buyerName: buyer?.name || '', tickets: view.tickets.map(t => ({ ...t, ownerEmail: owners.get(t.id) || '' })) };
  }

  return {
    issue, orderView, ordersFor, findOrder, ticketsFor, ticketView, ticket, qr, pdf, pdfData, attachmentsFor, sendConfirmation,
    assign, assigned, assignmentsFor, staffFor, candidates, scan, counter, revertScan, scansFor, transfer,
    releaseSeat, functionStats, catalogStatus, canManage, lastChange, summary,
    orderByPayment: paymentId => db.prepare('SELECT * FROM orders WHERE payment_id=?').get(paymentId),
  };
}
