// Integración contra un Keycloak real (la corre el pipeline con el stack levantado; no es parte de npm test).
// Uso: OIDC_INTERNAL_URL=https://localhost/auth/realms/staff KEYCLOAK_ADMIN_CLIENT_SECRET_FILE=../secrets/... node test/integracion-keycloak.mjs
import assert from 'node:assert/strict';

const { crearUsuario, cambiarPerfil, cambiarRol, habilitarUsuario, restablecerClave, listarUsuarios, rolesDeTransferencias } = await import('../src/keycloak-admin.js');
const { ROL_CREAR } = await import('../src/auth.js');

const nombre = `ci.prueba${Date.now() % 100000}`;
const buscar = async () => (await listarUsuarios()).find((u) => u.usuario === nombre);
const paso = (m) => console.log('OK  ', m);

await crearUsuario({ usuario: nombre, email: `${nombre}@valo.test`, nombre: 'CI', apellido: 'Prueba', perfil: 'operador', claveTemporal: 'Temporal-2026x' });
let u = await buscar();
assert.equal(u?.rol, 'operador'); assert.equal(u.habilitado, true);
paso('alta con perfil operador');

await assert.rejects(crearUsuario({ usuario: nombre, email: `otro${nombre}@valo.test`, nombre: 'CI', apellido: 'Prueba', perfil: 'auditor', claveTemporal: 'Temporal-2026x' }), (e) => e.status === 409);
paso('usuario repetido rechazado (409)');

await cambiarRol(nombre, ROL_CREAR, true);
assert.equal((await rolesDeTransferencias(nombre)).crear, true);
paso('rol Crear asignado');

let r = await cambiarPerfil(nombre, 'autorizante');
u = await buscar();
assert.equal(u.rol, 'autorizante'); assert.deepEqual(r.antes, ['operador']); assert.equal(u.crear, true);
paso('perfil operador → autorizante (conserva Crear)');

r = await cambiarPerfil(nombre, 'administrador');
u = await buscar();
assert.equal(u.rol, 'administrador'); assert.equal(u.crear, false); assert.ok(r.quitados.includes(ROL_CREAR));
paso('pasar a administrador quita Crear/Aprobar');

await habilitarUsuario(nombre, false);
assert.equal((await buscar()).habilitado, false);
await habilitarUsuario(nombre, true);
assert.equal((await buscar()).habilitado, true);
paso('deshabilitar y volver a habilitar');

await restablecerClave(nombre, 'OtraTemporal-2026');
paso('clave temporal restablecida');
console.log('TODO OK');
