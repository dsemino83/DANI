// Tests del control del bastanteo contra el Excel del cliente (skill bastanteo-review: contraExcel.js). Datos inventados:
// ningún nombre ni CUIT corresponde a clientes. Correr con: node --test valo/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../motor.js');
const { compararConExcel, equivalenciaDeLetras, renombrarGrupos } = require('../../.claude/skills/bastanteo-review/contraExcel.js');

// ---------------------------------------------------------------- datos de prueba
const CUIT = n => `20${String(n).padStart(8, '0')}1`;
const fmt = c => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
const ap = (n, grupos) => ({ cuitCuil: fmt(CUIT(n)), nombre: `Nombre${n}`, apellido: `APELLIDO${n}`, estado: 'Activa', grupos });
let seq = 0;
const regla = (tipo, quorum, grupos, extra = {}) => Object.assign({ referencia: `R${++seq}`, tipo, quorum, grupos, circuitos: ['ECHEQ_FIRMAR'], moneda: null, monto: null, descripcion: '' }, extra);
const indiv = (n, grupo, extra = {}) => regla('Individual', 1, [grupo], Object.assign({ firmantes: [fmt(CUIT(n))] }, extra));
const json = (apoderados, reglasFirma, empresa = {}) => ({ version: '1.0', empresa: Object.assign({ cuit: '30-00000000-7', razonSocial: 'EMPRESA DE PRUEBA SA', estado: 'Activa' }, empresa), apoderados, reglasFirma });
// Excel del cliente: filas [CUIT, nombre, observación, monto hasta]; las marcas "X" van antes de la tabla.
function excel(firmantes, { cuit = '30000000007', cliente = 'EMPRESA DE PRUEBA SA', marcas = [] } = {}) {
  const filas = [['CLIENTE', cliente], ['CUIT', cuit], ...marcas.map(m => [m, 'X']), [],
    ['Cuit', 'Nombre y Apellido firmante', 'Observaciones', 'Monto hasta'],
    ...firmantes.map(([n, obs, extra]) => [CUIT(n), `APELLIDO${n} Nombre${n}`, obs, extra == null ? '' : extra])];
  return M.leerClienteBastanteo([{ hoja: 'Resumen', filas }]);
}
const base = () => json([ap(1, ['A']), ap(2, ['A']), ap(3, ['B'])], [regla('ConjuntaIndistinta', 2, ['A']), regla('Conjunta', 1, ['A', 'B'])]);
const baseExcel = () => excel([[1, 'A CONJUNTA A+A; A+B'], [2, 'A CONJUNTA A+A; A+B'], [3, 'B CONJUNTA A+B']]);
const errores = (r, tipo) => r.diferencias.filter(d => d.nivel === 'error' && (!tipo || d.tipo === tipo));
const avisos = r => r.diferencias.filter(d => d.nivel === 'aviso');
const punto = (r, n, p) => r.firmantes.find(f => f.id.replace(/\D/g, '') === CUIT(n)).puntos[p].estado;

// ---------------------------------------------------------------- coincidencia
test('contra el Excel: si el bastanteo coincide con el resumen no hay diferencias y todos los puntos dan OK', () => {
  const r = compararConExcel(base(), baseExcel(), M);
  assert.deepEqual(errores(r), []);
  [1, 2, 3].forEach(n => ['grupo', 'uso', 'combinaciones', 'limite'].forEach(p => assert.equal(punto(r, n, p), 'ok', `${n}/${p}`)));
});

// ---------------------------------------------------------------- pertenencia
test('contra el Excel: un firmante del resumen que no está en el bastanteo es ERROR DE PERTENENCIA', () => {
  const r = compararConExcel(base(), excel([[1, 'A CONJUNTA A+A; A+B'], [4, 'A CONJUNTA A+A']]), M);
  const e = errores(r, 'ERROR DE PERTENENCIA');
  assert.equal(e.length, 1);
  assert.match(e[0].detalle, /APELLIDO4/);
  assert.match(e[0].detalle, /no está en el bastanteo/);
});

test('contra el Excel: un apoderado del bastanteo que no está en el resumen es solo un aviso', () => {
  const r = compararConExcel(base(), excel([[1, 'A CONJUNTA A+A; A+B'], [2, 'A CONJUNTA A+A; A+B']]), M);
  assert.deepEqual(errores(r), []);
  assert.ok(avisos(r).some(a => /APELLIDO3/.test(a.detalle) && /no está en el resumen/.test(a.detalle)));
});

test('contra el Excel: un firmante revocado en el resumen que el bastanteo incluye es ERROR DE PERTENENCIA', () => {
  const x = baseExcel();
  x.firmantes.find(f => f.cuit === CUIT(2)).revocado = true;
  const r = compararConExcel(base(), x, M);
  assert.ok(errores(r, 'ERROR DE PERTENENCIA').some(e => /APELLIDO2/.test(e.detalle) && /revocado/.test(e.detalle)));
});

test('contra el Excel: el firmante se reconoce por CUIT, por DNI (posiciones 3 a 10 del CUIT) y por el nombre', () => {
  const x = baseExcel();
  x.firmantes[0] = Object.assign({}, x.firmantes[0], { cuit: '', dni: x.firmantes[0].dni }); // solo DNI
  x.firmantes[1] = Object.assign({}, x.firmantes[1], { cuit: '', dni: '' });                  // solo nombre
  x.firmantes[1].nombre = 'Nombre2 APELLIDO2';                                                // en otro orden
  const r = compararConExcel(base(), x, M);
  assert.deepEqual(errores(r, 'ERROR DE PERTENENCIA'), []);
});

// ---------------------------------------------------------------- grupo y equivalencia de letras
test('contra el Excel: el grupo del resumen que no coincide con el del bastanteo es ERROR DE PERTENENCIA', () => {
  const r = compararConExcel(base(), excel([[1, 'A CONJUNTA A+A; A+B'], [2, 'A CONJUNTA A+A; A+B'], [3, 'A CONJUNTA A+A; A+B']]), M);
  assert.ok(errores(r, 'ERROR DE PERTENENCIA').some(e => /APELLIDO3/.test(e.detalle)));
  assert.equal(punto(r, 3, 'grupo'), 'dif');
});

test('contra el Excel: letras distintas pero equivalentes (A y B intercambiadas en todos) no son error, se avisa la equivalencia', () => {
  const x = excel([[1, 'B CONJUNTA B+B; A+B'], [2, 'B CONJUNTA B+B; A+B'], [3, 'A CONJUNTA A+B']]);
  const r = compararConExcel(base(), x, M);
  assert.deepEqual(errores(r), []);
  assert.ok(avisos(r).some(a => /equivalen/i.test(a.detalle) && /B/.test(a.detalle)));
  assert.deepEqual(r.equivalenciaLetras, { B: 'A', A: 'B' });
});

// ---------------------------------------------------------------- firmas conjuntas
test('contra el Excel: una combinación del resumen que el bastanteo no da es ERROR DE AGRUPAMIENTO', () => {
  const r = compararConExcel(base(), excel([[1, 'A CONJUNTA A+A; A+B; A+C'], [2, 'A CONJUNTA A+A; A+B'], [3, 'B CONJUNTA A+B']]), M);
  const e = errores(r, 'ERROR DE AGRUPAMIENTO');
  assert.equal(e.length, 1);
  assert.match(e[0].detalle, /A\+C/);
  assert.equal(punto(r, 1, 'combinaciones'), 'dif');
});

test('contra el Excel: si el bastanteo da más combinaciones que el resumen es REV (aviso), no error', () => {
  const r = compararConExcel(base(), excel([[1, 'A CONJUNTA A+A'], [2, 'A CONJUNTA A+A; A+B'], [3, 'B CONJUNTA A+B']]), M);
  assert.deepEqual(errores(r), []);
  assert.equal(punto(r, 1, 'combinaciones'), 'rev');
  assert.ok(avisos(r).some(a => /APELLIDO1/.test(a.detalle) && /A\+B/.test(a.detalle)));
});

test('contra el Excel: las combinaciones mínimas siguen la regla (ConjuntaIndistinta A,B de 2 firmas = A+A, A+B, B+B)', () => {
  const j = json([ap(1, ['A']), ap(2, ['A']), ap(3, ['B']), ap(4, ['B'])], [regla('ConjuntaIndistinta', 2, ['A', 'B'])]);
  const r = compararConExcel(j, excel([[1, 'A CONJUNTA A+A; A+B'], [3, 'B CONJUNTA A+B; B+B']]), M);
  assert.deepEqual(errores(r, 'ERROR DE AGRUPAMIENTO'), []);
});

// ---------------------------------------------------------------- uso de firma
test('contra el Excel: el resumen da firma individual y el bastanteo no es ERROR DE REGLA', () => {
  const r = compararConExcel(base(), excel([[1, 'A INDIVIDUAL'], [2, 'A CONJUNTA A+A; A+B'], [3, 'B CONJUNTA A+B']]), M);
  assert.ok(errores(r, 'ERROR DE REGLA').some(e => /APELLIDO1/.test(e.detalle) && /individual/i.test(e.detalle)));
  assert.equal(punto(r, 1, 'uso'), 'dif');
});

test('contra el Excel: si el bastanteo da individual y el resumen solo conjunta, es REV (el resumen es más restrictivo)', () => {
  const j = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A']), indiv(1, 'A')]);
  const r = compararConExcel(j, excel([[1, 'A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]), M);
  assert.deepEqual(errores(r), []);
  assert.equal(punto(r, 1, 'uso'), 'rev');
});

// ---------------------------------------------------------------- límite (solo firma individual)
test('contra el Excel: el límite individual del resumen coincide con el tope del bastanteo', () => {
  const j = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A']), indiv(1, 'A', { moneda: 'ARS', monto: 2000000 })]);
  const r = compararConExcel(j, excel([[1, 'A INDIVIDUAL H/ $2.000.000 * A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]), M);
  assert.deepEqual(errores(r), []);
  assert.equal(punto(r, 1, 'limite'), 'ok');
});

test('contra el Excel: un límite distinto, o un bastanteo sin tope cuando el resumen tiene límite, es ERROR DE REGLA', () => {
  const conTope = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A']), indiv(1, 'A', { moneda: 'ARS', monto: 5000000 })]);
  const sinTope = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A']), indiv(1, 'A')]);
  const x = excel([[1, 'A INDIVIDUAL H/ $2.000.000 * A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]);
  [conTope, sinTope].forEach(j => {
    const r = compararConExcel(j, x, M);
    assert.ok(errores(r, 'ERROR DE REGLA').some(e => /límite|tope/i.test(e.detalle)), JSON.stringify(r.diferencias));
    assert.equal(punto(r, 1, 'limite'), 'dif');
  });
});

test('contra el Excel: el límite en dólares del resumen se compara con la moneda del bastanteo', () => {
  const j = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A']), indiv(1, 'A', { moneda: 'ARS', monto: 50000 })]);
  const r = compararConExcel(j, excel([[1, 'A INDIVIDUAL HASTA USD 50.000 * A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]), M);
  assert.equal(punto(r, 1, 'limite'), 'dif');
});

test('contra el Excel: un resumen sin límite con un bastanteo con tope es REV, salvo que diga "sin límite"', () => {
  const j = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A']), indiv(1, 'A', { moneda: 'ARS', monto: 2000000 })]);
  const callado = compararConExcel(j, excel([[1, 'A INDIVIDUAL * A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]), M);
  assert.deepEqual(errores(callado), []);
  assert.equal(punto(callado, 1, 'limite'), 'rev');
  const explicito = compararConExcel(j, excel([[1, 'A INDIVIDUAL SIN LÍMITE * A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]), M);
  assert.equal(punto(explicito, 1, 'limite'), 'dif');
});

// ---------------------------------------------------------------- facultades marcadas y datos de la empresa
test('contra el Excel: una facultad marcada con "X" que ninguna regla da es ERROR DE REGLA; si alguna la da, está bien', () => {
  const x = excel([[1, 'A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']], { marcas: ['LIBRAR CHEQUES'] });
  const da = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A'])]);
  const noDa = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A'], { circuitos: ['CA_ABRIR'] })]);
  assert.deepEqual(errores(compararConExcel(da, x, M)), []);
  assert.ok(errores(compararConExcel(noDa, x, M), 'ERROR DE REGLA').some(e => /firmar_cheques|librar cheques/i.test(e.detalle)));
});

test('contra el Excel: sin marcas "X" no se controlan las facultades', () => {
  const j = json([ap(1, ['A']), ap(2, ['A'])], [regla('ConjuntaIndistinta', 2, ['A'], { circuitos: ['CA_ABRIR'] })]);
  assert.deepEqual(errores(compararConExcel(j, excel([[1, 'A CONJUNTA A+A'], [2, 'A CONJUNTA A+A']]), M)), []);
});

test('contra el Excel: el CUIT de la empresa del resumen distinto al del bastanteo es un aviso (no un error del modelo)', () => {
  const r = compararConExcel(base(), Object.assign(baseExcel(), { cuit: '30999999995' }), M);
  assert.deepEqual(errores(r), []);
  assert.ok(avisos(r).some(a => /CUIT de la empresa/i.test(a.detalle)));
});

test('contra el Excel: un Excel sin firmantes no se puede controlar y lo dice', () => {
  const r = compararConExcel(base(), M.leerClienteBastanteo([{ hoja: 'Vacía', filas: [['CLIENTE', 'EMPRESA DE PRUEBA SA']] }]), M);
  assert.equal(r.firmantes.length, 0);
  assert.ok(avisos(r).some(a => /no tiene firmantes/i.test(a.detalle)));
});

// ---------------------------------------------------------------- equivalencia de letras entre dos bastanteos
test('equivalencia de letras: dos bastanteos con las letras intercambiadas son equivalentes después de renombrar', () => {
  const esp = json([ap(1, ['B']), ap(2, ['B']), ap(3, ['A'])], [regla('ConjuntaIndistinta', 2, ['B']), regla('Conjunta', 1, ['A', 'B'])]);
  const gen = base();
  assert.ok(M.compararBastanteos(gen, esp).diferencias.length > 0, 'sin renombrar hay diferencias');
  const eq = equivalenciaDeLetras(M.modeloBastanteo(gen), M.modeloBastanteo(esp), M);
  assert.equal(eq.consistente, true);
  assert.deepEqual(eq.mapa, { B: 'A', A: 'B' });
  assert.deepEqual(M.compararBastanteos(gen, renombrarGrupos(esp, eq.mapa)).diferencias, []);
});

test('equivalencia de letras: si una misma letra apunta a dos grupos distintos no hay equivalencia y no se renombra', () => {
  const esp = json([ap(1, ['A']), ap(2, ['B']), ap(3, ['B'])], [regla('ConjuntaIndistinta', 2, ['B'])]);
  const eq = equivalenciaDeLetras(M.modeloBastanteo(base()), M.modeloBastanteo(esp), M);
  assert.equal(eq.consistente, false);
});
