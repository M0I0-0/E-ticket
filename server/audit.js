// K-18 / RN-19: who did what and when. Every sensitive action records one row.
export const AUDIT_LABELS = {
  'organizador.aprobado': 'Aprobó un organizador',
  'organizador.rechazado': 'Rechazó un organizador',
  'evento.aprobado': 'Aprobó un evento',
  'evento.rechazado': 'Rechazó un evento',
  'cancelacion.solicitada': 'Solicitó cancelar un evento',
  'cancelacion.aprobada': 'Aprobó una cancelación',
  'cancelacion.rechazada': 'Rechazó una cancelación',
  'reembolso.emitido': 'Emitió un reembolso',
  'reembolso.fallido': 'Reembolso rechazado por la pasarela',
  'reembolso.resuelto': 'Resolvió un reembolso fallido',
  'usuario.bloqueado': 'Bloqueó un usuario',
  'usuario.desbloqueado': 'Desbloqueó un usuario',
  'rol.cambiado': 'Cambió un rol',
  'escaneo.revertido': 'Revirtió un escaneo',
  'comision.cambiada': 'Cambió la comisión',
  'personal.asignado': 'Asignó personal',
  'personal.retirado': 'Retiró personal',
  'boleto.transferido': 'Transfirió un boleto',
  'funcion.reprogramada': 'Cambió la fecha de una función',
};

export function createAudit(db, clock = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT, created INTEGER NOT NULL,
      actor_id TEXT, actor_email TEXT NOT NULL, actor_role TEXT NOT NULL,
      action TEXT NOT NULL, target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
      event_id TEXT, details TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS audit_created ON audit_log(created);`);
  const insert = db.prepare('INSERT INTO audit_log(created,actor_id,actor_email,actor_role,action,target_type,target_id,event_id,details) VALUES(?,?,?,?,?,?,?,?,?)');

  function record(actor, action, { targetType = '', targetId = '', eventId = null, details = '' } = {}) {
    insert.run(clock(), actor?.id ?? null, actor?.email ?? 'sistema', actor?.role ?? 'sistema', action, targetType, String(targetId ?? ''), eventId == null ? null : String(eventId), String(details ?? ''));
  }

  function list({ action = '', from = null, to = null, limit = 300 } = {}) {
    const where = [], args = [];
    if (action) { where.push('action=?'); args.push(action); }
    if (from != null) { where.push('created>=?'); args.push(from); }
    if (to != null) { where.push('created<=?'); args.push(to); }
    return db.prepare(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created DESC, id DESC LIMIT ?`).all(...args, limit)
      .map(r => ({ id: r.id, created: r.created, actorEmail: r.actor_email, actorRole: r.actor_role, action: r.action, label: AUDIT_LABELS[r.action] || r.action, targetType: r.target_type, targetId: r.target_id, eventId: r.event_id, details: r.details }));
  }

  return { record, list };
}
