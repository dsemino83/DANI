import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, mapear, numeroAR } from '../importar.js';
import { haceCuanto } from '../vista.js';

const campos = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }];

test('CSV con ; , comillas y BOM', () => {
  assert.deepEqual(parseCSV('﻿fecha;Monto;Canal\n31/08/2026;"1.500,50";"web; online"\n\n'),
    [['fecha', 'Monto', 'Canal'], ['31/08/2026', '1.500,50', 'web; online']]);
  assert.deepEqual(parseCSV('a,b\r\n"x ""y""",2'), [['a', 'b'], ['x "y"', '2']]);
});

test('números en formato argentino e inglés', () => {
  assert.equal(numeroAR('1.500,50'), 1500.5);
  assert.equal(numeroAR('$ 2.000'), 2000);
  assert.equal(numeroAR('1,234.5'), 1234.5);
  assert.equal(numeroAR('12,5'), 12.5);
  assert.ok(Number.isNaN(numeroAR('abc')));
});

test('mapeo por etiqueta, fecha, filas inválidas omitidas con motivo', () => {
  const r = mapear(parseCSV('Fecha,monto,CANAL,otra\n2026-08-01,100,web,x\n2026-08-02,abc,local,y\nmal,5,web,z\n,,,'), campos, '2026-10-29');
  assert.deepEqual(r.filas, [{ linea: 2, period: '2026-08-01', data: { monto: 100, canal: 'web' } }]);
  assert.deepEqual(r.omitidas.map((o) => o.linea), [3, 4]);
  assert.deepEqual(r.sinUsar, ['otra']);
  assert.deepEqual(r.columnas, { monto: 'monto', CANAL: 'canal' });
});

test('frescura legible', () => {
  const ahora = Date.parse('2026-10-29T12:00:00Z');
  assert.equal(haceCuanto('2026-10-29T11:55:00Z', ahora), 'hace 5 min');
  assert.equal(haceCuanto('2026-10-28T12:00:00Z', ahora), 'hace 1 día');
  assert.equal(haceCuanto(null, ahora), 'sin datos');
});
