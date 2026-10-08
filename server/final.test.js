import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { fixture } from './test-helpers.js';

test('T12.5 passwords are stored hashed and the session cookie is HttpOnly and ends after 30 minutes idle', async t => {
  const f = await fixture(t), user = await f.register('segura@example.com');
  const login = await f.request('auth/login', { email: 'segura@example.com', password: 'MiClave123!' });
  assert.equal(login.status, 200);
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Lax/);
  assert.match(login.setCookie, /Max-Age=1800/);
  const db = f.db();
  try {
    const row = db.prepare("SELECT password_hash FROM users WHERE email='segura@example.com'").get();
    assert.match(row.password_hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.ok(!row.password_hash.includes('MiClave123!'));
    assert.equal((await f.get('auth/me', user.cookie)).body.user.email, 'segura@example.com');
    // 30 minutes without activity: the session row expires and the cookie stops working.
    db.prepare('UPDATE sessions SET expires=?').run(Date.now() - 1);
    assert.equal((await f.get('auth/me', user.cookie)).body.user, null);
    assert.equal((await f.get('tickets', user.cookie)).status, 401);
  } finally { db.close(); }
});

test('T12.5 each role only reaches its own routes', async t => {
  const f = await fixture(t), admin = await f.admin(), org = await f.organizer(admin.cookie, 'org@example.com'), staff = await f.staff(admin.cookie, 'gate@example.com'), buyer = await f.register('buyer@example.com');
  const adminOnly = ['admin/users', 'admin/holds', 'admin/reports/ventas', 'admin/audit', 'admin/outbox', 'admin/refunds', 'admin/cancellations', 'admin/settings', 'admin/unresolved-payments', 'venues'];
  for (const path of adminOnly) {
    assert.equal((await f.get(path, admin.cookie)).status, 200, path);
    for (const user of [org, staff, buyer]) assert.equal((await f.get(path, user.cookie)).status, 403, `${path} ${user.email}`);
    assert.ok([401, 403].includes((await f.get(path)).status), path);
  }
  assert.equal((await f.get('staff/assignments', staff.cookie)).status, 200);
  for (const user of [admin, org, buyer]) assert.equal((await f.get('staff/assignments', user.cookie)).status, 403);
  assert.equal((await f.request('scan', { code: 'X', eventId: 1, functionId: '1' }, buyer.cookie)).status, 403);
  assert.equal((await f.hold(staff.cookie, { seats: ['A1'] })).status, 403);
  assert.equal((await f.get('tickets')).status, 401);
  assert.equal((await f.request('box-office/check', { code: 'X' }, staff.cookie)).status, 410);
});

test('T12.3 many buyers trying the same seats at once never get a seat twice', async t => {
  const f = await fixture(t), db = f.db(), cookies = [];
  try {
    // Accounts and sessions are written directly so the auth rate limit does not get in the way.
    for (let i = 0; i < 60; i++) {
      const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
      db.prepare("INSERT INTO users(id,email,name,password_hash,verified,created) VALUES(?,?,?,?,1,?)").run(id, `carga${i}@example.com`, `Carga ${i}`, 'x:y', Date.now());
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, Date.now() + 1800000);
      cookies.push(`eticket_session=${token}`);
    }
  } finally { db.close(); }
  const seats = ['A1', 'A2', 'A5', 'A6', 'B1'];
  const results = await Promise.all(cookies.map((cookie, i) => f.hold(cookie, { seats: [seats[i % seats.length]] })));
  const won = results.filter(r => r.status === 201).map(r => r.body.hold.seats[0]);
  assert.equal(won.length, seats.length);
  assert.deepEqual([...won].sort(), [...seats].sort());
  assert.ok(results.every(r => r.status === 201 || r.status === 409));
  const check = f.db();
  try {
    assert.equal(check.prepare("SELECT COUNT(*) AS n FROM hold_seats").get().n, seats.length);
  } finally { check.close(); }
});
