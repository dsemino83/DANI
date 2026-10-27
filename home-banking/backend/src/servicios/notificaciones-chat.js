// Notificación de las ALERTAS de movimientos por chat de Teams, vía un flujo de Power Automate (HTTP).
// Se llama DESPUÉS del correo al cliente, una vez por tarea, solo para las alertas (no el extracto diario).
// Los oficiales de la cartera del cliente que tengan activado el chat (tabla oficial_chat) reciben el mismo
// contenido que el correo. El destinatario de Teams se arma con el usuario: si no contiene "@valo" se le
// agrega el dominio (HB_CHAT_DOMINIO, por defecto @valo.ar).
import { medirLlamada } from '../telemetria.js';
import { operativa } from '../db.js';
import { config } from './../config.js';

// Usuario -> UPN de Teams. Los usuarios del sistema no tienen "@" (se valida en el alta), así que en la
// práctica siempre se agrega el dominio; si alguno ya trae "@valo", se respeta.
export function destinatarioChat(usuario) {
  const u = String(usuario ?? '').trim();
  return u.toLowerCase().includes('@valo') ? u : `${u}${config.chatDominio}`;
}

async function postFlow(payload) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await medirLlamada({ op: 'powerautomate/alerta', destino: 'powerautomate', timeoutMs: 10_000 }, () => fetch(config.powerAutomateUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal,
    }), { estado: (x) => x.status });
    if (!r.ok) throw new Error(`Power Automate respondió ${r.status}`);
    return true;
  } finally { clearTimeout(t); }
}

// Envía la alerta por chat a los oficiales de la cartera del cliente que lo tengan activado.
// Devuelve un resumen para el detalle de la tarea; nunca lanza (el correo al cliente ya salió).
export async function notificarChatAlerta(empresa, correo) {
  if (!config.powerAutomateUrl) return { estado: 'sin_configurar' };
  let oficiales;
  try {
    oficiales = (await operativa.query(
      `SELECT co.oficial FROM cartera_oficial co JOIN oficial_chat oc ON oc.oficial = co.oficial AND oc.notificar = 1
        WHERE co.empresa_id = $1 ORDER BY co.oficial`, [empresa.id])).rows.map((r) => r.oficial);
  } catch (e) { return { estado: 'error', detalle: `consulta oficiales: ${e.message}` }; }
  if (!oficiales.length) return { estado: 'sin_destinatarios' };
  const destinatarios = oficiales.map(destinatarioChat);
  const payload = {
    cliente: empresa.razon_social, cuit: empresa.cuit, asunto: correo.asunto,
    titulo: correo.titulo ?? correo.asunto, html: correo.html, texto: correo.texto, destinatarios,
  };
  try {
    await postFlow(payload);
    return { estado: 'enviado', destinatarios };
  } catch (e) {
    return { estado: 'error', detalle: e.message, destinatarios };
  }
}
