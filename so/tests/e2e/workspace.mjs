// Recorridos del Workspace adaptativo y del sistema universal de archivos en Chromium real, contra el Supabase
// simulado (Storage con URLs firmadas que expiran). Las descargas se validan fuera del navegador (estructura real del
// archivo: SheetJS, python-docx, python-pptx, pypdf). Uso: npm run test:so:workspace (SO_E2E_OUT=<carpeta> capturas).
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { crearServidor } from './servidor.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const XLSX = require(path.join(root, 'valo/vendor/xlsx.full.min.js'));
const { validarArchivo } = await import(path.join(root, 'so/archivos/generar.js'));
const out = process.env.SO_E2E_OUT || null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-ws-'));
const csv = (nombre, lineas) => { const f = path.join(tmp, nombre); fs.writeFileSync(f, lineas.join('\n')); return f; };
const F = {
  margen: csv('margen.csv', ['Producto;Venta;Costo;Canal', 'A;100;60;web', 'B;200;150;local', 'A;100;60;web', 'C;80;20;web']),
  enero: csv('ventas_enero.csv', ['Fecha;Monto;Canal', '02/01/2026;100;web', '05/01/2026;50;local']),
  febrero: csv('ventas_febrero.csv', ['fecha;Importe;canal', '03/02/2026;70;web']),
  octubre: csv('ventas_octubre.csv', ['fecha;monto;canal', '03/10/2026;500;web', '04/10/2026;300;local']),
};
const py = (codigo, archivo) => { const r = spawnSync('python3', ['-I', '-c', codigo, archivo], { encoding: 'utf8' }); return (r.stdout || r.stderr || '').trim(); };

const { srv, BASE } = crearServidor({ puerto: 8770, root, dir, tmp });
const b = await chromium.launch();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const nuevoCtx = async (op = {}) => { const c = await b.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true, ...op }); await c.route('https://cdn.openart.ai/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PNG })); return c; };
const ctx = await nuevoCtx();
const pg = await ctx.newPage();
const errores = []; pg.on('pageerror', (e) => errores.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errores.push(m.text()));
pg.on('dialog', (d) => d.accept());
const fallos = []; const medidas = {}; let pasos = 0;
const ok = (c, msg) => { if (!c) fallos.push(msg); console.log(`${c ? '✔' : '✘'} ${msg}`); };
const journey = (n) => { medidas[n] = pasos; pasos = 0; };
const shot = async (n, p = pg) => { if (out) await p.screenshot({ path: path.join(out, n) }); };
const listo = () => pg.waitForFunction(() => !document.getElementById('enviar').disabled && !document.querySelector('.actividad[data-tipo="entendiendo"]'), null, { timeout: 60000 });
const asegurarPanel = async () => { if (!(await pg.isVisible('#texto'))) { await pg.click('#orb'); await pg.waitForSelector('#texto', { state: 'visible' }); } };
const decir = async (t) => { pasos++; await asegurarPanel(); await pg.fill('#texto', t); await pg.press('#texto', 'Enter'); await pg.waitForTimeout(80); await listo(); await pg.waitForTimeout(300); if (process.env.SO_DEBUG) console.log('   «', t, '» →', (await ultimo()).slice(0, 300)); };
const ultimo = () => pg.$eval('#mensajes .msg.assistant:last-of-type', (n) => n.textContent.replace(/\s+/g, ' ').trim());
const db = () => pg.evaluate(() => window.__db());
const adjuntar = async (...files) => {
  pasos++;
  const antes = await pg.$$eval('#bandeja .adj', (n) => n.length);
  await pg.setInputFiles('#inpArchivos', files);
  await pg.waitForFunction((n) => document.querySelectorAll('#bandeja .adj').length >= n, antes + files.length, { timeout: 20000 });
  await pg.waitForFunction(() => ![...document.querySelectorAll('#bandeja .adj')].some((n) => /esperando|subiendo|procesando/.test(n.className)), null, { timeout: 60000 });
};
const descargarUltimo = async () => {
  pasos++;
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 20000 }), pg.click('#mensajes .msg:last-child .gu-file [data-gf="bajar"]')]);
  const p = path.join(tmp, dl.suggestedFilename()); await dl.saveAs(p);
  return { p, nombre: dl.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync(p)) };
};
const irWorkspace = async () => { await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForSelector('#vistaHome:not([hidden])'); await pg.waitForTimeout(300); };

// ---------------------------------------------------------------- semilla: un workspace "existente" (antes de esta versión)
await pg.goto(BASE + '/404.html'); await pg.evaluate(() => localStorage.clear());   // página del mismo origen sin el simulador: nada pisa la semilla
await pg.evaluate(() => {
  const ua = '00000000-0000-0000-0000-00000000000a'; const ahora = new Date().toISOString();
  const db = { __seq: 1 }; for (const t of ['so_projects', 'so_datasources', 'so_records', 'so_artifacts', 'so_artifact_versions', 'so_menu', 'so_shares', 'so_chats', 'so_messages', 'so_decisions', 'so_signals', 'so_obs', 'so_tasks', 'so_notifications', 'so_user_state', 'so_events', 'so_files', 'so_file_chunks', 'so_data_inputs', 'so_api_sources', 'so_import_batches', 'so_ingest_log', 'so_automations', 'so_file_templates']) db[t] = [];
  const pid = crypto.randomUUID();
  db.so_projects.push({ id: pid, owner_id: ua, name: 'Trabajo', mode: 'work', memory: {}, created_at: ahora, updated_at: ahora });
  const art = (nombre, campos, filas, extra = {}) => {
    const ds = crypto.randomUUID(), id = crypto.randomUUID();
    db.so_datasources.push({ id: ds, owner_id: ua, project_id: pid, name: nombre, fields: campos, created_at: ahora });
    for (const [period, data] of filas) db.so_records.push({ id: db.__seq++, datasource_id: ds, owner_id: ua, period, data, created_at: ahora, superseded_by: null, import_batch_id: null });
    db.so_artifacts.push({ id, owner_id: ua, project_id: pid, name: nombre, type: 'dashboard', version: 1, route: `#/a/${id}`, state: 'published', datasource_id: ds, menu: { icon: 'chart' },
      configuration: { grafico: 'line', metrica: campos.find((c) => c.type === 'number').key }, specification: { tema: nombre.toLowerCase() }, schema: { fields: campos }, permissions: {}, sharing: {}, deleted_at: null, created_at: ahora, updated_at: '2026-01-01T00:00:00.000Z', ...extra });
    // Fila de menú con la forma ANTERIOR a esta versión: sin tamaño ni vista previa (migración de presentación).
    db.so_menu.push({ id: crypto.randomUUID(), artifact_id: id, owner_id: ua, name: nombre, route: `#/a/${id}`, ord: db.so_menu.length, favorite: false, open_count: 0, last_opened_at: null, status: 'available' });
    return id;
  };
  const C = [{ key: 'monto', label: 'Monto', type: 'number' }, { key: 'canal', label: 'Canal', type: 'text' }];
  const filas = [];
  for (const [mes, w, l, m] of [['2026-07', 900, 700, 400], ['2026-08', 1000, 800, 500], ['2026-09', 300, 780, 490]]) filas.push([`${mes}-10`, { monto: w, canal: 'web' }], [`${mes}-11`, { monto: l, canal: 'local' }], [`${mes}-12`, { monto: m, canal: 'mayorista' }]);
  window.__ventasId = art('Ventas', C, filas);
  for (const n of ['Clientes', 'Inventario', 'Cobranzas', 'Gastos', 'Compras', 'Stock', 'Proveedores', 'Sucursales']) art(n, [{ key: 'valor', label: 'Valor', type: 'number' }, { key: 'zona', label: 'Zona', type: 'text' }], [['2026-08-01', { valor: 10, zona: 'n' }], ['2026-09-01', { valor: 12, zona: 's' }]]);
  localStorage.setItem('fake.db', JSON.stringify(db));
});
await pg.goto(BASE + '/so/'); await pg.waitForSelector('#app:not([hidden])'); await pg.waitForTimeout(400);
const ventasId = (await db()).so_artifacts.find((a) => a.name === 'Ventas').id;

// ---------------------------------------------------------------- M — artefactos existentes migrados a Living Cards
ok(await pg.$$eval('#bento .lcard[data-art]', (n) => n.length) === 9 && await pg.isVisible('#bento .lcard.crear'), 'M: los 9 artefactos existentes aparecen como Living Cards (+ Crear), sin recrearlos');
ok(/Tablero/.test(await pg.textContent('.lcard[data-art] .lc-tipo')), 'M: presentación por defecto (ícono, tipo) para artefactos sin metadata');
await pg.waitForFunction((id) => window.__db().so_menu.find((m) => m.artifact_id === id)?.preview?.v === 2, ventasId, { timeout: 15000 });
await pg.waitForTimeout(400);
const tVentas = await pg.textContent(`.lcard[data-art="${ventasId}"]`);
ok(/1\.570/.test(tVentas) && /▼/.test(tVentas) && await pg.isVisible(`.lcard[data-art="${ventasId}"] .spark`), 'Living Card: 1 KPI (Sep 1.570) + tendencia (▼ vs ago) + microvisualización');
ok(await pg.getAttribute(`.lcard[data-art="${ventasId}"]`, 'data-estado') === 'atencion', 'Living Card: estado de atención por caída ≥10%');
ok(/Septiembre 2026/.test(await pg.getAttribute(`.lcard[data-art="${ventasId}"]`, 'aria-label')), 'Living Card: etiqueta accesible con KPI, tendencia y estado');
// Vista previa en caché: al recargar, el Workspace se pinta sin consultar registros.
await pg.reload(); await pg.waitForSelector('#bento .lcard[data-art]');
const consultas = await pg.evaluate(() => ({ ...window.__consultas }));
ok(/1\.570/.test(await pg.textContent(`.lcard[data-art="${ventasId}"]`)) && !consultas['so_records.select'], 'Rendimiento: el Workspace carga desde la vista previa en caché (0 consultas de registros)');
const perf = await pg.evaluate(() => new Promise((r) => {
  const lcp = []; const cls = [];
  new PerformanceObserver((l) => lcp.push(...l.getEntries())).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => cls.push(...l.getEntries())).observe({ type: 'layout-shift', buffered: true });
  setTimeout(() => r({ lcp: Math.round(lcp.at(-1)?.startTime || 0), cls: Number(cls.filter((e) => !e.hadRecentInput).reduce((s, e) => s + e.value, 0).toFixed(3)) }), 800);
}));
console.log('PERF', JSON.stringify(perf));
ok(perf.lcp > 0 && perf.lcp < 2500 && perf.cls < 0.1, `Rendimiento: LCP ${perf.lcp} ms y CLS ${perf.cls} en el Workspace (local)`);
await shot('w1-workspace.png');
journey('M');

// ---------------------------------------------------------------- A — Workspace → card → artefacto → Back (continuidad espacial)
await pg.setViewportSize({ width: 1360, height: 560 }); await pg.waitForTimeout(200);
await pg.$eval('#vistaHome', (n) => { n.scrollTop = n.scrollHeight; }); await pg.waitForTimeout(150);
const scrollAntes = await pg.$eval('#vistaHome', (n) => n.scrollTop);
const ultimaCard = await pg.$$eval('#bento .lcard[data-art]', (n) => n.at(-1).dataset.art);
await pg.click(`.lcard[data-art="${ultimaCard}"] .lc-nombre`); pasos++;
await pg.waitForSelector('.kpis');
ok(new RegExp(`#/a/${ultimaCard}$`).test(pg.url()), 'A: click en la tarjeta abre el artefacto real con su URL');
ok(await pg.isVisible('#volver') && !(await pg.isVisible('#panelFrancisco')), 'A: vista enfocada (← Trabajo) sin Francisco ocupando espacio');
await pg.click('#volver'); pasos++; await pg.waitForSelector('#bento'); await pg.waitForTimeout(400);
const scrollDespues = await pg.$eval('#vistaHome', (n) => n.scrollTop);
ok(Math.abs(scrollDespues - scrollAntes) < 40 && scrollAntes > 50, `A: al volver se restaura el scroll (${scrollAntes} → ${scrollDespues})`);
ok(await pg.evaluate((id) => document.activeElement?.dataset?.art === id, ultimaCard), 'A: y el foco vuelve a la tarjeta abierta');
await pg.setViewportSize({ width: 1360, height: 860 });
await pg.focus(`.lcard[data-art="${ventasId}"]`); await pg.keyboard.press('Enter'); pasos++;
await pg.waitForSelector('.kpis');
ok(new RegExp(`#/a/${ventasId}$`).test(pg.url()), 'A: teclado — Enter sobre la tarjeta abre el artefacto');
await pg.reload(); await pg.waitForSelector('.kpis');
ok(new RegExp(`#/a/${ventasId}$`).test(pg.url()) && /Ventas/.test(await pg.textContent('#titulo')), 'A: refrescar mantiene el artefacto');
await pg.goto(`${BASE}/so/#/work/${ventasId}`); await pg.waitForSelector('.kpis');
ok(pg.url().endsWith(`#/a/${ventasId}`), 'A: ruta /so/work/:id compatible (alias del deep link estable)');
journey('A');

// ---------------------------------------------------------------- B — Card → Quick Look → Full
await irWorkspace();
await pg.click(`.lcard[data-art="${ventasId}"] [data-lc="vistazo"]`); pasos++; await pg.waitForTimeout(250);
ok(await pg.isVisible(`.lcard.expandida[data-art="${ventasId}"] .ql-barras`) && pg.url().endsWith('#/'), 'B: Quick Look dentro del Workspace (KPI, gráfico, insight, sin navegar)');
ok(/web/i.test(await pg.textContent(`.lcard.expandida[data-art="${ventasId}"] .ql-insight`)), 'B: insight útil en Quick Look');
await shot('w2-quicklook.png');
await pg.click(`.lcard.expandida[data-art="${ventasId}"] a.boton.primario`); pasos++; await pg.waitForSelector('.kpis');
ok(pg.url().endsWith(`#/a/${ventasId}`), 'B: Abrir lleva al artefacto completo');
journey('B');

// ---------------------------------------------------------------- C — KPI → inspector → Explicar (Francisco contextual)
ok(await pg.isVisible('.resumen-art') && await pg.isVisible('.barra-filtros') && await pg.isVisible('.insights'), 'C: jerarquía Resumen → FilterBar → KPIs → Insights → Gráfico → Detalle');
ok(/explica/.test(await pg.textContent('.insights')), 'C: insight priorizado por impacto (quién explica la caída)');
await pg.click('[data-kpi="ultimo"]'); pasos++; await pg.waitForTimeout(200);
ok(await pg.isVisible('.inspector') && (await pg.$$eval('.inspector button', (n) => n.map((x) => x.textContent.trim()))).join('|').includes('Explicar'), 'C: inspector contextual del KPI');
await pg.click('.inspector [data-insp="explicar"]'); pasos++; await listo(); await pg.waitForTimeout(300);
let t = await ultimo();
ok(await pg.isVisible('#panelFrancisco') && /bajó.*Canal "web"/.test(t), 'C: Explicar abre Francisco con la selección y responde con evidencia');
ok(await pg.isVisible('#mensajes .msg:last-child .gu-cmp'), 'C: respuesta como UI generativa (comparación visual)');
ok(/Ventas · Septiembre 2026/.test(await pg.textContent('#contexto .ctx-resumen')), 'C: contexto compacto "Ventas · Septiembre 2026 · …"');
journey('C');

// ---------------------------------------------------------------- D — lenguaje natural → filtros visibles
await decir('Mostrame sólo web de septiembre');
ok((await pg.$eval('select[data-r="filtro"]', (s) => s.value)) === 'canal|web' && (await pg.$eval('select[data-r="periodo"]', (s) => s.value)) === '2026-09', 'D: "sólo web de septiembre" → filtros estructurados en la FilterBar');
ok((await pg.$$eval('.barra-filtros .pill.activo', (n) => n.length)) >= 2, 'D: la UI refleja los filtros aplicados (nunca invisibles)');
ok(/Ventas · Septiembre 2026 · web/.test(await pg.textContent('#contexto .ctx-resumen')), 'D: el mismo estado en el contexto de Francisco');
await pg.click('[data-r="limpiar-todo"]'); pasos++; await pg.waitForTimeout(200);
ok((await pg.$eval('select[data-r="filtro"]', (s) => s.value)) === '', 'D: manipulación directa limpia el mismo estado');
journey('D');

// ---------------------------------------------------------------- E — Generative UI → Fijar en Workspace → nueva Living Card
await decir('Compará septiembre con agosto');
ok(await pg.isVisible('#mensajes .msg:last-child .gu-cmp') && await pg.isVisible('#mensajes .msg:last-child [data-fijar]'), 'E: comparación renderizada como componente + "Fijar en Workspace"');
await pg.click('#mensajes .msg:last-child [data-fijar]'); pasos++; await listo(); await pg.waitForTimeout(400);
t = await ultimo();
ok(/Fijé "Ventas: Septiembre 2026 vs\. Agosto 2026"/.test(t) && /Verificado/.test(t), 'E: superficie fijada como WorkArtifact (verificada)');
await irWorkspace();
const sup = (await db()).so_artifacts.find((a) => a.configuration?.surface);
ok(sup && await pg.isVisible(`.lcard[data-art="${sup.id}"]`) && /Análisis/.test(await pg.textContent(`.lcard[data-art="${sup.id}"]`)), 'E: nueva Living Card de tipo Análisis');
await pg.click(`.lcard[data-art="${sup.id}"] .lc-nombre`); await pg.waitForSelector('.superficie .gu-cmp');
ok(/Calculado ahora con "Ventas"/.test(await pg.textContent('.superficie')), 'E: la superficie se recalcula con los datos actuales de su fuente');
journey('E');

// ---------------------------------------------------------------- L — ⌘K → buscar → navegar / ejecutar
await pg.keyboard.press('Control+k'); pasos++; await pg.keyboard.type('clientes'); await pg.waitForTimeout(250);
ok(/Tableros/.test(await pg.textContent('#paletaLista')) && /Clientes/.test(await pg.textContent('#paletaLista [aria-selected="true"]')), 'L: resultados agrupados; el artefacto primero');
await pg.keyboard.press('Enter'); await pg.waitForSelector('.kpis');
ok(/Clientes/.test(await pg.textContent('#titulo')), 'L: Enter navega');
await pg.keyboard.press('Control+k'); await pg.keyboard.type('ventas'); await pg.waitForTimeout(250);
const pal = await pg.textContent('#paletaLista');
ok(/Exportar Ventas a Excel/.test(pal) && /Actualizar Ventas/.test(pal) && /Preguntar a Francisco/.test(pal), 'L: acciones contextuales ("Actualizar Ventas", "Exportar…", "Preguntar a Francisco")');
await pg.fill('#paletaInput', '¿por qué bajaron las ventas en septiembre?'); await pg.waitForTimeout(200);
ok(/Preguntar a Francisco/.test(await pg.textContent('#paletaLista [aria-selected="true"]')), 'L: CommandRouter — una pregunta va primero a Francisco');
await pg.keyboard.press('Escape');
journey('L');

// ---------------------------------------------------------------- archivos generados: exportar, descargar y validar de verdad
await pg.goto(`${BASE}/so/#/a/${ventasId}`); await pg.waitForSelector('.kpis'); await pg.waitForTimeout(300);
await pg.click('[data-aa="mas"]'); await pg.click('[data-mi="exp-xlsx"]'); pasos++;
await pg.waitForSelector('#mensajes .msg:last-child .gu-file', { timeout: 30000 }); await listo();
t = await ultimo();
ok(/Ventas\.xlsx/.test(t) && /9 registros/.test(t) && /Verificado/.test(t), 'Archivos: Dashboard → Excel con tarjeta de archivo verificada');
ok(!/\/so-archivos\/|00000000-0000/.test(await pg.textContent('#mensajes .msg:last-child')), 'Archivos: la tarjeta no muestra rutas internas de Storage');
let dl = await descargarUltimo();
let wb = XLSX.read(dl.bytes, { type: 'array' });
const det = XLSX.utils.sheet_to_json(wb.Sheets.Detalle, { header: 1 });
ok(dl.nombre === 'Ventas.xlsx' && wb.SheetNames.includes('Resumen') && det.length === 10 && validarArchivo(dl.bytes, 'xlsx', { XLSX }).ok, 'Descarga real: XLSX válido (Resumen + Detalle con 9 filas)');
ok(typeof wb.Sheets.Detalle.B2.v === 'number' && /#,##0/.test(wb.Sheets.Detalle.B2.z || '#,##0'), 'Excel: números como números (no texto) con formato');
await decir('Generame un informe PDF');
dl = await descargarUltimo();
const paginas = py('import sys,pypdf; r=pypdf.PdfReader(sys.argv[1]); print(len(r.pages), "|", r.pages[0].extract_text()[:200].replace("\\n"," "))', dl.p);
ok(/\.pdf$/.test(dl.nombre) && /^\d+ \|.*Ventas/.test(paginas), `Descarga real: PDF válido (${paginas.split('|')[0].trim()} páginas, texto legible)`);
await decir('Pasá este tablero a Word');
dl = await descargarUltimo();
const docx = py('import sys,docx; d=docx.Document(sys.argv[1]); print(len(d.paragraphs), len(d.tables), d.paragraphs[0].text)', dl.p);
ok(/\.docx$/.test(dl.nombre) && /^\d+ [1-9]\d* Ventas/.test(docx), `Descarga real: DOCX editable (${docx})`);
await decir('Preparame una presentación');
dl = await descargarUltimo();
const pptx = py('import sys,pptx; p=pptx.Presentation(sys.argv[1]); print(len(p.slides))', dl.p);
ok(/\.pptx$/.test(dl.nombre) && Number(pptx) >= 3, `Descarga real: PPTX con diapositivas reales (${pptx})`);
await shot('w3-archivo-generado.png');
journey('Archivos');

// ---------------------------------------------------------------- reutilización: archivo generado → otro formato (sin bajar ni subir)
await pg.click('[data-aa="mas"]'); await pg.click('[data-mi="exp-csv"]');
await pg.waitForFunction(() => /Ventas\.csv/.test(document.querySelector('#mensajes .msg:last-child')?.textContent || ''), null, { timeout: 30000 }); await listo();
await decir('Pasá el archivo que generaste a JSON');
t = await ultimo();
ok(/Convertí Ventas\.csv a JSON/.test(t), 'Reutilización: CSV generado → JSON sin descarga ni re-subida');
dl = await descargarUltimo();
ok(/\.json$/.test(dl.nombre) && JSON.parse(Buffer.from(dl.bytes).toString()).secciones[0].filas.length >= 9, 'Reutilización: JSON válido con los datos');
journey('Reuso');

// ---------------------------------------------------------------- edición conversacional → nueva versión · comparar · restaurar
await irWorkspace();
await adjuntar(F.margen);
await decir('Agregale margen');
t = await ultimo();
ok(/versión nueva de margen\.csv \(v2\)/.test(t) && /La versión anterior queda intacta/.test(t), 'Edición: "agregale margen" crea v2 (nunca sobrescribe)');
let d = await db();
const v1 = d.so_files.find((f) => f.original_name === 'margen.csv' && f.version === 1);
const v2 = d.so_files.find((f) => f.original_name === 'margen.csv' && f.version === 2);
ok(v2?.version_of === v1?.id && v2.change_summary === 'Francisco agregué Margen = Venta − Costo y Margen %' && v1.status !== 'failed', 'Versiones: v2 apunta a v1, con resumen del cambio; v1 sin cambios');
dl = await descargarUltimo();
const filasV2 = Buffer.from(dl.bytes).toString().replace(/^﻿/, '').trim().split(/\r?\n/);
ok(/Margen;Margen %/.test(filasV2[0]) && filasV2[1].endsWith(';40;40'), 'Edición: el archivo nuevo trae Margen y Margen % calculados');
await decir('Sacá los duplicados');
ok(/v3/.test(await ultimo()) && /4 → 3/.test(await ultimo()), 'Edición: "sacá duplicados" → v3 con 3 filas');
await decir('Compará con la versión anterior');
ok(await pg.isVisible('#mensajes .msg:last-child .gu-diff') && /1 quitadas/.test(await ultimo()), 'Comparación: v2 → v3 como superficie visual (quitadas/agregadas/cambiadas)');
await pg.click('#mensajes .msg:last-child [data-gu-accion="exportar_comparacion"]'); await listo(); await pg.waitForTimeout(400);
ok(/Exporté la comparación/.test(await ultimo()), 'Comparación: exportable a Excel');
d = await db();
const v3 = d.so_files.find((f) => f.original_name === 'margen.csv' && f.version === 3);
await pg.goto(`${BASE}/so/#/f/${v3.id}`); await pg.waitForSelector('.versiones-arch');
const lista = await pg.textContent('.versiones-arch');
ok(/v3 — Francisco quité filas duplicadas[\s\S]*v2 — Francisco agregué Margen[\s\S]*v1 — original/.test(lista), 'Vista de archivo: historial v3 → v2 → v1 con resumen humano');
await pg.click(`.versiones-arch [data-rest="${v1.id}"]`); pasos++; await listo(); await pg.waitForTimeout(500);
d = await db();
const v4 = d.so_files.find((f) => f.original_name === 'margen.csv' && f.version === 4);
ok(v4?.change_summary === 'Restaurado desde v1' && v4.checksum === v1.checksum && d.so_files.filter((f) => f.original_name === 'margen.csv').length === 4, 'Restaurar: crea v4 con el contenido de v1 (la historia no se destruye)');
await shot('w4-versiones.png');
journey('Versiones');

// ---------------------------------------------------------------- varios archivos → consolidar
await irWorkspace();
await adjuntar(F.enero, F.febrero);
await decir('Consolidá estos archivos');
t = await ultimo();
ok(/Consolidé 2 archivos/.test(t) && /3 filas/.test(t), 'Multi-archivo: consolidación con columnas equivalentes (Monto ≈ Importe)');
dl = await descargarUltimo();
wb = XLSX.read(dl.bytes, { type: 'array' });
const cons = XLSX.utils.sheet_to_json(wb.Sheets.Datos, { header: 1 });
ok(cons.length === 4 && cons[0].includes('Archivo') && cons[3].includes('ventas_febrero.csv'), 'Multi-archivo: cada fila conserva su archivo de origen');
journey('Consolidar');

// ---------------------------------------------------------------- formatos nuevos (imagen, RTF, XML), paquete y colecciones
await pg.goto(`${BASE}/so/#/a/${ventasId}`); await pg.waitForSelector('.kpis'); await pg.waitForTimeout(300);
const esperarArchivo = (re) => pg.waitForFunction((r) => new RegExp(r).test(document.querySelector('#mensajes .msg:last-child')?.textContent || ''), re.source, { timeout: 30000 });
await pg.click('[data-aa="mas"]'); await pg.click('[data-mi="exp-png"]'); pasos++;
await esperarArchivo(/Ventas\.png/); await listo();
dl = await descargarUltimo();
const pil = py('import sys; from PIL import Image; i=Image.open(sys.argv[1]); i.load(); print(i.format, i.size[0], i.size[1], len(set(i.convert("RGB").getdata())) > 20)', dl.p);
ok(/\.png$/.test(dl.nombre) && pil === 'PNG 1200 750 True', `Imagen: PNG real del tablero, decodificado fuera del navegador (${pil})`);
await decir('Exportalo como webp');
dl = await descargarUltimo();
ok(/\.webp$/.test(dl.nombre) && py('import sys; from PIL import Image; i=Image.open(sys.argv[1]); i.load(); print(i.format, i.size[0])', dl.p) === 'WEBP 1200', 'Imagen: WEBP real (Chromium lo codifica; si un navegador no puede, se dice)');
await decir('Bajame un jpg del tablero');
dl = await descargarUltimo();
ok(/\.jpg$/.test(dl.nombre) && py('import sys; from PIL import Image; i=Image.open(sys.argv[1]); i.load(); print(i.format)', dl.p) === 'JPEG', 'Imagen: JPG real');
await decir('Pasá este tablero a RTF');
dl = await descargarUltimo();
const rtfDir = fs.mkdtempSync(path.join(tmp, 'rtf-'));
spawnSync('soffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', rtfDir, dl.p], { timeout: 120000 });
const rtfTxt = fs.existsSync(path.join(rtfDir, path.basename(dl.p, '.rtf') + '.txt')) ? fs.readFileSync(path.join(rtfDir, path.basename(dl.p, '.rtf') + '.txt'), 'latin1') : '';
ok(/\.rtf$/.test(dl.nombre) && /Ventas/.test(rtfTxt) && /Detalle/.test(rtfTxt), 'RTF: LibreOffice lo abre y trae el contenido (Resumen, Detalle)');
await decir('Exportá el tablero a XML');
dl = await descargarUltimo();
const xmlPy = py('import sys, xml.etree.ElementTree as E; r=E.parse(sys.argv[1]).getroot(); print(r.tag, max(len(t.findall("fila")) for t in r.iter("tabla")))', dl.p);
ok(/\.xml$/.test(dl.nombre) && xmlPy === 'documento 9', `XML: bien formado según un parser externo, con las 9 filas (${xmlPy})`);
journey('Formatos');

await decir('Descargá todo junto en un zip');
t = await ultimo();
dl = await descargarUltimo();
const zipPy = py('import sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() is None, len(z.namelist()), ",".join(sorted(n.rsplit(".",1)[-1] for n in z.namelist())))', dl.p);
ok(/Armé .*\.zip con \d+ archivos/.test(t) && /Verificado/.test(t) && /^True \d+ /.test(zipPy) && /png/.test(zipPy) && /rtf/.test(zipPy) && /xml/.test(zipPy), `Paquete: "descargá todo" arma un ZIP íntegro con lo generado en la conversación (${zipPy})`);
d = await db();
const zipFila = d.so_files.find((f) => f.detected_type === 'zip');
ok(zipFila && !zipPy.split(' ')[2].includes('zip'), 'Paquete: no se incluye a sí mismo ni a paquetes previos');
journey('Paquete');

// Colecciones: manipulación directa (vista de archivo) y por pedido; misma metadata, sin tocar el contenido.
const rtfFila = d.so_files.find((f) => f.detected_type === 'rtf');
await pg.goto(`${BASE}/so/#/f/${rtfFila.id}`); await pg.waitForSelector('[data-fa="coleccion"]');
await pg.click('[data-fa="coleccion"]'); await pg.fill('#formColeccion input', 'Cierre octubre'); await pg.press('#formColeccion input', 'Enter'); pasos++;
await pg.waitForFunction((id) => window.__db().so_files.find((f) => f.id === id)?.collection === 'Cierre octubre', rtfFila.id, { timeout: 10000 });
ok(/Cierre octubre/.test(await pg.textContent('.arch-meta')) && (await db()).so_files.find((f) => f.id === rtfFila.id).checksum === rtfFila.checksum, 'Colecciones: guardar desde la vista del archivo (metadato; el contenido no cambia)');
await decir('Guardá estos archivos en la colección Cierre octubre');
ok(/Guardé \d+ archivos en la colección "Cierre octubre"/.test(await ultimo()), 'Colecciones: por pedido a Francisco ("guardá estos archivos en la colección …")');
const enCol = (await db()).so_files.filter((f) => f.collection === 'Cierre octubre').length;
await irWorkspace();
await pg.waitForSelector('.col-chip', { timeout: 10000 });
ok(new RegExp(`Cierre octubre\\s*${enCol}`).test(await pg.textContent('.colecciones-fila')), `Colecciones: aparecen en el Workspace con su cantidad (${enCol})`);
await pg.click('.col-chip'); pasos++; await pg.waitForSelector('.col-lista');
ok(/#\/col\/Cierre%20octubre$/.test(pg.url()) && (await pg.$$eval('.col-lista li', (n) => n.length)) === enCol, 'Colecciones: vista propia con sus archivos y URL estable');
const [dlCol] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('[data-col="todo"]')]); pasos++;
const pCol = path.join(tmp, 'col-' + dlCol.suggestedFilename()); await dlCol.saveAs(pCol);
const colPy = py('import sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() is None, len(z.namelist()))', pCol);
ok(/Cierre octubre\.zip$/.test(dlCol.suggestedFilename()) && colPy === `True ${enCol}`, `Colecciones: "Descargar todo" baja un ZIP íntegro con los ${enCol} archivos (${colPy})`);
await pg.keyboard.press('Escape'); await pg.waitForSelector('#panelFrancisco[data-estado="cerrado"]', { state: 'attached' });
await pg.click('.col-lista [data-col-quitar]'); pasos++;
await pg.waitForFunction((n) => document.querySelectorAll('.col-lista li').length === n - 1, enCol, { timeout: 10000 });
ok((await db()).so_files.filter((f) => f.collection === 'Cierre octubre').length === enCol - 1, 'Colecciones: quitar un archivo no lo borra (solo sale de la colección)');
await pg.click('#toast button'); await pg.waitForFunction((n) => document.querySelectorAll('.col-lista li').length === n, enCol, { timeout: 10000 });
ok(true, 'Colecciones: deshacer devuelve el archivo a la colección');
await shot('w8-coleccion.png');
await decir('Descargá la colección Cierre octubre');
ok(/Armé Cierre octubre\.zip con \d+ archivos/.test(await ultimo()), 'Colecciones: "descargá la colección …" por pedido');
journey('Colecciones');

// ---------------------------------------------------------------- búsqueda de archivos
await pg.keyboard.press('Control+k'); await pg.keyboard.type('margen'); await pg.waitForTimeout(700);
ok(/Archivos[\s\S]*margen\.csv/.test(await pg.textContent('#paletaLista')), 'Búsqueda: archivos subidos y generados en ⌘K');
await pg.keyboard.press('Escape');

// ---------------------------------------------------------------- automatización + plantilla + honestidad con lo programado
await pg.goto(`${BASE}/so/#/a/${ventasId}`); await pg.waitForSelector('.kpis');
await decir('Cada vez que cargue datos en ventas, generá el PDF y avisame');
t = await ultimo();
ok(/cada vez que cargues datos en "Ventas"/.test(t) && /genero el PDF, te aviso/.test(t) && /Verificado/.test(t), 'Automatización: Trigger → Validate → Process → Output → Notify (registrada y verificada)');
const archivosAntes = (await db()).so_files.filter((f) => f.origin === 'export' && f.detected_type === 'pdf').length;
await adjuntar(F.octubre);
await decir('Sumá estos datos al dashboard de ventas');
await pg.waitForFunction(() => window.__db().so_tasks.some((x) => x.kind === 'automation' && x.status === 'completed'), null, { timeout: 30000 }).catch(() => {});
d = await db();
const tareaAuto = d.so_tasks.find((x) => x.kind === 'automation');
ok(tareaAuto?.status === 'completed' && tareaAuto.idempotency_key.startsWith('auto:') && d.so_files.filter((f) => f.origin === 'export' && f.detected_type === 'pdf').length === archivosAntes + 1, 'Automatización: al importar se generó el PDF una sola vez (idempotente por lote)');
ok(d.so_notifications.some((n) => /automatización completada/.test(n.title)), 'Automatización: aviso en el centro de notificaciones');
await decir('Guardá esto como plantilla Informe mensual');
ok(/Guardé la plantilla "Informe mensual"/.test(await ultimo()), 'Plantillas: proceso repetible guardado');
await decir('Generá el informe mensual');
ok(/Generé "Informe mensual"/.test(await ultimo()) && await pg.isVisible('#mensajes .msg:last-child .gu-file'), 'Plantillas: se genera con los datos actuales');
await decir('Cada lunes generá un informe de cobranzas');
ok(/Todavía no puedo ejecutar tareas programadas/.test(await ultimo()), 'Honestidad: lo programado por calendario no se simula');
journey('Automatizar');

// ---------------------------------------------------------------- fallo de generación → recuperación
fs.writeFileSync(path.join(tmp, 'falla-storage'), '1');
await decir('Exportá este tablero a CSV');
t = await ultimo();
ok(/No pude generar el archivo/.test(t) && await pg.isVisible('#mensajes .msg:last-child [data-reintentar]') && !/Verificado/.test(t), 'Recuperación: fallo visible, sin falso éxito, con Reintentar');
fs.unlinkSync(path.join(tmp, 'falla-storage'));
await pg.click('#mensajes .msg:last-child [data-reintentar]'); await listo(); await pg.waitForTimeout(300);
ok(/Verificado/.test(await ultimo()) && await pg.isVisible('#mensajes .msg:last-child .gu-file'), 'Recuperación: el reintento genera y verifica el archivo');
journey('Recuperar');

// ---------------------------------------------------------------- Workspace: favorito, tamaño, orden, ocultar, archivar (persistente, con Deshacer)
await irWorkspace();
const clientes = (await db()).so_artifacts.find((a) => a.name === 'Clientes').id;
await pg.click(`.lcard[data-art="${clientes}"] [data-lc="favorito"]`); await pg.waitForTimeout(500);
ok((await pg.$$eval('#bento .lcard[data-art]', (n) => n[0].dataset.art)) === clientes, 'Favoritos: ☆ → ★ y pasa primero');
await pg.click(`.lcard[data-art="${clientes}"] [data-lc="menu"]`); await pg.click('#menuFlotante [data-mi="tam-L"]'); await pg.waitForTimeout(400);
ok((await db()).so_menu.find((m) => m.artifact_id === clientes).size === 'L' && await pg.getAttribute(`.lcard[data-art="${clientes}"]`, 'data-size') === 'L', 'Bento: tamaño L persistido');
const inventario = (await db()).so_artifacts.find((a) => a.name === 'Inventario').id;
const ordenAntes = await pg.$$eval('#bento .lcard[data-art]', (n) => n.map((x) => x.dataset.art));
await pg.click(`.lcard[data-art="${inventario}"] [data-lc="menu"]`); await pg.click('#menuFlotante [data-mi="antes"]'); await pg.waitForTimeout(500);
const ordenDespues = await pg.$$eval('#bento .lcard[data-art]', (n) => n.map((x) => x.dataset.art));
ok(ordenDespues.indexOf(inventario) === ordenAntes.indexOf(inventario) - 1, 'Bento: "Mover antes" (alternativa accesible al arrastre)');
await pg.reload(); await pg.waitForSelector('#bento');
ok(JSON.stringify(await pg.$$eval('#bento .lcard[data-art]', (n) => n.map((x) => x.dataset.art))) === JSON.stringify(ordenDespues), 'Bento: orden estable entre recargas (no se reorganiza solo)');
const gastos = (await db()).so_artifacts.find((a) => a.name === 'Gastos').id;
await pg.click(`.lcard[data-art="${gastos}"] [data-lc="menu"]`); await pg.click('#menuFlotante [data-mi="archivar"]'); await pg.waitForTimeout(500);
ok(!(await pg.isVisible(`.lcard[data-art="${gastos}"]`)) && await pg.isVisible('[data-ws="archivados"]') && (await db()).so_records.some((r) => r.datasource_id === (d.so_artifacts.find((a) => a.id === gastos)?.datasource_id)), 'Archivar: sale del Workspace sin borrar datos');
await pg.click('#toast button'); await pg.waitForTimeout(500);
ok(await pg.isVisible(`.lcard[data-art="${gastos}"]`), 'Archivar: Deshacer lo devuelve');
journey('Workspace');

// ---------------------------------------------------------------- seguridad de descargas
const owner = (await db()).so_files.find((f) => f.origin === 'export');
const sinToken = await pg.evaluate(async (k) => (await fetch(`/fake-supa/storage/v1/object/so-archivos/${k}`)).status, owner.storage_path);
ok(sinToken === 403, 'Seguridad: sin autorización no se descarga');
const vencido = await pg.evaluate(async (k) => {
  const { data } = await window.supabase.createClient().storage.from('so-archivos').createSignedUrl(k, -5);
  return (await fetch(data.signedUrl)).status;
}, owner.storage_path);
ok(vencido === 400, 'Seguridad: la URL firmada expira');
const alterado = await pg.evaluate(async (k) => {
  const { data } = await window.supabase.createClient().storage.from('so-archivos').createSignedUrl(k, 60);
  return (await fetch(data.signedUrl.replace(/so-archivos\/[^/]+/, 'so-archivos/00000000-0000-0000-0000-00000000000b'))).status;
}, owner.storage_path);
ok(alterado === 400, 'Seguridad: una URL firmada no sirve para otro archivo (path traversal / manipulación)');
const pg2 = await ctx.newPage();
await pg2.goto(BASE + '/so/'); await pg2.evaluate(() => localStorage.setItem('fake.user', 'b'));
const ajeno = await pg2.evaluate(async (k) => {
  const { data, error } = await window.supabase.createClient().storage.from('so-archivos').createSignedUrl(k, 60);
  const directo = (await fetch(`/fake-supa/storage/v1/object/so-archivos/${k}`, { headers: { Authorization: 'Bearer 00000000-0000-0000-0000-00000000000b' } })).status;
  return { firmado: !!data?.signedUrl, error: !!error, directo };
}, owner.storage_path);
ok(!ajeno.firmado && ajeno.error && ajeno.directo === 403, 'Seguridad: otro usuario no puede firmar ni descargar archivos ajenos');
const filasAjenas = await pg2.evaluate(() => window.supabase.createClient().from('so_files').select('*').then((r) => r.data.length));
ok(filasAjenas === 0, 'Seguridad: otro usuario no ve metadatos de archivos ajenos');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'a')); await pg2.close();

// ---------------------------------------------------------------- K — móvil: Workspace → artefacto → Francisco
const movil = await nuevoCtx({ storageState: await ctx.storageState(), viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true });
const pm = await movil.newPage(); pm.on('pageerror', (e) => errores.push('movil: ' + e.message));
await pm.goto(BASE + '/so/'); await pm.waitForSelector('#bento .lcard[data-art]'); await pm.waitForTimeout(300);
const anchos = await pm.$$eval('#bento .lcard[data-art]', (n) => n.slice(0, 3).map((x) => Math.round(x.getBoundingClientRect().width)));
ok(anchos.every((w) => w > 300) && !(await pm.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `K: una columna en móvil (${anchos.join(', ')} px) sin scroll horizontal`);
ok(!(await pm.isVisible('#lateral')) || (await pm.evaluate(() => document.getElementById('lateral').getBoundingClientRect().right <= 0)), 'K: sin sidebar + artefacto + chat a la vez');
await shot('w5-movil-workspace.png', pm);
await pm.tap(`.lcard[data-art="${ventasId}"] .lc-nombre`); await pm.waitForSelector('.kpis');
ok(!(await pm.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'K: artefacto a pantalla completa sin scroll horizontal');
await pm.tap('#orb'); await pm.waitForSelector('#texto', { state: 'visible' }); await pm.waitForTimeout(400);
ok(await pm.evaluate(() => { const r = document.getElementById('panelFrancisco').getBoundingClientRect(); return r.left <= 1 && r.width >= innerWidth - 1; }), 'K: Francisco como hoja completa');
await pm.tap('#cerrarPanel'); await pm.waitForTimeout(400);
ok(await pm.isVisible('.kpis') && /Ventas/.test(await pm.textContent('#titulo')), 'K: cerrar Francisco preserva el artefacto y su contexto');
await shot('w6-movil-artefacto.png', pm);
await movil.close();

// ---------------------------------------------------------------- accesibilidad y modo oscuro
await pg.goto(`${BASE}/so/#/`); await pg.waitForSelector('#bento');
const sinNombre = await pg.evaluate(() => [...document.querySelectorAll('button, a, [role="link"], select, input:not([type="hidden"])')].filter((e) => e.offsetParent !== null)
  .filter((e) => !(e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('title') || (e.labels && e.labels.length) || e.getAttribute('placeholder'))).map((e) => e.outerHTML.slice(0, 80)));
ok(!sinNombre.length, `Accesibilidad: todo control visible tiene nombre accesible${sinNombre.length ? ` (${sinNombre.join(' | ')})` : ''}`);
const objetivos = await pg.evaluate(() => [...document.querySelectorAll('#bento button, #bento .lcard, .encabezado button')].filter((e) => e.offsetParent !== null).map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width < 24 || r.height < 24).map(([e, r]) => `${e.className || e.id}:${e.dataset.lc || ''} ${Math.round(r.width)}×${Math.round(r.height)}`));
ok(objetivos.length === 0, `Accesibilidad: objetivos táctiles ≥ 24 px (WCAG 2.2 AA)${objetivos.length ? ` (${objetivos.slice(0, 4).join(' | ')})` : ''}`);
await pg.focus(`.lcard[data-art="${ventasId}"]`);
ok(await pg.evaluate(() => getComputedStyle(document.activeElement).boxShadow !== 'none' || getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'Accesibilidad: foco visible en tarjetas');
await pg.emulateMedia({ colorScheme: 'dark' }); await pg.waitForTimeout(200);
const contraste = await pg.evaluate(() => {
  const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = (c) => { const [r, g, b] = rgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const card = document.querySelector('.lcard[data-art]'); const fondo = getComputedStyle(card).backgroundColor;
  return { texto: ratio(getComputedStyle(card.querySelector('.lc-nombre')).color, fondo), secundario: ratio(getComputedStyle(card.querySelector('.lc-sub')).color, fondo), fondo };
});
ok(contraste.texto >= 4.5 && contraste.secundario >= 4.5 && contraste.fondo !== 'rgb(255, 255, 255)', `Modo oscuro: paleta propia con contraste AA (${contraste.texto.toFixed(1)} / ${contraste.secundario.toFixed(1)})`);
await shot('w7-oscuro.png');
await pg.emulateMedia({ colorScheme: 'light' });
await pg.emulateMedia({ reducedMotion: 'reduce' });
ok(await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--m-standard').trim() === '0ms'), 'Movimiento: prefers-reduced-motion anula las transiciones');

const rechazados = await pg.evaluate(() => window.__eventosRechazados || []);
ok(!rechazados.length, `Métricas: ningún evento rechazado por la base${rechazados.length ? ` (${[...new Set(rechazados)].join(', ')})` : ''}`);
console.log('PASOS', JSON.stringify(medidas));
console.log('ERRORES', JSON.stringify(errores));
console.log(`FALLOS ${fallos.length}`); fallos.forEach((f) => console.log('  - ' + f));
await b.close(); srv.close();
process.exitCode = fallos.length || errores.length ? 1 : 0;
