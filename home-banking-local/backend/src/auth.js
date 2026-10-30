// Sesiones propias del Home Banking (sin SSO): el backend valida usuario y clave contra la tabla usuario y emite un
// token firmado (JWT HS256) de vida corta. En cada pedido se vuelve a leer el usuario de la base, así un usuario
// deshabilitado, eliminado o con las sesiones cerradas (version_sesion) queda afuera en el acto, y el perfil y los
// roles Crear/Aprobar son siempre los vigentes (no los del momento del ingreso).
import { hkdfSync } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { operativa } from './db.js';
import { noAutorizado, prohibido } from './errores.js';

export const ROLES_BASE = ['administrador', 'auditor', 'autorizante', 'operador'];
export const ROL_CREAR = 'transferencias:crear';
export const ROL_APROBAR = 'transferencias:aprobar';

const EMISOR = 'home-banking-valo';
const AUDIENCIA = 'home-banking-api';
// Llave de firma de los tokens, derivada de la llave maestra (no hace falta otro secreto).
const LLAVE = new Uint8Array(hkdfSync('sha256', config.llaveMaestra, Buffer.alloc(0), 'hb-sesiones-v1', 32));

export const sesion = {
  minutos: config.sesion.minutos,             // vida de cada token; el navegador lo renueva mientras se usa
  horasMaximas: config.sesion.horasMaximas,   // tope desde el ingreso: después hay que volver a ingresar
};

export async function emitirToken(usuario, version, inicio = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ ver: version, ini: inicio })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(EMISOR).setAudience(AUDIENCIA).setSubject(usuario)
    .setIssuedAt().setExpirationTime(`${sesion.minutos}m`)
    .sign(LLAVE);
}

export async function leerToken(token) {
  const { payload } = await jwtVerify(token, LLAVE, { issuer: EMISOR, audience: AUDIENCIA, algorithms: ['HS256'] });
  return payload;
}

// Usuario de la request a partir de su fila en la base.
export function usuarioDesdeFila(f) {
  const rol = ROLES_BASE.includes(f.perfil) ? f.perfil : 'sin_rol';
  const esAdmin = rol === 'administrador';
  const roles = new Set([rol, ...(f.crear ? [ROL_CREAR] : []), ...(f.aprobar ? [ROL_APROBAR] : [])]);
  return {
    sub: f.usuario,
    usuario: f.usuario,
    nombre: [f.nombre, f.apellido].filter(Boolean).join(' ') || f.usuario,
    rol,
    roles,
    // El administrador de seguridad nunca opera, aunque la fila tuviera esos roles por error.
    puedeCrear: !esAdmin && !!f.crear,
    puedeAprobar: !esAdmin && !!f.aprobar,
  };
}

// Hook de Fastify: exige Bearer token válido y un usuario habilitado con la sesión vigente.
export async function autenticar(req) {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw noAutorizado();
  let payload;
  try { payload = await leerToken(h.slice(7)); } catch { throw noAutorizado(); }
  const { rows } = await operativa.query(
    'SELECT usuario, nombre, apellido, perfil, crear, aprobar, habilitado, version_sesion, debe_cambiar_clave FROM usuario WHERE usuario = $1',
    [payload.sub]);
  const f = rows[0];
  if (!f || !f.habilitado || f.version_sesion !== payload.ver || f.debe_cambiar_clave) throw noAutorizado();
  req.user = usuarioDesdeFila(f);
  req.sesion = payload;
}

export const exigirRol = (...roles) => async (req) => {
  if (!roles.includes(req.user.rol)) throw prohibido();
};
export const exigirCrear = async (req) => {
  if (!req.user.puedeCrear) throw prohibido('Necesitás el rol “Crear transferencias”');
};
export const exigirAprobar = async (req) => {
  if (!req.user.puedeAprobar) throw prohibido('Necesitás el rol “Aprobar transferencias”');
};

// Perfiles con acceso a consultas operativas (saldos, movimientos, transferencias)
export const ROLES_OPERATIVOS = ['operador', 'autorizante', 'auditor'];
