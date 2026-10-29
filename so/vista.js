// SO · render de un WorkArtifact (dashboard): controles de contexto (período, filtro, comparación), KPIs, gráfico,
// selección para preguntar a Francisco, frescura de datos, carga e importación, e historial.
// Lo usan el workspace del dueño (app.js) y la ruta compartida (shared/). El estado (período, filtro, comparación,
// selección) llega de afuera y los cambios se devuelven por onEstado: la UI y Francisco comparten la misma fuente.
import { filtrar, mesesConDatos, nombreMes, comparar, mesAnterior, insights, porMes, kpis } from './analisis.js';
export { porMes, kpis };   // viven en analisis.js (puras, también las usa el servidor)

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const compacto = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

export function mesDe(fecha) { return String(fecha).slice(0, 7); }

// Reparte un campo numérico por las categorías de un campo de texto; más de 8 → "Otros".
export function porCategoria(records, key, cat) {
  const m = new Map();
  for (const r of records) {
    const v = Number(r.data?.[key]);
    if (!Number.isFinite(v)) continue;
    const c = String(r.data?.[cat] ?? 'Sin dato') || 'Sin dato';
    m.set(c, (m.get(c) || 0) + v);
  }
  const orden = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (orden.length <= 8) return orden.map(([nombre, total]) => ({ nombre, total }));
  const resto = orden.slice(7).reduce((s, [, v]) => s + v, 0);
  return [...orden.slice(0, 7).map(([nombre, total]) => ({ nombre, total })), { nombre: 'Otros', total: resto }];
}

export function haceCuanto(fecha, ahora = Date.now()) {
  if (!fecha) return 'sin datos';
  const s = Math.max(0, Math.round((ahora - new Date(fecha).getTime()) / 1000));
  if (s < 60) return 'hace instantes';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, hijos = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const h of hijos) e.append(h);
  return e;
}
function titulo(txt) { const t = el('title'); t.textContent = txt; return t; }

function grafLinea(serie, tipo, etiqueta, sel, onSel) {
  const W = 640, H = 240, P = { t: 16, r: 16, b: 28, l: 64 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${etiqueta} por mes`, class: 'grafico' });
  if (!serie.length) return svg;
  const max = Math.max(0, ...serie.map((p) => p.total)), min = Math.min(0, ...serie.map((p) => p.total));
  const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - min) / ((max - min) || 1));
  const paso = (W - P.l - P.r) / Math.max(1, serie.length - (tipo === 'bar' ? 0 : 1));
  const x = (i) => P.l + (tipo === 'bar' ? paso * i + paso / 2 : paso * i);
  for (const v of [min, (min + max) / 2, max]) {
    svg.append(el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grilla' }));
    const t = el('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'eje' }); t.textContent = compacto.format(v); svg.append(t);
  }
  const cada = Math.ceil(serie.length / 8);
  serie.forEach((p, i) => {
    if (i % cada === 0 || i === serie.length - 1) {
      const borde = tipo !== 'bar' && serie.length > 1 ? (i === 0 ? 'start' : i === serie.length - 1 ? 'end' : 'middle') : 'middle';
      const t = el('text', { x: x(i), y: H - 8, 'text-anchor': borde, class: 'eje' }); t.textContent = p.mes; svg.append(t);
    }
  });
  const marca = (nodo, p) => {
    nodo.setAttribute('tabindex', '0');
    nodo.setAttribute('role', 'button');
    nodo.setAttribute('aria-label', `${p.mes}: ${fmt.format(p.total)}. Seleccionar para preguntar a Francisco`);
    if (sel?.tipo === 'punto' && sel.mes === p.mes) nodo.classList.add('seleccionado');
    const go = () => onSel?.({ tipo: 'punto', mes: p.mes, valor: p.total, etiqueta: `${etiqueta} ${nombreMes(p.mes)}` });
    nodo.addEventListener('click', go);
    nodo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    return nodo;
  };
  if (tipo === 'bar') {
    const ancho = Math.max(4, Math.min(48, paso - 2));
    serie.forEach((p, i) => {
      const y0 = y(Math.max(0, p.total)), alto = Math.max(1, Math.abs(y(p.total) - y(0)));
      svg.append(marca(el('rect', { x: x(i) - ancho / 2, y: y0, width: ancho, height: alto, rx: 4, class: 'barra' }, [titulo(`${p.mes}: ${fmt.format(p.total)}`)]), p));
    });
  } else {
    svg.append(el('polyline', { points: serie.map((p, i) => `${x(i)},${y(p.total)}`).join(' '), class: 'linea' }));
    serie.forEach((p, i) => svg.append(marca(el('circle', { cx: x(i), cy: y(p.total), r: 5, class: 'punto' }, [titulo(`${p.mes}: ${fmt.format(p.total)}`)]), p)));
  }
  return svg;
}

function grafTorta(partes, etiqueta) {
  const svg = el('svg', { viewBox: '0 0 240 240', role: 'img', 'aria-label': etiqueta, class: 'grafico torta' });
  const total = partes.reduce((s, p) => s + Math.max(0, p.total), 0);
  if (!total) return svg;
  let a = -Math.PI / 2;
  partes.forEach((p, i) => {
    const f = Math.max(0, p.total) / total, b = a + f * Math.PI * 2;
    const large = f > 0.5 ? 1 : 0, r = 100, c = 120;
    const d = f >= 0.9999 ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
      : `M ${c} ${c} L ${c + r * Math.cos(a)} ${c + r * Math.sin(a)} A ${r} ${r} 0 ${large} 1 ${c + r * Math.cos(b)} ${c + r * Math.sin(b)} Z`;
    svg.append(el('path', { d, style: `fill: var(${SERIES[i]})`, class: 'gajo', tabindex: 0 },
      [titulo(`${p.nombre}: ${fmt.format(p.total)} (${Math.round(f * 100)}%)`)]));
    a = b;
  });
  return svg;
}

// Categoría útil para explicar cambios: texto con pocos valores distintos (canal, región…).
export function categoriaUtil(fields, records) {
  return fields.filter((f) => f.type === 'text').map((f) => ({ f, n: new Set(records.map((r) => r.data?.[f.key]).filter(Boolean)).size }))
    .filter((x) => x.n >= 2 && x.n <= 30).sort((x, y) => x.n - y.n)[0]?.f || null;
}

/**
 * Focused Artifact (dashboard). Jerarquía: resumen → FilterBar → KPIs (+ inspector) → insights → gráfico → detalle.
 * El estado (período, filtro, comparación, selección) llega de afuera y los cambios vuelven por onEstado: la UI y
 * Francisco comparten la misma fuente de verdad. Lo usan el workspace del dueño y la ruta compartida.
 * @param {HTMLElement} cont
 * @param {{ id: string, name: string, version?: number, fields: any[], records: any[], configuration?: any, permission: string }} art
 * @param {{ estado?: any, onEstado?: Function, onSeleccion?: Function, onAdd?: Function, onImportar?: Function, onAccion?: Function,
 *           frescura?: { cargado: string, ultimo: string|null, cache?: boolean }, onActualizar?: Function, puedeCargar?: boolean }} op
 */
export function renderArtefacto(cont, art, op = {}) {
  const numericos = art.fields.filter((f) => f.type === 'number');
  const textos = art.fields.filter((f) => f.type === 'text');
  const conf = art.configuration || {};
  let clave = conf.metrica && numericos.some((f) => f.key === conf.metrica) ? conf.metrica : numericos[0]?.key;
  const tipo = conf.grafico || 'line';
  const puedeCargar = op.puedeCargar ?? ['OWNER', 'EDIT'].includes(art.permission);
  const est = op.estado || {};
  const sel = est.seleccion?.artefactoId === art.id ? est.seleccion : null;
  const recs = filtrar(art.records, est);
  const meses = mesesConDatos(art.records);
  const cambiar = (c) => op.onEstado?.(c);
  const seleccionar = (s) => op.onSeleccion?.({ ...s, artefactoId: art.id });

  cont.innerHTML = '';
  const raiz = document.createElement('div');
  raiz.className = 'viz-root artefacto';
  cont.append(raiz);

  const campo = numericos.find((f) => f.key === clave);
  const etiqueta = campo?.label || clave || '';
  const k = clave ? kpis(recs, clave) : null;
  const varTxt = k?.variacion == null ? '—' : `${k.variacion >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(k.variacion * 100))}%`;
  const valoresCat = (key) => [...new Set(art.records.map((r) => r.data?.[key]).filter((v) => v != null && v !== ''))].sort().slice(0, 200);
  const compMes = est.comparar ? (est.hasta || est.desde || meses.at(-1)) : null;
  const cat = categoriaUtil(art.fields, art.records);
  const comp = est.comparar && campo && compMes ? comparar(filtrar(art.records, { filtro: est.filtro }), campo, compMes, est.comparar, cat || textos[0]) : null;
  const base = filtrar(art.records, { filtro: est.filtro });
  const ins = campo ? insights(base, campo, cat, { desde: est.desde, hasta: est.hasta, comparar: est.comparar }, op.hoy, 2) : [];
  const kpiBtn = (id, label, valor, extra = '') => `<button type="button" class="kpi ${sel?.tipo === 'kpi' && sel.id === id ? 'seleccionado' : ''}" data-kpi="${id}" aria-pressed="${sel?.tipo === 'kpi' && sel.id === id}"
      aria-label="${esc(label)}: ${esc(valor)}. Ver opciones"><span>${esc(label)}</span><strong>${esc(valor)}</strong>${extra}</button>`;
  const periodo = est.desde && est.hasta && est.desde === est.hasta ? est.desde : null;
  const rango = (est.desde || est.hasta) && !periodo;
  const pill = (activo) => `pill ${activo ? 'activo' : ''}`;
  const kInfo = { total: [k?.total, null], ultimo: [k?.ultimoMes?.total, k?.ultimoMes?.mes], variacion: [k?.variacion, k?.ultimoMes?.mes], registros: [recs.length, null] };
  const mesRef = periodo || est.hasta || meses.at(-1);
  const resumen = campo && k?.ultimoMes ? `${esc(etiqueta)} ${esc(nombreMes(k.ultimoMes.mes))}: <strong>${fmt.format(k.ultimoMes.total)}</strong>${k.variacion != null ? ` <span class="delta ${k.variacion >= 0 ? 'sube' : 'baja'}">${varTxt}</span> vs. ${esc(nombreMes(mesAnterior(k.ultimoMes.mes)))}` : ''}`
    : art.records.length ? `${recs.length} registros` : 'Todavía no hay datos';

  raiz.innerHTML = `
    <div class="resumen-art"><p class="ra-txt">${resumen}</p>
      <p class="frescura" data-r="frescura">${op.frescura ? `${op.frescura.cache ? '<strong>Mostrando los últimos datos guardados en este dispositivo.</strong> ' : ''}Actualizado ${esc(haceCuanto(op.frescura.ultimo || op.frescura.cargado))}` : ''}
      ${op.onActualizar ? '<button type="button" class="enlace" data-r="actualizar">Actualizar</button>' : ''}</p></div>
    <div class="barra-filtros" role="group" aria-label="Filtros del tablero">
      ${numericos.length > 1 ? `<label class="${pill(false)}"><span class="sr">Métrica</span><select data-r="metrica">${numericos.map((f) =>
        `<option value="${esc(f.key)}" ${f.key === clave ? 'selected' : ''}>${esc(f.label || f.key)}</option>`).join('')}</select></label>` : ''}
      <label class="${pill(periodo || rango)}"><span class="sr">Período</span><select data-r="periodo"><option value="">Todo el período</option>${meses.map((m) => `<option value="${m}" ${periodo === m ? 'selected' : ''}>${nombreMes(m)}</option>`).join('')}${rango ? '<option value="__rango" selected>Rango personalizado</option>' : ''}</select></label>
      <label class="${pill(est.comparar)}"><span class="sr">Comparar con</span><select data-r="comparar"><option value="">Sin comparar</option>${meses.map((m) => `<option value="${m}" ${est.comparar === m ? 'selected' : ''}>vs. ${nombreMes(m)}</option>`).join('')}</select></label>
      ${textos.length ? `<label class="${pill(est.filtro)}"><span class="sr">Filtro</span><select data-r="filtro"><option value="">${esc(cat?.label || textos[0].label || 'Filtro')}: todos</option>${textos.map((t) => `<optgroup label="${esc(t.label || t.key)}">${valoresCat(t.key).map((v) =>
        `<option value="${esc(t.key)}|${esc(v)}" ${est.filtro?.key === t.key && String(est.filtro.valor).toLowerCase() === String(v).toLowerCase() ? 'selected' : ''}>${esc(t.label || t.key)}: ${esc(v)}</option>`).join('')}</optgroup>`).join('')}</select></label>` : ''}
      <details class="mas-filtros"><summary class="pill">Más</summary><div class="mf-cuerpo">
        <label>Desde <select data-r="desde"><option value="">—</option>${meses.map((m) => `<option value="${m}" ${est.desde === m ? 'selected' : ''}>${nombreMes(m)}</option>`).join('')}</select></label>
        <label>Hasta <select data-r="hasta"><option value="">—</option>${meses.map((m) => `<option value="${m}" ${est.hasta === m ? 'selected' : ''}>${nombreMes(m)}</option>`).join('')}</select></label></div></details>
      ${est.desde || est.hasta || est.filtro || est.comparar ? '<button type="button" class="enlace" data-r="limpiar-todo">Limpiar</button>' : ''}
    </div>
    <div class="kpis">
      ${kpiBtn('total', `Total ${etiqueta}`, k ? fmt.format(k.total) : '—')}
      ${kpiBtn('ultimo', `Último mes${k?.ultimoMes ? ` (${nombreMes(k.ultimoMes.mes)})` : ''}`, k?.ultimoMes ? fmt.format(k.ultimoMes.total) : '—')}
      ${kpiBtn('variacion', 'Vs. mes anterior', varTxt)}
      ${kpiBtn('registros', 'Registros', String(recs.length))}
    </div>
    ${sel?.tipo === 'kpi' ? `<div class="inspector" role="group" aria-label="Opciones de ${esc(sel.etiqueta)}"><div class="insp-val"><span>${esc(sel.etiqueta)}</span><strong>${esc(kInfo[sel.id]?.[0] == null ? '—' : sel.id === 'variacion' ? varTxt : fmt.format(kInfo[sel.id][0]))}</strong></div>
      <div class="insp-acc"><button type="button" data-insp="explicar">Explicar</button><button type="button" data-insp="comparar">Comparar con el mes anterior</button>
      <button type="button" data-insp="evolucion">Ver evolución</button><button type="button" class="ask" data-insp="preguntar">✦ Preguntar</button>
      <button type="button" class="ib cerrar-insp" data-insp="cerrar" aria-label="Quitar selección" title="Quitar selección">✕</button></div></div>` : ''}
    ${sel && sel.tipo !== 'kpi' ? `<div class="sel-accion" role="group" aria-label="Selección"><span>${esc(sel.etiqueta)}</span><button type="button" class="ask" data-insp="preguntar">✦ Preguntar</button><button type="button" class="ib" data-insp="cerrar" aria-label="Quitar selección" title="Quitar selección">✕</button></div>` : ''}
    ${ins.length && !comp ? `<div class="insights">${ins.map((x) => `<div class="insight ${x.tono}"><strong>${esc(x.titulo)}</strong><p>${esc(x.texto)}</p></div>`).join('')}</div>` : ''}
    ${comp ? `<section class="tarjeta comparacion" aria-live="polite"><h3>${esc(nombreMes(compMes))} vs. ${esc(nombreMes(est.comparar))}</h3>
      <p>${esc(comp.texto)}</p>${comp.confianza.nivel !== 'confirmado' ? `<p class="confianza incompleta">Información incompleta: ${esc(comp.confianza.motivo)}</p>` : ''}
      <details><summary>Ver fuentes</summary><p class="vacio">Fuente: ${esc(art.name)} · ${esc(comp.evidencia.operacion)} · ${comp.evidencia.registros} registros${est.filtro ? ` · filtro ${esc(est.filtro.valor)}` : ''}.</p></details></section>` : ''}
    <figure class="tarjeta grafico-art" id="grafico-${esc(art.id)}"><figcaption>${esc(etiqueta)}${tipo === 'pie' && textos[0] ? ` por ${esc(textos[0].label || textos[0].key)}` : ' por mes'}</figcaption><div data-r="graf"></div>
      ${art.records.length ? (recs.length ? '' : '<p class="vacio">No hay datos con este período o filtro. <button type="button" class="enlace" data-r="limpiar">Quitar filtros</button></p>')
        : `<p class="vacio">Todavía no hay datos.${puedeCargar ? ' Cargá el primero, importá un archivo (también podés soltarlo acá) o pedíselo a Francisco ("registrá 1500").' : ''}</p>`}</figure>
    <details class="tarjeta" ${art.records.length <= 50 ? 'open' : ''}><summary>Detalle (${recs.length}${recs.length !== art.records.length ? ` de ${art.records.length}` : ''})</summary>
      <div class="tabla-scroll"><table><caption class="sr">Registros de ${esc(art.name)}</caption><thead><tr><th scope="col">Fecha</th>${art.fields.map((f) => `<th scope="col">${esc(f.label || f.key)}</th>`).join('')}</tr></thead>
      <tbody>${recs.slice().reverse().slice(0, 500).map((r) => `<tr tabindex="0" data-fila="${esc(r.id)}" class="${sel?.tipo === 'fila' && String(sel.recordId) === String(r.id) ? 'seleccionado' : ''}"><td>${esc(r.period)}</td>${art.fields.map((f) =>
        `<td class="${f.type === 'number' ? 'num' : ''}">${f.type === 'number' && r.data?.[f.key] != null ? fmt.format(r.data[f.key]) : esc(r.data?.[f.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </details>
    ${puedeCargar ? `<details class="tarjeta carga-det" ${art.records.length ? '' : 'open'}><summary>Cargar datos</summary><form class="carga" data-r="form">
      <label>Fecha <input type="date" name="__period" value="${new Date().toISOString().slice(0, 10)}" required></label>
      ${art.fields.map((f) => `<label>${esc(f.label || f.key)} <input name="${esc(f.key)}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" ${f.type === 'number' ? 'step="any"' : 'maxlength="2000"'}></label>`).join('')}
      <div class="acciones-form"><button type="submit">Guardar</button>${op.onImportar ? '<label class="boton-archivo">Importar archivo<input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json,.xml" data-r="csv" hidden></label>' : ''}</div>
      <span class="estado" data-r="estado" role="status"></span></form></details>` : ''}`;

  const g = raiz.querySelector('[data-r="graf"]');
  if (clave && recs.length) {
    g.append(tipo === 'pie' && textos[0] ? grafTorta(porCategoria(recs, clave, textos[0].key), `${etiqueta} por ${textos[0].label}`)
      : grafLinea(porMes(recs, clave), tipo, etiqueta, sel, seleccionar));
  }
  const on = (r, ev, f) => raiz.querySelector(`[data-r="${r}"]`)?.addEventListener(ev, f);
  on('metrica', 'change', (e) => { clave = e.target.value; op.onMetrica?.(clave); renderArtefacto(cont, { ...art, configuration: { ...conf, metrica: clave } }, op); });
  on('periodo', 'change', (e) => { if (e.target.value !== '__rango') cambiar({ desde: e.target.value || null, hasta: e.target.value || null }); });
  on('desde', 'change', (e) => cambiar({ desde: e.target.value || null }));
  on('hasta', 'change', (e) => cambiar({ hasta: e.target.value || null }));
  on('comparar', 'change', (e) => cambiar({ comparar: e.target.value || null }));
  on('filtro', 'change', (e) => {
    if (!e.target.value) return cambiar({ filtro: null });
    const [key, ...v] = e.target.value.split('|');
    cambiar({ filtro: { key, valor: v.join('|'), label: textos.find((t) => t.key === key)?.label } });
  });
  on('limpiar', 'click', () => cambiar({ desde: null, hasta: null, filtro: null, comparar: null }));
  on('limpiar-todo', 'click', () => cambiar({ desde: null, hasta: null, filtro: null, comparar: null }));
  on('actualizar', 'click', () => op.onActualizar?.());
  on('csv', 'change', (e) => { const f = e.target.files?.[0]; if (f) op.onImportar?.(f); e.target.value = ''; });

  raiz.querySelectorAll('[data-kpi]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.kpi;
    seleccionar({ tipo: 'kpi', id, campo: clave, valor: kInfo[id][0], mes: kInfo[id][1] || mesRef, etiqueta: b.querySelector('span').textContent });
  }));
  raiz.querySelectorAll('[data-insp]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.insp;
    if (a === 'cerrar') return op.onSeleccion?.(null);
    if (a === 'evolucion') { raiz.querySelector('.grafico-art')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); raiz.querySelector('.grafico-art')?.classList.add('resaltado'); setTimeout(() => raiz.querySelector('.grafico-art')?.classList.remove('resaltado'), 1600); return; }
    op.onAccion?.(a, sel);
  }));
  raiz.querySelectorAll('[data-fila]').forEach((tr) => {
    const go = () => {
      const r = recs.find((x) => String(x.id) === tr.dataset.fila);
      if (r) seleccionar({ tipo: 'fila', recordId: r.id, mes: mesDe(r.period), valor: r.data?.[clave], datos: r.data, etiqueta: `registro del ${r.period}` });
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  const form = raiz.querySelector('[data-r="form"]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form), data = {};
    for (const f of art.fields) {
      const v = String(fd.get(f.key) ?? '').trim();
      if (v === '') continue;
      data[f.key] = f.type === 'number' ? Number(v) : v;
    }
    const estado = raiz.querySelector('[data-r="estado"]');
    if (!Object.keys(data).length) { estado.textContent = 'Completá al menos un campo.'; return; }
    estado.textContent = 'Guardando…';
    form.querySelector('button[type="submit"]').disabled = true;
    try { await op.onAdd?.(String(fd.get('__period')), data); }
    catch (err) { estado.textContent = `No se pudo guardar: ${err.message || err}. Tus datos siguen en el formulario.`; form.querySelector('button[type="submit"]').disabled = false; }
  });
  return { mesPorDefecto: est.hasta || est.desde || meses.at(-1) || null, mesAnterior };
}
