// SO · GeneratedFileService (parte pura): DocSpec → archivo real (XLSX, CSV, JSON, PDF, DOCX, PPTX, TXT, MD) y su
// validación estructural antes de informar nada. Las librerías pesadas (ExcelJS, jsPDF) se inyectan con `libs`
// (en el navegador se cargan bajo demanda desde valo/vendor; en los tests, desde node).
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
};
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const celda = (v) => (typeof v === 'number' ? fmt.format(v) : String(v ?? ''));
const deltaTxt = (d) => (d == null ? '' : ` (${d >= 0 ? '+' : '-'}${fmt.format(Math.abs(d * 100))}%)`);

export function nombreArchivo(titulo, formato) {
  const base = String(titulo || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'archivo';
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
 * @param {{ ExcelJS?: any, jsPDF?: any }} libs
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
  else bytes = texto(doc, formato === 'md');
  return { bytes, nombre: nombreArchivo(doc.titulo, formato), mime: f.mime, kind: f.kind, formato };
}

/**
 * Validación estructural real del archivo generado (no del pedido): existe, tiene tamaño, firma y estructura del
 * formato esperado. Devuelve { ok, detalle } con lo comprobado.
 */
export function validarArchivo(bytes, formato, { filasEsperadas = null, XLSX = null } = {}) {
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
      const t = dec().replace(/^﻿/, '').trimEnd();
      const filas = t.split(/\r?\n/).length - 1;
      if (filasEsperadas != null && filas !== filasEsperadas) return fallo(`se esperaban ${filasEsperadas} filas y hay ${filas}`);
      return { ok: true, detalle: `${filas} filas · UTF-8` };
    }
    if (formato === 'json') { JSON.parse(dec()); return { ok: true, detalle: 'JSON válido' }; }
    if (formato === 'txt' || formato === 'md') return dec().trim() ? { ok: true, detalle: 'texto UTF-8' } : fallo('texto vacío');
  } catch (e) { return fallo(`estructura inválida (${e.message})`); }
  return fallo('formato desconocido');
}

// Pedido en lenguaje natural → formato. null si no pide un archivo.
export function formatoPedido(texto) {
  const n = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const quiere = /\b(pasame|pasalo|pasa|generame|genera|generar|exporta|exportar|exportame|descarga|descargar|bajame|armame|arma|preparame|prepara|haceme|converti|convertir|convertilo|en formato|como archivo|guardalo como|dame)\b/.test(n);
  if (!quiere) return null;
  if (/\bexcel|xlsx|planilla|hoja de calculo\b/.test(n)) return 'xlsx';
  if (/\bcsv\b/.test(n)) return 'csv';
  if (/\bjson\b/.test(n)) return 'json';
  if (/\bpdf\b/.test(n)) return 'pdf';
  if (/\bword|docx|documento editable\b/.test(n)) return 'docx';
  if (/\bpowerpoint|pptx|presentacion|diapositivas|slides\b/.test(n)) return 'pptx';
  if (/\bmarkdown|\.md\b/.test(n)) return 'md';
  if (/\b(texto plano|txt)\b/.test(n)) return 'txt';
  if (/\binforme|reporte\b/.test(n)) return 'pdf';
  if (/\btabla\b/.test(n)) return 'xlsx';
  return null;
}
