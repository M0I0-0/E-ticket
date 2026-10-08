import { randomBytes } from 'node:crypto';

const SAMPLE_PRICES = { '1': 450, '2': 280, '3': 650, '4': 320, '5': 390 };
const SAMPLE_ZONES = { '1': 'Preferente', '2': 'Luneta', '3': 'General', '4': 'General', '5': 'Preferente' };

export function createPayments(db, holds, { clock = Date.now, log = console.log, failure }) {
  // Ensure table holds has payment_attempts column
  const holdCols = db.prepare('PRAGMA table_info(holds)').all().map(c => c.name);
  if (!holdCols.includes('payment_attempts')) {
    db.exec('ALTER TABLE holds ADD COLUMN payment_attempts INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      hold_id TEXT REFERENCES holds(id),
      user_id TEXT REFERENCES users(id),
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      last4 TEXT NOT NULL,
      brand TEXT NOT NULL,
      error_message TEXT DEFAULT '',
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orphan_payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      email TEXT NOT NULL,
      hold_id TEXT,
      event_id TEXT,
      amount REAL NOT NULL,
      last4 TEXT NOT NULL,
      gateway_ref TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unresolved',
      resolution_notes TEXT DEFAULT '',
      created INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS orphan_payments_status ON orphan_payments(status);
  `);

  function calculateAmount(hold) {
    const id = String(hold.event_id);
    let basePrice = SAMPLE_PRICES[id];
    let zoneName = SAMPLE_ZONES[id];
    let fnDate = '2026-11-14', fnHour = '20:00';

    if (!basePrice) {
      const eventRow = db.prepare("SELECT payload FROM events WHERE id=? AND status='published'").get(id);
      if (!eventRow) throw failure(404, 'El evento ya no está disponible para compra.');
      const payload = JSON.parse(eventRow.payload);
      const zone = payload.zones?.find(z => z.name === hold.zone) || payload.zones?.[0];
      if (!zone) throw failure(400, 'La zona del apartado no existe.');
      basePrice = Number(zone.price) || 0;
      zoneName = zone.name;
      const fn = payload.functions?.find(f => String(f.id) === String(hold.function_id)) || payload.functions?.[0];
      if (fn) { fnDate = fn.date; fnHour = fn.hour; }
    }

    const count = hold.kind === 'seat' ? JSON.parse(hold.seats).length : hold.quantity;
    const base = Math.round(basePrice * count * 100) / 100;
    const fee = Math.round(base * 0.10 * 100) / 100;
    const vat = Math.round((base + fee) * 0.16 * 100) / 100;
    const total = Math.round((base + fee + vat) * 100) / 100;

    return { basePrice, zoneName, fnDate, fnHour, count, base, fee, vat, total };
  }

  function confirmPaymentAndCreateOrder({ user, hold, transactionId, amount, breakdown, last4, brand, idempotencyKey }) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-verify hold status inside transaction
      const currentHold = db.prepare('SELECT * FROM holds WHERE id=? AND user_id=?').get(hold.id, user.id);
      const now = clock();

      if (!currentHold || currentHold.status === 'expired' || currentHold.status === 'cancelled') {
        // RN-12: The payment was approved by sandbox, but hold was expired or cancelled
        const orphanId = 'orph_' + randomBytes(8).toString('hex');
        db.prepare(`
          INSERT INTO orphan_payments (id, user_id, email, hold_id, event_id, amount, last4, gateway_ref, reason, status, created)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved', ?)
        `).run(orphanId, user.id, user.email, hold.id, hold.event_id, amount, last4, transactionId, 'Apartado vencido o cancelado al momento de confirmar pago', now);

        db.prepare(`
          INSERT INTO payments (id, idempotency_key, hold_id, user_id, amount, status, last4, brand, error_message, created)
          VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, 'Huérfano: sin boletos generados', ?)
        `).run(transactionId, idempotencyKey, hold.id, user.id, amount, last4, brand, now);

        db.exec('COMMIT');
        return {
          ok: false,
          orphan: true,
          orphanId,
          error: 'El pago fue aprobado por el banco pero tus boletos no pudieron generarse porque el tiempo límite expiró. Se ha registrado el reporte para resolución administrativa.',
        };
      }

      const orderId = 'ET-' + randomBytes(4).toString('hex').toUpperCase();
      const seats = hold.kind === 'seat'
        ? JSON.parse(hold.seats)
        : Array.from({ length: hold.quantity }, (_, i) => `Acceso ${i + 1}`);

      const order = {
        id: orderId,
        eventId: Number(hold.event_id) || hold.event_id,
        holdId: hold.id,
        time: new Date(now).toISOString(),
        total: amount,
        breakdown,
        payment: {
          method: 'card',
          last4,
          brand,
          transactionId,
        },
        zone: breakdown.zoneName || hold.zone,
        functionId: hold.function_id,
        functionDate: breakdown.fnDate,
        functionHour: breakdown.fnHour,
        tickets: seats.map((seat, i) => ({
          seat,
          code: `${orderId}-${String(i + 1).padStart(3, '0')}`,
          owner: user.name,
          transferred: false,
        })),
      };

      // Completes hold inside transaction
      holds.completeForOrder(user, order);

      // Update sales for published events
      const eventRow = db.prepare("SELECT * FROM events WHERE id=? AND status='published'").get(String(hold.event_id));
      if (eventRow) {
        const payload = JSON.parse(eventRow.payload);
        const zone = payload.zones?.find(z => z.name === hold.zone) || payload.zones?.[0];
        if (zone) {
          const fnId = String(hold.function_id || payload.functions?.[0]?.id || '1');
          if (zone.type === 'seat') {
            for (const ticket of order.tickets) {
              try {
                db.prepare('INSERT INTO event_function_seats(event_id,function_id,zone,seat,order_id) VALUES(?,?,?,?,?)')
                  .run(eventRow.id, fnId, zone.name, ticket.seat, order.id);
              } catch {}
            }
          }
          db.prepare('INSERT INTO event_function_sales(event_id,function_id,zone,sold) VALUES(?,?,?,?) ON CONFLICT(event_id,function_id,zone) DO UPDATE SET sold=sold+excluded.sold')
            .run(eventRow.id, fnId, zone.name, order.tickets.length);
          db.prepare('INSERT INTO event_sales(event_id,zone,sold) VALUES(?,?,?) ON CONFLICT(event_id,zone) DO UPDATE SET sold=sold+excluded.sold')
            .run(eventRow.id, zone.name, order.tickets.length);
        }
      }

      // Prepend order to user_orders
      const existingRow = db.prepare('SELECT payload FROM user_orders WHERE user_id=?').get(user.id);
      const existingOrders = existingRow ? JSON.parse(existingRow.payload) : [];
      db.prepare('INSERT INTO user_orders (user_id,payload) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload')
        .run(user.id, JSON.stringify([order, ...existingOrders]));

      // Record successful payment
      db.prepare(`
        INSERT INTO payments (id, idempotency_key, hold_id, user_id, amount, status, last4, brand, error_message, created)
        VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, '', ?)
      `).run(transactionId, idempotencyKey, hold.id, user.id, amount, last4, brand, now);

      db.exec('COMMIT');
      return { ok: true, order, payment: { transactionId, last4, brand, amount } };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function charge(user, data) {
    // T07.3: Strict security rule: full card number and CVV must NEVER arrive or be stored on server!
    if (data.number || data.cardNumber || data.cvc || data.cvv || data.securityCode) {
      throw failure(400, 'Violación de seguridad: los datos completos de tarjeta nunca deben transmitirse al servidor.');
    }

    const holdId = String(data.holdId || '').trim();
    if (!holdId) throw failure(400, 'Se requiere el identificador del apartado (holdId).');

    const token = String(data.token || '').trim();
    if (!token) throw failure(400, 'Se requiere el token de pago seguro de la pasarela.');

    const last4 = String(data.last4 || '').trim();
    if (!/^\d{4}$/.test(last4)) throw failure(400, 'Los últimos 4 dígitos de la tarjeta son inválidos.');

    const brand = String(data.brand || 'VISA').trim();
    const idempotencyKey = String(data.idempotencyKey || '').trim();
    if (!idempotencyKey) throw failure(400, 'Se requiere una clave de idempotencia única.');

    // T07.6: Sin doble cobro - check existing payment with same idempotencyKey
    const existingPayment = db.prepare('SELECT * FROM payments WHERE idempotency_key=?').get(idempotencyKey);
    if (existingPayment) {
      if (existingPayment.status === 'approved') {
        const userOrdersRow = db.prepare('SELECT payload FROM user_orders WHERE user_id=?').get(user.id);
        const userOrders = userOrdersRow ? JSON.parse(userOrdersRow.payload) : [];
        const existingOrder = userOrders.find(o => o.holdId === existingPayment.hold_id || o.payment?.transactionId === existingPayment.id);
        return {
          ok: true,
          duplicate: true,
          order: existingOrder,
          payment: {
            transactionId: existingPayment.id,
            last4: existingPayment.last4,
            brand: existingPayment.brand,
            amount: existingPayment.amount,
          },
        };
      }
      return {
        ok: false,
        duplicate: true,
        error: 'Este intento de pago ya fue procesado y rechazado previamente.',
      };
    }

    // Find hold and check ownership
    const hold = db.prepare('SELECT * FROM holds WHERE id=? AND user_id=?').get(holdId, user.id);
    if (!hold) throw failure(404, 'Apartado no encontrado.');
    if (hold.status === 'completed') throw failure(409, 'Esta compra ya fue pagada.');
    if (hold.status === 'cancelled') throw failure(409, 'Esta compra fue cancelada.');
    if (hold.status === 'expired') throw failure(410, 'Tu reserva expiró. Los lugares se liberaron.');

    // T07.4: Estado En pago - freeze hold for up to 5 minutes
    holds.pay(user, hold.id);

    // Calculate itemized breakdown and exact total (T07.1 / RN-10)
    const breakdown = calculateAmount(hold);
    const amount = breakdown.total;

    // Simulate rejection scenarios (T07.7)
    const isRejection = token.includes('reject') || token.includes('fail') || last4 === '0002' || data.simulate === 'rejected';
    if (isRejection) {
      const failedResult = holds.paymentFailed(user, hold.id);
      const transactionId = 'pay_failed_' + randomBytes(8).toString('hex');

      db.prepare(`
        INSERT INTO payments (id, idempotency_key, hold_id, user_id, amount, status, last4, brand, error_message, created)
        VALUES (?, ?, ?, ?, ?, 'rejected', ?, ?, 'Fondos insuficientes', ?)
      `).run(transactionId, idempotencyKey, hold.id, user.id, amount, last4, brand, clock());

      if (failedResult.cancelled) {
        return {
          ok: false,
          status: 'rejected',
          cancelled: true,
          attempts: failedResult.attempts || 3,
          maxAttempts: 3,
          error: 'Pago rechazado: Fondos insuficientes. Has alcanzado el límite de 3 intentos. Tu compra fue cancelada y los lugares se liberaron.',
        };
      }

      return {
        ok: false,
        status: 'rejected',
        cancelled: false,
        attempts: failedResult.attempts || 1,
        maxAttempts: 3,
        hold: failedResult.hold,
        error: `Pago rechazado por el banco (Fondos insuficientes). Intento ${failedResult.attempts || 1} de 3. Tus lugares siguen apartados mientras dure el tiempo de reserva.`,
      };
    }

    // Simulate orphan payment (T07.9 / RN-12)
    if (data.simulate === 'orphan_payment' || last4 === '9999') {
      const transactionId = 'pay_orphan_' + randomBytes(8).toString('hex');
      const orphanId = 'orph_' + randomBytes(8).toString('hex');
      const now = clock();

      db.prepare(`
        INSERT INTO payments (id, idempotency_key, hold_id, user_id, amount, status, last4, brand, error_message, created)
        VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, 'Pago aprobado sin boletos (RN-12)', ?)
      `).run(transactionId, idempotencyKey, hold.id, user.id, amount, last4, brand, now);

      db.prepare(`
        INSERT INTO orphan_payments (id, user_id, email, hold_id, event_id, amount, last4, gateway_ref, reason, status, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved', ?)
      `).run(orphanId, user.id, user.email, hold.id, hold.event_id, amount, last4, transactionId, 'Simulación RN-12: Error interno al generar boletos tras cobro aprobado', now);

      return {
        ok: false,
        status: 'orphan_payment',
        orphanId,
        paymentId: transactionId,
        error: 'El cobro fue aprobado pero ocurrió un error al generar tus boletos. El caso ha sido registrado para resolución por el administrador.',
      };
    }

    // Normal successful payment (T07.5, T07.8)
    const transactionId = 'pay_sandbox_' + randomBytes(8).toString('hex');
    const result = confirmPaymentAndCreateOrder({
      user,
      hold,
      transactionId,
      amount,
      breakdown,
      last4,
      brand,
      idempotencyKey,
    });

    return result;
  }

  // T07.5: Confirmation via Webhook from sandbox payment gateway
  function webhook(payload) {
    if (!payload || payload.event !== 'payment.succeeded') {
      throw failure(400, 'Evento de webhook no soportado.');
    }

    const { paymentId, holdId, amount, last4, brand, idempotencyKey } = payload;
    if (!holdId || !paymentId) throw failure(400, 'Datos de webhook incompletos.');

    // Find hold and associated user
    const hold = db.prepare('SELECT * FROM holds WHERE id=?').get(holdId);
    if (!hold) throw failure(404, 'Apartado no encontrado.');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(hold.user_id);
    if (!user) throw failure(404, 'Usuario del apartado no encontrado.');

    // Check if already processed
    const existing = db.prepare('SELECT * FROM payments WHERE id=? OR idempotency_key=?').get(paymentId, idempotencyKey || paymentId);
    if (existing && existing.status === 'approved') {
      return { ok: true, duplicate: true, paymentId: existing.id };
    }

    const breakdown = calculateAmount(hold);
    const finalAmount = Number(amount) || breakdown.total;

    return confirmPaymentAndCreateOrder({
      user,
      hold,
      transactionId: paymentId,
      amount: finalAmount,
      breakdown,
      last4: last4 || '4242',
      brand: brand || 'VISA',
      idempotencyKey: idempotencyKey || paymentId,
    });
  }

  // T07.9: Admin list and resolution of orphan payments (RN-12)
  function getUnresolvedPayments() {
    return db.prepare(`
      SELECT o.*, u.name as user_name
      FROM orphan_payments o
      JOIN users u ON u.id = o.user_id
      ORDER BY o.created DESC
    `).all();
  }

  function resolveOrphanPayment(id, notes = '') {
    const item = db.prepare('SELECT * FROM orphan_payments WHERE id=?').get(id);
    if (!item) throw failure(404, 'Registro de pago huérfano no encontrado.');
    const now = clock();
    db.prepare(`
      UPDATE orphan_payments
      SET status='resolved', resolution_notes=?, resolved_at=?
      WHERE id=?
    `).run(String(notes || 'Resuelto por administrador'), now, id);
    return { ok: true, id, status: 'resolved' };
  }

  return {
    charge,
    webhook,
    getUnresolvedPayments,
    resolveOrphanPayment,
  };
}
