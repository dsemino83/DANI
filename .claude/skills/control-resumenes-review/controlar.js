#!/usr/bin/env node
// Control de un resumen de poder (Excel del cliente) contra los poderes de Complif, igual que el chequeo masivo de VALO.
// Uso: node controlar.js poderes_complif.json resumen.xlsx [--ignorar-revocatorias]
//   poderes_complif.json: lista de documentos de Complif (Poder, Poder Complejo, Acta de designación, Estatuto), tal como los
//   baja la página (/api/documents/v1/organization). No se guardan en el repositorio: traen datos de clientes.
'use strict';
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', '..', '..', 'valo');
const M = require(path.join(raiz, 'motor.js'));
const XLSX = require(path.join(raiz, 'vendor', 'xlsx.full.min.js'));

const sinRevocatorias = process.argv.includes('--ignorar-revocatorias');
const [docsPath, xlsPath] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!docsPath || !xlsPath) { console.error('Uso: node controlar.js poderes_complif.json resumen.xlsx [--ignorar-revocatorias]'); process.exit(2); }
const docs = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
const wb = XLSX.read(fs.readFileSync(xlsPath), { type: 'buffer', cellDates: true });
const hojas = wb.SheetNames.map(n => ({ hoja: n, filas: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }) }));
const cliente = M.leerClienteBastanteo(hojas);

console.log(`Empresa: ${cliente.cliente || '—'} · CUIT ${cliente.cuit || '—'} · ${cliente.firmantes.length} firmantes en el resumen`);
if (!cliente.firmantes.length) { console.log('El Excel no tiene firmantes (no se encontró la tabla).'); process.exit(1); }

// Mismo recorrido que controlarResumen0 de valo/app.js.
const r = M.complifDeEmpresa(docs, cliente.cuit, cliente.cliente);
// --ignorar-revocatorias: igual que la excepción de la página (Complif marcó como revocatorio un poder que no lo es).
const rv = M.aplicarRevocatorias(r.poderes, { ignorar: sinRevocatorias ? r.poderes.map(M.claveRevocatoria) : [] });
console.log(`Complif: ${r.poderes.length} poderes y ${r.actas.length} actas; vigentes ${rv.vigentes.length}, anulados ${rv.anulados.length}` +
  (rv.anulados.length ? ` (${rv.anulados.map(a => a.motivo).join(' · ')})` : ''));
let poderes = rv.vigentes.concat(M.poderesFirmantesD(cliente, rv.vigentes, r.actas));
if (!poderes.length && !rv.anulados.length) { const pres = M.poderDelPresidente(r.actas); if (pres && M.firmanteDe(pres.presidente, cliente.firmantes)) poderes = [pres]; }
if (!poderes.length) { console.log('Sin poderes: nada para controlar.'); process.exit(1); }
const jsons = poderes.map(p => M.jsonPoder(p, cliente, {}));
const sinPoder = M.firmantesSinPoder(poderes, cliente.firmantes).filter(f => !f.revocado);
const unico = M.jsonBastanteoUnico(jsons, Object.assign({}, cliente, { sinPoder }));
const control = M.controlResumen(unico, cliente, r.actas, rv);

const marca = ok => (ok === true ? 'OK ' : ok === false ? 'DIF' : 'REV');
let dif = 0, rev = 0;
control.forEach(c => {
  console.log(`\n${c.nombre} (${c.ident || 'sin identificación'}) · resumen: ${c.resumen || '—'}`);
  c.puntos.forEach(p => {
    if (p.ok === false) dif++; else if (p.ok === null) rev++;
    console.log(`  [${marca(p.ok)}] ${p.punto}: resumen "${p.resumen}" · poder "${p.poder}"${p.detalle ? ' — ' + p.detalle : ''}`);
  });
});
const noIncluidos = [...new Set(poderes.flatMap(p => p.apoderados).filter(a => !M.firmanteDe(a, cliente.firmantes)).map(a => a.nombre_completo))];
if (sinPoder.length) console.log(`\nEn el resumen y sin poder: ${sinPoder.map(f => f.nombre).join(', ')}`);
if (noIncluidos.length) console.log(`En los poderes y no en el resumen: ${noIncluidos.join(', ')}`);
console.log(`\nResultado: ${dif ? 'CON DIFERENCIAS' : 'OK'} · ${dif} diferencias · ${rev} puntos para revisar`);
process.exitCode = dif ? 1 : 0;
