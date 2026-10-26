#!/usr/bin/env node
// Revisión de un bastanteo (JSON 1.0): modelo GRUPO / FIRMANTE / AGRUPAMIENTO / REGLA, errores clasificados, Vista
// agrupada y, con un segundo JSON, las diferencias. Uso: node revisar.js generado.json [esperado.json]
'use strict';
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', '..', '..', 'valo', 'motor.js'));

const [genPath, espPath] = process.argv.slice(2);
if (!genPath) { console.error('Uso: node revisar.js generado.json [esperado.json]'); process.exit(2); }
const leer = p => JSON.parse(fs.readFileSync(p, 'utf8'));

function informe(titulo, json) {
  const m = M.modeloBastanteo(json);
  console.log(`\n=== ${titulo}: ${(json.empresa && json.empresa.razonSocial) || ''}`);
  console.log(`${m.grupos.length} grupos · ${m.firmantes.length} firmantes · ${m.pertenencias.length} pertenencias · ${m.agrupamientos.length} agrupamientos · ${m.participaciones.length} participaciones · ${m.reglas.length} reglas · ${m.aplicaciones.length} aplicaciones`);
  if (!m.errores.length) console.log('Sin errores del modelo.');
  m.errores.forEach(e => console.log(`  [${e.nivel}] ${e.tipo}: ${e.detalle}`));
  console.log('\nVista agrupada (GRUPO | AGRUPAMIENTO | FIRMANTES | CONDICIÓN | MONEDAS | LÍMITES | FACULTADES):');
  M.vistaAgrupada(m).forEach(f => console.log(`  ${f.grupo} | ${f.agrupamiento} | ${f.firmantes.map(a => `${a.agrupamiento}: ${a.nombres.join(', ')}`).join(' / ')} | ${f.condicion} | ${f.monedas.join(', ') || '—'} | ${f.limites.join(', ')} | ${f.facultades.length} facultades (${f.reglas.join(', ')})`));
  return m;
}

const gen = leer(genPath);
const mg = informe('Generado', gen);
let fallas = mg.errores.filter(e => e.nivel === 'error').length;
if (espPath) {
  const esp = leer(espPath);
  informe('Esperado', esp);
  const c = M.compararBastanteos(gen, esp);
  console.log(`\n=== Diferencias (${c.diferencias.length})`);
  if (!c.diferencias.length) console.log('Equivalentes.');
  c.diferencias.forEach(x => console.log(`  ${x.tipo}: ${x.detalle}`));
  fallas += c.diferencias.length;
}
process.exitCode = fallas ? 1 : 0;
