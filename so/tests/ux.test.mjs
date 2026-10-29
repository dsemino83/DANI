import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretar, resolverArtefacto } from '../intent.js';
import { parseMes, comparar, analizar, filtrar, confianza } from '../analisis.js';
import { crearEstado, chips, riesgo, explicarPermiso, paraContinuidad } from '../estado.js';
import { rankear, puntaje } from '../busqueda.js';

const arts = [{ id: 'a1', name: 'Dashboard de ventas' }, { id: 'a2', name: 'Dashboard de gastos' }];
const ctx = { artefactos: arts, activoId: 'a1', mesReferencia: '2026-09', hoy: '2026-10-29' };
const recs = [
  { period: '2026-08-03', data: { monto: 1000, canal: 'web' } },
  { period: '2026-08-20', data: { monto: 500, canal: 'local' } },
  { period: '2026-09-02', data: { monto: 400, canal: 'web' } },
  { period: '2026-09-15', data: { monto: 900, canal: 'local' } },
];
const campos = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }];

test('meses: nombres, año inferido y referencias relativas', () => {
  assert.equal(parseMes('comparalo con agosto', '2026-09'), '2026-08');
  assert.equal(parseMes('noviembre', '2026-09'), '2025-11');
  assert.equal(parseMes('septiembre de 2025', '2026-10'), '2025-09');
  assert.equal(parseMes('setiembre', '2026-10'), '2026-09');
  assert.equal(parseMes('el mes pasado', '2026-01'), '2025-12');
  assert.equal(parseMes('nada', '2026-01'), null);
});

test('command center hereda contexto: "Comparalo con agosto" no pregunta tablero ni período', () => {
  assert.deepEqual(interpretar('Comparalo con agosto.', ctx), { tipo: 'comparar', artefactoId: 'a1', mesA: null, mesB: '2026-08' });
  assert.deepEqual(interpretar('compará septiembre con agosto en el de gastos', ctx), { tipo: 'comparar', artefactoId: 'a2', mesA: '2026-09', mesB: '2026-08' });
  assert.equal(interpretar('compartilo con x@y.com', ctx).tipo, 'compartir');
});

test('filtros por conversación y quitar filtro', () => {
  assert.deepEqual(interpretar('Mostrame sólo Buenos Aires', ctx), { tipo: 'filtrar', artefactoId: 'a1', valor: 'Buenos Aires' });
  assert.deepEqual(interpretar('sacá el filtro', ctx), { tipo: 'filtrar', valor: null });
  assert.equal(interpretar('compartí el de gastos con x@y.com solo lectura', ctx).permiso, 'VIEW');
});

test('período, análisis, por qué, abrir, favoritos, deshacer, proyectos, persistir', () => {
  assert.deepEqual(interpretar('mostrame octubre', ctx), { tipo: 'periodo', artefactoId: 'a1', mes: '2026-10' });
  assert.deepEqual(interpretar('Analizá mis ventas', { ...ctx, activoId: null }), { tipo: 'analizar', artefactoId: 'a1' });
  assert.equal(interpretar('¿Por qué bajó esto?', ctx).tipo, 'por_que');
  assert.deepEqual(interpretar('Abrí el dashboard que usamos ayer', ctx), { tipo: 'abrir', cuando: 1 });
  assert.deepEqual(interpretar('abrí el de gastos', ctx), { tipo: 'abrir', artefactoId: 'a2' });
  assert.deepEqual(interpretar('marcalo como favorito', ctx), { tipo: 'favorito', artefactoId: 'a1', valor: true });
  assert.deepEqual(interpretar('deshacé', ctx), { tipo: 'deshacer' });
  assert.deepEqual(interpretar('Creá un proyecto Comercial', ctx), { tipo: 'proyecto_crear', nombre: 'Comercial' });
  assert.deepEqual(interpretar('cambiá al proyecto Comercial', ctx), { tipo: 'proyecto_cambiar', nombre: 'Comercial' });
  assert.deepEqual(interpretar('Guardá este histórico', ctx), { tipo: 'persistir', artefactoId: 'a1' });
  assert.equal(interpretar('Analizá mis ventas', { artefactos: [] }).tipo, 'sin_datos');
});

test('resolver por palabras del nombre', () => {
  assert.equal(resolverArtefacto('analizá las ventas', arts, null).id, 'a1');
});

test('comparación con evidencia, aporte por categoría y confianza', () => {
  const c = comparar(recs, campos[0], '2026-09', '2026-08', campos[1], '2026-10-29');
  assert.equal(c.delta, -200);
  assert.ok(Math.abs(c.variacion + 200 / 1500) < 1e-9);
  assert.equal(c.confianza.nivel, 'confirmado');
  assert.deepEqual(c.aportes[0], { categoria: 'web', delta: -600 });
  assert.match(c.texto, /bajó −13,33% en Septiembre 2026 respecto de Agosto 2026: 1\.300 vs\. 1\.500\. El mayor cambio vino de Canal "web"/);
  assert.equal(c.evidencia.registros, 4);
  assert.equal(confianza([{ mes: '2026-10', n: 3 }], '2026-10-29').nivel, 'incompleta');
  assert.equal(comparar(recs, campos[0], '2026-07', '2026-08', null, '2026-10-29').confianza.nivel, 'incompleta');
});

test('análisis general y filtros', () => {
  const a = analizar(recs, campos, '2026-10-29');
  assert.match(a.texto, /El mejor mes registrado es Agosto 2026/);
  assert.equal(filtrar(recs, { filtro: { key: 'canal', valor: 'WEB' } }).length, 2);
  assert.equal(filtrar(recs, { desde: '2026-09', hasta: '2026-09' }).length, 2);
  assert.equal(analizar([], campos).confianza.nivel, 'incompleta');
});

test('estado único: UI y Francisco comparten fuente de verdad; cambiar de artefacto limpia contexto', () => {
  const e = crearEstado();
  const vistos = [];
  e.sub((s) => vistos.push(s.filtro?.valor ?? null));
  e.set({ artefactoId: 'a1' });
  e.set({ filtro: { key: 'canal', valor: 'web' }, desde: '2026-09', hasta: '2026-09' });
  assert.deepEqual(chips(e.get(), { proyecto: 'Trabajo', artefacto: 'Ventas', periodo: 'Septiembre 2026' }).map((c) => c.id),
    ['proyecto', 'artefacto', 'periodo', 'filtro']);
  e.set({ artefactoId: 'a2' });
  assert.equal(e.get().filtro, null);
  assert.equal(e.get().desde, null);
  assert.deepEqual(vistos, [null, 'web', null]);
  assert.deepEqual(Object.keys(paraContinuidad({ ...e.get(), seleccion: { x: 1 } })).includes('seleccion'), false);
});

test('riesgo por acción y permisos en lenguaje claro', () => {
  assert.equal(riesgo({ tipo: 'borrar_datos' }), 'alto');
  assert.equal(riesgo({ tipo: 'compartir', permiso: 'EDIT' }), 'alto');
  assert.equal(riesgo({ tipo: 'compartir', permiso: 'USE' }), 'medio');
  assert.equal(riesgo({ tipo: 'crear' }), 'medio');
  assert.equal(riesgo({ tipo: 'comparar' }), 'bajo');
  assert.equal(explicarPermiso('maria@x.com', 'USE', 'Ventas'), 'maria@x.com puede usar Ventas (ver y cargar datos), pero no modificarlo.');
});

test('búsqueda difusa con relevancia + recencia + frecuencia', () => {
  assert.ok(puntaje('vtas', 'Dashboard de ventas') > 0);
  assert.equal(puntaje('xyz', 'Dashboard de ventas'), 0);
  const ahora = Date.parse('2026-10-29T12:00:00Z');
  const r = rankear('dash', [
    { titulo: 'Dashboard de gastos', fecha: '2026-01-01', frecuencia: 0 },
    { titulo: 'Dashboard de ventas', fecha: '2026-10-28', frecuencia: 20 },
    { titulo: 'Notas', fecha: '2026-10-29' },
  ], ahora);
  assert.deepEqual(r.map((x) => x.titulo), ['Dashboard de ventas', 'Dashboard de gastos']);
});
