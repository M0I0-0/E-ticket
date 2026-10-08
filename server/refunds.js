import { randomBytes } from 'node:crypto';
import { round } from './catalog.js';
import { longDate, money } from './pdf.js';

const DAY = 86400000;
const OPEN = "('active','paying')";
// Sandbox rule: payments made with the test card ending in 0069 are approved,
// but the gateway rejects their refunds (T11.5).
export const REFUND_FAILS_LAST4 = '0069';

export function createRefunds(db, { failure, clock = Date.now, catalog, tickets, mailer, audit, notify }) {
  db.exec(`CREATE TABLE IF NOT EXISTS refunds(
      id TEXT PRIMARY KEY, created INTEGER NOT NULL, order_id TEXT NOT NULL, ticket_id TEXT, event_id TEXT NOT NULL,
      amount REAL NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      gateway_ref TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', actor_id TEXT,
      notes TEXT NOT NULL DEFAULT '', resolved INTEGER
    );
    CREATE INDEX IF NOT EXISTS refunds_created ON refunds(created);
    CREATE TABLE IF NOT EXISTS cancellations(
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, requested_by TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL, decided_by TEXT, decision_reason TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, decided INTEGER
    );`);
  const newId = prefix => `${prefix}_${randomBytes(8).toString('hex')}`;
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const user = userId => db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const when = (ev, functionId) => { const f = catalog.fn(ev, functionId); return f ? `${longDate(f.date)} · ${f.hour} h` : ''; };

  // The sandbox gateway answers synchronously, so refunds can run inside a transaction.
  const gateway = order => order.last4 === REFUND_FAILS_LAST4
    ? { ok: false, error: 'La pasarela rechazó el reembolso: la tarjeta fue cancelada por el banco (sandbox).' }
    : { ok: true, ref: newId('re_sandbox') };

  function applyToOrder(order, amount) {
    const refunded = round(order.refunded + amount);
    db.prepare('UPDATE orders SET refunded=?, status=? WHERE id=?').run(refunded, refunded >= order.total - 0.001 ? 'refunded' : 'partially_refunded', order.id);
  }

  // One refund attempt; failures stay listed for the administrator (T11.5).
  function attempt({ order, ticket = null, amount, kind, reason, actor }) {
    const result = gateway(order), refundId = newId('ref');
    db.prepare('INSERT INTO refunds(id,created,order_id,ticket_id,event_id,amount,kind,reason,status,gateway_ref,error,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(refundId, clock(), order.id, ticket?.id ?? null, order.event_id, amount, kind, reason, result.ok ? 'succeeded' : 'failed', result.ref || '', result.error || '', actor?.id ?? null);
    if (result.ok) applyToOrder(order, amount);
    audit.record(actor, result.ok ? 'reembolso.emitido' : 'reembolso.fallido', { targetType: 'orden', targetId: order.id, eventId: order.event_id, details: `${money(amount)} · ${kind}${ticket ? ` · ${ticket.seat}` : ''}${result.ok ? '' : ` · ${result.error}`}` });
    return { ok: result.ok, refundId, error: result.error };
  }

  // Refunds one ticket: its QR stops working and its seat goes back on sale.
  function refundTicketRow(t, { kind, reason, actor }) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(t.order_id);
    const outcome = attempt({ order, ticket: t, amount: t.price, kind, reason, actor });
    if (outcome.ok) {
      db.prepare("UPDATE tickets SET status='refunded', updated=? WHERE id=?").run(clock(), t.id);
      tickets.releaseSeat(t);
    }
    return outcome;
  }
  function afterTicketRefund(t, outcome, amountText) {
    const ev = catalog.event(t.event_id), owner = user(t.owner_id);
    if (outcome.ok) {
      notify.afterRelease(ev, t.function_id);
      mailer.send({ to: owner.email, kind: 'reembolso', subject: `Reembolso de tu boleto para ${ev?.name}`, text: [`Hola, ${owner.name}:`, '', `Reembolsamos ${amountText} de tu boleto ${t.seat} para ${ev?.name} (${when(ev, t.function_id)}).`, 'El QR de ese boleto ya no es válido.', '', 'eTicket'].join('\n') });
    }
  }

  // ---- T11.7: the administrator refunds a single ticket of an order.
  function refundTicket(actor, ticketId, data) {
    const t = tickets.ticket(ticketId);
    if (!t) throw failure(404, 'Boleto no encontrado.');
    if (t.status !== 'valid') throw failure(409, 'Solo se pueden reembolsar boletos vigentes.');
    const reason = String(data?.reason || '').trim().slice(0, 200) || 'Reembolso individual';
    const outcome = transaction(() => refundTicketRow(t, { kind: 'individual', reason, actor }));
    afterTicketRefund(t, outcome, money(t.price));
    if (!outcome.ok) throw Object.assign(failure(502, outcome.error), { extra: { refundId: outcome.refundId } });
    return { ok: true, refundId: outcome.refundId, amount: t.price };
  }

  // ---- T11.6: after a date change the holder can ask for a refund for 10 days.
  function requestRefund(holder, ticketId) {
    const t = tickets.ticket(ticketId);
    if (!t || t.owner_id !== holder.id) throw failure(404, 'No encontramos ese boleto en tu cuenta.');
    const view = tickets.ticketView(t);
    if (!view.refundUntil) throw failure(409, 'Este boleto no tiene un reembolso disponible: solo aplica durante 10 días después de un cambio de fecha.');
    const outcome = transaction(() => refundTicketRow(t, { kind: 'cambio de fecha', reason: 'Solicitado por el titular tras el cambio de fecha', actor: holder }));
    afterTicketRefund(t, outcome, money(t.price));
    if (!outcome.ok) throw Object.assign(failure(502, `${outcome.error} La administración atenderá tu reembolso.`), { extra: { refundId: outcome.refundId } });
    return { ok: true, amount: t.price };
  }

  function reschedule(actor, eventId, functionId, data) {
    const ev = catalog.event(eventId);
    if (!ev || ev.sample) throw failure(404, 'Evento no encontrado.');
    if (!tickets.canManage(actor, ev)) throw failure(403, 'Solo el organizador del evento o la administración pueden cambiar la fecha.');
    if (ev.status !== 'published') throw failure(409, 'Solo se puede cambiar la fecha de un evento publicado.');
    const f = catalog.fn(ev, functionId);
    if (!f) throw failure(404, 'La función no pertenece al evento.');
    const date = String(data?.date || ''), hour = String(data?.hour || ''), reason = String(data?.reason || '').trim().slice(0, 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(hour) || !Number.isFinite(new Date(`${date}T${hour}:00`).getTime())) throw failure(400, 'Escribe la nueva fecha y hora.');
    if (new Date(`${date}T${hour}:00`).getTime() <= clock()) throw failure(400, 'La nueva fecha debe ser futura.');
    if (date === f.date && hour === f.hour) throw failure(400, 'La nueva fecha es igual a la actual.');
    if (!reason) throw failure(400, 'Escribe el motivo del cambio.');
    const now = clock(), refundUntil = now + 10 * DAY;
    transaction(() => {
      const row = db.prepare('SELECT payload FROM events WHERE id=?').get(ev.id), payload = JSON.parse(row.payload);
      payload.functions = (payload.functions?.length ? payload.functions : [{ id: '1', date: payload.date, hour: payload.hour }]).map(fn => String(fn.id) === f.id ? { ...fn, date, hour } : fn);
      if (payload.functions[0]) { payload.date = payload.functions[0].date; payload.hour = payload.functions[0].hour; }
      db.prepare('UPDATE events SET payload=?, updated=? WHERE id=?').run(JSON.stringify(payload), now, ev.id);
      db.prepare('INSERT INTO function_changes(id,event_id,function_id,old_date,old_hour,new_date,new_hour,reason,changed_by,created,refund_until) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(newId('chg'), ev.id, f.id, f.date, f.hour, date, hour, reason, actor.id, now, refundUntil);
      audit.record(actor, 'funcion.reprogramada', { targetType: 'función', targetId: f.id, eventId: ev.id, details: `${f.date} ${f.hour} → ${date} ${hour} · ${reason}` });
    });
    const holders = db.prepare("SELECT DISTINCT owner_id FROM tickets WHERE event_id=? AND function_id=? AND status='valid'").all(ev.id, f.id).map(r => user(r.owner_id));
    const deadline = new Date(refundUntil).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    for (const holder of holders) mailer.send({
      to: holder.email, kind: 'cambio de fecha', subject: `Cambió la fecha de ${ev.name}`,
      text: [`Hola, ${holder.name}:`, '', `La función de ${ev.name} cambió de fecha.`, `Antes: ${longDate(f.date)} · ${f.hour} h`, `Ahora: ${longDate(date)} · ${hour} h`, `Motivo: ${reason}`, '', `Tus boletos siguen siendo válidos para la nueva fecha. Si no puedes asistir, pide tu reembolso en «Mis boletos» antes del ${deadline}.`, '', 'eTicket'].join('\n'),
    });
    return { ok: true, notified: holders.length, refundUntil };
  }

  // ---- T11.3: the organizer asks; only the administrator can cancel.
  function requestCancel(actor, eventId, data) {
    const ev = catalog.event(eventId);
    if (!ev || ev.sample) throw failure(404, 'Evento no encontrado.');
    if (actor.role !== 'organizador' || ev.ownerId !== actor.id) throw failure(403, 'Solo el organizador del evento puede solicitar la cancelación.');
    if (ev.status !== 'published') throw failure(409, 'Solo se puede cancelar un evento publicado.');
    if (db.prepare("SELECT 1 FROM cancellations WHERE event_id=? AND status='requested'").get(ev.id)) throw failure(409, 'Ya hay una solicitud de cancelación pendiente para este evento.');
    const reason = String(data?.reason || '').trim().slice(0, 500);
    if (!reason) throw failure(400, 'Escribe el motivo de la cancelación.');
    const cancelId = newId('can');
    db.prepare("INSERT INTO cancellations(id,event_id,requested_by,reason,status,created) VALUES(?,?,?,?,'requested',?)").run(cancelId, ev.id, actor.id, reason, clock());
    audit.record(actor, 'cancelacion.solicitada', { targetType: 'evento', targetId: ev.id, eventId: ev.id, details: reason });
    return { ok: true, id: cancelId };
  }

  const cancellationView = c => {
    const ev = catalog.event(c.event_id), by = user(c.requested_by);
    const orders = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total-refunded),0) AS amount FROM orders WHERE event_id=?').get(c.event_id);
    return { id: c.id, eventId: c.event_id, eventName: ev?.name || c.event_id, requestedBy: by?.email || '', reason: c.reason, status: c.status, decisionReason: c.decision_reason, created: c.created, decided: c.decided, orders: orders.n, amount: round(orders.amount) };
  };
  const cancellations = () => db.prepare("SELECT * FROM cancellations ORDER BY status='requested' DESC, created DESC").all().map(cancellationView);
  const cancellationFor = eventId => db.prepare('SELECT * FROM cancellations WHERE event_id=? ORDER BY created DESC LIMIT 1').get(String(eventId));

  // ---- T11.4: approving a cancellation invalidates every QR and refunds each order in full.
  function decideCancel(actor, cancelId, data) {
    const c = db.prepare('SELECT * FROM cancellations WHERE id=?').get(String(cancelId));
    if (!c) throw failure(404, 'Solicitud no encontrada.');
    if (c.status !== 'requested') throw failure(409, 'Esta solicitud ya fue resuelta.');
    const ev = catalog.event(c.event_id), organizer = user(c.requested_by), now = clock();
    const decisionReason = String(data?.reason || '').trim().slice(0, 500);
    if (!data?.approve) {
      if (!decisionReason) throw failure(400, 'Escribe el motivo del rechazo.');
      db.prepare("UPDATE cancellations SET status='rejected', decided_by=?, decision_reason=?, decided=? WHERE id=?").run(actor.id, decisionReason, now, c.id);
      audit.record(actor, 'cancelacion.rechazada', { targetType: 'evento', targetId: c.event_id, eventId: c.event_id, details: decisionReason });
      mailer.send({ to: organizer.email, kind: 'cancelacion', subject: `Se rechazó la cancelación de ${ev?.name}`, text: [`Hola, ${organizer.name}:`, '', `La administración rechazó cancelar ${ev?.name}.`, `Motivo: ${decisionReason}`, '', 'El evento sigue publicado.', '', 'eTicket'].join('\n') });
      return { ok: true, status: 'rejected' };
    }
    const affected = db.prepare(`SELECT * FROM tickets WHERE event_id=? AND status IN ('valid','used')`).all(ev.id);
    const results = transaction(() => {
      db.prepare("UPDATE events SET status='cancelled', updated=? WHERE id=?").run(now, ev.id);
      db.prepare("UPDATE cancellations SET status='approved', decided_by=?, decision_reason=?, decided=? WHERE id=?").run(actor.id, decisionReason, now, c.id);
      const open = db.prepare(`SELECT id FROM holds WHERE event_id=? AND status IN ${OPEN}`).all(ev.id);
      for (const h of open) {
        db.prepare("UPDATE holds SET status='cancelled', closed=?, close_reason='evento cancelado' WHERE id=?").run(now, h.id);
        db.prepare('DELETE FROM hold_seats WHERE hold_id=?').run(h.id);
      }
      db.prepare(`UPDATE tickets SET status='cancelled', updated=? WHERE event_id=? AND status IN ('valid','used')`).run(now, ev.id);
      audit.record(actor, 'cancelacion.aprobada', { targetType: 'evento', targetId: ev.id, eventId: ev.id, details: c.reason });
      return db.prepare('SELECT * FROM orders WHERE event_id=? AND total-refunded>0.001').all(ev.id)
        .map(order => ({ order, ...attempt({ order, amount: round(order.total - order.refunded), kind: 'cancelación', reason: `Evento cancelado: ${c.reason}`, actor }) }));
    });
    for (const r of results) {
      const buyer = user(r.order.user_id), amount = money(round(r.order.total - r.order.refunded));
      mailer.send({ to: buyer.email, kind: 'cancelacion', subject: `Se canceló ${ev.name}`, text: [`Hola, ${buyer.name}:`, '', `Lamentamos avisarte que ${ev.name} (${when(ev, r.order.function_id)}) fue cancelado.`, `Motivo: ${c.reason}`, '', r.ok ? `Te reembolsamos ${amount} (el 100 % de tu orden ${r.order.id}, cargo por servicio incluido).` : `Tu reembolso de ${amount} (orden ${r.order.id}) no se pudo procesar automáticamente. La administración lo atenderá y te avisará.`, 'Los QR de tus boletos ya no son válidos.', '', 'eTicket'].join('\n') });
    }
    const buyers = new Set(results.map(r => r.order.user_id));
    for (const ownerId of new Set(affected.map(t => t.owner_id))) {
      if (buyers.has(ownerId)) continue;
      const owner = user(ownerId);
      mailer.send({ to: owner.email, kind: 'cancelacion', subject: `Se canceló ${ev.name}`, text: [`Hola, ${owner.name}:`, '', `${ev.name} fue cancelado. Los QR de tus boletos ya no son válidos.`, 'El reembolso se hace a quien compró los boletos.', '', 'eTicket'].join('\n') });
    }
    mailer.send({ to: organizer.email, kind: 'cancelacion', subject: `Se aprobó la cancelación de ${ev.name}`, text: [`Hola, ${organizer.name}:`, '', `La administración aprobó cancelar ${ev.name}.`, `Órdenes reembolsadas: ${results.filter(r => r.ok).length} de ${results.length}.`, '', 'eTicket'].join('\n') });
    return { ok: true, status: 'approved', orders: results.length, refunded: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, tickets: affected.length };
  }

  // ---- T11.5: refunds the gateway rejected, for the administrator to handle.
  const refundView = r => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(r.order_id), buyer = order && user(order.user_id), t = r.ticket_id && tickets.ticket(r.ticket_id);
    return { id: r.id, created: r.created, orderId: r.order_id, eventId: r.event_id, eventName: catalog.event(r.event_id)?.name || r.event_id, buyer: buyer?.email || '', seat: t?.seat || '', amount: r.amount, kind: r.kind, reason: r.reason, status: r.status, error: r.error, notes: r.notes, resolved: r.resolved };
  };
  const listRefunds = (status = '') => (status ? db.prepare('SELECT * FROM refunds WHERE status=? ORDER BY created DESC').all(status) : db.prepare('SELECT * FROM refunds ORDER BY created DESC LIMIT 200').all()).map(refundView);

  function retry(actor, refundId) {
    const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(String(refundId));
    if (!r) throw failure(404, 'Reembolso no encontrado.');
    if (r.status !== 'failed') throw failure(409, 'Solo se pueden reintentar reembolsos fallidos.');
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(r.order_id), result = gateway(order);
    transaction(() => {
      if (!result.ok) { db.prepare('UPDATE refunds SET error=? WHERE id=?').run(result.error, r.id); return; }
      db.prepare("UPDATE refunds SET status='succeeded', gateway_ref=?, error='', resolved=? WHERE id=?").run(result.ref, clock(), r.id);
      applyToOrder(order, r.amount);
      const t = r.ticket_id && tickets.ticket(r.ticket_id);
      if (t && t.status === 'valid') { db.prepare("UPDATE tickets SET status='refunded', updated=? WHERE id=?").run(clock(), t.id); tickets.releaseSeat(t); }
      audit.record(actor, 'reembolso.emitido', { targetType: 'orden', targetId: order.id, eventId: order.event_id, details: `${money(r.amount)} · reintento` });
    });
    if (!result.ok) throw failure(502, result.error);
    return { ok: true };
  }

  function resolve(actor, refundId, data) {
    const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(String(refundId));
    if (!r) throw failure(404, 'Reembolso no encontrado.');
    if (r.status !== 'failed') throw failure(409, 'Solo se pueden resolver reembolsos fallidos.');
    const notes = String(data?.notes || '').trim().slice(0, 300);
    if (!notes) throw failure(400, 'Describe cómo se resolvió (por ejemplo, transferencia bancaria).');
    db.prepare("UPDATE refunds SET status='resolved', notes=?, resolved=? WHERE id=?").run(notes, clock(), r.id);
    audit.record(actor, 'reembolso.resuelto', { targetType: 'orden', targetId: r.order_id, eventId: r.event_id, details: `${money(r.amount)} · ${notes}` });
    return { ok: true };
  }

  return { refundTicket, requestRefund, reschedule, requestCancel, cancellations, cancellationFor, decideCancel, listRefunds, retry, resolve };
}
