// Integración contra un Keycloak real (la corre el pipeline con el stack levantado; no es parte de npm test).
// Uso: OIDC_INTERNAL_URL=https://localhost/auth/realms/staff KEYCLOAK_ADMIN_CLIENT_SECRET_FILE=../secrets/... node test/integracion-keycloak.mjs
import assert from 'node:assert/strict';

const { crearUsuario, cambiarPerfil, cambiarRol, habilitarUsuario, restablecerClave, listarUsuarios, rolesDeTransferencias,
  estadoUsuario, forzarCambioClave, desbloquearUsuario, enviarCorreoClave, editarDatosUsuario, eliminarUsuario } = await import('../src/keycloak-admin.js');
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

let e = await estadoUsuario(nombre);
assert.equal(e.habilitado, true); assert.equal(e.bloqueado, false); assert.equal(e.email, `${nombre}@valo.test`);
paso('estado de la cuenta');

await desbloquearUsuario(nombre);
assert.equal((await estadoUsuario(nombre)).bloqueado, false);
paso('desbloquear');

await forzarCambioClave(nombre);
assert.equal((await estadoUsuario(nombre)).debeCambiarClave, true);
paso('forzar cambio de clave en el próximo ingreso');

// Correo: con MAILPIT_URL (buzón de prueba) se verifica que el correo llegó con el link de Keycloak
if (process.env.MAILPIT_URL) {
  const r = await enviarCorreoClave(nombre);
  assert.equal(r.email, `${nombre}@valo.test`);
  let msj;
  for (let i = 0; i < 20 && !msj; i++) {
    const res = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${r.email}`)}`)).json();
    msj = res.messages?.[0];
    if (!msj) await new Promise((ok) => setTimeout(ok, 500));
  }
  assert.ok(msj, 'el correo no llegó al buzón de prueba');
  const cuerpo = await (await fetch(`${process.env.MAILPIT_URL}/api/v1/message/${msj.ID}`)).json();
  assert.match(cuerpo.Text, /https:\/\/localhost\/auth\/realms\/staff\/login-actions\/action-token/);
  paso(`correo para cambiar la clave recibido (${msj.Subject})`);
}
const ed = await editarDatosUsuario(nombre, { nombre: 'Cambiado', apellido: 'Prueba', email: `nuevo.${nombre}@valo.test` });
assert.equal(ed.cambios.length, 2);
u = await buscar();
assert.equal(u.nombres, 'Cambiado'); assert.equal(u.email, `nuevo.${nombre}@valo.test`);
paso('editar nombre y email');

await eliminarUsuario(nombre);
assert.equal(await buscar(), undefined);
await assert.rejects(estadoUsuario(nombre), (e) => e.status === 400);
paso('eliminar usuario');
console.log('TODO OK');
