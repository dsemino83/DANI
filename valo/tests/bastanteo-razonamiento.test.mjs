// Tests del ChatContext (validación cerrada) y de la verificación de ReasoningItem (valo/bastanteo/razonamiento.mts).
// Datos inventados. Correr: npm run test:bastanteo
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChatContext, isDirectlyBackedByContext, initialVerification, createReasoningItem, startVerification, applyEvidence, changeContext } from '../bastanteo/razonamiento.mts';

const ctx = (cambios = {}) => Object.assign({
  bastanteoId: 'B1', grupoId: 'A', agrupamientoId: 'AG1', version: 'v1',
  grupo: { id: 'A', nombre: 'Grupo A' },
  firmantes: [{ id: 'F1', nombre: 'APELLIDO1 Nombre1' }, { id: 'F2', nombre: 'APELLIDO2 Nombre2' }],
  pertenencias: [{ id: 'P1', grupoId: 'A', firmanteId: 'F1' }, { id: 'P2', grupoId: 'A', firmanteId: 'F2' }],
  agrupamiento: { id: 'AG1', grupoId: 'A', nombre: 'A+A' },
  participaciones: [{ agrupamientoId: 'AG1', firmanteId: 'F1' }, { agrupamientoId: 'AG1', firmanteId: 'F2' }],
  regla: { id: 'R1', agrupamientoId: 'AG1', descripcion: 'Dos firmas del grupo A' },
}, cambios);
const errores = v => { const r = validateChatContext(v); return r.valid ? [] : r.errors.map(e => `${e.code} ${e.path}`); };

// ---------------------------------------------------------------- validación
test('raíz null, array o de otro tipo → INVALID_VALUE en $ y se detiene', () => {
  for (const v of [null, [], [ctx()], 'texto', 3, undefined]) assert.deepEqual(errores(v), ['INVALID_VALUE $']);
});
test('campo raíz faltante → MISSING_FIELD con su path', () => {
  const c = ctx(); delete c.firmantes; delete c.version;
  assert.deepEqual(errores(c), ['MISSING_FIELD $.version', 'MISSING_FIELD $.firmantes']);
});
test('un campo presente con valor undefined no cuenta como ausente', () => {
  assert.deepEqual(errores(ctx({ version: undefined })), ['INVALID_VALUE $.version']);
});
test('campo desconocido en la raíz y anidado → UNKNOWN_FIELD (no se ignora)', () => {
  assert.deepEqual(errores(ctx({ extra: 1 })), ['UNKNOWN_FIELD $.extra']);
  const c = ctx(); c.firmantes[1].cuit = '1'; c.regla.monto = 5; c.grupo.x = 0;
  assert.deepEqual(errores(c), ['UNKNOWN_FIELD $.grupo.x', 'UNKNOWN_FIELD $.firmantes[1].cuit', 'UNKNOWN_FIELD $.regla.monto']);
});
test('valores inválidos recursivos', () => {
  const c = ctx({ firmantes: [{ id: '', nombre: 3 }, 'x'], participaciones: {} });
  c.pertenencias = [];
  assert.deepEqual(errores(c), ['INVALID_VALUE $.firmantes[0].id', 'INVALID_VALUE $.firmantes[0].nombre', 'INVALID_VALUE $.firmantes[1]', 'INVALID_VALUE $.participaciones']);
});
test('IDs duplicados dentro de cada colección', () => {
  const c = ctx(); c.firmantes.push({ id: 'F1', nombre: 'Otro' }); c.pertenencias.push({ id: 'P2', grupoId: 'A', firmanteId: 'F1' });
  assert.deepEqual(errores(c), ['DUPLICATE_ID $.firmantes[2].id', 'DUPLICATE_ID $.pertenencias[2].id']);
});
test('referencia inexistente → INVALID_REFERENCE', () => {
  const c = ctx(); c.pertenencias[1].firmanteId = 'F9'; c.participaciones[0].firmanteId = 'F8';
  assert.deepEqual(errores(c), ['INVALID_REFERENCE $.pertenencias[1].firmanteId', 'INVALID_REFERENCE $.participaciones[0].firmanteId',
    // F2 ya no tiene pertenencia (la suya apunta a F9).
    'INVALID_RELATION $.participaciones[1]']);
});
test('relación inválida → INVALID_RELATION', () => {
  const c = ctx({ grupo: { id: 'B', nombre: 'Grupo B' }, agrupamiento: { id: 'AG2', grupoId: 'B', nombre: 'x' } });
  c.pertenencias[0].grupoId = 'B'; c.participaciones[1].agrupamientoId = 'AG2';
  assert.deepEqual(errores(c), ['INVALID_RELATION $.grupo.id', 'INVALID_RELATION $.pertenencias[0].grupoId', 'INVALID_RELATION $.agrupamiento.id',
    'INVALID_RELATION $.agrupamiento.grupoId', 'INVALID_RELATION $.participaciones[0]', 'INVALID_RELATION $.participaciones[1].agrupamientoId']);
});
test('participación sin pertenencia → INVALID_RELATION', () => {
  const c = ctx(); c.pertenencias.pop();
  assert.deepEqual(errores(c), ['INVALID_RELATION $.participaciones[1]']);
});
test('regla de otro agrupamiento → INVALID_RELATION', () => {
  assert.deepEqual(errores(ctx({ regla: { id: 'R1', agrupamientoId: 'AG9', descripcion: 'x' } })), ['INVALID_RELATION $.regla.agrupamientoId']);
});
test('contexto válido, con listas vacías y sin regla', () => {
  assert.deepEqual(validateChatContext(ctx()), { valid: true });
  const c = ctx({ firmantes: [], pertenencias: [], participaciones: [] }); delete c.regla;
  assert.deepEqual(validateChatContext(c), { valid: true });
});
test('la validación es determinista y no modifica la entrada', () => {
  const c = ctx({ extra: 1 }); c.pertenencias.pop(); const copia = structuredClone(c);
  assert.deepEqual(validateChatContext(c), validateChatContext(c));
  assert.deepEqual(c, copia);
});

// ---------------------------------------------------------------- inicialización
const it = (type, source, text) => ({ type, source, text });
test('FACT + BASTANTEO respaldado directamente → VERIFIED', () => {
  for (const t of ['Grupo A: Grupo A', 'Firmante F1: APELLIDO1 Nombre1', 'Firmante F2 pertenece al grupo A', 'Agrupamiento AG1 del grupo A: A+A',
    'Firmante F1 participa en el agrupamiento AG1', '  Regla R1 del agrupamiento AG1:   Dos firmas del grupo A '])
    assert.equal(initialVerification(it('FACT', 'BASTANTEO', t), ctx()), 'VERIFIED', t);
});
test('FACT + BASTANTEO no respaldado (inferido, ausente, ambiguo o contexto inválido) → UNVERIFIED', () => {
  for (const t of ['Firmante F1 pertenece al grupo B', 'F1 y F2 pueden firmar juntos', 'Firmante F3: X', 'firmante f1: apellido1 nombre1', ''])
    assert.equal(initialVerification(it('FACT', 'BASTANTEO', t), ctx()), 'UNVERIFIED', t);
  const sinRegla = ctx(); delete sinRegla.regla;
  assert.equal(initialVerification(it('FACT', 'BASTANTEO', 'Regla R1 del agrupamiento AG1: Dos firmas del grupo A'), sinRegla), 'UNVERIFIED');
  // Dos firmantes con el mismo nombre e ID repetido: ambiguo (además el contexto es inválido).
  const dup = ctx(); dup.firmantes.push({ id: 'F1', nombre: 'APELLIDO1 Nombre1' });
  assert.equal(isDirectlyBackedByContext('Firmante F1: APELLIDO1 Nombre1', dup), false);
  const invalido = ctx(); invalido.pertenencias.pop();
  assert.equal(initialVerification(it('FACT', 'BASTANTEO', 'Firmante F1 pertenece al grupo A'), invalido), 'UNVERIFIED');
});
test('FACT de HUMAN o SKILL → UNVERIFIED aunque el texto esté en el contexto', () => {
  assert.equal(initialVerification(it('FACT', 'HUMAN', 'Grupo A: Grupo A'), ctx()), 'UNVERIFIED');
  assert.equal(initialVerification(it('FACT', 'SKILL', 'Grupo A: Grupo A'), ctx()), 'UNVERIFIED');
});
test('OBSERVATION, HYPOTHESIS e INFERENCE → UNVERIFIED', () => {
  for (const type of ['OBSERVATION', 'HYPOTHESIS', 'INFERENCE'])
    for (const source of ['BASTANTEO', 'HUMAN', 'SKILL']) assert.equal(initialVerification(it(type, source, 'Grupo A: Grupo A'), ctx()), 'UNVERIFIED');
});
test('QUESTION → null', () => {
  for (const source of ['BASTANTEO', 'HUMAN', 'SKILL']) assert.equal(initialVerification(it('QUESTION', source, 'Grupo A: Grupo A'), ctx()), null);
  const r = createReasoningItem({ id: 'q', source: 'HUMAN', type: 'QUESTION', text: '¿Quién firma?' }, ctx());
  assert.deepEqual(r, { ok: true, item: { id: 'q', contextVersion: 'v1', source: 'HUMAN', text: '¿Quién firma?', type: 'QUESTION', verification: null } });
});
test('un contexto inválido no crea ítems ni alimenta el razonamiento', () => {
  const r = createReasoningItem({ id: 'i', source: 'BASTANTEO', type: 'FACT', text: 'Grupo A: Grupo A' }, ctx({ extra: 1 }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map(e => `${e.code} ${e.path}`), ['UNKNOWN_FIELD $.extra']);
});

// ---------------------------------------------------------------- transiciones
const registro = (verification, contextVersion = 'v1') =>
  startVerification({ id: 'i', contextVersion, source: 'SKILL', type: 'HYPOTHESIS', text: 'x', verification });
let n = 0;
const ev = (kind, contextVersion = 'v1') => ({ id: `e${++n}`, contextVersion, source: 'HUMAN', kind });
test('tabla de transiciones completa', () => {
  const tabla = [
    ['UNVERIFIED', 'SUPPORTS', 'VERIFIED'], ['UNVERIFIED', 'CONTRADICTS', 'REFUTED'], ['UNVERIFIED', 'INCONCLUSIVE', 'INDETERMINATE'],
    ['VERIFIED', 'COMPATIBLE', 'VERIFIED'], ['VERIFIED', 'CONTRADICTS', 'REFUTED'], ['VERIFIED', 'INCONCLUSIVE', 'INDETERMINATE'],
    ['REFUTED', 'SUPPORTS', 'VERIFIED'], ['REFUTED', 'COMPATIBLE', 'REFUTED'], ['REFUTED', 'INCONCLUSIVE', 'INDETERMINATE'],
    ['INDETERMINATE', 'SUPPORTS', 'VERIFIED'], ['INDETERMINATE', 'CONTRADICTS', 'REFUTED'], ['INDETERMINATE', 'INCONCLUSIVE', 'INDETERMINATE'],
  ];
  for (const [desde, kind, hasta] of tabla) {
    const r = applyEvidence(registro(desde), ev(kind));
    assert.equal(r.item.verification, hasta, `${desde} + ${kind}`);
    assert.equal(r.history.length, 2);
    assert.deepEqual(r.history[1], { from: desde, to: hasta, cause: { type: 'EVIDENCE', evidenceId: r.evidenceIds[0], kind } });
  }
});
test('sin evidencia nueva el estado no cambia (ninguna, repetida o de otro contexto)', () => {
  const r0 = registro('UNVERIFIED');
  assert.equal(applyEvidence(r0, null), r0);
  assert.equal(applyEvidence(r0, ev('SUPPORTS', 'v0')), r0);
  const e = ev('CONTRADICTS'), r1 = applyEvidence(r0, e);
  assert.equal(applyEvidence(r1, e), r1);
  assert.equal(applyEvidence(r1, { ...e, kind: 'SUPPORTS' }), r1);
  assert.equal(r0.item.verification, 'UNVERIFIED');
});
test('cambio de contextVersion invalida la verificación anterior y conserva el historial', () => {
  const c1 = ctx();
  const creado = createReasoningItem({ id: 'f', source: 'BASTANTEO', type: 'FACT', text: 'Firmante F2 pertenece al grupo A' }, c1);
  let r = startVerification(creado.item);
  assert.equal(r.item.verification, 'VERIFIED');
  r = applyEvidence(r, ev('CONTRADICTS'));
  assert.equal(r.item.verification, 'REFUTED');
  // Misma versión: no cambia nada.
  assert.equal(changeContext(r, c1).record, r);
  // Versión nueva sin F2: la verificación se recalcula contra el contexto nuevo; la evidencia anterior no cuenta.
  const c2 = ctx({ version: 'v2', firmantes: [c1.firmantes[0]], pertenencias: [c1.pertenencias[0]], participaciones: [c1.participaciones[0]] });
  const cambio = changeContext(r, c2);
  assert.equal(cambio.ok, true);
  assert.equal(cambio.record.item.contextVersion, 'v2');
  assert.equal(cambio.record.item.verification, 'UNVERIFIED');
  assert.deepEqual(cambio.record.evidenceIds, []);
  assert.deepEqual(cambio.record.history.map(h => h.cause.type), ['INITIAL', 'EVIDENCE', 'CONTEXT_CHANGE']);
  // La evidencia del contexto anterior ya no aplica.
  assert.equal(applyEvidence(cambio.record, ev('SUPPORTS', 'v1')), cambio.record);
  // Un contexto nuevo inválido no reverifica.
  assert.equal(changeContext(r, ctx({ version: 'v3', extra: 1 })).ok, false);
});
