// Asignación de los roles transferencias:crear / transferencias:aprobar en el SSO (Keycloak Admin REST API)
// con una service account (client credentials) que solo tiene manage-users sobre el realm.
import { config } from './config.js';
import { ErrorHttp, invalido } from './errores.js';
import { ROL_APROBAR, ROL_CREAR } from './auth.js';

const [base, realm] = (() => {
  const m = config.oidc.urlInterna.match(/^(.*)\/realms\/([^/]+)$/);
  return m ? [m[1], m[2]] : [null, null];
})();

async function token() {
  if (!config.oidc.adminClientId) throw new ErrorHttp(501, 'sin_configurar', 'Falta la service account de Keycloak para administrar roles');
  const res = await fetch(`${config.oidc.urlInterna}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.oidc.adminClientId, client_secret: config.oidc.adminClientSecret }),
  });
  if (!res.ok) throw new ErrorHttp(502, 'sso', 'No se pudo obtener token de administración del SSO');
  return (await res.json()).access_token;
}

async function api(t, ruta, opciones = {}) {
  const res = await fetch(`${base}/admin/realms/${realm}${ruta}`, {
    ...opciones, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });
  if (!res.ok) throw new ErrorHttp(502, 'sso', `SSO respondió ${res.status} en ${ruta}`);
  return res.status === 204 ? null : res.json();
}

async function contexto(usuario) {
  const t = await token();
  const [u] = await api(t, `/users?username=${encodeURIComponent(usuario)}&exact=true`);
  if (!u) throw invalido(`El usuario ${usuario} no existe en el SSO`);
  const [cli] = await api(t, `/clients?clientId=${encodeURIComponent(config.oidc.clienteRoles)}`);
  return { t, userId: u.id, clientUuid: cli.id };
}

export async function rolesDeTransferencias(usuario) {
  const { t, userId, clientUuid } = await contexto(usuario);
  const roles = (await api(t, `/users/${userId}/role-mappings/clients/${clientUuid}`)).map((r) => r.name);
  const base = (await api(t, `/users/${userId}/role-mappings/realm`)).map((r) => r.name);
  return { crear: roles.includes(ROL_CREAR), aprobar: roles.includes(ROL_APROBAR), administrador: base.includes('administrador') || roles.includes('administrador') };
}

export async function cambiarRol(usuario, rol, asignar) {
  const { t, userId, clientUuid } = await contexto(usuario);
  const rep = await api(t, `/clients/${clientUuid}/roles/${encodeURIComponent(rol)}`);
  await api(t, `/users/${userId}/role-mappings/clients/${clientUuid}`, { method: asignar ? 'POST' : 'DELETE', body: JSON.stringify([rep]) });
}

// Usuarios con algún rol de la app y sus roles (para la pestaña Permisos)
const ROLES_APP = ['operador', 'autorizante', 'auditor', 'administrador', ROL_CREAR, ROL_APROBAR];
export async function listarUsuarios() {
  const t = await token();
  const [cli] = await api(t, `/clients?clientId=${encodeURIComponent(config.oidc.clienteRoles)}`);
  const usuarios = new Map();
  for (const rol of ROLES_APP) {
    const lista = await api(t, `/clients/${cli.id}/roles/${encodeURIComponent(rol)}/users?max=1000`);
    for (const u of lista) {
      const x = usuarios.get(u.username) ?? { usuario: u.username, nombre: [u.firstName, u.lastName].filter(Boolean).join(' '), roles: [] };
      x.roles.push(rol);
      usuarios.set(u.username, x);
    }
  }
  return [...usuarios.values()].map((u) => ({
    ...u,
    rol: ['administrador', 'auditor', 'autorizante', 'operador'].find((r) => u.roles.includes(r)) ?? 'sin_rol',
    crear: u.roles.includes(ROL_CREAR), aprobar: u.roles.includes(ROL_APROBAR),
  })).sort((a, b) => a.usuario.localeCompare(b.usuario));
}
