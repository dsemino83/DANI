// SO · ZIP mínimo (método "store", sin compresión) para empaquetar OOXML (DOCX/PPTX). CRC32 estándar.
// Sin dependencias; funciona en el navegador y en node.
const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {{ nombre: string, datos: string|Uint8Array }[]} entradas @returns {Uint8Array} */
export function zip(entradas) {
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0;
  const fecha = ((2026 - 1980) << 9) | (10 << 5) | 29, hora = (12 << 11);
  for (const e of entradas) {
    const nombre = enc.encode(e.nombre);
    const datos = typeof e.datos === 'string' ? enc.encode(e.datos) : e.datos;
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, hora, true); local.setUint16(12, fecha, true); local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true); local.setUint32(22, datos.length, true); local.setUint16(26, nombre.length, true); local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, datos);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, hora, true); c.setUint16(14, fecha, true); c.setUint32(16, crc, true); c.setUint32(20, datos.length, true); c.setUint32(24, datos.length, true);
    c.setUint16(28, nombre.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nombre);
    offset += 30 + nombre.length + datos.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, entradas.length, true); fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let i = 0; for (const p of todo) { out.set(p, i); i += p.length; }
  return out;
}

/** Lista las entradas de un ZIP (store o deflate) leyendo el directorio central. Para validar paquetes OOXML. */
export function entradasZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no es un ZIP válido');
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true);
  const dec = new TextDecoder(); const out = [];
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('directorio ZIP dañado');
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true), largo = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), com = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nombre = dec.decode(bytes.subarray(p + 46, p + 46 + largo));
    const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    out.push({ nombre, metodo, tam, datos: metodo === 0 ? bytes.subarray(ini, ini + tam) : null });
    p += 46 + largo + extra + com;
  }
  return out;
}
