# Contexto del proyecto eTicket

Estado al 9 de octubre de 2026: rama `main` en el commit `83abde6` (T07) más los cambios de la Entrega 3 (T09 a T12 y el nuevo mapa de asientos), que están en la copia de trabajo sin commit. La evidencia de la entrega está en [`ENTREGA-3.md`](ENTREGA-3.md) y la guía por rol en [`MANUAL.md`](MANUAL.md).

## Qué es

eTicket es una boletera de eventos (conciertos, teatro, festivales y comedia). Las cuentas, los roles, los eventos, los apartados de asientos, las órdenes y los boletos con QR son reales y viven en el servidor. El personal valida los QR desde la cámara del celular. Los cobros y reembolsos pasan por una pasarela de pruebas (sandbox) dentro del proyecto: no se mueve dinero real.

Tecnología: HTML, CSS y JavaScript sin frameworks, empaquetado con Vite. La API es Node.js puro (sin Express) con la base SQLite que trae Node (`node:sqlite`). Dependencias: `nodemailer` (correos), `qrcode` (QR), `pdfkit` (boletos en PDF), `jsqr` (lectura de QR en iPhone) y, solo para desarrollo, `@vitejs/plugin-basic-ssl` (https en la red local).

## Historia de cambios

| Fecha | Commit | Autor | Resumen |
| --- | --- | --- | --- |
| 2026-10-04 | `6f1395a` Initial commit | Moises Casanova | README con el título. |
| 2026-10-04 | `d8e6359` T03 · Prototipos del visitante y del comprador | Aurora Madera | Interfaz completa del comprador y API de cuentas con SQLite. |
| 2026-10-07 | `55766ba` Cambios Roger | Roger Gonzalez | Verificación por correo, roles, eventos y recintos en el servidor. |
| 2026-10-07 | `5d9caf4` T08 | Moi (tarea de Benjamín) | Apartados con reloj en el servidor, abandono y liberación. |
| 2026-10-07 | `83abde6` T07 | Cristian Medina | Pago con tarjeta en sandbox, webhook, idempotencia, 3 rechazos y RN-12. |
| 2026-10-09 | sin commit · Entrega 3 | — | Boletos con QR, escáner, reportes, bitácora, correos automáticos, transferencias, cancelaciones, reembolsos, textos legales y mapa de asientos con apartado al hacer clic. |

- **T03 (base):** cartelera con filtros, detalle, mapa de asientos y zona general, compra de demostración, Mis boletos, historial y mapa de navegación. Los 5 eventos de muestra viven en `app.js`.
- **Cambios Roger:** registro con código por correo, recuperación de contraseña, sesión de 30 minutos sin actividad, bloqueo tras 5 intentos, roles con su panel, recintos y eventos con revisión, varias funciones, zonas con asientos, asientos bloqueados, límite por compra y ventana de venta.
- **T08:** apartados de 10 minutos guardados en el servidor, «Tienes una compra en curso», una compra abierta por cuenta, liberación automática y estado «En pago».
- **T07:** formulario de tarjeta tokenizado, desglose exacto, cobro único por llave de idempotencia, 3 intentos, webhook y pagos sin boletos.
- **Entrega 3:** órdenes y boletos en tablas propias (`orders`, `tickets`) como única fuente de verdad; todo lo demás (QR, PDF, escaneo, transferencias, reembolsos, reportes) se apoya en ellas. Ver el detalle por subtarea en `ENTREGA-3.md`.

## Cómo correrlo

| Comando | Para qué |
| --- | --- |
| `npm install` | Instalar dependencias. El proyecto pide Node 24 (con Node 22 funciona con un aviso de `node:sqlite`). |
| `npm start` (o `npm run dev`) | Desarrollo con la API incluida en `http://localhost:5173`. |
| `npm start -- --host 0.0.0.0` | Igual, accesible desde otros dispositivos de la red. |
| `npm run start:https` | Igual, pero con https de prueba: la cámara del celular solo funciona en páginas seguras. |
| `npm run build` y luego `npm run serve` | Compilar a `dist/` y servirlo con la API en el puerto 3000 (producción). |
| `npm test` | 45 pruebas de la API. |
| `npm run prueba:carga` | Prueba de carga de T12.3 (150 compradores a la vez). |
| `npm run demo:datos` | Cuentas de demostración, organizadora, taquilla, dos eventos publicados y personal asignado. `-- --ventas` agrega compras de ejemplo; `-- --limpiar` borra lo anterior de la demo. |

Cuentas de demostración (contraseña `Demo123!`, todas `@eticket.test`): `ana.demo`, `beto.demo`, `carla.demo` (compradores), `org.demo` (organizadora), `taquilla.demo` (personal de acceso) y `admin.demo` (administración). Sin SMTP en `.env` no se pueden crear cuentas nuevas porque el registro exige el código por correo.

## Estructura de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Esqueleto: encabezado, barra del reloj (`#timerbar`), contenedor `#app`, pie con los textos legales y aviso flotante (`#toast`). |
| `app.js` | Aplicación de una sola página: enrutador por `#hash`, eventos de muestra, cartelera, detalle, mapa de asientos con apartado al hacer clic, resumen, pago, confirmación y sincronización del apartado. |
| `tickets-ui.js` | Mis boletos (QR, PDF, transferir, pedir reembolso) e historial de compras. |
| `scanner-ui.js` | Escáner del personal: cámara, foto, búsqueda manual, resultados y contador. |
| `organizer-ui.js` | Panel de un evento: cifras, ventas, asistencia, escaneos y reversión, personal, cambio de fecha y cancelación. |
| `admin-ui.js` | Pestañas de administración: eventos, reportes, usuarios, reembolsos, cancelaciones, bitácora, comisión y correos. |
| `roles-ui.js` | Entrada al panel de cada rol, editor de eventos del organizador y pestaña General de administración. |
| `account-ui.js` | `accountApi` (envoltura de `fetch` para `/api`) y pantallas de registro, verificación, inicio de sesión y recuperación. |
| `legal.js` | Aviso de privacidad, términos, política de reembolsos y su resumen antes de pagar. |
| `ui-utils.js` | Funciones compartidas de formato y tablas. |
| `styles.css` | Estilos: tema oscuro, diseño adaptable e impresión de boletos. |
| `server/accounts.js` | `createAccounts(env, options)`: crea la base, conecta los módulos y atiende las rutas de cuentas, eventos, apartados y pagos. |
| `server/routes.js` | Router de las rutas de la Entrega 3 con su control de rol. |
| `server/catalog.js` | Datos de cualquier evento (muestra o publicado): funciones con su hora de inicio, zonas, precios y asientos. |
| `server/holds.js` | Apartados, disponibilidad (vendidos, apartados por otros y los propios) y liberación. |
| `server/payments.js` | Cobro en sandbox, webhook, idempotencia, 3 rechazos y pagos sin boletos. |
| `server/tickets.js` | Órdenes y boletos, códigos, QR, PDF, correo de confirmación, escaneo, personal, reversión, transferencias y disponibilidad por función. |
| `server/refunds.js` | Pasarela de reembolsos sandbox, reembolso individual, cambio de fecha, cancelaciones y reembolsos fallidos. |
| `server/reports.js` | Panel del organizador, reportes del administrador y CSV. |
| `server/notify.js` | Correos de decisión de evento, función agotada y recordatorio 24 horas antes. |
| `server/admin.js` | Comisión configurable y bloqueo de usuarios. |
| `server/audit.js` | Bitácora. |
| `server/mailer.js` | Envío de correos y bandeja de salida. |
| `server/pdf.js` | QR en SVG y boleto en PDF. |
| `server/start.js` | Servidor de producción: sirve `dist/` y la API con CSP y HSTS. |
| `server/demo-data.js` | Datos de demostración. |
| `server/*.test.js`, `server/test-helpers.js` | Pruebas con `node:test` y su ayuda compartida. |
| `scripts/prueba-carga.mjs` | Prueba de carga. |
| `vite.config.js` | Monta la API dentro de Vite, activa https con `--mode https`, copia `assets/` y bloquea `data/`, `server/` y `.env`. |
| `data/eticket.sqlite` | Base local (con `-wal` y `-shm`), ignorada en Git porque contiene datos privados. |

## Cómo se conecta

```
Navegador ──fetch /api/*──▶ server/accounts.js ──▶ módulos (holds, payments, tickets, refunds, reports…) ──▶ SQLite
          ◀── JSON, SVG, PDF o CSV + cookie HttpOnly eticket_session ──
```

- En desarrollo la API corre dentro de Vite; en producción la corre `server/start.js`. Los dos usan `createAccounts`.
- Cada petición limpia sesiones y códigos vencidos y libera apartados vencidos. Una tarea cada minuto vuelve a liberar apartados y envía los recordatorios de 24 horas.
- Al aprobarse un pago se crean la orden y un boleto por asiento; después se envía el correo con los PDF y se revisa si la función se agotó.
- Los correos salen por SMTP si está configurado y siempre quedan en la bandeja (`outbox`), visible en Administración → Correos.
- Los eventos de muestra (ids 1 a 5) existen en `app.js` (para la cartelera) y en `server/catalog.js` (para precios, fechas, correos y reportes); no están en la tabla `events` y no tienen organizador.

## Cuentas y seguridad

- Contraseñas con scrypt y sal aleatoria; cookie HttpOnly, SameSite=Lax, de 30 minutos sin actividad. Las consultas automáticas mandan `X-Eticket-Background: 1` para no alargar la sesión.
- 5 intentos fallidos bloquean la cuenta 15 minutos; máximo 40 peticiones a `/api/auth/*` por IP cada 15 minutos.
- Las peticiones que modifican datos deben ser JSON y del mismo origen.
- Una cuenta bloqueada por la administración puede entrar y usar sus boletos, pero no comprar.
- El webhook de pagos exige la cabecera `X-Webhook-Secret` (`PAYMENT_WEBHOOK_SECRET`) y usa el monto calculado por el servidor.
- Los boletos solo existen si los emite el servidor tras un pago; los códigos son aleatorios de 100 bits.

## Roles y permisos

| Rol | Cómo se obtiene | Qué puede hacer |
| --- | --- | --- |
| Visitante | Sin sesión | Ver cartelera, detalle, disponibilidad y textos legales. |
| Comprador | Al registrarse | Comprar, ver sus boletos con QR y PDF, transferir hasta 24 h antes, pedir reembolso tras un cambio de fecha y pedir ser organizador. |
| Organizador | La administración aprueba su solicitud | Crear eventos y enviarlos a revisión; en el panel de sus eventos: cifras, asistencia, revertir escaneos, asignar personal, cambiar fechas y pedir cancelaciones. También compra. |
| Taquilla | La administración le asigna el rol | Escanear solo en las funciones que le asignaron. No compra. |
| Administración | Su correo está en `ADMIN_EMAIL` | Todo lo anterior sobre cualquier evento, más reportes, usuarios, reembolsos, cancelaciones, bitácora, comisión y correos. También compra. |

Ciclo de un evento: borrador → en revisión → publicado o rechazado → (si se aprueba una cancelación) cancelado. Un evento cancelado no se puede editar ni volver a publicar.

## Flujo de compra

1. **Detalle:** función y zona. Precio final = precio de la zona + cargo por servicio (10 % por defecto, configurable) + 16 % de IVA.
2. **Asientos numerados:** cada clic aparta o libera el asiento en el servidor; el reloj de 10 minutos empieza con el primero. El mapa se refresca cada 3 segundos y distingue vendidos (×), apartados por otros (candado), propios (✓), perdidos (rojo) y sugeridos (estrella). **Zona general:** se elige la cantidad y se aparta al continuar.
3. **Resumen y pago:** tarjeta en sandbox (T07); los textos legales se ven antes de pagar.
4. **Confirmación:** orden con desglose; correo con un PDF por boleto.
5. **Después:** Mis boletos (QR y PDF), transferencia con QR nuevo, reembolso tras cambio de fecha, reembolso total si se cancela el evento.

| Regla | Comportamiento |
| --- | --- |
| RN-03 a RN-06, K-09, K-10 | Apartado de 10 minutos con hora del servidor, sin extensión; reanudar en otra pestaña o dispositivo; una compra abierta por cuenta; quitar o cancelar libera al instante; liberación automática en menos de 1 minuto. |
| RN-07 y T07 | «En pago» congela los asientos hasta 5 minutos mientras responde la pasarela. |
| RN-13 | Un boleto por asiento con código aleatorio; cada QR entra una sola vez (escaneo atómico). |
| RN-14 y K-16 | Transferencia a otra cuenta registrada hasta 24 horas antes; el QR anterior queda inválido. |
| RN-16 | Reembolso individual: el asiento vuelve a la venta y su QR deja de servir. |
| K-15 | Cancelación solo con aprobación de la administración; reembolso del 100 % de cada orden. |
| RN-19 y K-18 | Bitácora de aprobaciones, cancelaciones, reembolsos, bloqueos y reversión de escaneos. |
| K-17 | Correos automáticos: evento aprobado o rechazado, función agotada y recordatorio 24 horas antes. |

## Rutas de la interfaz

| Grupo | Rutas (`#…`) |
| --- | --- |
| Descubrir | `inicio`, `cartelera`, `evento/:id`, `mapa`, `privacidad`, `terminos`, `reembolsos` |
| Cuenta | `login`, `registro`, `verificacion`, `recuperar`, `restablecer` |
| Compra | `localidades/:id`, `resumen`, `pago`, `procesando`, `confirmacion/:orden`, `cancelar`, `expirado`, `en-curso`, `ocupado/:asiento` |
| Después de comprar | `boletos`, `historial`, `transferir/:boleto` |
| Panel | `panel` (según el rol), `panel/:evento/:función` (escáner), `panel/evento/:id` (panel del evento), `panel/<pestaña>` (administración) |

## API

Respuestas JSON salvo QR (SVG), boletos (PDF) y reportes (CSV). Los errores llegan como `{ "error": "mensaje" }`.

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /api/auth/register`, `verify`, `resend`, `login`, `logout`, `forgot`, `reset`, `organizer-request`; `GET /api/auth/me` | Público o sesión | Cuentas (sin cambios desde la entrega 2). |
| `GET /api/events` | Público | Eventos publicados y `availability` (agotado o en venta por evento y función). |
| `POST /api/events`, `…/:id/submit`, `…/:id/delete` | Organizador dueño | Borradores y envío a revisión. |
| `POST /api/events/:id/decision` | Administración | Aprobar o rechazar (envía correo al organizador). |
| `GET /api/settings` | Público | Comisión vigente. |
| `GET /api/availability` | Público | Vendidos, apartados por otros (con el vencimiento más próximo), propios y cupo. |
| `GET /api/holds/current`, `POST /api/holds`, `PUT /api/holds/:id`, `POST …/cancel`, `…/pay`, `…/payment-failed` | Sesión | Apartado (T08). |
| `POST /api/payments/charge` | Sesión, menos taquilla | Cobro en sandbox. |
| `POST /api/payments/webhook` | Pasarela con firma | Confirmación autónoma. |
| `GET /api/orders` | Sesión | Historial de compras. |
| `GET /api/tickets`, `GET …/:id/qr.svg`, `GET …/:id/pdf` | Dueño | Mis boletos, QR y PDF. |
| `POST /api/tickets/:id/transfer`, `…/refund-request` | Dueño | Transferir; pedir reembolso tras un cambio de fecha. |
| `GET /api/staff/assignments`, `GET /api/staff/counter/:evento/:función`, `POST /api/scan` | Taquilla | Funciones asignadas, contador y escaneo. |
| `GET /api/organizer/events/:id/report` (y `.csv`) | Organizador dueño o administración | Panel del evento. |
| `GET /api/staff/candidates`, `POST /api/events/:id/staff` (y `/remove`) | Organizador dueño o administración | Asignar personal. |
| `POST /api/tickets/:id/revert-scan` | Organizador dueño o administración | Revertir un escaneo. |
| `POST /api/events/:id/cancel-request` | Organizador dueño | Pedir la cancelación. |
| `POST /api/events/:id/functions/:función/reschedule` | Organizador dueño o administración | Cambiar la fecha. |
| `GET /api/admin/reports/:nombre` (y `.csv`) | Administración | Ventas, comisiones, eventos, expiradas y reembolsos por fechas. |
| `GET/PUT /api/admin/settings` | Administración | Comisión. |
| `GET /api/admin/users?q=`, `PUT /api/admin/users`, `POST /api/admin/users/:id/block` | Administración | Buscar, cambiar rol, bloquear. |
| `GET /api/admin/refunds`, `POST …/:id/retry`, `…/:id/resolve`, `POST /api/admin/tickets/:id/refund`, `GET /api/admin/orders/:id` | Administración | Reembolsos. |
| `GET /api/admin/cancellations`, `POST …/:id/decision` | Administración | Cancelaciones. |
| `GET /api/admin/audit`, `GET /api/admin/outbox`, `GET /api/admin/holds`, `GET /api/admin/unresolved-payments` | Administración | Bitácora, correos, apartados y pagos sin boletos. |

`PUT /api/orders` sigue existiendo por compatibilidad con pruebas antiguas, pero ya no crea boletos válidos. `POST /api/box-office/check` responde 410: se reemplazó por `POST /api/scan`.

## Base de datos

Las tablas y columnas se crean solas al arrancar; no hay herramienta de migraciones.

| Tabla | Contenido |
| --- | --- |
| `users`, `challenges`, `sessions` | Cuentas (con rol y bloqueo), códigos y sesiones. |
| `venues`, `events` | Recintos y eventos (JSON con funciones y zonas). |
| `holds`, `hold_seats` | Apartados (con la comisión vigente) y un candado único por asiento. |
| `payments`, `orphan_payments` | Cobros sandbox y pagos sin boletos (T07). |
| `orders`, `tickets` | Órdenes con su desglose y boletos con código, dueño actual, precio y estado (vigente, utilizado, reembolsado, cancelado). |
| `ticket_codes`, `transfers` | Códigos anteriores invalidados y transferencias. |
| `scans`, `staff_assignments` | Cada lectura en la entrada y el personal asignado por función. |
| `refunds`, `cancellations`, `function_changes` | Reembolsos (con fallidos), solicitudes de cancelación y cambios de fecha con su ventana de 10 días. |
| `audit_log`, `outbox`, `notices`, `settings` | Bitácora, correos enviados, avisos ya enviados (agotado, recordatorio) y comisión. |
| `event_sales`, `event_function_sales`, `event_function_seats` | Contadores de venta de eventos publicados. |
| `user_orders`, `ticket_checkins`, `event_seats` | Heredadas; ya no se usan para comprar ni para entrar. |

## Configuración (`.env`)

| Variable | Uso |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envío de correos (con Gmail, contraseña de aplicación). Sin ellas no hay registro, y los demás correos quedan solo en la bandeja. |
| `ADMIN_EMAIL` | Correo que se convierte en administración. |
| `PAYMENT_WEBHOOK_SECRET` | Firma que debe mandar la pasarela al webhook. Vacía = webhook deshabilitado. |
| `COOKIE_SECURE` | `true` en producción con HTTPS (también activa HSTS). |
| `HOLD_MINUTES` | Solo para ensayos: acorta el apartado (vacío = 10). |
| `PORT`, `HOST` | Puerto y host de `npm run serve`. |

## Pruebas

`npm test` corre 45 pruebas con `node:test`, cada una con su propia base temporal y un reloj que se puede adelantar:

- `accounts.test.js` (6), `holds.test.js` (11) y `payments.test.js` (5): cuentas, roles, apartados y pagos.
- `tickets.test.js` (6): T09.
- `postsale.test.js` (7): T11.
- `reports.test.js` (7): T10.
- `final.test.js` (3): seguridad y concurrencia de T12.

Además: `npm run prueba:carga` (T12.3) y una prueba en Chrome y Edge con 43 comprobaciones que generó las capturas de `docs/manual/` (el script no está en el repositorio).

## Pendientes y deuda técnica

Pendientes del equipo: commit de la Entrega 3; probar el escáner en un Android y un iPhone reales; Safari y Firefox; configurar SMTP para la demo; que un integrante siga el manual de un rol que no programó; ensayar la presentación. T12.1 y T12.2 se omitieron porque necesitan el texto de las reglas, el guion y Jira.

Deuda técnica:

- La pasarela (cobros y reembolsos) es una simulación dentro del proyecto.
- Los eventos de muestra están en `app.js` y `server/catalog.js`; no tienen organizador, así que no se reprograman ni se cancelan.
- `PUT /api/orders` y las tablas `user_orders`, `ticket_checkins` y `event_seats` quedan por compatibilidad.
- Los recordatorios y la liberación de apartados dependen de que el proceso del servidor esté encendido.

## Convenciones del código

- `app.js` usa funciones compactas que arman el HTML con plantillas de texto; los módulos nuevos de interfaz usan el mismo estilo con funciones más largas. Todo texto que viene de datos pasa por `esc()`.
- Textos de la interfaz en español; comentarios y nombres de pruebas en inglés.
- Sin frameworks de interfaz y sin Express. Las horas del servidor se manejan en milisegundos.
