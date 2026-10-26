// Genera los scripts comunes para la página (sin tipos) desde los .mts, que son la única fuente:
// estado.mts → estado.js (VALO_BASTANTEO_ESTADO) y razonamiento.mts → razonamiento.js (VALO_BASTANTEO_RAZONAMIENTO).
// Uso: npm run build:estado   ·   node valo/bastanteo/generar-estado.mjs --check  (falla si algún .js no está al día)
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export const MODULOS = [
  { nombre: 'estado', global: 'VALO_BASTANTEO_ESTADO', exportados: ['initialState', 'transition', 'receive', 'assertNever'] },
  { nombre: 'razonamiento', global: 'VALO_BASTANTEO_RAZONAMIENTO', exportados: ['parseChatContext', 'validateChatContext', 'isDirectlyBackedByContext', 'contextFacts',
    'initialVerification', 'createReasoningItem', 'startVerification', 'applyEvidence', 'changeContext'] },
];
const fuenteDe = m => new URL(`./${m.nombre}.mts`, import.meta.url);
const destinoDe = m => new URL(`./${m.nombre}.js`, import.meta.url);

export function generar(m) {
  const js = stripTypeScriptTypes(readFileSync(fuenteDe(m), 'utf8'), { mode: 'strip' })
    .replace(/^export (?=(?:function|const|let|class) )/gm, '')
    .replace(/^export (?:type|interface) [^\n]*\n/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
  return `// GENERADO desde ${m.nombre}.mts con \`npm run build:estado\`: no editar a mano.\n`
    + '(function (root) {\n"use strict";\n' + js.trim() + '\n\nconst api = { ' + m.exportados.join(', ') + ' };\n'
    + `if (typeof module !== "undefined" && module.exports) module.exports = api;\nroot.${m.global} = api;\n`
    + '})(typeof window !== "undefined" ? window : globalThis);\n';
}
export const generarEstado = () => generar(MODULOS[0]);

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  let mal = false;
  for (const m of MODULOS) {
    const nuevo = generar(m);
    if (process.argv.includes('--check')) {
      let actual = '';
      try { actual = readFileSync(destinoDe(m), 'utf8'); } catch { /* no existe */ }
      if (actual !== nuevo) { console.error(`valo/bastanteo/${m.nombre}.js no está al día: correr npm run build:estado`); mal = true; }
    } else {
      writeFileSync(destinoDe(m), nuevo);
      console.log(`Generado valo/bastanteo/${m.nombre}.js`);
    }
  }
  if (mal) process.exit(1);
}
