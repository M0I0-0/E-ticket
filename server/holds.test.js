import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as wait } from 'node:timers/promises';
import { createAccounts } from './accounts.js';

const MINUTE = 60000;

// The hold clock is injected so a test can move time forward without waiting 10 minutes.
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eticket-holds-'));
  const filename = join(dir, 'holds.sqlite');
  const messages = [], clock = { now: Date.now() };
  const app = createAccounts({ ADMIN_EMAIL: 'admin@example.com' }, {
    filename, clock: () => clock.now, log: () => {},
    transport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } },
    ...options,
  });
  const server = createServer((req, res) => app.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = async (path, data, cookie = '', method = 'POST', headers = {}) => {
    const response = await fetch(`${origin}/api/${path}`, {
      method, headers: { 'Content-Type': 'application/json', cookie, ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) }),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const register = async email => {
    const data = { email, firstNames: 'Prueba', paternalSurname: 'Uno', maternalSurname: 'Dos', password: 'MiClave123!', confirmPassword: 'MiClave123!' };
    assert.equal((await request('auth/register', data)).status, 201);
    const code = messages.filter(m => m.to === email).at(-1).text.match(/\d{6}/)[0];
    const verified = await request('auth/verify', { email, code });
    assert.equal(verified.status, 200);
    return verified.cookie;
  };
  const login = async email => (await request('auth/login', { email, password: 'MiClave123!' })).cookie;
  const hold = (cookie, body) => request('holds', { eventId: 1, functionId: '1', zone: 'Preferente', ...body }, cookie);
  const occupied = async (cookie = '') => (await request('availability?eventId=1&functionId=1&zone=Preferente', null, cookie, 'GET')).body.occupied;
  return { request, register, login, hold, occupied, filename, advance: ms => { clock.now += ms; } };
}

const order = (hold, seats) => ({
  id: `ET-${hold.id.slice(0, 10)}`, eventId: Number(hold.eventId), holdId: hold.id, zone: hold.zone, functionId: hold.functionId,
  total: 100, time: new Date().toISOString(),
  tickets: seats.map((seat, i) => ({ seat, owner: 'Comprador', code: `ET-${hold.id.slice(0, 10)}-${i + 1}`, transferred: false })),
});

test('RN-03 / T08.2 the server stores a 10-minute hold with its exact expiry and never extends it', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  const created = await f.hold(buyer, { seats: ['A1', 'A2'] });
  assert.equal(created.status, 201);
  const hold = created.body.hold;
  assert.equal(hold.status, 'active');
  assert.equal(hold.expires - hold.created, 10 * MINUTE);
  assert.equal(hold.remainingMs, 10 * MINUTE);
  f.advance(3 * MINUTE);
  const reloaded = (await f.request('holds/current', null, buyer, 'GET')).body.hold;
  assert.equal(reloaded.id, hold.id);
  assert.equal(reloaded.expires, hold.expires);
  assert.equal(reloaded.remainingMs, 7 * MINUTE);
  const changed = await f.request(`holds/${hold.id}`, { seats: ['A1'] }, buyer, 'PUT');
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.hold.seats, ['A1']);
  assert.equal(changed.body.hold.expires, hold.expires);
  const db = new DatabaseSync(f.filename);
  try { assert.equal(db.prepare('SELECT expires FROM holds WHERE id=?').get(hold.id).expires, hold.expires); } finally { db.close(); }
});

test('Cases 1 and 2 / K-09 closing the browser or switching devices resumes the same purchase and clock', async t => {
  const f = await fixture(t), laptop = await f.register('buyer@example.com');
  const hold = (await f.hold(laptop, { seats: ['B1'] })).body.hold;
  f.advance(4 * MINUTE);
  assert.ok((await f.occupied()).includes('B1'));
  const phone = await f.login('buyer@example.com');
  assert.notEqual(phone, laptop);
  const resumed = (await f.request('holds/current', null, phone, 'GET')).body.hold;
  assert.equal(resumed.id, hold.id);
  assert.deepEqual(resumed.seats, ['B1']);
  assert.equal(resumed.expires, hold.expires);
  assert.equal(resumed.remainingMs, 6 * MINUTE);
});

test('RN-06 one open purchase per account: a second tab gets the same purchase', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  const first = (await f.hold(buyer, { seats: ['C1'] })).body.hold;
  const secondTab = await f.hold(buyer, { seats: ['C3'] });
  assert.equal(secondTab.status, 409);
  assert.equal(secondTab.body.hold.id, first.id);
  const otherEvent = await f.request('holds', { eventId: 3, zone: 'General', quantity: 2 }, buyer);
  assert.equal(otherEvent.status, 409);
  assert.equal(otherEvent.body.hold.id, first.id);
  assert.ok(!(await f.occupied()).includes('C3'));
});

test('RN-05 removing a seat or cancelling frees it at once for another browser', async t => {
  const f = await fixture(t), ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  const hold = (await f.hold(ana, { seats: ['A1', 'A2'] })).body.hold;
  assert.deepEqual((await f.request('availability?eventId=1&functionId=1&zone=Preferente', null, ana, 'GET')).body.mine.sort(), ['A1', 'A2']);
  const blocked = await f.hold(beto, { seats: ['A1'] });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.seat, 'A1');
  assert.equal((await f.request(`holds/${hold.id}`, { seats: ['A2'] }, ana, 'PUT')).status, 200);
  assert.ok(!(await f.occupied(beto)).includes('A1'));
  assert.equal((await f.hold(beto, { seats: ['A1'] })).status, 201);
  assert.equal((await f.request(`holds/${hold.id}/cancel`, {}, ana)).status, 200);
  assert.ok(!(await f.occupied(beto)).includes('A2'));
  assert.equal((await f.request('holds/current', null, ana, 'GET')).body.recent.status, 'cancelled');
  const last = (await f.hold(ana, { seats: ['B2'] })).body.hold;
  assert.equal((await f.request(`holds/${last.id}`, { seats: [] }, ana, 'PUT')).body.hold, null);
  assert.ok(!(await f.occupied()).includes('B2'));
});

test('Case 3 / T08.7 an abandoned purchase expires, frees its seats, cannot be paid and is counted by the admin', async t => {
  const f = await fixture(t), admin = await f.register('admin@example.com'), buyer = await f.register('buyer@example.com');
  const hold = (await f.hold(buyer, { seats: ['D1'] })).body.hold;
  f.advance(10 * MINUTE);
  assert.ok(!(await f.occupied()).includes('D1'));
  const current = (await f.request('holds/current', null, buyer, 'GET')).body;
  assert.equal(current.hold, null);
  assert.equal(current.recent.status, 'expired');
  assert.equal((await f.request(`holds/${hold.id}/pay`, {}, buyer)).status, 410);
  assert.equal((await f.request('orders', { orders: [order(hold, ['D1'])] }, buyer, 'PUT')).status, 410);
  const summary = (await f.request('admin/holds', null, admin, 'GET')).body;
  assert.equal(summary.counts.expired, 1);
  assert.equal(summary.expired[0].email, 'buyer@example.com');
  assert.deepEqual(summary.expired[0].seats, ['D1']);
  assert.equal((await f.request('admin/holds', null, buyer, 'GET')).status, 403);
});

test('K-10 the scheduled task releases expired holds without waiting for a request', async t => {
  const f = await fixture(t, { sweepMs: 25 }), buyer = await f.register('buyer@example.com');
  const hold = (await f.hold(buyer, { seats: ['A5'] })).body.hold;
  f.advance(10 * MINUTE);
  await wait(200);
  const db = new DatabaseSync(f.filename);
  try {
    assert.equal(db.prepare('SELECT status FROM holds WHERE id=?').get(hold.id).status, 'expired');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hold_seats WHERE hold_id=?').get(hold.id).n, 0);
  } finally { db.close(); }
});

test('Case 4 / T08.8 a purchase in payment keeps its seats when the clock reaches zero', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com'), other = await f.register('other@example.com');
  const hold = (await f.hold(buyer, { seats: ['A7', 'A8'] })).body.hold;
  f.advance(9 * MINUTE);
  assert.equal((await f.request(`holds/${hold.id}/pay`, {}, buyer)).body.hold.status, 'paying');
  f.advance(2 * MINUTE);
  assert.equal((await f.request('holds/current', null, buyer, 'GET')).body.hold.status, 'paying');
  assert.ok((await f.occupied(other)).includes('A7'));
  assert.equal((await f.hold(other, { seats: ['A7'] })).status, 409);
  assert.equal((await f.request(`holds/${hold.id}/cancel`, {}, buyer)).status, 409);
  assert.equal((await f.request('orders', { orders: [order(hold, ['A7', 'A8'])] }, buyer, 'PUT')).status, 200);
  const after = (await f.request('holds/current', null, buyer, 'GET')).body;
  assert.equal(after.hold, null);
  assert.equal(after.recent.status, 'completed');
  assert.ok((await f.occupied(other)).includes('A7'));
});

test('Case 4 a rejected payment keeps the clock before zero and releases the seats after zero', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  const hold = (await f.hold(buyer, { seats: ['B7'] })).body.hold;
  await f.request(`holds/${hold.id}/pay`, {}, buyer);
  const retry = (await f.request(`holds/${hold.id}/payment-failed`, {}, buyer)).body.hold;
  assert.equal(retry.status, 'active');
  assert.equal(retry.expires, hold.expires);
  f.advance(9 * MINUTE);
  await f.request(`holds/${hold.id}/pay`, {}, buyer);
  f.advance(2 * MINUTE);
  const rejected = (await f.request(`holds/${hold.id}/payment-failed`, {}, buyer)).body;
  assert.equal(rejected.hold, null);
  assert.equal(rejected.expired, true);
  assert.ok(!(await f.occupied()).includes('B7'));
});

test('a payment that never answers is released after the 5-minute safety window', async t => {
  const f = await fixture(t), buyer = await f.register('buyer@example.com');
  const hold = (await f.hold(buyer, { seats: ['C8'] })).body.hold;
  await f.request(`holds/${hold.id}/pay`, {}, buyer);
  f.advance(4 * MINUTE);
  assert.ok((await f.occupied()).includes('C8'));
  f.advance(MINUTE);
  assert.ok(!(await f.occupied()).includes('C8'));
  const recent = (await f.request('holds/current', null, buyer, 'GET')).body.recent;
  assert.equal(recent.status, 'expired');
  assert.equal(recent.reason, 'pago sin respuesta');
});

test('published events count open holds per function and zone and paid holds become sales once', async t => {
  const f = await fixture(t), admin = await f.register('admin@example.com'), organizer = await f.register('organizer@example.com');
  const ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  await f.request('auth/organizer-request', {}, organizer);
  const organizerId = (await f.request('auth/me', null, organizer, 'GET')).body.user.id;
  assert.equal((await f.request('admin/organizers', { userId: organizerId, approve: true }, admin, 'PUT')).status, 200);
  const functions = [{ id: 'matinee', date: '2026-11-20', hour: '15:00' }, { id: 'evening', date: '2026-11-20', hour: '20:00' }];
  const zones = [{ name: 'Luneta', type: 'seat', price: 500, capacity: 2, seats: ['A1', 'A2'], accessible: [], blockedSeats: ['A2'] }, { name: 'General', type: 'general', price: 250, capacity: 2, seats: [], accessible: [] }];
  const draft = await f.request('events', { name: 'Obra', date: functions[0].date, hour: functions[0].hour, functions, zones, ticketLimit: 2 }, organizer);
  assert.equal(draft.status, 200);
  await f.request(`events/${draft.body.id}/submit`, {}, organizer);
  await f.request(`events/${draft.body.id}/decision`, { approve: true }, admin);
  const eventId = draft.body.id, general = `availability?eventId=${eventId}&functionId=matinee&zone=General`;
  const held = (await f.request('holds', { eventId, functionId: 'matinee', zone: 'General', quantity: 2 }, ana)).body.hold;
  assert.equal(held.kind, 'general');
  assert.equal((await f.request(general, null, beto, 'GET')).body.available, 0);
  assert.equal((await f.request('holds', { eventId, functionId: 'matinee', zone: 'General', quantity: 1 }, beto)).status, 409);
  assert.equal((await f.request('holds', { eventId, functionId: 'evening', zone: 'Luneta', seats: ['A2'] }, beto)).status, 409);
  assert.equal((await f.request('holds', { eventId, functionId: 'evening', zone: 'Luneta', seats: ['A1'] }, beto)).status, 201);
  await f.request(`holds/${held.id}/pay`, {}, ana);
  assert.equal((await f.request('orders', { orders: [order(held, ['Acceso 1', 'Acceso 2'])] }, ana, 'PUT')).status, 200);
  const after = (await f.request(general, null, beto, 'GET')).body;
  assert.equal(after.sold, 2);
  assert.equal(after.available, 0);
  const listed = (await f.request('events', null, '', 'GET')).body.events.find(e => String(e.id) === String(eventId));
  assert.equal(listed.zones.find(z => z.name === 'General').sold, 2);
});

test('legacy orders cannot take held seats, box office accounts cannot hold and polling does not extend sessions', async t => {
  const f = await fixture(t), admin = await f.register('admin@example.com'), ana = await f.register('ana@example.com'), beto = await f.register('beto@example.com');
  assert.equal((await f.hold(ana, { seats: ['B3'] })).status, 201);
  const legacy = { id: 'legacy-1', eventId: 1, total: 100, time: new Date().toISOString(), tickets: [{ seat: 'B3', owner: 'Beto', code: 'legacy-1', transferred: false }] };
  assert.equal((await f.request('orders', { orders: [legacy] }, beto, 'PUT')).status, 409);
  const betoId = (await f.request('auth/me', null, beto, 'GET')).body.user.id;
  assert.equal((await f.request('admin/users', { userId: betoId, role: 'taquilla' }, admin, 'PUT')).status, 200);
  assert.equal((await f.hold(beto, { seats: ['B4'] })).status, 403);
  const db = new DatabaseSync(f.filename);
  try {
    const expiry = () => db.prepare("SELECT MAX(s.expires) AS e FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email='ana@example.com'").get().e;
    const before = expiry();
    await wait(20);
    await f.request('holds/current', null, ana, 'GET', { 'X-Eticket-Background': '1' });
    assert.equal(expiry(), before);
    await f.request('holds/current', null, ana, 'GET');
    assert.ok(expiry() > before);
  } finally { db.close(); }
});
