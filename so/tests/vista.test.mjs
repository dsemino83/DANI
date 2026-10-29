import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porMes, porCategoria, kpis } from '../vista.js';

const recs = [
  { period: '2026-01-05', data: { monto: 100, canal: 'web' } },
  { period: '2026-01-20', data: { monto: 50, canal: 'local' } },
  { period: '2026-02-03', data: { monto: 300, canal: 'web' } },
  { period: '2026-02-04', data: { canal: 'web' } },
];

test('agregación mensual ordenada y sin vacíos', () => {
  assert.deepEqual(porMes(recs, 'monto'), [{ mes: '2026-01', total: 150 }, { mes: '2026-02', total: 300 }]);
});

test('KPIs: total, último mes y variación', () => {
  const k = kpis(recs, 'monto');
  assert.equal(k.total, 450);
  assert.equal(k.registros, 3);
  assert.deepEqual(k.ultimoMes, { mes: '2026-02', total: 300 });
  assert.equal(k.variacion, 1);
});

test('por categoría con tope de 8 ("Otros")', () => {
  assert.deepEqual(porCategoria(recs, 'monto', 'canal'), [{ nombre: 'web', total: 400 }, { nombre: 'local', total: 50 }]);
  const muchas = Array.from({ length: 10 }, (_, i) => ({ period: '2026-01-01', data: { monto: 10 - i, canal: `c${i}` } }));
  const r = porCategoria(muchas, 'monto', 'canal');
  assert.equal(r.length, 8);
  assert.deepEqual(r.at(-1), { nombre: 'Otros', total: 3 + 2 + 1 });
});
