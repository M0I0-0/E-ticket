import { accountApi } from './account-ui.js';
import { $, $$, esc, money, dateTime, percent, localDay, dataTable, STATUS_BADGE } from './ui-utils.js';

export const ADMIN_TABS = [
  ['general', 'General'], ['eventos', 'Eventos'], ['reportes', 'Reportes'], ['usuarios', 'Usuarios'], ['reembolsos', 'Reembolsos'],
  ['cancelaciones', 'Cancelaciones'], ['bitacora', 'Bitácora'], ['configuracion', 'Comisión'], ['correos', 'Correos'],
];
export const adminTabs = active => `<nav class="admin-tabs" aria-label="Secciones de administración">${ADMIN_TABS.map(([id, label]) => `<a href="#panel/${id}" class="${id === active ? 'active' : ''}" ${id === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;

const ACTIONS = {
  'organizador.aprobado': 'Aprobó un organizador', 'organizador.rechazado': 'Rechazó un organizador', 'evento.aprobado': 'Aprobó un evento', 'evento.rechazado': 'Rechazó un evento',
  'cancelacion.solicitada': 'Solicitó cancelar un evento', 'cancelacion.aprobada': 'Aprobó una cancelación', 'cancelacion.rechazada': 'Rechazó una cancelación',
  'reembolso.emitido': 'Emitió un reembolso', 'reembolso.fallido': 'Reembolso rechazado por la pasarela', 'reembolso.resuelto': 'Resolvió un reembolso fallido',
  'usuario.bloqueado': 'Bloqueó un usuario', 'usuario.desbloqueado': 'Desbloqueó un usuario', 'rol.cambiado': 'Cambió un rol', 'escaneo.revertido': 'Revirtió un escaneo',
  'comision.cambiada': 'Cambió la comisión', 'personal.asignado': 'Asignó personal', 'personal.retirado': 'Retiró personal', 'boleto.transferido': 'Transfirió un boleto', 'funcion.reprogramada': 'Cambió la fecha de una función',
};

export async function renderAdminTab({ app, tab, toast, events }) {
  const body = $('#admin-body');
  const rerun = () => renderAdminTab({ app, tab, toast, events });
  const fail = error => { body.innerHTML = `<div class="alert error-alert">${esc(error.message)}</div>`; };
  body.innerHTML = '<p class="muted">Cargando…</p>';
  // Writes only if the user is still on this tab when the answer arrives.
  const put = (selector, html) => { const el = $(selector); if (el) el.innerHTML = html; return Boolean(el); };
  try {
    if (tab === 'eventos') {
      const listing = await accountApi('events', null, 'GET'), byId = new Map(listing.events.map(e => [String(e.id), e]));
      if (!body.isConnected) return;
      const rows = events.map(e => ({ id: String(e.id), name: e.name, city: e.city, status: byId.get(String(e.id))?.status || 'published', sample: !byId.has(String(e.id)) }));
      for (const e of listing.events) if (!rows.some(r => r.id === String(e.id))) rows.push({ id: String(e.id), name: e.name, city: e.city, status: e.status, sample: false });
      body.innerHTML = `<p>Abre el panel de cualquier evento para ver ventas, asistencia, escaneos, personal y cambios.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Evento</th><th>Ciudad</th><th>Estado</th><th>Disponibilidad</th><th></th></tr></thead><tbody>${rows.map(r => {
        const a = listing.availability?.[r.id];
        return `<tr><td>${esc(r.name)}${r.sample ? ' <small class="muted">(muestra)</small>' : ''}</td><td>${esc(r.city)}</td><td>${r.status === 'published' ? '<span class="pill ok">Publicado</span>' : r.status === 'cancelled' ? '<span class="pill bad">Cancelado</span>' : `<span class="pill">${esc(r.status)}</span>`}</td><td>${a ? (a.soldOut ? '<span class="pill bad">Agotado</span>' : `${a.available} lugares`) : '—'}</td><td>${['published', 'cancelled'].includes(r.status) ? `<a class="btn secondary small" href="#panel/evento/${encodeURIComponent(r.id)}">Ver panel</a>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }

    if (tab === 'reportes') {
      const { reports } = await accountApi('admin/reports', null, 'GET');
      if (!body.isConnected) return;
      body.innerHTML = `<form id="report-form" class="report-form"><div><label for="report-name">Reporte</label><select id="report-name">${Object.entries(reports).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></div><div><label for="report-from">Desde</label><input id="report-from" type="date" value="${localDay(-30)}"></div><div><label for="report-to">Hasta</label><input id="report-to" type="date" value="${localDay(1)}"></div><div class="report-buttons"><button class="btn">Ver reporte</button><a class="btn secondary" id="report-csv" download>Descargar CSV</a></div></form><div id="report-output"></div>`;
      const show = async () => {
        const name = $('#report-name').value, query = `from=${encodeURIComponent($('#report-from').value)}&to=${encodeURIComponent($('#report-to').value)}`;
        $('#report-csv').href = `/api/admin/reports/${name}.csv?${query}`;
        try {
          const r = await accountApi(`admin/reports/${name}?${query}`, null, 'GET');
          put('#report-output', `<h2>${esc(r.title)}</h2><p class="muted">${r.rows.length} filas · del ${esc(r.from || 'inicio')} al ${esc(r.to || 'hoy')}. El CSV trae exactamente las mismas cifras.</p>${dataTable(r.columns, r.rows, r.rows.length ? r.totals : null)}`);
        } catch (error) { put('#report-output', `<div class="alert error-alert">${esc(error.message)}</div>`); }
      };
      $('#report-form').onsubmit = event => { event.preventDefault(); show(); };
      $('#report-name').onchange = show;
      await show();
    }

    if (tab === 'usuarios') {
      body.innerHTML = `<form id="user-search" class="manual-row"><input id="user-q" placeholder="Buscar por nombre o correo" aria-label="Buscar usuario"><button class="btn">Buscar</button></form><div id="user-results"></div>`;
      const search = async () => {
        const { users } = await accountApi(`admin/users?q=${encodeURIComponent($('#user-q').value)}`, null, 'GET');
        put('#user-results', users.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th class="num">Boletos vigentes</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${users.map(u => `<tr>
          <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
          <td>${['comprador', 'taquilla'].includes(u.role) ? `<select class="user-role" data-id="${esc(u.id)}" aria-label="Rol de ${esc(u.email)}"><option value="comprador" ${u.role === 'comprador' ? 'selected' : ''}>Comprador</option><option value="taquilla" ${u.role === 'taquilla' ? 'selected' : ''}>Taquilla</option></select>` : esc(u.role)}</td>
          <td class="num">${u.tickets}</td>
          <td>${u.blocked ? `<span class="pill bad">Bloqueado</span><br><small class="muted">${esc(u.blockedReason)}</small>` : '<span class="pill ok">Activo</span>'}</td>
          <td class="row-actions">${['comprador', 'taquilla'].includes(u.role) ? `<button class="btn secondary small save-role" data-id="${esc(u.id)}">Guardar rol</button>` : ''}${u.role === 'administrador' ? '' : u.blocked ? `<button class="btn secondary small unblock" data-id="${esc(u.id)}">Desbloquear</button>` : `<button class="btn secondary small block" data-id="${esc(u.id)}">Bloquear</button>`}</td></tr>`).join('')}</tbody></table></div><p class="muted small-note">Una cuenta bloqueada puede entrar y usar sus boletos, pero no puede comprar.</p>` : '<p class="muted">Sin resultados.</p>');
        $$('.save-role').forEach(b => b.onclick = async () => { try { await accountApi('admin/users', { userId: b.dataset.id, role: document.querySelector(`.user-role[data-id="${CSS.escape(b.dataset.id)}"]`).value }, 'PUT'); toast('Rol actualizado.'); search(); } catch (error) { toast(error.message); } });
        $$('.block').forEach(b => b.onclick = async () => { const reason = prompt('Motivo del bloqueo (queda en la bitácora):'); if (!reason) return; try { await accountApi(`admin/users/${b.dataset.id}/block`, { blocked: true, reason }); toast('Usuario bloqueado.'); search(); } catch (error) { toast(error.message); } });
        $$('.unblock').forEach(b => b.onclick = async () => { try { await accountApi(`admin/users/${b.dataset.id}/block`, { blocked: false }); toast('Usuario desbloqueado.'); search(); } catch (error) { toast(error.message); } });
      };
      $('#user-search').onsubmit = event => { event.preventDefault(); search(); };
      await search();
    }

    if (tab === 'reembolsos') {
      const [{ refunds: failed }, { refunds: all }] = await Promise.all([accountApi('admin/refunds?status=failed', null, 'GET'), accountApi('admin/refunds', null, 'GET')]);
      if (!body.isConnected) return;
      const label = { succeeded: '<span class="pill ok">Reembolsado</span>', failed: '<span class="pill bad">Fallido</span>', resolved: '<span class="pill warn">Resuelto a mano</span>' };
      body.innerHTML = `<section class="panel"><h2>Reembolsos rechazados por la pasarela</h2>${failed.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Orden</th><th>Evento</th><th>Comprador</th><th class="num">Monto</th><th>Motivo</th><th>Acciones</th></tr></thead><tbody>${failed.map(r => `<tr><td>${esc(dateTime(r.created))}</td><td>${esc(r.orderId)}${r.seat ? `<br><small>${esc(r.seat)}</small>` : ''}</td><td>${esc(r.eventName)}</td><td>${esc(r.buyer)}</td><td class="num">${money(r.amount)}</td><td>${esc(r.error)}</td><td class="row-actions"><button class="btn secondary small retry-refund" data-id="${esc(r.id)}">Reintentar</button><button class="btn secondary small resolve-refund" data-id="${esc(r.id)}">Marcar resuelto</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No hay reembolsos pendientes.</p>'}</section>
        <section class="panel"><h2>Reembolso individual</h2><p>Busca la orden y reembolsa un boleto: su QR deja de ser válido y el asiento vuelve a la venta.</p><form id="order-search" class="manual-row"><input id="order-id" placeholder="ET-XXXXXXXX" required aria-label="Número de orden"><button class="btn">Buscar orden</button></form><div id="order-result"></div></section>
        <section class="panel"><h2>Todos los reembolsos</h2>${all.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Orden</th><th>Evento</th><th>Tipo</th><th class="num">Monto</th><th>Estado</th><th>Nota</th></tr></thead><tbody>${all.map(r => `<tr><td>${esc(dateTime(r.created))}</td><td>${esc(r.orderId)}</td><td>${esc(r.eventName)}</td><td>${esc(r.kind)}</td><td class="num">${money(r.amount)}</td><td>${label[r.status] || esc(r.status)}</td><td>${esc(r.notes || r.error || r.reason)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aún no hay reembolsos.</p>'}</section>`;
      $$('.retry-refund').forEach(b => b.onclick = async () => { try { await accountApi(`admin/refunds/${b.dataset.id}/retry`, {}); toast('Reembolso emitido.'); rerun(); } catch (error) { toast(error.message); } });
      $$('.resolve-refund').forEach(b => b.onclick = async () => { const notes = prompt('¿Cómo se resolvió? (por ejemplo, transferencia bancaria)'); if (!notes) return; try { await accountApi(`admin/refunds/${b.dataset.id}/resolve`, { notes }); toast('Reembolso marcado como resuelto.'); rerun(); } catch (error) { toast(error.message); } });
      $('#order-search').onsubmit = async event => {
        event.preventDefault();
        try {
          const { order } = await accountApi(`admin/orders/${encodeURIComponent($('#order-id').value.trim())}`, null, 'GET');
          put('#order-result', `<div class="order-box"><p><strong>${esc(order.id)}</strong> · ${esc(order.eventName)} · ${esc(order.buyer)} ${STATUS_BADGE[order.status] || ''}</p><p class="muted">Total ${money(order.total)} · Reembolsado ${money(order.refunded)}</p><ul class="plain-list">${order.tickets.map(t => `<li><span>${esc(t.seat)} · ${esc(t.ownerEmail)} · ${STATUS_BADGE[t.status] || esc(t.status)} · ${money(t.price)}</span>${t.status === 'valid' ? `<button class="btn secondary small refund-ticket" data-id="${esc(t.id)}" data-seat="${esc(t.seat)}">Reembolsar</button>` : ''}</li>`).join('')}</ul></div>`);
          $$('.refund-ticket').forEach(b => b.onclick = async () => {
            const reason = prompt(`Motivo del reembolso de ${b.dataset.seat}:`); if (!reason) return;
            try { const r = await accountApi(`admin/tickets/${b.dataset.id}/refund`, { reason }); toast(`Reembolsamos ${money(r.amount)}.`); $('#order-search').requestSubmit(); } catch (error) { toast(error.message); }
          });
        } catch (error) { put('#order-result', `<p class="error">${esc(error.message)}</p>`); }
      };
    }

    if (tab === 'cancelaciones') {
      const { cancellations } = await accountApi('admin/cancellations', null, 'GET');
      if (!body.isConnected) return;
      const pending = cancellations.filter(c => c.status === 'requested'), done = cancellations.filter(c => c.status !== 'requested');
      body.innerHTML = `<p>Un evento solo se cancela con tu aprobación. Al aprobar se invalidan todos sus QR y se reembolsa el 100 % de cada orden (cargo incluido) en la pasarela sandbox.</p>
        ${pending.length ? pending.map(c => `<article class="panel cancel-card"><span class="pill warn">Pendiente</span><h2>${esc(c.eventName)}</h2><p>Solicitó: ${esc(c.requestedBy)} · ${esc(dateTime(c.created))}<br>Motivo: ${esc(c.reason)}</p><p><strong>${c.orders} órdenes · ${money(c.amount)} por reembolsar</strong></p><div class="field"><label for="reason-${esc(c.id)}">Respuesta (obligatoria si rechazas)</label><input id="reason-${esc(c.id)}" maxlength="500"></div><div class="actions"><button class="btn decide-cancel" data-id="${esc(c.id)}" data-approve="1">Aprobar y reembolsar</button><button class="btn secondary decide-cancel" data-id="${esc(c.id)}" data-approve="0">Rechazar</button></div></article>`).join('') : '<div class="empty"><p>No hay solicitudes pendientes.</p></div>'}
        ${done.length ? `<h2>Historial</h2><div class="table-scroll"><table class="data-table"><thead><tr><th>Evento</th><th>Solicitó</th><th>Motivo</th><th>Decisión</th><th>Fecha</th></tr></thead><tbody>${done.map(c => `<tr><td>${esc(c.eventName)}</td><td>${esc(c.requestedBy)}</td><td>${esc(c.reason)}</td><td>${c.status === 'approved' ? '<span class="pill bad">Cancelado</span>' : '<span class="pill">Rechazada</span>'}${c.decisionReason ? `<br><small>${esc(c.decisionReason)}</small>` : ''}</td><td>${esc(dateTime(c.decided))}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      $$('.decide-cancel').forEach(b => b.onclick = async () => {
        const approve = b.dataset.approve === '1', reason = $(`#reason-${CSS.escape(b.dataset.id)}`).value;
        if (approve && !confirm('¿Cancelar el evento? Se invalidarán todos los QR y se reembolsará cada orden.')) return;
        b.disabled = true;
        try { const r = await accountApi(`admin/cancellations/${b.dataset.id}/decision`, { approve, reason }); toast(approve ? `Evento cancelado: ${r.refunded} de ${r.orders} órdenes reembolsadas${r.failed ? `, ${r.failed} fallaron (ver Reembolsos)` : ''}.` : 'Solicitud rechazada.'); rerun(); }
        catch (error) { toast(error.message); b.disabled = false; }
      });
    }

    if (tab === 'bitacora') {
      body.innerHTML = `<form id="audit-form" class="report-form"><div><label for="audit-action">Acción</label><select id="audit-action"><option value="">Todas</option>${Object.entries(ACTIONS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></div><div><label for="audit-from">Desde</label><input id="audit-from" type="date"></div><div><label for="audit-to">Hasta</label><input id="audit-to" type="date"></div><div class="report-buttons"><button class="btn">Filtrar</button></div></form><div id="audit-output"></div>`;
      const show = async () => {
        const { entries } = await accountApi(`admin/audit?action=${encodeURIComponent($('#audit-action').value)}&from=${$('#audit-from').value}&to=${$('#audit-to').value}`, null, 'GET');
        put('#audit-output', entries.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Sobre</th><th>Detalle</th></tr></thead><tbody>${entries.map(e => `<tr><td>${esc(dateTime(e.created))}</td><td>${esc(e.actorEmail)}<br><small class="muted">${esc(e.actorRole)}</small></td><td>${esc(e.label)}</td><td>${esc(e.targetType)} ${esc(e.targetId)}</td><td>${esc(e.details)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No hay registros con ese filtro.</p>');
      };
      $('#audit-form').onsubmit = event => { event.preventDefault(); show(); };
      await show();
    }

    if (tab === 'configuracion') {
      const { serviceFeeRate } = await accountApi('admin/settings', null, 'GET');
      if (!body.isConnected) return;
      body.innerHTML = `<section class="panel form-card"><h2>Cargo por servicio</h2><p>Comisión actual: <strong>${percent(serviceFeeRate)}</strong> sobre el precio del boleto (más IVA).</p><form id="fee-form"><div class="field"><label for="fee">Nuevo porcentaje</label><input id="fee" type="number" min="0" max="30" step="0.5" value="${Math.round(serviceFeeRate * 10000) / 100}" required></div><p class="muted small-note">Solo se aplica a compras nuevas: los apartados y órdenes existentes conservan su comisión.</p><button class="btn">Guardar comisión</button></form></section>`;
      $('#fee-form').onsubmit = async event => { event.preventDefault(); try { const r = await accountApi('admin/settings', { percent: Number($('#fee').value) }, 'PUT'); toast(`Comisión actualizada a ${percent(r.serviceFeeRate)}.`); rerun(); } catch (error) { toast(error.message); } };
    }

    if (tab === 'correos') {
      const { messages } = await accountApi('admin/outbox', null, 'GET');
      if (!body.isConnected) return;
      const state = { enviado: '<span class="pill ok">Enviado</span>', 'sin SMTP': '<span class="pill warn">Sin SMTP</span>', error: '<span class="pill bad">Error</span>', pendiente: '<span class="pill">Pendiente</span>' };
      body.innerHTML = `<p>Copia de los correos automáticos: confirmaciones con boletos, transferencias, cambios de fecha, cancelaciones, reembolsos, aprobaciones, agotados y recordatorios.${messages.some(m => m.status === 'sin SMTP') ? ' Los marcados «Sin SMTP» no salieron porque falta configurar el correo en <code>.env</code>.' : ''}</p>${messages.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Tipo</th><th>Adjuntos</th><th>Estado</th></tr></thead><tbody>${messages.map(m => `<tr><td>${esc(dateTime(m.created))}</td><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${esc(m.kind)}</td><td>${m.attachments.length ? esc(m.attachments.join(', ')) : '—'}</td><td>${state[m.status] || esc(m.status)}${m.error ? `<br><small>${esc(m.error)}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aún no se ha enviado ningún correo.</p>'}`;
    }
  } catch (error) { fail(error); }
}
