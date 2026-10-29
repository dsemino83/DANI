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

/**
 * Insights útiles (no obviedades), ordenados por impacto × confianza × relevancia. Como máximo `max`.
 * Solo se generan si hay contra qué comparar; nunca "septiembre tiene datos de septiembre".
 * @returns {{ id: string, titulo: string, texto: string, tono: 'sube'|'baja'|'neutro', score: number }[]}
 */
export function insights(records, campo, cat, est = {}, hoy, max = 2) {
  if (!campo || !records.length) return [];
  const meses = mesesConDatos(records);
  if (meses.length < 2) return [];
  const mesA = est.hasta || est.desde || meses.at(-1);
  const mesB = est.comparar || mesAnterior(mesA);
  if (!meses.includes(mesA) || !meses.includes(mesB)) return [];
  const c = comparar(records, campo, mesA, mesB, cat, hoy);
  const conf = c.confianza.nivel === 'confirmado' ? 1 : 0.6;
  const out = [];
  const lbl = campo.label || campo.key;
  if (c.variacion != null && Math.abs(c.variacion) >= 0.01) {
    const baja = c.delta < 0;
    const p = c.aportes[0];
    const parte = p && Math.sign(p.delta) === Math.sign(c.delta) ? p.delta / c.delta : 0;
    const explica = parte >= 0.3 && cat ? ` ${cat.label || cat.key} "${p.categoria}" explica ${fmt.format(Math.round(parte * 100))}% de ${baja ? 'la caída' : 'la suba'}.` : '';
    out.push({ id: 'variacion', tono: baja ? 'baja' : 'sube', score: Math.min(1, Math.abs(c.variacion) * 4) * conf * (explica ? 1 : 0.8),
      titulo: `${lbl} ${baja ? '↓' : '↑'} ${fmt.format(Math.abs(c.variacion * 100))}%`,
      texto: `${nombreMes(mesA)} vs. ${nombreMes(mesB)}: ${fmt.format(c.a.total)} contra ${fmt.format(c.b.total)}.${explica}` });
  }
  if (cat) {
    const m = new Map();
    let tot = 0;
    for (const r of records) if (String(r.period).slice(0, 7) === mesA && Number.isFinite(Number(r.data?.[campo.key]))) {
      const k = String(r.data?.[cat.key] ?? 'Sin dato'); const v = Number(r.data[campo.key]); m.set(k, (m.get(k) || 0) + v); tot += v;
    }
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && m.size >= 2 && tot > 0 && top[1] / tot >= 0.5) {
      out.push({ id: 'concentracion', tono: 'neutro', score: (top[1] / tot - 0.4) * conf,
        titulo: `${top[0]} concentra ${fmt.format(Math.round((top[1] / tot) * 100))}%`, texto: `De ${lbl} en ${nombreMes(mesA)} (${m.size} ${cat.label || cat.key} con datos).` });
    }
  }
  const totales = meses.map((x) => totalMes(records, campo.key, x).total);
  const iA = meses.indexOf(mesA);
  if (meses.length >= 3 && totales[iA] === Math.max(...totales)) out.push({ id: 'record', tono: 'sube', score: 0.35 * conf, titulo: `Mejor mes registrado`, texto: `${nombreMes(mesA)} supera a los ${meses.length - 1} meses anteriores con datos.` });
  else if (meses.length >= 3 && totales[iA] === Math.min(...totales)) out.push({ id: 'record', tono: 'baja', score: 0.35 * conf, titulo: `Mes más bajo registrado`, texto: `${nombreMes(mesA)} queda por debajo de los otros ${meses.length - 1} meses con datos.` });
  return out.sort((x, y) => y.score - x.score).slice(0, max);
}

// Agrega por mes la suma de un campo numérico. Pura (se prueba en node).
export function porMes(records, key) {
  const m = new Map();
  for (const r of records) {
    const v = Number(r.data?.[key]);
    if (!Number.isFinite(v)) continue;
    const k = String(r.period).slice(0, 7);
    m.set(k, (m.get(k) || 0) + v);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, total]) => ({ mes, total }));
}

export function kpis(records, key) {
  const vals = records.map((r) => Number(r.data?.[key])).filter(Number.isFinite);
  const meses = porMes(records, key);
  const ult = meses.at(-1), ant = meses.at(-2);
  const variacion = ult && ant && ant.total !== 0 ? (ult.total - ant.total) / Math.abs(ant.total) : null;
  return { total: vals.reduce((s, v) => s + v, 0), registros: vals.length, ultimoMes: ult || null, variacion };
}

