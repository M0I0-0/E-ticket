// Prepares the demo data for the rehearsal and the final presentation, without SMTP.
//   npm run demo:datos                        accounts, roles, two organizer events and staff assignments
//   npm run demo:datos -- --ventas            also sample purchases, so reports and dashboards have figures
//   npm run demo:datos -- --limpiar           first erases everything created for the demo, then starts again
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from './accounts.js';

const PASSWORD = 'Demo123!';
const ADMIN = 'admin.demo@eticket.test', ORGANIZER = 'org.demo@eticket.test', STAFF = 'taquilla.demo@eticket.test';
const people = [
  { email: 'ana.demo@eticket.test', firstNames: 'Ana', paternalSurname: 'Demo', maternalSurname: 'Compradora' },
  { email: 'beto.demo@eticket.test', firstNames: 'Beto', paternalSurname: 'Demo', maternalSurname: 'Comprador' },
  { email: 'carla.demo@eticket.test', firstNames: 'Carla', paternalSurname: 'Demo', maternalSurname: 'Compradora' },
  { email: ORGANIZER, firstNames: 'Olga', paternalSurname: 'Demo', maternalSurname: 'Organizadora' },
  { email: STAFF, firstNames: 'Tomás', paternalSurname: 'Demo', maternalSurname: 'Taquilla' },
  { email: ADMIN, firstNames: 'Admin', paternalSurname: 'Demo', maternalSurname: 'eTicket' },
];
const seatsAB = ['A', 'B'].flatMap(row => Array.from({ length: 8 }, (_, i) => `${row}${i + 1}`));
const EVENTS = [
  {
    name: 'Festival de Luces', artist: 'Colectivo Aurora', category: 'Festivales', city: 'Mérida', venue: 'Foro de las Artes', class: 'p3', tag: 'FESTIVAL',
    desc: 'Dos noches de música electrónica e instalaciones de luz. Preferente con asiento numerado o acceso general.',
    functions: [{ id: '1', date: '2026-12-18', hour: '20:00' }, { id: '2', date: '2026-12-19', hour: '20:00' }],
    zones: [
      { name: 'Preferente', type: 'seat', price: 600, capacity: 16, seats: seatsAB, accessible: ['B1'], blockedSeats: ['A1'], rows: 2, seatsPerRow: 8 },
      { name: 'General', type: 'general', price: 300, capacity: 50, seats: [], accessible: [] },
    ],
  },
  {
    name: 'Noche íntima', artist: 'Dúo Brisa', category: 'Conciertos', city: 'Mérida', venue: 'Sala pequeña', class: 'p4', tag: 'ACÚSTICO',
    desc: 'Concierto acústico con solo dos lugares: sirve para mostrar «Agotado» y la cancelación con reembolso.',
    functions: [{ id: '1', date: '2026-12-22', hour: '21:00' }],
    zones: [{ name: 'General', type: 'general', price: 250, capacity: 2, seats: [], accessible: [] }],
  },
];

const filename = fileURLToPath(new URL('../data/eticket.sqlite', import.meta.url));
const db = new DatabaseSync(filename);
db.exec('PRAGMA busy_timeout = 5000');
const tableExists = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

if (process.argv.includes('--limpiar') && tableExists('users')) {
  const emails = people.map(p => p.email), marks = emails.map(() => '?').join(',');
  const users = db.prepare(`SELECT id FROM users WHERE email IN (${marks})`).all(...emails).map(u => u.id);
  const events = tableExists('events') ? db.prepare(`SELECT id FROM events WHERE owner_id IN (SELECT id FROM users WHERE email=?)`).all(ORGANIZER).map(e => e.id) : [];
  const run = (sql, ...args) => { try { db.prepare(sql).run(...args); } catch (error) { if (!/no such table/.test(error.message)) throw error; } };
  // Orders of the demo accounts and every order of the demo events, children first (foreign keys).
  const orderScope = [`SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email IN (${marks}))${events.length ? ` OR event_id IN (${events.map(() => '?').join(',')})` : ''}`, [...emails, ...events]];
  const holdScope = [`SELECT id FROM holds WHERE user_id IN (SELECT id FROM users WHERE email IN (${marks}))${events.length ? ` OR event_id IN (${events.map(() => '?').join(',')})` : ''}`, [...emails, ...events]];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['scans', 'ticket_codes', 'transfers']) run(`DELETE FROM ${table} WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id IN (${orderScope[0]}))`, ...orderScope[1]);
    run(`DELETE FROM refunds WHERE order_id IN (${orderScope[0]})`, ...orderScope[1]);
    run(`DELETE FROM tickets WHERE order_id IN (${orderScope[0]})`, ...orderScope[1]);
    run(`DELETE FROM orders WHERE id IN (${orderScope[0]})`, ...orderScope[1]);
    run(`DELETE FROM payments WHERE hold_id IN (${holdScope[0]})`, ...holdScope[1]);
    run(`DELETE FROM hold_seats WHERE hold_id IN (${holdScope[0]})`, ...holdScope[1]);
    run(`DELETE FROM holds WHERE id IN (${holdScope[0]})`, ...holdScope[1]);
    for (const userId of users) {
      run('DELETE FROM payments WHERE user_id=?', userId);
      run('DELETE FROM user_orders WHERE user_id=?', userId);
      run('DELETE FROM staff_assignments WHERE user_id=?', userId);
    }
    for (const eventId of events) {
      for (const table of ['event_function_seats', 'event_function_sales', 'event_sales', 'event_seats', 'cancellations', 'function_changes', 'staff_assignments']) run(`DELETE FROM ${table} WHERE event_id=?`, eventId);
      run("DELETE FROM notices WHERE key LIKE ? || ':%'", eventId);
      run('DELETE FROM events WHERE id=?', eventId);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  console.log(`Datos de demostración borrados: ${users.length} cuentas limpias y ${events.length} eventos del organizador.`);
}
db.close();

const codes = new Map();
const app = createAccounts({ ADMIN_EMAIL: ADMIN }, {
  filename, log: () => {},
  transport: { async sendMail(message) { const code = message.text.match(/código eTicket es (\d{6})/)?.[1]; if (code) codes.set(message.to, code); return { accepted: [message.to] }; } },
});
const server = createServer((req, res) => app.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const api = async (path, data, cookie = '', method = 'POST') => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) }) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
};
const fail = (what, r) => { throw new Error(`${what}: ${r.body?.error || r.status}`); };

try {
  const session = {};
  for (const person of people) {
    const created = await api('auth/register', { ...person, password: PASSWORD, confirmPassword: PASSWORD });
    if (created.status === 201) {
      const verified = await api('auth/verify', { email: person.email, code: codes.get(person.email) });
      if (verified.status !== 200) fail(person.email, verified);
      console.log(`Cuenta creada: ${person.email}`);
    } else if (created.status !== 409) fail(person.email, created);
    const login = await api('auth/login', { email: person.email, password: PASSWORD });
    if (login.status !== 200) fail(`Inicio de sesión de ${person.email} (¿cambiaste la contraseña?)`, login);
    session[person.email] = { cookie: login.cookie, user: login.body.user };
  }
  const admin = session[ADMIN].cookie, org = session[ORGANIZER], staff = session[STAFF];
  if (org.user.role !== 'organizador') {
    await api('auth/organizer-request', {}, org.cookie);
    const approved = await api('admin/organizers', { userId: org.user.id, approve: true }, admin, 'PUT');
    if (approved.status !== 200) fail('Aprobar organizadora', approved);
    org.cookie = (await api('auth/login', { email: ORGANIZER, password: PASSWORD })).cookie;
    console.log('Organizadora aprobada.');
  }
  if (staff.user.role !== 'taquilla') {
    const role = await api('admin/users', { userId: staff.user.id, role: 'taquilla' }, admin, 'PUT');
    if (role.status !== 200) fail('Rol de taquilla', role);
    console.log('Cuenta de taquilla lista.');
  }
  const ids = {};
  const listing = (await api('events', null, org.cookie, 'GET')).body.events;
  for (const event of EVENTS) {
    const existing = listing.find(e => e.name === event.name && e.ownerId === org.user.id && e.status === 'published');
    if (existing) { ids[event.name] = existing.id; continue; }
    const payload = { ...event, date: event.functions[0].date, hour: event.functions[0].hour, ticketLimit: 6 };
    const draft = await api('events', payload, org.cookie);
    if (draft.status !== 200) fail(event.name, draft);
    await api(`events/${draft.body.id}/submit`, {}, org.cookie);
    const decision = await api(`events/${draft.body.id}/decision`, { approve: true }, admin);
    if (decision.status !== 200) fail(`Publicar ${event.name}`, decision);
    ids[event.name] = draft.body.id;
    console.log(`Evento publicado: ${event.name}`);
  }
  const assignments = [['1', '1', admin], [ids['Festival de Luces'], '1', org.cookie], [ids['Festival de Luces'], '2', org.cookie], [ids['Noche íntima'], '1', org.cookie]];
  for (const [eventId, functionId, cookie] of assignments) await api(`events/${eventId}/staff`, { userId: staff.user.id, functionId }, cookie);
  console.log('Taquilla asignada a: Ecos de medianoche, Festival de Luces (2 funciones) y Noche íntima.');

  if (process.argv.includes('--ventas')) {
    const carla = session['carla.demo@eticket.test'].cookie;
    const already = (await api('orders', null, carla, 'GET')).body.orders.length;
    const buy = async (body, last4 = '4242') => {
      const held = await api('holds', body, carla);
      if (held.status !== 201) fail('Apartar', held);
      const paid = await api('payments/charge', { holdId: held.body.hold.id, token: `tok_demo_${Date.now()}`, last4, brand: 'VISA', idempotencyKey: `ik-demo-${Date.now()}-${Math.random()}` }, carla);
      if (paid.status !== 200) fail('Pagar', paid);
      return paid.body.order;
    };
    if (already) console.log('Carla ya tiene compras; no se agregan más (usa --limpiar para empezar de cero).');
    else {
      await buy({ eventId: ids['Festival de Luces'], functionId: '1', zone: 'General', quantity: 3 });
      await buy({ eventId: ids['Festival de Luces'], functionId: '1', zone: 'Preferente', seats: ['A3', 'A4'] });
      // Paid with the test card 0069: its refund will fail if the event is cancelled (T11.5).
      await buy({ eventId: ids['Noche íntima'], functionId: '1', zone: 'General', quantity: 2 }, '0069');
      console.log('Compras de ejemplo de Carla: 5 boletos del Festival y los 2 de Noche íntima (queda agotado).');
    }
  }
} finally {
  await app.flush();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  app.close();
}
console.log(`\nContraseña de todas las cuentas de demostración: ${PASSWORD}`);
console.log(`Compradores: ana.demo, beto.demo, carla.demo · Organizadora: org.demo · Taquilla: taquilla.demo · Administración: admin.demo (todas @eticket.test)`);
