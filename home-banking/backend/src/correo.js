// Correo saliente del Home Banking (envíos programados a las empresas). Mismo servidor que usa Keycloak:
// HB_SMTP_HOST vacío = buzón de prueba Mailpit; la clave del servidor real va en el secreto smtp_password.
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';

const env = (k, d = '') => process.env[k] || d;
let transporte = null;
function crear() {
  const host = env('HB_SMTP_HOST', 'mailpit'), prueba = host === 'mailpit';
  let pass = '';
  try { pass = readFileSync(env('HB_SMTP_PASSWORD_FILE', '/run/secrets/smtp_password'), 'utf8').trim(); } catch { /* sin clave */ }
  const user = env('HB_SMTP_USUARIO');
  return nodemailer.createTransport({
    host, port: Number(env('HB_SMTP_PORT', prueba ? '1025' : '587')),
    secure: false, requireTLS: !prueba && env('HB_SMTP_STARTTLS', 'true') === 'true', ignoreTLS: prueba,
    ...(user ? { auth: { user, pass } } : {}),
  });
}

export async function enviarCorreo({ para, asunto, html, texto, adjuntos = [] }) {
  transporte ??= crear();
  const from = `Home Banking VALO <${env('HB_SMTP_FROM', 'alyc@valo.ar')}>`;
  return transporte.sendMail({ from, to: para.join(', '), subject: asunto, html, text: texto, attachments: adjuntos });
}
