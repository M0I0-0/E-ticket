// Checks the e-mail settings of .env by sending one test message:
//   npm run correo:prueba -- tu.correo@gmail.com
// Without an address it writes to SMTP_USER itself.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { senderFor, smtpOptions, smtpTransport } from '../server/mailer.js';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (!existsSync(envFile)) {
  console.error('No existe el archivo .env. Copia .env.example con el nombre .env y llena SMTP_HOST, SMTP_USER y SMTP_PASS.');
  process.exit(1);
}
process.loadEnvFile(envFile);
const settings = smtpOptions(process.env);
if (!settings) {
  console.error(`Faltan datos en .env: ${['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(key => !process.env[key]).join(', ')}.`);
  process.exit(1);
}
const to = process.argv[2] || process.env.SMTP_USER;
console.log(`Probando ${settings.host}:${settings.port} (${settings.secure ? 'TLS' : 'STARTTLS'}) con la cuenta ${settings.auth.user}…`);

const HINTS = {
  EAUTH: 'Usuario o contraseña rechazados. Con Gmail, SMTP_PASS debe ser una contraseña de aplicación (16 letras, sin espacios) de una cuenta con verificación en 2 pasos.',
  ESOCKET: 'No se pudo abrir la conexión. Revisa SMTP_PORT y SMTP_SECURE: 465 con true o 587 con false.',
  ECONNECTION: 'No se pudo conectar al servidor de correo. Revisa SMTP_HOST, SMTP_PORT y tu conexión a internet.',
  ETIMEDOUT: 'El servidor de correo no respondió. Revisa SMTP_PORT o si tu red bloquea el puerto.',
  EDNS: 'No existe el servidor de SMTP_HOST. Para Gmail es smtp.gmail.com.',
};
try {
  const transport = smtpTransport(process.env);
  await transport.verify();
  const info = await transport.sendMail({ from: senderFor(process.env), to, subject: 'Prueba de correo de eTicket', text: 'Si lees esto, el correo de eTicket quedó bien configurado.' });
  console.log(`Listo: enviamos un correo de prueba a ${to} (${info.messageId}). Si no lo ves, revisa la carpeta de spam.`);
} catch (error) {
  console.error(`No se pudo enviar: ${error.message}`);
  if (HINTS[error.code]) console.error(HINTS[error.code]);
  process.exit(1);
}
