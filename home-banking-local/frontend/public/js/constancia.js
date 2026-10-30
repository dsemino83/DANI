// Constancia de CBU ("Información de la cuenta") con los datos guardados al vincular la cuenta a la empresa.
// Se imprime o se guarda como PDF desde el diálogo de impresión del navegador.
import { api } from './api.js';
import { h, modal, toast, error, fechaHora, fecha } from './ui.js';

const cuitFormato = (c) => { const d = String(c ?? '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (c ?? ''); };
// DNI solo para personas humanas (CUIT 20/23/24/27): los 8 dígitos del medio
const dniDe = (c) => { const d = String(c ?? '').replace(/\D/g, ''); return d.length === 11 && ['20', '23', '24', '27'].includes(d.slice(0, 2)) ? String(Number(d.slice(2, 10))) : null; };

export async function mostrarConstancia(cuenta) {
  let d;
  try { d = await api(`/cuentas/${encodeURIComponent(cuenta.cuenta)}/constancia`); } catch (e) { return error(e); }
  const moneda = (d.moneda ?? cuenta.moneda) === 'USD' ? 'US$' : '$';
  const tipo = cuenta.producto ? `${cuenta.producto.charAt(0)}${cuenta.producto.slice(1).toLowerCase()} en ${moneda}` : `Cuenta en ${moneda}`;
  const esCC = /corriente/i.test(cuenta.producto ?? '');
  const fila = (k, v) => v && h('div', { class: 'const-fila' }, h('span', {}, k), h('b', {}, v));
  const doc = h('div', { class: 'constancia' },
    h('img', { class: 'const-logo', src: '/img/logo-valo.png', alt: 'VALO · Banco de Valores' }),
    h('p', { class: 'const-titulo' }, 'Información de la cuenta'),
    h('p', { class: 'const-etq' }, 'CBU'), h('p', { class: 'const-dato mono' }, d.cbu),
    d.alias && [h('p', { class: 'const-etq' }, 'Alias'), h('p', { class: 'const-dato' }, d.alias)],
    h('hr', { class: 'const-sep' }),
    fila('Titular de la cuenta', d.titular),
    fila('Número de documento', dniDe(d.cuit)),
    fila('CUIL/CUIT/CDI', cuitFormato(d.cuit)),
    fila('Tipo de cuenta', tipo),
    fila('Número de cuenta', d.cuenta),
    fila('Es Cuenta Corriente', esCC ? 'Sí' : 'No'),
    h('p', { class: 'const-pie' }, `Datos registrados al vincular la cuenta el ${fecha(d.vinculadaEn)} (COELSA). Emitida el ${fechaHora(new Date().toISOString())}.`));
  const imprimir = () => {
    document.body.classList.add('imprimiendo-constancia');
    addEventListener('afterprint', () => document.body.classList.remove('imprimiendo-constancia'), { once: true });
    print();
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(d.cbu); toast('CBU copiado.'); } catch { toast('No se pudo copiar: seleccioná el CBU y copialo a mano.', true); }
  };
  modal('Constancia de CBU', doc,
    h('div', { class: 'fila no-imprimir' },
      h('button', { class: 'btn primario', onclick: imprimir }, 'Imprimir / Guardar PDF'),
      h('button', { class: 'btn', onclick: copiar }, 'Copiar CBU')));
}
