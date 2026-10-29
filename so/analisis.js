// SO · análisis determinista sobre registros de un artefacto: filtros, períodos, comparación y explicaciones con
// evidencia (sin razonamiento interno). Puro: se usa en la vista, en Francisco y en los tests.

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const pct = (x) => `${x >= 0 ? '+' : '−'}${fmt.format(Math.abs(x * 100))}%`;

export function nombreMes(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} ${y}`;
}

export function mesAnterior(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// "agosto" → el agosto más reciente que no sea posterior a `ref` (mes de referencia o hoy). "agosto 2025" explícito.
export function parseMes(texto, ref) {
  const n = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const iso = n.match(/\b(\d{4})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const r = String(ref || new Date().toISOString().slice(0, 7)).slice(0, 7);
  if (/\b(mes pasado|mes anterior)\b/.test(n)) return mesAnterior(r);
  if (/\beste mes\b/.test(n)) return r;
  const idx = MESES.findIndex((m) => new RegExp(`\\b${m === 'septiembre' ? 'sep?tiembre' : m}\\b`).test(n));
  if (idx < 0) return null;
  const anio = n.match(new RegExp(`${MESES[idx].slice(0, 3)}\\w*\\s+(?:de(?:l)?\\s+)?(\\d{4})`));
  const [ry, rm] = r.split('-').map(Number);
  const y = anio ? Number(anio[1]) : (idx + 1 > rm ? ry - 1 : ry);
  return `${y}-${String(idx + 1).padStart(2, '0')}`;
}

export function filtrar(records, estado = {}) {
  return records.filter((r) => {
    if (estado.filtro && String(r.data?.[estado.filtro.key] ?? '').toLowerCase() !== String(estado.filtro.valor).toLowerCase()) return false;
    const m = String(r.period).slice(0, 7);
    if (estado.desde && m < estado.desde) return false;
    if (estado.hasta && m > estado.hasta) return false;
    return true;
  });
}

export function totalMes(records, key, ym) {
  const rs = records.filter((r) => String(r.period).slice(0, 7) === ym && Number.isFinite(Number(r.data?.[key])));
  return { total: rs.reduce((s, r) => s + Number(r.data[key]), 0), n: rs.length };
}

export function mesesConDatos(records) {
  return [...new Set(records.map((r) => String(r.period).slice(0, 7)))].sort();
}

// Confianza: Confirmado (meses cerrados con datos) · Información incompleta (sin datos o mes en curso).
export function confianza(meses, hoy = new Date().toISOString().slice(0, 10)) {
  const actual = hoy.slice(0, 7);
  if (meses.some((m) => m.n === 0)) return { nivel: 'incompleta', motivo: `No hay datos para ${meses.filter((m) => m.n === 0).map((m) => nombreMes(m.mes)).join(' ni ')}.` };
  if (meses.some((m) => m.mes === actual)) return { nivel: 'incompleta', motivo: `${nombreMes(actual)} todavía está en curso: el total puede cambiar.` };
  return { nivel: 'confirmado', motivo: null };
}

/**
 * Compara dos meses de una métrica y explica la diferencia con evidencia (aporte por categoría si existe).
 * @returns {{ a, b, delta, variacion, aportes, confianza, texto, evidencia }}
 */
export function comparar(records, campo, mesA, mesB, cat, hoy) {
  const A = { mes: mesA, ...totalMes(records, campo.key, mesA) };
  const B = { mes: mesB, ...totalMes(records, campo.key, mesB) };
  const delta = A.total - B.total;
  const variacion = B.total !== 0 ? delta / Math.abs(B.total) : null;
  const conf = confianza([A, B], hoy);
  let aportes = [];
  if (cat) {
    const porCat = (ym) => {
      const m = new Map();
      for (const r of records) if (String(r.period).slice(0, 7) === ym && Number.isFinite(Number(r.data?.[campo.key]))) {
        const c = String(r.data?.[cat.key] ?? 'Sin dato'); m.set(c, (m.get(c) || 0) + Number(r.data[campo.key]));
      }
      return m;
    };
    const ma = porCat(mesA), mb = porCat(mesB);
    aportes = [...new Set([...ma.keys(), ...mb.keys()])]
      .map((c) => ({ categoria: c, delta: (ma.get(c) || 0) - (mb.get(c) || 0) }))
      .filter((x) => x.delta !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3);
  }
  const verbo = delta > 0 ? 'subió' : delta < 0 ? 'bajó' : 'se mantuvo igual';
  let texto = `${campo.label || campo.key} ${verbo}${delta !== 0 ? ` ${variacion != null ? pct(variacion) : fmt.format(delta)}` : ''} en ${nombreMes(mesA)} respecto de ${nombreMes(mesB)}: ` +
    `${fmt.format(A.total)} vs. ${fmt.format(B.total)}.`;
  if (aportes.length && delta !== 0) {
    const principal = aportes[0];
    texto += ` El mayor cambio vino de ${cat.label || cat.key} "${principal.categoria}" (${principal.delta > 0 ? '+' : '−'}${fmt.format(Math.abs(principal.delta))}).`;
  }
  return {
    a: A, b: B, delta, variacion, aportes, confianza: conf, texto,
    evidencia: { operacion: `suma de ${campo.label || campo.key} por mes${cat ? ` y por ${cat.label || cat.key}` : ''}`, registros: A.n + B.n },
  };
}

// Panorama breve: último mes con datos vs. anterior, tendencia y principal categoría.
export function analizar(records, fields, hoy) {
  const num = fields.find((f) => f.type === 'number');
  if (!num) return { texto: 'Este tablero no tiene campos numéricos para analizar.', confianza: { nivel: 'incompleta' } };
  if (!records.length) return { texto: 'Todavía no hay datos cargados para analizar.', confianza: { nivel: 'incompleta' } };
  const meses = mesesConDatos(records);
  const ult = meses.at(-1);
  const cat = fields.find((f) => f.type === 'text');
  if (meses.length < 2) {
    const t = totalMes(records, num.key, ult);
    return { texto: `Hay datos solo de ${nombreMes(ult)}: ${num.label} total ${fmt.format(t.total)} en ${t.n} registros. Con un mes más puedo comparar.`,
      confianza: confianza([{ mes: ult, n: t.n }], hoy), evidencia: { operacion: `suma de ${num.label} por mes`, registros: t.n } };
  }
  const c = comparar(records, num, ult, mesAnterior(ult), cat, hoy);
  const totales = meses.map((m) => totalMes(records, num.key, m).total);
  const max = Math.max(...totales), mesMax = meses[totales.indexOf(max)];
  return { ...c, texto: `${c.texto} El mejor mes registrado es ${nombreMes(mesMax)} (${fmt.format(max)}).`,
    evidencia: { ...c.evidencia, registros: records.length, meses: meses.length } };
}
