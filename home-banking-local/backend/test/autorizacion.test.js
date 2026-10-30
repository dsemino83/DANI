// Autorización negativa: la compuerta de roles es lo primero que mira un pentester (OWASP API5).
// No necesita base ni banco; prueba el control de acceso puro con tokens armados a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { usuarioDesdeFila, exigirRol, exigirCrear, exigirAprobar, ROL_CREAR, ROL_APROBAR } = await import('../src/auth.js');

// Fila de la tabla usuario: perfil + roles Crear/Aprobar (así llega a req.user en cada pedido).
const token = (base = [], api = []) => ({ usuario: 'usuario.prueba', nombre: 'Usuario', apellido: 'Prueba', perfil: base[0] ?? null, crear: api.includes(ROL_CREAR), aprobar: api.includes(ROL_APROBAR) });
const reclama403 = async (fn, req) => { await assert.rejects(() => fn(req), (e) => e.status === 403 && e.codigo === 'prohibido'); };

test('rol base y permisos derivados del token', () => {
  const op = usuarioDesdeFila(token(['operador'], [ROL_CREAR]));
  assert.equal(op.rol, 'operador'); assert.equal(op.puedeCrear, true); assert.equal(op.puedeAprobar, false);
  const aut = usuarioDesdeFila(token(['autorizante'], [ROL_APROBAR]));
  assert.equal(aut.rol, 'autorizante'); assert.equal(aut.puedeAprobar, true); assert.equal(aut.puedeCrear, false);
});

test('el administrador de seguridad nunca puede operar, aunque el token traiga los roles', () => {
  // Token malicioso/mal configurado: administrador con los dos roles de transferencias.
  const adm = usuarioDesdeFila(token(['administrador'], [ROL_CREAR, ROL_APROBAR]));
  assert.equal(adm.rol, 'administrador');
  assert.equal(adm.puedeCrear, false, 'el administrador no crea transferencias');
  assert.equal(adm.puedeAprobar, false, 'el administrador no aprueba transferencias');
});

test('un token sin ningún rol conocido no es ningún perfil', () => {
  const nadie = usuarioDesdeFila(token([], []));
  assert.equal(nadie.rol, 'sin_rol');
  assert.equal(nadie.puedeCrear, false); assert.equal(nadie.puedeAprobar, false);
});

test('exigirRol: deja pasar al rol pedido y rechaza a los demás', async () => {
  await exigirRol('administrador')({ user: usuarioDesdeFila(token(['administrador'])) });           // no lanza
  await reclama403(exigirRol('administrador'), { user: usuarioDesdeFila(token(['operador'])) });
  await reclama403(exigirRol('auditor'), { user: usuarioDesdeFila(token(['operador'])) });
});

test('exigirCrear / exigirAprobar exigen el rol correspondiente', async () => {
  await exigirCrear({ user: usuarioDesdeFila(token(['operador'], [ROL_CREAR])) });                   // no lanza
  await exigirAprobar({ user: usuarioDesdeFila(token(['autorizante'], [ROL_APROBAR])) });            // no lanza
  await reclama403(exigirCrear, { user: usuarioDesdeFila(token(['operador'], [])) });                // operador sin el rol Crear
  await reclama403(exigirAprobar, { user: usuarioDesdeFila(token(['autorizante'], [])) });           // autorizante sin el rol Aprobar
  await reclama403(exigirCrear, { user: usuarioDesdeFila(token(['administrador'], [ROL_CREAR])) });  // el admin no, ni con el rol
});
