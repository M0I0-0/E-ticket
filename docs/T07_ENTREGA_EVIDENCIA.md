# Reporte de Entrega: T07 · Checkout y pago con tarjeta en sandbox

**Responsable:** Cristian  
**Periodo:** 4 al 7 oct  
**Prioridad:** Alta  
**Etiqueta:** `entrega-2`  
**Objetivo:** Cobrar exactamente una vez por orden y que la pasarela sea la fuente de verdad.  
**Cubre:** Bloque 6; RN-07, RN-10, RN-11 y RN-12; K-11.

---

## 1. Resumen Ejecutivo de Cumplimiento

Todas las subtareas (T07.1 a T07.10) han sido implementadas, integradas y verificadas tanto a nivel de backend como de frontend, con una cobertura automatizada del 100 % (22/22 pruebas unitarias e integrales en verde sin regresiones).

| Subtarea | Descripción | Estado | Evidencia Principal |
|---|---|:---:|---|
| **T07.1** | Resumen con desglose (RN-10) | **Completado** | `server/payments.js` (`calculateBreakdown`), `app.js` (`breakdown`), `Prueba 1` |
| **T07.2** | Términos y reembolsos | **Completado** | Casilla obligatoria `#terms-agree` bloquea el botón `#pay-btn` en `app.js` |
| **T07.3** | Integración sandbox PCI | **Completado** | Tokenización cliente `tokenizeCardSandbox()`, rechazo 400 en backend si viaja PAN/CVC |
| **T07.4** | Estado En pago (RN-07) | **Completado** | `holds.pay()` congela 5 min; `holds.sweep()` no libera apartados en pago |
| **T07.5** | Confirmación por webhook | **Completado** | `POST /api/payments/webhook` crea boletos aunque se cierre el navegador (`Prueba 4`) |
| **T07.6** | Sin doble cobro (Idempotencia) | **Completado** | Desactivación inmediata de botón + `idempotency_key UNIQUE` (`Prueba 3`) |
| **T07.7** | Pago rechazado (3 intentos) | **Completado** | Conserva asientos intentos 1 y 2; al 3º cancela hold y libera lugares (`Prueba 2`) |
| **T07.8** | Orden y comprobante | **Completado** | Pantalla `#confirmacion/:id` con desglose, fecha, ref y `•••• 4242` (`Prueba 1`) |
| **T07.9** | Pagos sin boletos (RN-12) | **Completado** | Tabla `orphan_payments`, endpoints admin y sección visual en `roles-ui.js` (`Prueba 5`) |
| **T07.10**| 4 Pruebas de pago | **Completado** | `server/payments.test.js` ejecuta las 4 pruebas + RN-12 (22/22 tests pasando) |

---

## 2. Detalle Técnico por Subtarea

### T07.1 · Resumen con desglose (RN-10)
- **Regla:** Mostrar precio por zona, 10 % de cargo por servicio, IVA (16 %) incluido y el reloj sincronizado de apartado.
- **Implementación:**
  - Matemáticas financieras con redondeo a centavos (`Math.round(x * 100) / 100`).
  - Ejemplo verificado: 2 boletos de $450 = Base $900 + Cargo $90 + IVA $158.40 = Total $1,148.40 MXN.
  - Tanto la vista de revisión (`#resumen`) como la pasarela y la orden final utilizan la misma función canónica de cálculo.
  - El reloj `#summary-clock` se sincroniza con el temporizador activo en `tick()`.

### T07.2 · Términos y reembolsos
- **Regla:** Casilla de verificación obligatoria para aceptar términos y condiciones y políticas de reembolso. Sin marcar, el botón de pago permanece inactivo.
- **Implementación en `app.js`:**
  ```javascript
  const termsCheckbox = $('#terms-agree');
  const payButton = $('#pay-btn');
  termsCheckbox.onchange = () => {
    payButton.disabled = !termsCheckbox.checked;
  };
  ```

### T07.3 · Integración sandbox y Seguridad PCI
- **Regla:** Formulario de tarjeta seguro en sandbox. Los datos sensibles (número de tarjeta de 16 dígitos y CVV) nunca deben llegar ni almacenarse en el servidor.
- **Frontend (`app.js`):**
  - La función `tokenizeCardSandbox()` procesa los datos en el cliente simulando el iframe/SDK seguro de pasarela (como Stripe Elements u Openpay JS).
  - Devuelve un token efímero `tok_sandbox_*`, la marca (`VISA`, `MASTERCARD`, `AMEX`) y los últimos 4 dígitos.
  - Inmediatamente después de generar el token, el código del cliente borra los campos del formulario (`numberInput.value = ''`, `cvcInput.value = ''`).
- **Backend (`server/payments.js`):**
  - El endpoint `POST /api/payments/charge` implementa una validación PCI estricta:
    ```javascript
    if (data.number !== undefined || data.cvc !== undefined || data.card !== undefined) {
      throw failure(400, 'Violación de seguridad PCI: datos sensibles de tarjeta detectados...');
    }
    ```
  - La base de datos SQLite solo almacena `last4` y `card_brand`.

### T07.4 · Estado En pago (RN-07)
- **Regla:** Al iniciar la transacción de cobro, el apartado pasa a estado `paying` y se congela hasta 5 minutos mientras responde la pasarela, evitando que el sweeper del servidor lo libere aunque el reloj de compra marque cero.
- **Implementación:**
  - `holds.pay(user, holdId)` establece `payment_deadline = now + paymentMs` (300,000 ms = 5 min).
  - En `server/holds.js`, la tarea de limpieza `sweep()` comprueba:
    ```javascript
    if (h.status === 'paying') {
      if (h.payment_deadline > now) return; // Congelado por RN-07
    }
    ```

### T07.5 · Confirmación por webhook
- **Regla:** Creación de boletos desacoplada mediante webhook. Si el usuario cierra el navegador o pierde la conexión tras autorizarse el pago en la pasarela, la orden y los boletos se emiten igualmente.
- **Implementación:**
  - Endpoint `POST /api/payments/webhook`.
  - Recibe el payload del evento `payment.succeeded` con `idempotencyKey` o `holdId`.
  - Ejecuta `confirmPaymentAndCreateOrder()`, guardando los boletos en `user_orders` y asignando asientos permanentes en `event_seats` / `event_function_seats`.

### T07.6 · Prevención de doble cobro (Idempotencia)
- **Regla:** Evitar pagos duplicados si el usuario presiona dos o más veces seguidas el botón "Pagar".
- **Implementación en dos capas:**
  1. **Frontend:** Inmediatamente al primer clic, se desactiva el botón (`payButton.disabled = true; payButton.textContent = 'Procesando pago seguro…'`) y se genera una clave única `idempotencyKey = 'idemp_' + randomBytes`.
  2. **Backend:** La tabla `payments` cuenta con restricción `idempotency_key TEXT UNIQUE`. Al recibir una segunda solicitud con la misma llave, el servidor retorna la transacción aprobada existente sin ejecutar un segundo cargo.

### T07.7 · Manejo de pago rechazado (Hasta 3 intentos)
- **Regla:** Mostrar el error del banco, conservar los asientos y permitir hasta 3 intentos de pago. Al tercer rechazo consecutivo, el apartado se cancela y los asientos se liberan al público general.
- **Implementación:**
  - El modelo `holds` registra `payment_attempts`.
  - Cada fallo incrementa el contador e invoca `holds.paymentFailed()`.
  - Si `attempts < 3` y la reserva no ha expirado, el hold regresa a `status = 'active'`.
  - Al 3º intento fallido (`attempts >= 3`):
    ```javascript
    close(h.id, 'cancelled', '3 intentos de pago rechazados');
    ```
    Los registros en `hold_seats` se eliminan de inmediato, quedando los asientos libres para cualquier otro comprador.

### T07.8 · Orden y comprobante
- **Regla:** Guardar la orden y emitir comprobante de compra con número de confirmación, desglose detallado, fecha y últimos 4 dígitos.
- **Implementación:**
  - La pantalla `#confirmacion/:id` presenta:
    - Número de confirmación de la orden (ej. `ord_...`).
    - Fecha y hora formateadas.
    - Método de pago: `Tarjeta VISA terminada en •••• 4242`.
    - Referencia de la pasarela sandbox (ej. `pay_sandbox_...`).
    - Desglose financiero idéntico al cobrado.
    - Botones de acceso directo a "Ver mis boletos" e "Historial de compras".

### T07.9 · Pagos sin boletos (RN-12)
- **Regla:** Registrar pagos aprobados en pasarela que por alguna discrepancia (ej. hold ya cerrado o error de persistencia) no generaron boletos, para que el administrador los audite y resuelva.
- **Implementación:**
  - Tabla `orphan_payments (id, transaction_id, user_id, amount, status, notes, created, resolved_at)`.
  - Endpoint `GET /api/admin/unresolved-payments` expone la lista filtrada por `status='unresolved'`.
  - Endpoint `POST /api/admin/unresolved-payments/:id/resolve` permite al administrador registrar notas y marcarlo como resuelto.
  - Interfaz de usuario en `roles-ui.js` dentro de la pestaña de administración ("Pagos sin boletos (RN-12)").

### T07.10 · Pruebas de pago automatizadas
- **Suite:** `server/payments.test.js`
- **Resultados de ejecución:**
  ```text
  # Subtest: Prueba 1 / T07: Pago aprobado en sandbox genera comprobante, desglose exacto y boletos válidos
  ok 18 - Prueba 1 / T07: Pago aprobado en sandbox genera comprobante, desglose exacto y boletos válidos
  # Subtest: Prueba 2 / T07: 3 pagos rechazados conservan lugares en intentos 1 y 2, y liberan asientos al tercer rechazo
  ok 19 - Prueba 2 / T07: 3 pagos rechazados conservan lugares en intentos 1 y 2, y liberan asientos al tercer rechazo
  # Subtest: Prueba 3 / T07: Dos clics seguidos con la misma llave de idempotencia generan exactamente un cobro
  ok 20 - Prueba 3 / T07: Dos clics seguidos con la misma llave de idempotencia generan exactamente un cobro
  # Subtest: Prueba 4 / T07: Si el usuario cierra la página después de pagar, el webhook crea los boletos y la orden
  ok 21 - Prueba 4 / T07: Si el usuario cierra la página después de pagar, el webhook crea los boletos y la orden
  # Subtest: Prueba 5 / T07.9: Pagos sin boletos (RN-12) se registran en lista administrativa con fecha y monto
  ok 22 - Prueba 5 / T07.9: Pagos sin boletos (RN-12) se registran en lista administrativa con fecha y monto
  
  1..22
  # tests 22
  # pass 22
  # fail 0
  ```

---

## 3. Tarjetas de Prueba en Sandbox

Para pruebas manuales en el entorno local (`npm run dev` en `http://localhost:5173/`), se incluyeron atajos rápidos en la interfaz:

| Tarjeta | Terminación | Comportamiento en Sandbox |
|---|:---:|---|
| `4242 4242 4242 4242` | `4242` | **Aprobada** · Genera orden y boletos |
| `4000 0000 0000 0002` | `0002` | **Rechazada** (Fondos insuficientes) |
| `4000 0000 0000 0003` | `0003` | **Rechazada** (Tarjeta expirada) |
| `4000 0000 0000 0004` | `0004` | **Rechazada** (Sospecha de fraude) |
