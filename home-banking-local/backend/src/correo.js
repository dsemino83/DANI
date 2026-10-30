// Correo saliente del Home Banking (envíos programados a las empresas y links para elegir clave):
// HB_SMTP_HOST vacío = buzón de prueba Mailpit; la clave del servidor real va en el secreto smtp_password.
//
// Salida de respaldo (opcional): si se configura HB_SMTP2_HOST y el servidor principal falla, el correo se
// reintenta por el secundario. Sirve para que una caída del relay no deje a los clientes sin alerta (y, de
// paso, para que no se corte la notificación por chat, que va después del correo). El respaldo tiene que ser
// una salida aprobada: estos correos llevan movimientos de cuentas de clientes.
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import { medirLlamada } from './telemetria.js';

const env = (k, d = '') => process.env[k] || d;

// Arma un transporte a partir de un prefijo de variables: HB_SMTP_ (principal) o HB_SMTP2_ (respaldo).
// Devuelve null si ese servidor no está configurado.
function crear(prefijo, hostPorDefecto = '') {
  const host = env(`${prefijo}HOST`, hostPorDefecto);
  if (!host) return null;
  const prueba = host === 'mailpit';
  // La clave sale de un archivo (secreto de Docker) si se indica; si no, de la variable.
  let pass = env(`${prefijo}PASSWORD`);
  const archivo = env(`${prefijo}PASSWORD_FILE`, prefijo === 'HB_SMTP_' ? '/run/secrets/smtp_password' : '');
  if (archivo) { try { pass = readFileSync(archivo, 'utf8').trim(); } catch { /* sin clave */ } }
  const user = env(`${prefijo}USUARIO`);
  return nodemailer.createTransport({
    host, port: Number(env(`${prefijo}PORT`, prueba ? '1025' : '587')),
    secure: false, requireTLS: !prueba && env(`${prefijo}STARTTLS`, 'true') === 'true', ignoreTLS: prueba,
    ...(user ? { auth: { user, pass } } : {}),
    // Sin esto nodemailer espera hasta 2 minutos a un SMTP caído y traba al trabajador de la cola de envíos.
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  });
}

let principal, respaldo; // se crean una sola vez (undefined = todavía no se intentó)

export async function enviarCorreo({ para, asunto, html, texto, adjuntos = [] }) {
  principal ??= crear('HB_SMTP_', 'mailpit');
  if (respaldo === undefined) respaldo = crear('HB_SMTP2_');
  const mensaje = { to: para.join(', '), subject: asunto, html, text: texto, attachments: adjuntos };
  const remitente = (p) => `Home Banking VALO <${env(`${p}FROM`) || env('HB_SMTP_FROM', 'alyc@valo.ar')}>`;
  try {
    return { ...(await medirLlamada({ op: 'smtp/enviar', destino: 'principal', timeoutMs: 60_000 }, () => principal.sendMail({ ...mensaje, from: remitente('HB_SMTP_') }))), via: 'principal' };
  } catch (e) {
    if (!respaldo) throw e;
    // El principal falló: se intenta por el de respaldo. Si este también falla, el error sube como siempre.
    const r = await medirLlamada({ op: 'smtp/enviar', destino: 'respaldo', timeoutMs: 60_000 }, () => respaldo.sendMail({ ...mensaje, from: remitente('HB_SMTP2_') }));
    return { ...r, via: 'respaldo', errorPrincipal: e.message };
  }
}
