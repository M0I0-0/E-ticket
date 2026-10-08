# E-ticket

Aplicacion HTML, CSS y JavaScript con Vite y una API Node.js para cuentas reales.
Requiere Node.js 24 o superior.

El estado del proyecto, su arquitectura, la API y la historia de cambios estan
en `docs/CONTEXTO.md`.

## Ejecutar

Desde E-ticket: `npm install`, seguido de `npm start`.
Los comandos tambien funcionan desde la carpeta superior AgileKanban2.

- `npm start` o `npm run dev`: servidor de desarrollo y API.
- `npm run build`: genera la interfaz en dist/.
- `npm run preview`: revisa la compilacion con su API.
- `npm run serve`: sirve dist/ y la API en el puerto 3000; requiere compilar primero.
- `npm test`: pruebas de cuentas, sesiones, verificacion, recuperacion, aislamiento y apartados.
- `npm run demo:datos`: crea cuentas de demostracion verificadas sin SMTP; con
  `-- --limpiar` borra tambien sus compras y apartados.

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
requieren SMTP configurado. La cartelera,
los cobros, las transferencias y los QR siguen siendo una simulacion: los datos
de compras guardados no constituyen comprobantes de pago ni entradas reales.
Los apartados con reloj ya se guardan en el servidor; para vender boletos reales
faltan un proveedor de pagos y validacion de entradas.

## Apartados y reloj de compra (T08)

Al pasar al resumen, el servidor aparta los lugares durante 10 minutos (RN-03)
y guarda la hora exacta de vencimiento en la tabla `holds`. El navegador recibe
el tiempo restante calculado con la hora del servidor, asi que recargar, abrir
otra pestaña o cambiar de dispositivo no reinicia el reloj. Cambiar los lugares
tampoco lo extiende.

- Cada cuenta tiene como maximo una compra abierta; quien vuelve ve
  «Tienes una compra en curso» (RN-04, RN-06, K-09).
- Quitar un lugar o cancelar lo libera al instante; el mapa de otros
  navegadores se actualiza cada 5 segundos (RN-05).
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
| Taquilla | Sí | No | No | No | Sí |
| Administrador | Sí | Sí, su cuenta | Revisa y publica | Sí | No |

La matriz se cubre con pruebas de API en `server/accounts.test.js`; las rutas
administrativas devuelven 403 si el perfil no tiene permiso.
