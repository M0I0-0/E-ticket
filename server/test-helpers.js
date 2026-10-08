import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from './accounts.js';

export const CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
export const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;

// A throwaway server with a fake mail transport and a clock the test can move.
export async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eticket-e3-'));
  const filename = join(dir, 'e3.sqlite');
  const messages = [], clock = { now: Date.now() };
  const app = createAccounts({ ADMIN_EMAIL: 'admin@example.com' }, {
    filename, clock: () => clock.now, log: () => {}, webhookSecret: 'whsec_test',
    transport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } },
    ...options,
  });
  const server = createServer((req, res) => app.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await app.flush();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const request = async (path, data, cookie = '', method = 'POST', headers = {}) => {
    const response = await fetch(`${origin}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', cookie, ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], setCookie: response.headers.get('set-cookie') };
  };
  const raw = async (path, cookie = '') => {
    const response = await fetch(`${origin}/api/${path}`, { headers: { cookie } });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), buffer, text: buffer.toString('utf8') };
  };
  const get = (path, cookie) => request(path, null, cookie, 'GET');

  async function register(email, firstNames = 'Prueba') {
    const data = { email, firstNames, paternalSurname: 'Uno', maternalSurname: 'Dos', password: 'MiClave123!', confirmPassword: 'MiClave123!' };
    assert.equal((await request('auth/register', data)).status, 201);
    const code = messages.filter(m => m.to === email).at(-1).text.match(/\d{6}/)[0];
    const verified = await request('auth/verify', { email, code });
    assert.equal(verified.status, 200);
    return { cookie: verified.cookie, id: verified.body.user.id, email, name: verified.body.user.name };
  }
  const admin = () => register('admin@example.com', 'Admin');
  async function organizer(adminCookie, email) {
    const user = await register(email, 'Organiza');
    assert.equal((await request('auth/organizer-request', {}, user.cookie)).status, 200);
    assert.equal((await request('admin/organizers', { userId: user.id, approve: true }, adminCookie, 'PUT')).status, 200);
    return user;
  }
  async function staff(adminCookie, email) {
    const user = await register(email, 'Taquilla');
    assert.equal((await request('admin/users', { userId: user.id, role: 'taquilla' }, adminCookie, 'PUT')).status, 200);
    return user;
  }
  // Publishes an organizer event; defaults to one function and one general zone.
  async function publish(orgCookie, adminCookie, overrides = {}) {
    const payload = {
      name: 'Evento de prueba', artist: 'Artista', category: 'Conciertos', city: 'Mérida', venue: 'Foro de prueba',
      functions: [{ id: '1', date: '2026-12-20', hour: '20:00' }], zones: [{ name: 'General', type: 'general', price: 200, capacity: 20, seats: [], accessible: [] }],
      ticketLimit: 6, ...overrides,
    };
    payload.date = payload.functions[0].date; payload.hour = payload.functions[0].hour;
    const draft = await request('events', payload, orgCookie);
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal((await request(`events/${draft.body.id}/submit`, {}, orgCookie)).status, 200);
    assert.equal((await request(`events/${draft.body.id}/decision`, { approve: true }, adminCookie)).status, 200);
    return draft.body.id;
  }
  const hold = (cookie, body) => request('holds', { eventId: 1, functionId: '1', zone: 'Preferente', ...body }, cookie);
  let payments = 0;
  // Holds and pays in the sandbox; returns the order the buyer sees.
  async function buy(cookie, { eventId = 1, functionId = '1', zone = 'Preferente', seats, quantity, last4 = '4242' } = {}) {
    const held = await request('holds', { eventId, functionId, zone, ...(seats ? { seats } : { quantity: quantity || 1 }) }, cookie);
    assert.equal(held.status, 201, JSON.stringify(held.body));
    const paid = await request('payments/charge', { holdId: held.body.hold.id, token: `tok_sandbox_${++payments}`, last4, brand: 'VISA', idempotencyKey: `ik-test-${payments}-${Date.now()}` }, cookie);
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    return paid.body.order;
  }
  const scan = (cookie, code, eventId = 1, functionId = '1', gate = 'Puerta 1') => request('scan', { code, eventId, functionId, gate }, cookie);
  const assign = (cookie, staffId, eventId = 1, functionId = '1') => request(`events/${eventId}/staff`, { userId: staffId, functionId }, cookie);
  const db = () => new DatabaseSync(filename);

  return {
    request, raw, get, register, admin, organizer, staff, publish, hold, buy, scan, assign, db, messages, filename, clock,
    flush: () => app.flush(), runScheduled: () => app.runScheduled(),
    advance: ms => { clock.now += ms; }, setNow: ms => { clock.now = ms; },
  };
}
