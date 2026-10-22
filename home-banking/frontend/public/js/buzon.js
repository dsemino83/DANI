// Buzón de mensajes del encabezado: avisos de operaciones cargadas que necesitan autorización. Un mensaje queda
// visto cuando su destinatario lo abre; "Aceptar" lleva a Aprobaciones. Cuando llega uno nuevo se muestra solo.
import { api } from './api.js';
import { h, poner, modal, pill, fechaHora, error } from './ui.js';

const ESTADOS = { PENDIENTE_APROBACION: ['Pendiente de autorización', 'warn'], ENVIANDO: ['Enviando', ''], ENVIADA: ['Enviada', 'ok'],
  ACREDITADA: ['Acreditada', 'ok'], RECHAZADA: ['Rechazada', 'bad'], ERROR: ['Error', 'bad'] };
const estadoPill = (e) => (e ? pill(...(ESTADOS[e] ?? [e])) : null);

export function buzon(ctx) {
  const destino = ctx.me.puedeAprobar ? 'aprobaciones' : 'transferencias'; // quien no aprueba ve la operación en el registro
  const contador = h('span', { class: 'buzon-n', hidden: true });
  const boton = h('button', { class: 'btn chico buzon', title: 'Mensajes', 'aria-label': 'Mensajes', onclick: () => abrirLista() }, '✉ Mensajes', contador);
  let ultimoMostrado = null;
  const hayModal = () => !!document.querySelector('.modal-fondo'); // no interrumpe otro diálogo abierto

  const pintar = (n) => { contador.hidden = !n; contador.textContent = n > 99 ? '99+' : String(n); boton.classList.toggle('con-nuevos', n > 0); };

  // Leer = marcar como visto (solo la primera vez queda registrada la hora)
  const leer = async (m) => { if (!m.visto_en) { await api(`/mensajes/${m.id}/visto`, { method: 'POST' }); m.visto_en = new Date().toISOString(); } };

  const abrirMensaje = async (m, alCerrar) => {
    try { await leer(m); } catch (x) { error(x); }
    const listo = () => { alCerrar?.(); setTimeout(revisar, 0); };
    const cerrar = modal(m.titulo,
      h('p', { class: 'nota' }, `${fechaHora(m.creado_en)} · ${m.empresas.join(', ') || '—'}`, ' ', estadoPill(m.estado_operacion)),
      h('p', {}, m.texto),
      h('div', { class: 'fila' },
        h('button', { class: 'btn primario', onclick: () => { cerrar(); listo(); ctx.ir(destino); } }, 'Aceptar'),
        h('button', { class: 'btn', onclick: () => { cerrar(); listo(); } }, 'Cerrar')),
      h('p', { class: 'nota' }, ctx.me.puedeAprobar ? '"Aceptar" lleva a Aprobaciones.' : '"Aceptar" lleva al registro de Transferencias (no tenés el rol para aprobar).'));
  };

  const abrirLista = async () => {
    let lista;
    try { lista = await api('/mensajes'); } catch (x) { return error(x); }
    const cuerpo = h('div', {});
    const dibujar = () => poner(cuerpo, !lista.length ? h('p', { class: 'vacio' }, 'No tenés mensajes.')
      : h('ul', { class: 'buzon-lista' }, lista.map((m) => h('li', { class: m.visto_en ? 'visto' : 'nuevo' },
        h('button', { class: 'buzon-item', onclick: () => { cerrar(); abrirMensaje(m); } },
          h('span', { class: 'buzon-tit' }, !m.visto_en && pill('Nuevo', 'warn'), ' ', m.titulo),
          h('span', { class: 'nota' }, `${fechaHora(m.creado_en)} · ${m.empresas.join(', ')}`, ' ', estadoPill(m.estado_operacion)))))));
    dibujar();
    const cerrar = modal(`Mensajes${lista.some((m) => !m.visto_en) ? ` · ${lista.filter((m) => !m.visto_en).length} sin leer` : ''}`, cuerpo,
      h('p', { class: 'nota' }, 'Avisos de operaciones cargadas por otros usuarios en los clientes que tenés asociados. Un mensaje queda como visto al abrirlo.'));
  };

  // Revisa si hay mensajes nuevos: actualiza el contador y muestra solo el más reciente que no se mostró todavía
  const revisar = async () => {
    let r;
    try { r = await api('/mensajes/no-vistos'); } catch { return; } // sin red: se reintenta en la próxima vuelta
    pintar(r.noVistos);
    if (!r.noVistos || hayModal() || r.ultimo === ultimoMostrado || document.hidden) return;
    ultimoMostrado = r.ultimo;
    const m = (await api('/mensajes').catch(() => [])).find((x) => String(x.id) === r.ultimo && !x.visto_en);
    if (m) abrirMensaje(m);
  };
  revisar();
  setInterval(revisar, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  return boton;
}
