import { randomBytes } from 'node:crypto';

// Sends the platform's e-mails and keeps a copy of each one in the outbox table,
// so the administrator can see what was sent even when SMTP is not configured.
// Attachments can be built lazily (PDFs) so a request never waits for them.
export function createMailer(db, { transport, from = 'eTicket <no-reply@eticket.local>', clock = Date.now, log = console.log }) {
  db.exec(`CREATE TABLE IF NOT EXISTS outbox(
      id TEXT PRIMARY KEY, created INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT '',
      to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', sent INTEGER
    );
    CREATE INDEX IF NOT EXISTS outbox_created ON outbox(created);`);
  const pending = new Set();
  let closed = false;
  const update = (sql, ...args) => { if (!closed) db.prepare(sql).run(...args); };

  function send({ to, subject, text, kind = '', attachments = null }) {
    const id = randomBytes(8).toString('hex');
    db.prepare("INSERT INTO outbox(id,created,kind,to_email,subject,body,status) VALUES(?,?,?,?,?,?,'pendiente')").run(id, clock(), kind, to, subject, text);
    const job = (async () => {
      try {
        const files = typeof attachments === 'function' ? await attachments() : attachments || [];
        update('UPDATE outbox SET attachments=? WHERE id=?', JSON.stringify(files.map(f => f.filename)), id);
        if (!transport) { update("UPDATE outbox SET status='sin SMTP' WHERE id=?", id); return; }
        await transport.sendMail({ from, to, subject, text, attachments: files });
        update("UPDATE outbox SET status='enviado', sent=? WHERE id=?", clock(), id);
      } catch (error) {
        log(`No se pudo enviar el correo «${subject}»: ${error.message}`);
        update("UPDATE outbox SET status='error', error=? WHERE id=?", String(error.message).slice(0, 300), id);
      }
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
    return id;
  }

  const flush = () => Promise.allSettled([...pending]);
  const list = (limit = 100) => db.prepare('SELECT id,created,kind,to_email,subject,attachments,status,error FROM outbox ORDER BY created DESC LIMIT ?').all(limit)
    .map(m => ({ id: m.id, created: m.created, kind: m.kind, to: m.to_email, subject: m.subject, attachments: JSON.parse(m.attachments), status: m.status, error: m.error }));
  const close = () => { closed = true; };
  return { send, flush, list, close };
}
