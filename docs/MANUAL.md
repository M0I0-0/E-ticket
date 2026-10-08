# Manual de usuario de eTicket

eTicket es una boletera para conciertos, teatro, festivales y comedia. Hay cinco roles: **visitante**, **comprador**, **organizador**, **taquilla** (personal de acceso) y **administración**. Cada sección explica qué puede hacer ese rol, paso a paso.

> Proyecto escolar: los pagos usan una pasarela de pruebas (sandbox) y no se cobra dinero real.

**Para probarlo:** en la carpeta del proyecto ejecuta `npm install`, luego `npm run demo:datos -- --ventas` y `npm start`, y abre `http://localhost:5173`. Las cuentas de demostración usan la contraseña `Demo123!`:

| Rol | Correo |
| --- | --- |
| Comprador | `ana.demo@eticket.test`, `beto.demo@eticket.test`, `carla.demo@eticket.test` |
| Organizador | `org.demo@eticket.test` |
| Taquilla | `taquilla.demo@eticket.test` |
| Administración | `admin.demo@eticket.test` |

---

## 1. Visitante (sin cuenta)

1. **Inicio:** muestra los eventos destacados. Pulsa «Explorar cartelera».
   ![Inicio](manual/visitante-1-inicio.png)
2. **Cartelera:** busca por nombre o artista y filtra por categoría, fecha, ciudad y precio. Cada evento indica si está **En venta** o **Agotado**; esa etiqueta se actualiza sola.
   ![Cartelera con un evento agotado](manual/visitante-2-cartelera-agotado.png)
3. **Detalle:** elige la función y la zona para ver el precio final (incluye cargo por servicio e IVA). Si la función está agotada, el botón dice «Agotado».
   ![Evento agotado](manual/visitante-3-evento-agotado.png)
4. **Mapa de asientos:** puedes verlo sin cuenta. Para apartar un asiento te pedirá iniciar sesión.
5. **Textos legales:** el aviso de privacidad, los términos y la política de reembolsos están en el pie de página de todas las pantallas.
   ![Términos y condiciones](manual/visitante-4-terminos.png)

## 2. Comprador

### Crear cuenta e iniciar sesión

1. Pulsa «Iniciar sesión» → «Crear cuenta». Llena nombres, apellidos, correo y contraseña (6 a 15 caracteres, con una mayúscula y un símbolo).
2. Escribe el código de 6 dígitos que llega a tu correo. Vence en 10 minutos.
3. La sesión se cierra sola tras 30 minutos sin actividad.

### Elegir asientos

1. En el detalle del evento pulsa «Elegir boletos».
2. **Al tocar un asiento se aparta para ti de inmediato** y empieza un reloj de 10 minutos que no se puede extender. Tus asientos se ven morados con ✓; puedes tocar más (hasta 6) o tocar uno tuyo para liberarlo.
   ![Asientos apartados](manual/comprador-1-asientos-apartados.png)
3. Los asientos con **candado ámbar** los está comprando otra persona; se liberan solos si no termina. Los de **×** ya están vendidos o bloqueados.
   ![Asientos de otra persona con candado](manual/comprador-2-asientos-de-otros.png)
4. Si otra persona toca el mismo asiento un instante antes, verás «No se pudo apartar», el asiento en rojo y una **estrella con un asiento sugerido** cerca.
   ![Conflicto y asiento sugerido](manual/comprador-3-conflicto-sugerido.png)
5. Si tu reloj llega a cero, los lugares se liberan sin cobro. Al volver, el mapa te dice si tus asientos anteriores siguen libres o si alguien los compró, y te sugiere otros.
   ![Asientos que ya no están disponibles](manual/comprador-6-asientos-perdidos.png)
6. En zona general eliges la cantidad con − y + y pulsas «Continuar al resumen».

> Solo puedes tener una compra abierta. Si cambias de pestaña o de dispositivo, verás «Tienes una compra en curso» con el mismo reloj.

### Pagar

1. En el resumen revisa el desglose y pulsa «Continuar al pago».
2. Antes de pagar puedes leer el resumen de términos, reembolsos y privacidad. Marca la casilla para habilitar el botón de pago.
   ![Pago con los textos legales visibles](manual/comprador-4-pago-con-textos-legales.png)
3. Tarjetas de prueba:

   | Tarjeta | Resultado |
   | --- | --- |
   | `4242 4242 4242 4242` | Pago aprobado. |
   | `4000 0000 0000 0002` | Rechazado por fondos insuficientes (tienes 3 intentos). |
   | `4000 0000 0000 9999` | Cobro aprobado sin boletos (caso que atiende la administración). |
   | `4000 0000 0000 0069` | Aprobado, pero si después se cancela el evento la pasarela rechaza el reembolso. |

4. Al aprobarse ves el comprobante y te llega un correo con un **PDF por boleto**.
   ![Confirmación](manual/comprador-5-confirmacion.png)

### Mis boletos

1. En «Mis boletos» cada boleto vigente muestra su **QR**, su código y los botones «Descargar PDF» y «Transferir». Puedes descargar el PDF las veces que quieras.
   ![Mis boletos](manual/comprador-7-mis-boletos.png)
2. En la entrada presenta el QR (en pantalla o impreso). Si la cámara del personal falla, pueden escribir el código.
3. **Transferir:** pulsa «Transferir», escribe el correo de otra cuenta eTicket y confirma. La otra persona recibe el boleto con un **QR nuevo** y el tuyo deja de funcionar. Se puede hasta 24 horas antes del evento.
   ![Transferir un boleto](manual/comprador-8-transferir.png)
4. **Si el evento cambia de fecha**, te llega un correo y en el boleto aparece «Pedir reembolso» durante 10 días.
5. **Si el evento se cancela**, recibes el reembolso del 100 % (cargo incluido) y tus QR dejan de ser válidos.
6. «Ver historial de compras» muestra cada orden con su desglose y los reembolsos.

## 3. Organizador

1. Desde «Mi cuenta», un comprador pulsa «Enviar solicitud» para ser organizador. La administración la aprueba o la rechaza con un motivo.
2. En «Panel» → «Crear evento» llena nombre, recinto, funciones (una por línea: `AAAA-MM-DD,HH:MM`), zonas, asientos de cortesía o prensa, límite por compra (1 a 6) y ventana de venta. Guarda y pulsa «Enviar a revisión».
   ![Mis eventos](manual/organizador-1-mis-eventos.png)
3. Cuando el evento está publicado, pulsa **«Panel del evento»**:
   - **Cifras:** vendidos, ingresos por boletos, comisión de eTicket, monto a liquidar, disponibles, cortesías, asistencia y reembolsos.
   - **Ventas por función y zona**, con «Descargar CSV».
   - **Asistencia real:** escaneados contra vendidos por función.
   - **Escaneos recientes:** si un boleto se escaneó por error, pulsa «Revertir» y escribe el motivo; queda en la bitácora.
   - **Personal de acceso:** asigna cuentas de taquilla a cada función o quítalas.
   - **Cambiar fecha:** elige la función, la nueva fecha y el motivo. Se avisa por correo a quienes tienen boletos y tienen 10 días para pedir reembolso.
   - **Cancelación:** escribe el motivo y pulsa «Solicitar cancelación». El evento sigue a la venta hasta que la administración lo apruebe.
   ![Panel del evento](manual/organizador-2-panel-del-evento.png)
   ![Cancelación solicitada](manual/organizador-3-cancelacion-solicitada.png)

## 4. Taquilla (personal de acceso)

1. Inicia sesión y abre «Panel». Solo verás los eventos y funciones que te asignaron. Elige uno, escribe tu puerta y pulsa «Comenzar a validar».
   ![Elegir evento y puerta](manual/taquilla-1-elegir-evento.png)
2. Para validar tienes tres opciones:
   - **«Activar cámara»** y apuntar al QR; la validación es automática.
   - **«Tomar foto del QR»** si la cámara en vivo no abre.
   - **Búsqueda manual:** escribe el código del boleto (no importan mayúsculas, espacios ni guiones).
   ![Validación con la cámara](manual/taquilla-5-camara.png)
3. Qué significa cada resultado:
   - **Verde «ACCESO VÁLIDO»:** la persona puede pasar; se muestran asiento y titular.
   ![Acceso válido](manual/taquilla-2-acceso-valido.png)
   - **Rojo «YA UTILIZADO»:** ese boleto ya entró; se muestran la hora y la puerta.
   ![Ya utilizado](manual/taquilla-3-ya-utilizado.png)
   - **Rojo «NO VÁLIDO»:** es de otro evento o función, fue reembolsado, se transfirió (código anterior) o no existe; se muestra el motivo.
   ![No válido](manual/taquilla-4-no-valido.png)
4. Arriba ves cuántas personas han entrado de los boletos vendidos; se actualiza con todas las puertas.

> La cámara en vivo del celular necesita una página segura (https). Para la red local, quien levanta el proyecto usa `npm run start:https` y en el celular se acepta el aviso del certificado de prueba. «Tomar foto del QR» y la búsqueda manual funcionan siempre.

## 5. Administración

El panel tiene pestañas:

- **General:** pagos sin boletos (RN-12), compras expiradas, solicitudes de organizador, alta de recintos y eventos por revisar.
  ![General](manual/admin-1-general.png)
- **Eventos:** todos los eventos con su disponibilidad; «Ver panel» abre las mismas cifras que ve el organizador.
  ![Eventos](manual/admin-9-eventos.png)
- **Reportes:** ventas por periodo, comisiones, eventos más vendidos, compras expiradas y reembolsos, filtrados por fechas. «Descargar CSV» baja exactamente las mismas cifras y abre en Excel.
  ![Reportes](manual/admin-4-reportes.png)
- **Usuarios:** busca por nombre o correo, cambia entre comprador y taquilla, y bloquea o desbloquea. Una cuenta bloqueada no puede comprar, pero sus boletos siguen siendo válidos.
  ![Usuarios](manual/admin-5-usuarios.png)
- **Reembolsos:** reembolsos que la pasarela rechazó (reintentar o marcar como resuelto), reembolso de un solo boleto buscando la orden, y la lista de todos los reembolsos.
  ![Reembolsos](manual/admin-3-reembolsos-fallidos.png)
- **Cancelaciones:** aprueba o rechaza las solicitudes de los organizadores. Al aprobar se invalidan todos los QR y se reembolsa el 100 % de cada orden.
  ![Cancelación pendiente](manual/admin-2-cancelacion-pendiente.png)
- **Bitácora:** quién hizo qué y cuándo (aprobaciones, cancelaciones, reembolsos, bloqueos, reversión de escaneos, cambios de comisión y de rol); se filtra por acción y fechas.
  ![Bitácora](manual/admin-6-bitacora.png)
- **Comisión:** porcentaje del cargo por servicio. El cambio solo aplica a compras nuevas.
  ![Comisión](manual/admin-7-comision.png)
- **Correos:** copia de cada correo automático con su estado (enviado, sin SMTP o error).
  ![Correos](manual/admin-8-correos.png)

## Problemas frecuentes

| Problema | Qué hacer |
| --- | --- |
| No llega el código de verificación | Falta configurar SMTP en `.env` (ver README). Para ensayar usa las cuentas de demostración. |
| «Tienes una compra en curso» | Solo se permite una compra abierta por cuenta: continúala o cancélala. |
| El reloj no vuelve a 10:00 | Es a propósito: el tiempo no se reinicia al recargar, cambiar de pestaña o cambiar asientos. |
| La cámara no abre en el celular | Usa `npm run start:https`, acepta el certificado y da permiso de cámara; o usa «Tomar foto del QR» o la búsqueda manual. |
| Un correo dice «Sin SMTP» en Administración → Correos | El correo se generó bien, pero no salió porque falta configurar el servidor de correo. |
