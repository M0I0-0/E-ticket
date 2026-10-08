// Helpers shared by the Entrega 3 screens.
export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
export const longDate = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const dateTime = ms => ms ? new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const percent = rate => `${Math.round(Number(rate) * 10000) / 100} %`;
export const localDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('sv-SE');
export const functionLabel = (date, hour) => date ? `${longDate(date)} · ${hour} h` : '';

// Renders a report table; the column types match the CSV export so both show the same figures.
export function dataTable(columns, rows, totals) {
  const cell = (value, type) => value == null || value === '' ? '—' : type === 'money' ? money(value) : type === 'datetime' ? dateTime(value) : esc(value);
  if (!rows.length) return '<p class="muted">No hay datos en este periodo.</p>';
  return `<div class="table-scroll"><table class="data-table"><thead><tr>${columns.map(c => `<th class="${c.type === 'money' || c.type === 'int' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${columns.map(c => `<td class="${c.type === 'money' || c.type === 'int' ? 'num' : ''}">${cell(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>${totals ? `<tfoot><tr>${columns.map((c, i) => `<td class="${c.type === 'money' || c.type === 'int' ? 'num' : ''}">${i === 0 ? 'Total' : totals[c.key] == null ? '' : cell(totals[c.key], c.type)}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
}

export const STATUS_BADGE = {
  valid: '<span class="pill ok">Vigente</span>', used: '<span class="pill">Utilizado</span>', refunded: '<span class="pill warn">Reembolsado</span>', cancelled: '<span class="pill bad">Evento cancelado</span>',
  paid: '<span class="pill ok">Pagada</span>', partially_refunded: '<span class="pill warn">Reembolso parcial</span>',
};
