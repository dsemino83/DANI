// Asignación de los roles transferencias:crear / transferencias:aprobar en el SSO (Keycloak Admin REST API)
// con una service account (client credentials) que solo tiene view-users/manage-users sobre el realm.
// También alta, perfil, habilitación, bloqueo y claves de los usuarios.
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
  if (res.status === 409) throw new ErrorHttp(409, 'conflicto', 'Ya existe un usuario con ese nombre o email en el SSO');
  if (!res.ok) throw new ErrorHttp(502, 'sso', `SSO respondió ${res.status} en ${ruta}`);
  return res.status === 204 || res.status === 201 ? null : res.json();
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
      const x = usuarios.get(u.username) ?? { usuario: u.username, nombre: [u.firstName, u.lastName].filter(Boolean).join(' '), nombres: u.firstName ?? '', apellido: u.lastName ?? '', email: u.email ?? '', habilitado: u.enabled !== false, roles: [] };
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

// ---------------- Alta y mantenimiento de usuarios (administrador de seguridad) ----------------
export const PERFILES = ['operador', 'autorizante', 'auditor', 'administrador'];

// Clave temporal: el usuario la cambia obligatoriamente en el primer ingreso (UPDATE_PASSWORD).
export function validarClaveTemporal(clave) {
  const c = String(clave ?? '');
  if (c.length < 12 || !/[A-Za-z]/.test(c) || !/\d/.test(c)) throw invalido('La clave temporal debe tener al menos 12 caracteres, con letras y números');
  return c;
}

export function validarAlta(d) {
  const usuario = String(d.usuario ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(usuario)) throw invalido('Usuario inválido: 3 a 50 caracteres, letras minúsculas, números, punto, guion o guion bajo');
  const email = String(d.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalido('Email inválido');
  const nombre = String(d.nombre ?? '').trim(), apellido = String(d.apellido ?? '').trim();
  if (!nombre || !apellido) throw invalido('Faltan nombre y apellido');
  if (!PERFILES.includes(d.perfil)) throw invalido(`Perfil inválido: ${PERFILES.join(', ')}`);
  return { usuario, email, nombre, apellido, perfil: d.perfil, claveTemporal: validarClaveTemporal(d.claveTemporal) };
}

async function idDeUsuario(t, usuario) {
  const [u] = await api(t, `/users?username=${encodeURIComponent(usuario)}&exact=true`);
  if (!u) throw invalido(`El usuario ${usuario} no existe en el SSO`);
  return u;
}

async function rolCliente(t, clientUuid, rol) {
  return api(t, `/clients/${clientUuid}/roles/${encodeURIComponent(rol)}`);
}

export async function crearUsuario(datos) {
  const d = validarAlta(datos);
  const t = await token();
  await api(t, '/users', { method: 'POST', body: JSON.stringify({
    username: d.usuario, email: d.email, firstName: d.nombre, lastName: d.apellido,
    enabled: true, emailVerified: true, requiredActions: ['UPDATE_PASSWORD'],
  }) });
  const u = await idDeUsuario(t, d.usuario);
  await api(t, `/users/${u.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: d.claveTemporal, temporary: true }) });
  const [cli] = await api(t, `/clients?clientId=${encodeURIComponent(config.oidc.clienteRoles)}`);
  await api(t, `/users/${u.id}/role-mappings/clients/${cli.id}`, { method: 'POST', body: JSON.stringify([await rolCliente(t, cli.id, d.perfil)]) });
  return { usuario: d.usuario, perfil: d.perfil };
}

// Deja un único perfil. Pasar a administrador quita Crear/Aprobar (el administrador no opera).
export async function cambiarPerfil(usuario, perfil) {
  if (!PERFILES.includes(perfil)) throw invalido(`Perfil inválido: ${PERFILES.join(', ')}`);
  const { t, userId, clientUuid } = await contexto(usuario);
  const actuales = await api(t, `/users/${userId}/role-mappings/clients/${clientUuid}`);
  const quitar = actuales.filter((r) => PERFILES.includes(r.name) && r.name !== perfil)
    .concat(perfil === 'administrador' ? actuales.filter((r) => [ROL_CREAR, ROL_APROBAR].includes(r.name)) : []);
  if (quitar.length) await api(t, `/users/${userId}/role-mappings/clients/${clientUuid}`, { method: 'DELETE', body: JSON.stringify(quitar) });
  if (!actuales.some((r) => r.name === perfil)) {
    await api(t, `/users/${userId}/role-mappings/clients/${clientUuid}`, { method: 'POST', body: JSON.stringify([await rolCliente(t, clientUuid, perfil)]) });
  }
  return { antes: actuales.filter((r) => PERFILES.includes(r.name)).map((r) => r.name), despues: perfil, quitados: quitar.map((r) => r.name) };
}

export async function habilitarUsuario(usuario, habilitado) {
  const t = await token();
  const u = await idDeUsuario(t, usuario);
  await api(t, `/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !!habilitado }) });
  if (habilitado) await api(t, `/attack-detection/brute-force/users/${u.id}`, { method: 'DELETE' }); // y sin bloqueo por intentos
  if (!habilitado) await api(t, `/users/${u.id}/logout`, { method: 'POST' }); // corta las sesiones abiertas
  return { usuario, habilitado: !!habilitado };
}

export async function restablecerClave(usuario, claveTemporal) {
  const clave = validarClaveTemporal(claveTemporal);
  const t = await token();
  const u = await idDeUsuario(t, usuario);
  await api(t, `/users/${u.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: clave, temporary: true }) });
  return { usuario };
}

// Estado de la cuenta para la ficha del usuario: habilitación, bloqueo por intentos fallidos, cambio de
// clave pendiente y si necesita OTP (TOTP) para ingresar: configurado (tiene credencial OTP) o pendiente de
// enrolar (required action CONFIGURE_TOTP). El login de Keycloak pide OTP solo si el usuario lo tiene.
export async function estadoUsuario(usuario) {
  const t = await token();
  const { id } = await idDeUsuario(t, usuario);
  const [u, bf, creds] = await Promise.all([
    api(t, `/users/${id}`),
    api(t, `/attack-detection/brute-force/users/${id}`),
    api(t, `/users/${id}/credentials`).catch(() => []),
  ]);
  const acciones = u.requiredActions ?? [];
  const otpConfigurado = (creds ?? []).some((c) => c.type === 'otp');
  const otpPendiente = acciones.includes('CONFIGURE_TOTP');
  return {
    usuario, email: u.email ?? '', habilitado: u.enabled !== false,
    bloqueado: !!bf?.disabled, intentosFallidos: bf?.numFailures ?? 0,
    debeCambiarClave: acciones.includes('UPDATE_PASSWORD'),
    requiereOtp: otpConfigurado || otpPendiente, otpConfigurado, otpPendiente,
  };
}

// El administrador define, por usuario, si necesita OTP para ingresar.
//  - Activar: agrega la required action CONFIGURE_TOTP (lo enrola en el próximo ingreso; después el login se
//    lo pide siempre, porque el usuario pasa a tener una credencial OTP).
//  - Desactivar: quita esa acción y borra sus credenciales OTP, así el login deja de pedírselo.
// En los dos casos cierra las sesiones abiertas para que el cambio tome efecto en el próximo ingreso.
export async function requerirOtp(usuario, requiere) {
  const t = await token();
  const u = await idDeUsuario(t, usuario);
  const acciones = new Set(u.requiredActions ?? []);
  if (requiere) acciones.add('CONFIGURE_TOTP'); else acciones.delete('CONFIGURE_TOTP');
  await api(t, `/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [...acciones] }) });
  if (!requiere) {
    const creds = await api(t, `/users/${u.id}/credentials`).catch(() => []);
    for (const cr of (creds ?? []).filter((c) => c.type === 'otp')) await api(t, `/users/${u.id}/credentials/${cr.id}`, { method: 'DELETE' });
  }
  await api(t, `/users/${u.id}/logout`, { method: 'POST' });
  return { usuario, requiereOtp: !!requiere };
}

// Obliga a elegir una clave nueva en el próximo ingreso (sin cambiar la actual) y cierra las sesiones abiertas.
export async function forzarCambioClave(usuario) {
  const t = await token();
  const { id } = await idDeUsuario(t, usuario);
  const u = await api(t, `/users/${id}`);
  const acciones = [...new Set([...(u.requiredActions ?? []), 'UPDATE_PASSWORD'])];
  await api(t, `/users/${id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: acciones }) });
  await api(t, `/users/${id}/logout`, { method: 'POST' });
  return { usuario };
}

// Envía al email del usuario un link (válido 24 h) para elegir una clave nueva. Requiere el correo saliente del SSO.
export async function enviarCorreoClave(usuario) {
  const t = await token();
  const { id, email } = await idDeUsuario(t, usuario);
  if (!email) throw invalido(`${usuario} no tiene email cargado en el SSO`);
  try {
    await api(t, `/users/${id}/execute-actions-email?lifespan=86400`, { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD']) });
  } catch (e) {
    if (e.status === 409) throw e;
    throw new ErrorHttp(502, 'correo', 'El SSO no pudo enviar el correo: revisar el correo saliente (SMTP) de Keycloak');
  }
  return { usuario, email };
}

// Quita el bloqueo temporal por intentos fallidos de ingreso.
export async function desbloquearUsuario(usuario) {
  const t = await token();
  const { id } = await idDeUsuario(t, usuario);
  await api(t, `/attack-detection/brute-force/users/${id}`, { method: 'DELETE' });
  return { usuario };
}

// Nombre, apellido y email (el nombre de usuario no cambia: lo usan la auditoría y los permisos).
export function validarDatos(d) {
  const nombre = String(d.nombre ?? '').trim(), apellido = String(d.apellido ?? '').trim(), email = String(d.email ?? '').trim();
  if (!nombre || !apellido) throw invalido('Faltan nombre y apellido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalido('Email inválido');
  return { nombre, apellido, email };
}

export async function editarDatosUsuario(usuario, datos) {
  const d = validarDatos(datos);
  const t = await token();
  const { id } = await idDeUsuario(t, usuario);
  const u = await api(t, `/users/${id}`);
  const cambios = [
    u.firstName !== d.nombre && `nombre: ${u.firstName ?? '—'} → ${d.nombre}`,
    u.lastName !== d.apellido && `apellido: ${u.lastName ?? '—'} → ${d.apellido}`,
    (u.email ?? '') !== d.email && `email: ${u.email ?? '—'} → ${d.email}`,
  ].filter(Boolean);
  if (cambios.length) await api(t, `/users/${id}`, { method: 'PUT', body: JSON.stringify({ firstName: d.nombre, lastName: d.apellido, email: d.email, emailVerified: true }) });
  return { usuario, cambios };
}

export async function eliminarUsuario(usuario) {
  const t = await token();
  const { id } = await idDeUsuario(t, usuario);
  await api(t, `/users/${id}`, { method: 'DELETE' });
  return { usuario };
}
