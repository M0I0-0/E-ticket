import { accountApi } from './account-ui.js';
import { $, $$, esc, money, dateTime, functionLabel, STATUS_BADGE } from './ui-utils.js';

// K-12 / T09.2: tickets the account owns now, with their QR and a PDF that can be downloaded any time.
export async function renderTickets({ app, user, signed, back, toast, go }) {
  if (!signed) {
    app.innerHTML = `${back('inicio')}<div class="empty"><h1 style="font-size:36px">Tus experiencias, en un lugar</h1><p>Inicia sesión para ver tus boletos e historial.</p><a class="btn" href="#login">Iniciar sesión</a></div>`;
    return;
  }
  app.innerHTML = `${back('inicio')}<div class="eyebrow">Mi cuenta</div><h1>Mis boletos</h1><p class="muted">Cargando tus boletos…</p>`;
  let list;
  try { list = (await accountApi('tickets', null, 'GET')).tickets; } catch (error) { app.innerHTML = `${back('inicio')}<div class="empty"><h2>No pudimos cargar tus boletos</h2><p>${esc(error.message)}</p></div>`; return; }
  const now = Date.now();
  const current = list.filter(t => t.status === 'valid' && !t.eventCancelled && (!t.startsAt || t.startsAt > now - 6 * 3600000));
  const past = list.filter(t => !current.includes(t));
  const card = t => `<article class="ticket e3-ticket ${t.status}">
      <div>
        <div class="ticket-head">${STATUS_BADGE[t.status] || ''}${t.rescheduled ? '<span class="pill warn">Cambió la fecha</span>' : ''}</div>
        <h3>${esc(t.eventName)}</h3>
        <p>Función: ${esc(functionLabel(t.date, t.hour))}</p>
        <p>${esc([t.venue, t.city].filter(Boolean).join(' · '))}</p>
        <p><strong>Zona: ${esc(t.zone)} · ${t.kind === 'seat' ? 'Asiento' : 'Entrada'}: ${esc(t.seat)}</strong></p>
        <p>Titular: ${esc(t.owner)} · Orden ${esc(t.orderId)}</p>
        <p class="ticket-code">Código: <span>${esc(t.code)}</span></p>
        ${t.status === 'used' ? `<p class="muted">Entró el ${esc(dateTime(t.usedAt))} por ${esc(t.usedGate)}.</p>` : ''}
        ${t.rescheduled && t.status === 'valid' ? `<div class="notice warn small"><div><p>La función cambió del ${esc(t.rescheduled.from)} al ${esc(t.rescheduled.to)}${t.rescheduled.reason ? ` (${esc(t.rescheduled.reason)})` : ''}.</p>${t.refundUntil ? `<p>Si no puedes asistir, pide tu reembolso antes del ${esc(dateTime(t.refundUntil))}.</p>` : ''}</div></div>` : ''}
        <div class="actions">
          <a class="btn secondary small" href="/api/tickets/${encodeURIComponent(t.id)}/pdf" download>Descargar PDF</a>
          ${t.transferable ? `<a class="btn secondary small" href="#transferir/${encodeURIComponent(t.id)}">Transferir</a>` : t.status === 'valid' ? '<span class="muted small-note">La transferencia cierra 24 horas antes del evento.</span>' : ''}
          ${t.refundUntil ? `<button class="btn small refund-request" data-id="${esc(t.id)}">Pedir reembolso de ${money(t.price)}</button>` : ''}
        </div>
      </div>
      ${t.status === 'valid' || t.status === 'used' ? `<div class="qr"><img src="/api/tickets/${encodeURIComponent(t.id)}/qr.svg" alt="QR del boleto ${esc(t.code)}" width="150" height="150"></div>` : '<div class="qr qr-void" aria-hidden="true">Sin QR válido</div>'}
    </article>`;
  app.innerHTML = `${back('inicio')}<div class="eyebrow">Mi cuenta</div><h1>Mis boletos</h1>
    <p>Hola, ${esc(user.name)}. Presenta el QR en la entrada; si la cámara falla, el personal puede escribir el código.</p>
    <div class="tabs"><a class="btn secondary small" href="#historial">Ver historial de compras</a><button class="btn secondary small" id="print">Imprimir boletos</button></div>
    ${current.length ? `<h2>Vigentes</h2>${current.map(card).join('')}` : `<div class="empty"><h2>No tienes boletos vigentes</h2><p>Explora la cartelera y compra tu próximo plan.</p><a class="btn" href="#cartelera">Explorar eventos</a></div>`}
    ${past.length ? `<details class="past-tickets"><summary>Boletos usados, reembolsados o cancelados (${past.length})</summary>${past.map(card).join('')}</details>` : ''}`;
  $('#print').onclick = () => window.print();
  $$('.refund-request').forEach(button => button.onclick = async () => {
    if (!confirm('¿Pedir el reembolso de este boleto? Su QR dejará de ser válido.')) return;
    button.disabled = true;
    try { const result = await accountApi(`tickets/${button.dataset.id}/refund-request`, {}); toast(`Reembolsamos ${money(result.amount)}.`); renderTickets({ app, user, signed, back, toast, go }); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
}

// T11.1: transfer to another registered account by e-mail, up to 24 hours before the event.
export async function renderTransfer({ app, ticketId, back, toast, go }) {
  let ticket;
  try { ticket = (await accountApi('tickets', null, 'GET')).tickets.find(t => t.id === ticketId); } catch (error) { toast(error.message); }
  if (!ticket) { app.innerHTML = `${back('boletos')}<div class="empty"><h2>No encontramos ese boleto en tu cuenta</h2><a class="btn" href="#boletos">Ver mis boletos</a></div>`; return; }
  if (!ticket.transferable) { app.innerHTML = `${back('boletos')}<section class="panel form-card"><h1 style="font-size:30px">Ya no se puede transferir</h1><p>Las transferencias cierran 24 horas antes del evento o cuando el boleto ya no está vigente.</p><a class="btn" href="#boletos">Volver a mis boletos</a></section>`; return; }
  app.innerHTML = `${back('boletos')}<section class="panel form-card"><div class="eyebrow">Transferir boleto</div><h1 style="font-size:30px">${esc(ticket.eventName)}</h1>
    <p>${esc(functionLabel(ticket.date, ticket.hour))}<br>${esc(ticket.zone)} · ${esc(ticket.seat)}</p>
    <div class="alert">La persona debe tener una cuenta eTicket. Recibirá el boleto con un QR nuevo y tu QR actual dejará de funcionar. Puedes transferir hasta el ${esc(dateTime(ticket.transferDeadline))}.</div>
    <form id="transfer"><div class="field"><label for="recipient-email">Correo de la cuenta que recibe</label><input type="email" id="recipient-email" required maxlength="254" autocomplete="off"></div>
    <label class="inline-check"><input type="checkbox" required><span>Entiendo que el boleto pasará a la otra cuenta y no podré usarlo.</span></label>
    <p class="error" id="transfer-error" role="alert"></p><button class="btn" style="margin-top:12px;width:100%">Transferir boleto</button></form></section>`;
  $('#transfer').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try { const result = await accountApi(`tickets/${ticket.id}/transfer`, { email: $('#recipient-email').value }); toast(`Transferimos el boleto a ${result.to.email}.`); go('boletos'); }
    catch (error) { $('#transfer-error').textContent = error.message; button.disabled = false; }
  };
}

// Purchases made by the account, with refunds and transfers.
export async function renderHistory({ app, back, toast, events }) {
  let orders;
  try { orders = (await accountApi('orders', null, 'GET')).orders; } catch (error) { toast(error.message); orders = []; }
  const name = order => order.eventName || events.find(e => String(e.id) === String(order.eventId))?.name || `Evento ${order.eventId}`;
  app.innerHTML = `${back('boletos')}<h1 style="font-size:38px">Historial de compras</h1>${orders.length ? orders.map(o => `<article class="panel order-card">
      <div class="order-head">${o.status ? STATUS_BADGE[o.status] || '' : '<span class="pill">Compra de prueba anterior</span>'}<span class="muted">${esc(o.id)}</span></div>
      <h2>${esc(name(o))}</h2>
      <p>${esc(new Date(o.time).toLocaleString('es-MX'))}${o.functionDate ? `<br>Función: ${esc(functionLabel(o.functionDate, o.functionHour))}` : ''}</p>
      <div class="line"><span>Boletos</span><strong>${o.tickets.map(t => `${esc(t.seat)}${t.transferred ? ' (transferido)' : t.status && t.status !== 'valid' && t.status !== 'used' ? ` (${esc(t.statusLabel || t.status)})` : ''}`).join(', ')}</strong></div>
      ${o.breakdown?.base != null ? `<div class="line"><span>Subtotal</span><strong>${money(o.breakdown.base)}</strong></div><div class="line"><span>Cargo por servicio</span><strong>${money(o.breakdown.fee)}</strong></div><div class="line"><span>IVA</span><strong>${money(o.breakdown.vat)}</strong></div>` : ''}
      <div class="line total"><span>Total pagado</span><strong>${money(o.total)}</strong></div>
      ${o.refunded ? `<div class="line"><span>Reembolsado</span><strong>${money(o.refunded)}</strong></div>` : ''}
      ${o.payment?.last4 ? `<p class="muted small-note">Tarjeta ${esc(o.payment.brand)} •••• ${esc(o.payment.last4)} · ${esc(o.payment.transactionId)}</p>` : ''}
    </article>`).join('') : '<div class="empty"><h2>No hay compras registradas</h2><a class="btn" href="#cartelera">Ver cartelera</a></div>'}`;
}
