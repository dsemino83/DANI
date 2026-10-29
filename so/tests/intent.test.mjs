import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretar, requierePersistencia, resolverArtefacto, armarRegistro, camposExplicitos } from '../intent.js';

const arts = [
  { id: 'a1', name: 'Dashboard de ventas', type: 'dashboard' },
  { id: 'a2', name: 'Dashboard de gastos', type: 'dashboard' },
];

test('crear dashboard con histórico: artefacto + persistencia + campos por tema', () => {
  const r = interpretar('Creá un dashboard de ventas con histórico.');
  assert.equal(r.tipo, 'crear');
  assert.equal(r.artefacto.type, 'dashboard');
  assert.equal(r.artefacto.name, 'Dashboard de ventas');
  assert.equal(r.artefacto.persistentStorage, true);
  assert.deepEqual(r.artefacto.campos.map((c) => c.key), ['monto', 'unidades', 'canal']);
});

test('regla determinista de persistencia', () => {
  for (const t of ['guardá el histórico', 'quiero ver la evolución', 'seguimiento mensual', 'comparar períodos', 'cargar datos'])
    assert.equal(requierePersistencia(t), true, t);
  assert.equal(requierePersistencia('mostrame un gráfico'), false);
});

test('campos explícitos con tipos inferidos', () => {
  const c = camposExplicitos('armá un tablero de stock con campos producto, cantidad y fecha de ingreso');
  assert.deepEqual(c.map((x) => [x.key, x.type]), [['producto', 'text'], ['cantidad', 'number'], ['fecha_de_ingreso', 'date']]);
});

test('modo personal: no publica artefactos', () => {
  assert.deepEqual(interpretar('creá un dashboard de ventas', { modo: 'personal' }), { tipo: 'bloqueado', motivo: 'personal' });
  assert.equal(interpretar('hola, ¿cómo va?', { modo: 'personal' }).tipo, 'chat');
});

test('referencias contextuales: este dashboard / el de ventas', () => {
  assert.equal(resolverArtefacto('agregale vendedor a este dashboard', arts, 'a2').id, 'a2');
  assert.equal(resolverArtefacto('agregale vendedor al de ventas', arts, 'a2').id, 'a1');
  assert.equal(resolverArtefacto('agregale vendedor', [arts[0]], null).id, 'a1');
  assert.equal(resolverArtefacto('agregale vendedor', arts, null), null);
});

test('agregar campos al artefacto activo', () => {
  const r = interpretar('Agregale vendedor y comisión a este dashboard', { artefactos: arts, activoId: 'a1' });
  assert.equal(r.tipo, 'agregar_campos');
  assert.equal(r.artefactoId, 'a1');
  assert.deepEqual(r.campos.map((c) => c.key), ['vendedor', 'comision']);
});

test('agregar gráfico', () => {
  const r = interpretar('agregale un gráfico de barras', { artefactos: arts, activoId: 'a2' });
  assert.deepEqual(r, { tipo: 'grafico', artefactoId: 'a2', grafico: 'bar' });
});

test('compartir: default USE, VIEW y EDIT; nunca sin correo', () => {
  assert.deepEqual(interpretar('Compartilo con Ana@Empresa.com', { artefactos: arts, activoId: 'a1' }),
    { tipo: 'compartir', artefactoId: 'a1', email: 'ana@empresa.com', permiso: 'USE' });
  assert.equal(interpretar('compartí el de gastos con x@y.com solo lectura', { artefactos: arts }).permiso, 'VIEW');
  assert.equal(interpretar('compartilo con x@y.com para editar', { artefactos: arts, activoId: 'a1' }).permiso, 'EDIT');
  assert.equal(interpretar('compartilo con Juan', { artefactos: arts, activoId: 'a1' }).tipo, 'falta_email');
});

test('revocar', () => {
  const r = interpretar('dejá de compartir el de ventas con x@y.com', { artefactos: arts });
  assert.deepEqual(r, { tipo: 'revocar', artefactoId: 'a1', email: 'x@y.com' });
});

test('borrar visualización ≠ borrar datos', () => {
  assert.equal(interpretar('borrá este dashboard', { artefactos: arts, activoId: 'a1' }).tipo, 'borrar_visualizacion');
  const d = interpretar('borrá los datos del de ventas', { artefactos: arts });
  assert.equal(d.tipo, 'borrar_datos');
  assert.equal(d.requiereConfirmacion, true);
});

test('registrar datos con formato argentino', () => {
  const r = interpretar('registrá 1.500,50 en ventas canal web 3 unidades', { artefactos: arts, activoId: 'a1', hoy: '2026-10-29' });
  assert.equal(r.tipo, 'registrar');
  assert.deepEqual(r.numeros, [1500.5, 3]);
  const campos = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'unidades', label: 'Unidades', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }];
  assert.deepEqual(armarRegistro(campos, r), { monto: 1500.5, unidades: 3, canal: 'web' });
});

test('registrar con fecha explícita', () => {
  const r = interpretar('cargá 200 el 31/01/2026', { artefactos: [arts[0]] });
  assert.equal(r.fecha, '2026-01-31');
  assert.deepEqual(r.numeros, [200]);
});

test('renombrar, listar, decisión y chat libre', () => {
  assert.deepEqual(interpretar('cambiale el nombre a "Ventas 2027"', { artefactos: arts, activoId: 'a1' }),
    { tipo: 'renombrar', artefactoId: 'a1', nombre: 'Ventas 2027' });
  assert.equal(interpretar('¿qué dashboards tengo?').tipo, 'listar');
  assert.equal(interpretar('De ahora en más los montos van en dólares').tipo, 'decision');
  assert.equal(interpretar('¿Qué opinás de la inflación de este mes?').tipo, 'chat');
});
