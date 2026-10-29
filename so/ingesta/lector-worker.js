/* SO · lector de archivos en un Web Worker (aislado del resto de la página: sin DOM, sin cookies, sin acceso a la
   sesión). Extrae tablas y texto; nunca ejecuta macros, scripts ni código embebido (SheetJS y pdf.js solo leen datos;
   pdf.js corre sin eval y sin scripting). Devuelve datos crudos: el perfil, el mapeo y los fragmentos se calculan afuera. */
/* global XLSX, pdfjsLib */
'use strict';
const BASE = new URL('../../valo/vendor/', self.location.href).href;
let xlsxListo = false, pdfListo = false;
const cargarXLSX = () => { if (!xlsxListo) { importScripts(BASE + 'xlsx.full.min.js'); xlsxListo = true; } };
const cargarPDF = () => {
  // Ya estamos en un worker aislado: el motor de pdf.js corre acá mismo (sin DOM ni worker anidado).
  if (!pdfListo) { importScripts(BASE + 'pdf.min.js', BASE + 'pdf.worker.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js'; pdfListo = true; }
};

const MAX_FILAS = 300000, MAX_TEXTO = 20 * 1024 * 1024, MAX_DESCOMPRIMIDO = 300 * 1024 * 1024, MAX_PAGINAS = 500;

const entidades = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()] ?? (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)))));

// ---------------------------------------------------------------- CSV/TSV por partes (no carga todo el texto a la vez)
async function leerCSV(archivo, progreso) {
  const lector = archivo.stream().getReader();
  const dec = new TextDecoder('utf-8');
  let sep = null, fila = [], campo = '', comillas = false, previo = '', leidos = 0, primero = true;
  const filas = [];
  const cerrarFila = () => { fila.push(campo); campo = ''; if (fila.some((x) => x.trim() !== '')) filas.push(fila); fila = []; };
  for (;;) {
    const { value, done } = await lector.read();
    let t = done ? dec.decode() : dec.decode(value, { stream: true });
    if (value) { leidos += value.length; progreso(leidos / archivo.size); }
    if (primero) {
      t = t.replace(/^﻿/, ''); primero = false;
      const l = t.split(/\r?\n/, 1)[0];
      const cuenta = (c) => l.split(c).length - 1;
      sep = [['\t', cuenta('\t')], [';', cuenta(';')], [',', cuenta(',')], ['|', cuenta('|')]].sort((a, b) => b[1] - a[1])[0][0];
    }
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (comillas) {
        if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
      } else if (c === '"' && campo === '') comillas = true;
      else if (c === sep) { fila.push(campo); campo = ''; }
      else if (c === '\n') { cerrarFila(); if (filas.length > MAX_FILAS) throw new Error(`tiene más de ${MAX_FILAS} filas`); }
      else if (c !== '\r') campo += c;
      previo = c;
    }
    if (done) break;
  }
  if (campo !== '' || fila.length) cerrarFila();
  return { tablas: [{ nombre: archivo.name || 'datos', filas }], meta: { separador: sep === '\t' ? 'tabulación' : sep }, previo };
}

// ---------------------------------------------------------------- Planillas (xlsx/xls/ods): solo valores, nunca macros
async function leerPlanilla(archivo) {
  cargarXLSX();
  const wb = XLSX.read(new Uint8Array(await archivo.arrayBuffer()), { type: 'array', cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: true });
  const tablas = wb.SheetNames.slice(0, 50).map((nombre) => {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null, blankrows: false });
    if (filas.length > MAX_FILAS) throw new Error(`la hoja "${nombre}" tiene más de ${MAX_FILAS} filas`);
    return { nombre, filas };
  });
  const avisos = wb.vbaraw ? ['La planilla tiene macros: se leyeron solo los valores; las macros nunca se ejecutan.'] : [];
  return { tablas, meta: { hojas: wb.SheetNames.length, macros: !!wb.vbaraw }, avisos };
}

// ---------------------------------------------------------------- ZIP de Office/ODF (docx, pptx, odt, odp)
function abrirZip(buf) {
  cargarXLSX();
  const cfb = XLSX.CFB.read(new Uint8Array(buf), { type: 'array' });
  let total = 0;
  const archivos = new Map();
  cfb.FullPaths.forEach((p, i) => {
    const e = cfb.FileIndex[i];
    if (e && e.type === 2 && e.content) { total += e.content.length; archivos.set(p.replace(/^Root Entry\//, '').replace(/^\//, ''), e.content); }
  });
  if (total > MAX_DESCOMPRIMIDO) throw new Error('el contenido descomprimido es demasiado grande (posible archivo malicioso)');
  const buscar = (re) => [...archivos.keys()].filter((k) => re.test(k));
  const texto = (k) => new TextDecoder().decode(archivos.get(k));
  return { buscar, texto, tiene: (re) => buscar(re).length > 0 };
}
const sinEtiquetas = (xml) => entidades(xml.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function leerOffice(archivo, tipo) {
  const z = abrirZip(await archivo.arrayBuffer());
  const avisos = [];
  if (z.tiene(/vbaProject\.bin$/i) || z.tiene(/^Basic\//)) avisos.push('Tiene macros: se leyó solo el texto; nunca se ejecutan.');
  const bloques = [];
  let real = tipo;
  if (z.tiene(/^word\/document\.xml$/)) {
    real = 'docx';
    const xml = z.texto(z.buscar(/^word\/document\.xml$/)[0]);
    let seccion = null;
    for (const p of xml.split(/<\/w:p>/)) {
      const t = entidades((p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>/g) || []).map((x) => (x === '<w:tab/>' ? '\t' : x.replace(/<[^>]+>/g, ''))).join(''));
      if (!t.trim()) continue;
      if (/<w:pStyle w:val="(Heading|Titulo|Ttulo|Title)/i.test(p)) seccion = t.trim().slice(0, 80);
      bloques.push({ texto: t, ref: seccion ? { seccion } : {} });
    }
  } else if (z.tiene(/^ppt\/slides\/slide\d+\.xml$/)) {
    real = 'pptx';
    const slides = z.buscar(/^ppt\/slides\/slide\d+\.xml$/).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
    slides.forEach((k, i) => {
      const t = (z.texto(k).match(/<a:t>[^<]*<\/a:t>/g) || []).map((x) => entidades(x.replace(/<[^>]+>/g, ''))).join(' ');
      if (t.trim()) bloques.push({ texto: t, ref: { diapositiva: i + 1 } });
    });
  } else if (z.tiene(/^content\.xml$/)) {
    const mt = z.tiene(/^mimetype$/) ? z.texto('mimetype').trim() : '';
    const xml = z.texto('content.xml');
    if (/presentation/.test(mt)) {
      real = 'odp';
      (xml.split(/<draw:page[\s>]/).slice(1)).forEach((pag, i) => { const t = sinEtiquetas(pag.replace(/<\/text:p>/g, '\n')); if (t) bloques.push({ texto: t, ref: { diapositiva: i + 1 } }); });
    } else {
      real = 'odt';
      for (const m of xml.matchAll(/<text:(h|p)\b[^>]*>([\s\S]*?)<\/text:\1>/g)) { const t = sinEtiquetas(m[2]); if (t) bloques.push({ texto: t, ref: {} }); }
    }
  } else {
    throw new Error('no es un documento de Office u OpenDocument que pueda leer');
  }
  return { bloques, meta: { tipoReal: real, diapositivas: bloques.filter((b) => b.ref.diapositiva).length || undefined }, avisos };
}

// ---------------------------------------------------------------- PDF (texto por página)
async function leerPDF(archivo, progreso) {
  cargarPDF();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()), isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false }).promise;
  const n = Math.min(doc.numPages, MAX_PAGINAS);
  const bloques = [];
  for (let i = 1; i <= n; i++) {
    const pag = await doc.getPage(i);
    const tc = await pag.getTextContent();
    let t = ''; let y = null;
    for (const it of tc.items) { const yy = it.transform?.[5]; t += (y != null && yy != null && Math.abs(yy - y) > 2 ? '\n' : t && !t.endsWith(' ') ? ' ' : '') + it.str; y = yy; }
    if (t.trim()) bloques.push({ texto: t, ref: { pagina: i } });
    progreso(i / n);
  }
  const avisos = [];
  if (!bloques.length) avisos.push('El PDF no tiene texto seleccionable (parece escaneado). Puedo describirlo si me pasás una captura como imagen.');
  if (doc.numPages > MAX_PAGINAS) avisos.push(`Se leyeron las primeras ${MAX_PAGINAS} de ${doc.numPages} páginas.`);
  await doc.destroy();
  return { bloques, meta: { paginas: doc.numPages }, avisos };
}

// ---------------------------------------------------------------- XML (sin DTD ni entidades externas)
function leerXML(texto) {
  if (/<!DOCTYPE|<!ENTITY/i.test(texto.slice(0, 20000))) throw new Error('el XML declara DTD/entidades: por seguridad no lo proceso');
  // Elemento repetido con hijos simples → filas.
  const conteo = new Map();
  for (const m of texto.matchAll(/<([A-Za-z_][\w:.-]*)[\s>]/g)) conteo.set(m[1], (conteo.get(m[1]) || 0) + 1);
  let mejor = null;
  for (const [tag, n] of [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    if (n < 2) break;
    const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
    const filas = [];
    for (const m of texto.matchAll(re)) {
      const obj = {};
      for (const a of (m[1] || '').matchAll(/([\w:.-]+)="([^"]*)"/g)) obj[a[1]] = entidades(a[2]);
      for (const h of m[2].matchAll(/<([\w:.-]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g)) obj[h[1]] = entidades(h[2]).trim();
      if (Object.keys(obj).length) filas.push(obj);
      if (filas.length > MAX_FILAS) break;
    }
    if (filas.length >= 2 && (!mejor || filas.length * Object.keys(filas[0]).length > mejor.filas.length * Object.keys(mejor.filas[0]).length)) mejor = { tag, filas };
  }
  const bloques = [{ texto: sinEtiquetas(texto.slice(0, 200000)), ref: {} }];
  if (!mejor) return { bloques, meta: { elementos: conteo.size } };
  const cols = [...new Set(mejor.filas.slice(0, 200).flatMap((f) => Object.keys(f)))];
  return { tablas: [{ nombre: mejor.tag, filas: [cols, ...mejor.filas.map((f) => cols.map((c) => f[c] ?? null))] }], bloques, meta: { elemento: mejor.tag, elementos: conteo.size } };
}

function rtfATexto(r) {
  return r.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function leerTexto(archivo) {
  if (archivo.size > MAX_TEXTO) throw new Error('el texto es demasiado grande para leerlo completo');
  return (await archivo.text()).replace(/^﻿/, '');
}

async function leer(archivo, tipo, progreso) {
  switch (tipo) {
    case 'csv': case 'tsv': return leerCSV(archivo, progreso);
    case 'xlsx': case 'xls': case 'ods': return leerPlanilla(archivo);
    case 'docx': case 'pptx': case 'odt': case 'odp': case 'zip': return leerOffice(archivo, tipo);
    case 'pdf': return leerPDF(archivo, progreso);
    case 'json': {
      const t = await leerTexto(archivo);
      return { json: JSON.parse(t), bloques: [{ texto: t.slice(0, 200000), ref: {} }], meta: {} };
    }
    case 'xml': return leerXML(await leerTexto(archivo));
    case 'rtf': return { bloques: [{ texto: rtfATexto(await leerTexto(archivo)), ref: {} }], meta: {} };
    case 'html': case 'svg': return { bloques: [{ texto: entidades((await leerTexto(archivo)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')), ref: {} }], meta: {} };
    case 'txt': case 'md': {
      const t = await leerTexto(archivo);
      const bloques = []; let seccion = null;
      for (const parte of t.split(/\n(?=#{1,3} )/)) { const h = parte.match(/^#{1,3} (.+)/); if (h) seccion = h[1].trim().slice(0, 80); bloques.push({ texto: parte, ref: seccion ? { seccion } : {} }); }
      return { bloques, meta: { lineas: t.split('\n').length } };
    }
    default: throw new Error('no tengo un lector para este tipo de archivo');
  }
}

self.onmessage = async (e) => {
  const { id, archivo, tipo } = e.data;
  const t0 = Date.now();
  try {
    const r = await leer(archivo, tipo, (p) => self.postMessage({ id, progreso: Math.min(1, p) }));
    self.postMessage({ id, ok: true, r: { tablas: r.tablas || [], bloques: r.bloques || [], json: r.json, meta: r.meta || {}, avisos: r.avisos || [] }, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err).slice(0, 300), ms: Date.now() - t0 });
  }
};
