# Contexto del proyecto eTicket

Estado al 7 de octubre de 2026: rama `main` en el commit `55766ba` («Cambios Roger») más los cambios de T08, que están en la copia de trabajo sin commit.

## Qué es

eTicket es el prototipo de una boletera de eventos (conciertos, teatro, festivales y comedia). Las cuentas, los roles, los eventos de los organizadores y los apartados de asientos son reales y se guardan en el servidor. Los cobros, los QR y las transferencias son simulados: los boletos no sirven para entrar a ningún evento.

Tecnología: HTML, CSS y JavaScript sin frameworks, empaquetado con Vite. La API es Node.js puro (sin Express) con la base SQLite que trae Node (`node:sqlite`). La única dependencia de producción es `nodemailer`, para enviar códigos por correo.

## Historia de cambios

| Fecha | Commit | Autor | Resumen |
| --- | --- | --- | --- |
| 2026-10-04 | `6f1395a` Initial commit | Moises Casanova | README con el título. |
| 2026-10-04 | `d8e6359` T03 · Prototipos del visitante y del comprador | Aurora Madera | Toda la base: interfaz completa del comprador y API de cuentas con SQLite. |
| 2026-10-07 | `55766ba` Cambios Roger | Roger Gonzalez | Verificación por correo, roles, eventos y recintos en el servidor. |
| 2026-10-07 | sin commit · T08 | tarea de Benjamín | Apartados con reloj en el servidor, abandono y liberación. |

### T03 · la base

- Interfaz del visitante y del comprador: inicio, cartelera con búsqueda y 4 filtros, detalle, mapa de asientos y zona general, resumen, pago de demostración, confirmación, Mis boletos con QR de prueba, historial, transferencia simulada, cancelación, tiempo expirado y mapa de navegación.
- 5 eventos de muestra escritos dentro de `app.js`.
- API de cuentas reales con SQLite: el registro activaba la cuenta al instante (sin correo), la sesión duraba 7 días y las compras se guardaban por cuenta.
- El reloj de 10 minutos existía solo en el navegador: se perdía al recargar y no apartaba nada en el servidor.
- 3 pruebas.

### Cambios Roger

- Registro con código de verificación por correo (SMTP obligatorio), reenvío del código y recuperación de contraseña.
- La sesión pasó a vencer tras 30 minutos sin actividad; 5 intentos fallidos bloquean la cuenta 15 minutos.
- Roles comprador, organizador, taquilla y administrador, con su panel en `roles-ui.js` y el primer administrador definido por `ADMIN_EMAIL`.
- Recintos y eventos guardados en el servidor, con revisión del administrador, varias funciones, zonas con asientos, asientos bloqueados (cortesía o prensa), límite por compra y ventana de venta. Los eventos publicados aparecen en la cartelera junto a los de muestra.
- Ventas registradas por función y zona; validación de boletos en taquilla.
- Escape de HTML (`esc()`) en la interfaz.
- 6 pruebas.

### T08 · temporizador, abandono y liberación (sin commit)

- Nuevo `server/holds.js` con las tablas `holds` y `hold_seats`, y las rutas `/api/holds`, `/api/availability` y `/api/admin/holds`.
- Interfaz: reloj sincronizado con el servidor, pantalla «Tienes una compra en curso», mapa de asientos que se actualiza solo, quitar lugares, estado «En pago» y conteo de compras expiradas en el panel del administrador.
- Correcciones a lo existente: cada venta se sumaba dos veces en `event_sales`; las consultas automáticas habrían mantenido viva la sesión; las cuentas de taquilla podían comprar.
- `npm run demo:datos`, la variable `HOLD_MINUTES` y 11 pruebas nuevas.

## Cómo correrlo

| Comando | Para qué |
| --- | --- |
| `npm install` | Instalar dependencias. El proyecto pide Node 24 o superior. |
| `npm start` (o `npm run dev`) | Servidor de desarrollo de Vite con la API incluida en `http://localhost:5173`. |
| `npm start -- --host 0.0.0.0` | Igual, pero accesible desde otros dispositivos de la red (por ejemplo, el celular). |
| `npm run build` y luego `npm run serve` | Compilar a `dist/` y servirlo con la API en el puerto 3000 (producción). |
| `npm test` | Correr las 17 pruebas de la API. |
| `npm run demo:datos` | Crear cuentas de demostración ya verificadas, sin SMTP. Con `-- --limpiar` borra también sus compras. |

Cuentas de demostración (contraseña `Demo123!`): `ana.demo@eticket.test`, `beto.demo@eticket.test` y `carla.demo@eticket.test` como compradores, y `admin.demo@eticket.test` como administrador.

Sin SMTP configurado en `.env` no se pueden crear cuentas nuevas, porque el registro exige el código que llega por correo.

## Estructura de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Esqueleto: encabezado, aviso de demostración, barra del reloj (`#timerbar`), contenedor `#app`, pie de página y aviso flotante (`#toast`). |
| `app.js` | Aplicación de una sola página: enrutador por `#hash`, los 5 eventos de muestra, cartelera, detalle, asientos, compra, boletos y sincronización del apartado. |
| `account-ui.js` | `accountApi` (envoltura de `fetch` para `/api`) y las pantallas de registro, verificación, inicio de sesión y recuperación. |
| `roles-ui.js` | Panel de cada rol: comprador, organizador, taquilla y administrador. |
| `styles.css` | Estilos: tema oscuro, diseño adaptable e impresión de boletos. |
| `assets/` | Logo y 6 QR de demostración. |
| `server/accounts.js` | `createAccounts(env, options)`: crea y migra la base de datos y atiende todas las rutas `/api`. |
| `server/holds.js` | `createHolds(db, opciones)`: apartados, disponibilidad, pago y liberación. |
| `server/start.js` | Servidor de producción: sirve `dist/` y la API con cabecera CSP. |
| `server/demo-data.js` | Script de cuentas de demostración. |
| `server/accounts.test.js`, `server/holds.test.js` | Pruebas con `node:test` (6 y 11). |
| `vite.config.js` | Monta la API dentro de Vite (desarrollo y vista previa), copia `assets/` al compilar y bloquea el acceso a `data/`, `server/` y `.env`. |
| `data/eticket.sqlite` | Base de datos local (con sus archivos `-wal` y `-shm`). Está ignorada en Git porque contiene datos privados. |

## Cómo se conecta

```
Navegador (app.js) ──fetch /api/*──▶ middleware de server/accounts.js ──▶ SQLite (data/eticket.sqlite)
                   ◀── JSON + cookie HttpOnly eticket_session ──
```

- En desarrollo la API corre dentro del proceso de Vite (plugin `accounts-api`). En producción la corre `server/start.js`. Los dos usan el mismo `createAccounts`.
- Antes de responder, cada petición a `/api` borra sesiones y códigos vencidos y libera los apartados vencidos. Además, un temporizador del servidor libera los apartados vencidos cada minuto.
- Los eventos de muestra (ids 1 a 5) solo existen en `app.js`, no en la tabla `events`. Su mapa de asientos (A1 a D8, con A3, A4, B6, C2, C7 y D5 ocupados) está repetido en `server/holds.js`. Los eventos de los organizadores sí están en la base y se mezclan con los de muestra al cargar la cartelera.

## Cuentas y seguridad

- Registro: nombres (máximo 40 caracteres), apellido paterno y materno (máximo 19 cada uno), correo único sin distinguir mayúsculas y contraseña de 6 a 15 caracteres con una mayúscula y un símbolo. La cuenta se activa al confirmar un código de 6 dígitos que vence en 10 minutos.
- Las contraseñas se guardan con scrypt y una sal aleatoria.
- La sesión vive en la cookie HttpOnly `eticket_session` y vence tras 30 minutos sin actividad. Las consultas automáticas del reloj y del mapa envían `X-Eticket-Background: 1` para no alargarla.
- 5 intentos fallidos bloquean la cuenta 15 minutos. Se permiten como máximo 40 peticiones a `/api/auth/*` por IP cada 15 minutos.
- La recuperación de contraseña usa un código por correo; al cambiar la contraseña se cierran todas las sesiones de esa cuenta.
- Las peticiones que modifican datos tienen que ser JSON y venir del mismo origen.

## Roles y permisos

| Rol | Cómo se obtiene | Qué puede hacer |
| --- | --- | --- |
| Visitante | Sin sesión | Ver la cartelera, el detalle y el mapa de asientos. |
| Comprador | Al registrarse | Comprar, ver y transferir sus boletos y pedir ser organizador. |
| Organizador | El administrador aprueba su solicitud | Crear y editar sus eventos (funciones, zonas, asientos bloqueados, límite por compra y ventana de venta) y enviarlos a revisión. También puede comprar. |
| Taquilla | El administrador se lo asigna | Validar códigos de boleto, una sola vez cada uno. No puede comprar. |
| Administrador | Su correo está en `ADMIN_EMAIL` | Aprobar organizadores, asignar taquilla, dar de alta recintos, aprobar o rechazar eventos y ver las compras expiradas. También puede comprar. |

Ciclo de un evento: borrador → en revisión → publicado o rechazado (con motivo). Editar un evento lo regresa a borrador. Si ya tiene ventas, no se pueden cambiar sus funciones ni sus precios, quitar zonas, bajar un cupo por debajo de lo vendido ni borrar el evento.

## Flujo de compra y apartados

1. **Detalle:** se elige función y zona. Precio final = precio base + 10 % de cargo por servicio + 16 % de IVA.
2. **Localidades:** mapa de asientos numerados o cantidad en zona general; máximo 6 por compra o el límite del evento. La disponibilidad se refresca cada 5 segundos.
3. **«Continuar al resumen»** crea el apartado en el servidor (`POST /api/holds`), que vence a los 10 minutos.
4. **Resumen:** quitar un lugar o cancelar lo libera al instante. «Cambiar localidades» edita el mismo apartado sin reiniciar el reloj.
5. **Pago de demostración:** al confirmar, el apartado pasa a «En pago». La tarjeta se aprueba a los 1.2 segundos; la transferencia queda pendiente hasta pulsar «Aprobar» o «Rechazar» en la pantalla «Pago en proceso».
6. **Confirmación:** la orden se guarda con su `holdId` y el apartado queda pagado.

| Regla | Comportamiento |
| --- | --- |
| RN-03 | El apartado dura 10 minutos, avisa a los 2 y no se puede extender. Cambiar los lugares no mueve el vencimiento. |
| T08.2 | El vencimiento (`holds.expires`) usa la hora del servidor. El navegador recibe el tiempo restante y lo descuenta con `performance.now()`, así que la hora del dispositivo no influye. |
| RN-04 y K-09 | Quien vuelve (al recargar, en otra pestaña o en otro dispositivo) ve «Tienes una compra en curso» con sus lugares y el tiempo restante. |
| RN-06 | Una sola compra abierta por cuenta en total (decisión del equipo). Una segunda pestaña muestra esa misma compra. |
| RN-05 | Quitar o cancelar libera al instante; otros navegadores lo ven libre en 5 segundos o menos. |
| K-10 | Los apartados vencidos se liberan en menos de 1 minuto y quedan registrados como expirados, con su motivo. |
| T08.8 | Un apartado «En pago» no se libera cuando el reloj llega a cero. Si el pago se rechaza con tiempo, vuelve al reloj; si se rechaza después del cero, se libera; si no hay respuesta en 5 minutos, también se libera («pago sin respuesta»). |

Estados de un apartado: `active` (apartado), `paying` (en pago), `completed` (pagado), `cancelled` (cancelado) y `expired` (expirado).

## Rutas de la interfaz

| Grupo | Rutas (`#…`) |
| --- | --- |
| Descubrir | `inicio`, `cartelera`, `evento/:id`, `mapa` |
| Cuenta | `login`, `registro`, `verificacion`, `recuperar`, `restablecer`, `panel` |
| Compra | `localidades/:id`, `resumen`, `pago`, `procesando`, `confirmacion/:orden`, `cancelar`, `expirado`, `en-curso`, `ocupado/:asiento` |
| Después de comprar | `boletos`, `historial`, `transferir/:orden/:boleto`, `validar/:código` |

`revision` todavía existe, pero solo muestra el inicio.

## API

Todas las respuestas son JSON. Los errores llegan como `{ "error": "mensaje" }`; un 409 puede traer además `hold` (la compra en curso) o `seat` (el asiento ocupado).

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /api/auth/register` | Público | Crea la cuenta y envía el código. |
| `POST /api/auth/verify` | Público | Confirma el código y abre sesión. |
| `POST /api/auth/resend` | Público | Reenvía el código de verificación. |
| `POST /api/auth/login`, `POST /api/auth/logout` | Público, sesión | Iniciar y cerrar sesión. |
| `GET /api/auth/me` | Público | Devuelve el usuario actual o `null`. |
| `POST /api/auth/forgot`, `POST /api/auth/reset` | Público | Enviar el código de recuperación y cambiar la contraseña con él. |
| `POST /api/auth/organizer-request` | Comprador | Pedir el rol de organizador. |
| `GET /api/events` | Público | Eventos publicados con sus ventas; el organizador ve también los suyos y el administrador, todos. |
| `POST /api/events` | Organizador | Crear un borrador o editarlo (si se manda `id`). |
| `POST /api/events/:id/submit`, `…/delete` | Organizador dueño | Enviar a revisión; borrar si no tiene ventas. |
| `POST /api/events/:id/decision` | Administrador | Aprobar o rechazar con motivo. |
| `GET /api/venues`, `POST /api/venues` | Administrador | Listar y dar de alta recintos. |
| `GET /api/organizer/venues` | Organizador | Recintos disponibles para sus eventos. |
| `GET /api/admin/users`, `PUT /api/admin/users` | Administrador | Listar cuentas; asignar `taquilla` o `comprador`. |
| `GET /api/admin/organizers`, `PUT /api/admin/organizers` | Administrador | Ver y resolver solicitudes de organizador. |
| `GET /api/admin/holds` | Administrador | Conteo de apartados por estado y las últimas 50 compras expiradas. |
| `GET /api/availability?eventId=&functionId=&zone=` | Público | Asientos ocupados (o cupo libre en zona general) y los del propio usuario. |
| `GET /api/holds/current` | Sesión | Compra abierta, última compra cerrada y hora del servidor. |
| `POST /api/holds` | Sesión, menos taquilla | Crear el apartado. |
| `PUT /api/holds/:id` | Dueño | Cambiar lugares o cantidad; si queda vacío, se cancela. |
| `POST /api/holds/:id/cancel` | Dueño | Cancelar y liberar. |
| `POST /api/holds/:id/pay`, `…/payment-failed` | Dueño | Pasar a «En pago»; avisar que el pago se rechazó. |
| `GET /api/orders`, `PUT /api/orders` | Sesión | Compras propias. `PUT` guarda la lista completa y confirma las órdenes nuevas que traen `holdId`. |
| `POST /api/box-office/check` | Taquilla | Validar un código de boleto (una sola vez). |

## Base de datos

Las tablas y columnas se crean solas al arrancar (`CREATE TABLE IF NOT EXISTS` y `ALTER TABLE … ADD COLUMN`); no hay herramienta de migraciones.

| Tabla | Contenido |
| --- | --- |
| `users` | Cuentas: correo, nombre, hash de contraseña, verificación, rol, solicitud de organizador, intentos fallidos y bloqueo. |
| `challenges` | Códigos de verificación y de recuperación (con hash, vencimiento e intentos). |
| `sessions` | Sesiones abiertas (hash del token y vencimiento). |
| `user_orders` | Compras de cada cuenta, guardadas como un arreglo JSON. |
| `venues` | Recintos y sus zonas (JSON). |
| `events` | Eventos (JSON), dueño, estado y motivo de la revisión. |
| `event_function_sales`, `event_function_seats` | Boletos vendidos por función y zona, y asientos vendidos. |
| `event_sales` | Boletos vendidos por zona, sumando todas las funciones. |
| `event_seats` | Se crea, pero ningún código la usa. |
| `ticket_checkins` | Boletos ya validados en taquilla. |
| `holds` | Apartados: evento, función, zona, lugares, estado, creación, vencimiento, inicio del pago, cierre y motivo. |
| `hold_seats` | Un candado por asiento apartado (único por evento, función, zona y asiento). Se borra al cancelar o expirar. |

## Configuración (`.env`)

| Variable | Uso |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envío de códigos (con Gmail se usa una contraseña de aplicación). Sin ellas no hay registro ni recuperación. |
| `ADMIN_EMAIL` | Correo que se convierte en administrador. |
| `COOKIE_SECURE` | `true` en producción con HTTPS. |
| `HOLD_MINUTES` | Solo para ensayos: acorta el apartado. Vacío equivale a 10 minutos. |
| `PORT`, `HOST` | Puerto y host de `npm run serve` (por defecto 3000 y `0.0.0.0`). |

## Pruebas

`npm test` corre 17 pruebas con `node:test`; cada una usa su propia base temporal.

- `accounts.test.js` (6): registro con verificación, aislamiento de compras entre cuentas, validaciones del registro, permisos de roles y publicación de eventos, recuperación y bloqueo, y reglas de funciones, zonas, asientos y ventana de venta.
- `holds.test.js` (11): reloj de 10 minutos sin extensión, reanudar en otro dispositivo, una compra por cuenta, quitar y cancelar, expiración y conteo del administrador, tarea programada, pago que cruza el cero, rechazo antes y después del cero, tope de 5 minutos, zona general en eventos publicados, y compras sin apartado, taquilla y sesión.

Las pruebas de apartados reciben un reloj falso (`options.clock`) para adelantar el tiempo sin esperar 10 minutos. El 7 de octubre también se revisó el flujo completo en Chrome con cuatro sesiones separadas (32 comprobaciones correctas); ese script no está en el repositorio.

## Pendientes y deuda técnica

Pendientes del equipo:

- Hacer commit de T08. `package-lock.json` también aparece modificado, pero solo por un `npm install` local; no conviene incluirlo.
- T08.8: prueba conjunta con Cristian (T07, pago). Hay que confirmar que «En pago» no expira por el reloj, el tope de 5 minutos y que su pantalla de pago llama a `POST /api/holds/:id/pay` antes de cobrar y manda `holdId` al confirmar.
- T08.10: ensayar la demo completa con el equipo.

Deuda técnica conocida:

- Pagos, QR y transferencias son simulados.
- Los eventos de muestra están repetidos en `app.js` y `server/holds.js`; sus ventas solo existen como apartados pagados.
- Las compras se guardan como un JSON por cuenta: el cliente reenvía la lista completa en cada cambio y la taquilla busca un código recorriendo todas.
- `PUT /api/orders` todavía acepta órdenes sin `holdId` para no romper pruebas antiguas. No pueden tomar asientos apartados por otra persona, pero se saltan el reloj.
- La tabla `event_seats` no se usa.
- El formulario del organizador permite un límite de hasta 10 boletos por compra, pero el servidor solo acepta de 1 a 6.
- Con Node 22 todo funciona, pero `node:sqlite` muestra un aviso de función experimental; el proyecto pide Node 24.

## Convenciones del código

- `app.js` usa funciones compactas, casi siempre una por línea, que arman el HTML con plantillas de texto. Todo texto que viene de datos pasa por `esc()`.
- Los textos de la interfaz están en español; los comentarios del código y los nombres de las pruebas, en inglés.
- No hay frameworks de interfaz y el servidor no usa Express.
- Las horas del servidor se manejan en milisegundos (`Date.now()`).
