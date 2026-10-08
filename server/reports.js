import { round } from './catalog.js';

const LIVE = "('valid','used')";
const csvCell = value => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvValue = (value, type) => {
  if (value == null || value === '') return '';
  if (type === 'money') return Number(value).toFixed(2);
  if (type === 'datetime') { const d = new Date(value); return `${d.toLocaleDateString('sv-SE')} ${d.toTimeString().slice(0, 5)}`; }
  return value;
};
// T10.4: UTF-8 with BOM and plain numbers, so Excel opens it with the same figures as the screen.
export function toCsv({ columns, rows, totals }) {
  const lines = [columns.map(c => csvCell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map(c => csvCell(csvValue(row[c.key], c.type))).join(','));
  if (totals) lines.push(columns.map((c, i) => csvCell(i === 0 ? 'Total' : csvValue(totals[c.key], c.type))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
const dayOf = ms => new Date(ms).toLocaleDateString('sv-SE');
// Columns marked total:false (unit prices, ranks) are not added up.
const sumBy = (rows, columns) => Object.fromEntries(columns.filter(c => (c.type === 'money' || c.type === 'int') && c.total !== false).map(c => [c.key, c.type === 'money' ? round(rows.reduce((n, r) => n + (Number(r[c.key]) || 0), 0)) : rows.reduce((n, r) => n + (Number(r[c.key]) || 0), 0)]));

export const REPORTS = {
  ventas: 'Ventas por periodo',
  comisiones: 'Comisiones',
  eventos: 'Eventos más vendidos',
  expiradas: 'Compras expiradas',
  reembolsos: 'Reembolsos',
};

export function createReports(db, { failure, catalog, tickets }) {
  // ---- T10.1 and T10.2: the organizer's dashboard for one event.
  function eventReport(actor, eventId) {
    const ev = catalog.event(eventId);
    if (!ev) throw failure(404, 'Evento no encontrado.');
    // T10.9: the check is on the server, so changing the URL does not help.
    if (!tickets.canManage(actor, ev)) throw failure(403, 'No tienes permiso para ver el reporte de este evento.');
    const rows = [], attendance = [];
    for (const f of ev.functions) {
      const stats = tickets.functionStats(ev, f.id);
      let fnSold = 0, fnScanned = 0;
      for (const z of stats.zones) {
        const agg = db.prepare(`SELECT COUNT(*) AS sold, COALESCE(SUM(status='used'),0) AS scanned, COALESCE(SUM(base),0) AS base, COALESCE(SUM(fee),0) AS fee, COALESCE(SUM(vat),0) AS vat
          FROM tickets WHERE event_id=? AND function_id=? AND zone=? AND status IN ${LIVE}`).get(ev.id, f.id, z.zone);
        fnSold += agg.sold; fnScanned += agg.scanned;
        rows.push({ functionId: f.id, function: `${f.date} ${f.hour}`, zone: z.zone, price: z.price, capacity: z.capacity, sold: agg.sold, held: z.held, available: z.available, courtesies: z.courtesies, scanned: agg.scanned, base: round(agg.base), fee: round(agg.fee), vat: round(agg.vat) });
      }
      attendance.push({ functionId: f.id, function: `${f.date} ${f.hour}`, sold: fnSold, scanned: fnScanned, rate: fnSold ? Math.round(fnScanned / fnSold * 1000) / 10 : 0 });
    }
    const money = db.prepare('SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS collected, COALESCE(SUM(refunded),0) AS refunded FROM orders WHERE event_id=?').get(ev.id);
    const sum = key => rows.reduce((n, r) => n + r[key], 0);
    const totals = {
      orders: money.orders, sold: sum('sold'), scanned: sum('scanned'), available: sum('available'), held: sum('held'), courtesies: sum('courtesies'), capacity: sum('capacity'),
      revenue: round(sum('base')), commission: round(sum('fee')), vat: round(sum('vat')),
      collected: round(money.collected), refunded: round(money.refunded),
      // The organizer is paid the ticket price; the platform keeps the service fee and VAT goes to taxes.
      settle: round(sum('base')),
    };
    return {
      event: { id: ev.id, name: ev.name, venue: ev.venue, city: ev.city, status: ev.status, sample: ev.sample, functions: ev.functions, zones: ev.zones.map(z => ({ name: z.name, type: z.type })) },
      rows, attendance, totals, scans: tickets.scansFor(ev.id), staff: tickets.staffFor(ev.id),
    };
  }
  const eventReportCsv = (actor, eventId) => {
    const report = eventReport(actor, eventId);
    const columns = [
      { key: 'function', label: 'Función', type: 'text' }, { key: 'zone', label: 'Zona', type: 'text' }, { key: 'price', label: 'Precio', type: 'money', total: false },
      { key: 'capacity', label: 'Cupo', type: 'int' }, { key: 'sold', label: 'Vendidos', type: 'int' }, { key: 'available', label: 'Disponibles', type: 'int' },
      { key: 'courtesies', label: 'Cortesías', type: 'int' }, { key: 'scanned', label: 'Escaneados', type: 'int' },
      { key: 'base', label: 'Ingresos por boletos', type: 'money' }, { key: 'fee', label: 'Comisión', type: 'money' }, { key: 'vat', label: 'IVA', type: 'money' },
    ];
    return { name: report.event.name, csv: toCsv({ columns, rows: report.rows, totals: sumBy(report.rows, columns) }) };
  };

  // ---- T10.3: administrator reports filtered by date.
  function range(from, to) {
    const valid = d => !d || (/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T12:00:00`).toLocaleDateString('sv-SE') === d);
    if (!valid(from) || !valid(to)) throw failure(400, 'Usa fechas válidas con formato AAAA-MM-DD.');
    const start = from ? new Date(`${from}T00:00:00`).getTime() : 0, end = to ? new Date(`${to}T23:59:59.999`).getTime() : 8.64e15;
    if (start > end) throw failure(400, 'La fecha inicial debe ser anterior a la final.');
    return [start, end];
  }
  const eventName = id => catalog.event(id)?.name || `Evento ${id}`;

  function adminReport(name, { from = '', to = '' } = {}) {
    if (!REPORTS[name]) throw failure(404, 'Reporte no encontrado.');
    const [start, end] = range(from, to);
    let columns, rows;
    if (name === 'ventas') {
      columns = [{ key: 'day', label: 'Día', type: 'text' }, { key: 'orders', label: 'Órdenes', type: 'int' }, { key: 'tickets', label: 'Boletos', type: 'int' }, { key: 'base', label: 'Subtotal', type: 'money' }, { key: 'fee', label: 'Cargo por servicio', type: 'money' }, { key: 'vat', label: 'IVA', type: 'money' }, { key: 'total', label: 'Total cobrado', type: 'money' }, { key: 'refunded', label: 'Reembolsado', type: 'money' }];
      const days = new Map();
      for (const o of db.prepare('SELECT * FROM orders WHERE created BETWEEN ? AND ? ORDER BY created').all(start, end)) {
        const d = days.get(dayOf(o.created)) || { day: dayOf(o.created), orders: 0, tickets: 0, base: 0, fee: 0, vat: 0, total: 0, refunded: 0 };
        d.orders++; d.tickets += o.quantity; d.base += o.base; d.fee += o.fee; d.vat += o.vat; d.total += o.total; d.refunded += o.refunded;
        days.set(d.day, d);
      }
      rows = [...days.values()].map(d => ({ ...d, base: round(d.base), fee: round(d.fee), vat: round(d.vat), total: round(d.total), refunded: round(d.refunded) }));
    } else if (name === 'comisiones') {
      columns = [{ key: 'event', label: 'Evento', type: 'text' }, { key: 'orders', label: 'Órdenes', type: 'int' }, { key: 'tickets', label: 'Boletos', type: 'int' }, { key: 'base', label: 'Subtotal', type: 'money' }, { key: 'rates', label: 'Tasa aplicada', type: 'text' }, { key: 'fee', label: 'Comisión cobrada', type: 'money' }];
      rows = db.prepare(`SELECT event_id, COUNT(*) AS orders, SUM(quantity) AS tickets, SUM(base) AS base, SUM(fee) AS fee, GROUP_CONCAT(DISTINCT fee_rate) AS rates
        FROM orders WHERE created BETWEEN ? AND ? GROUP BY event_id ORDER BY SUM(fee) DESC`).all(start, end)
        .map(r => ({ event: eventName(r.event_id), orders: r.orders, tickets: r.tickets, base: round(r.base), rates: String(r.rates).split(',').map(x => `${Math.round(Number(x) * 10000) / 100} %`).join(' / '), fee: round(r.fee) }));
    } else if (name === 'eventos') {
      columns = [{ key: 'rank', label: 'Lugar', type: 'int', total: false }, { key: 'event', label: 'Evento', type: 'text' }, { key: 'tickets', label: 'Boletos vendidos', type: 'int' }, { key: 'base', label: 'Ingresos por boletos', type: 'money' }, { key: 'total', label: 'Total cobrado', type: 'money' }];
      rows = db.prepare(`SELECT t.event_id, COUNT(*) AS tickets, SUM(t.base) AS base, SUM(t.price) AS total FROM tickets t JOIN orders o ON o.id=t.order_id
        WHERE o.created BETWEEN ? AND ? AND t.status IN ${LIVE} GROUP BY t.event_id ORDER BY COUNT(*) DESC, SUM(t.price) DESC`).all(start, end)
        .map((r, i) => ({ rank: i + 1, event: eventName(r.event_id), tickets: r.tickets, base: round(r.base), total: round(r.total) }));
    } else if (name === 'expiradas') {
      columns = [{ key: 'closed', label: 'Venció', type: 'datetime' }, { key: 'email', label: 'Cuenta', type: 'text' }, { key: 'event', label: 'Evento', type: 'text' }, { key: 'zone', label: 'Zona', type: 'text' }, { key: 'places', label: 'Lugares', type: 'text' }, { key: 'count', label: 'Cantidad', type: 'int' }, { key: 'reason', label: 'Motivo', type: 'text' }];
      rows = db.prepare("SELECT h.*, u.email FROM holds h JOIN users u ON u.id=h.user_id WHERE h.status='expired' AND h.closed BETWEEN ? AND ? ORDER BY h.closed DESC").all(start, end)
        .map(h => ({ closed: h.closed, email: h.email, event: eventName(h.event_id), zone: h.zone, places: h.kind === 'seat' ? JSON.parse(h.seats).join(' ') : `${h.quantity} accesos`, count: h.quantity, reason: h.close_reason }));
    } else {
      columns = [{ key: 'created', label: 'Fecha', type: 'datetime' }, { key: 'order', label: 'Orden', type: 'text' }, { key: 'event', label: 'Evento', type: 'text' }, { key: 'buyer', label: 'Comprador', type: 'text' }, { key: 'seat', label: 'Boleto', type: 'text' }, { key: 'kind', label: 'Tipo', type: 'text' }, { key: 'status', label: 'Estado', type: 'text' }, { key: 'amount', label: 'Monto', type: 'money' }, { key: 'detail', label: 'Motivo o error', type: 'text' }];
      const labels = { succeeded: 'Reembolsado', failed: 'Fallido', resolved: 'Resuelto a mano' };
      rows = db.prepare(`SELECT r.*, u.email, t.seat FROM refunds r JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=o.user_id LEFT JOIN tickets t ON t.id=r.ticket_id
        WHERE r.created BETWEEN ? AND ? ORDER BY r.created DESC`).all(start, end)
        .map(r => ({ created: r.created, order: r.order_id, event: eventName(r.event_id), buyer: r.email, seat: r.seat || 'Orden completa', kind: r.kind, status: labels[r.status] || r.status, amount: r.amount, detail: r.error || r.notes || r.reason }));
    }
    return { name, title: REPORTS[name], from, to, columns, rows, totals: sumBy(rows, columns) };
  }

  return { eventReport, eventReportCsv, adminReport, adminReportCsv: (name, query) => toCsv(adminReport(name, query)) };
}
