// SO · perfil de datos tabulares: encabezados, tipos inferidos, nulos, duplicados, formatos, claves probables y
// filas mal formadas. Determinista y puro (sin LLM): alimenta la vista previa y el mapeo.
import { numeroAR } from '../importar.js';
import { normalizar, clave } from '../intent.js';

// Fecha de celda → ISO. Acepta Date, serial de Excel, yyyy-mm-dd, dd/mm/yyyy, dd-mm-yy y yyyy/mm/dd.
export function aFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function valida(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(y, mo - 1, d));
  return f.getUTCMonth() === mo - 1 ? f.toISOString().slice(0, 10) : null;
}

export function aNumero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  return numeroAR(v);
}

function formatoFecha(muestras) {
  for (const v of muestras) {
    const s = String(v);
    if (v instanceof Date || typeof v === 'number') return 'fecha de planilla';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'aaaa-mm-dd';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return 'dd/mm/aaaa';
    if (/^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/.test(s)) return 'dd-mm-aa';
  }
  return null;
}

// Encabezado: la primera fila (de las 10 primeras) mayormente textual seguida de filas con datos.
export function filaEncabezado(filas) {
  for (let i = 0; i < Math.min(10, filas.length - 1); i++) {
    const f = filas[i] || [];
    const llenas = f.filter((c) => c != null && String(c).trim() !== '');
    if (llenas.length < Math.max(1, Math.ceil(f.length * 0.5))) continue;
    const esTexto = (c) => typeof c === 'string' && !aFecha(c) && (aNumero(c) == null || Number.isNaN(aNumero(c)));
    const textos = llenas.filter(esTexto);
    if (textos.length >= Math.ceil(llenas.length * 0.7)) return i;
  }
  return 0;
}

/**
 * @param {any[][]} filas  filas crudas (con encabezado)
 * @returns {{ encabezado: number, columnas: object[], filas: number, duplicadas: number, malformadas: number[], clavesProbables: string[], columnaFecha: string|null, problemas: string[] }}
 */
export function perfilar(filas) {
  const h = filaEncabezado(filas);
  const cab = (filas[h] || []).map((c, i) => String(c ?? '').trim() || `Columna ${i + 1}`);
  const datos = filas.slice(h + 1).filter((f) => f && f.some((c) => c != null && String(c).trim() !== ''));
  const malformadas = [];
  datos.forEach((f, i) => { if (f.filter((c) => c != null && String(c).trim() !== '').length > cab.length) malformadas.push(h + i + 2); });
  const usadas = new Set();
  const columnas = cab.map((nombre, j) => {
    const valores = datos.map((f) => f[j]);
    const llenos = valores.filter((v) => v != null && String(v).trim() !== '');
    const muestra = llenos.slice(0, 200);
    const nums = muestra.filter((v) => { const n = aNumero(v); return n != null && !Number.isNaN(n); }).length;
    const fechas = muestra.filter((v) => aFecha(v)).length;
    const n = muestra.length || 1;
    const nombreN = normalizar(nombre);
    let tipo = 'text';
    if (fechas / n >= 0.8 && (/fecha|date|dia|periodo|period|mes|vencim/.test(nombreN) || fechas / n >= 0.95 && nums / n < 0.95 || muestra.some((v) => v instanceof Date))) tipo = 'date';
    else if (nums / n >= 0.9) tipo = 'number';
    let k = clave(nombre); while (usadas.has(k)) k += '_2'; usadas.add(k);
    const distintos = new Set(llenos.map((v) => String(v).trim().toLowerCase())).size;
    return { nombre, key: k, indice: j, tipo, nulos: valores.length - llenos.length, distintos, muestra: llenos.slice(0, 3).map((v) => (v instanceof Date ? aFecha(v) : v)),
      formato: tipo === 'date' ? formatoFecha(muestra) : tipo === 'number' ? (muestra.some((v) => typeof v === 'string' && /\d\.\d{3}(,|$)/.test(v)) ? 'es-AR (1.234,56)' : 'numérico') : null };
  });
  const firmas = datos.map((f) => JSON.stringify(f.slice(0, cab.length)));
  const duplicadas = firmas.length - new Set(firmas).size;
  const clavesProbables = columnas.filter((c) => c.nulos === 0 && datos.length > 1 && c.distintos === datos.length && c.tipo !== 'number' || c.distintos === datos.length && /(^|_)(id|codigo|cod|cuit|dni|sku|nro|numero)(_|$)/.test(c.key))
    .map((c) => c.key);
  const fechaCols = columnas.filter((c) => c.tipo === 'date');
  const columnaFecha = (fechaCols.find((c) => /fecha|date|period/.test(c.key)) || fechaCols[0])?.key || null;
  const problemas = [];
  if (duplicadas) problemas.push(`${duplicadas} filas repetidas exactamente`);
  if (malformadas.length) problemas.push(`${malformadas.length} filas con más columnas que el encabezado`);
  for (const c of columnas) if (c.nulos && c.nulos / Math.max(1, datos.length) > 0.3) problemas.push(`"${c.nombre}" está vacía en ${c.nulos} filas`);
  return { encabezado: h, columnas, filas: datos.length, datos, duplicadas, malformadas, clavesProbables, columnaFecha, problemas };
}
