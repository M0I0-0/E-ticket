# E-ticket

Aplicacion HTML, CSS y JavaScript con Vite y una API Node.js para cuentas reales.
Requiere Node.js 24 o superior.

## Ejecutar

Desde E-ticket: `npm install`, seguido de `npm start`.
Los comandos tambien funcionan desde la carpeta superior AgileKanban2.

- `npm start` o `npm run dev`: servidor de desarrollo y API.
- `npm run build`: genera la interfaz en dist/.
- `npm run preview`: revisa la compilacion con su API.
- `npm run serve`: sirve dist/ y la API en el puerto 3000; requiere compilar primero.
- `npm test`: pruebas de cuentas, sesiones, verificacion, recuperacion y aislamiento.

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
Para vender boletos faltan un proveedor de pagos, inventario y reservas en el
servidor y validacion de entradas.

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
