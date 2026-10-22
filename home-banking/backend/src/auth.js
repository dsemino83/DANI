// Validación del JWT emitido por el SSO de VALO (Keycloak, realm staff) y control de roles.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config.js';
import { noAutorizado, prohibido } from './errores.js';

const JWKS = createRemoteJWKSet(new URL(`${config.oidc.urlInterna}/protocol/openid-connect/certs`));

export const ROLES_BASE = ['administrador', 'auditor', 'autorizante', 'operador'];
export const ROL_CREAR = 'transferencias:crear';
export const ROL_APROBAR = 'transferencias:aprobar';

// Roles del usuario: realm + client de la app (Keycloak los envía en realm_access / resource_access).
export function rolesDelToken(payload) {
  const realm = payload.realm_access?.roles ?? [];
  const cliente = payload.resource_access?.[config.oidc.clienteRoles]?.roles ?? [];
  return new Set([...realm, ...cliente]);
}

export function usuarioDesdeToken(payload) {
  const roles = rolesDelToken(payload);
  const base = ROLES_BASE.find((r) => roles.has(r)) ?? 'sin_rol';
  const esAdmin = base === 'administrador';
  return {
    sub: payload.sub,
    usuario: payload.preferred_username ?? payload.sub,
    nombre: payload.name ?? payload.preferred_username,
    rol: base,
    roles,
    // El administrador de seguridad nunca opera, aunque el token traiga esos roles por error.
    puedeCrear: !esAdmin && roles.has(ROL_CREAR),
    puedeAprobar: !esAdmin && roles.has(ROL_APROBAR),
  };
}

// Hook de Fastify: exige Bearer token válido en todas las rutas /api salvo /api/health.
export async function autenticar(req) {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) throw noAutorizado();
  try {
    const { payload } = await jwtVerify(h.slice(7), JWKS, {
      issuer: config.oidc.issuer,
      audience: config.oidc.audience,
    });
    req.user = usuarioDesdeToken(payload);
  } catch {
    throw noAutorizado();
  }
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
