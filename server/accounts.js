import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createHolds, SEAT } from './holds.js';
import { createPayments } from './payments.js';
import { createCatalog, SAMPLE_EVENTS, startsAt } from './catalog.js';
import { createAudit } from './audit.js';
import { createMailer, senderFor, smtpTransport } from './mailer.js';
import { createAdmin } from './admin.js';
import { createTickets } from './tickets.js';
import { createNotify } from './notify.js';
import { createRefunds } from './refunds.js';
import { createReports } from './reports.js';
import { createRouter, registerRoutes } from './routes.js';

const derive = promisify(scrypt);
const hash = text => createHash('sha256').update(text).digest('hex');
const token = () => randomBytes(32).toString('hex');
const publicUser = u => ({ id: u.id, name: u.name, firstNames: u.first_names, lastNames: u.last_names, paternalSurname: u.paternal_surname, maternalSurname: u.maternal_surname, email: u.email, role: u.role || 'comprador', verified: Boolean(u.verified), organizerStatus: u.organizer_status || 'none', organizerReason:u.organizer_reason||'', blocked: Boolean(u.blocked) });
const passwordValid = value => typeof value === 'string' && value.length >= 6 && value.length <= 15 && /[A-ZÁÉÍÓÚÜÑ]/u.test(value) && /[^\p{L}\p{N}\s]/u.test(value);
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const salt = stored.split(':')[0];
  return timingSafeEqual(Buffer.from(await passwordHash(password, salt)), Buffer.from(stored));
}

export function createAccounts(env = {}, options = {}) {
  const filename = options.filename || fileURLToPath(new URL('../data/eticket.sqlite', import.meta.url));
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, code_hash TEXT NOT NULL, expires INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_orders (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL DEFAULT '[]'
    );
  `);
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  if (!userColumns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'comprador'");
  if (!userColumns.includes('organizer_status')) db.exec("ALTER TABLE users ADD COLUMN organizer_status TEXT NOT NULL DEFAULT 'none'");
  if (!userColumns.includes('failed_logins')) db.exec('ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.includes('locked_until')) db.exec('ALTER TABLE users ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.includes('organizer_reason')) db.exec("ALTER TABLE users ADD COLUMN organizer_reason TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS venues(id TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL,zones TEXT NOT NULL,created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',review_reason TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS event_sales(event_id TEXT NOT NULL REFERENCES events(id),zone TEXT NOT NULL,sold INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,zone));
    CREATE TABLE IF NOT EXISTS event_seats(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,zone TEXT NOT NULL,seat TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(event_id,zone,seat));
    CREATE TABLE IF NOT EXISTS event_function_sales(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,function_id TEXT NOT NULL,zone TEXT NOT NULL,sold INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,function_id,zone));
    CREATE TABLE IF NOT EXISTS event_function_seats(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,function_id TEXT NOT NULL,zone TEXT NOT NULL,seat TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(event_id,function_id,zone,seat));
    CREATE TABLE IF NOT EXISTS ticket_checkins(code TEXT PRIMARY KEY,checked_by TEXT NOT NULL,checked_at INTEGER NOT NULL);`);
  const smtp = options.transport || smtpTransport(env);
  // npm start only: without SMTP the verification codes are printed in the server terminal.
  const devMail = Boolean(options.devMail) && !smtp;
  if (env.ADMIN_EMAIL) db.prepare("UPDATE users SET role='administrador' WHERE email=? COLLATE NOCASE").run(env.ADMIN_EMAIL.trim());
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'first_names')) db.exec("ALTER TABLE users ADD COLUMN first_names TEXT NOT NULL DEFAULT '';");
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'last_names')) db.exec("ALTER TABLE users ADD COLUMN last_names TEXT NOT NULL DEFAULT '';");
  for (const column of ['paternal_surname','maternal_surname']) {
    if (!db.prepare('PRAGMA table_info(users)').all().some(item => item.name === column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  const limits = new Map();
  const failure = (status, message) => Object.assign(new Error(message), { status });
  const holdMinutes = Number(env.HOLD_MINUTES);
  const clock = options.clock || Date.now, log = options.log || console.log;
  const catalog = createCatalog(db);
  const audit = createAudit(db, clock);
  const mail = createMailer(db, { transport: smtp, from: senderFor(env), clock, log });
  const admin = createAdmin(db, { failure, clock, audit });
  const holds = createHolds(db, { failure, clock: options.clock, holdMs: options.holdMs || (holdMinutes > 0 ? holdMinutes * 60000 : 600000), paymentMs: options.paymentMs, log: options.log, feeRate: admin.feeRate });
  const tickets = createTickets(db, { failure, clock, catalog, mailer: mail, audit });
  const notify = createNotify(db, { mailer: mail, catalog, tickets, clock });
  const payments = createPayments(db, holds, { clock: options.clock, log: options.log, failure, catalog, tickets, onPaid: order => { tickets.sendConfirmation(order.id); notify.afterSale(order.eventId, order.functionId); } });
  const refunds = createRefunds(db, { failure, clock, catalog, tickets, mailer: mail, audit, notify });
  const reports = createReports(db, { failure, catalog, tickets });
  const router = createRouter();
  registerRoutes(router, { failure, admin, tickets, refunds, reports, audit, mailer: mail });
  // A webhook without the shared secret could mark any hold as paid, so it is required.
  const webhookSecret = options.webhookSecret || env.PAYMENT_WEBHOOK_SECRET || '';
  const scheduled = () => { holds.sweep(); return notify.runScheduled(); };
  const sweeper = setInterval(() => { try { scheduled(); } catch (error) { console.error('Error en tareas programadas:', error.code || error.name); } }, options.sweepMs || 60000);
  sweeper.unref?.();
  const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('eticket_session='))?.slice(16) || '';
  const sessionUser = req => db.prepare(`SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires>? AND u.verified=1`).get(hash(cookie(req)), Date.now());
  const secureCookie = env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  const sessionCookie = value => `eticket_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800${secureCookie}`;
  const setSession = (res, user) => {
    const value = token();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(value), user.id, Date.now() + 1800000);
    res.setHeader('Set-Cookie', sessionCookie(value));
  };
  // Only failed attempts and sent codes count, so signing in and out during a demo never locks anyone out.
  const countAttempt = key => {
    const rate = limits.get(key) || { count: 0, until: Date.now() + 900000 };
    rate.count++;
    limits.set(key, rate);
  };

  // ---- What an organizer may save: real dates, seat maps that can be sold, and published events that keep selling.
  const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00`).toLocaleDateString('sv-SE') === date;
  const validHour = hour => /^([01]\d|2[0-3]):[0-5]\d$/.test(hour);
  const functionKey = fn => `${fn?.id}|${fn?.date}|${fn?.hour}`;
  const newEventId = () => { let id; do id = String(randomBytes(4).readUInt32BE(0)); while (SAMPLE_EVENTS[id] || db.prepare('SELECT 1 FROM events WHERE id=?').get(id)); return id; };
  function checkFunctions(list, previous) {
    if (list.length > 50) throw failure(400, 'Un evento puede tener hasta 50 funciones.');
    const kept = new Set(previous.map(functionKey));
    for (const fn of list) {
      if (!fn || !validDate(String(fn.date || '')) || !validHour(String(fn.hour || ''))) throw failure(400, 'Revisa las fechas y horas de las funciones (AAAA-MM-DD y HH:MM).');
      // A function kept as it was may already have happened; a new or changed one must be in the future.
      if (!kept.has(functionKey(fn)) && startsAt(fn.date, fn.hour) <= clock()) throw failure(400, `La función del ${fn.date} a las ${fn.hour} ya pasó. Usa una fecha futura.`);
    }
    if (new Set(list.map(fn => String(fn.id))).size !== list.length) throw failure(400, 'Cada función necesita un identificador distinto.');
  }
  function checkZones(zones, eventBlocked) {
    if (!Array.isArray(zones) || !zones.length || zones.length > 30) throw failure(400, 'El evento necesita de 1 a 30 zonas.');
    if (new Set(zones.map(z => String(z?.name || '').trim().toLowerCase())).size !== zones.length) throw failure(400, 'Las zonas deben tener nombres únicos.');
    let total = 0;
    for (const zone of zones) {
      if (!zone || !String(zone.name || '').trim() || !Number.isFinite(Number(zone.price)) || Number(zone.price) < 0 || !Number.isInteger(Number(zone.capacity)) || Number(zone.capacity) < 1) throw failure(400, 'Cada zona necesita nombre, precio válido y cupo entero mayor que cero.');
      zone.name = String(zone.name).trim();
      zone.type = zone.type === 'general' || zone.type === 'seat' ? zone.type : /general/i.test(zone.name) ? 'general' : 'seat';
      const seat = zone.type === 'seat', list = value => seat && Array.isArray(value) ? value.map(String) : [];
      zone.seats = list(zone.seats); zone.accessible = list(zone.accessible); zone.blockedSeats = list(zone.blockedSeats);
      if (!seat) continue;
      const seats = new Set(zone.seats);
      if (zone.seats.some(label => !SEAT.test(label)) || seats.size !== zone.seats.length) throw failure(400, `Los asientos de ${zone.name} deben ser únicos y escribirse con fila y número (A1, B12, AA3).`);
      // Map and capacity must match: a seat beyond the capacity could be sold without room for it.
      if (zone.seats.length !== Number(zone.capacity)) throw failure(400, `La zona ${zone.name} tiene ${zone.seats.length} asientos en el mapa y un cupo de ${zone.capacity}; deben ser iguales.`);
      if (zone.accessible.some(label => !seats.has(label))) throw failure(400, `Los asientos accesibles de ${zone.name} deben existir en el mapa.`);
      if (zone.blockedSeats.some(label => !seats.has(label))) throw failure(400, `Los asientos bloqueados de ${zone.name} deben existir en el mapa.`);
      total += zone.seats.length;
    }
    if (total > 20000) throw failure(400, 'Un evento puede tener hasta 20,000 asientos numerados.');
    const all = new Set(zones.flatMap(z => z.seats)), missing = eventBlocked.find(label => !all.has(label));
    if (missing) throw failure(400, `El asiento bloqueado ${missing} no existe en ninguna zona numerada.`);
  }
  // A published event keeps selling while its organizer fixes texts. The date moves with
  // «Cambiar fecha»; what buyers chose (name, venue, zones, prices) stays as it was approved.
  const zoneShape = zones => (zones || []).map(z => ({ name: String(z?.name ?? '').trim(), type: z?.type || (/general/i.test(z?.name) ? 'general' : 'seat'), price: Number(z?.price), capacity: Number(z?.capacity), seats: (z?.seats || []).map(String), accessible: (z?.accessible || []).map(String), blockedSeats: [...(z?.blockedSeats || [])].map(String).sort() }));
  const trimmed = value => String(value ?? '').trim();
  const fixedWhenPublished = { name: trimmed, venue: trimmed, city: trimmed, saleStart: value => value || '', functions: list => (list || []).map(functionKey), zones: zoneShape, blockedSeats: list => [...(list || [])].map(String).sort() };
  function updatePublished(existing, data) {
    const old = JSON.parse(existing.payload);
    for (const [key, shape] of Object.entries(fixedWhenPublished)) {
      if (data[key] !== undefined && JSON.stringify(shape(data[key])) !== JSON.stringify(shape(old[key]))) throw failure(409, 'En un evento publicado solo puedes cambiar la descripción, el artista, la categoría, el límite de boletos y el fin de venta. Para cambiar la fecha usa «Cambiar fecha» en el panel del evento.');
    }
    const next = { ...old };
    if (data.desc !== undefined) next.desc = trimmed(data.desc).slice(0, 1000);
    for (const key of ['artist', 'category']) if (data[key] !== undefined) { if (!trimmed(data[key])) throw failure(400, 'Escribe el artista y la categoría.'); next[key] = trimmed(data[key]).slice(0, 100); }
    if (data.ticketLimit !== undefined) {
      const limit = Number(data.ticketLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 6) throw failure(400, 'El límite por compra debe ser de 1 a 6 boletos.');
      next.ticketLimit = limit;
    }
    if (data.saleEnd !== undefined) {
      const end = String(data.saleEnd || '');
      if (end && (!Number.isFinite(Date.parse(end)) || (next.saleStart && Date.parse(end) <= Date.parse(next.saleStart)))) throw failure(400, 'El cierre de venta debe ocurrir después del inicio.');
      next.saleEnd = end;
    }
    db.prepare('UPDATE events SET payload=?, updated=? WHERE id=?').run(JSON.stringify(next), Date.now(), existing.id);
    return { id: existing.id, status: 'published' };
  }
  // Venue zones: the editor turns their rows and seats per row into the event's seat map.
  function venueZones(zones) {
    if (!Array.isArray(zones) || !zones.length || zones.length > 30) throw failure(400, 'Agrega de 1 a 30 zonas al recinto.');
    if (new Set(zones.map(z => String(z?.name || '').trim().toLowerCase())).size !== zones.length) throw failure(400, 'Las zonas deben tener nombres únicos.');
    return zones.map(z => {
      const name = String(z?.name || '').trim(), capacity = Number(z?.capacity), rows = Number(z?.rows) || 0, seatsPerRow = Number(z?.seatsPerRow) || 0;
      const type = z?.type === 'general' || z?.type === 'seat' ? z.type : /general/i.test(name) ? 'general' : 'seat';
      const accessible = Array.isArray(z?.accessible) ? z.accessible.length : Number(z?.accessible) || 0;
      if (!name || !Number.isInteger(capacity) || capacity < 1 || capacity > 20000) throw failure(400, `Revisa la zona «${name || 'sin nombre'}»: necesita nombre y una capacidad entera mayor que cero.`);
      if (type === 'seat' && rows && seatsPerRow && rows * seatsPerRow !== capacity) throw failure(400, `En la zona ${name}, filas × asientos por fila (${rows * seatsPerRow}) debe ser igual a la capacidad (${capacity}).`);
      if (accessible < 0 || accessible > capacity) throw failure(400, `Los lugares accesibles de ${name} no pueden ser más que su capacidad.`);
      return { name, type, capacity, accessible, rows: type === 'seat' ? rows : 0, seatsPerRow: type === 'seat' ? seatsPerRow : 0 };
    });
  }
  const middleware = async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/')) return next();
    const reply = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify(body));
    };
    const send = (status, body, type, headers = {}) => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      res.end(body);
    };
    const finish = out => { if (!res.writableEnded) reply(200, out ?? { ok: true }); };
    const authLimited = path.startsWith('/api/auth/') && path !== '/api/auth/logout' && path !== '/api/auth/organizer-request';
    const rateKey = req.socket.remoteAddress;
    try {
      const now = Date.now();
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
      holds.sweep();
      const activeUser = sessionUser(req);
      // Background polling (purchase clock, seat map) must not keep an idle session alive.
      // Activity renews the cookie too, so the browser keeps it 30 minutes from the last action.
      if (activeUser && req.headers['x-eticket-background'] !== '1') {
        db.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(now + 1800000, hash(cookie(req)));
        res.setHeader('Set-Cookie', sessionCookie(cookie(req)));
      }
      if (req.method === 'GET' && path === '/api/auth/me') return reply(200, { user: sessionUser(req) ? publicUser(sessionUser(req)) : null });
      if (req.method === 'GET' && path === '/api/orders') {
        const user = activeUser;
        if (!user) throw failure(401, 'Inicia sesión para consultar tus datos.');
        return reply(200, { orders: tickets.ordersFor(user) });
      }
      if (!['GET', 'POST', 'PUT'].includes(req.method)) throw failure(405, 'Método no permitido.');
      if (req.method !== 'GET' && !req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Usa JSON.');
      if (req.headers.origin) {
        let origin = '';
        try { origin = new URL(req.headers.origin).host; } catch { /* "null" or malformed: not this site */ }
        if (origin !== req.headers.host) throw failure(403, 'Origen no permitido.');
      }
      if (authLimited) {
        for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
        if ((limits.get(rateKey)?.count || 0) >= 40) throw failure(429, 'Demasiados intentos. Espera 15 minutos.');
      }
      let text = '';
      if (req.method === 'GET' && (path === '/api/events' || path === '/api/venues' || path === '/api/admin/organizers' || path === '/api/organizer/venues')) {
        const admin = () => { if (!activeUser || activeUser.role !== 'administrador') throw failure(403, 'Acceso reservado al administrador.'); };
        if (path === '/api/admin/organizers') { admin(); return reply(200,{users:db.prepare("SELECT id,email,name,organizer_status,organizer_reason FROM users WHERE organizer_status IN ('pending','rejected')").all()}); }
        if (path === '/api/venues') { admin(); return reply(200,{venues:db.prepare('SELECT * FROM venues').all().map(v=>({...v,zones:JSON.parse(v.zones)}))}); }
        if (path === '/api/organizer/venues') { if(!activeUser||activeUser.role!=='organizador')throw failure(403,'Acceso reservado a organizadores aprobados.');return reply(200,{venues:db.prepare('SELECT * FROM venues ORDER BY name').all().map(v=>({...v,zones:JSON.parse(v.zones)}))}); }
        const rows=activeUser?.role==='administrador'?db.prepare('SELECT * FROM events ORDER BY updated DESC').all():activeUser?.role==='organizador'?db.prepare("SELECT * FROM events WHERE owner_id=? OR status='published' ORDER BY updated DESC").all(activeUser.id):db.prepare("SELECT * FROM events WHERE status='published' ORDER BY updated DESC").all();
        return reply(200,{events:rows.map(e=>{const payload=JSON.parse(e.payload),sales=Object.fromEntries(db.prepare('SELECT zone,sold FROM event_sales WHERE event_id=?').all(e.id).map(x=>[x.zone,x.sold])),sessionSales=db.prepare('SELECT function_id,zone,sold FROM event_function_sales WHERE event_id=?').all(e.id),sessionSeats=db.prepare('SELECT function_id,zone,seat FROM event_function_seats WHERE event_id=?').all(e.id);return{...payload,zones:(payload.zones||[]).map(z=>({...z,sold:sales[z.name]||0,salesByFunction:Object.fromEntries(sessionSales.filter(s=>s.zone===z.name).map(s=>[s.function_id,s.sold])),occupiedByFunction:Object.fromEntries((payload.functions||[{id:'1'}]).map(f=>[f.id,sessionSeats.filter(s=>s.zone===z.name&&s.function_id===String(f.id)).map(s=>s.seat)]))})),id:e.id,status:e.status,reviewReason:e.review_reason,ownerId:e.owner_id,...(activeUser?.role==='administrador'?{ownerEmail:db.prepare('SELECT email FROM users WHERE id=?').get(e.owner_id)?.email||''}:{}),sold:Object.values(sales).reduce((a,b)=>a+b,0)}}),availability:tickets.catalogStatus()});
      }
      if (req.method === 'GET' && path === '/api/admin/users') { if(!activeUser||activeUser.role!=='administrador')throw failure(403,'Acceso reservado al administrador.');return reply(200,{users:admin.searchUsers(new URL(req.url,'http://localhost').searchParams.get('q')||'')}); }
      if (req.method === 'GET' && path === '/api/admin/holds') { if(!activeUser||activeUser.role!=='administrador')throw failure(403,'Acceso reservado al administrador.');return reply(200,holds.adminSummary()); }
      if (req.method === 'GET' && path === '/api/admin/unresolved-payments') { if(!activeUser||activeUser.role!=='administrador')throw failure(403,'Acceso reservado al administrador.');return reply(200,{payments:payments.getUnresolvedPayments()}); }
      if (req.method === 'GET' && path === '/api/holds/current') { if(!activeUser)throw failure(401,'Inicia sesión para continuar tu compra.');return reply(200,holds.current(activeUser)); }
      if (req.method === 'GET' && path === '/api/availability') return reply(200,holds.availability(activeUser,new URL(req.url,'http://localhost').searchParams));
      const route = router.match(req.method, path), query = new URL(req.url, 'http://localhost').searchParams;
      if (route && req.method === 'GET') return finish(await route.handler({ user: activeUser, params: route.params, query, send, reply }));
      // Purchases are only created by a payment (T07); this old route used to take seats without one.
      if (path === '/api/orders' && req.method === 'PUT') throw failure(410, 'Esta ruta ya no se usa: las compras se registran solas al aprobarse el pago.');
      // Events and venues carry their seat maps, so they may be larger than the other requests.
      const maxBytes = path === '/api/events' || path === '/api/venues' ? 512000 : 8192;
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > maxBytes) throw failure(413, 'Solicitud demasiado grande.');
      }
      let data;
      try { data = JSON.parse(text); } catch { throw failure(400, 'Solicitud inválida.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure(400, 'Solicitud inválida.');
      const requireAdmin = () => { if (!activeUser || activeUser.role !== 'administrador') throw failure(403, 'Acceso reservado al administrador.'); };
      if (route) return finish(await route.handler({ user: activeUser, data, params: route.params, query, send, reply }));
      // T10.5: a blocked account keeps its tickets but cannot start or pay purchases.
      const blocked = () => { if (activeUser?.blocked) throw failure(403, 'Tu cuenta está bloqueada: no puedes comprar. Tus boletos siguen siendo válidos.'); };
      if (path === '/api/holds' || path.startsWith('/api/holds/')) {
        if (!activeUser) throw failure(401, 'Inicia sesión para apartar tus lugares.');
        if (activeUser.role === 'taquilla') throw failure(403, 'Las cuentas de taquilla no pueden comprar boletos.');
        if (req.method === 'POST' && path === '/api/holds') blocked();
        const [, , , id, action] = path.split('/');
        if (req.method === 'POST' && !id) return reply(201, { hold: holds.create(activeUser, data) });
        if (req.method === 'PUT' && id && !action) return reply(200, holds.update(activeUser, id, data));
        if (req.method === 'POST' && action === 'cancel') return reply(200, holds.cancel(activeUser, id));
        if (req.method === 'POST' && action === 'pay') return reply(200, holds.pay(activeUser, id));
        if (req.method === 'POST' && action === 'payment-failed') return reply(200, holds.paymentFailed(activeUser, id));
        throw failure(404, 'Ruta no disponible.');
      }
      if (path === '/api/payments/charge' && req.method === 'POST') {
        if (!activeUser) throw failure(401, 'Inicia sesión para pagar.');
        if (activeUser.role === 'taquilla') throw failure(403, 'Las cuentas de taquilla no pueden comprar boletos.');
        blocked();
        const result = payments.charge(activeUser, data);
        return reply(result.ok ? 200 : (result.cancelled ? 400 : 402), result);
      }
      if (path === '/api/payments/webhook' && req.method === 'POST') {
        const given = Buffer.from(String(req.headers['x-webhook-secret'] || '')), expected = Buffer.from(webhookSecret);
        if (!webhookSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) throw failure(401, 'Firma del webhook inválida.');
        const result = payments.webhook(data);
        return reply(200, result);
      }
      if (path.startsWith('/api/admin/unresolved-payments/') && path.endsWith('/resolve') && req.method === 'POST') {
        requireAdmin();
        const id = path.split('/')[4];
        return reply(200, payments.resolveOrphanPayment(id, data?.notes));
      }
      if (path === '/api/admin/users' && req.method === 'PUT') { requireAdmin();if(!['taquilla','comprador'].includes(data.role))throw failure(400,'Rol no permitido.');const target=db.prepare('SELECT * FROM users WHERE id=?').get(String(data.userId));if(!target)throw failure(404,'Usuario no encontrado.');if(target.role==='administrador')throw failure(400,'No se puede cambiar el rol de un administrador.');// A former organizer keeps their events, but must ask again to manage events.
db.prepare("UPDATE users SET role=?,organizer_status=CASE WHEN role='organizador' THEN 'none' ELSE organizer_status END,organizer_reason=CASE WHEN role='organizador' THEN '' ELSE organizer_reason END WHERE id=?").run(data.role,target.id);audit.record(activeUser,'rol.cambiado',{targetType:'usuario',targetId:target.email,details:`${target.role} → ${data.role}`});return reply(200,{ok:true}); }
      // The old check trusted codes stored by the buyer; validation now goes through POST /api/scan.
      if (path === '/api/box-office/check' && req.method === 'POST') throw failure(410, 'Usa el escáner de acceso: elige tu evento y función asignados.');
      const noMail = () => failure(503,'No se pueden enviar correos: falta configurar SMTP en el archivo .env (SMTP_HOST, SMTP_USER y SMTP_PASS).');
      const devNote = devMail ? { codeInConsole: true } : {};
      const deliverCode = async (user,purpose) => {
        if (!smtp && !devMail) throw noMail();
        const code=String(randomBytes(4).readUInt32BE(0)%1000000).padStart(6,'0');
        db.prepare('DELETE FROM challenges WHERE user_id=? AND purpose=?').run(user.id,purpose);
        db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?,0,?)').run(token(),user.id,purpose,hash(code),now+600000,now);
        countAttempt(rateKey);
        const subject=purpose==='verify'?'Verifica tu cuenta eTicket':'Recupera tu contraseña eTicket',text=`Tu código eTicket es ${code}. Vence en 10 minutos.`;
        if (devMail) log(`\n[eTicket · sin SMTP] ${subject} para ${user.email}: el código es ${code} (vence en 10 minutos).\n`);
        // The outbox keeps the message without the code, so nobody can read it there.
        try { await mail.sendNow({to:user.email,subject,text,kind:purpose==='verify'?'verificación':'recuperación',outboxText:text.replace(code,'••••••')}); }
        catch { throw failure(502,'No pudimos enviar el correo con tu código. Revisa que el correo esté bien escrito o inténtalo más tarde.'); }
      };
      // Five wrong codes and the code stops working: the person asks for a new one.
      const checkCode = (c,code) => {
        if (c && c.attempts >= 5) { db.prepare('DELETE FROM challenges WHERE id=?').run(c.id); throw failure(429,'Escribiste mal el código demasiadas veces. Pide un código nuevo.'); }
        if (!c || c.expires <= now || !timingSafeEqual(Buffer.from(hash(String(code||''))),Buffer.from(c.code_hash))) {
          if (c) db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE id=?').run(c.id);
          throw failure(400,'El código es incorrecto o venció.');
        }
      };
      const challengeFor = (email,purpose) => { const u=db.prepare('SELECT * FROM users WHERE email=?').get(email); return { u, c: u && db.prepare('SELECT * FROM challenges WHERE user_id=? AND purpose=?').get(u.id,purpose) }; };
      if (path === '/api/auth/verify' && req.method === 'POST') { const {u,c}=challengeFor(String(data.email||'').trim().toLowerCase(),'verify');checkCode(c,data.code);db.prepare('UPDATE users SET verified=1 WHERE id=?').run(u.id);db.prepare('DELETE FROM challenges WHERE id=?').run(c.id);setSession(res,{...u,verified:1});return reply(200,{user:publicUser({...u,verified:1})}); }
      // Same answer whether or not the address has an account, so nobody can probe for accounts.
      if (path === '/api/auth/resend' && req.method === 'POST') { if(!smtp&&!devMail)throw noMail();const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(data.email||'').trim().toLowerCase());if(u&&!u.verified)await deliverCode(u,'verify');return reply(200,{ok:true,...devNote}); }
      if (path === '/api/auth/forgot' && req.method === 'POST') { if(!smtp&&!devMail)throw noMail();const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(data.email||'').trim().toLowerCase());if(u)await deliverCode(u,'reset');return reply(200,{ok:true,...devNote}); }
      // The reset code proves the address belongs to the person, so it also verifies the account.
      if (path === '/api/auth/reset' && req.method === 'POST') { const {u,c}=challengeFor(String(data.email||'').trim().toLowerCase(),'reset');checkCode(c,data.code);if(!passwordValid(data.password))throw failure(400,'La contraseña debe incluir 6 a 15 caracteres, mayúscula y símbolo.');if(data.confirmPassword!==undefined&&data.confirmPassword!==data.password)throw failure(400,'Las contraseñas no coinciden.');db.prepare('UPDATE users SET password_hash=?,failed_logins=0,locked_until=0,verified=1 WHERE id=?').run(await passwordHash(data.password),u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);db.prepare("DELETE FROM challenges WHERE user_id=? AND purpose='reset'").run(u.id);return reply(200,{ok:true}); }
      if (path === '/api/auth/organizer-request' && req.method === 'POST') { if(!activeUser)throw failure(401,'Inicia sesión.');if(activeUser.role!=='comprador')throw failure(409,'La cuenta ya tiene rol o solicitud.');db.prepare("UPDATE users SET organizer_status='pending' WHERE id=?").run(activeUser.id);return reply(200,{ok:true}); }
      if (path === '/api/admin/organizers' && req.method === 'GET') { requireAdmin();return reply(200,{users:db.prepare("SELECT id,email,name,organizer_status FROM users WHERE organizer_status IN ('pending','rejected')").all()}); }
      if (path === '/api/admin/organizers' && req.method === 'PUT') { requireAdmin();if(!data.approve&&!String(data.reason||'').trim())throw failure(400,'Escribe el motivo del rechazo.');const changed=db.prepare("UPDATE users SET role=?,organizer_status=?,organizer_reason=? WHERE id=? AND organizer_status='pending'").run(data.approve?'organizador':'comprador',data.approve?'approved':'rejected',String(data.reason||''),String(data.userId)).changes;if(changed){const person=db.prepare('SELECT email,name FROM users WHERE id=?').get(String(data.userId));audit.record(activeUser,data.approve?'organizador.aprobado':'organizador.rechazado',{targetType:'usuario',targetId:person?.email,details:String(data.reason||'')});notify.organizerDecision(person,Boolean(data.approve),String(data.reason||''));}return reply(200,{ok:true}); }
      // Venues: the administrator registers, edits and deletes them. Events copy a venue's zones
      // when they are created, so a change here never alters events already saved.
      if (path === '/api/venues' && req.method === 'POST') {
        requireAdmin();
        const name=String(data.name||'').trim(),city=String(data.city||'').trim();
        if(!name)throw failure(400,'Escribe el nombre del recinto.');
        const zones=venueZones(data.zones);
        if (data.id) {
          const venue=db.prepare('SELECT id FROM venues WHERE id=?').get(String(data.id));
          if(!venue)throw failure(404,'Recinto no encontrado.');
          db.prepare('UPDATE venues SET name=?,city=?,zones=? WHERE id=?').run(name,city,JSON.stringify(zones),venue.id);
          audit.record(activeUser,'recinto.editado',{targetType:'recinto',targetId:name});
          return reply(200,{id:venue.id});
        }
        const id=token();db.prepare('INSERT INTO venues VALUES(?,?,?,?,?)').run(id,name,city,JSON.stringify(zones),activeUser.id);
        audit.record(activeUser,'recinto.creado',{targetType:'recinto',targetId:name});
        return reply(201,{id});
      }
      if (path.startsWith('/api/venues/') && path.endsWith('/delete') && req.method === 'POST') {
        requireAdmin();
        const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(path.split('/')[3]);
        if(!venue)throw failure(404,'Recinto no encontrado.');
        db.prepare('DELETE FROM venues WHERE id=?').run(venue.id);
        audit.record(activeUser,'recinto.borrado',{targetType:'recinto',targetId:venue.name});
        return reply(200,{ok:true});
      }
      if (path === '/api/events' && req.method === 'POST') {
        if(!activeUser||activeUser.role!=='organizador')throw failure(403,'Se requiere un organizador aprobado.');
        // Ids are made by the server; a client id only points to an event the organizer already has.
        const givenId=data.id===undefined||data.id===null||data.id===''?'':String(data.id);
        const existing=givenId?db.prepare('SELECT * FROM events WHERE id=?').get(givenId):null;
        if(givenId&&!existing)throw failure(404,'Evento no encontrado.');
        if(existing&&existing.owner_id!==activeUser.id)throw failure(404,'No puedes modificar eventos de otra cuenta.');
        if(existing?.status==='cancelled')throw failure(409,'El evento fue cancelado y ya no se puede editar.');
        if(existing?.status==='published')return reply(200,updatePublished(existing,data));
        if(!String(data.name||'').trim())throw failure(400,'El evento necesita nombre y al menos una zona.');
        const old=existing&&JSON.parse(existing.payload);
        data.functions=Array.isArray(data.functions)&&data.functions.length?data.functions:[{id:'1',date:data.date,hour:data.hour||'20:00'}];
        checkFunctions(data.functions,old?.functions||[]);
        data.date=data.functions[0].date;data.hour=data.functions[0].hour;
        data.blockedSeats=Array.isArray(data.blockedSeats)?data.blockedSeats.map(String):[];
        checkZones(data.zones,data.blockedSeats);
        data.ticketLimit=Number(data.ticketLimit||6);if(!Number.isInteger(data.ticketLimit)||data.ticketLimit<1||data.ticketLimit>6)throw failure(400,'El límite por compra debe ser de 1 a 6 boletos.');
        if(data.saleStart&&data.saleEnd&&(!Number.isFinite(Date.parse(data.saleStart))||!Number.isFinite(Date.parse(data.saleEnd))||Date.parse(data.saleEnd)<=Date.parse(data.saleStart)))throw failure(400,'El cierre de venta debe ocurrir después del inicio.');
        // A draft saved before these rules could already have sales: they keep their functions, zones and prices.
        if(existing){
          const sold=db.prepare('SELECT COALESCE(SUM(sold),0) AS total FROM event_sales WHERE event_id=?').get(existing.id).total;
          if(sold&&JSON.stringify((old.functions||[]).map(functionKey))!==JSON.stringify(data.functions.map(functionKey)))throw failure(409,'No puedes cambiar o quitar funciones después de registrar ventas.');
          for(const s of db.prepare('SELECT zone,sold FROM event_sales WHERE event_id=?').all(existing.id)){const before=(old.zones||[]).find(z=>z.name===s.zone),after=data.zones.find(z=>z.name===s.zone);if(!after||Number(after.capacity)<s.sold)throw failure(409,`Zona ${s.zone}: ${s.sold} boletos vendidos; no se puede quitar ni reducir el cupo.`);if(s.sold&&Number(before?.price)!==Number(after.price))throw failure(409,`El precio de ${s.zone} no se puede cambiar porque ya hay ventas.`);}
        }
        const id=existing?.id||newEventId();
        db.prepare("INSERT INTO events VALUES(?,?,?,'draft','',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status='draft',updated=excluded.updated").run(id,activeUser.id,JSON.stringify({...data,id}),now,now);
        return reply(200,{id,status:'draft'});
      }
      if (path.startsWith('/api/events/') && req.method === 'POST') { const [, , , id, action]=path.split('/'),ev=db.prepare('SELECT * FROM events WHERE id=?').get(id);if(!ev)throw failure(404,'Evento no encontrado.');if(action==='submit'){if(!activeUser||activeUser.role!=='organizador'||ev.owner_id!==activeUser.id)throw failure(403,'No puedes enviar este evento.');if(ev.status==='cancelled')throw failure(409,'El evento fue cancelado.');if(ev.status==='published')throw failure(409,'El evento ya está publicado y sigue a la venta; no necesita otra revisión.');db.prepare("UPDATE events SET status='review',review_reason='',updated=? WHERE id=?").run(now,id);return reply(200,{ok:true});}if(action==='decision'){requireAdmin();if(ev.status!=='review')throw failure(409,'Este evento no está en revisión.');if(!data.approve&&!String(data.reason||'').trim())throw failure(400,'Escribe el motivo del rechazo.');if(data.approve){const p=JSON.parse(ev.payload),fns=p.functions?.length?p.functions:[{date:p.date,hour:p.hour||'20:00'}];if(!fns.some(fn=>startsAt(fn.date,fn.hour)>clock()))throw failure(409,'No se puede publicar: todas sus funciones ya pasaron. Pide al organizador que cambie la fecha.');}db.prepare('UPDATE events SET status=?,review_reason=?,updated=? WHERE id=?').run(data.approve?'published':'rejected',String(data.reason||''),now,id);audit.record(activeUser,data.approve?'evento.aprobado':'evento.rechazado',{targetType:'evento',targetId:id,eventId:id,details:`${JSON.parse(ev.payload).name}${data.reason?` · ${data.reason}`:''}`});notify.eventDecision(id,Boolean(data.approve),String(data.reason||''));return reply(200,{ok:true});}if(action==='delete'){if(!activeUser||activeUser.role!=='organizador'||ev.owner_id!==activeUser.id)throw failure(403,'No puedes borrar este evento.');if(ev.status==='published')throw failure(409,'Un evento publicado no se borra: pide su cancelación en el panel del evento.');const sold=db.prepare('SELECT COALESCE(SUM(sold),0) AS count FROM event_sales WHERE event_id=?').get(id).count;if(sold)throw failure(409,`No se puede borrar: el evento ya tiene ${sold} boletos vendidos.`);db.prepare('DELETE FROM events WHERE id=?').run(id);return reply(200,{ok:true});} }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookie(req)));
        res.setHeader('Set-Cookie', `eticket_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
        return reply(200, { ok: true });
      }
      if (req.method !== 'POST') throw failure(405, 'Método no permitido.');
      if (path === '/api/auth/register' || path === '/api/auth/login') {
        const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw failure(400, 'Introduce un correo válido.');
        let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (path !== '/api/auth/login' && !passwordValid(data.password)) throw failure(400, 'La contraseña debe tener entre 6 y 15 caracteres, una mayúscula y un carácter especial.');
        if (path.endsWith('/login') && (typeof data.password !== 'string' || !data.password.length || data.password.length > 128)) throw failure(401, 'Correo o contraseña incorrectos.');
        if (path.endsWith('/register')) {
          const firstNames = typeof data.firstNames === 'string' ? data.firstNames.trim() : '';
          const paternalSurname = typeof data.paternalSurname === 'string' ? data.paternalSurname.trim() : '';
          const maternalSurname = typeof data.maternalSurname === 'string' ? data.maternalSurname.trim() : '';
          const lastNames = `${paternalSurname} ${maternalSurname}`;
          if (!firstNames || firstNames.length > 40) throw failure(400, 'Escribe tus nombres (máximo 40 caracteres).');
          if (!paternalSurname || paternalSurname.length > 19) throw failure(400, 'Escribe tu apellido paterno (máximo 19 caracteres).');
          if (!maternalSurname || maternalSurname.length > 19) throw failure(400, 'Escribe tu apellido materno (máximo 19 caracteres).');
          if (data.password !== data.confirmPassword) throw failure(400, 'Las contraseñas no coinciden.');
          const name = `${firstNames} ${lastNames}`;
          // Nothing is saved when no code can be sent, so the address is never left half registered.
          if (!smtp && !devMail) throw noMail();
          if (user?.verified) throw failure(409, 'Este correo ya está registrado. Inicia sesión o recupera tu contraseña.');
          const encoded = await passwordHash(data.password);
          if (user) {
            // An unverified registration never proved the address, so registering again replaces it.
            db.prepare('UPDATE users SET name=?,password_hash=?,first_names=?,last_names=?,paternal_surname=?,maternal_surname=?,failed_logins=0,locked_until=0 WHERE id=?').run(name, encoded, firstNames, lastNames, paternalSurname, maternalSurname, user.id);
            user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
          } else {
            try {
              db.prepare('INSERT INTO users (id,email,name,password_hash,created,first_names,last_names,paternal_surname,maternal_surname) VALUES (?,?,?,?,?,?,?,?,?)').run(token(), email, name, encoded, now, firstNames, lastNames, paternalSurname, maternalSurname);
            } catch (error) {
              if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw failure(409, 'Este correo ya está registrado.');
              throw error;
            }
            user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
          }
          if (env.ADMIN_EMAIL && env.ADMIN_EMAIL.trim().toLowerCase() === email) { db.prepare("UPDATE users SET role='administrador' WHERE id=?").run(user.id); user=db.prepare('SELECT * FROM users WHERE id=?').get(user.id); }
          await deliverCode(user,'verify');
          return reply(201, { requiresVerification:true,email:user.email,...devNote });
        }
        if (user?.locked_until > now) throw failure(423, 'Cuenta bloqueada durante 15 minutos.');
        const fallbackHash = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
        const matches = await passwordMatches(data.password, user?.password_hash || fallbackHash);
        if (!user || !matches) {
          if (user) {
            const attempts=(user.failed_logins||0)+1, locked=attempts>=5;
            db.prepare('UPDATE users SET failed_logins=?,locked_until=? WHERE id=?').run(locked?0:attempts,locked?now+900000:0,user.id);
            if (locked) throw failure(423, 'Demasiados intentos fallidos: la cuenta quedó bloqueada 15 minutos.');
          }
          throw failure(401, 'Correo o contraseña incorrectos.');
        }
        db.prepare('UPDATE users SET failed_logins=0,locked_until=0 WHERE id=?').run(user.id);
        // The screen offers to send a new code right there.
        if (!user.verified) throw Object.assign(failure(403, 'Verifica tu correo antes de iniciar sesión.'), { extra: { unverified: true } });
        setSession(res, user);
        return reply(200, { user: publicUser(user) });
      }
      throw failure(404, 'Ruta no disponible.');
    } catch (error) {
      if (authLimited && error.status && error.status !== 429) countAttempt(rateKey);
      if (!error.status) console.error('Error de cuentas:', error.code || error.name);
      reply(error.status || 500, { error: error.status ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.', ...(error.status && error.extra) });
    }
  };
  return {
    middleware,
    // Tests wait for queued e-mails and run the scheduled tasks with a simulated clock.
    flush: () => mail.flush(),
    runScheduled: scheduled,
    close: () => { clearInterval(sweeper); mail.close(); db.close(); },
  };
}
