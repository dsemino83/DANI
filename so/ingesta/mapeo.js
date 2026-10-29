// SO · DataMappingEngine: relaciona columnas de un archivo/API con los campos de un dataset, infiere la estrategia
// de importación según la intención y valida filas. Si el mapeo es inequívoco se ejecuta; si hay ambigüedad material,
// devuelve solo la decisión que falta. Nunca mapea en silencio datos ambiguos. Puro.
import { normalizar } from '../intent.js';
import { aFecha, aNumero } from './perfil.js';

// Sinónimos por concepto (español/inglés). La clave canónica no se muestra al usuario.
const CONCEPTOS = {
  fecha: ['fecha', 'date', 'transaction date', 'transaction_date', 'fecha operacion', 'fecha de venta', 'dia', 'day', 'periodo', 'period', 'created at', 'fecha alta'],
  cliente: ['cliente', 'customer', 'client', 'razon social', 'comprador', 'customer name', 'nombre cliente'],
  monto: ['monto', 'importe', 'amount', 'total', 'valor', 'value', 'precio total', 'facturacion', 'revenue', 'ventas', 'sales', 'subtotal'],
  cantidad: ['cantidad', 'unidades', 'qty', 'quantity', 'units', 'cant'],
  canal: ['canal', 'channel', 'medio', 'origen venta'],
  producto: ['producto', 'product', 'sku', 'articulo', 'item', 'descripcion producto'],
  categoria: ['categoria', 'category', 'rubro', 'tipo', 'familia'],
  vendedor: ['vendedor', 'seller', 'salesperson', 'agente', 'ejecutivo', 'comercial'],
  region: ['region', 'zona', 'provincia', 'state', 'area', 'sucursal', 'ciudad', 'city'],
  moneda: ['moneda', 'currency', 'divisa'],
  precio: ['precio', 'price', 'precio unitario', 'unit price', 'cotizacion', 'rate', 'valor unitario'],
};
const CANON = new Map();
for (const [c, lista] of Object.entries(CONCEPTOS)) for (const s of lista) CANON.set(normalizar(s).replace(/[_-]+/g, ' '), c);
const concepto = (t) => {
  const n = normalizar(t).replace(/[_-]+/g, ' ').trim();
  if (CANON.has(n)) return CANON.get(n);
  for (const [s, c] of CANON) if (n.split(' ').includes(s) || (s.length > 4 && n.includes(s))) return c;
  return null;
};

const compatibles = (colTipo, campoTipo) => colTipo === campoTipo || campoTipo === 'text' || (campoTipo === 'date' && colTipo === 'date');

/**
 * @param {{ nombre: string, key: string, tipo: string }[]} columnas  del perfil del archivo
 * @param {{ key: string, label?: string, type: string }[]} campos     del dataset destino
 */
export function mapear(columnas, campos) {
  const asignaciones = []; const usadas = new Set(); const ambiguedades = [];
  for (const campo of campos) {
    const cands = columnas.map((col) => {
      let conf = 0; let motivo = '';
      if (normalizar(col.nombre) === normalizar(campo.label || '') || col.key === campo.key) { conf = 1; motivo = 'mismo nombre'; }
      else if (concepto(col.nombre) && concepto(col.nombre) === concepto(campo.label || campo.key)) { conf = 0.85; motivo = `"${col.nombre}" equivale a "${campo.label || campo.key}"`; }
      if (conf && !compatibles(col.tipo, campo.type)) { conf *= 0.3; motivo += ' (tipo distinto)'; }
      return { col, conf, motivo };
    }).filter((c) => c.conf >= 0.5).sort((a, b) => b.conf - a.conf);
    if (!cands.length) continue;
    if (cands.length > 1 && cands[0].conf === cands[1].conf) {
      ambiguedades.push({ campo: campo.key, etiqueta: campo.label || campo.key, candidatas: cands.map((c) => c.col.nombre) });
      continue;
    }
    if (usadas.has(cands[0].col.key)) continue;
    usadas.add(cands[0].col.key);
    asignaciones.push({ columna: cands[0].col.nombre, columnaKey: cands[0].col.key, campo: campo.key, confianza: cands[0].conf, motivo: cands[0].motivo });
  }
  const nuevas = columnas.filter((c) => !usadas.has(c.key) && !ambiguedades.some((a) => a.candidatas.includes(c.nombre)));
  const faltantes = campos.filter((f) => !asignaciones.some((a) => a.campo === f.key) && !ambiguedades.some((a) => a.campo === f.key));
  const numericosSinMapear = faltantes.filter((f) => f.type === 'number' && nuevas.some((c) => c.tipo === 'number'));
  const inequivoco = !ambiguedades.length && asignaciones.length > 0 && !numericosSinMapear.length && asignaciones.every((a) => a.confianza >= 0.85);
  return { asignaciones, nuevas, faltantes, ambiguedades, inequivoco,
    pregunta: ambiguedades.length ? `¿Qué columna uso para "${ambiguedades[0].etiqueta}": ${ambiguedades[0].candidatas.map((c) => `"${c}"`).join(' o ')}?`
      : numericosSinMapear.length ? `¿Qué columna corresponde a "${numericosSinMapear[0].label || numericosSinMapear[0].key}": ${nuevas.filter((c) => c.tipo === 'number').map((c) => `"${c.nombre}"`).join(' o ')}?` : null };
}

// Estrategia según intención. REPLACE solo con pedido explícito; ante duda, APPEND (no destructivo).
export function inferirEstrategia(texto, { claves = [] } = {}) {
  const n = normalizar(texto);
  if (/\b(reemplaza\w*|sustitu\w*|pisa\w*|reemplazar|en lugar de lo anterior|borra lo anterior)\b/.test(n)) return { estrategia: 'REPLACE', motivo: 'pediste reemplazar los datos', explicita: true };
  if (/\b(proba\w*|probar|temporal\w*|solo para ver|de prueba)\b/.test(n)) return { estrategia: 'TEMPORARY', motivo: 'es una carga de prueba (se retira en 24 h)' };
  if (/\b(actualiza\w*|corregi\w*|corregir|modifica\w*)\b/.test(n) && claves.length) return { estrategia: 'UPSERT', clave: claves[0], motivo: `actualizo por "${claves[0]}" sin duplicar` };
  return { estrategia: 'APPEND', motivo: 'se suman al histórico' };
}

/**
 * Convierte filas del archivo en registros válidos para el dataset. Las inválidas quedan en revisión con su motivo.
 * @returns {{ validas: { fila: number, period: string, data: object }[], rechazadas: { fila: number, motivo: string }[] }}
 */
export function convertir(perfil, asignaciones, campos, { columnaFecha = perfil.columnaFecha, hoy = new Date().toISOString().slice(0, 10), base = 2 } = {}) {
  const tipoCampo = Object.fromEntries(campos.map((f) => [f.key, f]));
  const idxFecha = columnaFecha ? perfil.columnas.find((c) => c.key === columnaFecha)?.indice : null;
  const validas = [], rechazadas = [];
  perfil.datos.forEach((fila, i) => {
    const nro = perfil.encabezado + i + base;
    const data = {}; let error = null;
    for (const a of asignaciones) {
      const col = perfil.columnas.find((c) => c.key === a.columnaKey);
      const crudo = fila[col.indice];
      if (crudo == null || String(crudo).trim() === '') continue;
      const f = tipoCampo[a.campo];
      if (f.type === 'number') {
        const v = aNumero(crudo);
        if (v == null || Number.isNaN(v)) { error = `${f.label || f.key} no es un número ("${String(crudo).slice(0, 30)}")`; break; }
        data[f.key] = v;
      } else if (f.type === 'date') {
        const d = aFecha(crudo);
        if (!d) { error = `${f.label || f.key}: fecha inválida ("${String(crudo).slice(0, 30)}")`; break; }
        data[f.key] = d;
      } else data[f.key] = String(crudo instanceof Date ? aFecha(crudo) : crudo).trim().slice(0, 2000);
    }
    let period = hoy;
    if (!error && idxFecha != null) {
      const crudo = fila[idxFecha];
      period = aFecha(crudo);
      if (!period) error = crudo == null || String(crudo).trim() === '' ? 'fecha vacía' : `fecha inválida ("${String(crudo).slice(0, 30)}")`;
    }
    const numericos = campos.filter((f) => f.type === 'number' && asignaciones.some((a) => a.campo === f.key));
    if (!error && numericos.length && numericos.every((f) => data[f.key] == null)) error = `${numericos[0].label || numericos[0].key} vacío`;
    if (!error && !Object.keys(data).length) error = 'fila sin datos reconocibles';
    if (error) rechazadas.push({ fila: nro, motivo: error }); else validas.push({ fila: nro, period, data });
  });
  return { validas, rechazadas };
}

// Campos nuevos a partir de columnas sin destino (para crear un dataset o ampliarlo).
export function camposDesdeColumnas(columnas, excluir = []) {
  return columnas.filter((c) => !excluir.includes(c.key)).map((c) => ({ key: c.key, label: c.nombre.slice(0, 60), type: c.tipo }));
}
