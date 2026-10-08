import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, MINUTE, HOUR, DAY } from './test-helpers.js';

const localDay = ms => new Date(ms).toLocaleDateString('sv-SE');

test('T10.1 and T10.2 the organizer dashboard matches the test orders and counts real attendance', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), staff = await f.staff(admin.cookie, 'gate@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, {
    name: 'Gala', zones: [
      { name: 'Luneta', type: 'seat', price: 500, capacity: 4, seats: ['A1', 'A2', 'A3', 'A4'], accessible: [], blockedSeats: ['A4'] },
      { name: 'General', type: 'general', price: 250, capacity: 10, seats: [], accessible: [] },
    ],
  });
  const b1 = await f.register('b1@example.com'), b2 = await f.register('b2@example.com');
  const luneta = await f.buy(b1.cookie, { eventId, zone: 'Luneta', seats: ['A1', 'A2'] });
  const general = await f.buy(b2.cookie, { eventId, zone: 'General', quantity: 3 });
  assert.deepEqual([luneta.total, general.total], [1276, 957]);
  const report = (await f.get(`organizer/events/${eventId}/report`, org.cookie)).body;
  const row = zone => report.rows.find(r => r.zone === zone);
  assert.deepEqual([row('Luneta').capacity, row('Luneta').sold, row('Luneta').available, row('Luneta').courtesies], [3, 2, 1, 1]);
  assert.deepEqual([row('General').capacity, row('General').sold, row('General').available, row('General').courtesies], [10, 3, 7, 0]);
  assert.deepEqual(
    [report.totals.sold, report.totals.revenue, report.totals.commission, report.totals.vat, report.totals.collected, report.totals.settle, report.totals.available, report.totals.courtesies],
    [5, 1750, 175, 308, 2233, 1750, 8, 1],
  );
  await f.assign(org.cookie, staff.id, eventId);
  for (const code of [luneta.tickets[0].code, general.tickets[0].code, general.tickets[1].code]) assert.equal((await f.scan(staff.cookie, code, eventId)).body.result, 'valid');
  const after = (await f.get(`organizer/events/${eventId}/report`, org.cookie)).body;
  assert.deepEqual([after.attendance[0].sold, after.attendance[0].scanned, after.attendance[0].rate], [5, 3, 60]);
  assert.equal(after.totals.scanned, 3);
  const csv = await f.raw(`organizer/events/${eventId}/report.csv`, org.cookie);
  assert.match(csv.type, /^text\/csv/);
  assert.match(csv.text, /Total,,,13,5,8,1,3,1750\.00,175\.00,308\.00/);
});

test('T10.3 and T10.4 administrator reports filter by date, add up and export the same figures to CSV', async t => {
  const f = await fixture(t), admin = await f.admin();
  const b1 = await f.register('b1@example.com'), b2 = await f.register('b2@example.com'), b3 = await f.register('b3@example.com');
  const day1 = localDay(f.clock.now);
  const first = await f.buy(b1.cookie, { seats: ['A1'] });
  f.advance(2 * DAY);
  const day3 = localDay(f.clock.now);
  const second = await f.buy(b2.cookie, { eventId: 2, zone: 'Luneta', seats: ['A1', 'A2'] });
  await f.hold(b3.cookie, { seats: ['B1'] });
  f.advance(11 * MINUTE);
  const refunded = second.tickets[1];
  await f.request(`admin/tickets/${refunded.id}/refund`, { reason: 'Prueba de reporte' }, admin.cookie);
  assert.deepEqual([first.total, second.total, refunded.price], [574.2, 714.56, 357.28]);

  const sales = (from, to) => f.get(`admin/reports/ventas?from=${from}&to=${to}`, admin.cookie);
  const onlyDay1 = (await sales(day1, day1)).body;
  assert.deepEqual(onlyDay1.rows.map(r => [r.day, r.orders, r.total]), [[day1, 1, 574.2]]);
  const both = (await sales(day1, day3)).body;
  assert.equal(both.rows.length, 2);
  assert.deepEqual([both.totals.orders, both.totals.tickets, both.totals.total, both.totals.refunded, both.totals.fee], [2, 3, 1288.76, 357.28, 101]);
  const commissions = (await f.get(`admin/reports/comisiones?from=${day1}&to=${day3}`, admin.cookie)).body;
  assert.deepEqual(commissions.rows.map(r => [r.event, r.fee, r.rates]).sort(), [['Ecos de medianoche', 45, '10 %'], ['Entre dos mundos', 56, '10 %']]);
  const top = (await f.get(`admin/reports/eventos?from=${day1}&to=${day3}`, admin.cookie)).body;
  assert.deepEqual(top.rows.map(r => [r.rank, r.event, r.tickets]), [[1, 'Ecos de medianoche', 1], [2, 'Entre dos mundos', 1]]);
  const expired = (await f.get(`admin/reports/expiradas?from=${day3}&to=${day3}`, admin.cookie)).body;
  assert.deepEqual(expired.rows.map(r => [r.email, r.places]), [['b3@example.com', 'B1']]);
  assert.equal((await f.get(`admin/reports/expiradas?from=${day1}&to=${day1}`, admin.cookie)).body.rows.length, 0);
  const refunds = (await f.get('admin/reports/reembolsos', admin.cookie)).body;
  assert.deepEqual(refunds.rows.map(r => [r.order, r.seat, r.amount, r.status]), [[second.id, 'A2', 357.28, 'Reembolsado']]);

  const csv = await f.raw(`admin/reports/ventas.csv?from=${day1}&to=${day3}`, admin.cookie);
  assert.equal(csv.status, 200);
  assert.match(csv.type, /^text\/csv; charset=utf-8/);
  assert.match(csv.disposition, new RegExp(`ventas-${day1}-a-${day3}\\.csv`));
  assert.equal(csv.text.charCodeAt(0), 0xFEFF);
  const lines = csv.text.slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'Día,Órdenes,Boletos,Subtotal,Cargo por servicio,IVA,Total cobrado,Reembolsado');
  assert.equal(lines[1], `${day1},1,1,450.00,45.00,79.20,574.20,0.00`);
  assert.equal(lines.at(-1), 'Total,2,3,1010.00,101.00,177.76,1288.76,357.28');
  assert.equal((await f.get('admin/reports/ventas?from=2026-13-01', admin.cookie)).status, 400);
  assert.equal((await f.get('admin/reports/ventas', b1.cookie)).status, 403);
});

test('T10.5 a blocked user cannot buy, but their tickets stay valid', async t => {
  const f = await fixture(t), admin = await f.admin(), staff = await f.staff(admin.cookie, 'gate@example.com');
  const ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  await f.assign(admin.cookie, staff.id, 1);
  const order = await f.buy(ana.cookie, { seats: ['A7'] });
  const open = (await f.hold(beto.cookie, { seats: ['C5'] })).body.hold;
  const found = (await f.get('admin/users?q=ana@', admin.cookie)).body.users;
  assert.deepEqual(found.map(u => [u.email, u.blocked, u.tickets]), [['ana@example.com', false, 1]]);
  assert.equal((await f.request(`admin/users/${ana.id}/block`, { blocked: true }, admin.cookie)).status, 400);
  assert.equal((await f.request(`admin/users/${ana.id}/block`, { blocked: true, reason: 'Reventa sospechosa' }, admin.cookie)).status, 200);
  assert.equal((await f.request(`admin/users/${beto.id}/block`, { blocked: true, reason: 'Contracargo' }, admin.cookie)).status, 200);
  assert.equal((await f.request(`admin/users/${admin.id}/block`, { blocked: true, reason: 'x' }, admin.cookie)).status, 400);
  const denied = await f.hold(ana.cookie, { seats: ['A8'] });
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /bloqueada/);
  assert.equal((await f.request('payments/charge', { holdId: open.id, token: 'tok_sandbox_x', last4: '4242', idempotencyKey: 'ik-blocked' }, beto.cookie)).status, 403);
  assert.equal((await f.get('auth/me', ana.cookie)).body.user.blocked, true);
  assert.equal((await f.get('tickets', ana.cookie)).body.tickets.length, 1);
  assert.equal((await f.scan(staff.cookie, order.tickets[0].code)).body.result, 'valid');
  assert.equal((await f.request(`admin/users/${ana.id}/block`, { blocked: false }, admin.cookie)).status, 200);
  assert.equal((await f.hold(ana.cookie, { seats: ['A8'] })).status, 201);
});

test('T10.6 a new service fee only applies to purchases started after the change', async t => {
  const f = await fixture(t), admin = await f.admin(), ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  const before = (await f.hold(ana.cookie, { seats: ['A1'] })).body.hold;
  assert.equal(before.feeRate, 0.1);
  assert.equal((await f.request('admin/settings', { percent: 40 }, admin.cookie, 'PUT')).status, 400);
  assert.equal((await f.request('admin/settings', { percent: 15 }, ana.cookie, 'PUT')).status, 403);
  assert.equal((await f.request('admin/settings', { percent: 15 }, admin.cookie, 'PUT')).status, 200);
  assert.equal((await f.get('settings')).body.serviceFeeRate, 0.15);
  const after = (await f.hold(beto.cookie, { seats: ['A2'] })).body.hold;
  assert.equal(after.feeRate, 0.15);
  const pay = (cookie, hold, key) => f.request('payments/charge', { holdId: hold.id, token: 'tok_sandbox_ok', last4: '4242', idempotencyKey: key }, cookie);
  const old = (await pay(ana.cookie, before, 'ik-fee-1')).body.order, fresh = (await pay(beto.cookie, after, 'ik-fee-2')).body.order;
  assert.deepEqual([old.breakdown.fee, old.breakdown.feeRate, old.total], [45, 0.1, 574.2]);
  assert.deepEqual([fresh.breakdown.fee, fresh.breakdown.feeRate, fresh.total], [67.5, 0.15, 600.3]);
  const entry = (await f.get('admin/audit?action=comision.cambiada', admin.cookie)).body.entries[0];
  assert.equal(entry.details, '10 % → 15 %');
});

test('T10.7 approvals, cancellations, refunds, blocks and scan reversals leave a searchable audit trail', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), staff = await f.staff(admin.cookie, 'gate@example.com');
  const buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie);
  await f.assign(org.cookie, staff.id, eventId);
  const order = await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 2 });
  await f.scan(staff.cookie, order.tickets[0].code, eventId);
  await f.request(`tickets/${order.tickets[0].id}/revert-scan`, { reason: 'Error de lectura' }, org.cookie);
  await f.request(`admin/tickets/${order.tickets[1].id}/refund`, { reason: 'Solicitud del cliente' }, admin.cookie);
  await f.request(`admin/users/${buyer.id}/block`, { blocked: true, reason: 'Prueba' }, admin.cookie);
  await f.request(`events/${eventId}/cancel-request`, { reason: 'Prueba de bitácora' }, org.cookie);
  const pending = (await f.get('admin/cancellations', admin.cookie)).body.cancellations[0];
  await f.request(`admin/cancellations/${pending.id}/decision`, { approve: true }, admin.cookie);
  const entries = (await f.get('admin/audit', admin.cookie)).body.entries;
  const by = action => entries.filter(e => e.action === action).map(e => e.actorEmail);
  assert.deepEqual(by('organizador.aprobado'), ['admin@example.com']);
  assert.deepEqual(by('evento.aprobado'), ['admin@example.com']);
  assert.deepEqual(by('rol.cambiado'), ['admin@example.com']);
  assert.deepEqual(by('personal.asignado'), ['org@example.com']);
  assert.deepEqual(by('escaneo.revertido'), ['org@example.com']);
  assert.deepEqual(by('usuario.bloqueado'), ['admin@example.com']);
  assert.deepEqual(by('cancelacion.solicitada'), ['org@example.com']);
  assert.deepEqual(by('cancelacion.aprobada'), ['admin@example.com']);
  assert.equal(by('reembolso.emitido').length, 2);
  for (const entry of entries) assert.ok(entry.created > 0 && entry.label);
  assert.equal((await f.get('admin/audit?action=usuario.bloqueado', admin.cookie)).body.entries.length, 1);
  assert.equal((await f.get('admin/audit', org.cookie)).status, 403);
});

test('T10.8 approval, rejection, sold-out and 24-hour reminder e-mails arrive with simulated dates', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: 'Concierto pequeño', functions: [{ id: '1', date: '2026-12-20', hour: '20:00' }], zones: [{ name: 'General', type: 'general', price: 100, capacity: 1, seats: [], accessible: [] }] });
  const draft = await f.request('events', { name: 'Evento incompleto', date: '2026-12-21', hour: '20:00', zones: [{ name: 'General', price: 100, capacity: 5 }] }, org.cookie);
  await f.request(`events/${draft.body.id}/submit`, {}, org.cookie);
  await f.request(`events/${draft.body.id}/decision`, { approve: false, reason: 'Falta la descripción' }, admin.cookie);
  const buyer = await f.register('buyer@example.com');
  await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 1 });
  await f.flush();
  const to = (email, pattern) => f.messages.filter(m => m.to === email && pattern.test(m.subject));
  assert.equal(to('org@example.com', /«Concierto pequeño» fue aprobado/).length, 1);
  const rejected = to('org@example.com', /«Evento incompleto» fue rechazado/);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].text, /Falta la descripción/);
  assert.equal(to('org@example.com', /Se agotó «Concierto pequeño»/).length, 1);
  f.setNow(new Date('2026-12-20T20:00:00').getTime() - 25 * HOUR);
  assert.equal(f.runScheduled(), 0);
  f.setNow(new Date('2026-12-20T20:00:00').getTime() - 23 * HOUR);
  assert.equal(f.runScheduled(), 1);
  assert.equal(f.runScheduled(), 0);
  await f.flush();
  const reminder = to('buyer@example.com', /Recordatorio: «Concierto pequeño» es mañana/);
  assert.equal(reminder.length, 1);
  assert.match(reminder[0].text, /20 de diciembre de 2026 · 20:00 h/);
  const outbox = (await f.get('admin/outbox', admin.cookie)).body.messages;
  assert.ok(outbox.some(m => m.kind === 'recordatorio' && m.status === 'enviado'));
});

test('T10.9 an organizer cannot open or act on another organizer’s event, even by changing the URL', async t => {
  const f = await fixture(t), admin = await f.admin(), owner = await f.organizer(admin.cookie, 'owner@example.com'), rival = await f.organizer(admin.cookie, 'rival@example.com');
  const staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(owner.cookie, admin.cookie);
  await f.assign(owner.cookie, staff.id, eventId);
  const order = await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 1 });
  await f.scan(staff.cookie, order.tickets[0].code, eventId);
  assert.equal((await f.get(`organizer/events/${eventId}/report`, owner.cookie)).status, 200);
  assert.equal((await f.get(`organizer/events/${eventId}/report`, rival.cookie)).status, 403);
  assert.equal((await f.raw(`organizer/events/${eventId}/report.csv`, rival.cookie)).status, 403);
  assert.equal((await f.assign(rival.cookie, staff.id, eventId)).status, 403);
  assert.equal((await f.request(`events/${eventId}/functions/1/reschedule`, { date: '2026-12-30', hour: '20:00', reason: 'x' }, rival.cookie)).status, 403);
  assert.equal((await f.request(`events/${eventId}/cancel-request`, { reason: 'x' }, rival.cookie)).status, 403);
  assert.equal((await f.request(`tickets/${order.tickets[0].id}/revert-scan`, { reason: 'x' }, rival.cookie)).status, 403);
  assert.equal((await f.get(`organizer/events/${eventId}/report`, buyer.cookie)).status, 403);
  assert.equal((await f.get(`organizer/events/${eventId}/report`, admin.cookie)).status, 200);
  for (const path of ['admin/reports/ventas', 'admin/audit', 'admin/outbox', 'admin/refunds', 'admin/cancellations', 'admin/settings']) {
    assert.equal((await f.get(path, rival.cookie)).status, 403, path);
    assert.equal((await f.get(path, staff.cookie)).status, 403, path);
  }
});
