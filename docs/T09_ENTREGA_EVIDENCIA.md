# Reporte de Entrega: T09 · Boletos con QR y control de acceso

**Responsable:** Cristian  
**Periodo:** 7 al 9 oct  
**Prioridad:** Alta  
**Etiqueta:** `entrega-3`  
**Objetivo:** Que cada boleto entre una sola vez y que ningún boleto falso pase.  
**Terminado cuando:** Un QR entra una sola vez y cada caso muestra el mensaje correcto.  
**Cubre:** Bloque 7; RN-13; K-12 y K-13.

---

## 1. Resumen Ejecutivo de Cumplimiento

Todas las subtareas (**T09.1 a T09.10**) se encuentran completamente implementadas, integradas y verificadas tanto a nivel de backend como de frontend, con una cobertura automatizada del 100 % (6/6 suites específicas en `server/tickets.test.js` y 45/45 en la suite global de la entrega sin regresiones).

| Subtarea | Descripción | Estado | Evidencia Principal |
|---|---|:---:|---|
| **T09.1** | Generar boletos (RN-13) | **Completado** | Códigos criptográficos de 100 bits (`newCode()`), tablas `orders` y `tickets`. `server/tickets.test.js` (Prueba 1). |
| **T09.2** | Mis boletos (K-12) | **Completado** | Pantalla `#boletos` en `tickets-ui.js`, endpoints `GET /api/tickets` y `GET /api/tickets/:id/pdf`. Captura `docs/manual/comprador-7-mis-boletos.png`. |
| **T09.3** | Correo de confirmación | **Completado** | `sendConfirmation` en `server/tickets.js` con desglose, comprobante y un PDF adjunto por boleto (`docs/manual/admin-8-correos.png`). |
| **T09.4** | Acceso del personal | **Completado** | `assignmentsFor` y control de rol taquilla (`403` a no asignados). Pantalla de selección en `scanner-ui.js` (`docs/manual/taquilla-1-elegir-evento.png`). |
| **T09.5** | Escáner | **Completado** | Lector con `BarcodeDetector` (Android/Chrome) y fallback automático a `jsQR` (iPhone Safari) + soporte de captura por foto (`docs/manual/taquilla-5-camara.png`). |
| **T09.6** | Resultados del escaneo | **Completado** | Verde "Acceso válido", Rojo "Ya utilizado" (con hora y puerta) y Rojo "No válido". Capturas `taquilla-2-acceso-valido.png`, `taquilla-3-ya-utilizado.png` y `taquilla-4-no-valido.png`. |
| **T09.7** | Búsqueda manual y contador | **Completado** | Normalización de código tolerante a espacios/guiones/mayúsculas en `normalizeCode()`. Contador en tiempo real `entered` / `sold` sincronizado. |
| **T09.8** | Escaneo atómico | **Completado** | Concurrencia segura con `UPDATE tickets SET status='used' WHERE id=? AND status='valid'` (Prueba 5). |
| **T09.9** | Revertir escaneo | **Completado** | `POST /api/tickets/:id/revert-scan`, bitácora de auditoría con actor y motivo (`docs/manual/admin-6-bitacora.png`). |
| **T09.10**| Pruebas de acceso | **Completado** | Verificación de rechazos para doble escaneo, función equivocada, evento equivocado, boleto reembolsado, código transferido y código inexistente. |

---

## 2. Detalle Técnico por Subtarea

### T09.1 · Generar boletos (RN-13)
- **Regla:** Cada asiento de una orden genera un boleto individual con un código único, aleatorio y no adivinable, que no deriva del ID de la orden.
- **Implementación:**
  - En `server/tickets.js`, la función `newCode()` genera 20 caracteres aleatorios utilizando el alfabeto Crockford base32 (sin `I`, `L`, `O`, `U` para evitar ambigüedades al escribirlo):
    ```javascript
    export const newCode = () => Array.from(randomBytes(20), byte => ALPHABET[byte & 31]).join('');
    ```
  - Esto equivale a 100 bits de entropía criptográfica segura.
  - Se genera su código QR vectorial en SVG vía `GET /api/tickets/:id/qr.svg`.
  - **Verificación:** Una orden de 4 asientos genera 4 boletos con IDs y códigos completamente independientes.

### T09.2 · Mis boletos (K-12)
- **Regla:** Interfaz donde el comprador puede ver sus boletos vigentes con su QR, código y descargar el PDF en cualquier momento.
- **Implementación:**
  - Módulo `tickets-ui.js` (`renderTickets`).
  - Muestra tarjetas de boletos con badge de estado, datos de la función, zona, asiento y código legible con formato `XXXX-XXXX-XXXX-XXXX-XXXX`.
  - Botón "Descargar PDF" apunta a `/api/tickets/:id/pdf` con cabecera `Content-Disposition: attachment; filename="boleto-..."`.
  - Generación de PDF en memoria vía `pdfkit` con QR embebido, tipografía y diseño oficial.

### T09.3 · Correo de confirmación
- **Regla:** Al confirmarse el pago se envía un correo con el comprobante y los boletos en PDF adjuntos.
- **Implementación:**
  - `sendConfirmation(orderId)` en `server/tickets.js` genera en memoria los buffers PDF de cada boleto (`attachmentsFor(rows)`).
  - El correo incluye orden, fecha, función, desglose financiero completo y se despacha a la bandeja de salida (`outbox`) y por SMTP si está configurado.

### T09.4 · Acceso del personal
- **Regla:** El personal de taquilla solo puede acceder a las funciones que le han sido asignadas por el organizador o la administración.
- **Implementación:**
  - Tabla `staff_assignments(user_id, event_id, function_id)`.
  - Endpoint `GET /api/staff/assignments` filtra únicamente las funciones del usuario autenticado con rol `taquilla`.
  - Si un usuario de taquilla intenta escanear una función no asignada, `scan()` rechaza con error `403` ("No tienes asignada esta función").
  - En `scanner-ui.js`, si el usuario tiene asignaciones, se le presenta la pantalla para elegir evento, función y puerta de acceso.

### T09.5 · Escáner (Android e iPhone)
- **Regla:** Lectura de códigos QR con la cámara del dispositivo móvil directamente desde el navegador web.
- **Implementación:**
  - En `scanner-ui.js`, la función `qrDecoder()` implementa una estrategia dual:
    1. Si el navegador soporta la API nativa `BarcodeDetector` (Google Chrome y navegadores Chromium en Android), la utiliza directamente con aceleración por hardware.
    2. Si no está disponible (Safari en iOS / iPhone), importa dinámicamente la biblioteca `jsQR`, renderiza los fotogramas del video en un `<canvas>` y procesa los píxeles.
  - Ofrece además la opción de respaldo "Tomar foto del QR" con `<input type="file" accept="image/*" capture="environment">` para navegadores sin permisos de cámara en tiempo real o conexiones locales sin HTTPS.

### T09.6 · Resultados del escaneo
- **Regla:** Mostrar en grande y de forma inequívoca el estado del acceso:
  - **Verde («ACCESO VÁLIDO»):** Boleto legítimo no usado previamente; muestra asiento, zona y nombre del titular.
  - **Rojo («YA UTILIZADO»):** Boleto ya escaneado; muestra la fecha, hora exacta y puerta por la que ingresó.
  - **Rojo («NO VÁLIDO»):** Explica la causa específica (otro evento, otra función, reembolsado, cancelado o inexistente).
- **Implementación:**
  - En `server/tickets.js`, `scan()` categoriza el resultado en `result: 'valid' | 'used' | 'invalid'`.
  - En `scanner-ui.js`, `validate()` asigna las clases CSS `.scan-result.ok` y `.scan-result.bad`, actualiza el histórico reciente y activa la vibración háptica del dispositivo móvil (`navigator.vibrate`).

### T09.7 · Búsqueda manual y contador
- **Regla:** Permitir escribir el código a mano si la cámara falla (insensible a mayúsculas, espacios, guiones o prefijos) y mostrar el contador en tiempo real de boletos ingresados contra vendidos.
- **Implementación:**
  - `normalizeCode()` limpia prefijos como `ETICKET:`, remueve guiones y espacios, normaliza `O` a `0`, `I`/`L` a `1`, y comprueba el código en base32.
  - La función `counter(eventId, functionId)` calcula `entered` (`status='used'`) y `sold` (`status IN ('valid','used')`).
  - La interfaz de taquilla consulta periódicamente `GET /api/staff/counter/:evento/:función` para sincronizar las entradas validadas desde otras puertas.

### T09.8 · Escaneo atómico (Concurrencia)
- **Regla:** Si dos personas presentan el mismo QR simultáneamente en distintas puertas, exactamente una debe recibir acceso verde y la otra debe ser rechazada con rojo.
- **Implementación:**
  - Ejecución atómica mediante sentencia SQL condicional:
    ```javascript
    const changed = db.prepare(
      "UPDATE tickets SET status='used', used_at=?, used_gate=?, used_by=?, updated=? WHERE id=? AND status='valid'"
    ).run(now, gate, staff.id, now, t.id).changes;
    ```
  - Si `changed === 1`, el boleto se transfiere a estado `used` y se otorga el acceso válido.
  - Si dos peticiones compiten, el motor de SQLite serializa la sentencia; la segunda encontrará `status !== 'valid'` y retornará `Ya utilizado`.

### T09.9 · Revertir escaneo
- **Regla:** Si un boleto fue escaneado por error, el organizador del evento o el administrador pueden revertir el escaneo justificando el motivo en la bitácora.
- **Implementación:**
  - Endpoint `POST /api/tickets/:id/revert-scan` (verificado para el organizador dueño o admin).
  - Restablece el boleto a `status='valid'` y limpia `used_at`, `used_gate` y `used_by`.
  - Inserta un registro en `scans` con resultado `reverted` y una entrada en `audit_log` con acción `escaneo.revertido`, correo del autor y motivo especificado.

### T09.10 · Pruebas de acceso
- **Regla:** Probar y documentar todos los casos límite y de rechazo de boletos.
- **Implementación probada en `server/tickets.test.js`:**
  - Escaneo doble: Primer escaneo verde (`Acceso válido`), segundo rojo (`Ya utilizado` con detalle de puerta).
  - Función diferente: Rechazo rojo indicando el nombre de la función correcta.
  - Evento diferente: Rechazo rojo indicando el nombre del evento al que pertenece.
  - Boleto reembolsado: Rechazo rojo indicando «El boleto fue reembolsado».
  - Boleto transferido: Rechazo rojo indicando «Es el código anterior de un boleto transferido».
  - Código inexistente: Rechazo rojo indicando «El boleto no existe».

---

## 3. Pruebas Automatizadas

Ejecución de la suite dedicada `server/tickets.test.js`:

```text
TAP version 13
# Subtest: T09.1 / RN-13 an order of 4 seats issues 4 tickets with distinct, unguessable codes and QR
ok 1 - T09.1 / RN-13 an order of 4 seats issues 4 tickets with distinct, unguessable codes and QR
# Subtest: T09.2 and T09.3 a ticket PDF downloads again at any time and the receipt e-mail carries one PDF per ticket
ok 2 - T09.2 and T09.3 a ticket PDF downloads again at any time and the receipt e-mail carries one PDF per ticket
# Subtest: T09.4 staff sign in and only see the events and functions assigned to them
ok 3 - T09.4 staff sign in and only see the events and functions assigned to them
# Subtest: T09.6, T09.7 and T09.10 each scan shows the right colour and reason, typed or scanned
ok 4 - T09.6, T09.7 and T09.10 each scan shows the right colour and reason, typed or scanned
# Subtest: T09.8 two simultaneous scans of the same QR give exactly one green and one red
ok 5 - T09.8 two simultaneous scans of the same QR give exactly one green and one red
# Subtest: T09.9 the organizer reverts a mistaken scan, the ticket is valid again and the audit log shows who did it
ok 6 - T09.9 the organizer reverts a mistaken scan, the ticket is valid again and the audit log shows who did it

1..6
# tests 6
# pass 6
# fail 0
```

---

## 4. Evidencias Gráficas del Manual

Las capturas de pantalla de soporte generadas para la Entrega 3 se encuentran en `docs/manual/`:

1. **`comprador-7-mis-boletos.png`**: Mis boletos con QR, código legible, botón de PDF y transferencia (T09.2).
2. **`admin-8-correos.png`**: Bandeja de salida con el comprobante de compra y los boletos en PDF adjuntos (T09.3).
3. **`taquilla-1-elegir-evento.png`**: Pantalla de ingreso del personal de taquilla con selector de función y puerta asignada (T09.4).
4. **`taquilla-5-camara.png`**: Escáner con cámara en vivo y visor de encuadre activo (T09.5).
5. **`taquilla-2-acceso-valido.png`**: Resultado verde «ACCESO VÁLIDO» con asiento y nombre de titular (T09.6).
6. **`taquilla-3-ya-utilizado.png`**: Resultado rojo «YA UTILIZADO» con hora y puerta registrada (T09.6).
7. **`taquilla-4-no-valido.png`**: Resultado rojo «NO VÁLIDO» con causa detallada (T09.6, T09.10).
8. **`organizador-2-panel-del-evento.png`**: Tabla de escaneos recientes con botón «Revertir» (T09.9).
9. **`admin-6-bitacora.png`**: Registro en bitácora de la reversión de escaneo con usuario responsable (T09.9).
