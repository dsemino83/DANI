// SO · comprensión de documentos sin mandar el archivo entero al modelo: bloques con referencia (página, hoja,
// diapositiva, sección) → fragmentos → índice → recuperación de lo relevante. Puro.
import { normalizar } from '../intent.js';

const VACIAS = new Set('el la los las un una unos unas de del al a en y o u que por para con sin sobre entre es son fue ser se su sus lo le les como mas pero si no ya este esta estos estas ese esa eso the of and to in for on is are was with this that it as by from at an be or'.split(' '));

export function terminos(t) {
  return normalizar(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !VACIAS.has(w));
}

// Fragmentos de hasta `max` caracteres, sin cortar palabras, conservando la referencia de origen.
export function fragmentar(bloques, max = 1500) {
  const out = [];
  for (const b of bloques) {
    const texto = String(b.texto || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!texto) continue;
    let resto = texto;
    while (resto.length) {
      let corte = resto.length <= max ? resto.length : Math.max(resto.lastIndexOf('\n', max), resto.lastIndexOf('. ', max) + 1, resto.lastIndexOf(' ', max));
      if (corte <= max * 0.4) corte = max;
      out.push({ ord: out.length, ref: b.ref || {}, content: resto.slice(0, corte).trim() });
      resto = resto.slice(corte).trim();
    }
  }
  return out.filter((c) => c.content);
}

// BM25 simplificado (para uso local y como respaldo del índice del servidor).
export function recuperar(fragmentos, pregunta, k = 4) {
  const q = [...new Set(terminos(pregunta))];
  if (!q.length) return fragmentos.slice(0, k).map((f) => ({ ...f, score: 0 }));
  const docs = fragmentos.map((f) => terminos(f.content));
  const N = docs.length || 1, prom = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = Object.fromEntries(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  return fragmentos.map((f, i) => {
    const d = docs[i]; let s = 0;
    for (const t of q) {
      const tf = d.filter((w) => w === t || (t.length > 5 && w.startsWith(t.slice(0, -1)))).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      s += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.length / prom));
    }
    return { ...f, score: s };
  }).filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

export function refTexto(ref = {}) {
  if (ref.pagina) return `página ${ref.pagina}`;
  if (ref.diapositiva) return `diapositiva ${ref.diapositiva}`;
  if (ref.hoja) return `hoja "${ref.hoja}"`;
  if (ref.seccion) return `sección "${ref.seccion}"`;
  return '';
}

// Resumen extractivo breve: primeras oraciones informativas + términos más frecuentes.
export function resumir(fragmentos, max = 3) {
  const texto = fragmentos.map((f) => f.content).join('\n');
  const oraciones = texto.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 40 && /[a-záéíóúñ]/i.test(s));
  const freq = new Map();
  for (const t of terminos(texto)) freq.set(t, (freq.get(t) || 0) + 1);
  const temas = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  return { oraciones: oraciones.slice(0, max), temas, caracteres: texto.length };
}
