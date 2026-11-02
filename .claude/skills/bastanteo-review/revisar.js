#!/usr/bin/env node
// Revisión de un bastanteo (JSON 1.0): modelo GRUPO / FIRMANTE / AGRUPAMIENTO / REGLA, errores clasificados, Vista
// agrupada y, con un segundo JSON, las diferencias (con equivalencia de letras entre grupos) y, con --excel, el control
// firmante por firmante contra el resumen de poder del cliente.
//
// Uso: node revisar.js generado.json [esperado.json] [--excel resumen.xlsx]
// Salida: 0 sin diferencias · 1 con errores o diferencias · 2 uso o archivo inválido.
'use strict';
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', '..', '..', 'valo', 'motor.js'));
const X = require(path.join(__dirname, 'contraExcel.js'));

const args = process.argv.slice(2);
const iEx = args.indexOf('--excel');
const excelPath = iEx >= 0 ? args[iEx + 1] : null;
const [genPath, espPath] = args.filter((a, i) => a !== '--excel' && i !== iEx + 1 || (iEx < 0));
if (!genPath || (iEx >= 0 && !excelPath)) { console.error('Uso: node revisar.js generado.json [esperado.json] [--excel resumen.xlsx]'); process.exit(2); }

const salir = msg => { console.error(msg); process.exit(2); };
const leer = p => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return salir(`No se pudo leer ${p} como JSON: ${e.message}`); }
};
function leerExcel(p) {
  let XLSX;
  try { XLSX = require(path.join(__dirname, '..', '..', '..', 'valo', 'vendor', 'xlsx.full.min.js')); } catch (e) { return salir(`No se pudo cargar el lector de Excel: ${e.message}`); }
  let wb;
  try { wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true }); } catch (e) { return salir(`No se pudo leer ${p} como Excel: ${e.message}`); }
  const hojas = wb.SheetNames.map(n => ({ hoja: n, filas: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }) }));
  return M.leerClienteBastanteo(hojas);
}

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

// Diferencias agrupadas por tipo, en el orden de revisión, con dónde mirar primero.
function porTipo(titulo, difs) {
  console.log(`\n=== ${titulo} (${difs.length})`);
  if (!difs.length) { console.log('Sin diferencias.'); return; }
  X.ORDEN_DE_TIPOS.forEach(tipo => {
    const ds = difs.filter(d => d.tipo === tipo);
    if (!ds.length) return;
    console.log(`  ${tipo} (${ds.length}) — mirar primero: ${X.ORIGEN_POR_TIPO[tipo] || '—'}`);
    ds.forEach(d => console.log(`    ${d.nivel === 'error' ? '✗' : '·'} ${d.detalle || d}`));
  });
}

const gen = leer(genPath);
const mg = informe('Generado', gen);
let fallas = mg.errores.filter(e => e.nivel === 'error').length;

if (espPath) {
  let esp = leer(espPath);
  informe('Esperado', esp);
  const eq = X.equivalenciaDeLetras(mg, M.modeloBastanteo(esp), M);
  const cambia = Object.entries(eq.mapa).filter(([a, b]) => a !== b);
  if (eq.consistente && cambia.length) {
    console.log(`\nLas letras de los grupos no coinciden, pero son equivalentes por las personas de cada grupo: ${cambia.map(([a, b]) => `${a} del esperado = ${b} del generado`).join(', ')}. Se compara con las letras renombradas.`);
    esp = X.renombrarGrupos(esp, eq.mapa);
  } else if (!eq.consistente) console.log('\nNo hay una equivalencia clara entre las letras de los grupos: se comparan tal cual.');
  const c = M.compararBastanteos(gen, esp);
  console.log(`\n=== Diferencias (${c.diferencias.length})`);
  if (!c.diferencias.length) console.log('Equivalentes.');
  c.diferencias.forEach(x => console.log(`  ${x.tipo}: ${x.detalle}`));
  fallas += c.diferencias.length;
}

if (excelPath) {
  const cliente = leerExcel(excelPath);
  const r = X.compararConExcel(gen, cliente, M);
  const marca = e => ({ ok: 'OK ', na: 'OK ', rev: 'REV', dif: 'DIF' }[e] || e);
  console.log(`\n=== Contra el Excel: ${cliente.cliente || excelPath} (${r.firmantes.length} firmantes del resumen)`);
  if (r.firmantes.length) console.log('  Firmante | Pertenencia | Grupo | Uso de firma | Firmas conjuntas | Límite');
  r.firmantes.forEach(f => console.log(`  ${f.nombre} | ${['pertenencia', 'grupo', 'uso', 'combinaciones', 'limite'].map(p => marca(f.puntos[p].estado)).join(' | ')}`));
  const errores = r.diferencias.filter(d => d.nivel === 'error'), avisos = r.diferencias.filter(d => d.nivel !== 'error');
  porTipo('Errores contra el Excel', errores);
  if (avisos.length) porTipo('Para revisar (REV, no son errores)', avisos);
  fallas += errores.length;
}

process.exitCode = fallas ? 1 : 0;
