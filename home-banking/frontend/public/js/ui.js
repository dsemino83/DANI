// Utilidades de interfaz: construcción de elementos (sin innerHTML con datos), formatos, tablas, toast y modal.
export const $ = (s, r = document) => r.querySelector(s);

// h('div', {class:'x', onclick: fn}, 'texto', otroNodo, [lista]) — todo texto entra como textContent
export function h(tag, attrs = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

// poner(el, ...hijos): reemplaza el contenido de el con las mismas reglas que h() (aplana listas, ignora false/null).
// Búsqueda "contiene" sin distinguir mayúsculas ni acentos: true si algún campo incluye el texto.
const plano = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const contiene = (texto, ...campos) => !String(texto ?? '').trim() || campos.flat().some((c) => plano(c).includes(plano(texto).trim()));

// Redibuja sin perder el foco ni el cursor del campo que se está escribiendo (marcado con data-foco).
export function sinPerderFoco(fn) {
  const a = document.activeElement, clave = a?.dataset?.foco, pos = a?.selectionStart;
  const r = fn();
  if (clave) {
    const n = document.querySelector(`[data-foco="${clave}"]`);
    if (n) { n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
  }
  return r;
}

export const poner = (el, ...hijos) => el.replaceChildren(...h('div', {}, ...hijos).childNodes);

const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dinero = (v, moneda = 'ARS') => `${moneda === 'USD' || moneda === 'DOLARES' ? 'US$ ' : '$ '}${nf.format(Number(v) || 0)}`;
export const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const haceDias = (n) => iso(new Date(Date.now() - n * 864e5));
export const fecha = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
export const fechaHora = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return `${iso(d).split('-').reverse().join('/')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

let toastT = null;
export function toast(msg, mal = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast${mal ? ' mal' : ''}`, role: 'status', 'aria-live': 'polite' }, msg);
  document.body.append(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), 7000);
}
export const error = (e) => toast(e?.message ?? String(e), true);

export function modal(titulo, ...contenido) {
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') cerrar(); };
  const fondo = h('div', { class: 'modal-fondo', onclick: (e) => { if (e.target === fondo) cerrar(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('div', { class: 'modal-cab' }, h('h2', {}, titulo), h('button', { class: 'btn chico', onclick: cerrar }, '✕ Cerrar')), ...contenido));
  document.addEventListener('keydown', esc);
  document.body.append(fondo);
  fondo.querySelector('button').focus();
  return cerrar;
}

export function confirmar(titulo, texto, accion = 'Confirmar') {
  return new Promise((ok) => {
    const cerrar = modal(titulo, h('p', {}, texto), h('div', { class: 'fila' },
      h('button', { class: 'btn primario', onclick: () => { cerrar(); ok(true); } }, accion),
      h('button', { class: 'btn', onclick: () => { cerrar(); ok(false); } }, 'Cancelar')));
  });
}

export const card = (titulo, nota, ...hijos) => h('section', { class: 'card' }, titulo && h('h2', {}, titulo), nota && h('p', { class: 'nota' }, nota), ...hijos);
export const kpi = (etiqueta, valor, cls = '') => h('div', { class: 'card' }, h('div', { class: 'kpi-label' }, etiqueta), h('div', { class: `kpi-val ${cls}` }, valor));
export const campo = (etiqueta, control, cls = '') => h('label', { class: `campo ${cls}` }, etiqueta, control);
export const pill = (texto, tipo = '') => h('span', { class: `pill ${tipo}` }, texto);

// Selector segmentado: seg([['hoy','Hoy'],['hist','Histórico']], valor, cambio)
export function seg(opciones, valor, cambio) {
  return h('div', { class: 'seg', role: 'group' }, opciones.map(([v, t]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === valor), onclick: () => cambio(v) }, t)));
}

// tabla(columnas, filas, {alClic, sel}) — columna: {t:'Título', v: fila => valor|Node, cls}
export function tabla(cols, filas, { alClic, sel, vacio = 'Sin datos para mostrar.' } = {}) {
  if (!filas.length) return h('p', { class: 'vacio' }, vacio);
  return h('div', { class: 'tabla' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.cls ?? '' }, c.t)))),
    h('tbody', {}, filas.map((f) => h('tr', { class: `${alClic ? 'clic' : ''} ${sel?.(f) ? 'sel' : ''}`, onclick: alClic && (() => alClic(f)) },
      cols.map((c) => h('td', { class: c.cls ?? '' }, c.v(f))))))));
}

export const ESTADOS = {
  PENDIENTE_APROBACION: ['Pendiente de aprobación', 'warn'], RECHAZADA: ['Rechazada', 'bad'], ENVIANDO: ['Enviando', 'warn'],
  ENVIADA: ['Enviada', 'warn'], PEND_AUTORIZACION: ['Pendiente de autorización', 'warn'], DEBITADA: ['Debitada', 'ok'],
  RECHAZADA_BANCO: ['Rechazada por el banco', 'bad'], ERROR_API: ['Error API', 'bad'],
};
export const estadoPill = (e) => pill(...(ESTADOS[e] ?? [e, '']));

export const engranaje = (etiqueta, accion) => h('button', { class: 'engranaje', title: `Ver auditoría de ${etiqueta}`, 'aria-label': `Ver auditoría de ${etiqueta}`, onclick: (e) => { e.stopPropagation(); accion(); } }, '⚙');

export const cargando = () => h('p', { class: 'vacio' }, 'Cargando…');
