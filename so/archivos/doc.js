// SO · DocSpec de un tablero (Resumen → comparación → serie mensual → Detalle). Puro: lo usan el navegador
// (exportar) y el servidor (automatizaciones programadas), así ambos producen exactamente el mismo informe.
import { nombreMes, insights, comparar, filtrar, kpis, porMes } from '../analisis.js';

/**
 * @param {{ name: string, configuration?: object }} a artefacto
 * @param {{ fields: object[], records: object[] }} d datos del tablero
 * @param {object} s estado de la vista (filtro, desde, hasta, comparar); {} = todos los datos
 * @param {{ formato?: string, hoy?: Date }} op
 */
// Configuración de exportación del tablero, separada de cómo se visualiza (configuration.exportacion):
//   datos: 'vista' (lo que se está viendo, con sus filtros) | 'todo' (todo lo guardado)
//   secciones: { resumen, mensual, detalle } · columnas: claves de campos para el Detalle (null = todas)
//   aperturas: desgloses que el usuario define en el chat y solo aparecen al exportar (como el saldo de deuda de VALO:
//   en pantalla resumido, en el Excel abierto). Cada una es una hoja: { tipo: 'campo_mes' | 'campo' | 'dia', campo? }
export const EXPORTACION_POR_DEFECTO = { datos: 'vista', secciones: { resumen: true, mensual: true, detalle: true }, columnas: null, aperturas: [] };
const TIPOS_APERTURA = ['campo_mes', 'campo', 'dia'];
export function exportacionDe(a) {
  const e = a?.configuration?.exportacion || {};
  const aperturas = (Array.isArray(e.aperturas) ? e.aperturas : []).filter((x) => TIPOS_APERTURA.includes(x?.tipo) && (x.tipo === 'dia' || x.campo)).slice(0, 12);
  return { datos: e.datos === 'todo' ? 'todo' : 'vista', secciones: { ...EXPORTACION_POR_DEFECTO.secciones, ...(e.secciones || {}) }, columnas: Array.isArray(e.columnas) && e.columnas.length ? e.columnas : null, aperturas };
}
export const nombreApertura = (x, fields = []) => {
  const c = fields.find((f) => f.key === x.campo)?.label || x.campo;
  return x.tipo === 'dia' ? 'Apertura por día' : x.tipo === 'campo_mes' ? `Por ${c} y mes` : `Por ${c}`;
};

const r2 = (v) => Math.round(v * 100) / 100;
// Una apertura → sección con tabla (hoja en Excel). Solo suma la métrica del tablero.
function seccionApertura(x, recs, fields, num) {
  const titulo = nombreApertura(x, fields);
  const val = (r) => Number(r.data?.[num.key]);
  const validos = recs.filter((r) => Number.isFinite(val(r)));
  if (x.tipo === 'dia') {
    const porDia = new Map();
    for (const r of validos) { const d = String(r.period).slice(0, 10); porDia.set(d, (porDia.get(d) || 0) + val(r)); }
    const filas = []; let mes = null, sub = 0, total = 0;
    const cerrar = () => { if (mes) filas.push([nombreMes(mes), 'Total del mes', r2(sub)]); };
    for (const d of [...porDia.keys()].sort()) {
      if (d.slice(0, 7) !== mes) { cerrar(); mes = d.slice(0, 7); sub = 0; }
      const v = porDia.get(d); sub += v; total += v;
      filas.push([nombreMes(mes), d, r2(v)]);
    }
    cerrar();
    if (filas.length) filas.push(['Total', '', r2(total)]);
    return { titulo, tabla: { columnas: [{ label: 'Mes', type: 'text' }, { label: 'Fecha', type: 'date' }, { label: num.label, type: 'number' }], filas } };
  }
  const campo = fields.find((f) => f.key === x.campo);
  if (!campo) return null;
  const clave = (r) => String(r.data?.[campo.key] ?? 'Sin dato') || 'Sin dato';
  if (x.tipo === 'campo') {
    const m = new Map(); let total = 0;
    for (const r of validos) { m.set(clave(r), (m.get(clave(r)) || 0) + val(r)); total += val(r); }
    const filas = [...m.entries()].sort((p, q) => q[1] - p[1]).map(([k, v]) => [k, r2(v), total ? r2((v / total) * 100) : 0]);
    filas.push(['Total', r2(total), total ? 100 : 0]);
    return { titulo, tabla: { columnas: [{ label: campo.label || campo.key, type: 'text' }, { label: num.label, type: 'number' }, { label: '% del total', type: 'number' }], filas } };
  }
  const meses = [...new Set(validos.map((r) => String(r.period).slice(0, 7)))].sort();
  const m = new Map();
  for (const r of validos) {
    const k = clave(r), mm = String(r.period).slice(0, 7);
    if (!m.has(k)) m.set(k, {}); m.get(k)[mm] = (m.get(k)[mm] || 0) + val(r);
  }
  const filas = [...m.entries()].map(([k, pm]) => [k, ...meses.map((mm) => (pm[mm] ? r2(pm[mm]) : null)), r2(Object.values(pm).reduce((a, b) => a + b, 0))])
    .sort((p, q) => q.at(-1) - p.at(-1));
  filas.push(['Total', ...meses.map((mm) => r2([...m.values()].reduce((a, pm) => a + (pm[mm] || 0), 0))), r2(filas.reduce((a, f) => a + f.at(-1), 0))]);
  return { titulo, tabla: { columnas: [{ label: campo.label || campo.key, type: 'text' }, ...meses.map((mm) => ({ label: nombreMes(mm), type: 'number' })), { label: 'Total', type: 'number' }], filas } };
}

export function docDeDatos(a, d, sVista = {}, { formato, hoy = new Date(), datos = null } = {}) {
  const ex = exportacionDe(a);
  const s = (datos || ex.datos) === 'todo' ? {} : sVista;   // un pedido puntual ("exportá todo") manda sobre lo guardado
  const recs = filtrar(d.records, s);
  const num = d.fields.find((f) => f.key === a.configuration?.metrica) || d.fields.find((f) => f.type === 'number');
  const cat = d.fields.filter((f) => f.type === 'text').map((f) => ({ f, n: new Set(d.records.map((r) => r.data?.[f.key]).filter(Boolean)).size })).filter((z) => z.n >= 2 && z.n <= 20).sort((p, r) => p.n - r.n)[0]?.f || null;
  const contexto = [s.filtro ? `solo ${s.filtro.label || s.filtro.key}: ${s.filtro.valor}` : '', s.desde ? `desde ${nombreMes(s.desde)}` : '', s.hasta && s.hasta !== s.desde ? `hasta ${nombreMes(s.hasta)}` : ''].filter(Boolean).join(' · ');
  const secciones = [];
  if (num) {
    const k = kpis(recs, num.key);
    const ins = insights(d.records.filter((r) => !s.filtro || String(r.data?.[s.filtro.key] ?? '').toLowerCase() === String(s.filtro.valor).toLowerCase()), num, cat, s, hoy.toISOString().slice(0, 10), 2);
    if (ex.secciones.resumen) secciones.push({ titulo: 'Resumen', metricas: [{ label: `Total ${num.label}`, valor: k.total }, ...(k.ultimoMes ? [{ label: `${num.label} ${nombreMes(k.ultimoMes.mes)}`, valor: k.ultimoMes.total, delta: k.variacion }] : []), { label: 'Registros', valor: recs.length }],
      parrafos: ins.map((i) => `${i.titulo}. ${i.texto}`) });
    if (s.comparar) {
      const mesA = s.hasta || s.desde; if (mesA) { const c = comparar(recs.length ? d.records : [], num, mesA, s.comparar, cat); secciones.push({ titulo: `Comparación ${nombreMes(mesA)} vs. ${nombreMes(s.comparar)}`, parrafos: [c.texto] }); }
    }
    const serie = porMes(recs, num.key);
    if (serie.length && ex.secciones.mensual) secciones.push({ titulo: `${num.label} por mes`, tabla: { columnas: [{ label: 'Mes', type: 'text' }, { label: num.label, type: 'number' }], filas: serie.map((p) => [nombreMes(p.mes), p.total]) } });
  }
  if (num) for (const x of ex.aperturas) { const sec = seccionApertura(x, recs, d.fields, num); if (sec?.tabla.filas.length) secciones.push(sec); }
  const max = formato === 'pdf' || formato === 'docx' || formato === 'pptx' ? 500 : 200000;
  const detalle = recs.slice(-max);
  const campos = ex.columnas ? d.fields.filter((f) => ex.columnas.includes(f.key)) : d.fields;
  if (ex.secciones.detalle || !secciones.some((x) => x.tabla)) {   // siempre queda al menos una tabla (CSV/Excel la necesitan)
    secciones.push({ titulo: 'Detalle', parrafos: recs.length > max ? [`Se incluyen los últimos ${max} de ${recs.length} registros; el archivo Excel o CSV trae todos.`] : [],
      tabla: { columnas: [{ label: 'Fecha', type: 'date' }, ...campos.map((f) => ({ label: f.label || f.key, type: f.type }))], filas: detalle.map((r) => [String(r.period).slice(0, 10), ...campos.map((f) => r.data?.[f.key] ?? null)]) } });
  }
  return { doc: { titulo: a.name, subtitulo: `${contexto || 'Todos los datos'} · generado ${hoy.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, secciones }, registros: recs.length };
}
