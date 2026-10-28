// Tests del inventario desde Cadeval (cadeval.sqr). Reporte inventado: ninguna empresa ni importe corresponde a clientes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../motor.js');

const CAB = suc => `BANCO DE VALORES                                      CARTERA DE PRESTAMOS                      FECHA IMP.: 24/OCT/2026
SISTEMA DE CARTERA                                                                                         HORA IMP. :   3:14 AM
REPORTE : cadeval.sqr                                    AL: 23/OCT/2026                                   PAGINA    : 1

SUCURSAL :  ${suc}
`;
const BLOQUE = (mon, prod, nombre, filas, total) => `MONEDA   :  ${mon} ${mon === 2 ? 'DOLAR EE.UU.' : 'PESOS'}
TIPO PROD:   ${prod}    ${nombre}
______________________________
  NUM.OPER   # ENTE          CLIENTE                            MONTO       FECHA       FECHA   TASA       FECHA              SALDO
${filas.join('\n\n')}
______________________________
    TOTAL    TIPO OP                                                                                               ${total}
`;
const fila = (op, ente, cliente, orig, cap, devAcum, doc, cobro = '') =>
  ` ${op}   ${ente}  ${cliente.padEnd(30)}   ${orig}   11/08/2025  11/08/2028 10.50 ${cobro ? cobro + ' ' : '           '} ${cap}   ${devAcum}   0.00   ${devAcum}   ${doc}`;

const TEXTO = CAB('1 MATRIZ') +
  BLOQUE(2, '5020', 'PRESTAMOS A SOLA FIRMA', [
    fila('0013266720', '100', 'EMPRESA UNO SA', '1,000.00', '1,000,000.00', '2,000.00', '0.00', '11/08/2026'),
    fila('0013266732', '100', 'EMPRESA UNO SA', '500.00', '500,000.00', '1,000.00', '0.00'),
  ], '1,500,000.00   3,000.00   0.00   3,000.00   0.00') +
  CAB('1 MATRIZ').replace('PAGINA    : 1', 'PAGINA    : 2') +
  BLOQUE(80, '10051', 'COMPRA DE CARTERA', [
    fila('0020000001', '200', 'BANCO EJEMPLO SA', '10,000.00', '10,000.00', '300.00', '800.00'),
    fila('0020000002', '300', 'CENCOSUD S.A.', '20,000.00', '20,000.00', '100.00', '250.00'),
    fila('0020000003', '200', 'BANCO EJEMPLO SA', '5,000.00', '5,000.00', '50.00', '90.00'),
  ], '35,000.00   450.00   0.00   450.00   1,140.00') +
  '\n';

test('Cadeval: lee las operaciones (con y sin fecha de último cobro) y controla contra el TOTAL TIPO OP', () => {
  const r = M.leerCadeval(TEXTO, 'cadeval_x.lis');
  assert.equal(r.fecha, '2026-10-23');
  assert.equal(r.filas.length, 5);
  assert.deepEqual(r.sinLeer, []);
  assert.deepEqual(r.filas.map(f => [f.sucursal, f.moneda, f.producto, f.ente]), [[1, 2, '5020', '100'], [1, 2, '5020', '100'], [1, 80, '10051', '200'], [1, 80, '10051', '300'], [1, 80, '10051', '200']]);
  assert.equal(r.filas[0].fechaUltCobro, '2026-08-11');
  assert.equal(r.filas[1].fechaUltCobro, '');
  assert.equal(r.filas[0].saldoCapital, 1000000);
  assert.equal(r.filas[2].interesesDocumentados, 800);
  assert.ok(r.controles.length === 2 && r.controles.every(c => c.ok), JSON.stringify(r.controles));
  // Si falta una hoja, el control no coincide.
  const incompleto = M.leerCadeval(TEXTO.replace(/ 0020000003[^\n]*\n/, ''), 'x');
  assert.equal(incompleto.controles.find(c => c.producto === '10051').ok, false);
});

test('Cadeval: el encabezado repetido en cada página no duplica el control del producto', () => {
  const dos = TEXTO.replace(fila('0020000003', '200', 'BANCO EJEMPLO SA', '5,000.00', '5,000.00', '50.00', '90.00'),
    CAB('1 MATRIZ') + 'MONEDA   :  80 PESOS\nTIPO PROD:   10051    COMPRA DE CARTERA\n' + fila('0020000003', '200', 'BANCO EJEMPLO SA', '5,000.00', '5,000.00', '50.00', '90.00'));
  const r = M.leerCadeval(dos, 'x');
  assert.equal(r.controles.filter(c => c.producto === '10051').length, 1);
  assert.equal(r.filas.length, 5);
});

test('Cadeval: inventarios por cuenta (capital, documentados negativos, dólares con el TC, entidades financieras y no)', () => {
  const r = M.leerCadeval(TEXTO, 'x');
  const inv = M.armarInventariosContables([], {}, { '200': { cuit: '30500000001' } }, [], { cadeval: r.filas, tc: 1000 });
  const de = cuenta => inv.find(i => i.def.cuenta === cuenta);
  // Dólares: saldo en pesos / TC.
  const cap = de('135.715.011.02');
  assert.equal(cap.def.moneda, 'USD');
  assert.deepEqual(cap.filas.map(f => [f.ente, f.pesos, f.importe]), [['100', 1500000, 1500]]);
  const intUsd = de('135.805.011.02');
  assert.equal(intUsd.total, 3);   // devengado acumulado 3.000 pesos / 1.000
  // Compra de cartera: entidades financieras (banco) y no financieras (Cencosud), por separado.
  const fin = de('131.421.014.4'), noFin = de('131.721.040.5');
  assert.deepEqual(fin.filas.map(f => [f.ente, f.importe, f.cuit]), [['200', 15000, '30500000001']]);
  assert.deepEqual(noFin.filas.map(f => [f.ente, f.importe, f.faltaCuit]), [['300', 20000, true]]);
  // Intereses documentados: -intereses documentados + devengado acumulado.
  assert.equal(de('131.491.014.7').total, -(800 + 90) + (300 + 50));
  assert.equal(de('131.791.040.8').total, -250 + 100);
  // Sin operaciones de un producto: la cuenta queda vacía (no disponible).
  assert.equal(de('131.718.041.0').operaciones, 0);
  // Cada cuenta del Excel está una sola vez.
  assert.equal(new Set(M.CADEVAL_CUENTAS.map(c => c.cuenta)).size, M.CADEVAL_CUENTAS.length);
  // Sin TC, las cuentas en dólares quedan marcadas.
  const sinTc = M.armarInventariosContables([], {}, {}, [], { cadeval: r.filas });
  assert.equal(sinTc.find(i => i.def.cuenta === '135.715.011.02').faltaTc, true);
});

test('Cadeval: se puede marcar a mano qué ente no es entidad financiera', () => {
  const r = M.leerCadeval(TEXTO, 'x');
  const inv = marcas => M.armarInventariosContables([], {}, {}, [], { cadeval: r.filas, tc: 1000, noFinancieras: marcas }).find(i => i.def.cuenta === '131.721.040.5').filas.map(f => f.ente);
  assert.deepEqual(inv({}), ['300']);                    // por nombre: Cencosud
  assert.deepEqual(inv({ 300: false, 200: true }), ['200']);   // por ente, manda la marca
});
