import { REPORTS } from './reports.js';

// Small router for the Entrega 3 endpoints. ':name' never matches '/' or '.', so
// '/api/admin/reports/:name.csv' and '/api/admin/reports/:name' do not collide.
export function createRouter() {
  const routes = [];
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const add = (method, pattern, handler) => {
    const keys = [];
    const source = pattern.split(/(:\w+)/).map(part => part.startsWith(':') ? (keys.push(part.slice(1)), '([^/.]+)') : escape(part)).join('');
    routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler });
  };
  const match = (method, path) => {
    for (const route of routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(path);
      if (found) return { handler: route.handler, params: Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(found[i + 1])])) };
    }
    return null;
  };
  return { get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h), put: (p, h) => add('PUT', p, h), match };
}

export function registerRoutes(router, { failure, admin, tickets, refunds, reports, audit, mailer }) {
  const signedIn = user => { if (!user) throw failure(401, 'Inicia sesión para continuar.'); return user; };
  const role = (user, ...roles) => { signedIn(user); if (!roles.includes(user.role)) throw failure(403, 'No tienes permiso para esta acción.'); return user; };
  const query = (q, key) => q.get(key) || '';
  const download = (send, body, type, filename) => send(200, body, type, { 'Content-Disposition': `attachment; filename="${filename}"` });
  const slug = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'reporte';

  router.get('/api/settings', () => ({ serviceFeeRate: admin.feeRate() }));

  // ---- Buyer: Mis boletos, QR, PDF, transfers and refund requests (T09.2, T11.1, T11.6)
  router.get('/api/tickets', ({ user }) => ({ tickets: tickets.ticketsFor(signedIn(user)) }));
  router.get('/api/tickets/:id/qr.svg', async ({ user, params, send }) => send(200, await tickets.qr(signedIn(user), params.id), 'image/svg+xml; charset=utf-8'));
  router.get('/api/tickets/:id/pdf', async ({ user, params, send }) => {
    const file = await tickets.pdf(signedIn(user), params.id);
    download(send, file.content, 'application/pdf', file.filename);
  });
  router.post('/api/tickets/:id/transfer', ({ user, params, data }) => tickets.transfer(signedIn(user), params.id, data));
  router.post('/api/tickets/:id/refund-request', ({ user, params }) => refunds.requestRefund(signedIn(user), params.id));

  // ---- Staff at the gate (T09.4 to T09.8)
  router.get('/api/staff/assignments', ({ user }) => ({ assignments: tickets.assignmentsFor(role(user, 'taquilla')) }));
  router.get('/api/staff/counter/:eventId/:functionId', ({ user, params }) => {
    role(user, 'taquilla');
    if (!tickets.assigned(user.id, params.eventId, params.functionId)) throw failure(403, 'No tienes asignada esta función.');
    return tickets.counter(params.eventId, params.functionId);
  });
  router.post('/api/scan', ({ user, data }) => tickets.scan(role(user, 'taquilla'), data));

  // ---- Organizer (or administrator) managing one event
  router.get('/api/organizer/events/:id/report', ({ user, params }) => ({ ...reports.eventReport(role(user, 'organizador', 'administrador'), params.id), cancellation: refunds.cancellationFor(params.id) || null }));
  router.get('/api/organizer/events/:id/report.csv', ({ user, params, send }) => {
    const { name, csv } = reports.eventReportCsv(role(user, 'organizador', 'administrador'), params.id);
    download(send, csv, 'text/csv; charset=utf-8', `reporte-${slug(name)}.csv`);
  });
  router.get('/api/staff/candidates', ({ user }) => (role(user, 'organizador', 'administrador'), { users: tickets.candidates() }));
  router.post('/api/events/:id/staff', ({ user, params, data }) => tickets.assign(role(user, 'organizador', 'administrador'), { ...data, eventId: params.id }));
  router.post('/api/events/:id/staff/remove', ({ user, params, data }) => tickets.assign(role(user, 'organizador', 'administrador'), { ...data, eventId: params.id }, true));
  router.post('/api/tickets/:id/revert-scan', ({ user, params, data }) => tickets.revertScan(role(user, 'organizador', 'administrador'), params.id, data));
  router.post('/api/events/:id/cancel-request', ({ user, params, data }) => refunds.requestCancel(role(user, 'organizador'), params.id, data));
  router.post('/api/events/:id/functions/:functionId/reschedule', ({ user, params, data }) => refunds.reschedule(role(user, 'organizador', 'administrador'), params.id, params.functionId, data));

  // ---- Administrator
  router.get('/api/admin/settings', ({ user }) => (role(user, 'administrador'), { serviceFeeRate: admin.feeRate() }));
  router.put('/api/admin/settings', ({ user, data }) => admin.setFeeRate(role(user, 'administrador'), data));
  router.post('/api/admin/users/:id/block', ({ user, params, data }) => admin.setBlocked(role(user, 'administrador'), params.id, data));
  router.get('/api/admin/reports', ({ user }) => (role(user, 'administrador'), { reports: REPORTS }));
  router.get('/api/admin/reports/:name.csv', ({ user, params, query: q, send }) => {
    role(user, 'administrador');
    const csv = reports.adminReportCsv(params.name, { from: query(q, 'from'), to: query(q, 'to') });
    download(send, csv, 'text/csv; charset=utf-8', `${params.name}${query(q, 'from') ? `-${query(q, 'from')}` : ''}${query(q, 'to') ? `-a-${query(q, 'to')}` : ''}.csv`);
  });
  router.get('/api/admin/reports/:name', ({ user, params, query: q }) => (role(user, 'administrador'), reports.adminReport(params.name, { from: query(q, 'from'), to: query(q, 'to') })));
  router.get('/api/admin/audit', ({ user, query: q }) => {
    role(user, 'administrador');
    const from = query(q, 'from'), to = query(q, 'to');
    return { entries: audit.list({ action: query(q, 'action'), from: from ? new Date(`${from}T00:00:00`).getTime() : null, to: to ? new Date(`${to}T23:59:59.999`).getTime() : null }) };
  });
  router.get('/api/admin/outbox', ({ user }) => (role(user, 'administrador'), { messages: mailer.list() }));
  router.get('/api/admin/refunds', ({ user, query: q }) => (role(user, 'administrador'), { refunds: refunds.listRefunds(query(q, 'status')) }));
  router.post('/api/admin/refunds/:id/retry', ({ user, params }) => refunds.retry(role(user, 'administrador'), params.id));
  router.post('/api/admin/refunds/:id/resolve', ({ user, params, data }) => refunds.resolve(role(user, 'administrador'), params.id, data));
  router.get('/api/admin/cancellations', ({ user }) => (role(user, 'administrador'), { cancellations: refunds.cancellations() }));
  router.post('/api/admin/cancellations/:id/decision', ({ user, params, data }) => refunds.decideCancel(role(user, 'administrador'), params.id, data));
  router.post('/api/admin/tickets/:id/refund', ({ user, params, data }) => refunds.refundTicket(role(user, 'administrador'), params.id, data));
  router.get('/api/admin/orders/:id', ({ user, params }) => {
    role(user, 'administrador');
    const order = tickets.findOrder(params.id);
    if (!order) throw failure(404, 'No encontramos esa orden.');
    return { order };
  });
}
