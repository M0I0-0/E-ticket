import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, CODE, HOUR, DAY } from './test-helpers.js';

const EVENT1_START = new Date('2026-11-14T20:00:00').getTime();

test('T11.1 and T11.2 a transfer gives the new owner a new QR, kills the old one and e-mails the recipient', async t => {
  const f = await fixture(t), admin = await f.admin(), staff = await f.staff(admin.cookie, 'gate@example.com');
  const ana = await f.register('ana@example.com', 'Ana'), beto = await f.register('beto@example.com', 'Beto');
  await f.assign(admin.cookie, staff.id, 1);
  const order = await f.buy(ana.cookie, { seats: ['A5'] });
  const [ticket] = (await f.get('tickets', ana.cookie)).body.tickets;
  assert.equal(ticket.transferable, true);
  assert.equal((await f.request(`tickets/${ticket.id}/transfer`, { email: 'nadie@example.com' }, ana.cookie)).status, 404);
  assert.equal((await f.request(`tickets/${ticket.id}/transfer`, { email: 'ana@example.com' }, ana.cookie)).status, 400);
  assert.equal((await f.request(`tickets/${ticket.id}/transfer`, { email: 'BETO@example.com' }, beto.cookie)).status, 404);
  const done = await f.request(`tickets/${ticket.id}/transfer`, { email: 'BETO@example.com' }, ana.cookie);
  assert.equal(done.status, 200);
  assert.deepEqual((await f.get('tickets', ana.cookie)).body.tickets, []);
  const [received] = (await f.get('tickets', beto.cookie)).body.tickets;
  assert.equal(received.seat, 'A5');
  assert.equal(received.owner, 'Beto Uno Dos');
  assert.match(received.code, CODE);
  assert.notEqual(received.code, order.tickets[0].code);
  const old = (await f.scan(staff.cookie, order.tickets[0].code)).body;
  assert.equal(old.result, 'invalid');
  assert.match(old.reason, /transferido/);
  assert.equal((await f.scan(staff.cookie, received.code)).body.result, 'valid');
  const history = (await f.get('orders', ana.cookie)).body.orders[0];
  assert.equal(history.tickets[0].transferred, true);
  assert.equal(history.tickets[0].code, '');
  await f.flush();
  const mail = f.messages.find(m => m.to === 'beto@example.com' && /te transfirió un boleto/.test(m.subject));
  assert.ok(mail);
  assert.equal(mail.attachments.length, 1);
  assert.ok(f.messages.some(m => m.to === 'ana@example.com' && /Transferiste tu boleto/.test(m.subject)));
});

test('T11.1 the transfer option disappears 24 hours before the event', async t => {
  const f = await fixture(t), ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  await f.buy(ana.cookie, { seats: ['A6'] });
  f.setNow(EVENT1_START - 25 * HOUR);
  assert.equal((await f.get('tickets', ana.cookie)).body.tickets[0].transferable, true);
  f.setNow(EVENT1_START - 23 * HOUR);
  const [ticket] = (await f.get('tickets', ana.cookie)).body.tickets;
  assert.equal(ticket.transferable, false);
  const late = await f.request(`tickets/${ticket.id}/transfer`, { email: 'beto@example.com' }, ana.cookie);
  assert.equal(late.status, 409);
  assert.match(late.body.error, /24 horas/);
});

async function eventWithThreeOrders(f, lastCard = '4242') {
  const admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), staff = await f.staff(admin.cookie, 'gate@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: 'Festival cancelable' });
  await f.assign(org.cookie, staff.id, eventId);
  const buyers = [await f.register('b1@example.com'), await f.register('b2@example.com'), await f.register('b3@example.com')];
  const orders = [
    await f.buy(buyers[0].cookie, { eventId, zone: 'General', quantity: 1 }),
    await f.buy(buyers[1].cookie, { eventId, zone: 'General', quantity: 2 }),
    await f.buy(buyers[2].cookie, { eventId, zone: 'General', quantity: 1, last4: lastCard }),
  ];
  return { admin, org, staff, eventId, buyers, orders };
}

test('T11.3 and T11.4 an event is only cancelled with the administrator’s approval, and every order is refunded in full', async t => {
  const f = await fixture(t), { admin, org, staff, eventId, buyers, orders } = await eventWithThreeOrders(f);
  assert.equal((await f.request(`events/${eventId}/cancel-request`, { reason: 'x' }, buyers[0].cookie)).status, 403);
  assert.equal((await f.request(`events/${eventId}/cancel-request`, {}, org.cookie)).status, 400);
  assert.equal((await f.request(`events/${eventId}/cancel-request`, { reason: 'Lluvia intensa' }, org.cookie)).status, 200);
  assert.equal((await f.request(`events/${eventId}/cancel-request`, { reason: 'Otra vez' }, org.cookie)).status, 409);
  // Requested is not cancelled: the event is still on sale and its tickets still work.
  assert.ok((await f.get('events')).body.events.some(e => String(e.id) === String(eventId)));
  const pending = (await f.get('admin/cancellations', admin.cookie)).body.cancellations[0];
  assert.equal(pending.status, 'requested');
  assert.equal(pending.orders, 3);
  assert.equal((await f.request(`admin/cancellations/${pending.id}/decision`, { approve: true }, org.cookie)).status, 403);
  const decision = (await f.request(`admin/cancellations/${pending.id}/decision`, { approve: true, reason: 'Aprobada' }, admin.cookie)).body;
  assert.deepEqual([decision.orders, decision.refunded, decision.failed, decision.tickets], [3, 3, 0, 4]);
  for (const [i, buyer] of buyers.entries()) {
    const order = (await f.get('orders', buyer.cookie)).body.orders[0];
    assert.equal(order.refunded, orders[i].total);
    assert.equal(order.status, 'refunded');
    assert.equal(order.tickets.every(ticket => ticket.status === 'cancelled'), true);
  }
  // 2 × $200 + 10 % service fee + 16 % VAT = $510.40, refunded in full.
  assert.equal(orders[1].total, 510.4);
  const cancelled = (await f.scan(staff.cookie, orders[0].tickets[0].code, eventId)).body;
  assert.equal(cancelled.result, 'invalid');
  assert.match(cancelled.reason, /cancelado/);
  assert.ok(!(await f.get('events')).body.events.some(e => String(e.id) === String(eventId)));
  assert.equal((await f.request('holds', { eventId, functionId: '1', zone: 'General', quantity: 1 }, buyers[0].cookie)).status, 404);
  await f.flush();
  for (const buyer of buyers) assert.ok(f.messages.some(m => m.to === buyer.email && /Se canceló Festival cancelable/.test(m.subject) && /100 %/.test(m.text)));
  const actions = (await f.get('admin/audit', admin.cookie)).body.entries.map(e => e.action);
  assert.ok(actions.includes('cancelacion.solicitada') && actions.includes('cancelacion.aprobada'));
  assert.equal(actions.filter(a => a === 'reembolso.emitido').length, 3);
});

test('T11.5 refunds the gateway rejects are listed with order, amount and reason until the administrator resolves them', async t => {
  const f = await fixture(t), { admin, org, eventId, orders } = await eventWithThreeOrders(f, '0069');
  await f.request(`events/${eventId}/cancel-request`, { reason: 'Recinto no disponible' }, org.cookie);
  const pending = (await f.get('admin/cancellations', admin.cookie)).body.cancellations[0];
  const decision = (await f.request(`admin/cancellations/${pending.id}/decision`, { approve: true }, admin.cookie)).body;
  assert.equal(decision.failed, 1);
  const [failed] = (await f.get('admin/refunds?status=failed', admin.cookie)).body.refunds;
  assert.equal(failed.orderId, orders[2].id);
  assert.equal(failed.amount, orders[2].total);
  assert.match(failed.error, /rechazó el reembolso/);
  assert.equal(failed.buyer, 'b3@example.com');
  assert.equal((await f.request(`admin/refunds/${failed.id}/retry`, {}, admin.cookie)).status, 502);
  assert.equal((await f.request(`admin/refunds/${failed.id}/resolve`, {}, admin.cookie)).status, 400);
  assert.equal((await f.request(`admin/refunds/${failed.id}/resolve`, { notes: 'Transferencia SPEI manual' }, admin.cookie)).status, 200);
  assert.deepEqual((await f.get('admin/refunds?status=failed', admin.cookie)).body.refunds, []);
  assert.equal((await f.get('admin/refunds?status=resolved', admin.cookie)).body.refunds[0].notes, 'Transferencia SPEI manual');
});

test('T11.6 a date change e-mails the holders and opens a 10-day refund window', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: 'Obra reprogramada', functions: [{ id: '1', date: '2026-12-20', hour: '20:00' }] });
  const ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  await f.buy(ana.cookie, { eventId, zone: 'General', quantity: 1 });
  await f.buy(beto.cookie, { eventId, zone: 'General', quantity: 2 });
  assert.equal((await f.get('tickets', ana.cookie)).body.tickets[0].refundUntil, null);
  assert.equal((await f.request(`events/${eventId}/functions/1/reschedule`, { date: '2026-12-27', hour: '19:00' }, org.cookie)).status, 400);
  const moved = await f.request(`events/${eventId}/functions/1/reschedule`, { date: '2026-12-27', hour: '19:00', reason: 'Cambio de sede' }, org.cookie);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.notified, 2);
  await f.flush();
  assert.ok(f.messages.some(m => m.to === 'ana@example.com' && /Cambió la fecha de Obra reprogramada/.test(m.subject) && /27 de diciembre de 2026/.test(m.text)));
  const [anaTicket] = (await f.get('tickets', ana.cookie)).body.tickets;
  assert.equal(anaTicket.date, '2026-12-27');
  assert.ok(anaTicket.refundUntil > f.clock.now);
  assert.equal((await f.request(`tickets/${anaTicket.id}/refund-request`, {}, ana.cookie)).status, 200);
  assert.equal((await f.get('tickets', ana.cookie)).body.tickets[0].status, 'refunded');
  f.advance(10 * DAY + 1);
  const late = (await f.get('tickets', beto.cookie)).body.tickets[0];
  assert.equal(late.refundUntil, null);
  assert.equal((await f.request(`tickets/${late.id}/refund-request`, {}, beto.cookie)).status, 409);
});

test('T11.7 refunding 1 of 4 tickets frees its seat and only that QR stops working', async t => {
  const f = await fixture(t), admin = await f.admin(), staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  await f.assign(admin.cookie, staff.id, 1);
  const order = await f.buy(buyer.cookie, { seats: ['A5', 'A6', 'A7', 'A8'] });
  const target = order.tickets.find(ticket => ticket.seat === 'A6');
  assert.equal((await f.request(`admin/tickets/${target.id}/refund`, { reason: 'Prueba' }, buyer.cookie)).status, 403);
  const refund = (await f.request(`admin/tickets/${target.id}/refund`, { reason: 'Pidió reembolso por enfermedad' }, admin.cookie)).body;
  assert.equal(refund.amount, target.price);
  const occupied = (await f.get('availability?eventId=1&functionId=1&zone=Preferente')).body.occupied;
  assert.ok(!occupied.includes('A6'));
  assert.ok(['A5', 'A7', 'A8'].every(seat => occupied.includes(seat)));
  assert.match((await f.scan(staff.cookie, target.code)).body.reason, /reembolsado/);
  assert.equal((await f.scan(staff.cookie, order.tickets[0].code)).body.result, 'valid');
  const view = (await f.get(`admin/orders/${order.id.toLowerCase()}`, admin.cookie)).body.order;
  assert.equal(view.refunded, target.price);
  assert.equal(view.status, 'partially_refunded');
  assert.equal(view.tickets.filter(ticket => ticket.status === 'refunded').length, 1);
  const other = await f.register('other@example.com');
  assert.equal((await f.hold(other.cookie, { seats: ['A6'] })).status, 201);
});

test('T11.8 a sold-out event goes back on sale as soon as a place is freed', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: 'Íntimo', zones: [{ name: 'General', type: 'general', price: 100, capacity: 2, seats: [], accessible: [] }] });
  const buyer = await f.register('buyer@example.com');
  const order = await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 2 });
  const soldOut = (await f.get('events')).body.availability[eventId];
  assert.deepEqual([soldOut.soldOut, soldOut.available], [true, 0]);
  await f.request(`admin/tickets/${order.tickets[0].id}/refund`, { reason: 'Liberar lugar' }, admin.cookie);
  const onSale = (await f.get('events')).body.availability[eventId];
  assert.deepEqual([onSale.soldOut, onSale.available], [false, 1]);
});
