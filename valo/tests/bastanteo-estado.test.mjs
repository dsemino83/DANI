// Tests de runtime de la máquina de estados del análisis de Bastanteo (valo/bastanteo/estado.mts).
// Node ejecuta el .mts directo (type stripping); no hace falta compilar ni instalar nada. Correr: npm run test:bastanteo
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, receive } from '../bastanteo/estado.mts';

const DATA = { reglas: 3 };
const OK = { status: 'OK', summary: 'sin observaciones', findings: [] };
const OBS = { status: 'ERROR', summary: 'firmante sin poder', findings: ['APELLIDO1 no figura en los poderes'] };
const FALLA = { message: 'timeout' };

// Atajos para llegar a cada estado.
const loading = (grouping = 'G1') => transition(initialState, { type: 'LOAD_CONTEXT', grouping }).state;
function ready(grouping = 'G1') {
  const l = loading(grouping);
  return transition(l, { type: 'CONTEXT_LOADED', contextVersion: l.contextVersion, data: DATA }).state;
}
function sending(requestId = 'r1') {
  return transition(ready(), { type: 'SEND', requestId }).state;
}

test('IDLE → LOADING_CONTEXT', () => {
  const r = transition(initialState, { type: 'LOAD_CONTEXT', grouping: 'G1' });
  assert.equal(r.outcome, 'APPLIED');
  assert.equal(r.state.status, 'LOADING_CONTEXT');
  assert.equal(r.state.grouping, 'G1');
  assert.equal(r.state.contextVersion, 1);
});

test('LOADING_CONTEXT → READY', () => {
  const l = loading();
  const r = transition(l, { type: 'CONTEXT_LOADED', contextVersion: l.contextVersion, data: DATA });
  assert.equal(r.state.status, 'READY');
  assert.deepEqual(r.state.context, { grouping: 'G1', contextVersion: 1, data: DATA });
  assert.equal(r.state.analysis, null);
});

test('LOADING_CONTEXT → ERROR (técnico, al cargar el contexto)', () => {
  const l = loading();
  const r = transition(l, { type: 'CONTEXT_FAILED', contextVersion: l.contextVersion, error: FALLA });
  assert.equal(r.state.status, 'ERROR');
  assert.equal(r.state.stage, 'CONTEXT');
  assert.deepEqual(r.state.error, FALLA);
});

test('LOADING_CONTEXT + SELECT_GROUPING → LOADING_CONTEXT (versión nueva)', () => {
  const l = loading('G1');
  const r = transition(l, { type: 'SELECT_GROUPING', grouping: 'G2' });
  assert.equal(r.state.status, 'LOADING_CONTEXT');
  assert.equal(r.state.grouping, 'G2');
  assert.equal(r.state.contextVersion, l.contextVersion + 1);
});

test('READY → SENDING', () => {
  const s = ready();
  const r = transition(s, { type: 'SEND', requestId: 'r1' });
  assert.equal(r.state.status, 'SENDING');
  assert.equal(r.state.requestId, 'r1');
  assert.equal(r.state.contextVersion, s.contextVersion);
});

test('READY + SELECT_GROUPING → LOADING_CONTEXT', () => {
  const s = ready('G1');
  const r = transition(s, { type: 'SELECT_GROUPING', grouping: 'G2' });
  assert.equal(r.state.status, 'LOADING_CONTEXT');
  assert.equal(r.state.grouping, 'G2');
  assert.equal(r.state.contextVersion, s.contextVersion + 1);
});

test('SENDING → READY con respuesta válida (mismo requestId y contextVersion)', () => {
  const s = sending('r1');
  const r = transition(s, { type: 'RESPONSE', requestId: 'r1', contextVersion: s.contextVersion, analysis: OK });
  assert.equal(r.outcome, 'APPLIED');
  assert.equal(r.state.status, 'READY');
  assert.deepEqual(r.state.analysis, OK);
});

test('un análisis con estado ERROR no es un error técnico: queda READY', () => {
  const s = sending('r1');
  const r = transition(s, { type: 'RESPONSE', requestId: 'r1', contextVersion: s.contextVersion, analysis: OBS });
  assert.equal(r.state.status, 'READY');
  assert.equal(r.state.analysis.status, 'ERROR');
});

test('se preserva el analysis mientras se envía y si el envío falla', () => {
  const s1 = sending('r1');
  const conAnalisis = transition(s1, { type: 'RESPONSE', requestId: 'r1', contextVersion: s1.contextVersion, analysis: OK }).state;
  const s2 = transition(conAnalisis, { type: 'SEND', requestId: 'r2' }).state;
  assert.deepEqual(s2.analysis, OK);
  const err = transition(s2, { type: 'FAILURE', requestId: 'r2', contextVersion: s2.contextVersion, error: FALLA }).state;
  assert.equal(err.status, 'ERROR');
  assert.deepEqual(err.analysis, OK);
  const retry = transition(err, { type: 'RETRY', requestId: 'r3' }).state;
  assert.deepEqual(retry.analysis, OK);
});

test('respuesta con requestId obsoleto → IGNORED', () => {
  const s = sending('r2');
  const r = transition(s, { type: 'RESPONSE', requestId: 'r1', contextVersion: s.contextVersion, analysis: OK });
  assert.equal(r.outcome, 'IGNORED');
  assert.equal(r.reason, 'STALE_REQUEST');
  assert.equal(r.state, s);
});

test('respuesta con contextVersion obsoleta → IGNORED', () => {
  const s = sending('r1');
  const r = transition(s, { type: 'RESPONSE', requestId: 'r1', contextVersion: s.contextVersion - 1, analysis: OK });
  assert.equal(r.outcome, 'IGNORED');
  assert.equal(r.reason, 'STALE_CONTEXT');
  assert.equal(r.state, s);
});

test('error con requestId obsoleto → IGNORED', () => {
  const s = sending('r2');
  const r = transition(s, { type: 'FAILURE', requestId: 'r1', contextVersion: s.contextVersion, error: FALLA });
  assert.equal(r.outcome, 'IGNORED');
  assert.equal(r.state, s);
});

test('SENDING → ERROR con error válido', () => {
  const s = sending('r1');
  const r = transition(s, { type: 'FAILURE', requestId: 'r1', contextVersion: s.contextVersion, error: FALLA });
  assert.equal(r.state.status, 'ERROR');
  assert.equal(r.state.stage, 'REQUEST');
  assert.equal(r.state.requestId, 'r1');
});

test('SENDING + SELECT_GROUPING → LOADING_CONTEXT', () => {
  const s = sending('r1');
  const r = transition(s, { type: 'SELECT_GROUPING', grouping: 'G2' });
  assert.equal(r.state.status, 'LOADING_CONTEXT');
  assert.equal(r.state.grouping, 'G2');
  assert.equal(r.state.contextVersion, s.contextVersion + 1);
});

test('ERROR → SENDING mediante RETRY (requestId nuevo)', () => {
  const s = sending('r1');
  const err = transition(s, { type: 'FAILURE', requestId: 'r1', contextVersion: s.contextVersion, error: FALLA }).state;
  const r = transition(err, { type: 'RETRY', requestId: 'r2' });
  assert.equal(r.state.status, 'SENDING');
  assert.equal(r.state.requestId, 'r2');
  assert.equal(r.state.contextVersion, s.contextVersion);
  // Reintentar con el mismo requestId no vale: la respuesta del pedido fallido no se podría distinguir.
  assert.equal(transition(err, { type: 'RETRY', requestId: 'r1' }).outcome, 'IGNORED');
});

test('ERROR → LOADING_CONTEXT mediante RETRY_CONTEXT', () => {
  const l = loading('G1');
  const err = transition(l, { type: 'CONTEXT_FAILED', contextVersion: l.contextVersion, error: FALLA }).state;
  const r = transition(err, { type: 'RETRY_CONTEXT' });
  assert.equal(r.state.status, 'LOADING_CONTEXT');
  assert.equal(r.state.grouping, 'G1');
  assert.equal(r.state.contextVersion, l.contextVersion + 1);
  // Sin contexto no hay análisis para reintentar.
  assert.equal(transition(err, { type: 'RETRY', requestId: 'r9' }).reason, 'NO_CONTEXT');
});

test('el cambio de agrupamiento invalida el contexto anterior', () => {
  const l1 = loading('G1');
  const l2 = transition(l1, { type: 'SELECT_GROUPING', grouping: 'G2' }).state;
  // Llega tarde el contexto de G1: se ignora.
  const tarde = receive(l2, { type: 'CONTEXT_LOADED', contextVersion: l1.contextVersion, data: { de: 'G1' } });
  assert.equal(tarde.outcome, 'IGNORED');
  assert.equal(tarde.reason, 'STALE_CONTEXT');
  const ok = receive(l2, { type: 'CONTEXT_LOADED', contextVersion: l2.contextVersion, data: { de: 'G2' } });
  assert.equal(ok.state.status, 'READY');
  assert.deepEqual(ok.state.context.data, { de: 'G2' });
  // Desde READY: el análisis del agrupamiento anterior no pasa al nuevo.
  const s = sending('r1');
  const conAnalisis = transition(s, { type: 'RESPONSE', requestId: 'r1', contextVersion: s.contextVersion, analysis: OK }).state;
  const nuevo = transition(transition(conAnalisis, { type: 'SELECT_GROUPING', grouping: 'G2' }).state,
    { type: 'CONTEXT_LOADED', contextVersion: conAnalisis.contextVersion + 1, data: DATA }).state;
  assert.equal(nuevo.analysis, null);
});

test('una respuesta obsoleta nunca modifica el estado actual (en ningún estado)', () => {
  const s = sending('r1');
  const respuesta = { type: 'RESPONSE', requestId: 'r1', contextVersion: s.contextVersion, analysis: OK };
  const error = { type: 'FAILURE', requestId: 'r1', contextVersion: s.contextVersion, error: FALLA };
  // Después de cambiar de agrupamiento, la respuesta y el error del pedido anterior llegan tarde.
  const l = transition(s, { type: 'SELECT_GROUPING', grouping: 'G2' }).state;
  const r2 = ready('G2');
  const s3 = transition(r2, { type: 'SEND', requestId: 'r7' }).state;
  const e3 = transition(s3, { type: 'FAILURE', requestId: 'r7', contextVersion: s3.contextVersion, error: FALLA }).state;
  for (const estado of [initialState, l, r2, s3, e3]) {
    const copia = structuredClone(estado);
    for (const msg of [respuesta, error]) {
      const r = receive(estado, msg);
      assert.equal(r.outcome, 'IGNORED', `${estado.status} + ${msg.type}`);
      assert.equal(r.state, estado);
      assert.deepEqual(estado, copia);
    }
  }
});
