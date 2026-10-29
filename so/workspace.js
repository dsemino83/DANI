// SO · Workspace adaptativo: LivingArtifactCard, metadata de presentación (con defaults para artefactos existentes),
// ArtifactPreviewCache (vista previa calculada una vez y guardada; el Workspace nunca consulta datos pesados al cargar),
// bento S/M/L estable y "Continuar". Las funciones de datos son puras (se prueban en node); las de HTML devuelven texto
// escapado y no tocan el DOM.
import { kpis, porMes, haceCuanto, esc } from './vista.js';
import { insights, nombreMes, mesAnterior } from './analisis.js';
import { icono } from './iconos.js';

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const compacto = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
export const PREVIEW_VERSION = 2;
export const TAMANOS = ['S', 'M', 'L'];
const TIPOS = {
  dashboard: { etiqueta: 'Tablero', icono: 'chart' }, tool: { etiqueta: 'Herramienta', icono: 'herramienta' },
  form: { etiqueta: 'Formulario', icono: 'form' }, report: { etiqueta: 'Reporte', icono: 'doc' },
};
const CLASES = { simulator: 'Simulador', calculator: 'Calculadora', monitor: 'Monitor', workflow: 'Flujo', data_tool: 'Datos', app: 'App', analysis: 'Análisis' };

/**
 * Presentación de un WorkArtifact. Usa configuration.presentation si existe y completa con defaults: ningún
 * artefacto existente necesita recrearse para verse como Living Card.
 */
export function presentacion(a, m = {}, pv = null) {
  const p = a.configuration?.presentation || {};
  const sup = !!a.configuration?.surface;
  const t = TIPOS[a.type] || TIPOS.dashboard;
  const kind = p.kind || (sup ? 'analysis' : null);
  return {
    icon: p.icon || (sup ? 'chispa' : t.icono),
    tipo: (kind && CLASES[kind]) || t.etiqueta,
    description: p.description || (a.specification?.tema ? `Seguimiento de ${a.specification.tema}` : ''),
    size: TAMANOS.includes(m.size) ? m.size : TAMANOS.includes(p.size) ? p.size : 'M',
    primaryMetric: pv?.valor != null ? { label: pv.etiqueta, value: pv.valor, mes: pv.mes } : null,
    secondaryMetric: pv?.registros != null ? { label: 'Registros', value: pv.registros } : null,
    trend: pv?.variacion ?? null,
    status: pv ? pv.estado : 'pendiente',
    previewType: pv?.serie?.length > 1 ? 'sparkline' : pv?.valor != null ? 'delta' : 'status',
  };
}

/**
 * ArtifactPreviewCache: 1 KPI + 1 tendencia/insight + estado. Pura: recibe registros ya filtrados de superseded.
 * @returns {{ v: number, at: string, etiqueta: string, valor: number|null, mes: string|null, variacion: number|null,
 *            serie: number[], meses: string[], registros: number, ultimo: string|null, estado: string, insight: string|null }}
 */
export function calcularPreview(records, fields = [], conf = {}, hoy = new Date().toISOString().slice(0, 10)) {
  const nums = fields.filter((f) => f.type === 'number');
  const campo = nums.find((f) => f.key === conf.metrica) || nums[0] || null;
  const cat = fields.filter((f) => f.type === 'text').map((f) => ({ f, n: new Set(records.map((r) => r.data?.[f.key]).filter(Boolean)).size }))
    .filter((x) => x.n >= 2 && x.n <= 20).sort((x, y) => x.n - y.n)[0]?.f || null;
  const ultimo = records.reduce((m, r) => (r.created_at > m ? r.created_at : m), '') || null;
  const base = { v: PREVIEW_VERSION, at: new Date().toISOString(), etiqueta: campo?.label || campo?.key || 'Registros', registros: records.length, ultimo };
  if (!records.length) return { ...base, valor: null, mes: null, variacion: null, serie: [], meses: [], estado: 'vacio', insight: null };
  if (!campo) return { ...base, valor: records.length, mes: null, variacion: null, serie: [], meses: [], estado: 'ok', insight: null };
  const serie = porMes(records, campo.key).slice(-12);
  const k = kpis(records, campo.key);
  const mes = k.ultimoMes?.mes || null;
  const ins = insights(records, campo, cat, { hasta: mes, desde: mes }, hoy, 1)[0] || null;
  const variacion = k.variacion;
  const prev = serie.at(-2);
  const estado = variacion != null && variacion <= -0.1 ? 'atencion' : 'ok';
  return { ...base, valor: k.ultimoMes?.total ?? k.total, mes, comparadoCon: prev?.mes || (mes ? mesAnterior(mes) : null), variacion,
    serie: serie.map((p) => p.total), meses: serie.map((p) => p.mes), estado, insight: ins ? `${ins.titulo}. ${ins.texto}` : null };
}

// Vista previa vigente: existe, es de esta versión y es posterior al último cambio del artefacto.
export function previewVigente(pv, a) {
  return !!pv && pv.v === PREVIEW_VERSION && (!a?.updated_at || pv.at >= a.updated_at);
}

// Orden estable del Workspace: favoritos primero, luego el orden del usuario (ord); nunca se reordena solo.
export function ordenarWorkspace(artefactos, menu) {
  const m = (a) => menu.get(a.id) || {};
  return [...artefactos].sort((x, y) => (m(y).favorite ? 1 : 0) - (m(x).favorite ? 1 : 0) || (m(x).ord ?? 0) - (m(y).ord ?? 0)
    || String(x.created_at || '').localeCompare(String(y.created_at || '')));
}

// Mover una tarjeta (alternativa accesible al arrastre). Devuelve la nueva lista de ids.
export function reordenar(ids, id, destino) {
  const lista = ids.filter((x) => x !== id);
  const i = typeof destino === 'number' ? Math.max(0, Math.min(lista.length, destino)) : Math.max(0, lista.indexOf(destino));
  lista.splice(i, 0, id);
  return lista;
}

// Recientes por apertura real (last_opened_at), nunca por fecha de modificación.
export function recientesPorUso(artefactos, menu, n = 5) {
  return artefactos.filter((a) => menu.get(a.id)?.last_opened_at)
    .sort((x, y) => String(menu.get(y.id).last_opened_at).localeCompare(String(menu.get(x.id).last_opened_at))).slice(0, n);
}

/**
 * "Continuar": como máximo 4, por prioridad: lo que necesita atención → lo último abierto → lo que Francisco terminó.
 */
export function continuar({ resume = null, artefactos = [], tareas = [], avisos = [], lastVisit = null, max = 4 } = {}) {
  const out = [];
  for (const t of tareas.filter((x) => ['failed', 'waiting'].includes(x.status)).slice(0, 2)) out.push({ tipo: 'atencion', id: `t${t.id}`, titulo: t.name || t.kind, detalle: t.needs_action || t.error || 'Necesita atención', tarea: t.id });
  const r = resume?.artefactoId && artefactos.find((a) => a.id === resume.artefactoId);
  if (r) out.push({ tipo: 'artefacto', id: `a${r.id}`, titulo: r.name, artefactoId: r.id, detalle: [resume.filtro ? `solo ${resume.filtro.valor}` : '', resume.desde ? nombreMes(resume.desde) : ''].filter(Boolean).join(' · ') || 'Donde lo dejaste' });
  const hechas = tareas.filter((t) => t.status === 'completed' && lastVisit && t.updated_at > lastVisit);
  if (hechas.length) out.push({ tipo: 'hecho', id: 'hechas', titulo: `Francisco terminó ${hechas.length} ${hechas.length === 1 ? 'tarea' : 'tareas'}`, detalle: 'Desde tu última visita' });
  for (const n of avisos.filter((x) => !x.read_at && ['critical', 'action'].includes(x.priority)).slice(0, 1)) out.push({ tipo: 'aviso', id: `n${n.id}`, titulo: n.title, detalle: 'Necesita tu atención', artefactoId: n.artifact_id });
  return out.slice(0, max);
}

export function sparkline(serie, { w = 120, h = 32, clase = 'spark' } = {}) {
  if (!serie || serie.length < 2) return '';
  const min = Math.min(...serie), max = Math.max(...serie), r = max - min || 1;
  const pts = serie.map((v, i) => [2 + (i * (w - 4)) / (serie.length - 1), h - 3 - ((v - min) / r) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const u = pts.at(-1);
  return `<svg class="${clase}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/><circle cx="${u[0].toFixed(1)}" cy="${u[1].toFixed(1)}" r="2.6"/></svg>`;
}

export function deltaTxt(v) {
  if (v == null) return '';
  return `${v >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(v * 100))}%`;
}

const ESTADO = { ok: 'Al día', atencion: 'Requiere atención', vacio: 'Sin datos todavía', pendiente: 'Calculando vista previa', error: 'No se pudo actualizar' };

// Texto alternativo completo de la tarjeta (lectores de pantalla): nombre, tipo, KPI, tendencia y frescura.
export function etiquetaTarjeta(a, pr, pv) {
  const partes = [a.name, pr.tipo];
  if (pr.primaryMetric) partes.push(`${pr.primaryMetric.label}${pr.primaryMetric.mes ? ` ${nombreMes(pr.primaryMetric.mes)}` : ''}: ${fmt.format(pr.primaryMetric.value)}`);
  if (pr.trend != null) partes.push(`${pr.trend >= 0 ? 'subió' : 'bajó'} ${fmt.format(Math.abs(pr.trend * 100))}% contra el mes anterior`);
  partes.push(ESTADO[pr.status] || '');
  if (pv?.ultimo) partes.push(`último dato ${haceCuanto(pv.ultimo)}`);
  return partes.filter(Boolean).join('. ');
}

/** LivingArtifactCard: 1 KPI + 1 tendencia/insight + estado. Toda la superficie abre el artefacto. */
export function htmlTarjeta(a, m = {}, pv = null, { editable = true } = {}) {
  const pr = presentacion(a, m, pv);
  const valor = pr.primaryMetric ? (Math.abs(pr.primaryMetric.value) >= 1e6 ? compacto.format(pr.primaryMetric.value) : fmt.format(pr.primaryMetric.value)) : '—';
  const sub = pr.primaryMetric ? `${esc(pr.primaryMetric.label)}${pr.primaryMetric.mes ? ` · ${esc(nombreMes(pr.primaryMetric.mes))}` : ''}` : esc(pr.description || ESTADO[pr.status]);
  const tono = pr.trend == null ? '' : pr.trend >= 0 ? 'sube' : 'baja';
  return `<article class="lcard" data-art="${esc(a.id)}" data-size="${pr.size}" data-estado="${pr.status}" tabindex="0" role="link"
      aria-label="${esc(etiquetaTarjeta(a, pr, pv))}" draggable="${editable}">
    <header class="lc-cab"><span class="lc-ic">${icono(pr.icon)}</span><span class="lc-tipo">${esc(pr.tipo)}</span>
      <button type="button" class="ib lc-fav" data-lc="favorito" aria-pressed="${!!m.favorite}" aria-label="${m.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}: ${esc(a.name)}" title="Favorito">${icono('estrella', { relleno: !!m.favorite })}</button>
      <button type="button" class="ib lc-mas" data-lc="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Más acciones de ${esc(a.name)}" title="Más acciones">${icono('mas')}</button></header>
    <h3 class="lc-nombre">${esc(a.name)}</h3>
    <div class="lc-metrica"><span class="lc-valor">${valor}</span>${pr.trend != null ? `<span class="lc-delta ${tono}">${deltaTxt(pr.trend)}</span>` : ''}</div>
    <p class="lc-sub">${sub}</p>
    ${pr.previewType === 'sparkline' ? sparkline(pv.serie) : '<div class="spark vacio-spark" aria-hidden="true"></div>'}
    <footer class="lc-pie"><span class="punto ${pr.status}" aria-hidden="true"></span><span class="lc-fresco">${pv?.ultimo ? `Actualizado ${esc(haceCuanto(pv.ultimo))}` : esc(ESTADO[pr.status])}</span>
      <button type="button" class="enlace lc-ql" data-lc="vistazo" aria-expanded="false" aria-label="Vista rápida de ${esc(a.name)}">Vista rápida</button></footer>
  </article>`;
}

/** Quick Look: KPI, gráfico principal, insight, frescura y estado, sin cargar el artefacto completo. */
export function htmlVistazo(a, m = {}, pv = null, { editable = true } = {}) {
  const pr = presentacion(a, m, pv);
  let graf = '<p class="vacio">Sin datos para graficar todavía.</p>';
  if (pv?.serie?.length) {
    const max = Math.max(...pv.serie.map(Math.abs), 1);
    graf = `<div class="ql-barras" role="img" aria-label="${esc(pr.primaryMetric?.label || 'Valor')} por mes: ${pv.meses.map((mm, i) => `${nombreMes(mm)} ${fmt.format(pv.serie[i])}`).join(', ')}">
      ${pv.serie.map((v, i) => `<span class="qb" style="--h:${Math.max(4, Math.round((Math.abs(v) / max) * 100))}%" title="${esc(nombreMes(pv.meses[i]))}: ${fmt.format(v)}"><i></i><small>${esc(pv.meses[i].slice(5))}</small></span>`).join('')}</div>`;
  }
  return `<div class="ql" role="region" aria-label="Vista rápida de ${esc(a.name)}">
    <div class="ql-cab"><div><span class="lc-tipo">${esc(pr.tipo)}</span><h3>${esc(a.name)}</h3></div>
      <button type="button" class="ib" data-lc="cerrar-vistazo" aria-label="Cerrar vista rápida" title="Cerrar">${icono('cerrar')}</button></div>
    <div class="ql-cuerpo">
      <div class="ql-kpi"><span class="lc-valor">${pr.primaryMetric ? fmt.format(pr.primaryMetric.value) : '—'}</span>
        ${pr.trend != null ? `<span class="lc-delta ${pr.trend >= 0 ? 'sube' : 'baja'}">${deltaTxt(pr.trend)}</span>` : ''}
        <p class="lc-sub">${pr.primaryMetric ? `${esc(pr.primaryMetric.label)} · ${esc(nombreMes(pr.primaryMetric.mes))}${pv?.comparadoCon ? ` vs. ${esc(nombreMes(pv.comparadoCon))}` : ''}` : esc(ESTADO[pr.status])}</p></div>
      ${graf}
    </div>
    ${pv?.insight ? `<p class="ql-insight">${icono('chispa', { tam: 16 })} ${esc(pv.insight)}</p>` : ''}
    <p class="ql-pie"><span class="punto ${pr.status}" aria-hidden="true"></span>${esc(ESTADO[pr.status])}${pv?.ultimo ? ` · último dato ${esc(haceCuanto(pv.ultimo))}` : ''}${pv?.at ? ` · vista previa ${esc(haceCuanto(pv.at))}` : ''}</p>
    <div class="ql-acc"><a class="boton primario" href="#/a/${esc(a.id)}">Abrir</a>
      <button type="button" data-lc="preguntar">${icono('chispa', { tam: 16 })} Preguntar</button>
      <button type="button" data-lc="actualizar">${icono('actualizar', { tam: 16 })} Actualizar</button>
      ${editable ? `<button type="button" data-lc="compartir">${icono('compartir', { tam: 16 })} Compartir</button>` : ''}</div>
  </div>`;
}

/** Menú contextual: solo acciones posibles para el permiso actual. */
export function accionesMenu({ editable = true, favorito = false, oculto = false, archivado = false, tam = 'M' } = {}) {
  const a = [['abrir', 'Abrir'], ['vistazo', 'Vista rápida'], ['preguntar', 'Preguntarle a Francisco']];
  if (editable) a.push(['editar', 'Editar con Francisco'], ['actualizar', 'Actualizar datos'], ['compartir', 'Compartir']);
  a.push(['favorito', favorito ? 'Quitar de favoritos' : 'Agregar a favoritos']);
  if (editable) {
    a.push(...TAMANOS.filter((t) => t !== tam).map((t) => [`tam-${t}`, `Tamaño ${{ S: 'chico', M: 'mediano', L: 'grande' }[t]}`]));
    a.push(['antes', 'Mover antes'], ['despues', 'Mover después'], [oculto ? 'mostrar' : 'ocultar', oculto ? 'Mostrar en el Workspace' : 'Ocultar del Workspace'],
      ['duplicar', 'Duplicar'], [archivado ? 'desarchivar' : 'archivar', archivado ? 'Sacar de archivados' : 'Archivar'], ['eliminar', 'Eliminar…']);
  }
  return a.map(([id, texto]) => ({ id, texto }));
}
