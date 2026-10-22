// Event and venue forms: functions are picked on a calendar and zones are filled field by field,
// so nobody has to type "2026-12-25,22:00" or comma-separated zone lines.
import { esc, localDay, seatLabels, rowName, MAX_ROWS } from './ui-utils.js';

const pad = n => String(n).padStart(2, '0');
const dayKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const longDay = date => new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const seatList = text => [...new Set(String(text || '').split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
const MAX_PER_ROW = 200, MAX_SEATS = 20000, MAP_LIMIT = 3000;
let uid = 0;

// Marks the field, shows the message under it and brings it into view; returns the Error to throw.
function fail(el, message) {
  if (el) {
    document.querySelectorAll('.field-error').forEach(note => note.remove());
    const note = Object.assign(document.createElement('p'), { className: 'error field-error', textContent: message });
    note.setAttribute('role', 'alert');
    const holder = el.closest('.field, .calendar');
    if (holder) holder.append(note); else el.after(note);
    el.setAttribute('aria-invalid', 'true');
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el.focus?.({ preventScroll: true });
    const clear = () => { el.removeAttribute('aria-invalid'); note.remove(); };
    el.addEventListener('input', clear, { once: true });
    el.addEventListener('click', clear, { once: true });
  }
  return new Error(message);
}

// Functions: a tap on a day adds it with the chosen hour, another tap removes it. Each date can
// change its hour or get another one the same day. Saved functions keep their id, so sales and
// staff stay attached to the same function.
export function functionPicker(root, { functions = [] } = {}) {
  const today = localDay(0);
  let items = functions.filter(fn => fn?.date).map(fn => ({ id: String(fn.id), date: fn.date, hour: fn.hour || '20:00' }));
  const saved = new Set(items.map(fn => `${fn.date}|${fn.hour}`));
  let nextId = Math.max(0, ...items.map(fn => Number(fn.id) || 0));
  const start = items.map(fn => fn.date).filter(date => date >= today).sort()[0] || today;
  let year = Number(start.slice(0, 4)), month = Number(start.slice(5, 7)) - 1;
  root.innerHTML = `<div class="fn-picker">
      <div class="calendar" tabindex="-1">
        <div class="cal-head"><button type="button" class="cal-nav" data-step="-1" aria-label="Mes anterior">‹</button><strong class="cal-title" aria-live="polite"></strong><button type="button" class="cal-nav" data-step="1" aria-label="Mes siguiente">›</button></div>
        <div class="cal-grid"></div>
      </div>
      <div class="fn-side">
        <div class="field"><label for="fn-hour">Hora de las fechas que agregues</label><input id="fn-hour" type="time" value="20:00"></div>
        <p class="muted small-note">Toca un día del calendario para agregarlo o quitarlo. Después puedes cambiar la hora de cada fecha o agregar otra hora el mismo día.</p>
        <ul class="fn-list" aria-live="polite"></ul>
      </div>
    </div>`;
  const grid = root.querySelector('.cal-grid'), list = root.querySelector('.fn-list'), hour = root.querySelector('#fn-hour');
  const sort = () => items.sort((a, b) => `${a.date} ${a.hour}`.localeCompare(`${b.date} ${b.hour}`));
  function paintCalendar() {
    const first = new Date(year, month, 1), days = new Date(year, month + 1, 0).getDate();
    root.querySelector('.cal-title').textContent = first.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    root.querySelector('[data-step="-1"]').disabled = `${year}-${pad(month + 1)}` <= today.slice(0, 7);
    grid.innerHTML = ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(day => `<span class="cal-week" aria-hidden="true">${day}</span>`).join('')
      + '<span></span>'.repeat(first.getDay())
      + Array.from({ length: days }, (_, i) => {
        const date = dayKey(year, month, i + 1), count = items.filter(fn => fn.date === date).length;
        return `<button type="button" class="cal-day${count ? ' on' : ''}${date === today ? ' today' : ''}" data-date="${date}" aria-pressed="${count > 0}" aria-label="${esc(longDay(date))}${count ? `, ${count} ${count === 1 ? 'función' : 'funciones'}` : ''}" ${date < today ? 'disabled' : ''}>${i + 1}${count > 1 ? `<small>×${count}</small>` : ''}</button>`;
      }).join('');
  }
  function paintList() {
    sort();
    list.innerHTML = items.length ? items.map((fn, i) => `<li><span class="fn-date">${esc(longDay(fn.date))}${fn.date < today ? ' <em class="muted">(ya pasó)</em>' : ''}</span><span class="field fn-time"><input type="time" value="${esc(fn.hour)}" data-hour="${i}" aria-label="Hora del ${esc(longDay(fn.date))}"></span><button type="button" class="link-btn" data-again="${i}">Otra hora</button><button type="button" class="link-btn" data-remove="${i}">Quitar</button></li>`).join('')
      : '<li class="muted">Aún no eliges fechas.</li>';
  }
  const paint = () => { paintList(); paintCalendar(); };
  root.addEventListener('click', event => {
    const step = event.target.closest('[data-step]'), day = event.target.closest('[data-date]'), again = event.target.closest('[data-again]'), remove = event.target.closest('[data-remove]');
    if (step) { month += Number(step.dataset.step); if (month < 0) { month = 11; year--; } if (month > 11) { month = 0; year++; } paintCalendar(); return; }
    if (day && !day.disabled) {
      const date = day.dataset.date;
      if (items.some(fn => fn.date === date)) items = items.filter(fn => fn.date !== date);
      else items.push({ id: String(++nextId), date, hour: hour.value || '20:00' });
      paint();
      return;
    }
    if (again) { items.push({ id: String(++nextId), date: items[Number(again.dataset.again)].date, hour: '' }); paint(); list.querySelector('input[value=""]')?.focus(); return; }
    if (remove) { items.splice(Number(remove.dataset.remove), 1); paint(); }
  });
  // Typing an hour does not redraw the list, so the field keeps its focus.
  list.addEventListener('input', event => { if (event.target.dataset.hour !== undefined) items[Number(event.target.dataset.hour)].hour = event.target.value; });
  paint();
  return {
    value() {
      if (!items.length) throw fail(root.querySelector('.calendar'), 'Elige al menos una fecha en el calendario de funciones.');
      sort(); paintList();
      const seen = new Set();
      items.forEach((fn, i) => {
        const input = list.querySelector(`[data-hour="${i}"]`), key = `${fn.date}|${fn.hour}`;
        if (!/^\d{2}:\d{2}$/.test(fn.hour)) throw fail(input, `Escribe la hora de la función del ${longDay(fn.date)}.`);
        if (seen.has(key)) throw fail(input, `La función del ${longDay(fn.date)} a las ${fn.hour} está repetida.`);
        seen.add(key);
        if (!saved.has(key) && new Date(`${fn.date}T${fn.hour}:00`).getTime() <= Date.now()) throw fail(input, `La función del ${longDay(fn.date)} a las ${fn.hour} ya pasó.`);
      });
      return items.map(({ id, date, hour: time }) => ({ id, date, hour: time }));
    },
  };
}

// Zones: one card per zone. A numbered zone takes its capacity from rows × seats per row and its
// accessible and courtesy seats are typed or tapped on its map. Venues (venue: true) keep no
// price and store how many places are accessible.
export function zoneBuilder(root, { zones = [], venue = false } = {}) {
  let list = [];
  const fromSaved = z => {
    const seat = (z.type || (/general/i.test(z.name) ? 'general' : 'seat')) === 'seat', perRow = Number(z.seatsPerRow) || (seat ? 8 : 0);
    return {
      id: ++uid, name: z.name || '', type: seat ? 'seat' : 'general', price: z.price ?? '', capacity: Number(z.capacity) || '',
      rows: seat ? Number(z.rows) || Math.ceil((Number(z.capacity) || 0) / perRow) || '' : '', perRow: seat ? perRow : '',
      accessible: Array.isArray(z.accessible) ? [...z.accessible] : [], blocked: [...(z.blockedSeats || [])],
      accessibleCount: Array.isArray(z.accessible) ? z.accessible.length : Number(z.accessible) || 0, map: false, mark: 'blocked',
    };
  };
  const blank = type => ({ id: ++uid, name: '', type, price: '', capacity: '', rows: '', perRow: '', accessible: [], blocked: [], accessibleCount: 0, map: false, mark: 'blocked' });
  root.innerHTML = `<div class="zone-list"></div><div class="zone-add"><button type="button" class="btn secondary small" data-add="seat">+ Zona numerada</button><button type="button" class="btn secondary small" data-add="general">+ Zona general</button></div>`;
  const holder = root.querySelector('.zone-list');
  const cardOf = z => holder.querySelector(`[data-zone="${z.id}"]`);
  const capacityOf = z => z.type === 'seat' ? (Number(z.rows) || 0) * (Number(z.perRow) || 0) : Number(z.capacity) || 0;
  function summary(z) {
    if (z.type === 'general') return capacityOf(z) ? `Zona sin asientos: ${capacityOf(z)} personas de pie o en lugar libre.` : 'Zona sin asientos: escribe cuántas personas caben.';
    const rows = Number(z.rows), perRow = Number(z.perRow);
    if (!rows || !perRow) return 'Zona con asientos: escribe las filas y los asientos por fila; el cupo se calcula solo.';
    return `Cupo: ${rows * perRow} asientos · filas A a ${rows <= MAX_ROWS ? rowName(rows - 1) : '…'}, asientos 1 a ${perRow}.`;
  }
  function map(z) {
    const rows = Number(z.rows), perRow = Number(z.perRow);
    if (!rows || !perRow || rows > MAX_ROWS || perRow > MAX_PER_ROW) return '<p class="muted small-note">Escribe las filas y los asientos por fila para ver el mapa.</p>';
    if (rows * perRow > MAP_LIMIT) return `<p class="muted small-note">Con más de ${MAP_LIMIT} asientos el mapa es muy grande para marcarlo aquí; escribe los asientos en los campos de arriba.</p>`;
    const accessible = new Set(z.accessible), blocked = new Set(z.blocked);
    const grid = Array.from({ length: rows }, (_, r) => `<span aria-hidden="true">${rowName(r)}</span>` + Array.from({ length: perRow }, (_, c) => {
      const label = `${rowName(r)}${c + 1}`, state = blocked.has(label) ? 'blocked' : accessible.has(label) ? 'accessible' : '';
      return `<button type="button" class="mark-seat ${state}" data-seat="${label}" aria-pressed="${Boolean(state)}" aria-label="Asiento ${label}${state === 'blocked' ? ', bloqueado' : state === 'accessible' ? ', accesible' : ''}">${state === 'blocked' ? '×' : state === 'accessible' ? '♿' : c + 1}</button>`;
    }).join('')).join('');
    return `<div class="mark-modes" role="group" aria-label="Al tocar un asiento"><span class="muted small-note">Al tocar un asiento:</span><button type="button" class="btn secondary small" data-mode="blocked" aria-pressed="${z.mark === 'blocked'}">× Bloquear (cortesía o prensa)</button><button type="button" class="btn secondary small" data-mode="accessible" aria-pressed="${z.mark === 'accessible'}">♿ Marcar accesible</button></div>
      <div class="seat-scroll"><div class="stage">ESCENARIO</div><div class="mark-grid" style="grid-template-columns:22px repeat(${perRow},minmax(30px,1fr))">${grid}</div></div>
      <p class="muted small-note">Toca otra vez un asiento marcado para quitarle la marca.</p>`;
  }
  function card(z, i) {
    const seat = z.type === 'seat';
    return `<div class="zone-head"><strong>Zona ${i + 1}</strong><button type="button" class="link-btn" data-act="remove">Quitar zona</button></div>
      <div class="zone-fields">
        <div class="field"><label for="z${z.id}-name">Nombre</label><input id="z${z.id}-name" data-k="name" maxlength="60" value="${esc(z.name)}" placeholder="${seat ? 'Preferente' : 'General'}"></div>
        <div class="field"><label for="z${z.id}-type">Tipo</label><select id="z${z.id}-type" data-k="type"><option value="seat" ${seat ? 'selected' : ''}>Numerada</option><option value="general" ${seat ? '' : 'selected'}>General</option></select></div>
        ${venue ? '' : `<div class="field"><label for="z${z.id}-price">Precio (MXN)</label><input id="z${z.id}-price" data-k="price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(z.price)}" placeholder="450"></div>`}
        ${seat ? `<div class="field"><label for="z${z.id}-rows">Filas</label><input id="z${z.id}-rows" data-k="rows" type="number" min="1" max="${MAX_ROWS}" inputmode="numeric" value="${esc(z.rows)}" placeholder="10"></div><div class="field"><label for="z${z.id}-per">Asientos por fila</label><input id="z${z.id}-per" data-k="perRow" type="number" min="1" max="${MAX_PER_ROW}" inputmode="numeric" value="${esc(z.perRow)}" placeholder="12"></div>`
          : `<div class="field"><label for="z${z.id}-cap">Cupo</label><input id="z${z.id}-cap" data-k="capacity" type="number" min="1" inputmode="numeric" value="${esc(z.capacity)}" placeholder="300"></div>`}
        ${venue && seat ? `<div class="field"><label for="z${z.id}-acc">Lugares accesibles</label><input id="z${z.id}-acc" data-k="accessibleCount" type="number" min="0" inputmode="numeric" value="${esc(z.accessibleCount)}"></div>` : ''}
      </div>
      <p class="zone-summary" data-summary>${esc(summary(z))}</p>
      ${seat && !venue ? `<div class="zone-marks"><div class="field"><label for="z${z.id}-accessible">Asientos accesibles</label><input id="z${z.id}-accessible" data-k="accessible" value="${esc(z.accessible.join(' '))}" placeholder="Ej. J1 J2" autocapitalize="characters"></div><div class="field"><label for="z${z.id}-blocked">Bloqueados para cortesía o prensa</label><input id="z${z.id}-blocked" data-k="blocked" value="${esc(z.blocked.join(' '))}" placeholder="Ej. A1 A2" autocapitalize="characters"></div></div>
        <button type="button" class="btn secondary small" data-act="map" aria-expanded="${z.map}">${z.map ? 'Ocultar mapa' : 'Marcar asientos en el mapa'}</button>
        <div class="zone-map" ${z.map ? '' : 'hidden'}>${z.map ? map(z) : ''}</div>` : ''}`;
  }
  function paint() {
    holder.innerHTML = list.length ? list.map((z, i) => `<article class="zone-card" data-zone="${z.id}">${card(z, i)}</article>`).join('') : '<p class="muted">Aún no hay zonas. Agrega una numerada (con asientos) o una general.</p>';
  }
  const repaintCard = z => { const el = cardOf(z); if (el) el.innerHTML = card(z, list.indexOf(z)); };
  const repaintMap = z => { const el = cardOf(z)?.querySelector('.zone-map'); if (el && z.map) el.innerHTML = map(z); };
  const zoneOf = target => list.find(z => z.id === Number(target.closest('[data-zone]')?.dataset.zone));
  root.addEventListener('click', event => {
    const add = event.target.closest('[data-add]');
    if (add) { const z = blank(add.dataset.add); list.push(z); paint(); cardOf(z)?.querySelector('[data-k="name"]')?.focus(); return; }
    const z = zoneOf(event.target);
    if (!z) return;
    const act = event.target.closest('[data-act]')?.dataset.act, mode = event.target.closest('[data-mode]')?.dataset.mode, seat = event.target.closest('[data-seat]')?.dataset.seat;
    if (act === 'remove') { if ((z.name || z.price !== '') && !confirm(`¿Quitar la zona «${z.name || 'sin nombre'}»?`)) return; list = list.filter(x => x !== z); paint(); return; }
    if (act === 'map') { z.map = !z.map; repaintCard(z); return; }
    if (mode) { z.mark = mode; repaintMap(z); return; }
    if (seat) {
      const own = z.mark === 'blocked' ? 'blocked' : 'accessible', other = own === 'blocked' ? 'accessible' : 'blocked';
      z[own] = z[own].includes(seat) ? z[own].filter(s => s !== seat) : [...z[own], seat];
      z[other] = z[other].filter(s => s !== seat);
      for (const key of ['accessible', 'blocked']) { const input = cardOf(z).querySelector(`[data-k="${key}"]`); if (input) input.value = z[key].join(' '); }
      repaintMap(z);
    }
  });
  root.addEventListener('input', event => {
    const key = event.target.dataset.k, z = key && zoneOf(event.target);
    if (!z || key === 'type') return;
    if (key === 'accessible' || key === 'blocked') { z[key] = seatList(event.target.value); repaintMap(z); return; }
    z[key] = event.target.value;
    cardOf(z).querySelector('[data-summary]').textContent = summary(z);
    if (key === 'rows' || key === 'perRow') repaintMap(z);
  });
  root.addEventListener('change', event => {
    if (event.target.dataset.k !== 'type') return;
    const z = zoneOf(event.target);
    z.type = event.target.value;
    repaintCard(z);
  });
  list = zones.map(fromSaved);
  paint();
  return {
    // A venue's zones arrive without prices, so each price is written on purpose.
    load(newZones) { list = newZones.map(fromSaved); paint(); },
    hasContent: () => list.some(z => z.name || z.price !== ''),
    value() {
      if (!list.length) throw fail(root.querySelector('.zone-add button'), 'Agrega al menos una zona.');
      const names = new Set();
      let total = 0;
      return list.map((z, i) => {
        const el = key => cardOf(z).querySelector(`[data-k="${key}"]`), name = String(z.name).trim(), label = name || `la zona ${i + 1}`;
        if (!name) throw fail(el('name'), `Escribe el nombre de la zona ${i + 1}.`);
        if (names.has(name.toLowerCase())) throw fail(el('name'), `Hay dos zonas llamadas «${name}»; usa nombres distintos.`);
        names.add(name.toLowerCase());
        if (!venue && (z.price === '' || !Number.isFinite(Number(z.price)) || Number(z.price) < 0)) throw fail(el('price'), `Escribe el precio de ${label}; usa 0 si la entrada es gratis.`);
        const price = Number(z.price);
        if (z.type === 'general') {
          const capacity = Number(z.capacity);
          if (!Number.isInteger(capacity) || capacity < 1) throw fail(el('capacity'), `Escribe el cupo de ${label}: un número entero mayor que cero.`);
          return venue ? { name, type: 'general', capacity, accessible: 0, rows: 0, seatsPerRow: 0 } : { name, type: 'general', price, capacity, seats: [], accessible: [], blockedSeats: [], rows: 0, seatsPerRow: 0 };
        }
        const rows = Number(z.rows), perRow = Number(z.perRow);
        if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) throw fail(el('rows'), `Escribe cuántas filas tiene ${label} (de 1 a ${MAX_ROWS}).`);
        if (!Number.isInteger(perRow) || perRow < 1 || perRow > MAX_PER_ROW) throw fail(el('perRow'), `Escribe cuántos asientos tiene cada fila de ${label} (de 1 a ${MAX_PER_ROW}).`);
        const capacity = rows * perRow;
        total += capacity;
        if (total > MAX_SEATS) throw fail(el('rows'), `Un evento puede tener hasta ${MAX_SEATS.toLocaleString('es-MX')} asientos numerados.`);
        if (venue) {
          const accessible = Number(z.accessibleCount) || 0;
          if (!Number.isInteger(accessible) || accessible < 0 || accessible > capacity) throw fail(el('accessibleCount'), `Los lugares accesibles de ${label} deben ser de 0 a ${capacity}.`);
          return { name, type: 'seat', capacity, accessible, rows, seatsPerRow: perRow };
        }
        const seats = seatLabels(capacity, perRow), inZone = new Set(seats);
        for (const [key, what] of [['accessible', 'accesible'], ['blocked', 'bloqueado']]) {
          const missing = z[key].find(s => !inZone.has(s));
          if (missing) throw fail(el(key), `El asiento ${what} ${missing} no existe en ${label}: tiene filas A a ${rowName(rows - 1)} y asientos 1 a ${perRow}.`);
        }
        return { name, type: 'seat', price, capacity, seats, rows, seatsPerRow: perRow, accessible: [...z.accessible], blockedSeats: [...z.blocked] };
      });
    },
  };
}

// A venue's zone as the event editor needs it: no price yet and its first places marked accessible.
export const zoneFromVenue = z => z.type === 'general'
  ? { name: z.name, type: 'general', price: '', capacity: z.capacity }
  : { name: z.name, type: 'seat', price: '', capacity: z.capacity, rows: z.rows, seatsPerRow: z.seatsPerRow, accessible: seatLabels(Number(z.capacity) || 0, Number(z.seatsPerRow) || 8).slice(0, Number(z.accessible) || 0) };
