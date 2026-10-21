// Llamadas al backend con el token del SSO. El navegador solo habla con /api.
import { login, token } from './auth.js';

export async function api(ruta, { method = 'GET', body, form, raw = false } = {}) {
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
