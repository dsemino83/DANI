// Ingreso con usuario y clave propios del Home Banking (sin SSO). El backend valida y devuelve un token de vida corta;
// se guarda en sessionStorage (se borra al cerrar la pestaña) y se renueva solo mientras la sesión se usa.
const K = 'hb.sesion';
const RENOVAR_ANTES_MS = 5 * 60_000;

const leer = () => { try { return JSON.parse(sessionStorage.getItem(K)); } catch { return null; } };
const guardar = ({ token, minutos }) => sessionStorage.setItem(K, JSON.stringify({ token, vence: Date.now() + minutos * 60_000 - 20_000 }));
const borrar = () => sessionStorage.removeItem(K);

// Sin configuración externa: todo pasa por el mismo origen (/api).
export async function iniciar() { return {}; }

export const autenticado = () => !!leer();

async function publico(ruta, cuerpo, t) {
  const res = await fetch(`/api/auth/${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(cuerpo ?? {}),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.mensaje ?? `Error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

// Un paso del ingreso: devuelve { paso } si falta algo (cambiar_clave, otp_enrolar, otp) o guarda la sesión.
export async function ingresar(datos) {
  const r = await publico('ingresar', datos);
  if (r.token) guardar(r);
  return r;
}

// Link del correo para elegir una clave nueva.
export const restablecer = (datos) => publico('restablecer', datos);

let renovando = null;
async function renovar(t) {
  try { guardar(await publico('renovar', {}, t.token)); } catch (e) { borrar(); throw e; }
}

// Token vigente (lo renueva si está por vencer).
export async function token() {
  const t = leer();
  if (!t) throw new Error('Sin sesión');
  if (Date.now() >= t.vence) { borrar(); throw new Error('La sesión venció'); }
  if (t.vence - Date.now() < RENOVAR_ANTES_MS) {
    renovando ??= renovar(t).finally(() => { renovando = null; });
    await renovando;
  }
  return leer().token;
}

// Sin sesión válida: vuelve a la pantalla de ingreso.
export function login() {
  borrar();
  location.reload();
}

export async function cambiarMiClave(claveActual, claveNueva) {
  guardar(await publico('clave', { claveActual, claveNueva }, await token()));
}

export async function logout() {
  const t = leer();
  borrar();
  if (t) await publico('salir', {}, t.token).catch(() => {});
  location.assign('/');
}
