// Regression tests for the QA review of 2026-10-18: each test names the problem it guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, HOUR } from './test-helpers.js';
import { smtpOptions } from './mailer.js';

const person = (email, password = 'MiClave123!') => ({ email, firstNames: 'Prueba', paternalSurname: 'Uno', maternalSurname: 'Dos', password, confirmPassword: password });
const lastCode = (f, email) => f.messages.filter(m => m.to === email).at(-1).text.match(/\d{6}/)[0];
const charge = (f, cookie, holdId, last4 = '4242') => f.request('payments/charge', { holdId, token: `tok_qa_${holdId}_${last4}`, last4, brand: 'VISA', idempotencyKey: `ik-qa-${holdId}-${last4}-${Math.random()}` }, cookie);

test('QA: activity renews the session cookie, background polling does not', async t => {
  const f = await fixture(t), user = await f.register('activa@example.com');
  const active = await f.request('tickets', null, user.cookie, 'GET');
  assert.match(active.setCookie, /eticket_session=.+Max-Age=1800/);
  const polling = await f.request('holds/current', null, user.cookie, 'GET', { 'X-Eticket-Background': '1' });
  assert.equal(polling.setCookie, null);
});

test('QA: signing in and out many times is never limited, failed attempts are', async t => {
  const f = await fixture(t);
  await f.register('demo@example.com');
  for (let i = 0; i < 25; i++) {
    const login = await f.request('auth/login', { email: 'demo@example.com', password: 'MiClave123!' });
    assert.equal(login.status, 200);
    assert.equal((await f.request('auth/logout', {}, login.cookie)).status, 200);
  }
  // The registration sent one code; 39 failures more reach the limit of 40.
  for (let i = 0; i < 39; i++) assert.equal((await f.request('auth/login', { email: 'nadie@example.com', password: 'Otra123!' })).status, 401);
  const limited = await f.request('auth/login', { email: 'demo@example.com', password: 'MiClave123!' });
  assert.equal(limited.status, 429);
  assert.equal((await f.request('auth/logout', {}, '')).status, 200);
});

test('QA: without e-mail the registration saves nothing, and an unverified one can be redone', async t => {
  const none = await fixture(t, { transport: null });
  const refused = await none.request('auth/register', person('nueva@example.com'));
  assert.equal(refused.status, 503);
  assert.match(refused.body.error, /SMTP/);
  const db = none.db();
  try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email='nueva@example.com'").get().n, 0); } finally { db.close(); }

  const f = await fixture(t);
  assert.equal((await f.request('auth/register', person('nueva@example.com', 'Primera1!'))).status, 201);
  assert.equal((await f.request('auth/register', person('nueva@example.com', 'Segunda2!'))).status, 201);
  assert.equal((await f.request('auth/verify', { email: 'nueva@example.com', code: lastCode(f, 'nueva@example.com') })).status, 200);
  assert.equal((await f.request('auth/login', { email: 'nueva@example.com', password: 'Primera1!' })).status, 401);
  assert.equal((await f.request('auth/login', { email: 'nueva@example.com', password: 'Segunda2!' })).status, 200);
  assert.equal((await f.request('auth/register', person('nueva@example.com', 'Tercera3!'))).status, 409);
});

test('QA: npm start without SMTP prints the code in the terminal and never stores it', async t => {
  const lines = [], f = await fixture(t, { transport: null, devMail: true, log: line => lines.push(line) });
  const registered = await f.request('auth/register', person('local@example.com'));
  assert.equal(registered.status, 201);
  assert.equal(registered.body.codeInConsole, true);
  const code = lines.join('\n').match(/local@example\.com: el código es (\d{6})/)[1];
  assert.equal((await f.request('auth/verify', { email: 'local@example.com', code })).status, 200);
  const db = f.db();
  try {
    const row = db.prepare("SELECT body, status FROM outbox WHERE to_email='local@example.com'").get();
    assert.equal(row.status, 'sin SMTP');
    assert.ok(!row.body.includes(code));
  } finally { db.close(); }
});

test('QA: five wrong codes cancel the code, and a new one works', async t => {
  const f = await fixture(t);
  await f.request('auth/register', person('codigo@example.com'));
  const right = lastCode(f, 'codigo@example.com'), wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await f.request('auth/verify', { email: 'codigo@example.com', code: wrong })).status, 400);
  assert.equal((await f.request('auth/verify', { email: 'codigo@example.com', code: right })).status, 429);
  assert.equal((await f.request('auth/resend', { email: 'codigo@example.com' })).status, 200);
  assert.equal((await f.request('auth/verify', { email: 'codigo@example.com', code: lastCode(f, 'codigo@example.com') })).status, 200);
});

test('QA: an unverified login can resend its code, and resend does not reveal which addresses exist', async t => {
  const f = await fixture(t);
  await f.request('auth/register', person('pendiente@example.com'));
  const login = await f.request('auth/login', { email: 'pendiente@example.com', password: 'MiClave123!' });
  assert.equal(login.status, 403);
  assert.equal(login.body.unverified, true);
  const before = f.messages.length;
  assert.equal((await f.request('auth/resend', { email: 'nadie@example.com' })).status, 200);
  assert.equal(f.messages.length, before);
  assert.equal((await f.request('auth/resend', { email: 'pendiente@example.com' })).status, 200);
  assert.equal(f.messages.length, before + 1);
});

test('QA: a password reset checks the confirmation and also verifies the account', async t => {
  const f = await fixture(t);
  await f.request('auth/register', person('olvido@example.com'));
  assert.equal((await f.request('auth/forgot', { email: 'olvido@example.com' })).status, 200);
  const code = lastCode(f, 'olvido@example.com');
  assert.equal((await f.request('auth/reset', { email: 'olvido@example.com', code, password: 'Nueva123!', confirmPassword: 'Distinta1!' })).status, 400);
  assert.equal((await f.request('auth/reset', { email: 'olvido@example.com', code, password: 'Nueva123!', confirmPassword: 'Nueva123!' })).status, 200);
  assert.equal((await f.request('auth/login', { email: 'olvido@example.com', password: 'Nueva123!' })).status, 200);
});

test('QA: the fifth failed login already says the account is locked', async t => {
  const f = await fixture(t);
  await f.register('candado@example.com');
  for (let i = 0; i < 4; i++) assert.equal((await f.request('auth/login', { email: 'candado@example.com', password: 'Mala123!' })).status, 401);
  const fifth = await f.request('auth/login', { email: 'candado@example.com', password: 'Mala123!' });
  assert.equal(fifth.status, 423);
  assert.match(fifth.body.error, /15 minutos/);
});

test('QA: an Origin of null is refused with 403 instead of failing', async t => {
  const f = await fixture(t), user = await f.register('origen@example.com');
  const refused = await f.request('holds', { eventId: 1, functionId: '1', zone: 'Preferente', seats: ['B2'] }, user.cookie, 'POST', { Origin: 'null' });
  assert.equal(refused.status, 403);
  assert.equal((await f.hold(user.cookie, { seats: ['B2'] })).status, 201);
});

test('QA: a purchase is not frozen when its event stopped selling before the payment', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie);
  const hold = (await f.hold(buyer.cookie, { eventId, zone: 'General', quantity: 2 })).body.hold;
  const db = f.db();
  try { db.prepare("UPDATE events SET status='draft' WHERE id=?").run(eventId); } finally { db.close(); }
  assert.equal((await charge(f, buyer.cookie, hold.id)).status, 404);
  assert.equal((await f.get('holds/current', buyer.cookie)).body.hold.status, 'active');
  assert.equal((await f.request(`holds/${hold.id}/cancel`, {}, buyer.cookie)).status, 200);
});

test('QA: an approved charge without tickets (card 9999) closes the purchase, so a retry cannot charge twice', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  const hold = (await f.hold(buyer.cookie, { seats: ['C1'] })).body.hold;
  const orphan = await charge(f, buyer.cookie, hold.id, '9999');
  assert.equal(orphan.body.status, 'orphan_payment');
  const current = (await f.get('holds/current', buyer.cookie)).body;
  assert.equal(current.hold, null);
  assert.equal(current.recent.status, 'cancelled');
  assert.ok(!(await f.get('availability?eventId=1&functionId=1&zone=Preferente')).body.occupied.includes('C1'));
  assert.equal((await charge(f, buyer.cookie, hold.id)).status, 409);
  const db = f.db();
  try { assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status='approved'").get().n, 1); } finally { db.close(); }
});

test('QA: resolving a failed refund invalidates the ticket, frees the seat and counts the money', async t => {
  const f = await fixture(t), admin = await f.admin(), buyer = await f.register('buyer@example.com');
  const order = await f.buy(buyer.cookie, { seats: ['D3'], last4: '0069' });
  const ticket = order.tickets[0];
  assert.equal((await f.request(`admin/tickets/${ticket.id}/refund`, { reason: 'Prueba' }, admin.cookie)).status, 502);
  const [failed] = (await f.get('admin/refunds?status=failed', admin.cookie)).body.refunds;
  assert.equal((await f.request(`admin/refunds/${failed.id}/resolve`, { notes: 'Transferencia SPEI' }, admin.cookie)).status, 200);
  assert.equal((await f.get('tickets', buyer.cookie)).body.tickets[0].status, 'refunded');
  const view = (await f.get(`admin/orders/${order.id}`, admin.cookie)).body.order;
  assert.deepEqual([view.refunded, view.status], [ticket.price, 'refunded']);
  assert.ok(!(await f.get('availability?eventId=1&functionId=1&zone=Preferente')).body.occupied.includes('D3'));
  await f.flush();
  assert.ok(f.messages.some(m => m.to === 'buyer@example.com' && /Atendimos tu reembolso/.test(m.subject) && /Transferencia SPEI/.test(m.text)));
});

test('QA: the administrator cancels an event directly and its organizer is told', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: 'Gala cancelada' });
  const order = await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 2 });
  assert.equal((await f.request(`admin/events/${eventId}/cancel`, {}, admin.cookie)).status, 400);
  assert.equal((await f.request(`admin/events/${eventId}/cancel`, { reason: 'x' }, org.cookie)).status, 403);
  const done = (await f.request(`admin/events/${eventId}/cancel`, { reason: 'Fraude del organizador' }, admin.cookie)).body;
  assert.deepEqual([done.status, done.refunded, done.tickets], ['approved', 1, 2]);
  assert.equal((await f.get('orders', buyer.cookie)).body.orders[0].refunded, order.total);
  assert.ok(!(await f.get('events')).body.events.some(e => String(e.id) === String(eventId)));
  assert.equal((await f.request('admin/events/1/cancel', { reason: 'x' }, admin.cookie)).status, 404);
  await f.flush();
  assert.ok(f.messages.some(m => m.to === 'org@example.com' && /La administración canceló Gala cancelada/.test(m.subject)));
});

test('QA: a published event keeps selling while its texts change; name, zones and dates stay', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: 'Sigue a la venta' });
  const edited = await f.request('events', { id: eventId, desc: 'Ahora con invitados', artist: 'Otro artista', ticketLimit: 4 }, org.cookie);
  assert.deepEqual(edited.body, { id: eventId, status: 'published' });
  const listed = (await f.get('events')).body.events.find(e => String(e.id) === String(eventId));
  assert.deepEqual([listed.desc, listed.artist, listed.ticketLimit, listed.status], ['Ahora con invitados', 'Otro artista', 4, 'published']);
  assert.equal((await f.request('events', { id: eventId, name: 'Otro nombre' }, org.cookie)).status, 409);
  assert.equal((await f.request('events', { id: eventId, functions: [{ id: '1', date: '2026-12-21', hour: '20:00' }] }, org.cookie)).status, 409);
  assert.equal((await f.request(`events/${eventId}/submit`, {}, org.cookie)).status, 409);
  assert.equal((await f.request(`events/${eventId}/delete`, {}, org.cookie)).status, 409);
  assert.equal((await f.request('events', { id: '999', name: 'Ajeno' }, org.cookie)).status, 404);
});

test('QA: an event is only saved with future dates and a seat map that can be sold', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const base = { name: 'Teatro', artist: 'A', category: 'Teatro', city: 'Mérida', venue: 'Foro', functions: [{ id: '1', date: '2026-12-20', hour: '20:00' }], ticketLimit: 6 };
  const rows = (count, perRow) => Array.from({ length: count }, (_, i) => `${i < 26 * perRow ? String.fromCharCode(65 + Math.floor(i / perRow)) : 'A' + String.fromCharCode(65 + Math.floor(i / perRow) - 26)}${i % perRow + 1}`);
  const save = overrides => f.request('events', { ...base, ...overrides }, org.cookie);
  const zone = (seats, extra = {}) => ({ name: 'Platea', type: 'seat', price: 300, capacity: seats.length, seats, accessible: [], ...extra });
  assert.equal((await save({ functions: [{ id: '1', date: '2026-10-01', hour: '20:00' }], zones: [zone(rows(8, 8))] })).status, 400);
  assert.equal((await save({ functions: [{ id: '1', date: '2026-02-30', hour: '20:00' }], zones: [zone(rows(8, 8))] })).status, 400);
  assert.equal((await save({ zones: [zone(['[1', '\\1'])] })).status, 400);
  assert.equal((await save({ zones: [{ ...zone(rows(8, 8)), capacity: 4 }] })).status, 400);
  assert.equal((await save({ zones: [zone(rows(8, 8), { blockedSeats: ['Z9'] })] })).status, 400);
  // 30 rows of 50 seats: rows after Z are AA, AB… and the whole map fits in one request.
  const big = rows(1500, 50);
  assert.ok(big.includes('AD50'));
  const saved = await save({ zones: [zone(big)] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  await f.request(`events/${saved.body.id}/submit`, {}, org.cookie);
  assert.equal((await f.request(`events/${saved.body.id}/decision`, { approve: true }, admin.cookie)).status, 200);
  const buyer = await f.register('buyer@example.com');
  assert.equal((await f.hold(buyer.cookie, { eventId: saved.body.id, zone: 'Platea', seats: ['AD50'] })).status, 201);
});

test('QA: functions that already started are not sold and the listing marks them as past', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  f.setNow(new Date('2026-11-14T20:00:00').getTime());
  const late = await f.hold(buyer.cookie, { seats: ['B2'] });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /ya comenzó/);
  const status = (await f.get('events')).body.availability['1'];
  assert.deepEqual([status.past, status.functions['1'].past], [true, true]);
  assert.equal((await f.get('events')).body.availability['2'].past, false);
});

test('QA: places that are only held show as held, not as sold out', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { zones: [{ name: 'General', type: 'general', price: 100, capacity: 2, seats: [], accessible: [] }] });
  await f.hold(buyer.cookie, { eventId, zone: 'General', quantity: 2 });
  const status = (await f.get('events')).body.availability[eventId];
  assert.deepEqual([status.soldOut, status.heldOut, status.available], [false, true, 0]);
});

test('QA: tickets bought after a date change do not get the 10-day refund', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie);
  const before = await f.register('antes@example.com'), after = await f.register('despues@example.com');
  await f.buy(before.cookie, { eventId, zone: 'General', quantity: 1 });
  f.advance(HOUR);
  assert.equal((await f.request(`events/${eventId}/functions/1/reschedule`, { date: '2026-12-27', hour: '19:00', reason: 'Lluvia' }, org.cookie)).status, 200);
  f.advance(HOUR);
  await f.buy(after.cookie, { eventId, zone: 'General', quantity: 1 });
  assert.ok((await f.get('tickets', before.cookie)).body.tickets[0].refundUntil > f.clock.now);
  const late = (await f.get('tickets', after.cookie)).body.tickets[0];
  assert.equal(late.refundUntil, null);
  assert.equal((await f.request(`tickets/${late.id}/refund-request`, {}, after.cookie)).status, 409);
});

test('QA: report CSV cells that look like formulas stay as text', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), buyer = await f.register('buyer@example.com');
  const eventId = await f.publish(org.cookie, admin.cookie, { name: '=HYPERLINK("http://x.test","clic")' });
  await f.buy(buyer.cookie, { eventId, zone: 'General', quantity: 1 });
  const csv = await f.raw(`admin/reports/eventos.csv?from=2026-10-01&to=2026-10-31`, admin.cookie);
  assert.match(csv.text, /"'=HYPERLINK\(""http:\/\/x\.test"",""clic""\)"/);
});

test('QA: organizer requests are answered by e-mail, and the administrator can remove the role', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com');
  await f.flush();
  assert.ok(f.messages.some(m => m.to === 'org@example.com' && /Ya eres organizador/.test(m.subject)));
  assert.equal((await f.request('admin/users', { userId: org.id, role: 'comprador' }, admin.cookie, 'PUT')).status, 200);
  const me = (await f.get('auth/me', org.cookie)).body.user;
  assert.deepEqual([me.role, me.organizerStatus], ['comprador', 'none']);
  assert.equal((await f.request('events', { name: 'x', zones: [] }, org.cookie)).status, 403);
  assert.equal((await f.request('auth/organizer-request', {}, org.cookie)).status, 200);
});

test('QA: venues can be edited and deleted, and their rows must match their capacity', async t => {
  const f = await fixture(t), admin = await f.admin();
  const created = await f.request('venues', { name: 'Teatro', city: 'Mérida', zones: [{ name: 'Platea', capacity: 120, accessible: 4, rows: 10, seatsPerRow: 12 }] }, admin.cookie);
  assert.equal(created.status, 201);
  assert.equal((await f.request('venues', { id: created.body.id, name: 'Teatro', city: 'Mérida', zones: [{ name: 'Platea', capacity: 100, rows: 10, seatsPerRow: 12 }] }, admin.cookie)).status, 400);
  assert.equal((await f.request('venues', { id: created.body.id, name: 'Teatro Nuevo', city: 'Progreso', zones: [{ name: 'Platea', capacity: 1500, rows: 30, seatsPerRow: 50 }, { name: 'General', capacity: 300 }] }, admin.cookie)).status, 200);
  const [venue] = (await f.get('venues', admin.cookie)).body.venues;
  assert.deepEqual([venue.name, venue.city, venue.zones.map(z => [z.name, z.type, z.capacity])], ['Teatro Nuevo', 'Progreso', [['Platea', 'seat', 1500], ['General', 'general', 300]]]);
  assert.equal((await f.request(`venues/${venue.id}/delete`, {}, admin.cookie)).status, 200);
  assert.deepEqual((await f.get('venues', admin.cookie)).body.venues, []);
  const actions = (await f.get('admin/audit', admin.cookie)).body.entries.map(e => e.action);
  assert.ok(['recinto.creado', 'recinto.editado', 'recinto.borrado'].every(action => actions.includes(action)));
});

test('QA: e-mails from the demo script are marked as simulated, not as sent', async t => {
  const f = await fixture(t, { transport: { async sendMail(message) { return { accepted: [message.to], simulated: true }; } } });
  await f.request('auth/register', person('demo@example.com'));
  const db = f.db();
  try { assert.equal(db.prepare("SELECT status FROM outbox WHERE to_email='demo@example.com'").get().status, 'simulado'); } finally { db.close(); }
});

test('QA: SMTP uses TLS on port 465 and STARTTLS on 587 unless SMTP_SECURE says otherwise', () => {
  const env = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'equipo@gmail.com', SMTP_PASS: 'clave' };
  assert.equal(smtpOptions({ ...env }).secure, true);
  assert.equal(smtpOptions({ ...env, SMTP_PORT: '587' }).secure, false);
  assert.equal(smtpOptions({ ...env, SMTP_PORT: '587', SMTP_SECURE: 'true' }).secure, true);
  assert.equal(smtpOptions({ SMTP_HOST: 'smtp.gmail.com' }), null);
});
