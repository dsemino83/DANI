// Usuarios de las pruebas de punta a punta: los da de alta en la base (ya con clave definitiva) e ingresa con cada uno
// por la API real (/api/auth/ingresar). Agrega los tokens al archivo del runner: { llaveBanco, admin, mgomez, ... }.
// Usa el mismo entorno que el servidor (DB_*, CREDENCIALES_MASTER_KEY) y PORT.
import { readFileSync, writeFileSync } from 'node:fs';
import { operativa } from '../../src/db.js';
import { hashClave } from '../../src/usuarios.js';

const ARCHIVO = process.argv[2];
const API = `http://127.0.0.1:${process.env.PORT}/api`;
const CLAVE = 'PruebaE2e-2026';

// clave en el archivo → usuario, perfil, crear, aprobar (los mismos perfiles que usaban las pruebas con el SSO)
const USUARIOS = {
  admin: ['admin.ti', 'administrador', 0, 0],
  mgomez: ['mgomez', 'operador', 1, 0],
  operadorB: ['operadorb', 'operador', 1, 0],
  lrodriguez: ['lrodriguez', 'autorizante', 0, 1],
  ambos: ['cfunes', 'autorizante', 1, 1],
  auditor: ['svillalba', 'auditor', 0, 0],
};

const hash = await hashClave(CLAVE);
const tokens = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
for (const [clave, [usuario, perfil, crear, aprobar]] of Object.entries(USUARIOS)) {
  await operativa.query(`DELETE FROM usuario WHERE usuario = $1;
    INSERT INTO usuario (usuario, nombre, apellido, email, perfil, crear, aprobar, clave_hash, debe_cambiar_clave)
    VALUES ($1, $1, N'Prueba', $2, $3, $4, $5, $6, 0)`, [usuario, `${usuario}@prueba.test`, perfil, !!crear, !!aprobar, hash]);
  const res = await fetch(`${API}/auth/ingresar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuario, clave: CLAVE }) });
  const json = await res.json();
  if (!json.token) throw new Error(`No se pudo ingresar con ${usuario}: ${JSON.stringify(json)}`);
  tokens[clave] = json.token;
}
writeFileSync(ARCHIVO, JSON.stringify(tokens));
await operativa.end();
console.log(`usuarios de prueba listos (${Object.keys(USUARIOS).length})`);
