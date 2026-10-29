import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarHorario as h, proximaEjecucion as prox, describirHorario as desc, FORMATOS_SERVIDOR } from '../archivos/programadas.js';

const BA = 'America/Argentina/Buenos_Aires';
const jue = new Date('2026-10-29T15:00:00Z');   // jueves 12:00 en Buenos Aires

test('horarios en lenguaje natural', () => {
  assert.deepEqual(h('Cada lunes generá el informe'), { tipo: 'semanal', dias: [1], hora: '09:00', tz: BA });
  assert.deepEqual(h('todos los lunes y jueves a las 18:30'), { tipo: 'semanal', dias: [1, 4], hora: '18:30', tz: BA });
  assert.deepEqual(h('de lunes a viernes a las 7 am').dias, [1, 2, 3, 4, 5]);
  assert.equal(h('cada día a las 8 de la noche').hora, '20:00');
  assert.deepEqual(h('el último día de cada mes a las 20'), { tipo: 'mensual', dia: 'ultimo', hora: '20:00', tz: BA });
  assert.equal(h('todos los meses el día 15 a las 10').dia, 15);
  assert.equal(h('cada 3 horas'), null, 'intervalos menores a un día: no');
  assert.equal(h('cada lunes a las 25'), null, 'hora inválida');
  assert.equal(desc(h('de lunes a viernes a las 8')), 'de lunes a viernes a las 08:00');
  assert.equal(desc(h('cada lunes y jueves')), 'cada lunes y jueves a las 09:00');
});

test('próxima ejecución en la zona del usuario', () => {
  assert.equal(prox(h('cada lunes a las 9'), jue).toISOString(), '2026-11-02T12:00:00.000Z');
  assert.equal(prox(h('todos los jueves a las 12:00'), jue).toISOString(), '2026-11-05T15:00:00.000Z', 'estrictamente posterior: no repite el turno actual');
  assert.equal(prox(h('todos los jueves a las 12:01'), jue).toISOString(), '2026-10-29T15:01:00.000Z');
  assert.equal(prox(h('el último día de cada mes a las 20'), new Date('2027-02-10T00:00:00Z')).toISOString(), '2027-02-28T23:00:00.000Z', '28 de febrero 20:00 en Buenos Aires (UTC−3)');
  assert.equal(prox(h('el 31 de cada mes'), new Date('2026-11-01T00:00:00Z')).toISOString().slice(0, 10), '2026-11-30', 'día que no existe → último del mes');
});

test('cambio de horario (Madrid): la hora local se respeta en los dos sentidos', () => {
  const lunes9 = h('cada lunes a las 9', { tz: 'Europe/Madrid' });
  assert.equal(prox(lunes9, new Date('2026-10-13T00:00:00Z')).toISOString(), '2026-10-19T07:00:00.000Z', 'verano: UTC+2');
  assert.equal(prox(lunes9, new Date('2026-10-20T00:00:00Z')).toISOString(), '2026-10-26T08:00:00.000Z', 'invierno: UTC+1');
  assert.equal(prox(lunes9, new Date('2027-03-23T00:00:00Z')).toISOString(), '2027-03-29T07:00:00.000Z', 'vuelta al verano');
});

test('el servidor no promete imágenes', () => {
  for (const f of ['png', 'jpg', 'webp', 'zip']) assert.ok(!FORMATOS_SERVIDOR.includes(f), f);
  for (const f of ['pdf', 'xlsx', 'docx', 'pptx', 'csv']) assert.ok(FORMATOS_SERVIDOR.includes(f), f);
});

import { docDeDatos, exportacionDe } from '../archivos/doc.js';
test('exportación separada de la visualización: se ve resumido y se exporta el detalle completo', () => {
  const fields = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }, { key: 'nota', label: 'Nota', type: 'text' }];
  const records = [['2026-08-10', 100, 'web'], ['2026-08-11', 50, 'local'], ['2026-09-10', 70, 'web'], ['2026-09-11', 30, 'local']].map(([period, monto, canal]) => ({ period, data: { monto, canal, nota: 'x' } }));
  const vista = { filtro: { key: 'canal', valor: 'web' }, desde: '2026-09', hasta: '2026-09' };   // lo que se ve: solo web de septiembre
  const tabla = (doc, t) => doc.secciones.find((s) => s.titulo === t)?.tabla;
  // Por defecto: exporta lo que se ve.
  let { doc } = docDeDatos({ name: 'V', configuration: {} }, { fields, records }, vista);
  assert.equal(tabla(doc, 'Detalle').filas.length, 1);
  // Configurado: todos los datos, solo el detalle, columnas Monto y Canal.
  const a = { name: 'V', configuration: { exportacion: { datos: 'todo', secciones: { resumen: false, mensual: false, detalle: true }, columnas: ['monto', 'canal'] } } };
  ({ doc } = docDeDatos(a, { fields, records }, vista));
  assert.deepEqual(doc.secciones.map((s) => s.titulo), ['Detalle']);
  assert.equal(tabla(doc, 'Detalle').filas.length, 4, 'historial completo aunque la vista esté filtrada');
  assert.deepEqual(tabla(doc, 'Detalle').columnas.map((c) => c.label), ['Fecha', 'Monto', 'Canal']);
  // Un pedido puntual ("exportá todos los datos") manda sobre lo guardado.
  ({ doc } = docDeDatos({ name: 'V', configuration: {} }, { fields, records }, vista, { datos: 'todo' }));
  assert.equal(tabla(doc, 'Detalle').filas.length, 4);
  // Sin secciones con tabla, igual queda el detalle (CSV/Excel la necesitan).
  ({ doc } = docDeDatos({ name: 'V', configuration: { exportacion: { secciones: { resumen: true, mensual: false, detalle: false } } } }, { fields, records }, {}));
  assert.ok(tabla(doc, 'Detalle'));
  assert.deepEqual(exportacionDe({}), { datos: 'vista', secciones: { resumen: true, mensual: true, detalle: true }, columnas: null, aperturas: [] });
});

test('aperturas al exportar (modelo saldo de deuda): por campo y mes, por campo y por día con subtotal mensual', () => {
  const fields = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }];
  const records = [['2026-08-10', 100, 'web'], ['2026-08-11', 50, 'local'], ['2026-09-10', 70, 'web'], ['2026-09-10', 5, 'web']].map(([period, monto, canal]) => ({ period, data: { monto, canal } }));
  const a = { name: 'V', configuration: { exportacion: { aperturas: [{ tipo: 'campo_mes', campo: 'canal' }, { tipo: 'dia' }, { tipo: 'campo', campo: 'canal' }, { tipo: 'raro' }] } } };
  const { doc } = docDeDatos(a, { fields, records }, {});
  const t = (n) => doc.secciones.find((s) => s.titulo === n)?.tabla;
  assert.deepEqual(t('Por Canal y mes').filas, [['web', 100, 75, 175], ['local', 50, null, 50], ['Total', 150, 75, 225]]);
  assert.deepEqual(t('Apertura por día').filas.map((f) => f[1]), ['2026-08-10', '2026-08-11', 'Total del mes', '2026-09-10', 'Total del mes', '']);
  assert.equal(t('Apertura por día').filas.at(-1)[2], 225);
  assert.deepEqual(t('Por Canal').filas.at(-1), ['Total', 225, 100]);
  assert.equal(exportacionDe(a).aperturas.length, 3, 'tipos desconocidos se ignoran');
});
