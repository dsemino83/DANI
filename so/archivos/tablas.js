// SO · operaciones deterministas sobre tablas de archivos: comparación (qué cambió), edición conversacional
// (EditSpec → nueva versión, nunca sobre el original) y consolidación de varios archivos compatibles.
// Tabla = { columnas: [{ key, label, type }], filas: any[][] }. Puro: se prueba en node.
import { normalizar } from '../intent.js';

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const SINONIMOS = [
  ['monto', 'importe', 'total', 'venta', 'ventas', 'facturacion', 'ingreso', 'ingresos'],
  ['costo', 'costos', 'coste', 'costo total'],
  ['fecha', 'dia', 'periodo'],
  ['canal', 'medio'],
  ['cliente', 'razon social', 'comprador'],
  ['cantidad', 'unidades', 'cant'],
];
const canon = (s) => { const n = normalizar(s).replace(/[^a-z0-9 ]/g, '').trim(); const g = SINONIMOS.find((x) => x.includes(n)); return g ? g[0] : n; };
const vacio = (v) => v == null || v === '';

// Clave para comparar filas: una columna con valores únicos y no vacíos en ambas tablas (id, código, cliente…).
export function claveComparacion(A, B) {
  const prefer = /\b(id|codigo|cod|sku|numero|nro|cliente|cuit|dni|producto|nombre)\b/;
  const comunes = A.columnas.filter((c) => B.columnas.some((d) => canon(d.label) === canon(c.label)));
  const unicas = comunes.filter((c) => {
    const i = A.columnas.indexOf(c), j = B.columnas.findIndex((d) => canon(d.label) === canon(c.label));
    const va = A.filas.map((f) => f[i]), vb = B.filas.map((f) => f[j]);
    return va.length && vb.length && !va.some(vacio) && !vb.some(vacio) && new Set(va.map(String)).size === va.length && new Set(vb.map(String)).size === vb.length;
  });
  return unicas.sort((x, y) => (prefer.test(normalizar(y.label)) ? 1 : 0) - (prefer.test(normalizar(x.label)) ? 1 : 0))[0] || null;
}

/**
 * Compara dos tablas: columnas agregadas/quitadas, filas agregadas/quitadas/cambiadas y totales numéricos.
 * Sin clave confiable compara filas completas (multiconjunto) y lo dice.
 */
export function compararTablas(A, B, { max = 200 } = {}) {
  const lb = (t) => t.columnas.map((c) => canon(c.label));
  const colsA = lb(A), colsB = lb(B);
  const colAgregadas = B.columnas.filter((c, i) => !colsA.includes(colsB[i])).map((c) => c.label);
  const colQuitadas = A.columnas.filter((c, i) => !colsB.includes(colsA[i])).map((c) => c.label);
  const comunes = A.columnas.map((c, i) => ({ c, i, j: colsB.indexOf(colsA[i]) })).filter((x) => x.j >= 0);
  const clave = claveComparacion(A, B);
  const cambios = [];
  let agregadas = 0, quitadas = 0, cambiadas = 0;
  const v = (x) => (typeof x === 'number' ? fmt.format(x) : String(x ?? ''));
  if (clave) {
    const ia = A.columnas.indexOf(clave), ib = B.columnas.findIndex((d) => canon(d.label) === canon(clave.label));
    const mA = new Map(A.filas.map((f) => [String(f[ia]), f])), mB = new Map(B.filas.map((f) => [String(f[ib]), f]));
    for (const [k, fb] of mB) {
      const fa = mA.get(k);
      if (!fa) { agregadas++; if (cambios.length < max) cambios.push({ tipo: 'agregada', clave: k }); continue; }
      let dif = false;
      for (const { c, i, j } of comunes) {
        if (String(fa[i] ?? '') !== String(fb[j] ?? '')) { dif = true; if (cambios.length < max) cambios.push({ tipo: 'cambiada', clave: k, campo: c.label, antes: v(fa[i]), despues: v(fb[j]) }); }
      }
      if (dif) cambiadas++;
    }
    for (const k of mA.keys()) if (!mB.has(k)) { quitadas++; if (cambios.length < max) cambios.push({ tipo: 'quitada', clave: k }); }
  } else {
    const firma = (f, idx) => JSON.stringify(idx.map((i) => String(f[i] ?? '')));
    const cuenta = new Map();
    for (const f of A.filas) { const s = firma(f, comunes.map((x) => x.i)); cuenta.set(s, (cuenta.get(s) || 0) + 1); }
    for (const f of B.filas) {
      const s = firma(f, comunes.map((x) => x.j));
      if (cuenta.get(s)) cuenta.set(s, cuenta.get(s) - 1);
      else { agregadas++; if (cambios.length < max) cambios.push({ tipo: 'agregada', clave: JSON.parse(s).slice(0, 3).join(' · ') }); }
    }
    for (const [s, n] of cuenta) for (let k = 0; k < n; k++) { quitadas++; if (cambios.length < max) cambios.push({ tipo: 'quitada', clave: JSON.parse(s).slice(0, 3).join(' · ') }); }
  }
  const totales = comunes.filter(({ c }) => c.type === 'number').map(({ c, i, j }) => {
    const a = A.filas.reduce((s, f) => s + (Number(f[i]) || 0), 0), b = B.filas.reduce((s, f) => s + (Number(f[j]) || 0), 0);
    return { columna: c.label, antes: a, despues: b, delta: b - a, variacion: a ? (b - a) / Math.abs(a) : null };
  });
  const principal = totales.filter((t) => t.delta !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0];
  const partes = [`${agregadas} filas agregadas`, `${quitadas} quitadas`, `${cambiadas} con cambios`];
  if (colAgregadas.length) partes.push(`columnas nuevas: ${colAgregadas.join(', ')}`);
  if (colQuitadas.length) partes.push(`columnas quitadas: ${colQuitadas.join(', ')}`);
  return {
    clave: clave?.label || null, agregadas, quitadas, cambiadas, colAgregadas, colQuitadas, totales, cambios,
    resumen: `${partes.join(' · ')}${clave ? ` (comparando por ${clave.label})` : ' (sin columna clave: comparé filas completas)'}.`,
    impacto: principal ? `${principal.columna}: ${fmt.format(principal.antes)} → ${fmt.format(principal.despues)} (${principal.delta >= 0 ? '+' : '−'}${fmt.format(Math.abs(principal.delta))}${principal.variacion != null ? `, ${principal.variacion >= 0 ? '+' : '−'}${fmt.format(Math.abs(principal.variacion * 100))}%` : ''}).` : 'Los totales numéricos no cambiaron.',
    sinCambios: !agregadas && !quitadas && !cambiadas && !colAgregadas.length && !colQuitadas.length,
  };
}

// Comparación de documentos de texto por párrafos (secciones agregadas/quitadas).
export function compararTextos(a, b, { max = 40 } = {}) {
  const ps = (t) => String(t || '').split(/\n\s*\n|\r?\n/).map((x) => x.trim()).filter(Boolean);
  const A = ps(a), B = ps(b), sa = new Set(A), sb = new Set(B);
  const agregados = B.filter((p) => !sa.has(p)), quitados = A.filter((p) => !sb.has(p));
  return { agregados: agregados.slice(0, max), quitados: quitados.slice(0, max), resumen: `${agregados.length} párrafos nuevos y ${quitados.length} quitados.`, sinCambios: !agregados.length && !quitados.length };
}

/**
 * Pedido conversacional → EditSpec. Solo operaciones deterministas y verificables; lo ambiguo devuelve { pregunta }.
 */
export function interpretarEdicion(texto, tabla) {
  const n = normalizar(texto);
  const col = (patron) => tabla.columnas.find((c) => patron.test(canon(c.label)) || patron.test(normalizar(c.label)));
  if (/\b(saca|quita|elimina|borra)\w*\s+(los\s+|las\s+)?(duplicad|repetid)/.test(n)) return { op: 'dedupe', resumen: 'quité filas duplicadas' };
  if (/\b(agrega|agregale|suma|sumale|calcula|anadi)\w*\s+(el\s+|la\s+|una\s+columna\s+(de\s+)?)?margen\b/.test(n)) {
    const v = col(/^monto$/), c = col(/^costo$/);
    if (!v || !c) return { pregunta: `Para calcular el margen necesito una columna de venta y otra de costo. Columnas del archivo: ${tabla.columnas.map((x) => x.label).join(', ')}.` };
    return { op: 'margen', venta: v.label, costo: c.label, resumen: `agregué Margen = ${v.label} − ${c.label} y Margen %` };
  }
  const ord = n.match(/\bordena\w*\s+por\s+([a-z0-9 ]+?)(\s+(de mayor a menor|descendente|de menor a mayor|ascendente))?$/);
  if (ord) { const c = tabla.columnas.find((x) => normalizar(x.label) === ord[1].trim() || canon(x.label) === canon(ord[1].trim())); if (c) return { op: 'ordenar', columna: c.label, desc: /mayor a menor|descend/.test(ord[2] || ''), resumen: `ordené por ${c.label}` }; }
  const fil = n.match(/\b(deja|dejame|queda\w*|filtra)\s+(solo\s+)?(las filas\s+)?(?:de|con|donde)?\s*([a-z0-9 ]+?)\s*(=|es|igual a)?\s*"?([a-z0-9 ]+)"?$/);
  if (fil) { const c = tabla.columnas.find((x) => normalizar(x.label) === fil[4].trim()); if (c) return { op: 'filtrar', columna: c.label, valor: fil[6].trim(), resumen: `dejé solo ${c.label} = ${fil[6].trim()}` }; }
  const qc = n.match(/\b(saca|quita|elimina|borra)\w*\s+(la\s+)?columna\s+([a-z0-9 ]+)$/);
  if (qc) { const c = tabla.columnas.find((x) => normalizar(x.label) === qc[3].trim()); if (c) return { op: 'quitar_columna', columna: c.label, resumen: `quité la columna ${c.label}` }; }
  return null;
}

/** Aplica un EditSpec y devuelve una tabla NUEVA (el original no se toca). */
export function aplicarEdicion(tabla, spec) {
  const cols = tabla.columnas.map((c) => ({ ...c }));
  let filas = tabla.filas.map((f) => [...f]);
  const idx = (label) => cols.findIndex((c) => c.label === label);
  switch (spec.op) {
    case 'dedupe': { const vistos = new Set(); filas = filas.filter((f) => { const k = JSON.stringify(f); if (vistos.has(k)) return false; vistos.add(k); return true; }); break; }
    case 'margen': {
      const iv = idx(spec.venta), ic = idx(spec.costo);
      cols.push({ key: 'margen', label: 'Margen', type: 'number' }, { key: 'margen_pct', label: 'Margen %', type: 'number' });
      filas = filas.map((f) => { const v = Number(f[iv]), c = Number(f[ic]); const m = Number.isFinite(v) && Number.isFinite(c) ? Math.round((v - c) * 100) / 100 : null; return [...f, m, m != null && v ? Math.round((m / v) * 10000) / 100 : null]; });
      break;
    }
    case 'ordenar': { const i = idx(spec.columna); filas.sort((a, b) => (typeof a[i] === 'number' && typeof b[i] === 'number' ? a[i] - b[i] : String(a[i] ?? '').localeCompare(String(b[i] ?? ''), 'es')) * (spec.desc ? -1 : 1)); break; }
    case 'filtrar': { const i = idx(spec.columna); filas = filas.filter((f) => normalizar(String(f[i] ?? '')) === normalizar(spec.valor)); break; }
    case 'quitar_columna': { const i = idx(spec.columna); cols.splice(i, 1); filas = filas.map((f) => f.filter((_, j) => j !== i)); break; }
    default: throw new Error('edición no soportada');
  }
  return { columnas: cols, filas, antes: tabla.filas.length, despues: filas.length };
}

/**
 * Consolida varias tablas compatibles (mismas columnas salvo nombres triviales) en una, con la columna "Archivo"
 * de origen. Si las columnas difieren materialmente, devuelve { pregunta } en vez de mezclar a ciegas.
 */
export function consolidar(lista) {
  if (lista.length < 2) return { pregunta: 'Para consolidar necesito al menos dos archivos con tablas.' };
  const base = lista[0].tabla.columnas;
  const mapas = [];
  for (const { nombre, tabla } of lista) {
    const m = base.map((c) => tabla.columnas.findIndex((d) => canon(d.label) === canon(c.label)));
    const faltan = base.filter((_, i) => m[i] < 0).map((c) => c.label);
    const sobran = tabla.columnas.filter((d) => !base.some((c) => canon(c.label) === canon(d.label))).map((d) => d.label);
    if (faltan.length > Math.floor(base.length / 2) || sobran.length > Math.floor(base.length / 2)) {
      return { pregunta: `"${nombre}" no tiene las mismas columnas que "${lista[0].nombre}" (${faltan.length ? `le faltan ${faltan.join(', ')}` : ''}${faltan.length && sobran.length ? '; ' : ''}${sobran.length ? `tiene además ${sobran.join(', ')}` : ''}). ¿Las consolido igual, dejando vacías las columnas que no coinciden?` };
    }
    mapas.push({ nombre, tabla, m, faltan });
  }
  const columnas = [...base.map((c) => ({ ...c })), { key: 'archivo', label: 'Archivo', type: 'text' }];
  const filas = [];
  for (const { nombre, tabla, m } of mapas) for (const f of tabla.filas) filas.push([...m.map((j) => (j >= 0 ? f[j] : null)), nombre]);
  return { tabla: { columnas, filas }, porArchivo: mapas.map((x) => ({ nombre: x.nombre, filas: x.tabla.filas.length, faltan: x.faltan })) };
}
