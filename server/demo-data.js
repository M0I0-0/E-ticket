// Prepares verified demo accounts for the T08 rehearsal without SMTP.
//   npm run demo:datos               creates the accounts that are missing
//   npm run demo:datos -- --limpiar  also erases the demo accounts' purchases and holds
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from './accounts.js';

const PASSWORD = 'Demo123!';
const ADMIN = 'admin.demo@eticket.test';
const people = [
  { email: 'ana.demo@eticket.test', firstNames: 'Ana', paternalSurname: 'Demo', maternalSurname: 'Compradora' },
  { email: 'beto.demo@eticket.test', firstNames: 'Beto', paternalSurname: 'Demo', maternalSurname: 'Comprador' },
  { email: 'carla.demo@eticket.test', firstNames: 'Carla', paternalSurname: 'Demo', maternalSurname: 'Compradora' },
  { email: ADMIN, firstNames: 'Admin', paternalSurname: 'Demo', maternalSurname: 'eTicket' },
];
const filename = fileURLToPath(new URL('../data/eticket.sqlite', import.meta.url));
const codes = new Map();
const accounts = createAccounts({ ADMIN_EMAIL: ADMIN }, {
  filename, log: () => {},
  transport: { async sendMail(message) { codes.set(message.to, message.text.match(/\d{6}/)[0]); return { accepted: [message.to] }; } },
});
const server = createServer((req, res) => accounts.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const post = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
try {
  for (const person of people) {
    const created = await post('auth/register', { ...person, password: PASSWORD, confirmPassword: PASSWORD });
    if (created.status === 409) { console.log(`Ya existe: ${person.email}`); continue; }
    if (created.status !== 201) throw new Error(`${person.email}: ${created.body.error}`);
    const verified = await post('auth/verify', { email: person.email, code: codes.get(person.email) });
    if (verified.status !== 200) throw new Error(`${person.email}: ${verified.body.error}`);
    console.log(`Cuenta lista: ${person.email}`);
  }
} finally {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  accounts.close();
}
if (process.argv.includes('--limpiar')) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 5000');
  const users = `SELECT id FROM users WHERE email IN (${people.map(() => '?').join(',')})`, emails = people.map(person => person.email);
  db.exec('BEGIN IMMEDIATE');
  db.prepare(`DELETE FROM hold_seats WHERE hold_id IN (SELECT id FROM holds WHERE user_id IN (${users}))`).run(...emails);
  const removed = db.prepare(`DELETE FROM holds WHERE user_id IN (${users})`).run(...emails).changes;
  db.prepare(`DELETE FROM user_orders WHERE user_id IN (${users})`).run(...emails);
  db.exec('COMMIT');
  db.close();
  console.log(`Compras de demostración borradas: ${removed}`);
}
console.log(`Contraseña de las cuentas de demostración: ${PASSWORD}`);
