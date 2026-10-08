import { longDate } from './pdf.js';

const DAY = 86400000;

// K-17: automatic e-mails — event decisions, sold-out functions and the 24-hour reminder.
export function createNotify(db, { mailer, catalog, tickets, clock = Date.now }) {
  db.exec('CREATE TABLE IF NOT EXISTS notices(kind TEXT NOT NULL, key TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(kind, key))');
  const seen = (kind, key) => Boolean(db.prepare('SELECT 1 FROM notices WHERE kind=? AND key=?').get(kind, key));
  const mark = (kind, key) => db.prepare('INSERT OR IGNORE INTO notices(kind,key,created) VALUES(?,?,?)').run(kind, key, clock());
  // Sample events have no organizer, so their notices go to the administrators.
  const recipients = ev => ev.ownerId
    ? [db.prepare('SELECT email, name FROM users WHERE id=?').get(ev.ownerId)].filter(Boolean)
    : db.prepare("SELECT email, name FROM users WHERE role='administrador'").all();
  const when = f => `${longDate(f.date)} · ${f.hour} h`;

  function eventDecision(eventId, approved, reason = '') {
    const ev = catalog.event(eventId);
    if (!ev) return;
    for (const to of recipients(ev)) mailer.send({
      to: to.email, kind: approved ? 'evento aprobado' : 'evento rechazado',
      subject: approved ? `Tu evento «${ev.name}» fue aprobado` : `Tu evento «${ev.name}» fue rechazado`,
      text: [`Hola, ${to.name}:`, '', approved ? `La administración aprobó «${ev.name}». Ya aparece en la cartelera y está a la venta.` : `La administración rechazó «${ev.name}».`, ...(approved ? [] : [`Motivo: ${reason}`, '', 'Puedes corregir el evento y volver a enviarlo a revisión.']), '', 'eTicket'].join('\n'),
    });
  }

  // Sent once when sales use up a function; a released seat allows a new notice later.
  function afterSale(eventId, functionId) {
    const ev = catalog.event(eventId), f = catalog.fn(ev, functionId);
    if (!ev || !f || !tickets.functionStats(ev, f.id).soldOutBySales) return;
    const key = `${ev.id}:${f.id}`;
    if (seen('agotado', key)) return;
    mark('agotado', key);
    for (const to of recipients(ev)) mailer.send({
      to: to.email, kind: 'evento agotado', subject: `Se agotó «${ev.name}» (${f.date} ${f.hour})`,
      text: [`Hola, ${to.name}:`, '', `Se vendieron todos los lugares de «${ev.name}» para la función del ${when(f)}.`, 'Si alguien recibe un reembolso, el lugar vuelve a la venta automáticamente.', '', 'eTicket'].join('\n'),
    });
  }
  function afterRelease(ev, functionId) {
    if (ev && !tickets.functionStats(ev, functionId).soldOutBySales) db.prepare("DELETE FROM notices WHERE kind='agotado' AND key=?").run(`${ev.id}:${functionId}`);
  }

  // One reminder per person and function, during the 24 hours before it starts.
  function runScheduled() {
    const now = clock();
    let sent = 0;
    for (const ev of catalog.listed().filter(Boolean)) for (const f of ev.functions) {
      if (!(f.startsAt > now && f.startsAt - now <= DAY)) continue;
      const rows = db.prepare("SELECT t.seat, t.zone, u.id AS owner, u.email, u.name FROM tickets t JOIN users u ON u.id=t.owner_id WHERE t.event_id=? AND t.function_id=? AND t.status='valid'").all(ev.id, f.id);
      const owners = new Map();
      for (const r of rows) owners.set(r.owner, [...(owners.get(r.owner) || []), r]);
      for (const [owner, list] of owners) {
        const key = `${ev.id}:${f.id}:${owner}`;
        if (seen('recordatorio', key)) continue;
        mark('recordatorio', key);
        sent++;
        mailer.send({
          to: list[0].email, kind: 'recordatorio', subject: `Recordatorio: «${ev.name}» es mañana`,
          text: [`Hola, ${list[0].name}:`, '', `Te recordamos que «${ev.name}» es el ${when(f)}.`, `Lugar: ${[ev.venue, ev.city].filter(Boolean).join(', ')}`, `Tus boletos: ${list.map(r => `${r.zone} · ${r.seat}`).join(', ')}`, '', 'Ten a la mano tus QR en «Mis boletos» o en los PDF que te enviamos. Las puertas abren una hora antes.', '', 'eTicket'].join('\n'),
        });
      }
    }
    return sent;
  }

  return { eventDecision, afterSale, afterRelease, runScheduled };
}
