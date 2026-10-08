// T12.3: many buyers ask for the same places at the same time.
// Passes when every answer arrives in under 2 seconds and no seat or place is sold twice.
// Uses a throwaway database; accounts and sessions are written directly so the
// login rate limit does not get in the way of the test.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from '../server/accounts.js';

const BUYERS = Number(process.argv[2]) || 150;
const dir = mkdtempSync(join(tmpdir(), 'eticket-carga-'));
const filename = join(dir, 'carga.sqlite');
const app = createAccounts({}, { filename, log: () => {} });
const server = createServer((req, res) => app.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const db = new DatabaseSync(filename);
const cookies = [];
for (let i = 0; i < BUYERS; i++) {
  const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO users(id,email,name,password_hash,verified,created) VALUES(?,?,?,?,1,?)').run(id, `carga${i}@example.com`, `Comprador ${i}`, 'x:y', Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, Date.now() + 3600000);
  cookies.push(`eticket_session=${token}`);
}

const percentile = (list, p) => list[Math.min(list.length - 1, Math.floor(list.length * p))];
async function burst(label, bodyFor) {
  const started = performance.now();
  const results = await Promise.all(cookies.map(async (cookie, i) => {
    const t0 = performance.now();
    const response = await fetch(`${origin}/api/holds`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(bodyFor(i)) });
    const body = await response.json();
    return { status: response.status, ms: performance.now() - t0, body };
  }));
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  const summary = {
    escenario: label, solicitudes: results.length,
    apartados: results.filter(r => r.status === 201).length,
    rechazados: results.filter(r => r.status === 409).length,
    otros: results.filter(r => ![201, 409].includes(r.status)).length,
    p50_ms: Math.round(percentile(times, 0.5)), p95_ms: Math.round(percentile(times, 0.95)), max_ms: Math.round(times.at(-1)),
    total_ms: Math.round(performance.now() - started),
  };
  // Free every hold so the next scenario starts clean.
  db.prepare("UPDATE holds SET status='cancelled', closed=? WHERE status IN ('active','paying')").run(Date.now());
  db.prepare('DELETE FROM hold_seats').run();
  return { summary, results };
}

const free = ['A', 'B', 'C', 'D'].flatMap(r => Array.from({ length: 8 }, (_, i) => `${r}${i + 1}`)).filter(s => !['A3', 'A4', 'B6', 'C2', 'C7', 'D5'].includes(s));
const report = [];
// 1. Everyone asks for one of the 26 free seats of event 1 at once.
const seats = await burst('Asientos numerados (26 libres)', i => ({ eventId: 1, functionId: '1', zone: 'Preferente', seats: [free[i % free.length]] }));
const won = seats.results.filter(r => r.status === 201).map(r => r.body.hold.seats[0]);
report.push({ ...seats.summary, asientos_duplicados: won.length - new Set(won).size });
// 2. Everyone asks for two seats, most requests overlap with others.
const pairs = await burst('Pares de asientos que se cruzan', i => ({ eventId: 1, functionId: '1', zone: 'Preferente', seats: [free[i % free.length], free[(i + 1) % free.length]] }));
const wonPairs = pairs.results.filter(r => r.status === 201).flatMap(r => r.body.hold.seats);
report.push({ ...pairs.summary, asientos_duplicados: wonPairs.length - new Set(wonPairs).size });
// 3. Everyone asks for one place in a general zone with capacity 24.
const general = await burst('Zona general (cupo 24)', () => ({ eventId: 3, functionId: '1', zone: 'General', quantity: 1 }));
report.push({ ...general.summary, sobreventa: Math.max(0, general.summary.apartados - 24) });

console.table(report);
const ok = report.every(r => r.otros === 0 && r.max_ms < 2000 && !r.asientos_duplicados && !r.sobreventa) && report[0].apartados === 26 && report[2].apartados === 24;
console.log(ok ? `Correcto: ${BUYERS} compradores por escenario, todas las respuestas en menos de 2 s y cero lugares duplicados.` : 'FALLÓ: revisa la tabla.');
db.close();
await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
app.close();
rmSync(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
