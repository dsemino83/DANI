import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarEntrada, referenciaArchivo, resolverArchivo } from '../ingesta/intencion.js';

const arts = [{ id: 'a1', name: 'Dashboard de ventas' }, { id: 'a2', name: 'Presupuesto 2027' }];
const xlsx = [{ fileId: 'f1', nombre: 'ventas_oct.xlsx', kind: 'table', tipo: 'xlsx' }];
const foto = [{ fileId: 'f2', nombre: 'IMG.jpg', kind: 'image', tipo: 'jpeg' }];
const pdf = [{ fileId: 'f3', nombre: 'informe.pdf', kind: 'document', tipo: 'pdf' }];
const ctx = (adjuntos = [], extra = {}) => ({ modo: 'work', adjuntos, artefactos: arts, activoId: null, ...extra });

test('referencias naturales a adjuntos sin pedir nombre ni ruta', () => {
  assert.deepEqual(interpretarEntrada('Analizá este archivo.', ctx(pdf)), { tipo: 'archivo_analizar', adjuntos: ['f3'], referencia: null });
  assert.equal(interpretarEntrada('¿Qué dice sobre los costos?', ctx(pdf)).tipo, 'archivo_pregunta');
  assert.equal(interpretarEntrada('¿Qué aparece en esta foto?', ctx(foto)).tipo, 'imagen_pregunta');
  assert.equal(interpretarEntrada('Creá un dashboard con estos datos', ctx(xlsx)).tipo, 'archivo_dashboard');
  const imp = interpretarEntrada('Sumá estos datos a Ventas', ctx(xlsx));
  assert.equal(imp.tipo, 'archivo_importar'); assert.equal(imp.artefactoId, 'a1');
  assert.equal(interpretarEntrada('Usá esta planilla para el dashboard', ctx(xlsx, { activoId: 'a1' })).artefactoId, 'a1');
  assert.equal(interpretarEntrada('Guardá estos datos', ctx(xlsx)).tipo, 'archivo_importar');
  assert.equal(interpretarEntrada('Comparalo con el anterior', ctx(xlsx)).tipo, 'archivo_comparar');
  assert.equal(interpretarEntrada('Compará esta planilla con la base', ctx(xlsx)).contraBase, true);
  assert.equal(interpretarEntrada('hola, ¿cómo va?', ctx()), null);
});

test('archivos guardados: "el Excel de ventas que subí la semana pasada", "la última versión del presupuesto"', () => {
  const r = referenciaArchivo('el excel de ventas que subi la semana pasada');
  assert.deepEqual(r, { tipos: ['xlsx', 'xls', 'ods', 'csv'], cuando: 7, ultimo: false, anterior: false, texto: 'ventas' });
  const ahora = Date.parse('2026-10-29T12:00:00Z');
  const files = [
    { id: 'x1', original_name: 'ventas_septiembre.xlsx', detected_type: 'xlsx', created_at: '2026-10-24T10:00:00Z', version: 1, status: 'ready' },
    { id: 'x2', original_name: 'clientes.xlsx', detected_type: 'xlsx', created_at: '2026-10-25T10:00:00Z', version: 1, status: 'ready' },
    { id: 'x3', original_name: 'presupuesto.xlsx', detected_type: 'xlsx', created_at: '2026-10-01T10:00:00Z', version: 1, status: 'ready' },
    { id: 'x4', original_name: 'presupuesto.xlsx', detected_type: 'xlsx', created_at: '2026-10-20T10:00:00Z', version: 2, status: 'ready' },
  ];
  assert.equal(resolverArchivo(r, files, ahora)[0].id, 'x1');
  assert.equal(resolverArchivo(referenciaArchivo('usa la ultima version del presupuesto'), files, ahora)[0].id, 'x4');
  const i = interpretarEntrada('Usá la última versión del presupuesto en Presupuesto 2027', ctx());
  assert.equal(i.tipo, 'archivo_importar'); assert.equal(i.artefactoId, 'a2'); assert.equal(i.referencia.texto, 'presupuesto');
});

test('APIs y entradas periódicas', () => {
  const a = interpretarEntrada('Este dashboard tiene que traer cotizaciones desde https://api.bluelytics.com.ar/v2/evolution.json y guardar el histórico', ctx([], { activoId: 'a1' }));
  assert.deepEqual(a, { tipo: 'api_conectar', url: 'https://api.bluelytics.com.ar/v2/evolution.json', artefactoId: 'a1', refresco: 'MANUAL', historico: true });
  assert.equal(interpretarEntrada('conectá esta API https://x.com/a y que esté siempre actualizado', ctx()).refresco, 'ON_OPEN');
  assert.deepEqual(interpretarEntrada('Quiero poder cargar las ventas todos los meses', ctx()), { tipo: 'input_archivo', artefactoId: 'a1', tema: 'ventas', periodicidad: 'mensual' });
  assert.equal(interpretarEntrada('¿De dónde salió este dato?', ctx()).tipo, 'origen');
});

test('modo Personal: analiza y responde, pero no importa ni crea tableros', () => {
  assert.equal(interpretarEntrada('Analizá este archivo', { modo: 'personal', adjuntos: pdf }).tipo, 'archivo_analizar');
  assert.equal(interpretarEntrada('¿Qué aparece en esta foto?', { modo: 'personal', adjuntos: foto }).tipo, 'imagen_pregunta');
  assert.equal(interpretarEntrada('Creá un dashboard con estos datos', { modo: 'personal', adjuntos: xlsx }).tipo, 'bloqueado');
  assert.equal(interpretarEntrada('conectá la api https://x.com', { modo: 'personal' }).tipo, 'bloqueado');
});

test('adjuntos anteriores solo si el pedido los señala', () => {
  const previos = [{ fileId: 'f9', nombre: 'v.csv', kind: 'table', tipo: 'csv' }];
  assert.equal(interpretarEntrada('Compará noviembre con octubre', { modo: 'work', adjuntosPrevios: previos, artefactos: arts }), null);
  assert.equal(interpretarEntrada('Analizá este archivo', { modo: 'work', adjuntosPrevios: previos }).adjuntos[0], 'f9');
});

test('API sin tablero explícito → tablero nuevo, aunque exista uno solo', () => {
  const uno = [{ id: 'a1', name: 'Dashboard de ventas' }];
  assert.equal(interpretarEntrada('Quiero un tablero que traiga cotizaciones desde https://api.x.com/v1', { modo: 'work', artefactos: uno }).artefactoId, null);
  assert.equal(interpretarEntrada('Este dashboard tiene que traer datos de https://api.x.com/v1', { modo: 'work', artefactos: uno, activoId: 'a1' }).artefactoId, 'a1');
  assert.equal(interpretarEntrada('Quiero poder cargar las ventas todos los meses', { modo: 'work', artefactos: uno }).artefactoId, 'a1');
});

test('"el pdf que subí hoy" es una referencia, no un pedido de carga', () => {
  assert.equal(interpretarEntrada('Analizá el pdf que subí hoy', { modo: 'work' }).tipo, 'archivo_analizar');
  assert.equal(interpretarEntrada('Sumá el excel que subí ayer a Ventas', { modo: 'work', artefactos: arts }).tipo, 'archivo_importar');
});

test('la referencia tipada gana sobre adjuntos anteriores', () => {
  const previos = [{ fileId: 'f9', nombre: 'v.csv', kind: 'table', tipo: 'csv' }];
  const r = interpretarEntrada('Analizá el pdf que subí hoy', { modo: 'work', adjuntosPrevios: previos });
  assert.deepEqual(r.adjuntos, []); assert.deepEqual(r.referencia.tipos, ['pdf']);
});
