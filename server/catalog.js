// What the server knows about any event: the five sample events (also listed in
// app.js for visitors) and the events organizers publish in the events table.
export const SAMPLE_SEATS = ['A', 'B', 'C', 'D'].flatMap(row => Array.from({ length: 8 }, (_, i) => `${row}${i + 1}`));
export const SAMPLE_TAKEN = ['A3', 'A4', 'B6', 'C2', 'C7', 'D5'];
export const SAMPLE_ACCESSIBLE = ['D1', 'D2'];
export const SAMPLE_GENERAL_CAPACITY = 24;
export const SAMPLE_EVENTS = {
  1: { name: 'Ecos de medianoche', artist: 'Sesión en vivo', category: 'Conciertos', city: 'Mérida', venue: 'Teatro del Centro', date: '2026-11-14', hour: '20:00', price: 450, zone: 'Preferente', type: 'seat' },
  2: { name: 'Entre dos mundos', artist: 'Compañía Horizonte', category: 'Teatro', city: 'Mérida', venue: 'Foro Horizonte', date: '2026-11-21', hour: '19:30', price: 280, zone: 'Luneta', type: 'seat' },
  3: { name: 'Ritmo al aire libre', artist: 'Festival de otoño', category: 'Festivales', city: 'Cancún', venue: 'Parque del Mar', date: '2026-12-05', hour: '17:00', price: 650, zone: 'General', type: 'general' },
  4: { name: 'Noche de comedia', artist: 'Risas en el foro', category: 'Comedia', city: 'Mérida', venue: 'Foro Norte', date: '2026-11-28', hour: '21:00', price: 320, zone: 'General', type: 'general' },
  5: { name: 'Piano en penumbra', artist: 'Recital de temporada', category: 'Conciertos', city: 'Campeche', venue: 'Sala del Centro', date: '2026-12-12', hour: '20:00', price: 390, zone: 'Preferente', type: 'seat' },
};
export const SAMPLE_ZONES = Object.fromEntries(Object.entries(SAMPLE_EVENTS).map(([id, e]) => [id, e.zone]));
export const VAT_RATE = 0.16;
// Function dates are local times (the server runs in the venue's time zone).
export const startsAt = (date, hour) => new Date(`${date}T${hour || '00:00'}:00`).getTime();
export const round = value => Math.round(value * 100) / 100;

export function createCatalog(db) {
  function event(id) {
    id = String(id ?? '');
    const sample = SAMPLE_EVENTS[id];
    if (sample) {
      const seat = sample.type === 'seat';
      return {
        id, sample: true, ownerId: null, status: 'published', name: sample.name, artist: sample.artist, category: sample.category, city: sample.city, venue: sample.venue,
        functions: [{ id: '1', date: sample.date, hour: sample.hour, startsAt: startsAt(sample.date, sample.hour) }],
        zones: [{ name: sample.zone, type: sample.type, price: sample.price, capacity: seat ? SAMPLE_SEATS.length - SAMPLE_TAKEN.length : SAMPLE_GENERAL_CAPACITY, seats: seat ? SAMPLE_SEATS : [], taken: seat ? SAMPLE_TAKEN : [], blocked: [], accessible: seat ? SAMPLE_ACCESSIBLE : [] }],
        ticketLimit: 6,
      };
    }
    const row = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (!row) return null;
    const p = JSON.parse(row.payload);
    const functions = (p.functions?.length ? p.functions : [{ id: '1', date: p.date, hour: p.hour || '20:00' }])
      .map(fn => ({ id: String(fn.id), date: fn.date, hour: fn.hour, startsAt: startsAt(fn.date, fn.hour) }));
    return {
      id, sample: false, ownerId: row.owner_id, status: row.status, name: p.name, artist: p.artist || '', category: p.category || '', city: p.city || '', venue: p.venue || '',
      functions,
      zones: (p.zones || []).map(z => ({
        name: z.name, type: z.type || (/general/i.test(z.name) ? 'general' : 'seat'), price: Number(z.price) || 0, capacity: Number(z.capacity) || 0,
        seats: z.seats || [], taken: [], blocked: [...new Set([...(p.blockedSeats || []), ...(z.blockedSeats || [])])], accessible: z.accessible || [],
      })),
      ticketLimit: Number(p.ticketLimit) || 6, saleStart: p.saleStart, saleEnd: p.saleEnd,
    };
  }
  const fn = (ev, id) => ev?.functions.find(f => f.id === String(id)) || null;
  const zone = (ev, name) => ev?.zones.find(z => z.name === name) || null;
  const label = (ev, id) => { const f = fn(ev, id); return f ? `${f.date} ${f.hour}` : ''; };
  // Every event a buyer can see: the samples plus published events.
  const listed = () => [...Object.keys(SAMPLE_EVENTS), ...db.prepare("SELECT id FROM events WHERE status='published'").all().map(r => r.id)].map(event);
  return { event, fn, zone, label, listed };
}
