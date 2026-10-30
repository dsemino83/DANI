// Monitoreo sintético: solo lectura y sin datos sensibles. node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { RUTAS_LECTURA, exigirLectura, errorSeguro } = await import('../src/jobs/monitoreo-sintetico.js');
const { readFileSync } = await import('node:fs');

test('monitoreo sintético: solo rutas de lectura autorizadas', () => {
  assert.doesNotThrow(() => exigirLectura(RUTAS_LECTURA[0]));
  for (const ruta of ['transfers/immediates', 'transfers/transferMep', 'accounts/getBalancesDetail', 'accounts/getMovementsDetail', 'echeq/getTransfersStatus']) {
    assert.throws(() => exigirLectura(ruta), /solo puede usar rutas de lectura/);
  }
  assert.ok(RUTAS_LECTURA.every((r) => !/transfer|balance|movement/i.test(r)));
});

test('monitoreo sintético: nunca envía (sin envio:true) ni usa clientes de envío', () => {
  const src = readFileSync(new URL('../src/jobs/monitoreo-sintetico.js', import.meta.url), 'utf8');
  assert.ok(!/envio:\s*true/.test(src));
  assert.ok(!/enviar\(|bdvEnvios|transferencias\.js/.test(src));
});

test('monitoreo sintético: el error se loguea sin URLs ni números largos', () => {
  const e = errorSeguro(new Error('fallo https://banco.test/x con cuenta 1234567890123 y CBU 0170099220000067797370'));
  assert.ok(!/https?:/.test(e));
  assert.ok(!/\d{6,}/.test(e));
});
