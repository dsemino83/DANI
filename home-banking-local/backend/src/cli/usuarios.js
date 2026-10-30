// Herramienta de emergencia, desde la máquina (sin entrar a la aplicación). La usan scripts/usuarios.sh y .ps1:
//   node src/cli/usuarios.js listar
//   node src/cli/usuarios.js restablecer <usuario>          clave temporal nueva + habilitado + desbloqueado
//   node src/cli/usuarios.js crear-admin <usuario> <email>  otro administrador de seguridad (si se perdió el acceso)
// Imprime la clave temporal una sola vez; el usuario la cambia en su próximo ingreso. Todo queda en la auditoría.
import { randomBytes } from 'node:crypto';
import { operativa } from '../db.js';
import { auditarSistema } from '../auditoria.js';
import { crearUsuario, hashClave, listarUsuarios } from '../usuarios.js';

const claveTemporal = () => `${randomBytes(12).toString('base64url').replace(/[-_]/g, '')}7k`;
const [, , accion, usuario, email] = process.argv;

async function principal() {
  if (accion === 'listar') {
    for (const u of await listarUsuarios()) {
      console.log(`${u.usuario.padEnd(24)} ${u.rol.padEnd(14)} ${u.habilitado ? 'habilitado' : 'DESHABILITADO'}${u.crear ? ' · crear' : ''}${u.aprobar ? ' · aprobar' : ''}`);
    }
    return;
  }
  if (accion === 'restablecer' && usuario) {
    const clave = claveTemporal();
    const r = await operativa.query(`UPDATE usuario SET clave_hash = $2, debe_cambiar_clave = 1, habilitado = 1, intentos_fallidos = 0, bloqueado_hasta = NULL,
      reset_hash = NULL, version_sesion = version_sesion + 1, actualizado_en = SYSDATETIMEOFFSET() WHERE usuario = $1`, [usuario.toLowerCase(), await hashClave(clave)]);
    if (r.rowCount !== 1) throw new Error(`El usuario ${usuario} no existe (ver: listar)`);
    await auditarSistema(null, { tipo: 'Administración', accion: 'Restableció clave desde la consola del servidor', api: 'Usuarios', detalle: `${usuario} · clave temporal · habilitado y desbloqueado` });
    console.log(`Usuario: ${usuario.toLowerCase()}\nClave temporal: ${clave}\n(la tiene que cambiar en el próximo ingreso)`);
    return;
  }
  if (accion === 'crear-admin' && usuario && email) {
    const clave = claveTemporal();
    await crearUsuario({ usuario, email, nombre: 'Administrador', apellido: 'de seguridad', perfil: 'administrador', claveTemporal: clave });
    await auditarSistema(null, { tipo: 'Administración', accion: 'Alta de administrador desde la consola del servidor', api: 'Usuarios', detalle: `${usuario} · clave temporal` });
    console.log(`Administrador creado: ${usuario.toLowerCase()}\nClave temporal: ${clave}\n(la tiene que cambiar en el primer ingreso)`);
    return;
  }
  console.log('Uso: listar | restablecer <usuario> | crear-admin <usuario> <email>');
  process.exitCode = 2;
}

try { await principal(); } catch (e) { console.error(`Error: ${e.message}`); process.exitCode = 1; } finally { await operativa.end(); }
