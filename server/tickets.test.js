import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, CODE } from './test-helpers.js';

test('T09.1 / RN-13 an order of 4 seats issues 4 tickets with distinct, unguessable codes and QR', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  const order = await f.buy(buyer.cookie, { seats: ['A1', 'A2', 'B1', 'B2'] });
  assert.equal(order.tickets.length, 4);
  const codes = order.tickets.map(ticket => ticket.code);
  assert.equal(new Set(codes).size, 4);
  for (const code of codes) {
    assert.match(code, CODE);
    assert.ok(!code.includes(order.id));
  }
  const mine = (await f.get('tickets', buyer.cookie)).body.tickets;
  assert.equal(mine.length, 4);
  const svgs = await Promise.all(mine.map(ticket => f.raw(`tickets/${ticket.id}/qr.svg`, buyer.cookie)));
  for (const svg of svgs) {
    assert.equal(svg.status, 200);
    assert.match(svg.type, /^image\/svg\+xml/);
  }
  assert.equal(new Set(svgs.map(svg => svg.text)).size, 4);
});

test('T09.2 and T09.3 a ticket PDF downloads again at any time and the receipt e-mail carries one PDF per ticket', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com'), other = await f.register('other@example.com');
  const order = await f.buy(buyer.cookie, { seats: ['C1', 'C3'] });
  const [first] = (await f.get('tickets', buyer.cookie)).body.tickets;
  assert.equal(first.statusLabel, 'Vigente');
  for (let i = 0; i < 2; i++) {
    const pdf = await f.raw(`tickets/${first.id}/pdf`, buyer.cookie);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.type, 'application/pdf');
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.disposition, /^attachment; filename="boleto-/);
  }
  assert.equal((await f.raw(`tickets/${first.id}/pdf`, other.cookie)).status, 404);
  assert.equal((await f.raw(`tickets/${first.id}/pdf`)).status, 401);
  await f.flush();
  const mail = f.messages.find(m => m.to === 'buyer@example.com' && m.subject.startsWith('Tus boletos'));
  assert.ok(mail, 'confirmation e-mail');
  assert.match(mail.text, new RegExp(order.id));
  assert.match(mail.text, /Total cobrado: \$1,148\.40/);
  assert.equal(mail.attachments.length, 2);
  for (const file of mail.attachments) {
    assert.equal(file.contentType, 'application/pdf');
    assert.equal(file.content.subarray(0, 5).toString(), '%PDF-');
  }
});

test('T09.4 staff sign in and only see the events and functions assigned to them', async t => {
  const f = await fixture(t), admin = await f.admin(), staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  assert.deepEqual((await f.get('staff/assignments', staff.cookie)).body.assignments, []);
  assert.equal((await f.assign(admin.cookie, staff.id, 1)).status, 200);
  const list = (await f.get('staff/assignments', staff.cookie)).body.assignments;
  assert.deepEqual(list.map(a => [a.eventId, a.functionId, a.eventName]), [['1', '1', 'Ecos de medianoche']]);
  const order = await f.buy(buyer.cookie, { eventId: 2, zone: 'Luneta', seats: ['A1'] });
  assert.equal((await f.scan(staff.cookie, order.tickets[0].code, 2)).status, 403);
  assert.equal((await f.get('staff/assignments', buyer.cookie)).status, 403);
  assert.equal((await f.assign(admin.cookie, buyer.id, 1)).status, 400);
});

test('T09.6, T09.7 and T09.10 each scan shows the right colour and reason, typed or scanned', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { functions: [{ id: 'matinee', date: '2026-12-20', hour: '15:00' }, { id: 'evening', date: '2026-12-20', hour: '20:00' }] });
  assert.equal((await f.assign(org.cookie, staff.id, eventId, 'matinee')).status, 200);
  const matinee = await f.buy(buyer.cookie, { eventId, functionId: 'matinee', zone: 'General', quantity: 3 });
  const evening = await f.buy(buyer.cookie, { eventId, functionId: 'evening', zone: 'General', quantity: 1 });
  const other = await f.buy(buyer.cookie, { seats: ['D3'] });
  const [a, b, c] = matinee.tickets;

  const green = (await f.scan(staff.cookie, a.code, eventId, 'matinee', 'Puerta 2')).body;
  assert.equal(green.result, 'valid');
  assert.equal(green.title, 'Acceso válido');
  assert.deepEqual(green.counter, { entered: 1, sold: 3 });
  const again = (await f.scan(staff.cookie, a.code, eventId, 'matinee', 'Puerta 3')).body;
  assert.equal(again.result, 'used');
  assert.equal(again.title, 'Ya utilizado');
  assert.equal(again.usedGate, 'Puerta 2');
  assert.match(again.reason, /Puerta 2/);

  // T09.7: typed by hand in lower case, without dashes, the result is the same as the scanner.
  const typed = (await f.scan(staff.cookie, ` ${b.code.replace(/-/g, '').toLowerCase()} `, eventId, 'matinee')).body;
  assert.equal(typed.result, 'valid');
  assert.equal((await f.scan(staff.cookie, `ETICKET:${b.code.replace(/-/g, '')}`, eventId, 'matinee')).body.result, 'used');

  const otherFunction = (await f.scan(staff.cookie, evening.tickets[0].code, eventId, 'matinee')).body;
  assert.equal(otherFunction.result, 'invalid');
  assert.match(otherFunction.reason, /otra función/);
  const otherEvent = (await f.scan(staff.cookie, other.tickets[0].code, eventId, 'matinee')).body;
  assert.equal(otherEvent.result, 'invalid');
  assert.match(otherEvent.reason, /otro evento: Ecos de medianoche/);
  const missing = (await f.scan(staff.cookie, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', eventId, 'matinee')).body;
  assert.equal(missing.result, 'invalid');
  assert.match(missing.reason, /no existe/);
  assert.equal((await f.request(`admin/tickets/${c.id}/refund`, { reason: 'Prueba' }, admin.cookie)).status, 200);
  const refunded = (await f.scan(staff.cookie, c.code, eventId, 'matinee')).body;
  assert.equal(refunded.result, 'invalid');
  assert.match(refunded.reason, /reembolsado/);

  assert.deepEqual((await f.get(`staff/counter/${eventId}/matinee`, staff.cookie)).body, { entered: 2, sold: 2 });
});

test('T09.8 two simultaneous scans of the same QR give exactly one green and one red', async t => {
  const f = await fixture(t), admin = await f.admin(), staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  await f.assign(admin.cookie, staff.id, 1);
  const order = await f.buy(buyer.cookie, { seats: ['B4'] });
  const results = await Promise.all([f.scan(staff.cookie, order.tickets[0].code), f.scan(staff.cookie, order.tickets[0].code, 1, '1', 'Puerta 2')]);
  assert.deepEqual(results.map(r => r.body.result).sort(), ['used', 'valid']);
  const db = f.db();
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scans WHERE result='valid'").get().n, 1);
  } finally { db.close(); }
});

test('T09.9 the organizer reverts a mistaken scan, the ticket is valid again and the audit log shows who did it', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), rival = await f.organizer(admin.cookie, 'rival@example.com');
  const staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie);
  await f.assign(org.cookie, staff.id, eventId);
  const order = await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 1 });
  const ticket = order.tickets[0];
  assert.equal((await f.scan(staff.cookie, ticket.code, eventId)).body.result, 'valid');
  assert.equal((await f.request(`tickets/${ticket.id}/revert-scan`, { reason: 'Error' }, rival.cookie)).status, 403);
  assert.equal((await f.request(`tickets/${ticket.id}/revert-scan`, { reason: 'Error' }, staff.cookie)).status, 403);
  assert.equal((await f.request(`tickets/${ticket.id}/revert-scan`, {}, org.cookie)).status, 400);
  assert.equal((await f.request(`tickets/${ticket.id}/revert-scan`, { reason: 'Se escaneó dos veces por error' }, org.cookie)).status, 200);
  assert.equal((await f.scan(staff.cookie, ticket.code, eventId)).body.result, 'valid');
  const entry = (await f.get('admin/audit?action=escaneo.revertido', admin.cookie)).body.entries[0];
  assert.equal(entry.actorEmail, 'org@example.com');
  assert.match(entry.details, /Se escaneó dos veces por error/);
  const report = (await f.get(`organizer/events/${eventId}/report`, org.cookie)).body;
  assert.ok(report.scans.some(s => s.result === 'reverted'));
});
