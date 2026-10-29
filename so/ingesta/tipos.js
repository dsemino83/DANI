// SO · identificación y política de archivos. Nunca se confía solo en la extensión ni en el MIME del navegador:
// el tipo real sale de la firma de bytes. Nada se ejecuta nunca; ejecutables y scripts no se aceptan. Puro.

export const LIMITES = { tamanoMax: 50 * 1024 * 1024, archivosPorMensaje: 10, subidasPor10Min: 40 };

// Extensiones que nunca se aceptan (aunque los bytes parezcan texto): son programas o scripts.
const EXT_BLOQUEADAS = new Set(['exe', 'dll', 'msi', 'scr', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'jse', 'wsf', 'wsh',
  'hta', 'jar', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bash', 'zsh', 'py', 'pl', 'rb', 'php', 'lnk', 'reg', 'cpl', 'msc', 'iso', 'img']);

// Tipos que sabemos interpretar (con parser real). El resto puede guardarse, pero Francisco avisa que no lo lee.
export const INTERPRETABLES = {
  pdf: 'document', docx: 'document', odt: 'document', txt: 'document', md: 'document', rtf: 'document', html: 'document',
  csv: 'table', tsv: 'table', xlsx: 'table', xls: 'table', ods: 'table', json: 'table', xml: 'table',
  pptx: 'presentation', odp: 'presentation',
  png: 'image', jpeg: 'image', gif: 'image', webp: 'image',
};

const KIND = { doc: 'document', ppt: 'presentation', heic: 'image', zip: 'other', binario: 'other', svg: 'document' };

export function extension(nombre) {
  const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

// Nombre seguro: sin rutas, sin caracteres de control, ASCII, sin ".." ni punto inicial. Mantiene la extensión.
export function sanearNombre(nombre) {
  const base = String(nombre || '').split(/[\\/]/).pop()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\.{2,}/g, '.').replace(/_{2,}/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '').trim();
  const ext = extension(base);
  let raiz = ext ? base.slice(0, -(ext.length + 1)) : base;
  raiz = raiz.replace(/[._ ]+$/, '').slice(0, 170).replace(/[._ ]+$/, '') || 'archivo';
  return ext ? `${raiz}.${ext}` : raiz;
}

const empieza = (b, firma, desde = 0) => firma.every((x, i) => b[desde + i] === x);
const ascii = (b, desde, n) => String.fromCharCode(...b.slice(desde, desde + n));

function esTexto(b) {
  if (!b.length) return true;
  let raros = 0;
  for (let i = 0; i < Math.min(b.length, 4096); i++) {
    const c = b[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) raros++;
  }
  return raros / Math.min(b.length, 4096) < 0.02;
}

function tipoDeTexto(b, ext) {
  let t = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 4096)).replace(/^﻿/, '').trimStart();
  if (t.startsWith('#!')) return { tipo: 'script', bloqueado: true, motivo: 'es un script ejecutable' };
  if (/^\{\\rtf/.test(t)) return { tipo: 'rtf' };
  if (/^[[{]/.test(t)) return { tipo: 'json' };
  if (/^<\?xml|^<[A-Za-z_][\w:.-]*[\s>]/.test(t)) {
    if (/<svg[\s>]/i.test(t.slice(0, 1000))) return { tipo: 'svg' };
    if (/^<!doctype html|^<html[\s>]/i.test(t)) return { tipo: 'html' };
    return { tipo: 'xml' };
  }
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return { tipo: 'html' };
  if (ext === 'md' || ext === 'markdown') return { tipo: 'md' };
  const lineas = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (lineas.length >= 2) {
    for (const [sep, tipo] of [['\t', 'tsv'], [';', 'csv'], [',', 'csv'], ['|', 'csv']]) {
      const n = lineas.map((l) => l.split(sep).length);
      if (n[0] > 1 && n.filter((x) => x === n[0]).length >= Math.ceil(lineas.length * 0.8)) return { tipo };
    }
  }
  if (ext === 'csv' || ext === 'tsv') return { tipo: ext };
  return { tipo: 'txt' };
}

/**
 * Identifica el tipo real por firma de bytes (los primeros KB alcanzan).
 * @param {Uint8Array} b  primeros bytes
 * @param {string} nombre nombre original
 * @param {string} mime   MIME declarado por el navegador (informativo)
 * @returns {{ tipo: string, kind: string, interpretable: boolean, bloqueado: boolean, motivo?: string, inconsistente?: boolean, avisos: string[] }}
 */
export function identificar(b, nombre = '', mime = '') {
  const ext = extension(nombre);
  const avisos = [];
  let r;
  if (empieza(b, [0x4d, 0x5a])) r = { tipo: 'ejecutable', bloqueado: true, motivo: 'es un programa de Windows' };
  else if (empieza(b, [0x7f, 0x45, 0x4c, 0x46])) r = { tipo: 'ejecutable', bloqueado: true, motivo: 'es un programa (ELF)' };
  else if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((f) => empieza(b, f)))
    r = { tipo: 'ejecutable', bloqueado: true, motivo: 'es un programa (Mach-O/Java)' };
  else if (empieza(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) r = { tipo: 'pdf' };
  else if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) r = { tipo: 'png' };
  else if (empieza(b, [0xff, 0xd8, 0xff])) r = { tipo: 'jpeg' };
  else if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') r = { tipo: 'gif' };
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') r = { tipo: 'webp' };
  else if (ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(b, 8, 4))) r = { tipo: ascii(b, 8, 4) === 'avif' ? 'avif' : 'heic' };
  else if (empieza(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) r = { tipo: ext === 'xls' ? 'xls' : ext === 'ppt' ? 'ppt' : ext === 'doc' ? 'doc' : 'ole' };
  else if (empieza(b, [0x50, 0x4b, 0x03, 0x04]) || empieza(b, [0x50, 0x4b, 0x05, 0x06])) {
    // ZIP: el contenido real (docx/xlsx/pptx/odt/ods/odp) se confirma al abrirlo; la extensión solo orienta.
    r = { tipo: ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'docm', 'xlsm', 'pptm'].includes(ext) ? ext.replace(/m$/, 'x') : 'zip', zip: true };
    if (/m$/.test(ext) && ['docm', 'xlsm', 'pptm'].includes(ext)) avisos.push('Tiene macros habilitadas: nunca se ejecutan, solo se leen los datos.');
  } else if (empieza(b, [0x1f, 0x8b])) r = { tipo: 'gzip' };
  else if (esTexto(b)) r = tipoDeTexto(b, ext);
  else r = { tipo: 'binario' };

  if (!r.bloqueado && EXT_BLOQUEADAS.has(ext)) r = { tipo: r.tipo, bloqueado: true, motivo: `los archivos .${ext} son programas o scripts` };
  const kind = INTERPRETABLES[r.tipo] || KIND[r.tipo] || (r.tipo === 'avif' ? 'image' : 'other');
  // Extensión que contradice el contenido (MIME spoofing): se usa el tipo real y se avisa.
  const extEsperada = { jpeg: ['jpg', 'jpeg', 'jfif'], md: ['md', 'markdown', 'txt'], txt: ['txt', 'log', 'text', ''], tsv: ['tsv', 'txt', 'csv'], csv: ['csv', 'txt', 'tsv'] }[r.tipo] || [r.tipo];
  const inconsistente = !!ext && !r.zip && !extEsperada.includes(ext) && !(r.tipo === 'ole' || r.tipo === 'xml' && ['xml', 'svg', 'rss', 'kml', 'gpx'].includes(ext));
  if (inconsistente && !r.bloqueado) avisos.push(`El nombre dice .${ext} pero el contenido es ${r.tipo.toUpperCase()}: lo traté como ${r.tipo.toUpperCase()}.`);
  if (r.tipo === 'heic') avisos.push('Las fotos HEIC se guardan, pero este navegador no puede mostrarlas ni analizarlas; convertila a JPG si necesitás que la lea.');
  if (r.tipo === 'svg' || r.tipo === 'html') avisos.push('Se lee solo como texto: nunca se muestra ni se ejecuta su contenido.');
  return { tipo: r.tipo, kind, interpretable: !!INTERPRETABLES[r.tipo] || r.tipo === 'svg', bloqueado: !!r.bloqueado, motivo: r.motivo, inconsistente, avisos, mimeDeclarado: mime || null };
}

// Política previa a guardar: tamaño, cantidad, bloqueos. Devuelve el motivo en lenguaje claro si no se acepta.
export function validar(info, size) {
  if (info.bloqueado) return `No acepto este archivo porque ${info.motivo}. Por seguridad nunca se suben ni se ejecutan programas o scripts.`;
  if (size > LIMITES.tamanoMax) return `Es demasiado grande (${(size / 1048576).toFixed(1)} MB). El máximo es ${LIMITES.tamanoMax / 1048576} MB.`;
  if (size === 0) return 'Está vacío.';
  return null;
}

// Detecta credenciales pegadas en el chat (no deben viajar ni quedar guardadas en la conversación).
export function pareceSecreto(texto) {
  const t = String(texto || '');
  return /\b(bearer|token|api[_ -]?key|apikey|clave|secret|password|contrase[nñ]a)\b\s*[:=]?\s*["']?[A-Za-z0-9._~+/=-]{16,}/i.test(t)
    || /\b(sk|pk|rk|ghp|gho|xox[abp]|AKIA)[-_][A-Za-z0-9_-]{12,}/.test(t)
    || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t);
}
