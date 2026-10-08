# Entrega 3 · Evidencia (9 de octubre de 2026)

Cubre T09 (boletos con QR y control de acceso), T10 (reportes, notificaciones y panel de administración), T11 (transferencias, cancelaciones y reembolsos), T12 (pruebas finales, documentación y presentación) y el nuevo mapa de asientos que se aparta al hacer clic.

**Cómo se verificó**

- `npm test`: **45 de 45** pruebas automáticas de la API (22 que ya existían y 23 nuevas).
- Prueba de punta a punta en navegador real: **43 de 43** comprobaciones en Chrome y **43 de 43** en Edge, con cuatro sesiones a la vez (visitante, compradores, taquilla en celular, organizadora y administración), sin errores de JavaScript. Las capturas están en [`manual/`](manual/) y los resultados en `manual/resultados-chrome.json` y `manual/resultados-edge.json`.
- `npm run prueba:carga`: 150 compradores simultáneos por escenario, respuesta máxima de 374 ms y cero lugares duplicados.

## Cómo comprobarlo

```bash
npm install
npm test                      # 45 pruebas de la API
npm run prueba:carga          # T12.3
npm run demo:datos -- --ventas  # cuentas, eventos, personal y ventas de ejemplo
npm start                     # http://localhost:5173
npm run start:https           # para usar la cámara del celular en la red local (T09.5)
```

Cuentas de demostración (contraseña `Demo123!`, todas `@eticket.test`): `ana.demo`, `beto.demo` y `carla.demo` (compradores), `org.demo` (organizadora), `taquilla.demo` (personal de acceso) y `admin.demo` (administración).

## Mapa de asientos con apartado al hacer clic

| Diseño pedido | Cómo funciona | Evidencia |
| --- | --- | --- |
| Imagen 3 · «Tus asientos fueron apartados correctamente durante 10 minutos» | Cada clic aparta o libera el asiento en el servidor; el reloj de 10 minutos empieza con el primero y no se reinicia. | `comprador-1-asientos-apartados.png` |
| Imagen 4 · candado «Apartado temporalmente» | Los asientos que otra persona tiene apartados se ven en ámbar con candado y el panel muestra cuánto falta para que se liberen. | `comprador-2-asientos-de-otros.png` |
| Imagen 2 · «No se pudo apartar B3» | Si otra persona gana el asiento, aparece la ventanita, el aviso rojo, el asiento en rojo y uno sugerido cerca. | `comprador-3-conflicto-sugerido.png` |
| Imagen 1 · «Los asientos elegidos anteriormente ya no están disponibles» | Si tu apartado venció y alguien compró esos asientos, se marcan en rojo, se sugieren otros y aparece «Seleccionar nuevos asientos». | `comprador-6-asientos-perdidos.png` |

## T09 · Boletos con QR y control de acceso

| Subtarea | Lista cuando | Evidencia |
| --- | --- | --- |
| T09.1 Generar boletos (RN-13) | Una orden de 4 asientos genera 4 QR distintos. | Prueba «T09.1 / RN-13 an order of 4 seats issues 4 tickets…». Cada boleto tiene un código aleatorio de 100 bits (`XXXX-XXXX-XXXX-XXXX-XXXX`) que no se deriva de la orden. |
| T09.2 Mis boletos (K-12) | El PDF se descarga de nuevo en cualquier momento. | Prueba «T09.2 and T09.3…» descarga el PDF dos veces; navegador: «el PDF del boleto se descarga desde Mis boletos». `comprador-7-mis-boletos.png` |
| T09.3 Correo de confirmación | El correo llega con un PDF por boleto. | La misma prueba revisa el comprobante y 2 adjuntos PDF. La bandeja del administrador lo muestra (`admin-8-correos.png`). Para que llegue a un buzón real hay que configurar SMTP en `.env`. |
| T09.4 Acceso del personal | El personal solo ve los eventos que le asignaron. | Prueba «T09.4 staff sign in…»; navegador: la taquilla solo ve sus 2 funciones (`taquilla-1-elegir-evento.png`). |
| T09.5 Escáner | Funciona en un Android y en un iPhone. | Cámara del navegador con BarcodeDetector (Android) y jsQR (iPhone), más «Tomar foto del QR» como respaldo. En Chrome y Edge se probó la lectura real con un video del QR (`taquilla-5-camara.png`). **Pendiente:** probarlo en un Android y un iPhone físicos con `npm run start:https`. |
| T09.6 Resultados del escaneo | Los 3 resultados se probaron con boletos de prueba. | Prueba «T09.6, T09.7 and T09.10…»; capturas `taquilla-2-acceso-valido.png`, `taquilla-3-ya-utilizado.png` (con hora y puerta) y `taquilla-4-no-valido.png`. |
| T09.7 Búsqueda manual y contador | La búsqueda manual da el mismo resultado que el escáner. | La misma prueba escribe el código en minúsculas y sin guiones, y también lo manda como QR (`ETICKET:…`); el contador muestra entraron / vendidos. |
| T09.8 Escaneo atómico | Dos escaneos simultáneos dan un verde y un rojo. | Prueba «T09.8 two simultaneous scans…»: un `UPDATE … WHERE status='valid'` solo deja pasar al primero. |
| T09.9 Revertir escaneo | El boleto vuelve a ser válido y la bitácora muestra quién lo revirtió. | Prueba «T09.9 the organizer reverts…»; navegador: el organizador revierte desde su panel. |
| T09.10 Pruebas de acceso | Escaneo doble, otra función y reembolsado salen en rojo con su motivo. | Prueba «T09.6, T09.7 and T09.10…» (también otro evento, código transferido y código que no existe). |

## T10 · Reportes, notificaciones y panel de administración

| Subtarea | Lista cuando | Evidencia |
| --- | --- | --- |
| T10.1 Panel del organizador (K-14) | Las cifras cuadran con las órdenes de prueba. | Prueba «T10.1 and T10.2…»: 5 vendidos, ingresos $1,750, comisión $175, IVA $308, cobrado $2,233, a liquidar $1,750, 1 cortesía. `organizador-2-panel-del-evento.png` |
| T10.2 Asistencia real | Tras escanear 3 boletos, el reporte marca 3. | La misma prueba escanea 3 y el reporte marca 3 de 5 (60 %). |
| T10.3 Reportes del administrador | Cada reporte filtra por fechas y cuadra. | Prueba «T10.3 and T10.4…»: ventas por periodo, comisiones, eventos más vendidos, compras expiradas y reembolsos con compras en días distintos. `admin-4-reportes.png` |
| T10.4 Exportar (K-21) | El archivo abre en Excel con las mismas cifras. | CSV en UTF-8 con BOM y números sin símbolo; la prueba compara cada línea con el reporte en pantalla. |
| T10.5 Gestión de usuarios | Un usuario bloqueado no puede comprar, pero sus boletos siguen válidos. | Prueba «T10.5 a blocked user…». `admin-5-usuarios.png` |
| T10.6 Comisión | Un cambio solo se aplica a compras nuevas. | Prueba «T10.6…»: el apartado anterior conserva 10 % y el nuevo usa 15 %. `admin-7-comision.png` |
| T10.7 Bitácora (K-18, RN-19) | Cada acción deja un registro consultable. | Prueba «T10.7…» revisa aprobaciones, roles, personal, reversión de escaneos, reembolsos, bloqueos y cancelaciones. `admin-6-bitacora.png` |
| T10.8 Correos automáticos (K-17) | Los 3 correos llegan en una prueba con fechas simuladas. | Prueba «T10.8…»: evento aprobado y rechazado, función agotada y recordatorio 24 horas antes (sin duplicados). |
| T10.9 Pruebas de permisos | Un organizador no abre el reporte de otro ni cambiando la URL. | Prueba «T10.9…» (reporte, CSV, personal, cambio de fecha, cancelación y reversión dan 403). |

## T11 · Transferencias, cancelaciones y reembolsos

| Subtarea | Lista cuando | Evidencia |
| --- | --- | --- |
| T11.1 Transferir boleto (RN-14, K-16) | Pasado el límite de 24 horas la opción ya no aparece. | Pruebas «T11.1 and T11.2…» y «T11.1 the transfer option disappears 24 hours before…». `comprador-8-transferir.png` |
| T11.2 Nuevo QR al transferir | El QR anterior sale rojo «no válido». | Prueba y navegador: el código anterior sale «No válido: código anterior de un boleto transferido»; quien recibe tiene un correo con el PDF nuevo. |
| T11.3 Solicitud de cancelación (K-15) | Un evento no se cancela sin aprobación del administrador. | Prueba «T11.3 and T11.4…»: con la solicitud pendiente el evento sigue a la venta. `organizador-3-cancelacion-solicitada.png`, `admin-2-cancelacion-pendiente.png` |
| T11.4 Cancelación aprobada | Cada orden queda reembolsada por su monto total. | La misma prueba: 3 órdenes reembolsadas al 100 % con cargo incluido, todos los QR invalidados y correo a cada comprador. |
| T11.5 Reembolsos fallidos | Aparece con orden, monto y motivo. | Prueba «T11.5…»: el pago con la tarjeta de prueba `0069` hace que la pasarela rechace el reembolso; se puede reintentar o marcar como resuelto. `admin-3-reembolsos-fallidos.png` |
| T11.6 Cambio de fecha | Después de 10 días la opción de reembolso desaparece. | Prueba «T11.6…»: correo a quienes tienen boletos, reembolso dentro del plazo y 409 al día 11. |
| T11.7 Reembolso individual (RN-16) | El asiento vuelve a estar disponible y su QR sale «no válido». | Prueba «T11.7 refunding 1 of 4 tickets…». |
| T11.8 De agotado a En venta | Liberar un asiento cambia el estado en menos de 1 minuto. | Prueba «T11.8…» (inmediato); la cartelera se actualiza sola cada 30 segundos. `visitante-2-cartelera-agotado.png`, `visitante-3-evento-agotado.png` |
| T11.9 Pruebas | Los 3 casos pasan con evidencia. | QR transferido, evento cancelado con 3 órdenes y reembolso de 1 de 4: pruebas anteriores. |

## T12 · Pruebas finales, documentación y presentación

| Subtarea | Estado |
| --- | --- |
| T12.1 Matriz de pruebas | Omitida por decisión del equipo: necesita el texto de RN-01 a RN-20 y de las historias «Debe». |
| T12.2 Casos «qué pasa si» | Omitida por la misma razón (necesita los bloques 4 a 8 del guion y acceso a Jira). |
| T12.3 Prueba de carga | Hecha. Ver la tabla de abajo. |
| T12.4 Celular y navegadores | Chrome y Edge automatizados; Safari y Firefox quedan para revisarse a mano. |
| T12.5 Revisión de seguridad | Hecha, con dos correcciones. Ver abajo. |
| T12.6 Textos legales | Aviso de privacidad, términos y política de reembolsos en el pie de página y resumidos en la pantalla de pago (`comprador-4-pago-con-textos-legales.png`, `visitante-4-terminos.png`). |
| T12.7 Manual de usuario | [`MANUAL.md`](MANUAL.md), con capturas de los 5 roles. Falta que un integrante siga sin ayuda la guía de un rol que no programó. |

### T12.3 · Prueba de carga (`npm run prueba:carga`)

| Escenario (150 solicitudes a la vez) | Apartados | Rechazados | p50 | p95 | Máximo | Duplicados |
| --- | --- | --- | --- | --- | --- | --- |
| Un asiento cada quien entre 26 libres | 26 | 124 | 292 ms | 373 ms | 374 ms | 0 |
| Pares de asientos que se cruzan | 13 | 137 | 212 ms | 250 ms | 250 ms | 0 |
| Zona general con cupo 24 | 24 | 126 | 221 ms | 227 ms | 228 ms | 0 (sin sobreventa) |

Todas las respuestas llegan en menos de 2 segundos y nunca se entrega un lugar dos veces. Una prueba más corta (60 compradores) corre siempre con `npm test`.

### T12.4 · Navegadores y celular

| Navegador | Resultado |
| --- | --- |
| Chrome (Windows) | 43 de 43 comprobaciones; inicio en 426 ms. |
| Edge (Windows) | 43 de 43 comprobaciones; inicio en 406 ms. |
| Celular (390 px, emulado en Chrome y Edge) | Ninguna de las 9 pantallas revisadas se desborda. Capturas `celular-1-mis-boletos.png`, `celular-2-mapa-asientos.png` y las de taquilla. |
| Safari (iPhone) y Firefox | **Pendiente, a mano:** abrir cada pantalla, medir que cargue en menos de 3 s y revisar que nada se corte. |

### T12.5 · Revisión de seguridad

| Punto | Evidencia |
| --- | --- |
| Contraseñas cifradas | scrypt (N=32768) con sal aleatoria; prueba «T12.5 passwords are stored hashed…» revisa que la base solo guarda `sal:hash`. |
| HTTPS | En producción: `COOKIE_SECURE=true` (cookie solo por HTTPS) y cabecera `Strict-Transport-Security`; CSP en `server/start.js`. Para la red local, `npm run start:https`. |
| Permisos por rol | Prueba «T12.5 each role only reaches its own routes» (10 rutas de administración contra los otros 3 roles y visitantes) y «T10.9…». |
| Cierre de sesión a los 30 minutos | Cookie HttpOnly, SameSite=Lax, `Max-Age=1800`; la prueba expira la sesión y confirma que deja de funcionar. Las consultas automáticas no alargan la sesión. |
| Corregido: webhook sin firma | Cualquiera podía marcar un apartado como pagado. Ahora exige la cabecera `X-Webhook-Secret` (`PAYMENT_WEBHOOK_SECRET`) y usa siempre el monto calculado por el servidor. |
| Corregido: taquilla con códigos inventados | `POST /api/box-office/check` validaba códigos que el comprador podía guardar con `PUT /api/orders`. Se reemplazó por `POST /api/scan`, que solo acepta boletos emitidos por el servidor. |
| Datos de tarjeta | El número completo y el CVC nunca llegan al servidor (T07); solo se guardan los últimos 4 dígitos y la marca. |

## Cambios a lo que ya existía

- **Órdenes y boletos en tablas propias** (`orders`, `tickets`): son la única fuente de verdad para QR, escaneo, transferencias, reembolsos y reportes. Las compras viejas guardadas en `user_orders` se siguen mostrando en el historial, pero ya no sirven para entrar.
- **Pago de T07:** al aprobarse crea boletos reales y envía el correo con los PDF. Se ajustaron 3 pruebas de Cristian: los códigos ya no contienen el número de orden (RN-13), las órdenes se cuentan en la tabla `orders` y el webhook manda su firma.
- **Fecha correcta en pagos:** `payments.js` usaba el 14 de noviembre para los 5 eventos de muestra; ahora toma la fecha y el precio del catálogo central (`server/catalog.js`).
- **Pantalla «Pago en proceso»:** llamaba funciones que T07 había borrado; ahora solo muestra el estado y permite actualizarlo.
- **Eventos cancelados:** ya no se pueden editar ni volver a publicar; una decisión solo se toma sobre eventos «en revisión».

## Pendientes que necesitan al equipo

- T09.5: probar el escáner en un Android y un iPhone reales (`npm run start:https` y aceptar el certificado de prueba).
- T09.3, T10.8 y T11.2: configurar SMTP en `.env` para que los correos lleguen a buzones reales; mientras tanto se ven en Administración → Correos.
- T12.4: Safari y Firefox.
- T12.7: que un integrante siga la guía de un rol que no programó.
- Ensayar la demo y hacer commit de la Entrega 3.
