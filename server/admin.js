// T10.5 and T10.6: user management and the service-fee setting.
export const DEFAULT_FEE_RATE = 0.10;

export function createAdmin(db, { failure, clock = Date.now, audit }) {
  db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL, updated_by TEXT)');
  const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!columns.includes('blocked')) db.exec('ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('blocked_reason')) db.exec("ALTER TABLE users ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT ''");

  const feeRate = () => {
    const value = Number(db.prepare("SELECT value FROM settings WHERE key='service_fee_rate'").get()?.value);
    return Number.isFinite(value) ? value : DEFAULT_FEE_RATE;
  };
  // Holds keep the rate they were created with, so a change only affects new purchases.
  function setFeeRate(actor, data) {
    const percent = Number(data?.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 30) throw failure(400, 'La comisión debe estar entre 0 % y 30 %.');
    const before = feeRate(), rate = Math.round(percent * 100) / 10000;
    db.prepare("INSERT INTO settings(key,value,updated,updated_by) VALUES('service_fee_rate',?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated, updated_by=excluded.updated_by").run(String(rate), clock(), actor.id);
    audit.record(actor, 'comision.cambiada', { targetType: 'configuración', targetId: 'cargo por servicio', details: `${Math.round(before * 10000) / 100} % → ${Math.round(rate * 10000) / 100} %` });
    return { serviceFeeRate: rate };
  }

  function searchUsers(query = '') {
    const q = `%${String(query).trim().toLowerCase()}%`;
    return db.prepare(`SELECT u.id, u.email, u.name, u.role, u.blocked, u.blocked_reason, u.created,
        (SELECT COUNT(*) FROM tickets t WHERE t.owner_id=u.id AND t.status='valid') AS tickets
      FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ? ORDER BY u.name LIMIT 100`).all(q, q)
      .map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, blocked: Boolean(u.blocked), blockedReason: u.blocked_reason, created: u.created, tickets: u.tickets }));
  }

  // A blocked account can still sign in and use its tickets, but it cannot buy.
  function setBlocked(actor, userId, data) {
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(String(userId));
    if (!target) throw failure(404, 'Usuario no encontrado.');
    if (target.id === actor.id) throw failure(400, 'No puedes bloquear tu propia cuenta.');
    if (target.role === 'administrador') throw failure(400, 'No se puede bloquear a un administrador.');
    const blocked = Boolean(data?.blocked), reason = String(data?.reason || '').trim().slice(0, 200);
    if (blocked && !reason) throw failure(400, 'Escribe el motivo del bloqueo.');
    db.prepare('UPDATE users SET blocked=?, blocked_reason=? WHERE id=?').run(blocked ? 1 : 0, blocked ? reason : '', target.id);
    audit.record(actor, blocked ? 'usuario.bloqueado' : 'usuario.desbloqueado', { targetType: 'usuario', targetId: target.email, details: reason });
    return { ok: true, blocked };
  }

  return { feeRate, setFeeRate, searchUsers, setBlocked };
}
