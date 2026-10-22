// Llamadas al backend con el token del SSO. El navegador solo habla con /api.
import { login, token } from './auth.js';

// Consultas al banco (cuentas, saldos, movimientos, débitos): se piden una vez por sesión y después se usan
// los datos guardados, para no consultar al banco en cada pantalla. "Actualizar datos" los vuelve a pedir.
const AL_BANCO = [/^\/cuentas(\/|\?|$)/, /^\/debitos(\?|$)/];
const guardadas = new Map();
let datosDesde = null;
const avisos = new Set();
export const horaDatos = () => datosDesde;
export const alCambiarDatos = (fn) => avisos.add(fn);
export function actualizarDatos() { guardadas.clear(); datosDesde = null; avisos.forEach((fn) => fn(null)); }

export async function api(ruta, opciones = {}) {
  const { method = 'GET', raw = false } = opciones;
  if (method !== 'GET' || raw || !AL_BANCO.some((r) => r.test(ruta))) return pedir(ruta, opciones);
  if (opciones.fresco) guardadas.delete(ruta); // "consultar nuevamente": ignora lo guardado de esa consulta
  if (!guardadas.has(ruta)) {
    // se guarda la promesa: si dos pantallas piden lo mismo a la vez, va una sola consulta
    guardadas.set(ruta, pedir(ruta, opciones).then((r) => {
      if (!datosDesde) { datosDesde = new Date(); avisos.forEach((fn) => fn(datosDesde)); }
      return r;
    }).catch((e) => { guardadas.delete(ruta); throw e; }));
  }
  return structuredClone(await guardadas.get(ruta)); // copia: una pantalla no altera los datos de otra
}

async function pedir(ruta, { method = 'GET', body, form, raw = false } = {}) {
  const t = await token().catch(() => { login(); throw new Error('Sesión vencida'); });
  const res = await fetch(`/api${ruta}`, {
    method,
    headers: { authorization: `Bearer ${t}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) { login(); throw new Error('Sesión vencida'); }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.mensaje ?? `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export async function descargar(ruta, nombre) {
  const res = await api(ruta, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
