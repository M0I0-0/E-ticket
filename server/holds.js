import { randomBytes } from 'node:crypto';

// The five sample events live in app.js, not in the events table.
const SAMPLE_SEATS = ['A', 'B', 'C', 'D'].flatMap(row => Array.from({ length: 8 }, (_, i) => `${row}${i + 1}`));
const SAMPLE_TAKEN = ['A3', 'A4', 'B6', 'C2', 'C7', 'D5'];
const SAMPLE_ZONES = { 1: 'Preferente', 2: 'Luneta', 3: 'General', 4: 'General', 5: 'Preferente' };
const SEAT = /^[A-Z][1-3]?\d{1,3}$/;
const OPEN = "('active','paying')";
const EXPIRED = 'Tu reserva expiró. Los lugares se liberaron y no se realizó ningún cobro.';

export function createHolds(db, { failure, clock = Date.now, holdMs = 600000, paymentMs = 300000, log = console.log }) {
  db.exec(`CREATE TABLE IF NOT EXISTS holds(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL, function_id TEXT NOT NULL, zone TEXT NOT NULL, kind TEXT NOT NULL,
      seats TEXT NOT NULL DEFAULT '[]', quantity INTEGER NOT NULL, status TEXT NOT NULL,
      created INTEGER NOT NULL, expires INTEGER NOT NULL, payment_started INTEGER,
      closed INTEGER, close_reason TEXT NOT NULL DEFAULT '', order_id TEXT,
      payment_attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS holds_one_open ON holds(user_id) WHERE status IN ${OPEN};
    CREATE INDEX IF NOT EXISTS holds_due ON holds(status, expires);
    CREATE TABLE IF NOT EXISTS hold_seats(
      hold_id TEXT NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL, function_id TEXT NOT NULL, zone TEXT NOT NULL, seat TEXT NOT NULL,
      PRIMARY KEY(event_id, function_id, zone, seat)
    );
    CREATE INDEX IF NOT EXISTS hold_seats_hold ON hold_seats(hold_id);`);

  const holdCols = db.prepare('PRAGMA table_info(holds)').all().map(c => c.name);
  if (!holdCols.includes('payment_attempts')) {
    db.exec('ALTER TABLE holds ADD COLUMN payment_attempts INTEGER NOT NULL DEFAULT 0');
  }

  const conflict = (status, message, extra) => Object.assign(failure(status, message), { extra });
  const find = id => db.prepare('SELECT * FROM holds WHERE id=?').get(id);
  const openHold = userId => db.prepare(`SELECT * FROM holds WHERE user_id=? AND status IN ${OPEN}`).get(userId);
  const view = h => {
    if (!h) return null;
    const now = clock();
    return {
      id: h.id, eventId: h.event_id, functionId: h.function_id, zone: h.zone, kind: h.kind,
      seats: JSON.parse(h.seats), quantity: h.quantity, status: h.status, created: h.created,
      expires: h.expires, paymentStarted: h.payment_started,
      paymentAttempts: h.payment_attempts || 0,
      remainingMs: Math.max(0, h.expires - now), serverNow: now
    };
  };
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  function target(eventId, functionId, zoneName) {
    const id = String(eventId ?? '');
    if (SAMPLE_ZONES[id]) {
      const zone = SAMPLE_ZONES[id], kind = zone === 'General' ? 'general' : 'seat';
      if (String(functionId || '1') !== '1') throw failure(400, 'La función seleccionada no pertenece al evento.');
      if (zoneName && zoneName !== zone) throw failure(400, 'La zona seleccionada no pertenece al evento.');
      return { eventId: id, functionId: '1', zone, kind, sample: true, seats: kind === 'seat' ? SAMPLE_SEATS : [], taken: kind === 'seat' ? SAMPLE_TAKEN : [], blocked: [], capacity: 24, limit: 6 };
    }
    const event = db.prepare("SELECT payload FROM events WHERE id=? AND status='published'").get(id);
    if (!event) throw failure(404, 'El evento no está disponible para compra.');
    const payload = JSON.parse(event.payload);
    const fnId = String(functionId || payload.functions?.[0]?.id || '1');
    if (payload.functions?.length && !payload.functions.some(fn => String(fn.id) === fnId)) throw failure(400, 'La función seleccionada no pertenece al evento.');
    const zone = zoneName ? payload.zones?.find(z => z.name === zoneName) : payload.zones?.[0];
    if (!zone) throw failure(400, 'La zona seleccionada no pertenece al evento.');
    return {
      eventId: id, functionId: fnId, zone: zone.name, kind: zone.type || (/general/i.test(zone.name) ? 'general' : 'seat'), sample: false,
      seats: zone.seats || [], taken: [], blocked: [...(payload.blockedSeats || []), ...(zone.blockedSeats || [])],
      capacity: Number(zone.capacity) || 0, limit: Number(payload.ticketLimit) || 6, saleStart: payload.saleStart, saleEnd: payload.saleEnd,
    };
  }

  // Seats sold or held by anyone except the requester's own open hold.
  function occupancy(t, userId) {
    const rows = db.prepare('SELECT s.seat, h.user_id, h.status FROM hold_seats s JOIN holds h ON h.id=s.hold_id WHERE s.event_id=? AND s.function_id=? AND s.zone=?').all(t.eventId, t.functionId, t.zone);
    const mine = rows.filter(r => r.user_id === userId && (r.status === 'active' || r.status === 'paying')).map(r => r.seat);
    const taken = new Set([...t.taken, ...rows.map(r => r.seat).filter(seat => !mine.includes(seat))]);
    if (!t.sample) for (const r of db.prepare('SELECT seat FROM event_function_seats WHERE event_id=? AND function_id=? AND zone=?').all(t.eventId, t.functionId, t.zone)) taken.add(r.seat);
    return { taken, mine };
  }

  function generalCount(t, userId) {
    const held = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM holds WHERE event_id=? AND function_id=? AND zone=? AND status IN ${OPEN} AND user_id<>?`).get(t.eventId, t.functionId, t.zone, userId || '').n;
    const sold = t.sample
      ? db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM holds WHERE event_id=? AND function_id=? AND zone=? AND status='completed'").get(t.eventId, t.functionId, t.zone).n
      : db.prepare('SELECT sold FROM event_function_sales WHERE event_id=? AND function_id=? AND zone=?').get(t.eventId, t.functionId, t.zone)?.sold || 0;
    return { sold, held, available: Math.max(0, t.capacity - sold - held) };
  }

  function selection(t, data, allowEmpty = false) {
    if (t.kind === 'general') {
      const quantity = Number(data.quantity);
      if (!Number.isInteger(quantity) || quantity < (allowEmpty ? 0 : 1) || quantity > t.limit) throw failure(400, `Elige de 1 a ${t.limit} boletos.`);
      return { seats: [], quantity };
    }
    const seats = Array.isArray(data.seats) ? [...new Set(data.seats.map(String))] : [];
    if (!Array.isArray(data.seats) || seats.length !== data.seats.length || seats.length > t.limit || (!allowEmpty && !seats.length) || seats.some(seat => !SEAT.test(seat))) throw failure(400, `Elige de 1 a ${t.limit} asientos válidos.`);
    for (const seat of seats) {
      if (t.seats.length && !t.seats.includes(seat)) throw failure(400, `El asiento ${seat} no pertenece a la zona.`);
      if (t.blocked.includes(seat)) throw conflict(409, `El asiento ${seat} está bloqueado para cortesía o prensa.`, { seat });
    }
    return { seats, quantity: seats.length };
  }

  function lock(holdId, t, seats, userId) {
    const { taken } = occupancy(t, userId);
    const insert = db.prepare('INSERT INTO hold_seats(hold_id,event_id,function_id,zone,seat) VALUES(?,?,?,?,?)');
    for (const seat of seats) {
      const busy = () => conflict(409, `El asiento ${seat} ya no está disponible. Elige otro lugar.`, { seat });
      if (taken.has(seat)) throw busy();
      try { insert.run(holdId, t.eventId, t.functionId, t.zone, seat); } catch { throw busy(); }
    }
  }

  function close(id, status, reason) {
    return transaction(() => {
      const changed = db.prepare(`UPDATE holds SET status=?, closed=?, close_reason=? WHERE id=? AND status IN ${OPEN}`).run(status, clock(), reason, id).changes;
      if (changed) db.prepare('DELETE FROM hold_seats WHERE hold_id=?').run(id);
      return changed;
    });
  }

  function own(user, id) {
    const h = db.prepare('SELECT * FROM holds WHERE id=? AND user_id=?').get(String(id), user.id);
    if (!h) throw failure(404, 'No encontramos esa compra.');
    if (h.status === 'active' && h.expires <= clock()) { close(h.id, 'expired', 'tiempo agotado'); throw failure(410, EXPIRED); }
    if (h.status === 'expired') throw failure(410, EXPIRED);
    if (h.status === 'cancelled') throw failure(409, 'Esta compra ya fue cancelada.');
    if (h.status === 'completed') throw failure(409, 'Esta compra ya fue pagada.');
    return h;
  }

  // K-10: holds past their time are released. A hold in payment keeps its seats
  // until the payment answers or, as a safety net, until paymentMs pass.
  function sweep() {
    const now = clock();
    const due = db.prepare("SELECT id, status FROM holds WHERE (status='active' AND expires<=?) OR (status='paying' AND payment_started<=?)").all(now, now - paymentMs);
    let released = 0;
    for (const h of due) released += close(h.id, 'expired', h.status === 'paying' ? 'pago sin respuesta' : 'tiempo agotado');
    if (released) log(`Apartados vencidos liberados: ${released}`);
    return released;
  }

  function current(user) {
    const open = openHold(user.id);
    const recent = open ? null : db.prepare(`SELECT id, status, close_reason, closed FROM holds WHERE user_id=? AND status NOT IN ${OPEN} ORDER BY closed DESC LIMIT 1`).get(user.id);
    return { hold: view(open), recent: recent ? { id: recent.id, status: recent.status, reason: recent.close_reason, closed: recent.closed } : null, now: clock() };
  }

  function availability(user, params) {
    const t = target(params.get('eventId'), params.get('functionId'), params.get('zone'));
    const base = { eventId: t.eventId, functionId: t.functionId, zone: t.zone, kind: t.kind, now: clock() };
    if (t.kind === 'general') return { ...base, capacity: t.capacity, ...generalCount(t, user?.id) };
    const { taken, mine } = occupancy(t, user?.id);
    return { ...base, occupied: [...taken], mine };
  }

  function create(user, data) {
    const open = openHold(user.id);
    if (open) throw conflict(409, 'Tienes una compra en curso. Continúala o cancélala antes de empezar otra.', { hold: view(open) });
    const t = target(data.eventId, data.functionId, data.zone), now = clock();
    if (t.saleStart && now < Date.parse(t.saleStart)) throw failure(409, 'La venta de este evento todavía no inicia.');
    if (t.saleEnd && now > Date.parse(t.saleEnd)) throw failure(409, 'La venta de este evento ya terminó.');
    const { seats, quantity } = selection(t, data), id = randomBytes(16).toString('hex');
    try {
      transaction(() => {
        db.prepare("INSERT INTO holds(id,user_id,event_id,function_id,zone,kind,seats,quantity,status,created,expires) VALUES(?,?,?,?,?,?,?,?,'active',?,?)")
          .run(id, user.id, t.eventId, t.functionId, t.zone, t.kind, JSON.stringify(seats), quantity, now, now + holdMs);
        if (t.kind === 'seat') lock(id, t, seats, user.id);
        else if (quantity > generalCount(t, user.id).available) throw failure(409, 'Ya no hay suficientes lugares en esta zona.');
      });
    } catch (error) {
      const other = !error.status && openHold(user.id);
      if (other) throw conflict(409, 'Tienes una compra en curso. Continúala o cancélala antes de empezar otra.', { hold: view(other) });
      throw error;
    }
    return view(find(id));
  }

  // RN-03: changing the selection keeps the original expiry; the clock never extends.
  function update(user, id, data) {
    const h = own(user, id);
    if (h.status === 'paying') throw failure(409, 'Tu pago está en proceso; ya no puedes cambiar tus lugares.');
    const t = target(h.event_id, h.function_id, h.zone), { seats, quantity } = selection(t, data, true);
    if (!quantity) { close(h.id, 'cancelled', 'sin lugares'); return { hold: null, cancelled: true }; }
    transaction(() => {
      db.prepare('DELETE FROM hold_seats WHERE hold_id=?').run(h.id);
      if (t.kind === 'seat') lock(h.id, t, seats, user.id);
      else if (quantity > generalCount(t, user.id).available) throw failure(409, 'Ya no hay suficientes lugares en esta zona.');
      db.prepare('UPDATE holds SET seats=?, quantity=? WHERE id=?').run(JSON.stringify(seats), quantity, h.id);
    });
    return { hold: view(find(h.id)) };
  }

  function cancel(user, id) {
    const h = own(user, id);
    if (h.status === 'paying') throw failure(409, 'Tu pago está en proceso; espera su resultado antes de cancelar.');
    close(h.id, 'cancelled', 'cancelada por el comprador');
    return { ok: true };
  }

  function pay(user, id) {
    const h = own(user, id);
    if (h.status === 'active') db.prepare("UPDATE holds SET status='paying', payment_started=? WHERE id=? AND status='active'").run(clock(), h.id);
    return { hold: view(find(h.id)) };
  }

  // A rejected payment returns the seats to the clock, or frees them if time ran out (max 3 attempts).
  function paymentFailed(user, id) {
    const h = own(user, id);
    if (h.status !== 'paying') return { hold: view(h) };
    const attempts = (h.payment_attempts || 0) + 1;
    db.prepare('UPDATE holds SET payment_attempts=? WHERE id=?').run(attempts, h.id);
    if (attempts >= 3) {
      close(h.id, 'cancelled', '3 intentos de pago rechazados');
      return { hold: null, cancelled: true, attempts, maxAttempts: 3 };
    }
    if (h.expires > clock()) {
      db.prepare("UPDATE holds SET status='active', payment_started=NULL WHERE id=? AND status='paying'").run(h.id);
      return { hold: view(find(h.id)), attempts, maxAttempts: 3 };
    }
    close(h.id, 'expired', 'pago rechazado sin tiempo');
    return { hold: null, expired: true, attempts, maxAttempts: 3 };
  }

  // Runs inside the orders transaction, so it must not open its own.
  function completeForOrder(user, order) {
    const h = db.prepare('SELECT * FROM holds WHERE id=? AND user_id=?').get(String(order.holdId), user.id), now = clock();
    if (!h) throw failure(409, 'No encontramos tu apartado. Elige tus boletos otra vez.');
    if (h.status === 'expired' || (h.status === 'active' && h.expires <= now)) throw failure(410, EXPIRED);
    if (h.status !== 'active' && h.status !== 'paying') throw failure(409, 'Esta compra ya no está activa.');
    const held = JSON.parse(h.seats), bought = order.tickets.map(ticket => ticket.seat);
    const same = String(h.event_id) === String(order.eventId) && (h.kind === 'seat' ? held.length === bought.length && held.every(seat => bought.includes(seat)) : h.quantity === bought.length);
    if (!same) throw failure(409, 'Los boletos no coinciden con los lugares apartados.');
    db.prepare("UPDATE holds SET status='completed', closed=?, close_reason='pagada', order_id=? WHERE id=?").run(now, order.id, h.id);
    return h;
  }

  // Orders saved without a hold still cannot take seats another buyer holds.
  function guardLegacy(user, order) {
    const id = String(order.eventId);
    let zone = SAMPLE_ZONES[id], fnId = '1';
    if (!zone) {
      const event = db.prepare("SELECT payload FROM events WHERE id=? AND status='published'").get(id);
      if (!event) return;
      const payload = JSON.parse(event.payload);
      zone = (payload.zones?.find(z => z.name === order.zone) || payload.zones?.[0])?.name;
      fnId = String(order.functionId || payload.functions?.[0]?.id || '1');
    }
    if (!zone) return;
    const owner = db.prepare('SELECT h.user_id FROM hold_seats s JOIN holds h ON h.id=s.hold_id WHERE s.event_id=? AND s.function_id=? AND s.zone=? AND s.seat=?');
    for (const ticket of order.tickets) {
      const row = owner.get(id, fnId, zone, ticket.seat);
      if (row && row.user_id !== user.id) throw conflict(409, `El asiento ${ticket.seat} está apartado por otra persona.`, { seat: ticket.seat });
    }
  }

  function adminSummary() {
    const counts = { active: 0, paying: 0, completed: 0, cancelled: 0, expired: 0 };
    for (const row of db.prepare('SELECT status, COUNT(*) AS total FROM holds GROUP BY status').all()) counts[row.status] = row.total;
    const expired = db.prepare("SELECT h.*, u.email FROM holds h JOIN users u ON u.id=h.user_id WHERE h.status='expired' ORDER BY h.closed DESC LIMIT 50").all()
      .map(h => ({ id: h.id, email: h.email, eventId: h.event_id, functionId: h.function_id, zone: h.zone, kind: h.kind, seats: JSON.parse(h.seats), quantity: h.quantity, created: h.created, closed: h.closed, reason: h.close_reason }));
    return { counts, expired };
  }

  return { sweep, current, availability, create, update, cancel, pay, paymentFailed, completeForOrder, guardLegacy, adminSummary };
}
