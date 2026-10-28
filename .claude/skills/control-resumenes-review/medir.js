#!/usr/bin/env node
// Mide el control de resúmenes en TODOS los Excel de una carpeta contra los poderes de Complif (el chequeo masivo) y guarda
// una fila por diferencia. Sirve para comparar antes y después de un cambio en `controlResumen`:
//   MOTOR=/ruta/a/motor_anterior.js node medir.js poderes_complif.json carpeta_con_excels antes.txt
//   node medir.js poderes_complif.json carpeta_con_excels despues.txt
//   diff <(sort antes.txt) <(sort despues.txt)
// Las filas que desaparecen son diferencias que el cambio resolvió; las que aparecen, o cambian a peor, son regresiones.
// (Datos de clientes: ni los Excel ni los documentos de Complif se guardan en el repositorio.)
'use strict';
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..', '..', '..', 'valo');
const M = require(process.env.MOTOR || path.join(raiz, 'motor.js'));
const XLSX = require(path.join(raiz, 'vendor', 'xlsx.full.min.js'));

const [docsPath, carpeta, salida] = process.argv.slice(2);
if (!docsPath || !carpeta) { console.error('Uso: [MOTOR=motor_anterior.js] node medir.js poderes_complif.json carpeta_con_excels [salida.txt]'); process.exit(2); }
const docs = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
const cont = {}, filas = [];
let conDif = 0, ok = 0, sinPoderes = 0, errores = 0;

fs.readdirSync(carpeta).filter(n => /\.xlsx?$/i.test(n) && !/^~\$/.test(n) && !/cerrad/i.test(n)).sort().forEach(nombre => {
  try {
    const wb = XLSX.read(fs.readFileSync(path.join(carpeta, nombre)), { type: 'buffer', cellDates: true });
    const cliente = M.leerClienteBastanteo(wb.SheetNames.map(n => ({ hoja: n, filas: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }) })));
    if (!cliente.firmantes.length) { errores++; return; }
    // Mismo recorrido que controlarResumen0 de valo/app.js (sin las excepciones cargadas a mano).
    const r = M.complifDeEmpresa(docs, cliente.cuit, cliente.cliente);
    const rv = M.aplicarRevocatorias(r.poderes);
    let poderes = rv.vigentes.concat(M.poderesFirmantesD(cliente, rv.vigentes, r.actas));
    if (!poderes.length && !rv.anulados.length) { const pres = M.poderDelPresidente(r.actas); if (pres && M.firmanteDe(pres.presidente, cliente.firmantes)) poderes = [pres]; }
    if (!poderes.length) { sinPoderes++; return; }
    const jsons = poderes.map(p => M.jsonPoder(p, cliente, {}));
    const sinPoder = M.firmantesSinPoder(poderes, cliente.firmantes).filter(f => !f.revocado);
    const unico = M.jsonBastanteoUnico(jsons, Object.assign({}, cliente, { sinPoder }));
    let d = 0;
    M.controlResumen(unico, cliente, r.actas, rv).forEach(c => c.puntos.filter(p => p.ok === false).forEach(p => {
      d++; cont[p.punto] = (cont[p.punto] || 0) + 1;
      filas.push([cliente.cliente || nombre, c.nombre, c.resumen, p.punto, p.resumen, p.poder, p.detalle || ''].join(' | '));
    }));
    if (d) conDif++; else ok++;
  } catch (e) { errores++; filas.push(`${nombre} | ERROR | ${e.message}`); }
});
console.log(`empresas con diferencias ${conDif} · coinciden ${ok} · sin poderes ${sinPoderes} · con error ${errores} · diferencias ${filas.length} ${JSON.stringify(cont)}`);
if (salida) fs.writeFileSync(salida, filas.join('\n') + '\n');
