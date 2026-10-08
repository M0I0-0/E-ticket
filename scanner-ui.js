import { accountApi } from './account-ui.js';
import { $, esc, functionLabel } from './ui-utils.js';

let stream = null, loop = 0, busy = false, lastCode = '', lastAt = 0;
let decoder = null;
// The live camera needs a secure page (https or localhost); a photo works everywhere.
export function stopScanner() {
  clearInterval(loop); loop = 0;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
}

async function qrDecoder() {
  if (decoder) return decoder;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        decoder = async source => (await detector.detect(source))[0]?.rawValue || '';
        return decoder;
      }
    } catch { /* falls back to jsQR */ }
  }
  // iPhone Safari has no BarcodeDetector: jsQR reads the pixels instead.
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
  decoder = async source => {
    const width = source.videoWidth || source.naturalWidth || source.width, height = source.videoHeight || source.naturalHeight || source.height;
    if (!width || !height) return '';
    const scale = Math.min(1, 800 / Math.max(width, height));
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data || '';
  };
  return decoder;
}

export async function renderScanner({ app, user, toast, params = [] }) {
  stopScanner();
  let assignments;
  try { assignments = (await accountApi('staff/assignments', null, 'GET')).assignments; } catch (error) { app.innerHTML = `<section class="panel"><p>${esc(error.message)}</p></section>`; return; }
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('eticket-gate')) || {}; } catch { return {}; } })();
  const chosen = assignments.find(a => a.eventId === params[0] && a.functionId === params[1]);
  if (!chosen) {
    app.innerHTML = `<div class="eyebrow">Taquilla · Control de acceso</div><h1>Elige tu evento</h1><p>Hola, ${esc(user.name)}. Solo ves los eventos y funciones que la administración o el organizador te asignaron.</p>
      ${assignments.length ? `<form id="gate-form" class="panel form-card"><div class="field"><label for="assignment">Evento y función</label><select id="assignment" required>${assignments.map((a, i) => `<option value="${i}" ${a.eventId === saved.eventId && a.functionId === saved.functionId ? 'selected' : ''}>${esc(a.eventName)} · ${esc(functionLabel(a.date, a.hour))}${a.status !== 'published' ? ' (cancelado)' : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="gate">Puerta</label><input id="gate" required maxlength="40" value="${esc(saved.gate || 'Puerta 1')}"></div><button class="btn" style="width:100%">Comenzar a validar</button></form>`
        : '<div class="empty"><h2>Aún no tienes eventos asignados</h2><p>Pide a la administración o al organizador que te asigne una función.</p></div>'}`;
    $('#gate-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const a = assignments[Number($('#assignment').value)], gate = $('#gate').value.trim() || 'Puerta 1';
      try { sessionStorage.setItem('eticket-gate', JSON.stringify({ eventId: a.eventId, functionId: a.functionId, gate })); } catch {}
      location.hash = `panel/${encodeURIComponent(a.eventId)}/${encodeURIComponent(a.functionId)}`;
    });
    return;
  }
  const gate = saved.eventId === chosen.eventId && saved.functionId === chosen.functionId ? saved.gate || 'Puerta 1' : 'Puerta 1';
  const secure = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
  app.innerHTML = `<a class="back" href="#panel">‹ Cambiar evento o puerta</a><div class="eyebrow">Taquilla · ${esc(gate)}</div><h1 style="font-size:34px">${esc(chosen.eventName)}</h1>
    <p>${esc(functionLabel(chosen.date, chosen.hour))} · ${esc([chosen.venue, chosen.city].filter(Boolean).join(', '))}</p>
    <div class="scanner-grid">
      <section class="panel">
        <div class="counter" aria-live="polite"><span>Han entrado</span><strong id="entered">${chosen.counter.entered}</strong><span>de <b id="sold">${chosen.counter.sold}</b> boletos vendidos</span></div>
        <div id="result" class="scan-result idle" role="status" aria-live="assertive"><strong>Listo para validar</strong><span>El resultado aparecerá aquí.</span></div>
        <div class="camera" id="camera"><video id="video" playsinline muted></video><div class="camera-frame" aria-hidden="true"></div><p id="camera-hint">${secure ? 'Activa la cámara y apunta al QR del boleto.' : 'La cámara en vivo necesita una conexión segura (https). Usa «Tomar foto del QR» o escribe el código.'}</p></div>
        <div class="actions">${secure ? '<button class="btn" id="start-camera" type="button">Activar cámara</button>' : ''}<label class="btn secondary" for="photo">Tomar foto del QR</label><input id="photo" type="file" accept="image/*" capture="environment" hidden></div>
        <form id="manual" class="manual"><label for="manual-code">Búsqueda manual (si la cámara falla)</label><div class="manual-row"><input id="manual-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required><button class="btn">Validar</button></div></form>
      </section>
      <section class="panel"><h3>Últimos escaneos</h3><ol id="recent" class="recent"><li class="muted">Aún no hay lecturas en esta puerta.</li></ol><p class="muted small-note">Verde: puede pasar. Rojo «Ya utilizado»: ese boleto ya entró (se muestra hora y puerta). Rojo «No válido»: es de otro evento o función, fue reembolsado, transferido o no existe.</p></section>
    </div>`;
  const recent = [];
  async function validate(raw, source) {
    const code = String(raw || '').trim();
    if (!code || busy) return;
    if (code === lastCode && Date.now() - lastAt < 3000) return;
    busy = true; lastCode = code; lastAt = Date.now();
    try {
      const r = await accountApi('scan', { code, eventId: chosen.eventId, functionId: chosen.functionId, gate });
      const color = r.result === 'valid' ? 'ok' : 'bad';
      $('#result').className = `scan-result ${color}`;
      $('#result').innerHTML = `<strong>${esc(r.result === 'valid' ? 'ACCESO VÁLIDO' : r.result === 'used' ? 'YA UTILIZADO' : 'NO VÁLIDO')}</strong><span>${esc(r.reason)}</span>${r.ticket ? `<small>${esc(r.ticket.eventName)} · ${esc(r.ticket.zone)} · ${esc(r.ticket.seat)} · ${esc(r.ticket.owner)}</small>` : ''}<small>Código ${esc(r.code)} · ${source}</small>`;
      $('#entered').textContent = r.counter.entered; $('#sold').textContent = r.counter.sold;
      $('#result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      navigator.vibrate?.(r.result === 'valid' ? 120 : [80, 60, 80]);
      recent.unshift(`<li class="${color}"><b>${esc(r.result === 'valid' ? 'Válido' : r.result === 'used' ? 'Ya utilizado' : 'No válido')}</b> ${esc(r.ticket?.seat || r.code)} · ${esc(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</li>`);
      $('#recent').innerHTML = recent.slice(0, 8).join('');
    } catch (error) {
      $('#result').className = 'scan-result bad';
      $('#result').innerHTML = `<strong>NO SE PUDO VALIDAR</strong><span>${esc(error.message)}</span>`;
    } finally { setTimeout(() => { busy = false; }, 1500); }
  }
  $('#manual').onsubmit = event => { event.preventDefault(); lastCode = ''; validate($('#manual-code').value, 'escrito a mano'); $('#manual-code').select(); };
  $('#photo').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const image = new Image(), url = URL.createObjectURL(file);
    image.onload = async () => {
      try { const text = await (await qrDecoder())(image); if (text) { lastCode = ''; validate(text, 'foto'); } else toast('No encontramos un QR en la foto. Acércate y vuelve a intentarlo.'); }
      finally { URL.revokeObjectURL(url); event.target.value = ''; }
    };
    image.src = url;
  };
  $('#start-camera')?.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const video = $('#video');
      video.srcObject = stream;
      await video.play();
      $('#camera').classList.add('on');
      $('#camera-hint').textContent = 'Apunta al QR. La validación es automática.';
      $('#start-camera').hidden = true;
      const read = await qrDecoder();
      loop = setInterval(async () => {
        if (busy || video.readyState < 2) return;
        try { const text = await read(video); if (text) validate(text, 'cámara'); } catch { /* next frame */ }
      }, 300);
    } catch (error) {
      toast(error.name === 'NotAllowedError' ? 'Permite el uso de la cámara para escanear.' : 'No se pudo abrir la cámara. Usa la foto o escribe el código.');
    }
  });
  // Keeps the counter current when other gates validate tickets.
  const refresh = setInterval(async () => {
    if (!document.getElementById('entered')) { clearInterval(refresh); return; }
    try { const c = await accountApi(`staff/counter/${encodeURIComponent(chosen.eventId)}/${encodeURIComponent(chosen.functionId)}`, null, 'GET', true); $('#entered').textContent = c.entered; $('#sold').textContent = c.sold; } catch {}
  }, 10000);
}
