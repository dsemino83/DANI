// Consulta de CBU/CVU o alias en COELSA (getCustomerInformationCbu). Es una consulta: no requiere aprobación.
import { api } from '../api.js';
import { h, poner, card, error } from '../ui.js';

export async function consultarDestino(valor) {
  const v = valor.trim();
  return api('/cbu', { method: 'POST', body: /^\d{22}$/.test(v) ? { cbu: v } : { alias: v } });
}

export function fichaCbu(r) {
  return h('dl', { class: 'dl' },
    h('dt', {}, 'CBU'), h('dd', {}, r.cbu), h('dt', {}, 'Alias'), h('dd', {}, r.alias || '—'), h('dt', {}, 'Titular'), h('dd', {}, r.titular),
    h('dt', {}, 'CUIT'), h('dd', {}, r.cuit), h('dt', {}, 'Moneda'), h('dd', {}, r.moneda),
    h('dt', {}, 'Cuenta activa'), h('dd', { class: r.activa ? '' : 'neg' }, r.activa ? 'Sí' : 'No'),
    h('dt', {}, 'Titulares y firmantes'), h('dd', {}, (r.titulares ?? []).map((t) => `${t.name?.trim()} (${t.person_type}) ${t.cuit}`).join(' · ') || '—'));
}

export async function render(main) {
  const entrada = h('input', { placeholder: 'CBU de 22 dígitos o alias', 'aria-label': 'CBU o alias' });
  const salida = h('div', {});
  const consultar = async () => {
    if (!entrada.value.trim()) return;
    salida.replaceChildren();
    try { poner(salida, fichaCbu(await consultarDestino(entrada.value))); } catch (e) { error(e); }
  };
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') consultar(); });
  poner(main, card('Consulta de CBU/CVU o alias', 'getCustomerInformationCbu: titular, CUIT, moneda, estado y cotitulares registrados en COELSA. Recomendado antes de cada MEP.',
    h('div', { class: 'fila' }, entrada, h('button', { class: 'btn primario', onclick: consultar }, 'Consultar')), salida));
}
