// Genera valo/bastanteo/estado.js (script común para la página, sin tipos) desde estado.mts, que es la única fuente.
// Uso: npm run build:estado   ·   node valo/bastanteo/generar-estado.mjs --check  (falla si estado.js no está al día)
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const fuente = new URL('./estado.mts', import.meta.url);
const destino = new URL('./estado.js', import.meta.url);

export function generarEstado() {
  const js = stripTypeScriptTypes(readFileSync(fuente, 'utf8'), { mode: 'strip' })
    .replace(/^export (?=(?:function|const|let|class) )/gm, '')
    .replace(/^export (?:type|interface) [^\n]*\n/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  const exportados = ['initialState', 'transition', 'receive', 'assertNever'];
  return '// GENERADO desde estado.mts con `npm run build:estado`: no editar a mano.\n'
    + '(function (root) {\n"use strict";\n' + js.trim() + '\n\nconst api = { ' + exportados.join(', ') + ' };\n'
    + 'if (typeof module !== "undefined" && module.exports) module.exports = api;\nroot.VALO_BASTANTEO_ESTADO = api;\n'
    + '})(typeof window !== "undefined" ? window : globalThis);\n';
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const nuevo = generarEstado();
  if (process.argv.includes('--check')) {
    let actual = '';
    try { actual = readFileSync(destino, 'utf8'); } catch { /* no existe */ }
    if (actual !== nuevo) { console.error('valo/bastanteo/estado.js no está al día: correr npm run build:estado'); process.exit(1); }
  } else {
    writeFileSync(destino, nuevo);
    console.log('Generado valo/bastanteo/estado.js');
  }
}
