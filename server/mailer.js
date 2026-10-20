import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';

// SMTP settings from .env. Port 465 uses TLS from the start; with 587 the server
// upgrades the connection, so SMTP_SECURE only needs to be written to override that.
export function smtpOptions(env = {}) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const port = Number(env.SMTP_PORT || 465);
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : port === 465;
  return { host: env.SMTP_HOST, port, secure, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } };
}
export const smtpTransport = env => { const settings = smtpOptions(env); return settings ? nodemailer.createTransport(settings) : null; };
export const senderFor = env => env.SMTP_FROM || (env.SMTP_USER ? `eTicket <${env.SMTP_USER}>` : undefined);

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

  function record(kind, to, subject, body) {
    const id = randomBytes(8).toString('hex');
    db.prepare("INSERT INTO outbox(id,created,kind,to_email,subject,body,status) VALUES(?,?,?,?,?,?,'pendiente')").run(id, clock(), kind, to, subject, body);
    return id;
  }
  // A transport that only pretends to send (the demo data script) answers { simulated: true }.
  async function deliver(id, { to, subject, text, attachments }) {
    const files = typeof attachments === 'function' ? await attachments() : attachments || [];
    update('UPDATE outbox SET attachments=? WHERE id=?', JSON.stringify(files.map(f => f.filename)), id);
    if (!transport) { update("UPDATE outbox SET status='sin SMTP' WHERE id=?", id); return 'sin SMTP'; }
    const info = await transport.sendMail({ from, to, subject, text, attachments: files });
    const status = info?.simulated ? 'simulado' : 'enviado';
    update('UPDATE outbox SET status=?, sent=? WHERE id=?', status, clock(), id);
    return status;
  }
  function failed(id, subject, error) {
    log(`No se pudo enviar el correo «${subject}»: ${error.message}`);
    update("UPDATE outbox SET status='error', error=? WHERE id=?", String(error.message).slice(0, 300), id);
  }

  function send({ to, subject, text, kind = '', attachments = null }) {
    const id = record(kind, to, subject, text);
    const job = deliver(id, { to, subject, text, attachments }).catch(error => failed(id, subject, error));
    pending.add(job);
    job.finally(() => pending.delete(job));
    return id;
  }

  // For messages the person is waiting for (verification codes): waits for the answer
  // and throws if it fails. outboxText replaces the body in the outbox, so a code is never stored.
  async function sendNow({ to, subject, text, kind = '', outboxText = text }) {
    const id = record(kind, to, subject, outboxText);
    try { return await deliver(id, { to, subject, text }); }
    catch (error) { failed(id, subject, error); throw error; }
  }

  const flush = () => Promise.allSettled([...pending]);
  const list = (limit = 100) => db.prepare('SELECT id,created,kind,to_email,subject,attachments,status,error FROM outbox ORDER BY created DESC LIMIT ?').all(limit)
    .map(m => ({ id: m.id, created: m.created, kind: m.kind, to: m.to_email, subject: m.subject, attachments: JSON.parse(m.attachments), status: m.status, error: m.error }));
  const close = () => { closed = true; };
  return { send, sendNow, flush, list, close };
}
