// SO · Generative UI: Intent → UISpecification → ComponentRegistry → Validation → Render.
// Francisco elige QUÉ mostrar (contenido, visualización, prioridad) entre componentes aprobados; el sistema define
// CÓMO (marca, espaciado, accesibilidad, interacción). Nunca se renderiza HTML arbitrario: cada spec se valida
// contra el registro (props permitidas, tipos, tamaños máximos) y el texto se escapa. Puro (salvo el render a texto).
import { esc } from './vista.js';
import { nombreMes } from './analisis.js';
import { icono } from './iconos.js';
import { sparkline, deltaTxt } from './workspace.js';

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v, max = 400) => (v == null ? null : String(v).slice(0, max));
const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

// Registro: cada componente declara sus props permitidas (con normalizador), si es responsive y su contrato de
// interacción. Lo que no está acá no se renderiza.
export const REGISTRO = {
  Metric: { props: { label: txt, valor: num, delta: num, detalle: txt }, requeridas: ['label', 'valor'], interaccion: 'ninguna' },
  Trend: { props: { label: txt, puntos: (v) => lista(v, 24).map((p) => ({ x: txt(p?.x, 20), y: num(p?.y) })).filter((p) => p.y != null) }, requeridas: ['puntos'], interaccion: 'ninguna' },
  Chart: { props: { titulo: txt, tipo: (v) => (['line', 'bar'].includes(v) ? v : 'bar'), puntos: (v) => lista(v, 36).map((p) => ({ x: txt(p?.x, 24), y: num(p?.y) })).filter((p) => p.y != null) }, requeridas: ['puntos'], interaccion: 'tooltip' },
  Table: { props: { titulo: txt, columnas: (v) => lista(v, 12).map((c) => txt(c, 60)), filas: (v) => lista(v, 50).map((f) => lista(f, 12).map((c) => (typeof c === 'number' ? c : txt(c, 120)))) }, requeridas: ['columnas', 'filas'], interaccion: 'scroll' },
  Comparison: { props: { titulo: txt, a: (v) => ({ label: txt(v?.label, 60), valor: num(v?.valor) }), b: (v) => ({ label: txt(v?.label, 60), valor: num(v?.valor) }),
    variacion: num, explicacion: txt, partes: (v) => lista(v, 8).map((p) => ({ nombre: txt(p?.nombre, 60), delta: num(p?.delta) })).filter((p) => p.delta != null) }, requeridas: ['a', 'b'], interaccion: 'ninguna' },
  Diff: { props: { titulo: txt, resumen: txt, agregadas: num, quitadas: num, cambiadas: num, columnas: (v) => lista(v, 8).map((c) => txt(c, 120)),
    cambios: (v) => lista(v, 40).map((c) => ({ clave: txt(c?.clave, 80), campo: txt(c?.campo, 60), antes: txt(c?.antes, 80), despues: txt(c?.despues, 80), tipo: ['agregada', 'quitada', 'cambiada'].includes(c?.tipo) ? c.tipo : 'cambiada' })),
    impacto: txt }, requeridas: ['resumen'], interaccion: 'expandir' },
  Timeline: { props: { items: (v) => lista(v, 20).map((i) => ({ fecha: txt(i?.fecha, 30), texto: txt(i?.texto, 200) })) }, requeridas: ['items'], interaccion: 'ninguna' },
  Insight: { props: { titulo: txt, texto: txt, tono: (v) => (['sube', 'baja', 'neutro'].includes(v) ? v : 'neutro') }, requeridas: ['texto'], interaccion: 'ninguna' },
  Filter: { props: { label: txt, valor: txt }, requeridas: ['label', 'valor'], interaccion: 'quitar' },
  File: { props: { fileId: (v) => (/^[0-9a-f-]{36}$/.test(String(v)) ? v : null), nombre: txt, tipo: txt, tamano: num, estado: txt, version: num, descripcion: txt }, requeridas: ['fileId', 'nombre'], interaccion: 'vista-previa-descarga' },
  Form: { props: { titulo: txt, campos: (v) => lista(v, 10).map((c) => ({ key: txt(c?.key, 40), label: txt(c?.label, 60), tipo: ['number', 'text', 'date'].includes(c?.tipo) ? c.tipo : 'text' })) }, requeridas: ['campos'], interaccion: 'enviar' },
  Action: { props: { label: txt, accion: (v) => (/^[a-z_]{2,30}$/.test(String(v)) ? v : null), datos: (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : {}) }, requeridas: ['label', 'accion'], interaccion: 'click' },
  ArtifactPreview: { props: { artifactId: (v) => (/^[0-9a-f-]{36}$/.test(String(v)) ? v : null), nombre: txt }, requeridas: ['artifactId'], interaccion: 'abrir' },
};

/** Valida y normaliza specs. Descarta componentes desconocidos o incompletos (nunca los "arregla" inventando datos). */
export function validar(specs) {
  const ok = [], errores = [];
  for (const s of lista(specs, 12)) {
    const def = REGISTRO[s?.type];
    if (!def) { errores.push(`componente no aprobado: ${s?.type}`); continue; }
    const p = {};
    for (const [k, norm] of Object.entries(def.props)) if (s.props?.[k] !== undefined) p[k] = norm(s.props[k]);
    const faltan = def.requeridas.filter((k) => p[k] == null || (Array.isArray(p[k]) && !p[k].length));
    if (faltan.length) { errores.push(`${s.type}: falta ${faltan.join(', ')}`); continue; }
    ok.push({ type: s.type, props: p });
  }
  return { specs: ok, errores };
}

function grafico(puntos, tipo, titulo) {
  const W = 320, H = 120, P = 18;
  const ys = puntos.map((p) => p.y), max = Math.max(0, ...ys), min = Math.min(0, ...ys), r = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, puntos.length - (tipo === 'bar' ? 0 : 1)) + (tipo === 'bar' ? (W - 2 * P) / puntos.length / 2 : 0);
  const y = (v) => H - P - ((v - min) / r) * (H - 2 * P);
  const etiq = `${titulo || 'Serie'}: ${puntos.map((p) => `${p.x} ${fmt.format(p.y)}`).join(', ')}`;
  let marcas;
  if (tipo === 'bar') {
    const w = Math.max(3, Math.min(28, (W - 2 * P) / puntos.length - 4));
    marcas = puntos.map((p, i) => `<rect x="${(x(i) - w / 2).toFixed(1)}" y="${Math.min(y(p.y), y(0)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, Math.abs(y(p.y) - y(0))).toFixed(1)}" rx="3"><title>${esc(p.x)}: ${fmt.format(p.y)}</title></rect>`).join('');
  } else {
    marcas = `<path d="${puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')}"/>` + puntos.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.5"><title>${esc(p.x)}: ${fmt.format(p.y)}</title></circle>`).join('');
  }
  return `<svg class="gu-graf ${tipo}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(etiq)}"><line x1="${P}" x2="${W - P}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="base"/>${marcas}
    <text x="${P}" y="${H - 3}" class="eje">${esc(puntos[0].x)}</text><text x="${W - P}" y="${H - 3}" text-anchor="end" class="eje">${esc(puntos.at(-1).x)}</text></svg>`;
}

const RENDER = {
  Metric: (p) => `<div class="gu-metric"><span>${esc(p.label)}</span><strong>${fmt.format(p.valor)}</strong>${p.delta != null ? `<em class="${p.delta >= 0 ? 'sube' : 'baja'}">${deltaTxt(p.delta)}</em>` : ''}${p.detalle ? `<small>${esc(p.detalle)}</small>` : ''}</div>`,
  Trend: (p) => `<div class="gu-trend">${p.label ? `<span>${esc(p.label)}</span>` : ''}${sparkline(p.puntos.map((x) => x.y), { w: 200, h: 40 })}</div>`,
  Chart: (p) => `<figure class="gu-chart">${p.titulo ? `<figcaption>${esc(p.titulo)}</figcaption>` : ''}${grafico(p.puntos, p.tipo, p.titulo)}</figure>`,
  Table: (p) => `<div class="gu-tabla tabla-scroll">${p.titulo ? `<p class="gu-tit">${esc(p.titulo)}</p>` : ''}<table><thead><tr>${p.columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${p.filas.map((f) => `<tr>${f.map((c) => `<td class="${typeof c === 'number' ? 'num' : ''}">${typeof c === 'number' ? fmt.format(c) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
  Comparison: (p) => {
    const mx = Math.max(Math.abs(p.a.valor || 0), Math.abs(p.b.valor || 0), 1);
    const barra = (s, cl) => `<div class="gu-cmp-fila"><span>${esc(s.label)}</span><span class="gu-cmp-barra ${cl}" style="--w:${Math.round((Math.abs(s.valor || 0) / mx) * 100)}%"><i></i></span><strong>${s.valor != null ? fmt.format(s.valor) : '—'}</strong></div>`;
    return `<div class="gu-cmp">${p.titulo ? `<p class="gu-tit">${esc(p.titulo)}${p.variacion != null ? ` <em class="${p.variacion >= 0 ? 'sube' : 'baja'}">${deltaTxt(p.variacion)}</em>` : ''}</p>` : ''}
      ${barra(p.a, 'a')}${barra(p.b, 'b')}${p.explicacion ? `<p class="gu-exp">${esc(p.explicacion)}</p>` : ''}
      ${p.partes?.length ? `<ul class="gu-partes">${p.partes.map((x) => `<li><span>${esc(x.nombre)}</span><em class="${x.delta >= 0 ? 'sube' : 'baja'}">${x.delta >= 0 ? '+' : '−'}${fmt.format(Math.abs(x.delta))}</em></li>`).join('')}</ul>` : ''}</div>`;
  },
  Diff: (p) => `<div class="gu-diff">${p.titulo ? `<p class="gu-tit">${esc(p.titulo)}</p>` : ''}<p>${esc(p.resumen)}</p>
    <div class="gu-diff-n"><span class="mas">+${p.agregadas ?? 0} agregadas</span><span class="menos">−${p.quitadas ?? 0} quitadas</span><span class="cambio">~${p.cambiadas ?? 0} cambiadas</span></div>
    ${p.impacto ? `<p class="gu-exp">${esc(p.impacto)}</p>` : ''}${p.columnas?.length ? `<p class="vacio">${p.columnas.map(esc).join(' · ')}</p>` : ''}
    ${p.cambios?.length ? `<details class="gu-diff-det"><summary>Ver cambios</summary><div class="tabla-scroll"><table><thead><tr><th>Fila</th><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${p.cambios.map((c) => `<tr class="${c.tipo}"><td>${esc(c.clave)}</td><td>${esc(c.campo || (c.tipo === 'agregada' ? '(nueva)' : c.tipo === 'quitada' ? '(quitada)' : ''))}</td><td>${esc(c.antes ?? '')}</td><td>${esc(c.despues ?? '')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</div>`,
  Timeline: (p) => `<ol class="gu-timeline">${p.items.map((i) => `<li><time>${esc(i.fecha)}</time><span>${esc(i.texto)}</span></li>`).join('')}</ol>`,
  Insight: (p) => `<div class="gu-insight ${p.tono}">${icono('chispa', { tam: 16 })}<div>${p.titulo ? `<strong>${esc(p.titulo)}</strong>` : ''}<p>${esc(p.texto)}</p></div></div>`,
  Filter: (p) => `<span class="chip">${esc(p.label)}: ${esc(p.valor)}</span>`,
  File: (p) => `<div class="gu-file" data-file="${esc(p.fileId)}"><span class="gf-ic">${icono(/xlsx|csv|json|xml|ods|tsv/.test(p.tipo || '') ? 'tabla' : /pptx/.test(p.tipo || '') ? 'pres' : /png|jpe?g|webp|gif/.test(p.tipo || '') ? 'imagen' : 'doc', { tam: 22 })}</span>
    <div class="gf-txt"><strong>${esc(p.nombre)}</strong><small>${esc((p.tipo || '').toUpperCase())}${p.tamano != null ? ` · ${tamano(p.tamano)}` : ''}${p.version > 1 ? ` · v${p.version}` : ''}${p.estado ? ` · ${esc(p.estado)}` : ''}</small>${p.descripcion ? `<small>${esc(p.descripcion)}</small>` : ''}</div>
    <div class="gf-acc"><button type="button" data-gf="ver">${icono('ojo', { tam: 16 })} Vista previa</button><button type="button" class="primario" data-gf="bajar">${icono('bajar', { tam: 16 })} Descargar</button>
      <button type="button" class="ib" data-gf="mas" aria-label="Más acciones de ${esc(p.nombre)}" title="Más acciones">${icono('mas', { tam: 16 })}</button></div></div>`,
  Form: (p) => `<form class="gu-form">${p.titulo ? `<p class="gu-tit">${esc(p.titulo)}</p>` : ''}${p.campos.map((c) => `<label>${esc(c.label)} <input name="${esc(c.key)}" type="${c.tipo}"></label>`).join('')}<button type="submit">Enviar</button></form>`,
  Action: (p) => `<button type="button" class="gu-action" data-gu-accion="${esc(p.accion)}" data-gu-datos="${esc(JSON.stringify(p.datos))}">${esc(p.label)}</button>`,
  ArtifactPreview: (p) => `<a class="gu-art boton" href="#/a/${esc(p.artifactId)}">${icono('chart', { tam: 16 })} ${esc(p.nombre || 'Abrir')}</a>`,
};

export function tamano(b) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${fmt.format(Math.round(b / 102.4) / 10)} KB` : `${fmt.format(Math.round(b / 104857.6) / 10)} MB`;
}

/** Render de specs ya validadas (o las valida acá si vienen crudas). */
export function renderUI(specs) {
  const { specs: ok } = validar(specs);
  return ok.length ? `<div class="gu">${ok.map((s) => RENDER[s.type](s.props)).join('')}</div>` : '';
}

// Specs a partir de resultados deterministas de análisis (comparar / analizar): la misma evidencia que el texto.
export function specsComparacion(c, campo, cat) {
  const lbl = campo.label || campo.key;
  return [
    { type: 'Comparison', props: { titulo: `${lbl}: ${nombreMes(c.a.mes)} vs. ${nombreMes(c.b.mes)}`, a: { label: nombreMes(c.a.mes), valor: c.a.total }, b: { label: nombreMes(c.b.mes), valor: c.b.total },
      variacion: c.variacion, explicacion: c.aportes?.length && cat ? `Mayor cambio: ${cat.label || cat.key} "${c.aportes[0].categoria}".` : null,
      partes: (c.aportes || []).map((x) => ({ nombre: x.categoria, delta: x.delta })) } },
  ];
}
