// Recorridos de ingesta universal A–K en Chromium real contra el Supabase simulado (Storage incluido) y un servidor
// local que hace de API externa. Los archivos de prueba se generan acá (XLSX, PDF, DOCX, PPTX, ODT, CSV, JSON, XML,
// imágenes y archivos disfrazados). Uso: npm run test:so:ingesta (SO_E2E_OUT=<carpeta> guarda capturas).
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
import { crearServidor } from './servidor.mjs';
const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const XLSX = require(path.join(root, 'valo/vendor/xlsx.full.min.js'));
const out = process.env.SO_E2E_OUT || null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'so-ingesta-'));

// ---------------------------------------------------------------- archivos de prueba
const F = {};
{
  const filas = [['Fecha', 'Cliente', 'Canal', 'Importe']];
  for (let i = 1; i <= 20; i++) filas.push([new Date(Date.UTC(2026, 8, i)), `Cliente ${i}`, i % 2 ? 'web' : 'local', 1000 + i * 10]);
  filas.push(['fecha mal', 'X', 'web', 5], [new Date(Date.UTC(2026, 8, 25)), 'Y', 'web', null]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas, { cellDates: true }), 'Ventas');
  F.xlsx = path.join(tmp, 'ventas_septiembre.xlsx'); fs.writeFileSync(F.xlsx, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
{
  const texto = 'Informe anual. Las ventas mayoristas crecieron 14% en octubre gracias a nuevos distribuidores.';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const flujo = `BT /F1 12 Tf 40 700 Td (${texto}) Tj ET`;
  objs[3] = `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`;
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  F.pdf = path.join(tmp, 'informe.pdf'); fs.writeFileSync(F.pdf, pdf);
}
const zip = (nombre, archivos) => {
  const cfb = XLSX.CFB.utils.cfb_new();
  for (const [p, c] of Object.entries(archivos)) XLSX.CFB.utils.cfb_add(cfb, p, Buffer.from(c));
  const f = path.join(tmp, nombre); fs.writeFileSync(f, XLSX.CFB.write(cfb, { fileType: 'zip', type: 'buffer', compression: true })); return f;
};
F.docx = zip('contrato.docx', { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Cláusula de precios</w:t></w:r></w:p><w:p><w:r><w:t>El precio se ajusta trimestralmente por inflación.</w:t></w:r></w:p></w:body></w:document>' });
F.pptx = zip('plan.pptx', { '[Content_Types].xml': '<Types/>', 'ppt/slides/slide1.xml': '<p:sld><a:t>Plan comercial 2027</a:t></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:t>Abrir tres sucursales</a:t></p:sld>' });
F.odt = zip('acta.odt', { mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:document-content><text:h>Acta</text:h><text:p>Se aprobó el presupuesto.</text:p></office:document-content>' });
F.json = path.join(tmp, 'clientes.json'); fs.writeFileSync(F.json, JSON.stringify({ data: [{ cuit: '30-1', nombre: 'ACME', saldo: 10 }, { cuit: '30-2', nombre: 'Beta', saldo: 20 }] }));
F.xml = path.join(tmp, 'stock.xml'); fs.writeFileSync(F.xml, '<?xml version="1.0"?><stock><item><sku>A1</sku><cant>3</cant></item><item><sku>B2</sku><cant>5</cant></item></stock>');
F.xxe = path.join(tmp, 'xxe.xml'); fs.writeFileSync(F.xxe, '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>');
F.md = path.join(tmp, 'notas.md'); fs.writeFileSync(F.md, '# Objetivos\nCrecer 20% en mayoristas.\n\n# Riesgos\nTipo de cambio.');
F.rtf = path.join(tmp, 'carta.rtf'); fs.writeFileSync(F.rtf, '{\\rtf1\\ansi Estimado cliente,\\par gracias por su compra.}');
F.heic = path.join(tmp, 'IMG_0001.HEIC'); fs.writeFileSync(F.heic, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(200, 7)]));
F.exe = path.join(tmp, 'factura.pdf'); fs.writeFileSync(F.exe, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 1)]));
F.roto = path.join(tmp, 'roto.xlsx'); fs.writeFileSync(F.roto, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(500, 9)]));
const csv = (nombre, mes, n, extra = []) => {
  const f = path.join(tmp, nombre);
  const filas = ['fecha;cliente;canal;importe'];
  for (let i = 0; i < n; i++) filas.push(`${String(1 + (i % 28)).padStart(2, '0')}/${mes}/2026;C${i};${i % 3 ? 'web' : 'local'};${(100 + (i % 50)).toLocaleString('es-AR')}`);
  fs.writeFileSync(f, [...filas, ...extra].join('\n')); return f;
};
F.oct = csv('ventas_octubre.csv', '10', 30, ['xx/10/2026;Z;web;1', '05/10/2026;Z;web;']);
F.nov = csv('ventas_noviembre.csv', '11', 25);
F.grande = csv('ventas_historicas.csv', '07', 6000);   // > 5.000 filas → tarea en segundo plano (el simulador guarda todo en localStorage)
F.cuitDup = path.join(tmp, '..%2F..%2Fetc%2Fpasswd.csv'); fs.writeFileSync(F.cuitDup, 'fecha;importe\n01/10/2026;1');

// ---------------------------------------------------------------- servidor: sitio + Storage simulado + API externa
let diaApi = 0;
const { srv, BASE } = crearServidor({ puerto: 8768, root, dir, tmp, extra: (p, req, res) => {
  if (!p.startsWith('/fake-api/')) return false;
  const dias = [...Array(3 + diaApi)].map((_, i) => ({ fecha: `2026-10-${String(20 + i).padStart(2, '0')}`, compra: 1400 + i * 5, venta: 1450 + i * 5 }));
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: dias }));
} });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await ctx.route('https://cdn.openart.ai/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PNG }));   // avatar OpenArt (sin internet en el sandbox)
const pg = await ctx.newPage();
const errores = []; pg.on('pageerror', (e) => errores.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/403|404|503|Failed to load resource/.test(m.text()) && errores.push(m.text()));
pg.on('dialog', (dlg) => dlg.accept());
const fallos = []; let pasos = 0; const medidas = {};
const ok = (c, msg) => { if (!c) fallos.push(msg); console.log(`${c ? '✔' : '✘'} ${msg}`); };
const listo = () => pg.waitForFunction(() => !document.getElementById('enviar').disabled, null, { timeout: 120000 });
const asegurarPanel = async () => { if (!(await pg.isVisible('#texto'))) { await pg.click('#orb'); await pg.waitForSelector('#texto', { state: 'visible' }); } };
const abrirDatos = async () => { await pg.click('[data-aa="mas"]'); await pg.click('[data-mi="datos"]'); await pg.waitForSelector('#hoja[open] #datosCuerpo'); };
const cerrarHoja = async () => { if (await pg.$eval('#hoja', (n) => n.open)) await pg.click('#cerrarHoja'); };
const decir = async (t) => { pasos++; await cerrarHoja(); await asegurarPanel(); await pg.fill('#texto', t); await pg.press('#texto', 'Enter'); await pg.waitForTimeout(100); await listo(); await pg.waitForTimeout(250); };
const ultimo = () => pg.$eval('#mensajes .msg.assistant:last-of-type', (n) => n.textContent.replace(/\s+/g, ' ').trim());
const db = () => pg.evaluate(() => window.__db());
const adjuntar = async (...files) => {
  pasos++;
  const antes = await pg.$$eval('#bandeja .adj', (n) => n.length);
  await pg.setInputFiles('#inpArchivos', files);
  await pg.waitForFunction((n) => document.querySelectorAll('#bandeja .adj').length >= n, antes + files.length, { timeout: 20000 });
  await pg.waitForFunction(() => ![...document.querySelectorAll('#bandeja .adj')].some((n) => /esperando|subiendo|procesando/.test(n.className)), null, { timeout: 60000 });
};
const journey = (n) => { medidas[n] = pasos; pasos = 0; };
const shot = async (n) => { if (out) await pg.screenshot({ path: path.join(out, n) }); };

await pg.goto(BASE + '/so/'); await pg.evaluate(() => localStorage.clear()); await pg.goto(BASE + '/so/');
await pg.waitForSelector('#app:not([hidden])'); await pg.waitForTimeout(400);

// ---------- A — chat + documento
await adjuntar(F.pdf);
if (process.env.SO_DEBUG) { console.log('BANDEJA', await pg.textContent('#bandeja')); console.log('ERR', errores); console.log('FILES', JSON.stringify((await db()).so_files)); }
ok(/Listo/.test(await pg.textContent('#bandeja')), 'A: PDF subido y leído (estado visible en el adjunto)');
await decir('¿Cuánto crecieron las ventas mayoristas?');
let t = await ultimo();
ok(/14%/.test(t) && /página 1/.test(t), 'A: respuesta basada en el archivo con referencia de página');
ok(await pg.locator('#mensajes .msg.user').last().locator('.adj-chip').isVisible(), 'A: el adjunto queda visible en el mensaje');
let d = await db();
const pdfRow = d.so_files.find((f) => f.original_name === 'informe.pdf');
ok(pdfRow?.detected_type === 'pdf' && pdfRow.status === 'ready' && d.so_file_chunks.some((k) => k.file_id === pdfRow.id && k.ref.pagina === 1), 'A: metadatos + fragmentos indexados con página');
ok(pdfRow.storage_path.startsWith(`${pdfRow.owner_id}/${pdfRow.id}/`), 'A: binario en Storage, carpeta del usuario');
await pg.locator('#mensajes .msg.user').last().locator('.adj-chip').click(); await pg.waitForTimeout(800);
ok(/Las ventas mayoristas crecieron/.test(await pg.textContent('#dlgArchivoCuerpo')) && /Antivirus: no disponible/.test(await pg.textContent('#dlgArchivoCuerpo')), 'A: vista previa del documento sin afirmar antivirus');
await pg.keyboard.press('Escape');
journey('A');

// ---------- B — chat + foto (pegada desde el portapapeles)
pasos++;
await pg.evaluate(async () => {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 48 }); const g = c.getContext('2d'); g.fillStyle = '#2a78d6'; g.fillRect(0, 0, 64, 48);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  document.getElementById('texto').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
});
await pg.waitForFunction(() => /Listo/.test(document.getElementById('bandeja').textContent), null, { timeout: 20000 });
ok(await pg.isVisible('#bandeja .adj img'), 'B: imagen pegada con miniatura antes de enviar');
await decir('¿Qué aparece en esta foto?');
t = await ultimo();
ok(/64×48/.test(t) && /visión/.test(t), 'B: análisis honesto (sin modelo de visión no inventa contenido)');
ok(await pg.locator('#mensajes .msg.user').last().locator('.adj-img img').isVisible(), 'B: la foto queda en la conversación');
d = await db();
ok(d.so_files.some((f) => f.kind === 'image' && f.detected_type === 'png'), 'B: imagen almacenada con tipo real');
journey('B');

// ---------- tipos de archivo
await adjuntar(F.docx, F.pptx, F.odt, F.json, F.xml, F.md, F.rtf, F.heic, F.exe, F.xxe);
const estados = await pg.$$eval('#bandeja .adj', (ns) => ns.map((n) => `${n.querySelector('strong').textContent}:${n.className.replace('adj ', '')}:${n.querySelector('small').textContent}`));
console.log(estados.join('\n'));
const est = (n) => estados.find((x) => x.startsWith(n + ':')) || '';
ok(/:listo:/.test(est('contrato.docx')) && /:listo:/.test(est('plan.pptx')) && /:listo:/.test(est('acta.odt')), 'Tipos: DOCX, PPTX y ODT leídos');
ok(/:listo:/.test(est('clientes.json')) && /:listo:/.test(est('stock.xml')) && /:listo:/.test(est('notas.md')) && /:listo:/.test(est('carta.rtf')), 'Tipos: JSON, XML, MD y RTF leídos');
ok(/:parcial:/.test(est('IMG_0001.HEIC')), 'Tipos: HEIC guardado con aviso (no se puede mostrar ni analizar)');
ok(/:rechazado:.*programa/.test(est('factura.pdf')), 'Seguridad: ejecutable disfrazado de PDF rechazado');
ok(/:fallo:.*DTD/.test(est('xxe.xml')), 'Seguridad: XML con entidades externas no se procesa');
d = await db();
ok(!d.so_files.some((f) => f.original_name === 'factura.pdf'), 'Seguridad: lo rechazado no se almacena');
const docx = d.so_files.find((f) => f.original_name === 'contrato.docx');
ok(d.so_file_chunks.some((k) => k.file_id === docx.id && /trimestralmente/.test(k.content) && k.ref.seccion === 'Cláusula de precios'), 'Tipos: DOCX indexado con sección');
ok(d.so_file_chunks.some((k) => /sucursales/.test(k.content) && k.ref.diapositiva === 2), 'Tipos: PPTX indexado por diapositiva');
await pg.$$eval('#bandeja [data-quitar]', (bs) => bs.forEach((x) => x.click()));

// ---------- C — chat + Excel → dashboard
await adjuntar(F.xlsx);
await decir('Creá un dashboard con estos datos');
t = await ultimo();
ok(/Creé "Dashboard de ventas septiembre"/.test(t) && /20 registros incorporados/.test(t) && /2 registros necesitan revisión/.test(t), 'C: dataset + artefacto + importación con resumen humano');
ok(await pg.isVisible('#mensajes .msg:last-child >> text=Ver incidencias') && await pg.isVisible('#mensajes .msg:last-child >> text=Abrir'), 'C: acciones Ver incidencias / Abrir');
d = await db();
const dsC = d.so_datasources.find((x) => x.name === 'Dashboard de ventas septiembre');
ok(dsC && dsC.fields.map((f) => f.key).join() === 'cliente,canal,importe', 'C: campos inferidos de las columnas (fecha como período)');
ok(d.so_records.filter((r) => r.datasource_id === dsC.id).length === 20 && d.so_records.every((r) => r.datasource_id !== dsC.id || r.period.startsWith('2026-09')), 'C: 20 filas válidas persistidas con su fecha; inválidas no');
await pg.click('#mensajes .msg:last-child [data-incidencias]'); await pg.waitForTimeout(400);
ok(/Fila 22 — fecha inválida/.test(await pg.textContent('#dlgArchivoCuerpo')) && /Fila 23 — Importe vacío/.test(await pg.textContent('#dlgArchivoCuerpo')), 'H: incidencias comprensibles por fila');
await pg.keyboard.press('Escape');
journey('C');

// ---------- D — tablero + CSV desde "Datos y fuentes" (vista previa → mapeo → importar → refrescar)
await pg.click('#mensajes .msg:last-child .msg-card a.primario'); await pg.waitForSelector('.kpis'); pasos++;
await abrirDatos(); pasos++; await pg.waitForTimeout(400);
await pg.setInputFiles('#datosCuerpo [data-subir]', F.oct); pasos++;
await pg.waitForSelector('#dlgImportar[open] .resumen-import', { timeout: 20000 }); await pg.waitForTimeout(300);
ok(/Se incorporarán 30 registros; 2 necesitan revisión/.test(await pg.textContent('#formImportar .resumen-import')), 'D: vista previa con conteos antes de importar');
ok((await pg.$eval('#formImportar select[name="col:importe"]', (s) => s.value)) === 'importe' && (await pg.$eval('#formImportar select[name="col:fecha"]', (s) => s.value)) === '__fecha', 'D: mapeo inferido (importe → Importe, fecha → período)');
await pg.click('#formImportar [value="importar"]'); pasos++;
await pg.waitForFunction(() => !document.getElementById('dlgImportar').open, null, { timeout: 30000 }); await pg.waitForTimeout(800);
ok(/Registros\s*50/.test(await pg.textContent('.kpis')), 'D: tablero actualizado (20 + 30)');
ok(/ventas_octubre\.csv[\s\S]*30 incorporados[\s\S]*2 a revisar/.test(await pg.textContent('#datosCuerpo')), 'D: importación listada con resultado');
journey('D');

// ---------- Históricos: anular cualquier subida (sin borrar) y restaurarla
await pg.click('#datosCuerpo [data-tabd="historicos"]');
ok(await pg.isVisible('#datosCuerpo [data-panel-d="historicos"]') && !(await pg.isVisible('#datosCuerpo [data-subir]')), 'Históricos: solapa propia con todas las subidas');
const filasAntes = (await db()).so_records.length;
await pg.click('#datosCuerpo .historicos li:has-text("ventas_octubre.csv") [data-anular-lote]');
await pg.waitForSelector('#datosCuerpo .historicos li.anulada:has-text("ventas_octubre.csv") [data-restaurar-lote]', { timeout: 10000 }); await pg.waitForTimeout(800);
ok(/Registros\s*20/.test(await pg.textContent('.kpis')) && (await db()).so_records.length === filasAntes, 'Históricos: anular saca la subida del tablero sin borrar filas');
await pg.click('#datosCuerpo .historicos li:has-text("ventas_octubre.csv") [data-restaurar-lote]');
await pg.waitForSelector('#datosCuerpo .historicos li:not(.anulada):has-text("ventas_octubre.csv") [data-anular-lote]', { timeout: 10000 }); await pg.waitForTimeout(800);
ok(/Registros\s*50/.test(await pg.textContent('.kpis')), 'Históricos: restaurar la devuelve al tablero');
await pg.click('#datosCuerpo [data-tabd="fuentes"]');

// ---------- I — duplicado
await pg.setInputFiles('#datosCuerpo [data-subir]', F.oct); pasos++;
await pg.waitForSelector('#dlgImportar[open] .alerta-txt', { timeout: 20000 });
ok(/parece haber sido importado anteriormente/.test(await pg.textContent('#formImportar')), 'I: mismo archivo detectado como importado antes (vista previa)');
await pg.click('#formImportar [data-cerrar]');
await cerrarHoja();
await adjuntar(F.oct);
await decir('Sumá estos datos a este dashboard');
t = await ultimo();
ok(/parece haber sido importado anteriormente/.test(t) && /Importar igual/.test(t), 'I: desde el chat también avisa y no duplica');
d = await db();
ok(d.so_records.filter((r) => r.datasource_id === dsC.id && !r.superseded_by).length === 50, 'I: no se duplicaron registros');
journey('I');

// ---------- E — histórico mensual + comparación
await adjuntar(F.nov);
await decir('Sumá estos datos al histórico');
t = await ultimo();
ok(/25 registros incorporados/.test(t) && /Verificado/.test(t), 'E: archivo mensual sumado (APPEND) y verificado');
await decir('Compará noviembre con octubre');
t = await ultimo();
if (process.env.SO_DEBUG) console.log('COMP', t, await pg.evaluate(() => location.hash));
ok(/Noviembre 2026 respecto de Octubre 2026/.test(t), 'E: comparación entre períodos sobre el histórico');
d = await db();
ok(d.so_datasources.filter((x) => x.owner_id === d.so_datasources[0].owner_id).length === 1 + d.so_datasources.filter((x) => x.name !== 'Dashboard de ventas septiembre').length, 'E: un solo dataset acumulativo (sin tabla por mes)');
if (!(await pg.isVisible('[data-fila]'))) await pg.click('details.tarjeta:has(table) summary');
await pg.click('[data-fila]'); await pg.waitForTimeout(300);
await decir('¿De dónde salió este dato?');
t = await ultimo();
ok(/salió del archivo ventas_noviembre\.csv, fila \d+/.test(t), 'Linaje: registro → lote → archivo y fila');
journey('E');

// ---------- deshacer importación (reversible)
await pg.click('#mensajes .msg.assistant >> nth=-3 >> [data-undo]').catch(() => {});
await pg.waitForTimeout(800);
d = await db();
const novLote = d.so_import_batches.find((x) => x.source_name === 'ventas_noviembre.csv');
ok(novLote.status === 'undone' && d.so_records.some((r) => r.import_batch_id === novLote.id) && d.so_records.filter((r) => r.import_batch_id === novLote.id).every((r) => r.superseded_by === novLote.id), 'Deshacer importación: lote anulado sin borrar filas ni tocar el resto');

// ---------- F/G — API → historial
await decir('Este dashboard tiene que traer cotizaciones desde https://api.ejemplo.com/v1/cotizaciones y guardar el histórico');
ok(/¿Qué columna corresponde a "Importe": "compra" o "venta"\?/.test(await ultimo()), 'F: mapeo ambiguo → pregunta solo la decisión necesaria');
await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(400);
await decir('Quiero un tablero que traiga cotizaciones desde https://api.ejemplo.com/v1/cotizaciones y guarde el histórico');
t = await ultimo();
if (process.env.SO_DEBUG) console.log('APIMSG', t);
ok(/Conecté api\.ejemplo\.com/.test(t) && /3 datos recibidos, 3 nuevos guardados/.test(t), 'F: API configurada, probada, mapeada y sincronizada');
d = await db();
const api = d.so_api_sources.find((x) => x.base_url.includes('api.ejemplo.com') && x.response_mapping?.asignaciones);
ok(api && api.response_mapping.asignaciones.length >= 2 && api.auth_ref == null && !JSON.stringify(api).includes('secret'), 'F: configuración sin secretos y con mapeo');
diaApi = 2;
await pg.evaluate((id) => { const db = window.__db(); db.so_api_sources.find((x) => x.id === id).last_sync_at = new Date(Date.now() - 120000).toISOString(); localStorage.setItem('fake.db', JSON.stringify(db)); }, api.id);
ok(/panel-abierto/.test(await pg.getAttribute('#app', 'class')) && /vista-home/.test(await pg.getAttribute('#app', 'class')), 'UX: al pedir algo desde el Workspace la respuesta se ve sin abandonarlo');
await pg.click('#mensajes .msg:last-child .msg-card a.primario'); await pg.waitForSelector('.kpis'); pasos++;
ok(/Registros\s*3/.test(await pg.textContent('.kpis')), 'F: el tablero muestra los datos de la API');
await abrirDatos();
await pg.waitForSelector('#datosCuerpo [data-sync]');
await pg.click('#datosCuerpo [data-sync]'); pasos++;
await pg.waitForTimeout(1200);
d = await db();
const dsApi = d.so_datasources.find((x) => x.id === api.dataset_id);
const recApi = d.so_records.filter((r) => r.import_batch_id && d.so_import_batches.find((l) => l.id === r.import_batch_id)?.api_source_id === api.id);
ok(recApi.length === 5 && new Set(recApi.map((r) => r.period)).size === 5, 'G: segunda sincronización suma solo lo nuevo (historial sin duplicados)');
journey('F/G');

// ---------- API con credencial: pedida por formulario seguro, nunca por chat
await decir('mi token: sk-abcdefghijklmnop1234');
ok(/parece una credencial/.test(await pg.textContent('#actividad')) && !(await db()).so_messages.some((m) => /sk-abcdef/.test(m.content)), 'Seguridad: credencial pegada en el chat no se envía ni se guarda');
await pg.fill('#texto', '');
await decir('Conectá esta API https://privada.ejemplo.com/v1/cotizaciones');
t = await ultimo();
ok(/necesita una credencial/.test(t) && await pg.isVisible('#mensajes .msg:last-child [data-credencial]'), 'F: falta credencial → formulario seguro');
await pg.click('#mensajes .msg:last-child [data-credencial]'); await pg.waitForSelector('#dlgApi[open]');
await pg.selectOption('#formApi [name="esquema"]', 'bearer');
ok((await pg.getAttribute('#formApi [name="secreto"]', 'type')) === 'password', 'F: la credencial se escribe en un campo oculto');
await pg.fill('#formApi [name="secreto"]', 'token-real-123'); await pg.click('#formApi button[type="submit"]');
await pg.waitForFunction(() => !document.getElementById('dlgApi').open, null, { timeout: 20000 }); await pg.waitForTimeout(600);
d = await db();
ok(d.so_api_sources.find((x) => x.base_url.includes('privada'))?.auth_ref && !JSON.stringify(d.so_api_sources).includes('token-real-123') && !JSON.stringify(d.so_messages).includes('token-real-123'), 'F: credencial guardada solo como referencia (Vault)');

// ---------- H — errores y recuperación
fs.writeFileSync(path.join(tmp, 'falla-storage'), '1');
await adjuntar(F.md.replace('notas', 'notas')); // mismo contenido, otro intento
ok(/Falló[\s\S]*No se pudo subir/.test(await pg.textContent('#bandeja')) && await pg.isVisible('#bandeja [data-reintentar]'), 'H: fallo de subida visible con Reintentar');
fs.unlinkSync(path.join(tmp, 'falla-storage'));
await pg.click('#bandeja [data-reintentar]');
await pg.waitForFunction(() => /Listo/.test(document.getElementById('bandeja').textContent), null, { timeout: 20000 });
ok(true, 'H: reintento sin volver a elegir el archivo');
await pg.$$eval('#bandeja [data-quitar]', (bs) => bs.forEach((x) => x.click()));
await adjuntar(F.roto, F.json);
ok(/roto\.xlsx[\s\S]*Falló/.test(await pg.textContent('#bandeja')), 'H: archivo malformado falla en la lectura sin romper nada');
await decir('Analizá estos archivos');
t = await ultimo();
ok(/No pude adjuntar roto\.xlsx/.test(t) && /clientes\.json/.test(t), 'H: el chat sigue funcionando aunque falle un adjunto');
journey('H');

// ---------- K — archivo grande en segundo plano (+ interrupción y reanudación sin duplicar)
await adjuntar(F.grande);
pasos++;
await pg.fill('#texto', 'Sumá estos datos al dashboard de ventas septiembre'); await pg.press('#texto', 'Enter');
await pg.waitForFunction(() => window.__db().so_tasks.some((x) => x.status === 'running' && x.progress > 0.15), null, { timeout: 60000, polling: 20 });
ok(true, 'K: importación grande en segundo plano con progreso real');
await pg.evaluate(() => localStorage.setItem('fake.fallar', JSON.stringify(['so_records.upsert'])));
await pg.waitForFunction(() => !document.getElementById('enviar').disabled, null, { timeout: 60000 });
await pg.evaluate(() => localStorage.setItem('fake.fallar', '[]'));
d = await db();
let tarea = d.so_tasks.find((x) => x.name === 'Importar ventas_historicas.csv');
ok(tarea?.status === 'failed' && tarea.needs_action === 'Reanudar', 'K/H: corte a mitad → tarea marcada para reanudar (archivo ya guardado)');
await decir('¿qué dashboards tengo?');
ok(/Tenés/.test(await ultimo()), 'K: el usuario sigue trabajando mientras tanto');
await pg.click('#btnCentro'); await pg.waitForTimeout(300);
await pg.click('#centroCuerpo [data-reanudar]'); pasos++;
await pg.waitForFunction(() => window.__db().so_tasks.find((x) => x.name === 'Importar ventas_historicas.csv')?.status === 'completed', null, { timeout: 60000 })
  .catch(async (e) => { console.log('KDBG', JSON.stringify((await db()).so_tasks.filter((x) => x.kind === 'import')), JSON.stringify((await db()).so_notifications.slice(-3)), errores); throw e; });
await pg.waitForTimeout(500);
d = await db();
const lote = d.so_import_batches.find((l) => l.source_name === 'ventas_historicas.csv');
ok(d.so_records.filter((r) => r.import_batch_id === lote.id).length === 6000 && d.so_import_batches.filter((l) => l.source_name === 'ventas_historicas.csv').length === 1, 'K: reanudación con el mismo lote: 6.000 filas, sin duplicados');
if (!(await pg.$eval('#centro', (n) => n.open))) await pg.click('#btnCentro');
await pg.click('#centro [data-tab="tareas"]'); await pg.waitForTimeout(300);
ok(/Finalizadas[\s\S]*Importar ventas_historicas\.csv/.test(await pg.textContent('#centroCuerpo')), 'K: resultado en el centro de actividad');
await pg.keyboard.press('Escape');
journey('K');

// ---------- búsqueda de archivos y referencias naturales
await pg.keyboard.press('Control+k'); await pg.keyboard.type('mayoristas'); await pg.waitForTimeout(700);
ok(/Archivos[\s\S]*informe\.pdf/.test(await pg.textContent('#paletaLista')), 'Búsqueda: archivos por contenido');
await pg.keyboard.press('Escape');
await decir('Analizá el pdf que subí hoy');
if (process.env.SO_DEBUG) console.log('PDFDBG', await ultimo(), await pg.evaluate(() => [location.hash, document.getElementById('app').className, document.getElementById('menuWorkspace').innerHTML.slice(0, 400)]));
ok(/informe\.pdf/.test(await ultimo()), 'Referencias: "el pdf que subí hoy" se resuelve sin pedir nombre');

// ---------- J — permisos en tablero compartido
await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(300);
await pg.click('#menuWorkspace a:has-text("ventas septiembre")'); await pg.waitForSelector('.kpis');
await decir('compartilo con ana@empresa.com');
const artId = (await db()).so_artifacts.find((x) => x.name === 'Dashboard de ventas septiembre').id;
const pg2 = await ctx.newPage(); pg2.on('pageerror', (e) => errores.push('shared: ' + e.message));
await pg2.goto(BASE + '/so/'); await pg2.evaluate(() => localStorage.setItem('fake.user', 'b'));
await pg2.goto(`${BASE}/so/shared/${artId}`); await pg2.waitForSelector('.kpis');
ok(!(await pg2.$('details.carga-det')), 'J: USE sin habilitación → no puede cargar datos');
const ajenos = await pg2.evaluate(async (k) => (await fetch(`/fake-supa/storage/v1/object/so-archivos/${k}`, { headers: { Authorization: 'Bearer 00000000-0000-0000-0000-00000000000b' } })).status, pdfRow.storage_path);
ok(ajenos === 403, 'J: el receptor no accede a los archivos fuente del dueño');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'a'));
if (await pg.isVisible('#panelFrancisco')) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); }
await abrirDatos();
await pg.waitForSelector('#datosCuerpo [data-shared-input]'); await pg.check('#datosCuerpo [data-shared-input]'); await pg.waitForTimeout(500);
await cerrarHoja();
await pg2.evaluate(() => localStorage.setItem('fake.user', 'b')); await pg2.reload(); await pg2.waitForSelector('.kpis');
ok(await pg2.$('details.carga-det') !== null && /cargar datos/.test(await pg2.textContent('#meta')), 'J: habilitado por el dueño → USE puede cargar');
await pg2.setInputFiles('form.carga input[data-r="csv"]', F.nov); await pg2.waitForTimeout(2500);
ok(/25 registros incorporados/.test(await pg2.textContent('#artefacto')), 'J: el receptor importa un archivo (APPEND)');
await pg2.setInputFiles('form.carga input[data-r="csv"]', F.nov); await pg2.waitForTimeout(2000);
ok(/importado anteriormente/.test(await pg2.textContent('#artefacto')), 'J/I: duplicado detectado también para el receptor');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'a'));
await decir('compartilo con ana@empresa.com solo lectura');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'b')); await pg2.reload(); await pg2.waitForSelector('.kpis');
ok(!(await pg2.$('details.carga-det')), 'J: VIEW nunca carga datos');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'a')); await pg2.close();
journey('J');

// ---------- móvil y accesibilidad
await shot('i1-escritorio.png');
await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(300);
if (!(await pg.isVisible('#panelFrancisco'))) await pg.click('#orb'); await pg.waitForTimeout(300);
const movil = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
const pm = await movil.newPage();
await pm.goto(BASE + '/so/'); await pm.waitForSelector('#app:not([hidden])'); await pm.waitForTimeout(500);
ok(!(await pm.isVisible('#panelFrancisco')) && await pm.isVisible('#orb'), 'Móvil: el Workspace primero; Francisco en el orbe');
await pm.tap('#orb'); await pm.waitForSelector('#texto', { state: 'visible' }); await pm.waitForTimeout(400);   // fin de la transición del panel
ok(await pm.isVisible('#adjuntar') && await pm.isVisible('#camara'), 'Móvil: adjuntar archivo y foto/cámara disponibles (pantalla táctil)');
ok(!(await pm.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Móvil táctil: sin scroll horizontal');
ok(await pm.evaluate(() => { const r = document.getElementById('enviar').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }), 'Móvil táctil: Enviar entero dentro de la pantalla');
if (out) await pm.screenshot({ path: path.join(out, 'i3-movil-tactil.png') });
await movil.close();
ok(await pg.isVisible('#adjuntar'), 'Móvil: adjuntar disponible en el panel de Francisco');
ok((await pg.getAttribute('#inpCamara', 'capture')) === 'environment' && (await pg.getAttribute('#inpCamara', 'accept')) === 'image/*', 'Móvil: cámara trasera cuando el navegador lo permite');
ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Móvil: sin scroll horizontal');
await shot('i2-movil.png');
ok((await pg.$$eval('#bandeja button, #adjuntar, #camara', (bs) => bs.every((x) => x.getAttribute('aria-label')))), 'Accesibilidad: controles de adjuntos con etiqueta');

console.log('PASOS', JSON.stringify(medidas));
console.log('ERRORES', JSON.stringify(errores));
console.log(`FALLOS ${fallos.length}`); fallos.forEach((f) => console.log('  - ' + f));
await b.close(); srv.close();
process.exitCode = fallos.length || errores.length ? 1 : 0;
