// Workspace adaptativo, CommandRouter, Generative UI, archivos generados y operaciones sobre tablas (puros).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { presentacion, calcularPreview, previewVigente, ordenarWorkspace, reordenar, recientesPorUso, continuar, htmlTarjeta, htmlVistazo, accionesMenu, PREVIEW_VERSION } from '../workspace.js';
import { clasificar, accionesPara } from '../comando.js';
import { validar, renderUI, specsComparacion, REGISTRO } from '../genui.js';
import { generar, validarArchivo, formatoPedido, nombreArchivo } from '../archivos/generar.js';
import { entradasZip, crc32 } from '../archivos/zip.js';
import { compararTablas, compararTextos, interpretarEdicion, aplicarEdicion, consolidar } from '../archivos/tablas.js';
import { insights, comparar } from '../analisis.js';
import { EMOCIONES } from '../avatar.js';
import { resolverArtefacto } from '../intent.js';
import { interpretarEntrada } from '../ingesta/intencion.js';

const req = createRequire(import.meta.url);
const V = new URL('../../valo/vendor/', import.meta.url).pathname;
const campos = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }];
const recs = [];
let id = 1;
for (const [mes, web, local] of [['2026-07', 500, 500], ['2026-08', 600, 400], ['2026-09', 200, 380]]) {
  recs.push({ id: id++, period: `${mes}-05`, data: { monto: web, canal: 'web' }, created_at: `${mes}-05T10:00:00Z` });
  recs.push({ id: id++, period: `${mes}-06`, data: { monto: local, canal: 'local' }, created_at: `${mes}-06T10:00:00Z` });
}

test('presentación: defaults para artefactos existentes, sin recrearlos', () => {
  const p = presentacion({ id: 'a', name: 'Dashboard de ventas', type: 'dashboard', configuration: {}, specification: { tema: 'ventas' } });
  assert.equal(p.tipo, 'Tablero'); assert.equal(p.icon, 'chart'); assert.equal(p.size, 'M'); assert.equal(p.status, 'pendiente');
  assert.match(p.description, /ventas/);
  const q = presentacion({ id: 'b', name: 'X', type: 'report', configuration: { surface: {}, presentation: { size: 'L' } } }, { size: 'S' });
  assert.equal(q.tipo, 'Análisis'); assert.equal(q.size, 'S', 'la preferencia del usuario gana');
});

test('vista previa en caché: 1 KPI + tendencia + estado, con insight útil', () => {
  const pv = calcularPreview(recs, campos, { metrica: 'monto' }, '2026-10-29');
  assert.equal(pv.v, PREVIEW_VERSION);
  assert.equal(pv.valor, 580); assert.equal(pv.mes, '2026-09');
  assert.ok(Math.abs(pv.variacion - (580 - 1000) / 1000) < 1e-9);
  assert.equal(pv.estado, 'atencion', 'una caída ≥10% pide atención');
  assert.deepEqual(pv.serie, [1000, 1000, 580]);
  assert.match(pv.insight, /web/i);
  assert.equal(calcularPreview([], campos).estado, 'vacio');
  assert.ok(previewVigente(pv, { updated_at: '2020-01-01T00:00:00Z' }));
  assert.ok(!previewVigente({ ...pv, v: 1 }, { updated_at: '2020-01-01' }));
  assert.ok(!previewVigente(pv, { updated_at: '2999-01-01' }), 'si el artefacto cambió después, se recalcula');
});

test('orden estable: favoritos primero y luego el orden del usuario; reordenar accesible', () => {
  const arts = [{ id: 'a', created_at: '1' }, { id: 'b', created_at: '2' }, { id: 'c', created_at: '3' }];
  const menu = new Map([['a', { ord: 2 }], ['b', { ord: 0 }], ['c', { ord: 1, favorite: true }]]);
  assert.deepEqual(ordenarWorkspace(arts, menu).map((a) => a.id), ['c', 'b', 'a']);
  assert.deepEqual(reordenar(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reordenar(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
  const m2 = new Map([['a', { last_opened_at: '2026-10-01' }], ['b', {}], ['c', { last_opened_at: '2026-10-05' }]]);
  assert.deepEqual(recientesPorUso(arts, m2).map((a) => a.id), ['c', 'a'], 'recientes por apertura, no por modificación');
});

test('Continuar: máximo 4 y con prioridad a lo que necesita atención', () => {
  const c = continuar({ resume: { artefactoId: 'a', filtro: { valor: 'web' }, desde: '2026-09' }, artefactos: [{ id: 'a', name: 'Ventas' }],
    tareas: [{ id: 1, status: 'failed', name: 'Importar', error: 'x' }, { id: 2, status: 'completed', updated_at: '2026-10-29' }, { id: 3, status: 'waiting', name: 'Otra' }, { id: 4, status: 'failed', name: 'Tercera' }],
    avisos: [{ id: 9, priority: 'action', title: 'Revisar' }], lastVisit: '2026-10-01' });
  assert.ok(c.length <= 4);
  assert.equal(c[0].tipo, 'atencion');
  assert.ok(c.some((x) => x.tipo === 'artefacto' && /solo web/.test(x.detalle)));
});

test('Living Card: accesible, escapada y sin mini-dashboard', () => {
  const pv = calcularPreview(recs, campos, {}, '2026-10-29');
  const h = htmlTarjeta({ id: 'a', name: 'Ventas <b>', type: 'dashboard', configuration: {} }, { favorite: true }, pv);
  assert.match(h, /role="link"/); assert.match(h, /tabindex="0"/);
  assert.match(h, /aria-label="Ventas &lt;b&gt;. Tablero. Monto Septiembre 2026: 580/);
  assert.ok(!/<b>/.test(h), 'el nombre se escapa');
  assert.equal((h.match(/class="lc-valor"/g) || []).length, 1, 'un solo KPI');
  assert.match(h, /aria-pressed="true"/);
  assert.match(htmlVistazo({ id: 'a', name: 'Ventas', type: 'dashboard', configuration: {} }, {}, pv), /Abrir.*Preguntar.*Actualizar.*Compartir/s);
  const sinEditar = accionesMenu({ editable: false }).map((x) => x.id);
  assert.ok(!sinEditar.includes('eliminar') && !sinEditar.includes('archivar'), 'no se ofrecen acciones imposibles');
  assert.ok(accionesMenu({ editable: true }).some((x) => x.id === 'archivar'));
});

test('CommandRouter: una sola entrada, ocho intenciones', () => {
  const arts = [{ id: 'v', name: 'Dashboard de ventas' }, { id: 'c', name: 'Clientes' }];
  assert.deepEqual(clasificar('abrí ventas', { artefactos: arts }), { tipo: 'NAVIGATE', artefactoId: 'v' });
  assert.equal(clasificar('Clientes', { artefactos: arts }).tipo, 'NAVIGATE');
  assert.equal(clasificar('ventas', { artefactos: arts }).tipo, 'SEARCH');
  assert.equal(clasificar('¿por qué bajó septiembre?').tipo, 'ASK');
  assert.equal(clasificar('Creá un dashboard de cobranzas').tipo, 'CREATE');
  assert.equal(clasificar('exportá ventas a excel', { artefactos: arts }).tipo, 'EXECUTE');
  assert.equal(clasificar('subir archivo').tipo, 'UPLOAD');
  assert.equal(clasificar('conectá esta api').tipo, 'CONNECT');
  assert.deepEqual(clasificar('compartí clientes con ana@x.com', { artefactos: arts }), { tipo: 'SHARE', artefactoId: 'c' });
  assert.deepEqual(accionesPara('ventas', arts).map((a) => a.accion), ['actualizar', 'exportar', 'compartir']);
});

test('Generative UI: solo componentes aprobados, props validadas y texto escapado', () => {
  const { specs, errores } = validar([{ type: 'Metric', props: { label: 'Monto', valor: 10, extra: '<script>' } }, { type: 'Script', props: {} }, { type: 'Metric', props: { label: 'x' } }]);
  assert.equal(specs.length, 1); assert.equal(errores.length, 2);
  assert.ok(!('extra' in specs[0].props));
  const h = renderUI([{ type: 'Insight', props: { texto: '<img onerror=x>' } }, { type: 'Table', props: { columnas: ['A'], filas: [['<b>']] } }]);
  assert.ok(!/<img|<b>/.test(h)); assert.match(h, /&lt;img/);
  for (const nombre of ['Metric', 'Trend', 'Chart', 'Table', 'Comparison', 'Timeline', 'Insight', 'Filter', 'File', 'Form', 'Action', 'ArtifactPreview']) assert.ok(REGISTRO[nombre], nombre);
  const c = comparar(recs, campos[0], '2026-09', '2026-08', campos[1], '2026-10-29');
  const s = specsComparacion(c, campos[0], campos[1]);
  assert.match(renderUI(s), /Septiembre 2026.*Agosto 2026/s);
});

test('insights: útiles, sin obviedades y ordenados por impacto', () => {
  const ins = insights(recs, campos[0], campos[1], { hasta: '2026-09' }, '2026-10-29');
  assert.ok(ins.length >= 1 && ins.length <= 2);
  assert.match(ins[0].titulo, /Monto ↓ 42/);
  assert.match(ins[0].texto, /web" explica 95/);
  assert.deepEqual(insights(recs.slice(0, 2), campos[0], campos[1], {}, '2026-10-29'), [], 'con un solo mes no hay comparación que hacer');
});

test('archivos generados: formatos reales, validados (y los inválidos se rechazan)', async () => {
  const ExcelJS = req(V + 'exceljs.min.js'); const { jsPDF } = req(V + 'jspdf.umd.min.js'); req(V + 'jspdf.plugin.autotable.min.js').applyPlugin(jsPDF);
  const XLSX = req(V + 'xlsx.full.min.js');
  const doc = { titulo: 'Ventas · Septiembre 2026', secciones: [{ titulo: 'Resumen', metricas: [{ label: 'Monto', valor: 580, delta: -0.42 }], parrafos: ['Bajó.'] },
    { titulo: 'Detalle', tabla: { columnas: [{ label: 'Fecha', type: 'date' }, { label: 'Monto', type: 'number' }, { label: 'Canal', type: 'text' }], filas: recs.map((r) => [r.period, r.data.monto, r.data.canal]) } }] };
  for (const f of ['xlsx', 'csv', 'json', 'pdf', 'docx', 'pptx', 'txt', 'md']) {
    const r = await generar(doc, f, { ExcelJS, jsPDF });
    const v = validarArchivo(r.bytes, f, { XLSX, filasEsperadas: ['xlsx', 'csv'].includes(f) ? recs.length : null });
    assert.ok(v.ok, `${f}: ${v.detalle}`);
    assert.match(r.nombre, new RegExp(`^Ventas Septiembre 2026\\.${f}$`));
  }
  assert.ok(!validarArchivo(new Uint8Array(), 'pdf').ok);
  assert.ok(!validarArchivo(new TextEncoder().encode('PK no'), 'docx').ok);
  assert.ok(!validarArchivo(new TextEncoder().encode('{mal'), 'json').ok);
  const xl = await generar(doc, 'xlsx', { ExcelJS });
  assert.ok(!validarArchivo(xl.bytes, 'xlsx', { XLSX, filasEsperadas: 99 }).ok, 'se verifica la cantidad real de filas');
  await assert.rejects(() => generar(doc, 'exe'), /no genero/);
  assert.equal(nombreArchivo('../../etc/passwd', 'pdf'), 'etc passwd.pdf');
});

test('zip propio: CRC estándar y directorio legible', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('pedido → formato', () => {
  assert.equal(formatoPedido('Pasame esto en Excel'), 'xlsx');
  assert.equal(formatoPedido('Generame un informe PDF'), 'pdf');
  assert.equal(formatoPedido('Preparame una presentación'), 'pptx');
  assert.equal(formatoPedido('exportá esta tabla'), 'xlsx');
  assert.equal(formatoPedido('pasalo a word'), 'docx');
  assert.equal(formatoPedido('¿cómo vienen las ventas?'), null);
});

test('comparación de tablas: agregadas, quitadas, cambiadas e impacto', () => {
  const cols = [{ label: 'Cliente', type: 'text' }, { label: 'Monto', type: 'number' }];
  const A = { columnas: cols, filas: [['ana', 100], ['beto', 200], ['caro', 300]] };
  const B = { columnas: [...cols, { label: 'Zona', type: 'text' }], filas: [['ana', 100, 'n'], ['beto', 250, 's'], ['dani', 50, 'n']] };
  const c = compararTablas(A, B);
  assert.equal(c.clave, 'Cliente');
  assert.deepEqual([c.agregadas, c.quitadas, c.cambiadas], [1, 1, 1]);
  assert.deepEqual(c.colAgregadas, ['Zona']);
  assert.match(c.impacto, /Monto: 600 → 400/);
  assert.ok(c.cambios.some((x) => x.tipo === 'cambiada' && x.antes === '200' && x.despues === '250'));
  assert.ok(compararTablas(A, A).sinCambios);
  assert.match(compararTextos('a\n\nb', 'a\n\nc').resumen, /1 párrafos nuevos y 1 quitados/);
});

test('edición conversacional: nueva tabla, original intacto, ambigüedad → pregunta', () => {
  const t = { columnas: [{ label: 'Venta', type: 'number' }, { label: 'Costo', type: 'number' }, { label: 'Canal', type: 'text' }], filas: [[100, 60, 'web'], [100, 60, 'web'], [50, 40, 'local']] };
  const e = interpretarEdicion('Agregale margen', t);
  assert.equal(e.op, 'margen');
  const r = aplicarEdicion(t, e);
  assert.deepEqual(r.filas[0], [100, 60, 'web', 40, 40]);
  assert.equal(t.columnas.length, 3, 'el original no se modifica');
  assert.equal(aplicarEdicion(t, interpretarEdicion('sacá duplicados', t)).filas.length, 2);
  assert.ok(interpretarEdicion('agregale margen', { columnas: [{ label: 'Nombre', type: 'text' }], filas: [] }).pregunta);
  assert.equal(interpretarEdicion('ordená por venta de mayor a menor', t).desc, true);
});

test('consolidación: columnas con nombres triviales distintos se unifican; diferencias materiales preguntan', () => {
  const ene = { nombre: 'enero.xlsx', tabla: { columnas: [{ label: 'Fecha' }, { label: 'Monto', type: 'number' }], filas: [['2026-01-02', 10]] } };
  const feb = { nombre: 'febrero.xlsx', tabla: { columnas: [{ label: 'fecha' }, { label: 'Importe', type: 'number' }], filas: [['2026-02-02', 20], ['2026-02-03', 5]] } };
  const r = consolidar([ene, feb]);
  assert.equal(r.tabla.filas.length, 3);
  assert.deepEqual(r.tabla.filas[1], ['2026-02-02', 20, 'febrero.xlsx']);
  assert.ok(consolidar([ene, { nombre: 'otro.xlsx', tabla: { columnas: [{ label: 'Cliente' }, { label: 'Zona' }, { label: 'Rubro' }], filas: [] } }]).pregunta);
});

test('avatar: manifiesto completo para las 13 emociones en ambos modos', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../avatar/manifest.json', import.meta.url)));
  for (const modo of ['work', 'personal']) for (const e of EMOCIONES) assert.match(m[modo][e], /^https:\/\/cdn\.openart\.ai\//, `${modo}.${e}`);
});

test('comparación: columnas de nombre canónico parecido ("Margen" y "Margen %") se emparejan una a una', () => {
  const cols = [['Producto', 'text'], ['Venta', 'number'], ['Margen', 'number'], ['Margen %', 'number']].map(([label, type], i) => ({ key: `k${i}`, label, type }));
  const A = { columnas: cols, filas: [['A', '100', '40', '40'], ['B', '200', '50', '25'], ['A', '100', '40', '40']] };
  const c = compararTablas(A, { columnas: cols, filas: A.filas.slice(0, 2) });
  assert.deepEqual([c.agregadas, c.quitadas, c.cambiadas], [0, 1, 0]);
  assert.deepEqual(compararTablas({ columnas: cols.slice(0, 2), filas: [] }, A).colAgregadas, ['Margen', 'Margen %']);
});

test('CSV de un tablero: lleva el detalle completo (la tabla más grande), no el resumen mensual', async () => {
  const doc = { titulo: 'T', secciones: [{ titulo: 'Por mes', tabla: { columnas: [{ label: 'Mes' }, { label: 'Total', type: 'number' }], filas: [['Ago', 1], ['Sep', 2]] } },
    { titulo: 'Detalle', tabla: { columnas: [{ label: 'Fecha' }, { label: 'Monto', type: 'number' }], filas: [['2026-08-01', 1], ['2026-09-01', 1], ['2026-09-02', 1]] } }] };
  const lineas = new TextDecoder().decode((await generar(doc, 'csv')).bytes).trim().split(/\r?\n/);
  assert.equal(lineas.length, 4);
  assert.match(lineas[0], /Fecha;Monto/);
});

test('destino de datos: "el dashboard de ventas" es el tablero Ventas, no una superficie fijada que lo menciona', () => {
  const arts = [{ id: 's', name: 'Ventas: Septiembre 2026 vs. Agosto 2026', configuration: { surface: {} } }, { id: 'v', name: 'Ventas', configuration: {} }];
  assert.equal(resolverArtefacto('sumá esto al dashboard de ventas', arts, null).id, 'v');
  const acc = interpretarEntrada('Sumá estos datos al dashboard de ventas', { modo: 'work', adjuntos: [{ fileId: 'f', kind: 'table' }], artefactos: [arts[0]], activoId: 's' });
  assert.notEqual(acc?.artefactoId, 's', 'una superficie nunca recibe datos');
});
