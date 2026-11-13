'use strict';
// Carta de cesión (Anexo I) a partir de los archivos de cesión Cuotas y Créditos. Datos inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../motor.js');

const CUOTAS = 'CUOTAS,ALTA,3,2,198,1111,30000000007,3000.50,3000.50,0,,,\n1,8,30500003193,17000001,1,2027/01/15,1000.25,1,1000.25,1000.25,0,,\n1,8,33999242109,14000001,1,2027/01/15,1500.00,1,1500.00,1500.00,0,,\n11,8,30500012516,93000001,1,2027/01/20,500.25,1,500.25,500.25,0,,\n';
const CREDITOS = 'CAP,TD,CAPADESC,INTADESC,,,,,,,,,,,,,,\nCREDITOS,ALTA,1,3,202701,2,2,198,1111,30000000007,3000.50,28.00,3000.50,0,,,,\n17000001,8,30500003193,Banco Uno,1000.25,1,0,0,1000.25,150127,150127,150127,1,1000.25,1,1000.25,1000.25,0\n';

test('cesión: lee los archivos de Cuotas y Créditos (totales, tasa, secuencia y fechas de cobro)', () => {
  const r = M.leerArchivosCesion(CUOTAS, CREDITOS);
  assert.deepEqual(r.errores, []);
  assert.equal(r.total, 3000.5);
  assert.equal(r.tasa, 28);
  assert.equal(r.secuencia, 2);
  assert.deepEqual(r.fechasPago.map(f => f.monto), [2500.25, 500.25]);
});

test('cesión: avisa si el total de la cabecera no coincide con el detalle', () => {
  const r = M.leerArchivosCesion(CUOTAS.replace('3000.50,3000.50', '9999.00,9999.00'), CREDITOS);
  assert.ok(r.errores.some(e => /no coincide con la suma del detalle/.test(e)));
});

test('cesión: la carta sigue el modelo del Anexo I, nombra los dos archivos por mail y no trae el punto f', () => {
  const r = M.leerArchivosCesion(CUOTAS, CREDITOS);
  const texto = M.textoCartaCesion(M.cartaCesion({ cedente: 'Empresa Cedente S.R.L.', alias: 'Cedente', fechaCarta: '2026-11-16', fechaPropuesta: '2026-11-10', fechaAceptacion: '2026-11-12',
    secuencia: r.secuencia, archivoCreditos: 'creditos_lote2', archivoCuotas: 'cuotas_lote2', total: r.total, tasa: r.tasa, contraprestacion: null, fechasPago: r.fechasPago }));
  assert.match(texto, /Ciudad de Buenos Aires, 16 de noviembre de 2026/);
  assert.match(texto, /Solicitud de Cesión de Créditos por Cupones N° 2/);
  assert.match(texto, /Empresa Cedente S\.R\.L\. \(“Cedente” o el “Cedente”\)|Empresa Cedente S\.R\.L\. \(“Cedente”/);
  assert.match(texto, /remitida por el Cedente al Banco en fecha 10 de noviembre del 2026, y aceptada por el Banco en fecha 12 de noviembre del 2026/);
  assert.match(texto, /archivos enviados vía mail denominados “creditos_lote2” y “cuotas_lote2”/);
  assert.match(texto, /por la suma de \$ 3\.000,50\./);
  assert.match(texto, /tasa de descuento de 28% TNA/);
  assert.match(texto, /\$ 2\.500,25 – Fecha 15 de enero del 2027/);
  assert.match(texto, /\$ 500,25 – Fecha 20 de enero del 2027/);
  assert.match(texto, /TOTAL \$ 3\.000,50/);
  assert.match(texto, /la suma de \$ \[●\] \(pesos argentinos \[●\]\)/);
  assert.ok(!/Autorizaci[oó]n/.test(texto), 'el punto f se eliminó');
});

test('cesión: con la contraprestación cargada la escribe en números y letras', () => {
  const texto = M.textoCartaCesion(M.cartaCesion({ cedente: 'X SA', fechaCarta: '2026-11-16', secuencia: 1, total: 100, tasa: 28.5, contraprestacion: 1234.5, fechasPago: [{ serial: 46372, monto: 100 }] }));
  assert.match(texto, /tasa de descuento de 28,5% TNA/);
  assert.match(texto, /la suma de \$ 1\.234,50 \(pesos argentinos mil doscientos treinta y cuatro con 50\/100\)/);
});

test('cesión: el Word (.docx) es un ZIP válido con el texto de la carta', () => {
  const parrafos = M.cartaCesion({ cedente: 'Empresa & Cía <SA>', fechaCarta: '2026-11-16', secuencia: 1, total: 100, tasa: 28, fechasPago: [{ serial: 46372, monto: 100 }] });
  const zip = M.docxSimple(parrafos);
  assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4B);
  const texto = Buffer.from(zip).toString('latin1');
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml'].forEach(n => assert.ok(texto.includes(n), n));
  assert.ok(Buffer.from(zip).toString('utf8').includes('Empresa &amp; Cía &lt;SA&gt;'), 'escapa los caracteres de XML');
  // CRC32 conocido ("123456789" = CBF43926)
  assert.equal(M.crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('cesión: los datos de un lote recién generado (generarCuotas) alimentan la carta', () => {
  const f = (y, m, d) => M.aFechaSerial(`${y}-${m}-${d}`);
  const reporte = [
    { COD_BANCO: 17, NOMBRE_BANCO: 'Banco Uno', FECHA_VENCIMIENTO: f(2027, 1, 15), MONTO: 1000.25 },
    { COD_BANCO: 17, NOMBRE_BANCO: 'Banco Uno', FECHA_VENCIMIENTO: f(2027, 1, 15), MONTO: 500 },
    { COD_BANCO: 14, NOMBRE_BANCO: 'Banco Dos', FECHA_VENCIMIENTO: f(2027, 1, 20), MONTO: 250.5 },
  ];
  const bancos = [{ codigo: 17, nombre: 'Banco Uno', cuit: '30500003193', sucursal: 1, codCredito: '17' }, { codigo: 14, nombre: 'Banco Dos', cuit: '33999242109', sucursal: 1, codCredito: '14' }];
  const params = { tipoAccion: 'Alta', secuencia: 3, lote: 3, periodo: 202701, tasa: 30, negocio: '1111', cedente: '30000000007' };
  const cuotas = M.generarCuotas(reporte, bancos, params, new Date(2026, 10, 16));
  const d = M.datosCartaDesdeLote(cuotas, params);
  assert.equal(d.total, 1750.75);
  assert.deepEqual(d.fechasPago.map(x => x.monto), [1500.25, 250.5]);
  const texto = M.textoCartaCesion(M.cartaCesion(Object.assign({ cedente: 'Empresa SA', fechaCarta: '2026-11-16', archivoCreditos: 'creditos_lote3', archivoCuotas: 'cuotas_lote3' }, d)));
  assert.match(texto, /Cupones N° 3/);
  assert.match(texto, /\$ 1\.500,25 – Fecha 15 de enero del 2027/);
  assert.match(texto, /TOTAL \$ 1\.750,75/);
  assert.match(texto, /tasa de descuento de 30% TNA/);
});

test('cesión: precio neto de impuestos replica el modelo de desembolso (TNA 29,5%, liquidación 22/10/2026)', () => {
  // Valores del modelo "VA Precio Cesión": 41 vencimientos, total 379.627.812,28.
  const vtos = [['2026-10-26', 24920379.24], ['2026-10-27', 4343142.86], ['2026-10-28', 11419467.75], ['2026-10-29', 5819725.66], ['2026-10-30', 18222496.2],
    ['2026-11-02', 5623202.62], ['2026-11-03', 3936163.65], ['2026-11-04', 11472111.15], ['2026-11-05', 5675462.95], ['2026-11-11', 36697660.72],
    ['2026-11-12', 4412091.21], ['2026-11-13', 18243475.97], ['2026-11-16', 5466585.84], ['2026-11-17', 6927776.9], ['2026-11-18', 9469866.91],
    ['2026-11-19', 5228918.89], ['2026-11-24', 15224523.81], ['2026-11-25', 4755136.74], ['2026-11-26', 6298341.83], ['2026-11-27', 6469856.77],
    ['2026-11-30', 7557422.65], ['2026-12-01', 11788212.2], ['2026-12-02', 8273566.96], ['2026-12-03', 8359925.82], ['2026-12-04', 10695173.46],
    ['2026-12-09', 19123167.81], ['2026-12-10', 6052994.53], ['2026-12-11', 7662654.32], ['2026-12-14', 7845603.35], ['2026-12-15', 10798147.62],
    ['2026-12-16', 3939760.56], ['2026-12-17', 5896064.49], ['2026-12-18', 5173365.65], ['2026-12-21', 9339733.52], ['2026-12-22', 10795556.7],
    ['2026-12-23', 6143594.53], ['2026-12-24', 6622280.56], ['2026-12-28', 9515791.97], ['2026-12-29', 3814452.28], ['2026-12-30', 3504999.27],
    ['2026-12-31', 6098956.36]].map(([fecha, monto]) => ({ fecha, monto }));
  const r = M.precioCesionNeto(vtos, { tasa: 29.5, liquidacion: '2026-10-22' });
  assert.equal(r.tea, 0.3384);
  assert.equal(r.total, 379627812.28);
  assert.equal(r.precio, 369654925.06);
  assert.equal(r.intereses, 9972887.22);
  assert.equal(r.sellos, 415261.58);
  assert.equal(r.neto, 367943188.14);
  assert.equal(M.precioCesionNeto(vtos, { tasa: null, liquidacion: '2026-10-22' }), null);
});
