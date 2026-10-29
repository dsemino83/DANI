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
export const EXPORTACION_POR_DEFECTO = { datos: 'vista', secciones: { resumen: true, mensual: true, detalle: true }, columnas: null };
export function exportacionDe(a) {
  const e = a?.configuration?.exportacion || {};
  return { datos: e.datos === 'todo' ? 'todo' : 'vista', secciones: { ...EXPORTACION_POR_DEFECTO.secciones, ...(e.secciones || {}) }, columnas: Array.isArray(e.columnas) && e.columnas.length ? e.columnas : null };
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
  const max = formato === 'pdf' || formato === 'docx' || formato === 'pptx' ? 500 : 200000;
  const detalle = recs.slice(-max);
  const campos = ex.columnas ? d.fields.filter((f) => ex.columnas.includes(f.key)) : d.fields;
  if (ex.secciones.detalle || !secciones.some((x) => x.tabla)) {   // siempre queda al menos una tabla (CSV/Excel la necesitan)
    secciones.push({ titulo: 'Detalle', parrafos: recs.length > max ? [`Se incluyen los últimos ${max} de ${recs.length} registros; el archivo Excel o CSV trae todos.`] : [],
      tabla: { columnas: [{ label: 'Fecha', type: 'date' }, ...campos.map((f) => ({ label: f.label || f.key, type: f.type }))], filas: detalle.map((r) => [String(r.period).slice(0, 10), ...campos.map((f) => r.data?.[f.key] ?? null)]) } });
  }
  return { doc: { titulo: a.name, subtitulo: `${contexto || 'Todos los datos'} · generado ${hoy.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`, secciones }, registros: recs.length };
}
