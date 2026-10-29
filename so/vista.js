// SO · render de un WorkArtifact (dashboard): KPIs, gráfico, carga de datos e historial.
// Lo usan el workspace del dueño (app.js) y la ruta compartida (shared/), con la misma vista y distintos permisos.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

export function mesDe(fecha) { return String(fecha).slice(0, 7); }

// Agrega por mes la suma de un campo numérico. Pura (se prueba en node).
export function porMes(records, key) {
  const m = new Map();
  for (const r of records) {
    const v = Number(r.data?.[key]);
    if (!Number.isFinite(v)) continue;
    const k = mesDe(r.period);
    m.set(k, (m.get(k) || 0) + v);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, total]) => ({ mes, total }));
}

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

export function kpis(records, key) {
  const vals = records.map((r) => Number(r.data?.[key])).filter(Number.isFinite);
  const meses = porMes(records, key);
  const ult = meses.at(-1), ant = meses.at(-2);
  const variacion = ult && ant && ant.total !== 0 ? (ult.total - ant.total) / Math.abs(ant.total) : null;
  return { total: vals.reduce((s, v) => s + v, 0), registros: vals.length, ultimoMes: ult || null, variacion };
}

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, hijos = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const h of hijos) e.append(h);
  return e;
}
function titulo(txt) { const t = el('title'); t.textContent = txt; return t; }

function grafLinea(serie, tipo, etiqueta) {
  const W = 640, H = 240, P = { t: 16, r: 16, b: 28, l: 56 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${etiqueta} por mes`, class: 'grafico' });
  if (!serie.length) return svg;
  const max = Math.max(0, ...serie.map((p) => p.total)), min = Math.min(0, ...serie.map((p) => p.total));
  const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - min) / ((max - min) || 1));
  const paso = (W - P.l - P.r) / Math.max(1, serie.length - (tipo === 'bar' ? 0 : 1));
  const x = (i) => P.l + (tipo === 'bar' ? paso * i + paso / 2 : paso * i);
  for (const v of [min, (min + max) / 2, max]) {
    svg.append(el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grilla' }));
    const t = el('text', { x: P.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'eje' }); t.textContent = fmt.format(v); svg.append(t);
  }
  const cada = Math.ceil(serie.length / 8);
  serie.forEach((p, i) => {
    if (i % cada === 0 || i === serie.length - 1) {
      const t = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'eje' }); t.textContent = p.mes; svg.append(t);
    }
  });
  if (tipo === 'bar') {
    const ancho = Math.max(4, Math.min(48, paso - 2));
    serie.forEach((p, i) => {
      const y0 = y(Math.max(0, p.total)), alto = Math.max(1, Math.abs(y(p.total) - y(0)));
      svg.append(el('rect', { x: x(i) - ancho / 2, y: y0, width: ancho, height: alto, rx: 4, class: 'barra', tabindex: 0 },
        [titulo(`${p.mes}: ${fmt.format(p.total)}`)]));
    });
  } else {
    svg.append(el('polyline', { points: serie.map((p, i) => `${x(i)},${y(p.total)}`).join(' '), class: 'linea' }));
    serie.forEach((p, i) => svg.append(el('circle', { cx: x(i), cy: y(p.total), r: 4, class: 'punto', tabindex: 0 },
      [titulo(`${p.mes}: ${fmt.format(p.total)}`)])));
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

/**
 * @param {HTMLElement} cont
 * @param {{ name: string, version?: number, fields: any[], records: any[], configuration?: any, permission: string }} art
 * @param {{ onAdd?: (period: string, data: object) => Promise<void> }} acciones
 */
export function renderArtefacto(cont, art, acciones = {}) {
  const numericos = art.fields.filter((f) => f.type === 'number');
  const textos = art.fields.filter((f) => f.type === 'text');
  const conf = art.configuration || {};
  let clave = conf.metrica && numericos.some((f) => f.key === conf.metrica) ? conf.metrica : numericos[0]?.key;
  const tipo = conf.grafico || 'line';
  const puedeCargar = ['OWNER', 'EDIT', 'USE'].includes(art.permission);

  cont.innerHTML = '';
  const raiz = document.createElement('div');
  raiz.className = 'viz-root artefacto';
  cont.append(raiz);

  function pintar() {
    const etiqueta = numericos.find((f) => f.key === clave)?.label || clave || '';
    const k = clave ? kpis(art.records, clave) : null;
    const varTxt = k?.variacion == null ? '—' : `${k.variacion >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(k.variacion * 100))}%`;
    raiz.innerHTML = `
      ${numericos.length > 1 ? `<label class="selector">Métrica <select data-r="metrica">${numericos.map((f) =>
        `<option value="${esc(f.key)}" ${f.key === clave ? 'selected' : ''}>${esc(f.label || f.key)}</option>`).join('')}</select></label>` : ''}
      <div class="kpis">
        <div class="kpi"><span>Total ${esc(etiqueta)}</span><strong>${k ? fmt.format(k.total) : '—'}</strong></div>
        <div class="kpi"><span>Último mes${k?.ultimoMes ? ` (${esc(k.ultimoMes.mes)})` : ''}</span><strong>${k?.ultimoMes ? fmt.format(k.ultimoMes.total) : '—'}</strong></div>
        <div class="kpi"><span>Vs. mes anterior</span><strong>${varTxt}</strong></div>
        <div class="kpi"><span>Registros</span><strong>${art.records.length}</strong></div>
      </div>
      <figure class="tarjeta"><figcaption>${esc(etiqueta)}${tipo === 'pie' && textos[0] ? ` por ${esc(textos[0].label || textos[0].key)}` : ' por mes'}</figcaption><div data-r="graf"></div>
        ${art.records.length ? '' : '<p class="vacio">Todavía no hay datos. Cargá el primero abajo o pedíselo a Francisco ("registrá 1500 en ventas").</p>'}</figure>
      ${puedeCargar ? `<form class="tarjeta carga" data-r="form"><h3>Cargar dato</h3>
        <label>Fecha <input type="date" name="__period" value="${new Date().toISOString().slice(0, 10)}" required></label>
        ${art.fields.map((f) => `<label>${esc(f.label || f.key)} <input name="${esc(f.key)}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" ${f.type === 'number' ? 'step="any"' : 'maxlength="2000"'}></label>`).join('')}
        <button type="submit">Guardar</button><span class="estado" data-r="estado" role="status"></span></form>` : ''}
      <details class="tarjeta" open><summary>Historial (${art.records.length})</summary>
        <div class="tabla-scroll"><table><thead><tr><th>Fecha</th>${art.fields.map((f) => `<th>${esc(f.label || f.key)}</th>`).join('')}</tr></thead>
        <tbody>${art.records.slice().reverse().slice(0, 500).map((r) => `<tr><td>${esc(r.period)}</td>${art.fields.map((f) =>
          `<td class="${f.type === 'number' ? 'num' : ''}">${f.type === 'number' && r.data?.[f.key] != null ? fmt.format(r.data[f.key]) : esc(r.data?.[f.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      </details>`;
    const g = raiz.querySelector('[data-r="graf"]');
    if (clave && art.records.length) {
      g.append(tipo === 'pie' && textos[0] ? grafTorta(porCategoria(art.records, clave, textos[0].key), `${etiqueta} por ${textos[0].label}`)
        : grafLinea(porMes(art.records, clave), tipo, etiqueta));
    }
    raiz.querySelector('[data-r="metrica"]')?.addEventListener('change', (e) => { clave = e.target.value; pintar(); });
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
      try { await acciones.onAdd?.(String(fd.get('__period')), data); }
      catch (err) { estado.textContent = `No se pudo guardar: ${err.message || err}`; }
    });
  }
  pintar();
}
