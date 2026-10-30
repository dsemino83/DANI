// SO · Correo (Gmail). Lógica pura y sin DOM: la usa la Edge Function so-correo (con el fetch del servidor) y las
// pruebas (con un fetch simulado). OAuth 2.0 con PKCE + state; lectura de mensajes y
// análisis de la casilla. Solo lectura: SO nunca escribe, responde ni envía correos. Los tokens no pasan por acá salvo como parámetros: se guardan en Vault desde la función.

export const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revocar: 'https://oauth2.googleapis.com/revoke',
  api: 'https://gmail.googleapis.com/gmail/v1/users/me',
};
// Solo lectura: con este permiso Google no deja crear borradores ni enviar.
export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function aleatorio(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
export async function desafioPkce(verificador) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador))));
}

export function urlAutorizacion({ clientId, redirectUri, state, desafio, email = null }) {
  const u = new URL(GOOGLE.auth);
  for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: desafio, code_challenge_method: 'S256' })) u.searchParams.set(k, v);
  if (email) u.searchParams.set('login_hint', email);
  return u.href;
}

async function pedirToken(fetch, params) {
  const r = await fetch(GOOGLE.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === 'invalid_grant' ? 'Google revocó o venció el permiso: volvé a conectar la casilla' : `Google respondió ${r.status}${j.error ? ` (${j.error})` : ''}`);
  return j;
}
export const canjearCodigo = (fetch, { code, verificador, clientId, clientSecret, redirectUri }) =>
  pedirToken(fetch, { grant_type: 'authorization_code', code, code_verifier: verificador, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
export const refrescar = (fetch, { refreshToken, clientId, clientSecret }) =>
  pedirToken(fetch, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });

async function api(fetch, token, ruta, init = {}) {
  const r = await fetch(`${GOOGLE.api}${ruta}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gmail respondió ${r.status}${j.error?.message ? `: ${String(j.error.message).slice(0, 160)}` : ''}`);
  return j;
}
export const perfil = (fetch, token) => api(fetch, token, '/profile');

// Ids de los mensajes recientes (paginado; tope para no traer casillas enteras).
export async function listarIds(fetch, token, { dias = 30, max = 300 } = {}) {
  const ids = []; let pagina = null;
  do {
    const q = new URLSearchParams({ q: `newer_than:${dias}d -in:chats`, maxResults: String(Math.min(100, max - ids.length)) });
    if (pagina) q.set('pageToken', pagina);
    const j = await api(fetch, token, `/messages?${q}`);
    ids.push(...(j.messages || []).map((m) => m.id));
    pagina = j.nextPageToken || null;
  } while (pagina && ids.length < max);
  return ids.slice(0, max);
}

const decodificar = (data) => {
  if (!data) return '';
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
const html2texto = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
function cuerpo(payload) {
  const partes = []; const recorrer = (p) => { if (!p) return; partes.push(p); (p.parts || []).forEach(recorrer); };
  recorrer(payload);
  const plano = partes.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plano) return decodificar(plano.body.data);
  const html = partes.find((p) => p.mimeType === 'text/html' && p.body?.data);
  return html ? html2texto(decodificar(html.body.data)) : '';
}
export function direccion(v) {
  const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { nombre: m[1].trim() || null, email: m[2].trim().toLowerCase() } : { nombre: null, email: String(v || '').trim().toLowerCase() };
}

// Mensaje de la API → fila de so_mails (sin owner/account: los pone la función).
export function aFila(m, miEmail) {
  const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  const de = direccion(h.from);
  const labels = m.labelIds || [];
  return {
    gmail_id: m.id, thread_id: m.threadId, from_addr: de.email.slice(0, 320), from_name: de.nombre?.slice(0, 200) || null,
    to_addrs: String(h.to || '').split(',').map((x) => direccion(x).email).filter(Boolean).slice(0, 50),
    subject: String(h.subject || '(sin asunto)').slice(0, 500), snippet: String(m.snippet || '').slice(0, 500),
    body: cuerpo(m.payload).slice(0, 20000), received_at: new Date(Number(m.internalDate) || Date.parse(h.date) || Date.now()).toISOString(),
    labels, unread: labels.includes('UNREAD'), outbound: labels.includes('SENT') || de.email === String(miEmail || '').toLowerCase(),
    has_attachments: JSON.stringify(m.payload || {}).includes('"attachmentId"'), message_id: h['message-id'] || null,
  };
}
export async function leerMensaje(fetch, token, id) { return api(fetch, token, `/messages/${encodeURIComponent(id)}?format=full`); }

export async function revocar(fetch, token) { await fetch(`${GOOGLE.revocar}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {}); }

// ---------------------------------------------------------------- análisis de la casilla (determinista)
// mails: filas de so_mails. Devuelve indicadores, series y listas para la UI generativa o un tablero.
export function analizarCorreos(mails, { hoy = new Date() } = {}) {
  const entrantes = mails.filter((m) => !m.outbound), salientes = mails.filter((m) => m.outbound);
  const porDia = new Map(), porRemitente = new Map(), porDominio = new Map();
  for (const m of entrantes) {
    const d = String(m.received_at).slice(0, 10); porDia.set(d, (porDia.get(d) || 0) + 1);
    const k = m.from_addr || 'desconocido'; const r = porRemitente.get(k) || { email: k, nombre: m.from_name, n: 0 }; r.n++; porRemitente.set(k, r);
    const dom = k.split('@')[1] || k; porDominio.set(dom, (porDominio.get(dom) || 0) + 1);
  }
  // Sin responder: hilos cuyo último mensaje es entrante (y no es de una lista/notificación automática).
  const hilos = new Map();
  for (const m of mails) { const h = hilos.get(m.thread_id) || []; h.push(m); hilos.set(m.thread_id, h); }
  const automatico = (m) => /no-?reply|notifications?|mailer-daemon|newsletter|news@|info@/i.test(m.from_addr || '') || (m.labels || []).some((l) => /CATEGORY_(PROMOTIONS|SOCIAL|UPDATES|FORUMS)/.test(l));
  const sinResponder = []; const demoras = [];
  for (const h of hilos.values()) {
    h.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
    const ult = h.at(-1);
    if (!ult.outbound && !automatico(ult)) sinResponder.push(ult);
    for (let i = 0; i < h.length - 1; i++) if (!h[i].outbound && h[i + 1].outbound) demoras.push((Date.parse(h[i + 1].received_at) - Date.parse(h[i].received_at)) / 3600000);
  }
  demoras.sort((a, b) => a - b);
  const mediana = demoras.length ? demoras[Math.floor(demoras.length / 2)] : null;
  const top = (m, n = 8) => [...m.values()].sort((a, b) => b.n - a.n).slice(0, n);
  return {
    total: mails.length, entrantes: entrantes.length, salientes: salientes.length, sinLeer: entrantes.filter((m) => m.unread).length,
    sinResponder: sinResponder.sort((a, b) => String(b.received_at).localeCompare(String(a.received_at))),
    horasMedianaRespuesta: mediana == null ? null : Math.round(mediana * 10) / 10,
    porDia: [...porDia.entries()].sort().map(([dia, n]) => ({ dia, n })),
    remitentes: top(porRemitente), dominios: [...porDominio.entries()].map(([dominio, n]) => ({ dominio, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    automaticos: entrantes.filter(automatico).length,
    desde: mails.length ? mails.map((m) => m.received_at).sort()[0] : null, hoy: hoy.toISOString(),
  };
}
