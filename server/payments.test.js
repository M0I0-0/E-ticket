import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from './accounts.js';

const MINUTE = 60000;

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eticket-payments-'));
  const filename = join(dir, 'payments.sqlite');
  const messages = [], clock = { now: Date.now() };
  const app = createAccounts({ ADMIN_EMAIL: 'admin@example.com' }, {
    filename, clock: () => clock.now, log: () => {},
    transport: { async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } },
    ...options,
  });
  const server = createServer((req, res) => app.middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const request = async (path, data, cookie = '', method = 'POST', headers = {}) => {
    const response = await fetch(`${origin}/api/${path}`, {
      method, headers: { 'Content-Type': 'application/json', cookie, ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) }),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };

  const register = async email => {
    const data = { email, firstNames: 'Cristian', paternalSurname: 'Tester', maternalSurname: 'Demo', password: 'MiClave123!', confirmPassword: 'MiClave123!' };
    assert.equal((await request('auth/register', data)).status, 201);
    const code = messages.filter(m => m.to === email).at(-1).text.match(/\d{6}/)[0];
    const verified = await request('auth/verify', { email, code });
    assert.equal(verified.status, 200);
    return verified.cookie;
  };

  const hold = (cookie, body) => request('holds', { eventId: 1, functionId: '1', zone: 'Preferente', ...body }, cookie);
  const occupied = async (cookie = '') => (await request('availability?eventId=1&functionId=1&zone=Preferente', null, cookie, 'GET')).body.occupied;

  return { request, register, hold, occupied, filename, advance: ms => { clock.now += ms; } };
}

// -----------------------------------------------------------------------------
// PRUEBA 1: T07.1, T07.3, T07.4, T07.8 · Pago aprobado con desglose y comprobante
// -----------------------------------------------------------------------------
test('Prueba 1 / T07: Pago aprobado en sandbox genera comprobante, desglose exacto y boletos válidos', async t => {
  const f = await fixture(t);
  const buyer = await f.register('buyer.pago@example.com');

  // Apartar dos asientos en Evento 1 (Preferente, base: 450)
  const holdRes = await f.hold(buyer, { seats: ['A1', 'A2'] });
  assert.equal(holdRes.status, 201);
  const currentHold = holdRes.body.hold;
  assert.equal(currentHold.status, 'active');

  // T07.3: Si se envía el número de tarjeta completo al servidor, se rechaza por seguridad
  const unsafeAttempt = await f.request('payments/charge', {
    holdId: currentHold.id,
    token: 'tok_sandbox_test',
    last4: '4242',
    number: '4242424242424242', // VIOLACIÓN DE SEGURIDAD
    idempotencyKey: 'ik-unsafe-1',
  }, buyer);
  assert.equal(unsafeAttempt.status, 400);
  assert.ok(unsafeAttempt.body.error.includes('seguridad'));

  // Desglose esperado:
  // Base: 450 * 2 = 900
  // Fee (10%): 90
  // IVA (16% de 990): 158.40
  // Total: 900 + 90 + 158.40 = 1148.40
  const expectedTotal = 1148.40;

  // Pago seguro sin datos sensibles: solo token y last4
  const chargeRes = await f.request('payments/charge', {
    holdId: currentHold.id,
    token: 'tok_sandbox_valid',
    last4: '4242',
    brand: 'VISA',
    idempotencyKey: 'ik-pago-aprobado-1',
  }, buyer);

  assert.equal(chargeRes.status, 200);
  assert.equal(chargeRes.body.ok, true);

  const order = chargeRes.body.order;
  assert.ok(order.id.startsWith('ET-'));
  assert.equal(order.total, expectedTotal);
  assert.equal(order.payment.last4, '4242');
  assert.equal(order.payment.brand, 'VISA');
  assert.ok(order.payment.transactionId.startsWith('pay_sandbox_'));

  // Comprobante contiene desglose
  assert.equal(order.breakdown.base, 900);
  assert.equal(order.breakdown.fee, 90);
  assert.equal(order.breakdown.vat, 158.40);
  assert.equal(order.breakdown.total, expectedTotal);

  // Boletos creados correctamente
  assert.equal(order.tickets.length, 2);
  assert.deepEqual(order.tickets.map(t => t.seat).sort(), ['A1', 'A2']);
  assert.ok(order.tickets[0].code.includes(order.id));

  // El apartado pasa a completed y ya no está abierto
  const holdAfter = (await f.request('holds/current', null, buyer, 'GET')).body;
  assert.equal(holdAfter.hold, null);
  assert.equal(holdAfter.recent.status, 'completed');

  // Los asientos A1 y A2 siguen ocupados (ahora por venta)
  assert.ok((await f.occupied()).includes('A1'));
  assert.ok((await f.occupied()).includes('A2'));
});

// -----------------------------------------------------------------------------
// PRUEBA 2: T07.7 · 3 pagos rechazados cancelan compra y liberan asientos
// -----------------------------------------------------------------------------
test('Prueba 2 / T07: 3 pagos rechazados conservan lugares en intentos 1 y 2, y liberan asientos al tercer rechazo', async t => {
  const f = await fixture(t);
  const buyer = await f.register('buyer.rechazos@example.com');
  const otherBuyer = await f.register('other.buyer@example.com');

  // Apartar asiento B1
  const holdRes = await f.hold(buyer, { seats: ['B1'] });
  assert.equal(holdRes.status, 201);
  const holdId = holdRes.body.hold.id;
  assert.ok((await f.occupied()).includes('B1'));

  // Intento 1: Rechazado
  const rechazo1 = await f.request('payments/charge', {
    holdId,
    token: 'tok_reject_funds',
    last4: '0002',
    idempotencyKey: 'ik-rechazo-1',
  }, buyer);
  assert.equal(rechazo1.status, 402);
  assert.equal(rechazo1.body.attempts, 1);
  assert.equal(rechazo1.body.cancelled, false);
  // Asiento B1 sigue apartado
  assert.ok((await f.occupied()).includes('B1'));

  // Intento 2: Rechazado
  const rechazo2 = await f.request('payments/charge', {
    holdId,
    token: 'tok_reject_funds',
    last4: '0002',
    idempotencyKey: 'ik-rechazo-2',
  }, buyer);
  assert.equal(rechazo2.status, 402);
  assert.equal(rechazo2.body.attempts, 2);
  assert.equal(rechazo2.body.cancelled, false);
  // Asiento B1 sigue apartado
  assert.ok((await f.occupied()).includes('B1'));

  // Intento 3: Tercer rechazo consecutivo -> cancelación y liberación automática
  const rechazo3 = await f.request('payments/charge', {
    holdId,
    token: 'tok_reject_funds',
    last4: '0002',
    idempotencyKey: 'ik-rechazo-3',
  }, buyer);
  assert.equal(rechazo3.status, 400);
  assert.equal(rechazo3.body.attempts, 3);
  assert.equal(rechazo3.body.cancelled, true);

  // Asiento B1 ahora está LIBRE inmediatamente
  assert.ok(!(await f.occupied()).includes('B1'));

  // El otro comprador ahora puede apartar B1 sin conflicto
  const otherHold = await f.hold(otherBuyer, { seats: ['B1'] });
  assert.equal(otherHold.status, 201);
  assert.ok((await f.occupied()).includes('B1'));
});

// -----------------------------------------------------------------------------
// PRUEBA 3: T07.6 · Sin doble cobro con llave de idempotencia
// -----------------------------------------------------------------------------
test('Prueba 3 / T07: Dos clics seguidos con la misma llave de idempotencia generan exactamente un cobro', async t => {
  const f = await fixture(t);
  const buyer = await f.register('buyer.idempotente@example.com');

  const holdRes = await f.hold(buyer, { seats: ['C1'] });
  assert.equal(holdRes.status, 201);
  const holdId = holdRes.body.hold.id;

  const idempotencyKey = 'ik-unique-order-abc123';

  // Simular dos peticiones consecutivas / doble clic rápido
  const [res1, res2] = await Promise.all([
    f.request('payments/charge', {
      holdId,
      token: 'tok_sandbox_valid',
      last4: '4242',
      idempotencyKey,
    }, buyer),
    f.request('payments/charge', {
      holdId,
      token: 'tok_sandbox_valid',
      last4: '4242',
      idempotencyKey,
    }, buyer),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  assert.equal(res1.body.order.id, res2.body.order.id);

  // Verificar en la base de datos que solo existe 1 registro en la tabla payments
  const db = new DatabaseSync(f.filename);
  try {
    const paymentRows = db.prepare('SELECT COUNT(*) as count FROM payments WHERE idempotency_key=?').get(idempotencyKey);
    assert.equal(paymentRows.count, 1);

    // Y en user_orders solo existe 1 orden
    const ordersRow = db.prepare('SELECT payload FROM user_orders').all();
    const allOrders = ordersRow.flatMap(r => JSON.parse(r.payload));
    assert.equal(allOrders.length, 1);
  } finally {
    db.close();
  }
});

// -----------------------------------------------------------------------------
// PRUEBA 4: T07.5 · Confirmación por webhook si el usuario cierra la página
// -----------------------------------------------------------------------------
test('Prueba 4 / T07: Si el usuario cierra la página después de pagar, el webhook crea los boletos y la orden', async t => {
  const f = await fixture(t);
  const buyer = await f.register('buyer.cierre@example.com');

  const holdRes = await f.hold(buyer, { seats: ['D7'] });
  assert.equal(holdRes.status, 201);
  const holdId = holdRes.body.hold.id;

  // Congelar en estado 'paying' (como ocurre al enviar datos a la pasarela)
  await f.request(`holds/${holdId}/pay`, {}, buyer);

  // El usuario cierra la página y se desconecta (no hace petición para guardar orden).
  // La pasarela de pagos notifica de forma autónoma al webhook del servidor:
  const webhookRes = await f.request('payments/webhook', {
    event: 'payment.succeeded',
    paymentId: 'pay_webhook_998877',
    holdId,
    amount: 529.20,
    last4: '4242',
    brand: 'MASTERCARD',
    idempotencyKey: 'ik-webhook-d7',
  });

  assert.equal(webhookRes.status, 200);
  assert.equal(webhookRes.body.ok, true);

  // Cuando el usuario vuelve a abrir la página e inicia sesión, consulta sus órdenes:
  const ordersRes = await f.request('orders', null, buyer, 'GET');
  assert.equal(ordersRes.status, 200);
  assert.equal(ordersRes.body.orders.length, 1);

  const savedOrder = ordersRes.body.orders[0];
  assert.equal(savedOrder.holdId, holdId);
  assert.equal(savedOrder.tickets.length, 1);
  assert.equal(savedOrder.tickets[0].seat, 'D7');
  assert.equal(savedOrder.payment.last4, '4242');

  // El asiento D7 permanece ocupado por la compra
  assert.ok((await f.occupied()).includes('D7'));
});

// -----------------------------------------------------------------------------
// PRUEBA 5: T07.9 / RN-12 · Pagos aprobados sin boletos registrados para admin
// -----------------------------------------------------------------------------
test('Prueba 5 / T07.9: Pagos sin boletos (RN-12) se registran en lista administrativa con fecha y monto', async t => {
  const f = await fixture(t);
  const adminCookie = await f.register('admin@example.com');
  const buyer = await f.register('buyer.huerfano@example.com');

  const holdRes = await f.hold(buyer, { seats: ['A6'] });
  assert.equal(holdRes.status, 201);
  const holdId = holdRes.body.hold.id;

  // Simular cobro aprobado que por anomalía no pudo emitir boletos
  const orphanRes = await f.request('payments/charge', {
    holdId,
    token: 'tok_sandbox_orphan',
    last4: '9999',
    simulate: 'orphan_payment',
    idempotencyKey: 'ik-orphan-rn12',
  }, buyer);

  assert.equal(orphanRes.body.status, 'orphan_payment');
  assert.ok(orphanRes.body.orphanId);

  // El administrador consulta la lista de pagos sin boletos
  const listRes = await f.request('admin/unresolved-payments', null, adminCookie, 'GET');
  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.payments.length >= 1);

  const found = listRes.body.payments.find(p => p.id === orphanRes.body.orphanId);
  assert.ok(found);
  assert.equal(found.email, 'buyer.huerfano@example.com');
  assert.equal(found.status, 'unresolved');
  assert.ok(found.amount > 0);
  assert.ok(found.created > 0);

  // Un comprador normal no puede acceder a esta lista (403)
  const forbiddenRes = await f.request('admin/unresolved-payments', null, buyer, 'GET');
  assert.equal(forbiddenRes.status, 403);

  // El administrador resuelve el caso
  const resolveRes = await f.request(`admin/unresolved-payments/${found.id}/resolve`, {
    notes: 'Boletos emitidos manualmente vía atención a clientes',
  }, adminCookie);
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.body.status, 'resolved');
});
