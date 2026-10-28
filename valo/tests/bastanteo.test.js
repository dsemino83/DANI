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

// ---------------------------------------------------------------- análisis de la pantalla (máquina de estados)
test('análisis: sin observaciones, con la referencia igual, y con diferencias contra la referencia', () => {
  const ap = [persona(1, 'A'), persona(2, 'A'), persona(3, 'B')];
  const j = armar([poder(ap, [uso('CONJUNTA', ['A+A', 'A+B'], ['firmar_cheques'])])]);
  const ok = M.analizarBastanteo(j);
  assert.equal(ok.status, 'OK');
  assert.ok(ok.findings.every(f => f.startsWith('AVISO') || !/^ERROR/.test(f)));
  const igual = M.analizarBastanteo(j, M.modeloBastanteo(j), JSON.parse(JSON.stringify(j)));
  assert.equal(igual.status, 'OK');
  assert.match(igual.summary, /coincide con la referencia/);
  // La referencia no tiene la combinación A+B: es una observación (status ERROR), no una falla técnica.
  const sinAB = armar([poder(ap, [uso('CONJUNTA', ['A+A'], ['firmar_cheques'])])]);
  const dif = M.analizarBastanteo(j, M.modeloBastanteo(j), sinAB);
  assert.equal(dif.status, 'ERROR');
  assert.ok(dif.findings.some(f => f.startsWith('ERROR DE AGRUPAMIENTO (contra la referencia)')));
});

test('los .js que usa la página están generados desde los .mts', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { generar, MODULOS } = await import('../bastanteo/generar-estado.mjs');
  for (const m of MODULOS) assert.equal(fs.readFileSync(path.join(__dirname, `../bastanteo/${m.nombre}.js`), 'utf8'), generar(m), 'correr npm run build:estado');
  const E = require('../bastanteo/estado.js');
  const l = E.transition(E.initialState, { type: 'LOAD_CONTEXT', grouping: 'G' }).state;
  assert.equal(E.receive(l, { type: 'CONTEXT_LOADED', contextVersion: l.contextVersion, data: {} }).state.status, 'READY');
});

test('chat: el ChatContext de cada agrupamiento de la Vista agrupada es válido y respalda sus hechos', () => {
  const R = require('../bastanteo/razonamiento.js');
  const ap = [persona(1, 'A'), persona(2, 'A'), persona(3, 'B')];
  const j = armar([poder(ap, [uso('CONJUNTA', ['A+A', 'A+B'], ['firmar_cheques'])])]);
  const m = M.modeloBastanteo(j);
  const filas = M.vistaAgrupada(m);
  assert.ok(filas.length);
  for (const f of filas) for (const a of f.firmantes) {
    const c = M.chatContextBastanteo(m, f, a.agrupamiento, { bastanteoId: '30000000007', version: 'v1' });
    assert.deepEqual(R.validateChatContext(c), { valid: true }, `${f.agrupamiento} ${a.agrupamiento}`);
    assert.equal(c.participaciones.length, a.nombres.length);
    for (const t of R.contextFacts(c)) assert.equal(R.initialVerification({ source: 'BASTANTEO', type: 'FACT', text: t }, c), 'VERIFIED', t);
  }
});

// Bug: un apoderado sin CUIT en la planilla ni en la base salía con el DNI en cuitCuil y la validación no lo marcaba.
test('regresión: CUIL del dorso del DNI de Complif y DNI en lugar de CUIT marcado como error', () => {
  assert.equal(M.cuitValido('20264784817'), true);
  assert.equal(M.cuitValido('20264784818'), false);
  const dorso = (cuil, status = 'APPROVED') => ({ type: 'Dorso de DNI', status, raw_ocr_data: { tax_id_number: cuil } });
  assert.equal(M.cuilDeDorsoDni([dorso('20264784817'), dorso('20264784817')], '26478481'), '20264784817');
  assert.equal(M.cuilDeDorsoDni([dorso('20264784818')], '26478481'), '', 'verificador inválido');
  assert.equal(M.cuilDeDorsoDni([dorso('20111111112')], '26478481'), '', 'otro DNI');
  assert.equal(M.cuilDeDorsoDni([dorso('20264784817'), dorso('23264784816')], '26478481'), '', 'dos CUIL distintos');
  assert.equal(M.cuilDeDorsoDni([dorso('20264784817'), dorso('23264784816', 'REJECTED')], '26478481'), '20264784817', 'primero los aprobados');
  const j = armar([poder([persona(1, 'A'), persona(2, 'A')], [uso('CONJUNTA', ['A+A'], ['firmar_cheques'])])]);
  j.apoderados[0].cuitCuil = '26478481';
  assert.ok(M.validarJsonBastanteo(j).some(e => /tiene el DNI \(26478481\) en lugar del CUIT\/CUIL/.test(e)));
});

// Bug: el modelo marcaba ERROR DE AGRUPAMIENTO ("pide 2 firmas y entre los grupos A hay 1 firmante") pero el JSON
// seguía incluyendo la regla A+A que no se puede cumplir con una sola persona en A.
test('regresión: una regla que no se puede cumplir con los firmantes del grupo no va en el JSON (se avisa)', () => {
  const ap = [persona(1, 'A'), persona(2, 'B'), persona(3, 'B'), persona(4, 'C')];
  const j = armar([poder(ap, [uso('CONJUNTA', ['A+A', 'A+C', 'B+B', 'B+C'], ['firmar_cheques'])])]);
  assert.deepEqual(j.reglasFirma.map(r => `${r.tipo} q${r.quorum} [${r.grupos}]`).sort(), ['Conjunta q1 [A,C]', 'Conjunta q1 [B,C]', 'ConjuntaIndistinta q2 [B]']);
  assert.ok(j.avisos.some(a => /No va la regla .*A\+A.*pide 2 firmas .* hay 1 firmante/.test(a)), j.avisos.join(' | '));
  assert.deepEqual(M.modeloBastanteo(j).errores.filter(e => e.nivel === 'error'), []);
  // Con dos personas en A, la regla A+A sí va.
  const j2 = armar([poder([persona(1, 'A'), persona(5, 'A'), persona(2, 'B')], [uso('CONJUNTA', ['A+A', 'A+B'], ['firmar_cheques'])])]);
  assert.deepEqual(j2.reglasFirma.map(r => `${r.tipo} q${r.quorum} [${r.grupos}]`).sort(), ['Conjunta q1 [A,B]', 'ConjuntaIndistinta q2 [A]']);
  // Y las reglas con tope también salen sin la imposible (y sin su gemela en la otra moneda).
  const j3 = armar([poder([persona(1, 'A'), persona(2, 'B')], [uso('CONJUNTA', ['A+A', 'A+B'], ['firmar_cheques'], { limitaciones: 'En operaciones que no excedan U$S 500.000' })])], { tc: { tc: 1000, fecha: '2026-10-20' } });
  assert.deepEqual(j3.reglasFirma.map(r => `${r.moneda} ${r.tipo} [${r.grupos}]`).sort(), ['ARS Conjunta [A,B]', 'USD Conjunta [A,B]']);
});

// Poder sin grupos con letra ("dos cualesquiera apoderados"): la página arma los grupos. Un grupo con una sola persona
// no es "B+B": la segunda firma es la de otro apoderado, o sea B con cada otro grupo (A+B).
test('regresión: grupo armado por la página con una sola persona va combinado con los otros grupos (A+B)', () => {
  const p = poder([persona(1, 'Firmantes Alfa'), persona(2, 'Firmantes Beta'), persona(3, 'Firmantes Beta')],
    [{ tipo: 'CONJUNTA', descripcion: 'dos cualesquiera', combinaciones: [], grupo: null, facultades: FAC(['firmar_cheques']), limitaciones: null }]);
  const j = armar([p]);
  assert.deepEqual(j.reglasFirma.map(r => `${r.tipo} q${r.quorum} [${r.grupos}]`).sort(), ['Conjunta q1 [A,B]', 'ConjuntaIndistinta q2 [A]']);
  assert.ok(j.avisos.some(a => /grupo B tiene una sola persona.*A\+B/.test(a)), j.avisos.join(' | '));
  const m = M.modeloBastanteo(j);
  assert.deepEqual(m.errores.filter(e => e.nivel === 'error'), []);
  // El A+B lo firman la persona del grupo B y cualquiera de A.
  const ab = j.reglasFirma.find(r => r.tipo === 'Conjunta');
  assert.equal(ab._participantes.length, 3);
});

// Bug: el bastanteo toma "dos cualesquiera apoderados" de un grupo de una sola persona (letra puesta por la página) como
// esa persona con cada otro grupo (A+B), pero el control del resumen lo comparaba como "dos del mismo grupo" y daba diferencia.
test('regresión: el control toma la firma de un grupo armado por la página con una sola persona como A+B (igual que el bastanteo)', () => {
  const p = poder([persona(1, 'Firmantes Alfa'), persona(2, 'Firmantes Beta'), persona(3, 'Firmantes Beta')],
    [{ tipo: 'CONJUNTA', descripcion: 'dos cualesquiera', combinaciones: [], grupo: null, facultades: FAC(['firmar_cheques']), limitaciones: null }]);
  const unico = M.jsonBastanteoUnico([M.jsonPoder(p, null, { todosApoderados: true })], { cuit: '30000000007', cliente: 'EMPRESA DE PRUEBA SA' });
  const fila = (n, grupo, combinaciones) => ({ nombre: `Nombre${n} APELLIDO${n}`, cuit: CUIT(n), dni: String(n), ente: '', observacion: '', monto_hasta: null, revocado: false,
    uso: { grupo, tipo: 'CONJUNTA', tipos: ['CONJUNTA'], combinaciones, texto: `${grupo} CONJUNTA ${combinaciones.join('; ')}`, limite: null } });
  // En el resumen: Nombre1 es el grupo A y firma A+B con alguien del B; los otros dos son B (A+B y B+B).
  const cliente = { firmantes: [fila(1, 'A', ['A+B']), fila(2, 'B', ['A+B', 'B+B']), fila(3, 'B', ['A+B', 'B+B'])] };
  const dif = M.controlResumen(unico, cliente, [], {}).flatMap(c => c.puntos.filter(x => x.ok === false).map(x => `${c.nombre}: ${x.punto} (${x.detalle || x.poder})`));
  assert.deepEqual(dif, []);
  // Para esa persona "dos cualesquiera" también vale como dos del mismo grupo (A+A): no es una diferencia nueva.
  const igual = { firmantes: [fila(1, 'A', ['A+A']), fila(2, 'B', ['A+B', 'B+B']), fila(3, 'B', ['A+B', 'B+B'])] };
  assert.deepEqual(M.controlResumen(unico, igual, [], {}).flatMap(c => c.puntos.filter(x => x.punto === 'Firmas conjuntas' && x.ok === false)), []);
});

// Criterios aceptados a mano desde la pantalla: una diferencia igual (mismo punto, mismo texto del resumen y del poder) pasa
// a "a revisar" con el criterio a la vista; no cambia nada más.
test('control: un criterio aceptado convierte la diferencia igual en "a revisar" y no toca las demás', () => {
  const p = poder([persona(1, 'A'), persona(2, 'A')], [uso('CONJUNTA', ['A+A'], ['firmar_cheques'])]);
  const unico = M.jsonBastanteoUnico([M.jsonPoder(p, null, { todosApoderados: true })], { cuit: '30000000007', cliente: 'EMPRESA DE PRUEBA SA' });
  const fila = (n, tipo) => ({ nombre: `Nombre${n} APELLIDO${n}`, cuit: CUIT(n), dni: String(n), ente: '', observacion: '', monto_hasta: null, revocado: false,
    uso: { grupo: 'A', tipo, tipos: [tipo], combinaciones: [], texto: `A ${tipo}`, limite: null } });
  const cliente = { firmantes: [fila(1, 'INDIVIDUAL'), fila(2, 'CONJUNTA')] };
  const dif = ctl => ctl.flatMap(c => c.puntos.filter(x => x.ok === false).map(x => `${c.nombre}|${x.punto}`));
  const sin = M.controlResumen(unico, cliente, [], {});
  assert.deepEqual(dif(sin), ['Nombre1 APELLIDO1|Uso de firma']);
  const x = sin[0].puntos.find(q => q.punto === 'Uso de firma');
  const con = M.controlResumen(unico, cliente, [], {}, [{ id: 'c1', punto: x.punto, resumen: x.resumen, poder: x.poder, comentario: 'vale la conjunta' }]);
  assert.deepEqual(dif(con), []);
  const q = con[0].puntos.find(y => y.punto === 'Uso de firma');
  assert.equal(q.ok, null);
  assert.equal(q.criterio, 'c1');
  assert.match(q.detalle, /criterio aceptado: vale la conjunta/);
  // Otro criterio (otro texto del poder) no aplica.
  assert.deepEqual(dif(M.controlResumen(unico, cliente, [], {}, [{ id: 'c2', punto: x.punto, resumen: x.resumen, poder: 'otro texto', comentario: '' }])), ['Nombre1 APELLIDO1|Uso de firma']);
});

// Bug: el JSON incluía reglas que el modelo marca como error y no se pueden usar: una regla sin facultades (ERROR DE REGLA) y
// "una firma de cualquiera de los grupos A y B" con nadie del grupo B entre los que participan (agrupamiento sin firmantes).
test('regresión: no va una regla sin facultades; un grupo sin firmantes se saca de la regla indistinta (se avisa)', () => {
  const ap = [persona(1, 'A'), persona(2, 'A'), persona(3, 'B')];
  // Uso sin ninguna facultad: no va.
  const sin = armar([poder(ap, [uso('CONJUNTA', ['A+A'], ['firmar_cheques']), uso('CONJUNTA', ['A+B'], [])])]);
  assert.deepEqual(sin.reglasFirma.map(r => `${r.tipo} [${r.grupos}]`), ['ConjuntaIndistinta [A]']);
  assert.ok(sin.avisos.some(a => /No va la regla .*no le da facultades/.test(a)), sin.avisos.join(' | '));
  assert.deepEqual(M.modeloBastanteo(sin).errores.filter(e => e.nivel === 'error'), []);
  // Firma individual indistinta de los grupos A y B, pero el del grupo B no participa (el poder lo da solo al A): queda el A.
  const j = armar([poder(ap, [uso('INDIVIDUAL', [], ['firmar_cheques'], { grupo: 'A' }), uso('INDIVIDUAL', [], ['endosar_cheques'], { grupo: 'B' })])]);
  j.reglasFirma.forEach(r => assert.ok(r.circuitos.length));
  assert.deepEqual(M.modeloBastanteo(j).errores.filter(e => e.nivel === 'error' && e.tipo === 'ERROR DE AGRUPAMIENTO'), []);
});
