# E-ticket

Aplicacion HTML, CSS y JavaScript con Vite y una API Node.js para cuentas reales.
Requiere Node.js 24 o superior.

El estado del proyecto, su arquitectura, la API y la historia de cambios estan
en `docs/CONTEXTO.md`. La guia por rol con capturas esta en `docs/MANUAL.md` y
la evidencia de la Entrega 3 en `docs/ENTREGA-3.md`.

## Ejecutar

Desde E-ticket: `npm install`, seguido de `npm start`.
Los comandos tambien funcionan desde la carpeta superior AgileKanban2.

- `npm start` o `npm run dev`: servidor de desarrollo y API.
- `npm run build`: genera la interfaz en dist/.
- `npm run preview`: revisa la compilacion con su API.
- `npm run serve`: sirve dist/ y la API en el puerto 3000; requiere compilar primero.
- `npm start -- --host 0.0.0.0`: igual, accesible desde otros dispositivos de la red.
- `npm run start:https`: igual, con https de prueba; la camara del celular solo abre en paginas seguras.
- `npm test`: 45 pruebas de cuentas, apartados, pagos, boletos, acceso, reportes,
  reembolsos y seguridad.
- `npm run prueba:carga`: 150 compradores a la vez sobre los mismos lugares (T12.3).
- `npm run demo:datos`: cuentas de demostracion verificadas sin SMTP, organizadora,
  taquilla, dos eventos publicados y personal asignado. `-- --ventas` agrega compras
  de ejemplo y `-- --limpiar` borra primero lo creado para la demo.

## Registro y acceso

El registro pide nombres, apellidos, correo y contrasena. La cuenta se activa
despues de confirmar un codigo enviado por correo; es necesario configurar SMTP.
La contrasena requiere de 6 a 15 caracteres, una mayuscula y un caracter especial.

## Cuentas y almacenamiento

Las cuentas se guardan en data/eticket.sqlite, con contrasenas derivadas mediante
scrypt y una sal aleatoria. SQLite viene incluido en Node.js; no hay que instalar
un servidor de base de datos adicional.

El correo es unico, sin distinguir mayusculas. La sesion vence tras 30 minutos
sin actividad,
usa una cookie HttpOnly y se invalida al cerrar sesion.

Usuarios, codigos, sesiones y compras simuladas se conservan al reiniciar el
servidor. Cada cuenta accede unicamente a sus propios registros; no se importan
las antiguas compras anonimas del navegador. Conserva la carpeta data/ y haz
copias de respaldo con el servidor detenido (incluye los archivos SQLite -wal
y -shm si existen). La carpeta contiene informacion privada y esta ignorada en Git.

## Acceso para varios usuarios

Para probar en tu red local, desde E-ticket ejecuta `npm start -- --host 0.0.0.0`.
Los dispositivos deben abrir la misma direccion IP y puerto del servidor.

Para publicar, ejecuta `npm run build` y `npm run serve` en un servidor Node.js
con almacenamiento persistente para data/. Puedes configurar PORT y HOST en .env.
Usa HTTPS y configura COOKIE_SECURE=true en el entorno publicado.
Una sola instancia Node.js centraliza las cuentas de todos los usuarios.
Publicar solamente dist/ en un alojamiento estatico no publica la API.

El registro, la verificacion por correo, el inicio de sesion y la recuperacion
requieren SMTP configurado. Los boletos con QR y su validacion en la entrada son
reales; los cobros y reembolsos pasan por una pasarela de pruebas (sandbox), asi
que no se mueve dinero real. Para vender boletos reales falta conectar una pasarela
de pagos de verdad.

## Apartados y reloj de compra (T08)

Al tocar un asiento, el servidor lo aparta de inmediato durante 10 minutos (RN-03)
y guarda la hora exacta de vencimiento en la tabla `holds`. El navegador recibe
el tiempo restante calculado con la hora del servidor, asi que recargar, abrir
otra pestaña o cambiar de dispositivo no reinicia el reloj. Cambiar los lugares
tampoco lo extiende.

- Cada cuenta tiene como maximo una compra abierta; quien vuelve ve
  «Tienes una compra en curso» (RN-04, RN-06, K-09).
- Quitar un lugar o cancelar lo libera al instante; el mapa de otros
  navegadores se actualiza cada 3 segundos y muestra con candado los asientos que
  otra persona tiene apartados (RN-05).
- Una tarea cada minuto libera los apartados vencidos y los registra como
  expirados; el administrador ve el conteo en su panel (K-10, T08.7).
- Un apartado «En pago» no se libera al llegar a cero. Si el pago se rechaza
  despues del cero, se libera; si no hay respuesta en 5 minutos, tambien.

## Checkout y pago con tarjeta en sandbox (T07)

El flujo de pago conecta con la pasarela de pagos en modo sandbox, asegurando
que la pasarela sea la fuente de verdad y cobrando exactamente una vez:

- **Desglose completo y reloj (T07.1 / RN-10):** Precio por zona, 10 % de cargo por servicio,
  16 % de IVA y total coincidente al centavo con el cobro de la pasarela, con el
  temporizador visible.
- **Términos y reembolsos (T07.2):** Casilla obligatoria de aceptación de términos
  y política de reembolsos. El botón Pagar permanece inactivo hasta que se marca.
- **Formulario seguro y tokenización (T07.3):** Los datos de tarjeta se tokenizan
  en el navegador (`sandboxTokenize`). El número completo y el CVV nunca llegan
  ni se guardan en el servidor.
- **Estado «En pago» congelado (T07.4 / RN-07):** El apartado se congela hasta por
  5 minutos mientras la pasarela responde, evitando que la tarea periódica lo libere.
- **Confirmación por webhook (T07.5):** `POST /api/payments/webhook` emite los
  boletos y guarda la orden en el servidor; si el comprador cierra el navegador
  inmediatamente tras pagar, sus boletos quedan guardados en su cuenta.
- **Sin doble cobro (T07.6):** Desactivación instantánea del botón al primer clic y
  llave única de idempotencia (`idempotency_key`) por orden.
- **Rechazos controlados (T07.7):** Hasta 3 intentos conservando los asientos. Al
  tercer rechazo, la compra se cancela automáticamente y las localidades se liberan.
- **Orden y comprobante (T07.8):** Comprobante emitido con número de orden, desglose,
  fecha, últimos 4 dígitos (`•••• 4242`) y código de autorización.
- **Pagos sin boletos (T07.9 / RN-12):** Cobros aprobados que no pudieron generar
  boletos se registran en `orphan_payments` para su resolución manual por el administrador.
- **Rutas de pago:** `POST /api/payments/charge`, `POST /api/payments/webhook`,
  `GET /api/admin/unresolved-payments` y `POST /api/admin/unresolved-payments/:id/resolve`.

## Entrega 3: boletos, acceso, reportes y reembolsos

- **Boletos (T09):** al aprobarse el pago se crea un boleto por asiento con un
  codigo aleatorio, su QR y su PDF; llegan por correo y se descargan en Mis boletos.
- **Acceso:** el personal de taquilla solo ve las funciones que le asignaron y valida
  con la camara, con una foto o escribiendo el codigo. Cada QR entra una sola vez;
  el organizador puede revertir un escaneo y queda en la bitacora.
- **Despues de comprar (T11):** transferencia con QR nuevo hasta 24 horas antes,
  cancelacion aprobada por la administracion con reembolso del 100 %, cambio de
  fecha con 10 dias para pedir reembolso y reembolso individual.
- **Administracion (T10):** panel por evento, reportes con CSV, bloqueo de usuarios,
  comision configurable, bitacora y bandeja de correos.
- **Seguridad:** configura `PAYMENT_WEBHOOK_SECRET` en `.env`; sin esa firma el
  webhook de pagos esta deshabilitado.

## Roles y administracion

Configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` en
`.env` para enviar codigos de verificacion y recuperacion. Sin SMTP, el registro
no activa la cuenta. Configura `ADMIN_EMAIL` con el correo de la primera cuenta
administradora; se asigna al registrarse. Las sesiones vencen tras 30 minutos
sin actividad y cinco intentos fallidos bloquean el acceso durante 15 minutos.

El comprador solicita el rol de organizador desde **Mi cuenta**. El administrador
puede aprobar solicitudes, registrar recintos y revisar eventos. Los eventos
aprobados se guardan en el servidor y aparecen en la cartelera. Cobros y entradas
siguen siendo simulados.

### Matriz de acceso revisada

| Perfil | Cartelera y detalle | Comprar / mis boletos | Eventos propios | Recintos y publicación | Validar en taquilla |
| --- | --- | --- | --- | --- | --- |
| Visitante | Sí | No | No | No | No |
| Comprador | Sí | Sí, su cuenta | Solicita aprobación | No | No |
| Organizador | Sí | Sí, su cuenta | Sí, solo propios | Envía a revisión | No |
| Taquilla | Sí | No | No | No | Sí, solo sus funciones asignadas |
| Administrador | Sí | Sí, su cuenta | Revisa y publica | Sí | No |

La matriz se cubre con pruebas de API en `server/accounts.test.js`,
`server/reports.test.js` y `server/final.test.js`; las rutas administrativas
devuelven 403 si el perfil no tiene permiso, aunque se cambie la URL.
