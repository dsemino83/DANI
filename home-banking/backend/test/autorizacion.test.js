// Autorización negativa: la compuerta de roles es lo primero que mira un pentester (OWASP API5).
// No necesita base ni banco; prueba el control de acceso puro con tokens armados a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.OIDC_ISSUER = 'https://sso.test/realms/staff';
process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { usuarioDesdeToken, exigirRol, exigirCrear, exigirAprobar, ROL_CREAR, ROL_APROBAR } = await import('../src/auth.js');

// Arma el payload de un token como lo emite Keycloak: roles de realm + roles del client de la app.
const token = (base = [], api = []) => ({ sub: 'u1', preferred_username: 'usuario.prueba', realm_access: { roles: base }, resource_access: { 'home-banking-api': { roles: api } } });
const reclama403 = async (fn, req) => { await assert.rejects(() => fn(req), (e) => e.status === 403 && e.codigo === 'prohibido'); };

test('rol base y permisos derivados del token', () => {
  const op = usuarioDesdeToken(token(['operador'], [ROL_CREAR]));
  assert.equal(op.rol, 'operador'); assert.equal(op.puedeCrear, true); assert.equal(op.puedeAprobar, false);
  const aut = usuarioDesdeToken(token(['autorizante'], [ROL_APROBAR]));
  assert.equal(aut.rol, 'autorizante'); assert.equal(aut.puedeAprobar, true); assert.equal(aut.puedeCrear, false);
});

test('el administrador de seguridad nunca puede operar, aunque el token traiga los roles', () => {
  // Token malicioso/mal configurado: administrador con los dos roles de transferencias.
  const adm = usuarioDesdeToken(token(['administrador'], [ROL_CREAR, ROL_APROBAR]));
  assert.equal(adm.rol, 'administrador');
  assert.equal(adm.puedeCrear, false, 'el administrador no crea transferencias');
  assert.equal(adm.puedeAprobar, false, 'el administrador no aprueba transferencias');
});

test('un token sin ningún rol conocido no es ningún perfil', () => {
  const nadie = usuarioDesdeToken(token([], []));
  assert.equal(nadie.rol, 'sin_rol');
  assert.equal(nadie.puedeCrear, false); assert.equal(nadie.puedeAprobar, false);
});

test('exigirRol: deja pasar al rol pedido y rechaza a los demás', async () => {
  await exigirRol('administrador')({ user: usuarioDesdeToken(token(['administrador'])) });           // no lanza
  await reclama403(exigirRol('administrador'), { user: usuarioDesdeToken(token(['operador'])) });
  await reclama403(exigirRol('auditor'), { user: usuarioDesdeToken(token(['operador'])) });
});

test('exigirCrear / exigirAprobar exigen el rol correspondiente', async () => {
  await exigirCrear({ user: usuarioDesdeToken(token(['operador'], [ROL_CREAR])) });                   // no lanza
  await exigirAprobar({ user: usuarioDesdeToken(token(['autorizante'], [ROL_APROBAR])) });            // no lanza
  await reclama403(exigirCrear, { user: usuarioDesdeToken(token(['operador'], [])) });                // operador sin el rol Crear
  await reclama403(exigirAprobar, { user: usuarioDesdeToken(token(['autorizante'], [])) });           // autorizante sin el rol Aprobar
  await reclama403(exigirCrear, { user: usuarioDesdeToken(token(['administrador'], [ROL_CREAR])) });  // el admin no, ni con el rol
});
