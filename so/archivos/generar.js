// SO · GeneratedFileService (parte pura): DocSpec → archivo real (XLSX, CSV, JSON, XML, PDF, DOCX, PPTX, RTF, TXT, MD,
// PNG, JPG, WEBP) y su validación estructural antes de informar nada. Las librerías pesadas (ExcelJS, jsPDF) y el lienzo
// para imágenes se inyectan con `libs` (en el navegador se cargan bajo demanda; en los tests, desde node).
import { docx, pptx } from './ooxml.js';
import { entradasZip } from './zip.js';

export const FORMATOS = {
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'table', etiqueta: 'Excel' },
  csv: { mime: 'text/csv', kind: 'table', etiqueta: 'CSV' },
  json: { mime: 'application/json', kind: 'table', etiqueta: 'JSON' },
  pdf: { mime: 'application/pdf', kind: 'document', etiqueta: 'PDF' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', etiqueta: 'Word' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'presentation', etiqueta: 'PowerPoint' },
  txt: { mime: 'text/plain', kind: 'document', etiqueta: 'Texto' },
  md: { mime: 'text/markdown', kind: 'document', etiqueta: 'Markdown' },
  rtf: { mime: 'application/rtf', kind: 'document', etiqueta: 'RTF' },
  xml: { mime: 'application/xml', kind: 'table', etiqueta: 'XML' },
  png: { mime: 'image/png', kind: 'image', etiqueta: 'PNG', imagen: true },
  jpg: { mime: 'image/jpeg', kind: 'image', etiqueta: 'JPG', imagen: true },
  webp: { mime: 'image/webp', kind: 'image', etiqueta: 'WEBP', imagen: true },
  zip: { mime: 'application/zip', kind: 'other', etiqueta: 'ZIP', paquete: true },   // paquete de varios archivos (no sale de un DocSpec)
};
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const celda = (v) => (typeof v === 'number' ? fmt.format(v) : String(v ?? ''));
const deltaTxt = (d) => (d == null ? '' : ` (${d >= 0 ? '+' : '-'}${fmt.format(Math.abs(d * 100))}%)`);

export function nombreArchivo(titulo, formato) {
  const base = String(titulo || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'archivo';
  return `${base.replace(/^[^A-Za-z0-9]+/, '') || 'archivo'}.${formato}`;
}

const tablas = (doc) => (doc.secciones || []).filter((s) => s.tabla?.columnas?.length);
// Un CSV lleva una sola tabla: la más completa (el detalle), no el resumen mensual.
export const tablaCsv = (doc) => tablas(doc).reduce((m, s) => (!m || s.tabla.filas.length >= m.tabla.filas.length ? s : m), null);

function csv(doc) {
  const t = tablaCsv(doc);
  if (!t) throw new Error('no hay una tabla para exportar a CSV');
  const q = (v) => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lineas = [t.tabla.columnas.map((c) => q(c.label)).join(';'), ...t.tabla.filas.map((f) => t.tabla.columnas.map((_, i) => q(f[i])).join(';'))];
  return new TextEncoder().encode('﻿' + lineas.join('\r\n') + '\r\n');
}

function json(doc) {
  const out = { titulo: doc.titulo, subtitulo: doc.subtitulo || null, generado: new Date().toISOString(), secciones: (doc.secciones || []).map((s) => ({
    titulo: s.titulo, metricas: s.metricas || [], parrafos: s.parrafos || [],
    filas: s.tabla ? s.tabla.filas.map((f) => Object.fromEntries(s.tabla.columnas.map((c, i) => [c.label, f[i] ?? null]))) : undefined })) };
  return new TextEncoder().encode(JSON.stringify(out, null, 2));
}

function texto(doc, md) {
  const l = [md ? `# ${doc.titulo}` : doc.titulo.toUpperCase(), doc.subtitulo || '', ''];
  for (const s of doc.secciones || []) {
    l.push(md ? `## ${s.titulo}` : s.titulo, '');
    for (const m of s.metricas || []) l.push(`${md ? '- **' : '- '}${m.label}${md ? '**' : ''}: ${celda(m.valor)}${deltaTxt(m.delta)}`);
    for (const p of s.parrafos || []) l.push(p, '');
    if (s.tabla) {
      if (md) { l.push(`| ${s.tabla.columnas.map((c) => c.label).join(' | ')} |`, `|${s.tabla.columnas.map((c) => (c.type === 'number' ? ' ---: ' : ' --- ')).join('|')}|`); for (const f of s.tabla.filas) l.push(`| ${s.tabla.columnas.map((_, i) => celda(f[i]).replace(/\|/g, '\\|')).join(' | ')} |`); }
      else { l.push(s.tabla.columnas.map((c) => c.label).join('\t')); for (const f of s.tabla.filas) l.push(s.tabla.columnas.map((_, i) => celda(f[i])).join('\t')); }
      l.push('');
    }
  }
  return new TextEncoder().encode(l.join('\n'));
}

// RTF: abre en Word, LibreOffice y WordPad. Texto no ASCII como \uN? (sin depender de la página de códigos).
function rtf(doc) {
  const e = (v) => String(v ?? '').replace(/[\\{}]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\line ')
    .replace(/[^\x20-\x7e]/g, (c) => { const n = c.charCodeAt(0); return `\\u${n > 32767 ? n - 65536 : n}?`; });
  const l = ['{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}{\\colortbl;\\red27\\green27\\blue27;\\red42\\green120\\blue214;\\red82\\green81\\blue78;}',
    '\\viewkind4\\uc1\\pard\\sa120\\f0', `{\\fs40\\b\\cf1 ${e(doc.titulo)}\\par}`];
  if (doc.subtitulo) l.push(`{\\fs22\\cf3 ${e(doc.subtitulo)}\\par}`);
  for (const s of doc.secciones || []) {
    l.push(`\\pard\\sb240\\sa120{\\fs28\\b\\cf2 ${e(s.titulo)}\\par}\\pard\\sa80\\fs21\\cf1`);
    for (const m of s.metricas || []) l.push(`${e(m.label)}: {\\b ${e(celda(m.valor) + deltaTxt(m.delta))}}\\par`);
    for (const p of s.parrafos || []) l.push(`${e(p)}\\par`);
    if (s.tabla?.columnas?.length) {
      const n = s.tabla.columnas.length, ancho = Math.floor(9000 / n);
      const fila = (celdas, cab) => `\\trowd\\trgaph80${s.tabla.columnas.map((c, i) => `${cab ? '\\clcbpat0' : ''}\\clbrdrb\\brdrs\\brdrw5\\cellx${ancho * (i + 1)}`).join('')}`
        + celdas.map((v, i) => `\\pard\\intbl${s.tabla.columnas[i].type === 'number' ? '\\qr' : ''}${cab ? '\\b' : ''} ${e(v)}${cab ? '\\b0' : ''}\\cell`).join('') + '\\row';
      l.push(fila(s.tabla.columnas.map((c) => c.label), true));
      for (const f of s.tabla.filas) l.push(fila(s.tabla.columnas.map((_, i) => celda(f[i])), false));
      l.push('\\pard\\sa80');
    }
  }
  l.push('}');
  return new TextEncoder().encode(l.join('\n'));
}

// XML: un elemento por sección; las tablas como <fila> con <c col="…"> (los nombres de columna van como atributo,
// así cualquier encabezado es válido).
const xmlEsc = (v) => String(v ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function xml(doc) {
  const l = ['<?xml version="1.0" encoding="UTF-8"?>', `<documento titulo="${xmlEsc(doc.titulo)}"${doc.subtitulo ? ` subtitulo="${xmlEsc(doc.subtitulo)}"` : ''} generado="${new Date().toISOString()}">`];
  for (const s of doc.secciones || []) {
    l.push(`  <seccion titulo="${xmlEsc(s.titulo)}">`);
    for (const m of s.metricas || []) l.push(`    <metrica nombre="${xmlEsc(m.label)}" valor="${xmlEsc(m.valor)}"${m.delta != null ? ` variacion="${xmlEsc(m.delta)}"` : ''}/>`);
    for (const p of s.parrafos || []) l.push(`    <parrafo>${xmlEsc(p)}</parrafo>`);
    if (s.tabla?.columnas?.length) {
      l.push(`    <tabla columnas="${s.tabla.columnas.length}" filas="${s.tabla.filas.length}">`);
      for (const f of s.tabla.filas) l.push(`      <fila>${s.tabla.columnas.map((c, i) => `<c col="${xmlEsc(c.label)}"${c.type ? ` tipo="${xmlEsc(c.type)}"` : ''}>${xmlEsc(f[i])}</c>`).join('')}</fila>`);
      l.push('    </tabla>');
    }
    l.push('  </seccion>');
  }
  l.push('</documento>');
  return new TextEncoder().encode(l.join('\n'));
}

// XML bien formado (sin DOMParser, para validar también en node): etiquetas balanceadas, un solo elemento raíz.
export function xmlBienFormado(t) {
  const sinDecl = t.replace(/^\uFEFF?<\?xml[^?]*\?>\s*/, '');
  const pila = []; let raices = 0;
  const re = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<([^>]*)>/g;
  let m, ultimo = 0;
  while ((m = re.exec(sinDecl))) {
    if (/[<>]/.test(sinDecl.slice(ultimo, m.index))) return false;
    ultimo = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) return false;   // etiqueta mal formada
    const [, cierre, nombre, , vacia] = m;
    if (cierre) { if (pila.pop() !== nombre) return false; }
    else if (!vacia) { if (!pila.length) raices++; pila.push(nombre); }
    else if (!pila.length) raices++;
  }
  return !pila.length && raices === 1 && !/[<>]/.test(sinDecl.slice(ultimo).trim());
}

// Imagen (PNG/JPG/WEBP) de un DocSpec: título, hasta 3 KPIs y la serie principal como barras (o las primeras filas
// de la tabla si no hay serie numérica corta). Dibuja sobre cualquier contexto 2D (Canvas u OffscreenCanvas).
export const IMG = { ancho: 1200, alto: 750 };
// Recorta un texto al ancho disponible (con "…") midiendo con el propio contexto.
function ajustar(ctx, t, ancho) {
  if (ctx.measureText(t).width <= ancho) return t;
  let s = t; while (s.length > 1 && ctx.measureText(`${s}…`).width > ancho) s = s.slice(0, -1);
  return `${s}…`;
}
export function dibujarImagen(ctx, doc, W = IMG.ancho, H = IMG.alto) {
  const C = { fondo: '#ffffff', tinta: '#1b1b1b', suave: '#52514e', linea: '#d9d8d3', barra: '#2a78d6', tile: '#f6f5f2' };
  const M = 56;
  ctx.fillStyle = C.fondo; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = C.tinta; ctx.font = '600 38px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(String(doc.titulo || '').slice(0, 60), M, M + 30);
  if (doc.subtitulo) { ctx.fillStyle = C.suave; ctx.font = '20px system-ui, sans-serif'; ctx.fillText(String(doc.subtitulo).slice(0, 100), M, M + 64); }
  let y = M + 96;
  const mets = (doc.secciones || []).flatMap((s) => s.metricas || []).slice(0, 3);
  if (mets.length) {
    const gap = 20, w = (W - 2 * M - gap * (mets.length - 1)) / mets.length;
    mets.forEach((m, i) => {
      const x = M + i * (w + gap);
      ctx.fillStyle = C.tile; ctx.fillRect(x, y, w, 104);
      ctx.fillStyle = C.suave; ctx.font = '18px system-ui, sans-serif'; ctx.fillText(String(m.label).slice(0, 40), x + 20, y + 34);
      ctx.fillStyle = C.tinta; ctx.font = '600 36px system-ui, sans-serif'; ctx.fillText(celda(m.valor), x + 20, y + 80);
      if (m.delta != null) { const t = celda(m.valor); const ancho = ctx.measureText(t).width; ctx.font = '20px system-ui, sans-serif'; ctx.fillStyle = C.suave; ctx.fillText(`${m.delta >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(m.delta * 100))}%`, x + 32 + ancho, y + 80); }
    });
    y += 136;
  }
  const serie = tablas(doc).find((s) => s.tabla.filas.length >= 1 && s.tabla.filas.length <= 24 && s.tabla.columnas.some((c) => c.type === 'number'));
  const alto = H - y - M;
  if (serie) {
    const t = serie.tabla, iv = t.columnas.findIndex((c) => c.type === 'number'), il = t.columnas.findIndex((c, i) => i !== iv);
    const vals = t.filas.map((f) => Number(f[iv]) || 0), max = Math.max(...vals.map(Math.abs), 1);
    ctx.fillStyle = C.tinta; ctx.font = '600 22px system-ui, sans-serif'; ctx.fillText(String(serie.titulo || t.columnas[iv].label), M, y + 4);
    const base = y + alto - 34, top = y + 40, n = vals.length, paso = (W - 2 * M) / n, bw = Math.min(64, paso * 0.6);
    ctx.strokeStyle = C.linea; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, base + 0.5); ctx.lineTo(W - M, base + 0.5); ctx.stroke();
    vals.forEach((v, i) => {
      const h = Math.max(2, (Math.abs(v) / max) * (base - top - 24)), x = M + i * paso + (paso - bw) / 2;
      ctx.fillStyle = C.barra;
      if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, base - h, bw, h, [Math.min(4, h), Math.min(4, h), 0, 0]); ctx.fill(); } else ctx.fillRect(x, base - h, bw, h);
      ctx.fillStyle = C.suave; ctx.font = '16px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(ajustar(ctx, String(il >= 0 ? t.filas[i][il] : i + 1), paso - 8), x + bw / 2, base + 24);
      if (n <= 12 || i === n - 1) { ctx.fillStyle = C.tinta; ctx.fillText(celda(v), x + bw / 2, base - h - 8); }
      ctx.textAlign = 'left';
    });
  } else {
    const t = tablas(doc)[0]?.tabla;
    if (t) {
      const cols = t.columnas.slice(0, 6), w = (W - 2 * M) / cols.length;
      ctx.font = '600 18px system-ui, sans-serif'; ctx.fillStyle = C.tinta;
      cols.forEach((c, i) => ctx.fillText(String(c.label).slice(0, 18), M + i * w, y + 20));
      ctx.font = '17px system-ui, sans-serif';
      t.filas.slice(0, Math.floor((alto - 40) / 30)).forEach((f, r) => cols.forEach((c, i) => { ctx.fillStyle = C.suave; ctx.fillText(celda(f[i]).slice(0, 20), M + i * w, y + 56 + r * 30); }));
    }
  }
  ctx.fillStyle = C.suave; ctx.font = '14px system-ui, sans-serif'; ctx.fillText(`Generado por SO · ${new Date().toLocaleDateString('es-AR')}`, M, H - 20);
}

async function imagen(doc, formato, lienzo) {
  if (!lienzo) throw new Error('este navegador no puede dibujar imágenes');
  const { ctx, codificar } = lienzo(IMG.ancho, IMG.alto);
  dibujarImagen(ctx, doc);
  return codificar(FORMATOS[formato].mime, formato === 'png' ? undefined : 0.9);
}

async function xlsx(doc, ExcelJS) {
  if (!ExcelJS) throw new Error('el generador de Excel no está disponible');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SO · Francisco'; wb.created = new Date();
  const res = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
  res.columns = [{ width: 34 }, { width: 20 }, { width: 14 }];
  res.addRow([doc.titulo]).font = { bold: true, size: 16 };
  if (doc.subtitulo) res.addRow([doc.subtitulo]).font = { color: { argb: 'FF52514E' } };
  res.addRow([]);
  for (const s of doc.secciones || []) {
    if (!s.metricas?.length && !s.parrafos?.length) continue;
    res.addRow([s.titulo]).font = { bold: true, size: 12, color: { argb: 'FF2A78D6' } };
    for (const m of s.metricas || []) {
      const r = res.addRow([m.label, typeof m.valor === 'number' ? m.valor : String(m.valor ?? ''), m.delta ?? null]);
      r.getCell(2).numFmt = '#,##0.##'; r.getCell(3).numFmt = '+0.0%;-0.0%'; r.getCell(2).font = { bold: true };
    }
    for (const p of s.parrafos || []) { const r = res.addRow([p]); r.getCell(1).alignment = { wrapText: true, vertical: 'top' }; res.mergeCells(r.number, 1, r.number, 3); }
    res.addRow([]);
  }
  const usados = new Set(['Resumen']);
  for (const s of tablas(doc)) {
    let nombre = String(s.titulo || 'Datos').replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Datos';
    for (let i = 2; usados.has(nombre); i++) nombre = `${nombre.slice(0, 25)} ${i}`;
    usados.add(nombre);
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = s.tabla.columnas;
    ws.columns = cols.map((c, i) => {
      const largo = Math.max(String(c.label).length, ...s.tabla.filas.slice(0, 500).map((f) => celda(f[i]).length));
      return { header: c.label, key: `c${i}`, width: Math.min(48, Math.max(10, largo + 2)) };
    });
    const cab = ws.getRow(1);
    cab.font = { bold: true }; cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F0EC' } };
    cab.border = { bottom: { style: 'thin', color: { argb: 'FFD9D8D3' } } };
    for (const f of s.tabla.filas) {
      ws.addRow(cols.map((c, i) => {
        const v = f[i];
        if (c.type === 'number') return typeof v === 'number' ? v : (v === '' || v == null ? null : Number(String(v).replace(',', '.')) || v);
        if (c.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
        return v ?? null;
      }));
    }
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.type === 'number') { col.numFmt = '#,##0.##'; col.alignment = { horizontal: 'right' }; }
      if (c.type === 'date') col.numFmt = 'dd/mm/yyyy';
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function pdf(doc, jsPDF) {
  if (!jsPDF) throw new Error('el generador de PDF no está disponible');
  const d = new jsPDF({ unit: 'pt', format: 'a4' });
  if (typeof d.autoTable !== 'function') throw new Error('falta el complemento de tablas del PDF');
  const W = d.internal.pageSize.getWidth(), H = d.internal.pageSize.getHeight(), M = 48;
  let y = M + 8;
  const espacio = (h) => { if (y + h > H - M) { d.addPage(); y = M; } };
  d.setFont('helvetica', 'bold'); d.setFontSize(20); d.setTextColor(27, 27, 27);
  for (const l of d.splitTextToSize(doc.titulo, W - 2 * M)) { d.text(l, M, y); y += 24; }
  if (doc.subtitulo) { d.setFont('helvetica', 'normal'); d.setFontSize(11); d.setTextColor(82, 81, 78); d.text(doc.subtitulo, M, y); y += 22; }
  d.setDrawColor(42, 120, 214); d.setLineWidth(2); d.line(M, y, M + 36, y); y += 20;
  for (const s of doc.secciones || []) {
    espacio(40);
    d.setFont('helvetica', 'bold'); d.setFontSize(13); d.setTextColor(42, 120, 214); d.text(String(s.titulo || ''), M, y); y += 18;
    d.setTextColor(27, 27, 27);
    for (const m of s.metricas || []) {
      espacio(18); d.setFont('helvetica', 'normal'); d.setFontSize(10); d.setTextColor(82, 81, 78); d.text(`${m.label}:`, M, y);
      d.setFont('helvetica', 'bold'); d.setFontSize(12); d.setTextColor(27, 27, 27); d.text(`${celda(m.valor)}${deltaTxt(m.delta)}`, M + 140, y); y += 18;
    }
    d.setFont('helvetica', 'normal'); d.setFontSize(10.5);
    for (const p of s.parrafos || []) for (const l of d.splitTextToSize(String(p), W - 2 * M)) { espacio(15); d.text(l, M, y); y += 15; }
    if (s.tabla?.columnas?.length) {
      y += 4;
      d.autoTable({ startY: y, margin: { left: M, right: M, bottom: M + 10 }, head: [s.tabla.columnas.map((c) => c.label)],
        body: s.tabla.filas.map((f) => s.tabla.columnas.map((_, i) => celda(f[i]))), theme: 'plain',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: [27, 27, 27], lineColor: [217, 216, 211], lineWidth: { bottom: 0.5 } },
        headStyles: { fillColor: [241, 240, 236], fontStyle: 'bold' },
        columnStyles: Object.fromEntries(s.tabla.columnas.map((c, i) => [i, c.type === 'number' ? { halign: 'right' } : {}])) });
      y = d.lastAutoTable.finalY + 18;
    }
    y += 6;
  }
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) { d.setPage(i); d.setFont('helvetica', 'normal'); d.setFontSize(8); d.setTextColor(120, 120, 115); d.text(`${doc.titulo} · página ${i} de ${n}`, M, H - 24); }
  return new Uint8Array(d.output('arraybuffer'));
}

/**
 * @param {object} doc DocSpec
 * @param {string} formato
 * @param {{ ExcelJS?: any, jsPDF?: any, lienzo?: (w: number, h: number) => { ctx: any, codificar: (mime: string, calidad?: number) => Promise<Uint8Array> } }} libs
 * @returns {Promise<{ bytes: Uint8Array, nombre: string, mime: string, kind: string, formato: string }>}
 */
export async function generar(doc, formato, libs = {}) {
  const f = FORMATOS[formato];
  if (!f) throw new Error(`todavía no genero archivos ${formato}`);
  let bytes;
  if (formato === 'xlsx') bytes = await xlsx(doc, libs.ExcelJS);
  else if (formato === 'csv') bytes = csv(doc);
  else if (formato === 'json') bytes = json(doc);
  else if (formato === 'pdf') bytes = pdf(doc, libs.jsPDF);
  else if (formato === 'docx') bytes = docx(doc);
  else if (formato === 'pptx') bytes = pptx(doc);
  else if (formato === 'rtf') bytes = rtf(doc);
  else if (formato === 'xml') bytes = xml(doc);
  else if (f.imagen) bytes = await imagen(doc, formato, libs.lienzo);
  else if (f.paquete) throw new Error('un paquete se arma con archivos, no con un documento');
  else bytes = texto(doc, formato === 'md');
  return { bytes, nombre: nombreArchivo(doc.titulo, formato), mime: f.mime, kind: f.kind, formato };
}

/**
 * Validación estructural real del archivo generado (no del pedido): existe, tiene tamaño, firma y estructura del
 * formato esperado. Devuelve { ok, detalle } con lo comprobado.
 * @param {Uint8Array} bytes
 * @param {string} formato
 * @param {{ filasEsperadas?: number|null, XLSX?: any, entradas?: number|null }} [op]
 * @returns {{ ok: boolean, detalle: string }}
 */
export function validarArchivo(bytes, formato, { filasEsperadas = null, XLSX = null, entradas = null } = {}) {
  const fallo = (m) => ({ ok: false, detalle: m });
  if (!bytes?.length) return fallo('el archivo quedó vacío');
  const dec = () => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try {
    if (['xlsx', 'docx', 'pptx'].includes(formato)) {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fallo('no tiene firma de paquete Office');
      const nombres = entradasZip(bytes).map((e) => e.nombre);
      if (!nombres.includes('[Content_Types].xml')) return fallo('falta [Content_Types].xml');
      if (formato === 'docx' && !nombres.includes('word/document.xml')) return fallo('falta el cuerpo del documento');
      if (formato === 'pptx') { const n = nombres.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length; if (!nombres.includes('ppt/presentation.xml') || !n) return fallo('la presentación no tiene diapositivas'); return { ok: true, detalle: `${n} diapositivas` }; }
      if (formato === 'xlsx') {
        if (!nombres.includes('xl/workbook.xml')) return fallo('falta el libro de cálculo');
        if (XLSX) {
          const wb = XLSX.read(bytes, { type: 'array' });
          const filas = wb.SheetNames.slice(1).reduce((s, n) => s + Math.max(0, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).length - 1), 0);
          if (filasEsperadas != null && filas !== filasEsperadas) return fallo(`se esperaban ${filasEsperadas} filas y el libro tiene ${filas}`);
          return { ok: true, detalle: `${wb.SheetNames.length} hojas · ${filas} filas` };
        }
        return { ok: true, detalle: `${nombres.filter((x) => /^xl\/worksheets\//.test(x)).length} hojas` };
      }
      return { ok: true, detalle: 'paquete Word válido' };
    }
    if (formato === 'pdf') {
      const cab = new TextDecoder('latin1').decode(bytes.subarray(0, 8)), cola = new TextDecoder('latin1').decode(bytes.subarray(-1024));
      if (!cab.startsWith('%PDF-') || !cola.includes('%%EOF')) return fallo('no es un PDF completo');
      const n = (new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page[^s]/g) || []).length;
      return n ? { ok: true, detalle: `${n} ${n === 1 ? 'página' : 'páginas'}` } : fallo('el PDF no tiene páginas');
    }
    if (formato === 'csv') {
      const t = dec().replace(/^\uFEFF/, '').trimEnd();
      const filas = t.split(/\r?\n/).length - 1;
      if (filasEsperadas != null && filas !== filasEsperadas) return fallo(`se esperaban ${filasEsperadas} filas y hay ${filas}`);
      return { ok: true, detalle: `${filas} filas · UTF-8` };
    }
    if (formato === 'json') { JSON.parse(dec()); return { ok: true, detalle: 'JSON válido' }; }
    if (formato === 'txt' || formato === 'md') return dec().trim() ? { ok: true, detalle: 'texto UTF-8' } : fallo('texto vacío');
    if (formato === 'rtf') {
      const t = new TextDecoder('latin1').decode(bytes);
      if (!t.startsWith('{\\rtf1')) return fallo('no tiene encabezado RTF');
      let nivel = 0; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '\\') { i++; continue; } if (c === '{') nivel++; else if (c === '}' && --nivel < 0) break; }
      return nivel === 0 ? { ok: true, detalle: 'RTF con grupos balanceados' } : fallo('RTF incompleto');
    }
    if (formato === 'xml') return xmlBienFormado(dec()) ? { ok: true, detalle: 'XML bien formado' } : fallo('XML mal formado');
    if (formato === 'png') {
      if (![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return fallo('no tiene firma PNG');
      const v = new DataView(bytes.buffer, bytes.byteOffset); const w = v.getUint32(16), h = v.getUint32(20);
      return w && h ? { ok: true, detalle: `PNG ${w}×${h}` } : fallo('PNG sin dimensiones');
    }
    if (formato === 'jpg') {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return fallo('no tiene firma JPEG');
      if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return fallo('JPEG incompleto');
      return { ok: true, detalle: 'JPEG completo' };
    }
    if (formato === 'webp') {
      const t = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
      if (!t.startsWith('RIFF') || t.slice(8, 12) !== 'WEBP') return fallo('no tiene firma WEBP');
      const largo = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
      return largo + 8 === bytes.length ? { ok: true, detalle: `WEBP (${t.slice(12, 16).trim()})` } : fallo('WEBP incompleto');
    }
    if (formato === 'zip') {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fallo('no tiene firma ZIP');
      const es = entradasZip(bytes);
      if (!es.length) return fallo('el paquete está vacío');
      if (entradas != null && es.length !== entradas) return fallo(`se esperaban ${entradas} archivos y el paquete tiene ${es.length}`);
      return { ok: true, detalle: `${es.length} archivos` };
    }
  } catch (e) { return fallo(`estructura inválida (${e.message})`); }
  return fallo('formato desconocido');
}

// Pedido en lenguaje natural → formato. null si no pide un archivo.
export function formatoPedido(texto) {
  const n = String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const quiere = /\b(pasame|pasalo|pasa|generame|genera|generar|exporta|exportar|exportame|exportalo|exportala|generalo|generala|descarga|descargar|bajame|armame|arma|preparame|prepara|haceme|converti|convertir|convertilo|en formato|como archivo|guardalo como|dame)\b/.test(n);
  if (!quiere) return null;
  if (/\bexcel|xlsx|planilla|hoja de calculo\b/.test(n)) return 'xlsx';
  if (/\bcsv\b/.test(n)) return 'csv';
  if (/\bjson\b/.test(n)) return 'json';
  if (/\bpdf\b/.test(n)) return 'pdf';
  if (/\bword|docx|documento editable\b/.test(n)) return 'docx';
  if (/\bpowerpoint|pptx|presentacion|diapositivas|slides\b/.test(n)) return 'pptx';
  if (/\bmarkdown|\.md\b/.test(n)) return 'md';
  if (/\b(texto plano|txt)\b/.test(n)) return 'txt';
  if (/\b(rtf|texto enriquecido)\b/.test(n)) return 'rtf';
  if (/\bxml\b/.test(n)) return 'xml';
  if (/\bwebp\b/.test(n)) return 'webp';
  if (/\b(jpe?g)\b/.test(n)) return 'jpg';
  if (/\b(png|imagen|captura|foto del (tablero|dashboard|grafico))\b/.test(n)) return 'png';
  if (/\binforme|reporte\b/.test(n)) return 'pdf';
  if (/\btabla\b/.test(n)) return 'xlsx';
  return null;
}
