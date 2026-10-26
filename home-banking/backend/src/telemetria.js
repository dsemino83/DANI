// Telemetría técnica de las llamadas a sistemas externos (banco, SMTP, Power Automate, Keycloak, feriados).
// Una línea JSON por llamada, en el mismo formato que el logger del backend (pino) para que el colector/SIEM la
// tome igual: operación, duración, status/resultado, intento, timeout, estado del circuit breaker y reqId.
// NUNCA lleva secretos ni datos bancarios: ni URL completa, ni cuerpos, ni encabezados, ni mensajes de error
// (solo un tipo y un código de error), ni cuentas/CBU/CUIT/importes. Registrar no puede romper la llamada.
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { contextoTraza } from './otel.js';

// Contexto del pedido HTTP en curso (lo abre server.js): permite poner el reqId sin pasarlo por todas las funciones.
export const contextoPedido = new AsyncLocalStorage();
export const reqIdActual = () => contextoPedido.getStore()?.reqId ?? null;

const DNS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL']);
const RED = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ECONNECTION', 'UND_ERR_SOCKET']);
const TIMEOUT = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

// Distingue la causa de un fallo de "fetch failed" / nodemailer / pg: timeout | dns | red | tls | error (+ código).
export function clasificarError(e) {
  const causa = e?.cause;
  const codigo = causa?.code ?? causa?.errors?.[0]?.code ?? e?.code ?? null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || TIMEOUT.has(codigo)) return { tipo: 'timeout', codigo };
  if (DNS.has(codigo)) return { tipo: 'dns', codigo };
  if (RED.has(codigo)) return { tipo: 'red', codigo };
  if (/CERT|TLS|SSL/i.test(String(codigo ?? '')) || /certificate|tls|ssl/i.test(String(causa?.message ?? ''))) return { tipo: 'tls', codigo };
  return { tipo: 'error', codigo };
}

export function registrarLlamada(campos, nivel = 30) {
  try {
    const linea = { level: nivel, time: Date.now(), msg: 'llamada_externa', ...campos, reqId: reqIdActual() ?? undefined, ...contextoTraza() };
    process.stdout.write(`${JSON.stringify(linea)}\n`);
  } catch { /* el registro nunca rompe la operación */ }
}

// Ejecuta fn() y registra una línea con el resultado. `estado(r)` extrae el status HTTP de la respuesta (opcional).
// op/destino son etiquetas fijas (p. ej. 'accounts/getOwnAccounts', 'bdv'); no van URLs ni ids.
export async function medirLlamada({ op, destino, intento = 1, timeoutMs = null, circuito = null, ...extra }, fn, { estado = null } = {}) {
  const t0 = performance.now();
  const base = { op, destino, intento, timeout_ms: timeoutMs ?? undefined, circuito: circuito ?? undefined, ...extra };
  try {
    const r = await fn();
    const status = estado ? estado(r) : null;
    registrarLlamada({ ...base, duracion_ms: Math.round(performance.now() - t0), status: status ?? undefined,
      resultado: status != null && status >= 400 ? 'http_error' : 'ok' }, status != null && status >= 500 ? 40 : 30);
    return r;
  } catch (e) {
    const { tipo, codigo } = clasificarError(e);
    registrarLlamada({ ...base, duracion_ms: Math.round(performance.now() - t0), resultado: tipo, timeout: tipo === 'timeout', error_codigo: codigo ?? undefined }, 40);
    throw e;
  }
}
