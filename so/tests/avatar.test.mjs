import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPEO, EMOCIONES } from '../avatar.js';

test('mapeo de eventos a emociones del spec', () => {
  assert.deepEqual(MAPEO, { typing: 'listening', processing: 'thinking', research: 'curious', execution: 'focused',
    streaming: 'understanding', success: 'success', recoverableFailure: 'concerned', error: 'error', idle: 'neutral' });
  for (const e of Object.values(MAPEO)) assert.ok(EMOCIONES.includes(e));
  assert.equal(EMOCIONES.length, 13);
});
