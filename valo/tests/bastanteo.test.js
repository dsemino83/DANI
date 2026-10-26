// Tests de regresión del bastanteo (JSON 1.0, modelo relacional y vista agrupada). Datos inventados: ningún nombre ni
// CUIT corresponde a clientes. Correr con: node --test valo/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../motor.js');

// ---------------------------------------------------------------- datos de prueba
const CUIT = n => `20${String(n).padStart(8, '0')}1`; // 11 dígitos inventados
const persona = (n, grupo) => ({ nombre_completo: `Nombre${n} APELLIDO${n}`, dni: String(n).padStart(8, '0').replace(/^0+/, ''), cuit: CUIT(n), grupo });
const FAC = ks => Object.fromEntries(M.BASTANTEO_CLAVES.map(k => [k, ks.includes(k)]));
const poder = (apoderados, usos, extra = {}) => Object.assign({
  razon_social: 'EMPRESA DE PRUEBA SA', cuit_empresa: '30000000007', fecha_emision: '2025-01-10', deed_number: '100',
  otorgante: { nombre_completo: 'OTORGANTE PRUEBA', dni: '1' }, apoderados, usos }, extra);
const uso = (tipo, combinaciones, facultades, extra = {}) => Object.assign({ tipo, descripcion: `${tipo} ${combinaciones.join('; ')}`, combinaciones,
  grupo: combinaciones[0] ? combinaciones[0].split('+')[0] : null, facultades: FAC(facultades), limitaciones: null }, extra);
function armar(poderes, opciones = {}) {
  const jsons = poderes.map(p => M.jsonPoder(p, null, { todosApoderados: true }));
  const unico = M.jsonBastanteoUnico(jsons, { cuit: '30000000007', cliente: 'EMPRESA DE PRUEBA SA' });
  return M.jsonBastanteoV1(unico, null, Object.assign({ fuente: 'complif', jsons }, opciones));
}
const errores = (m, tipo) => m.errores.filter(e => e.tipo === tipo);

// ---------------------------------------------------------------- modelo relacional
test('modelo: entidades y relaciones del JSON (GRUPO, FIRMANTE, PERTENENCIA, AGRUPAMIENTO, PARTICIPACIÓN, REGLA, APLICACIÓN)', () => {
  const j = armar([poder([persona(1, 'A'), persona(2, 'A'), persona(3, 'B')], [uso('CONJUNTA', ['A+A', 'A+B'], ['firmar_cheques'])])]);
  const m = M.modeloBastanteo(j);
  assert.deepEqual(m.grupos.map(g => g.id), ['A', 'B']);
  assert.equal(m.firmantes.length, 3);
  assert.equal(m.pertenencias.length, 3);
  // Toda participación tiene la pertenencia al grupo de su agrupamiento.
  m.participaciones.forEach(p => {
    const a = m.agrupamientos.find(x => x.id === p.agrupamiento_id);
    assert.ok(m.pertenencias.some(x => x.firmante_id === p.firmante_id && x.grupo_id === a.grupo_id));
  });
  // Cada regla tiene al menos una aplicación; la A+B se aplica a un agrupamiento de cada grupo.
  m.reglas.forEach(r => assert.ok(m.aplicaciones.some(a => a.regla_id === r.id)));
  const ab = m.reglas.find(r => r.tipo === 'Conjunta');
  assert.deepEqual(m.aplicaciones.filter(a => a.regla_id === ab.id).map(a => m.agrupamientos.find(x => x.id === a.agrupamiento_id).grupo_id).sort(), ['A', 'B']);
  assert.equal(m.errores.filter(e => e.nivel === 'error').length, 0);
});

// Bug: al separar un uso "A+A, A+C, B+B, B+C" en reglas, cada regla heredaba todos los apoderados del uso
// (la A+C quedaba con los del grupo B como participantes).
test('regresión: cada combinación toma solo a los apoderados de sus grupos', () => {
  const ap = [persona(1, 'A'), persona(2, 'A'), persona(3, 'B'), persona(4, 'B'), persona(5, 'C')];
  const j = armar([poder(ap, [uso('CONJUNTA', ['A+A', 'A+C', 'B+B', 'B+C'], ['firmar_cheques'])])]);
  const m = M.modeloBastanteo(j);
  assert.equal(errores(m, 'ERROR DE PARTICIPACIÓN').length, 0);
  const ac = j.reglasFirma.find(r => r.tipo === 'Conjunta' && r.grupos.join() === 'A,C');
  assert.ok(ac, 'falta la regla A+C');
  assert.deepEqual(ac._participantes, [CUIT(1), CUIT(2), CUIT(5)].map(M.formatoCuit).sort());
});

// Bug: la numeración final de las reglas (referencia) creaba objetos nuevos y perdía los datos internos
// (_vto, _participantes, _gemelaDe): la misma regla en USD y en ARS quedaba en dos filas.
test('regresión: la regla en otra moneda se reconoce como la misma (una sola fila)', () => {
  const ap = [persona(1, 'A'), persona(2, 'A')];
  const j = armar([poder(ap, [uso('CONJUNTA', ['A+A'], ['firmar_cheques'], { limitaciones: 'En operaciones que no excedan U$S 500.000' })])], { tc: { tc: 1000, fecha: '2026-10-20' } });
  assert.deepEqual(j.reglasFirma.map(r => `${r.moneda} ${r.monto}`).sort(), ['ARS 500000000', 'USD 500000']);
  const ars = j.reglasFirma.find(r => r.moneda === 'ARS');
  assert.equal(ars._gemelaDe, j.reglasFirma.find(r => r.moneda === 'USD'));
  assert.equal(ars._participantes.length, 2);
  const filas = M.vistaAgrupada(M.modeloBastanteo(j));
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].monedas, ['ARS', 'USD']);
  assert.equal(filas[0].limites.length, 2);
  // El JSON exportado no cambia: los datos internos no se serializan.
  assert.ok(!('_participantes' in JSON.parse(JSON.stringify(j)).reglasFirma[0]));
});

test('integridad: participante cuya pertenencia es a otro grupo → ERROR DE PARTICIPACIÓN (no se infiere pertenencia)', () => {
  const j = { apoderados: [{ cuitCuil: '20-00000001-1', nombre: 'Uno', apellido: 'A', grupos: ['A'] }, { cuitCuil: '20-00000002-1', nombre: 'Dos', apellido: 'A', grupos: ['A'] }, { cuitCuil: '20-00000003-1', nombre: 'Tres', apellido: 'B', grupos: ['B'] }],
    reglasFirma: [Object.defineProperty({ referencia: 'regla-1', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: ['A'], firmantes: [] },
      '_participantes', { value: ['20-00000001-1', '20-00000002-1', '20-00000003-1'], enumerable: false })] };
  const m = M.modeloBastanteo(j);
  assert.equal(errores(m, 'ERROR DE PARTICIPACIÓN').length, 1);
  // El firmante del grupo B no queda en el agrupamiento del grupo A, y sigue perteneciendo solo al B.
  const a = m.agrupamientos.find(x => x.grupo_id === 'A');
  assert.deepEqual(m.participaciones.filter(p => p.agrupamiento_id === a.id).map(p => p.firmante_id), ['20-00000001-1', '20-00000002-1']);
  assert.deepEqual(m.pertenencias.filter(p => p.firmante_id === '20-00000003-1').map(p => p.grupo_id), ['B']);
});

test('integridad: un firmante puede participar en varios agrupamientos de su grupo; no se asume que participa en todos', () => {
  const ocultos = (r, part) => Object.defineProperty(r, '_participantes', { value: part, enumerable: false });
  const ap = [1, 2, 3].map(n => ({ cuitCuil: `20-0000000${n}-1`, nombre: `N${n}`, apellido: 'X', grupos: ['A'] }));
  const j = { apoderados: ap, reglasFirma: [
    ocultos({ referencia: 'regla-1', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: ['A'], firmantes: [] }, ['20-00000001-1', '20-00000002-1']),
    ocultos({ referencia: 'regla-2', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: ['PF_COBRAR'], grupos: ['A'], firmantes: [] }, ['20-00000001-1', '20-00000003-1']) ] };
  const m = M.modeloBastanteo(j);
  assert.equal(m.agrupamientos.length, 2);
  assert.equal(m.participaciones.filter(p => p.firmante_id === '20-00000001-1').length, 2);
  // Como el JSON aplica por grupo, se avisa a quién más le llegaría cada regla.
  assert.equal(m.errores.filter(e => e.tipo === 'ERROR DE AGRUPAMIENTO' && e.nivel === 'aviso').length, 2);
});

test('validación: errores clasificados en un JSON de afuera', () => {
  const j = { apoderados: [{ cuitCuil: '20-00000001-1', nombre: 'Uno', apellido: 'X', grupos: ['A'] }],
    reglasFirma: [
      { referencia: 'r1', tipo: 'Conjunta', quorum: 2, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: ['A'], firmantes: [] },
      { referencia: 'r2', tipo: 'ConjuntaIndistinta', quorum: 1, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: ['Z'], firmantes: [] },
      { referencia: 'r3', tipo: 'Individual', quorum: 1, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: [], firmantes: ['20-99999999-1'] },
      { referencia: 'r4', tipo: 'ConjuntaIndistinta', quorum: 1, moneda: 'USD', monto: null, circuitos: ['NO_EXISTE'], grupos: ['A'], firmantes: [] },
    ] };
  const m = M.modeloBastanteo(j);
  const tipos = new Set(m.errores.map(e => e.tipo));
  ['ERROR DE GRUPO', 'ERROR DE REGLA', 'ERROR DE APLICACIÓN', 'ERROR DE AGRUPAMIENTO'].forEach(t => assert.ok(tipos.has(t), t));
  assert.ok(m.errores.some(e => /Conjunta tiene que tener al menos 2 grupos/.test(e.detalle)));
  assert.ok(m.errores.some(e => /pide 2 firmas|pide 2 firma/.test(e.detalle)));
  // Orden de revisión: GRUPO antes que REGLA y APLICACIÓN.
  const orden = m.errores.map(e => M.TIPOS_DE_ERROR_BASTANTEO.indexOf(e.tipo));
  assert.deepEqual(orden, orden.slice().sort((a, b) => a - b));
});

// ---------------------------------------------------------------- vista agrupada
test('vista agrupada: una fila por agrupamiento + regla; distintas facultades no se fusionan; códigos gemelos normalizados', () => {
  const ap = [{ cuitCuil: '20-00000001-1', nombre: 'Uno', apellido: 'X', grupos: ['A'] }, { cuitCuil: '20-00000002-1', nombre: 'Dos', apellido: 'X', grupos: ['A'] }];
  const r = (ref, circuitos) => ({ referencia: ref, tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos, grupos: ['A'], firmantes: [] });
  const filas = M.vistaAgrupada(M.modeloBastanteo({ apoderados: ap, reglasFirma: [
    r('r1', ['TRF_ENTRE_CTAS_EMP', 'TRF_ENTRE_CUENTAS_EM']), r('r2', ['TRF_ENTRE_CTAS_EMP']), r('r3', ['ECHEQ_FIRMAR']) ] }));
  assert.equal(filas.length, 2); // r1 y r2 son la misma regla después de normalizar; r3 tiene otras facultades
  const f = filas.find(x => x.reglas.length === 2);
  assert.deepEqual(f.reglas.sort(), ['r1', 'r2']);
  assert.deepEqual(f.facultades, ['Transferencias entre cuentas de la empresa']);
  assert.equal(f.condicion, '2 firmas del grupo A');
  assert.equal(f.firmantes[0].nombres.length, 2);
});

test('vista agrupada: tope y sin tope son filas distintas; condición en palabras', () => {
  const ap = [{ cuitCuil: '20-00000001-1', nombre: 'Uno', apellido: 'X', grupos: ['A'] }, { cuitCuil: '20-00000002-1', nombre: 'Dos', apellido: 'X', grupos: ['B'] }];
  const base = { tipo: 'Conjunta', quorum: 1, circuitos: ['ECHEQ_FIRMAR'], grupos: ['A', 'B'], firmantes: [] };
  const filas = M.vistaAgrupada(M.modeloBastanteo({ apoderados: ap, reglasFirma: [
    Object.assign({ referencia: 'r1', moneda: null, monto: null }, base), Object.assign({ referencia: 'r2', moneda: 'USD', monto: 1000 }, base) ] }));
  assert.equal(filas.length, 2);
  assert.ok(filas.every(f => f.condicion === 'Una firma de cada grupo: A y B'));
  assert.deepEqual(filas.map(f => f.limites[0]).sort(), ['Sin tope', 'USD 1.000,00']);
});

// ---------------------------------------------------------------- comparación (Skill bastanteo-review)
test('comparación semántica: "dos cualesquiera de A y/o B" = A+A, B+B y A+B; DNI y CUIT de la misma persona', () => {
  const ap = (ids) => [{ cuitCuil: ids[0], nombre: 'Uno', apellido: 'X', grupos: ['A'] }, { cuitCuil: ids[1], nombre: 'Dos', apellido: 'X', grupos: ['B'] }];
  const c = ['ECHEQ_FIRMAR'];
  const generado = { apoderados: ap(['00000001', '00000002']), reglasFirma: [{ referencia: 'r1', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: c, grupos: ['A', 'B'], firmantes: [] }] };
  const esperado = { apoderados: ap(['20-00000001-1', '20-00000002-1']), reglasFirma: [
    { referencia: 'e1', tipo: 'Conjunta', quorum: 2, moneda: null, monto: null, circuitos: c, grupos: ['A'], firmantes: [] },
    { referencia: 'e2', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: c, grupos: ['B'], firmantes: [] },
    { referencia: 'e3', tipo: 'Conjunta', quorum: 1, moneda: null, monto: null, circuitos: c, grupos: ['A', 'B'], firmantes: [] } ] };
  const r = M.compararBastanteos(generado, esperado);
  assert.deepEqual(r.diferencias, []);
  // El esperado igual tiene su propio error de regla (Conjunta de un solo grupo).
  assert.ok(r.esperado.some(e => e.tipo === 'ERROR DE REGLA'));
});

test('comparación: diferencias clasificadas (pertenencia, agrupamiento, regla, aplicación)', () => {
  const g = { apoderados: [{ cuitCuil: '20-00000001-1', nombre: 'Uno', apellido: 'X', grupos: ['A'] }, { cuitCuil: '20-00000002-1', nombre: 'Dos', apellido: 'X', grupos: ['A'] }],
    reglasFirma: [{ referencia: 'r1', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR', 'PF_COBRAR'], grupos: ['A'], firmantes: [] }] };
  const e = { apoderados: [{ cuitCuil: '20-00000001-1', nombre: 'Uno', apellido: 'X', grupos: ['A'] }, { cuitCuil: '20-00000002-1', nombre: 'Dos', apellido: 'X', grupos: ['A'] }, { cuitCuil: '20-00000003-1', nombre: 'Tres', apellido: 'X', grupos: ['A'] }],
    reglasFirma: [{ referencia: 'e1', tipo: 'ConjuntaIndistinta', quorum: 2, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: ['A'], firmantes: [] },
      { referencia: 'e2', tipo: 'ConjuntaIndistinta', quorum: 1, moneda: null, monto: null, circuitos: ['ECHEQ_FIRMAR'], grupos: ['A'], firmantes: [] }] };
  const tipos = M.compararBastanteos(g, e).diferencias.map(x => x.tipo);
  ['ERROR DE PERTENENCIA', 'ERROR DE AGRUPAMIENTO', 'ERROR DE REGLA', 'ERROR DE APLICACIÓN'].forEach(t => assert.ok(tipos.includes(t), t));
});

// ---------------------------------------------------------------- reglas ya corregidas antes (no romperlas)
test('optimización: A+A, B+B y A+B con el mismo monto → dos cualesquiera de A y/o B; tope y sin tope separados', () => {
  const ap = [persona(1, 'A'), persona(2, 'A'), persona(3, 'B'), persona(4, 'B')];
  const j = armar([poder(ap, [
    uso('CONJUNTA', ['A+A'], ['firmar_cheques'], { limitaciones: 'Operaciones que excedan U$S 500.000' }),
    uso('CONJUNTA', ['A+B'], ['cobrar_plazo_fijo'], { limitaciones: 'Operaciones que excedan U$S 500.000' }),
    uso('CONJUNTA', ['B+B'], ['cobrar_plazo_fijo'], { limitaciones: 'Operaciones que excedan U$S 500.000' }),
    uso('CONJUNTA', ['A+A', 'A+B', 'B+B'], ['firmar_cheques'], { limitaciones: 'En operaciones que no excedan U$S 500.000' }) ])]);
  const sig = j.reglasFirma.map(r => `${r.tipo} q${r.quorum} ${r.grupos.join('')} ${r.moneda || '-'}`).sort();
  assert.deepEqual(sig, ['ConjuntaIndistinta q2 AB -', 'ConjuntaIndistinta q2 AB USD']);
  assert.equal(M.modeloBastanteo(j).errores.filter(e => e.nivel === 'error').length, 0);
});

test('firma individual restringida en un poder con conjunta no va como regla', () => {
  const ap = [persona(1, 'A'), persona(2, 'A')];
  const j = armar([poder(ap, [uso('CONJUNTA', ['A+A'], ['firmar_cheques']),
    uso('INDIVIDUAL', ['A'], ['solicitar_saldo_de_cuentas'], { limitaciones: 'Podrá ejercer únicamente la facultad de verificar saldos', descripcion: 'Individual (verificar saldos)' })])]);
  assert.ok(j.reglasFirma.every(r => r.quorum !== 1));
  assert.ok(j.avisos.some(a => /restringida/.test(a)));
});

test('poder vencido no se usa', () => {
  const p1 = poder([persona(1, 'A')], [uso('INDIVIDUAL', ['A'], ['firmar_cheques'])], { vencimiento: '2020-01-01' });
  const rv = M.aplicarRevocatorias([p1], { hoy: new Date(2026, 0, 1) });
  assert.equal(rv.vigentes.length, 0);
  assert.equal(rv.anulados[0].vencido, true);
});

test('montos, nombres y tipo de cambio de la planilla', () => {
  assert.deepEqual(M.montoDeTexto('en operaciones que no excedan la suma de U$S 500.000'), { monto: 500000, moneda: 'USD' });
  assert.equal(M.montoDeTexto('que excedan U$S 500.000').monto, null);
  assert.deepEqual(M.separarNombre('ADRIÁN ALBERTO FANTÍN').apellido, 'FANTÍN');
  assert.deepEqual(M.separarNombre('Estefania DE ROSA').apellido, 'DE ROSA');
  assert.equal(M.tcDePlanilla([{ filas: [['TIPO DE CAMBIO AL 11/01/2024: 834.5000']] }]).tc, 834.5);
});

// Bug: un uso con grupo "A" y combinaciones "A+A, A+B" solo tomaba a los apoderados del grupo A; la regla A+B quedaba
// sin participantes del grupo B (agrupamiento vacío).
test('regresión: los grupos de un uso incluyen los de sus combinaciones', () => {
  const j = armar([poder([persona(1, 'A'), persona(2, 'A'), persona(3, 'B')], [uso('CONJUNTA', ['A+A', 'A+B'], ['firmar_cheques'])])]);
  const ab = j.reglasFirma.find(r => r.tipo === 'Conjunta');
  assert.ok(ab._participantes.includes(M.formatoCuit(CUIT(3))));
  assert.equal(M.modeloBastanteo(j).errores.filter(e => e.tipo === 'ERROR DE AGRUPAMIENTO').length, 0);
});
