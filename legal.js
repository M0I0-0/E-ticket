// T12.6: privacy notice, terms and refund policy. Linked from the footer and shown before paying.
const UPDATED = '9 de octubre de 2026';
const NOTE = '<p class="legal-note">Texto preparado para el proyecto escolar eTicket. Antes de operar con clientes reales debe revisarlo un abogado.</p>';

export const LEGAL = {
  privacidad: {
    title: 'Aviso de privacidad',
    html: `<p>eTicket («nosotros») es responsable del tratamiento de los datos personales que nos proporcionas, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares.</p>
      <h2>Datos que recabamos</h2><p>Nombre y apellidos, correo electrónico, contraseña (guardada solo como huella cifrada con scrypt), historial de compras y boletos, los últimos 4 dígitos y la marca de la tarjeta, y los registros de acceso a eventos (fecha, hora y puerta). Nunca guardamos el número completo de la tarjeta ni su código de seguridad.</p>
      <h2>Para qué los usamos</h2><p>Para crear y proteger tu cuenta, apartar y vender boletos, enviarte comprobantes, boletos, avisos de cambios, cancelaciones y reembolsos, validar tu acceso en la entrada, prevenir fraudes y cumplir obligaciones fiscales. No vendemos tus datos ni los usamos para publicidad de terceros.</p>
      <h2>Con quién los compartimos</h2><p>Con la pasarela de pagos para procesar cobros y reembolsos, y con el organizador del evento solo lo indispensable para el acceso (nombre del titular y asiento).</p>
      <h2>Tus derechos ARCO</h2><p>Puedes acceder, rectificar, cancelar u oponerte al uso de tus datos, y revocar tu consentimiento, escribiendo a privacidad@eticket.mx con una identificación. Respondemos en un máximo de 20 días hábiles.</p>
      <h2>Seguridad y conservación</h2><p>Usamos conexiones cifradas (HTTPS), cookies de sesión HttpOnly que vencen tras 30 minutos sin actividad y control de acceso por rol. Conservamos los datos de compra el tiempo que exige la ley fiscal.</p>`,
  },
  terminos: {
    title: 'Términos y condiciones',
    html: `<p>Al crear una cuenta o comprar boletos en eTicket aceptas estos términos.</p>
      <h2>Cuenta</h2><p>Debes dar datos verdaderos y cuidar tu contraseña. Podemos bloquear la compra de cuentas con actividad fraudulenta; los boletos ya pagados siguen siendo válidos.</p>
      <h2>Apartado y compra</h2><p>Al elegir un asiento lo apartamos durante 10 minutos, sin posibilidad de extender el tiempo. Si no completas el pago, los lugares se liberan. Cada cuenta puede tener una compra en curso y hasta 6 boletos por compra (o el límite del evento).</p>
      <h2>Precio</h2><p>El precio final incluye el precio del boleto, el cargo por servicio de eTicket y el IVA (16 %), y se muestra desglosado antes de pagar. Cobramos una sola vez por orden.</p>
      <h2>Boletos y acceso</h2><p>Cada boleto tiene un código QR único que permite entrar una sola vez. Puedes descargarlo en PDF desde «Mis boletos». Un boleto duplicado, transferido, reembolsado o de otro evento será rechazado en la entrada.</p>
      <h2>Transferencias</h2><p>Puedes transferir un boleto a otra cuenta registrada hasta 24 horas antes del evento. El QR anterior deja de ser válido y la otra persona recibe uno nuevo.</p>
      <h2>Cambios y cancelaciones</h2><p>Los eventos son responsabilidad de su organizador. Si cambian de fecha o se cancelan, aplica la política de reembolsos.</p>`,
  },
  reembolsos: {
    title: 'Política de reembolsos',
    html: `<p>Los boletos no son reembolsables, salvo en estos casos:</p>
      <h2>Evento cancelado</h2><p>Si la administración aprueba la cancelación de un evento, reembolsamos automáticamente el 100 % de cada orden, incluido el cargo por servicio, al mismo medio de pago. Los QR quedan invalidados.</p>
      <h2>Cambio de fecha</h2><p>Si un evento cambia de fecha te avisamos por correo y tienes 10 días naturales para pedir el reembolso desde «Mis boletos». Pasado ese plazo, tus boletos siguen siendo válidos para la nueva fecha.</p>
      <h2>Casos individuales</h2><p>La administración puede reembolsar un boleto de una orden cuando corresponda. Ese boleto deja de ser válido y su lugar vuelve a la venta.</p>
      <h2>Tiempos</h2><p>El reembolso se emite al momento en la pasarela; el banco puede tardar de 5 a 10 días hábiles en reflejarlo. Si la pasarela rechaza un reembolso, la administración lo atiende y te contacta.</p>`,
  },
};

export function renderLegal(app, page, back) {
  const doc = LEGAL[page];
  app.innerHTML = `${back('inicio')}<article class="panel legal"><div class="eyebrow">eTicket · Actualizado el ${UPDATED}</div><h1 style="font-size:40px">${doc.title}</h1>${doc.html}${NOTE}<nav class="legal-links">${Object.entries(LEGAL).filter(([id]) => id !== page).map(([id, d]) => `<a href="#${id}">${d.title}</a>`).join('')}</nav></article>`;
}

// Short version shown on the payment page, so the rules are visible before paying.
export const legalSummary = `<details class="legal-summary"><summary>Antes de pagar: términos, reembolsos y privacidad</summary>
  <ul><li>Tus lugares están apartados 10 minutos; el tiempo no se extiende.</li><li>Los boletos no son reembolsables, salvo cancelación del evento (100 % con cargo incluido) o cambio de fecha (10 días para pedirlo).</li><li>Puedes transferir un boleto a otra cuenta hasta 24 horas antes del evento.</li><li>No guardamos el número completo de tu tarjeta ni su código de seguridad.</li></ul>
  <p><a href="#terminos" target="_blank" rel="noopener">Términos y condiciones</a> · <a href="#reembolsos" target="_blank" rel="noopener">Política de reembolsos</a> · <a href="#privacidad" target="_blank" rel="noopener">Aviso de privacidad</a></p></details>`;
