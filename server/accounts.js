import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const hash = text => createHash('sha256').update(text).digest('hex');
const token = () => randomBytes(32).toString('hex');
const publicUser = u => ({ id: u.id, name: u.name, firstNames: u.first_names, lastNames: u.last_names, paternalSurname: u.paternal_surname, maternalSurname: u.maternal_surname, email: u.email });
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
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'first_names')) db.exec("ALTER TABLE users ADD COLUMN first_names TEXT NOT NULL DEFAULT '';");
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'last_names')) db.exec("ALTER TABLE users ADD COLUMN last_names TEXT NOT NULL DEFAULT '';");
  for (const column of ['paternal_surname','maternal_surname']) {
    if (!db.prepare('PRAGMA table_info(users)').all().some(item => item.name === column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
  const limits = new Map();
  const failure = (status, message) => Object.assign(new Error(message), { status });
  const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('eticket_session='))?.slice(16) || '';
  const sessionUser = req => db.prepare(`SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires>? AND u.verified=1`).get(hash(cookie(req)), Date.now());
  const secureCookie = env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  const setSession = (res, user) => {
    const value = token();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(value), user.id, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', `eticket_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookie}`);
  };
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
    try {
      const now = Date.now();
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
      if (req.method === 'GET' && path === '/api/auth/me') return reply(200, { user: sessionUser(req) ? publicUser(sessionUser(req)) : null });
      if (req.method === 'GET' && path === '/api/orders') {
        const user = sessionUser(req);
        if (!user) throw failure(401, 'Inicia sesión para consultar tus datos.');
        return reply(200, { orders: JSON.parse(db.prepare('SELECT payload FROM user_orders WHERE user_id=?').get(user.id)?.payload || '[]') });
      }
      if (!['POST', 'PUT'].includes(req.method)) throw failure(405, 'Método no permitido.');
      if (!req.headers['content-type']?.startsWith('application/json')) throw failure(415, 'Usa JSON.');
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw failure(403, 'Origen no permitido.');
      if (path.startsWith('/api/auth/')) {
        for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
        const key = req.socket.remoteAddress;
        const rate = limits.get(key) || { count: 0, until: now + 900000 };
        if (++rate.count > 40) throw failure(429, 'Demasiados intentos. Espera 15 minutos.');
        limits.set(key, rate);
      }
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > (path === '/api/orders' ? 512000 : 8192)) throw failure(413, 'Solicitud demasiado grande.');
      }
      let data;
      try { data = JSON.parse(text); } catch { throw failure(400, 'Solicitud inválida.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure(400, 'Solicitud inválida.');
      if (path === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookie(req)));
        res.setHeader('Set-Cookie', `eticket_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
        return reply(200, { ok: true });
      }
      if (path === '/api/orders' && req.method === 'PUT') {
        const user = sessionUser(req);
        if (!user) throw failure(401, 'Tu sesión venció. Vuelve a iniciar sesión.');
        // This stores the existing simulated purchases, never proof of payment.
        if (!Array.isArray(data.orders) || data.orders.length > 500 || data.orders.some(o =>
          !o || typeof o.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(o.id) || ![1,2,3,4,5].includes(o.eventId) || !Number.isFinite(o.total) || o.total < 0 ||
          typeof o.time !== 'string' || !Number.isFinite(Date.parse(o.time)) || !Array.isArray(o.tickets) || o.tickets.length > 6 || o.tickets.some(t =>
            !t || typeof t.seat !== 'string' || !/^(?:[A-D][1-8]|Acceso [1-6])$/.test(t.seat) || typeof t.owner !== 'string' || t.owner.length > 80 || typeof t.code !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(t.code) || typeof t.transferred !== 'boolean'))
        ) throw failure(400, 'Datos de compra inválidos.');
        db.prepare('INSERT INTO user_orders (user_id,payload) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload')
          .run(user.id, JSON.stringify(data.orders));
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
          if (user) {
            if (user.verified || !await passwordMatches(data.password, user.password_hash)) throw failure(409, 'Este correo ya está registrado. Inicia sesión o recupera tu contraseña.');
          } else {
            const encoded = await passwordHash(data.password);
            try {
              db.prepare('INSERT INTO users (id,email,name,password_hash,created,first_names,last_names,paternal_surname,maternal_surname) VALUES (?,?,?,?,?,?,?,?,?)').run(token(), email, name, encoded, now, firstNames, lastNames, paternalSurname, maternalSurname);
            } catch (error) {
              if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw failure(409, 'Este correo ya está registrado.');
              throw error;
            }
            user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
          }
          db.prepare('UPDATE users SET verified=1 WHERE id=?').run(user.id);
          setSession(res, user);
          return reply(201, { user: publicUser(user) });
        }
        // Derive a key for missing users too, to avoid a fast unknown-email path.
        const matches = await passwordMatches(data.password, user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
        if (!user || !matches) throw failure(401, 'Correo o contraseña incorrectos.');
        if (!user.verified) db.prepare('UPDATE users SET verified=1 WHERE id=?').run(user.id);
        setSession(res, user);
        return reply(200, { user: publicUser(user) });
      }
      throw failure(404, 'Ruta no disponible.');
    } catch (error) {
      if (!error.status) console.error('Error de cuentas:', error.code || error.name);
      reply(error.status || 500, { error: error.status ? error.message : 'No se pudo completar la operación. Inténtalo de nuevo.' });
    }
  };
  return { middleware, close: () => db.close() };
}
