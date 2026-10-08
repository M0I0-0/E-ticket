import { accountApi } from './account-ui.js';
import { $, $$, esc, money, dateTime, functionLabel } from './ui-utils.js';

const RESULT = { valid: '<span class="pill ok">Válido</span>', used: '<span class="pill bad">Ya utilizado</span>', invalid: '<span class="pill bad">No válido</span>', reverted: '<span class="pill warn">Revertido</span>' };
const CANCEL = { requested: 'Solicitud pendiente de la administración', approved: 'Cancelación aprobada: el evento se canceló y las órdenes se reembolsaron', rejected: 'La administración rechazó la cancelación' };

// T10.1 / K-14 and T10.2: one event's sales, money, availability, courtesies and real attendance.
export async function renderEventDashboard({ app, user, eventId, toast, backHref = '#panel' }) {
  app.innerHTML = '<p class="muted">Cargando el panel del evento…</p>';
  let report, candidates = [];
  try {
    [report, { users: candidates }] = await Promise.all([
      accountApi(`organizer/events/${encodeURIComponent(eventId)}/report`, null, 'GET'),
      accountApi('staff/candidates', null, 'GET'),
    ]);
  } catch (error) { app.innerHTML = `<a class="back" href="${backHref}">‹ Volver</a><div class="empty"><h2>No puedes ver este panel</h2><p>${esc(error.message)}</p></div>`; return; }
  const ev = report.event, totals = report.totals, fnName = id => { const f = ev.functions.find(x => x.id === id); return f ? functionLabel(f.date, f.hour) : id; };
  const kpi = (label, value, note = '') => `<div class="kpi"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  const live = ev.status === 'published', owner = user.role === 'organizador';
  app.innerHTML = `<a class="back" href="${backHref}">‹ Volver</a><div class="eyebrow">Panel del evento${ev.sample ? ' · evento de muestra' : ''}</div><h1 style="font-size:38px">${esc(ev.name)}</h1>
    <p>${esc([ev.venue, ev.city].filter(Boolean).join(', '))} · ${ev.status === 'published' ? '<span class="pill ok">En venta</span>' : ev.status === 'cancelled' ? '<span class="pill bad">Cancelado</span>' : `<span class="pill">${esc(ev.status)}</span>`}</p>
    <div class="kpis">
      ${kpi('Boletos vendidos', totals.sold, `${totals.orders} órdenes`)}
      ${kpi('Ingresos por boletos', money(totals.revenue), 'Precio de los boletos')}
      ${kpi('Comisión de eTicket', money(totals.commission), 'Cargo por servicio')}
      ${kpi('Monto a liquidar', money(totals.settle), 'Lo que recibe el organizador')}
      ${kpi('Disponibles', totals.available, `${totals.held} apartados ahora`)}
      ${kpi('Cortesías', totals.courtesies, 'Asientos bloqueados')}
      ${kpi('Asistencia', `${totals.scanned} / ${totals.sold}`, 'Escaneados / vendidos')}
      ${kpi('Reembolsado', money(totals.refunded), `Total cobrado ${money(totals.collected)}`)}
    </div>
    <section class="panel"><div class="section-head" style="margin-top:0"><h2>Ventas por función y zona</h2><a class="btn secondary small" href="/api/organizer/events/${encodeURIComponent(ev.id)}/report.csv" download>Descargar CSV</a></div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Función</th><th>Zona</th><th class="num">Precio</th><th class="num">Cupo</th><th class="num">Vendidos</th><th class="num">Apartados</th><th class="num">Disponibles</th><th class="num">Cortesías</th><th class="num">Escaneados</th><th class="num">Ingresos</th><th class="num">Comisión</th></tr></thead>
      <tbody>${report.rows.map(r => `<tr><td>${esc(fnName(r.functionId))}</td><td>${esc(r.zone)}</td><td class="num">${money(r.price)}</td><td class="num">${r.capacity}</td><td class="num">${r.sold}</td><td class="num">${r.held}</td><td class="num">${r.available}</td><td class="num">${r.courtesies}</td><td class="num">${r.scanned}</td><td class="num">${money(r.base)}</td><td class="num">${money(r.fee)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small-note">Ingresos = precio de los boletos vigentes o usados, sin cargo ni IVA. Comisión = cargo por servicio de eTicket. Monto a liquidar = ingresos que eTicket paga al organizador.</p></section>
    <section class="panel"><h2>Asistencia real</h2><div class="table-scroll"><table class="data-table"><thead><tr><th>Función</th><th class="num">Vendidos</th><th class="num">Escaneados</th><th class="num">Asistencia</th></tr></thead><tbody>${report.attendance.map(a => `<tr><td>${esc(fnName(a.functionId))}</td><td class="num">${a.sold}</td><td class="num">${a.scanned}</td><td class="num">${a.rate} %</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><h2>Escaneos recientes</h2>${report.scans.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Hora</th><th>Función</th><th>Boleto</th><th>Resultado</th><th>Puerta</th><th>Personal</th><th></th></tr></thead><tbody>${report.scans.map(s => `<tr><td>${esc(dateTime(s.created))}</td><td>${esc(fnName(s.functionId))}</td><td>${esc(s.seat || s.code)}</td><td>${RESULT[s.result] || esc(s.result)}${s.reason && ['invalid', 'reverted'].includes(s.result) ? `<br><small class="muted">${esc(s.reason)}</small>` : ''}</td><td>${esc(s.gate)}</td><td>${esc(s.staff || '')}</td><td>${s.result === 'valid' && s.ticketStatus === 'used' ? `<button class="btn secondary small revert-scan" data-id="${esc(s.ticketId)}">Revertir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no hay escaneos.</p>'}</section>
    <div class="split">
      <section class="panel"><h2>Personal de acceso</h2>
        ${report.staff.length ? `<ul class="plain-list">${report.staff.map(s => `<li><span>${esc(s.name)} · ${esc(s.email)}<br><small class="muted">${esc(fnName(s.functionId))}</small></span><button class="btn secondary small remove-staff" data-user="${esc(s.userId)}" data-fn="${esc(s.functionId)}">Quitar</button></li>`).join('')}</ul>` : '<p class="muted">Nadie asignado todavía.</p>'}
        ${candidates.length ? `<form id="staff-form"><div class="field"><label for="staff-user">Cuenta de taquilla</label><select id="staff-user">${candidates.map(c => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email)}</option>`).join('')}</select></div><div class="field"><label for="staff-fn">Función</label><select id="staff-fn">${ev.functions.map(f => `<option value="${esc(f.id)}">${esc(functionLabel(f.date, f.hour))}</option>`).join('')}</select></div><button class="btn small">Asignar</button></form>` : '<p class="muted small-note">No hay cuentas de taquilla. La administración las crea en Usuarios.</p>'}
      </section>
      <section class="panel">${ev.sample ? '<h2>Evento de muestra</h2><p class="muted">Los eventos de muestra de la cartelera no se reprograman ni se cancelan.</p>' : `
        <h2>Cambiar fecha</h2>
        ${live ? `<form id="reschedule-form"><div class="field"><label for="re-fn">Función</label><select id="re-fn">${ev.functions.map(f => `<option value="${esc(f.id)}">${esc(functionLabel(f.date, f.hour))}</option>`).join('')}</select></div><div class="split tight"><div class="field"><label for="re-date">Nueva fecha</label><input id="re-date" type="date" required></div><div class="field"><label for="re-hour">Hora</label><input id="re-hour" type="time" required></div></div><div class="field"><label for="re-reason">Motivo</label><input id="re-reason" required maxlength="300"></div><p class="muted small-note">Avisamos por correo a quienes tienen boletos y les damos 10 días para pedir reembolso.</p><button class="btn small">Cambiar fecha</button></form>` : '<p class="muted">Solo se reprograman eventos en venta.</p>'}
        <h2 style="margin-top:28px">Cancelación</h2>
        ${report.cancellation ? `<div class="alert">${esc(CANCEL[report.cancellation.status] || report.cancellation.status)}.<br><small>Motivo: ${esc(report.cancellation.reason)}${report.cancellation.decision_reason ? ` · Respuesta: ${esc(report.cancellation.decision_reason)}` : ''}</small></div>` : ''}
        ${owner && live && report.cancellation?.status !== 'requested' ? `<form id="cancel-form"><div class="field"><label for="cancel-reason">Motivo de la cancelación</label><textarea id="cancel-reason" required maxlength="500"></textarea></div><p class="muted small-note">La administración debe aprobarla. Al aprobarse se invalidan todos los QR y se reembolsa el 100 % de cada orden, con cargo incluido.</p><button class="btn secondary small">Solicitar cancelación</button></form>` : ''}`}
      </section>
    </div>`;
  const reload = () => renderEventDashboard({ app, user, eventId, toast, backHref });
  $$('.revert-scan').forEach(button => button.onclick = async () => {
    const reason = prompt('¿Por qué revertir este escaneo? Quedará registrado en la bitácora.');
    if (!reason) return;
    try { await accountApi(`tickets/${button.dataset.id}/revert-scan`, { reason }); toast('Escaneo revertido: el boleto vuelve a ser válido.'); reload(); } catch (error) { toast(error.message); }
  });
  $$('.remove-staff').forEach(button => button.onclick = async () => {
    try { await accountApi(`events/${ev.id}/staff/remove`, { userId: button.dataset.user, functionId: button.dataset.fn }); toast('Personal retirado.'); reload(); } catch (error) { toast(error.message); }
  });
  $('#staff-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await accountApi(`events/${ev.id}/staff`, { userId: $('#staff-user').value, functionId: $('#staff-fn').value }); toast('Personal asignado.'); reload(); } catch (error) { toast(error.message); }
  });
  $('#reschedule-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!confirm('¿Cambiar la fecha? Se avisará por correo a todas las personas con boletos.')) return;
    try { const r = await accountApi(`events/${ev.id}/functions/${$('#re-fn').value}/reschedule`, { date: $('#re-date').value, hour: $('#re-hour').value, reason: $('#re-reason').value }); toast(`Fecha cambiada. Avisamos a ${r.notified} personas.`); reload(); } catch (error) { toast(error.message); }
  });
  $('#cancel-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await accountApi(`events/${ev.id}/cancel-request`, { reason: $('#cancel-reason').value }); toast('Solicitud enviada a la administración.'); reload(); } catch (error) { toast(error.message); }
  });
}
