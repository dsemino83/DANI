// Buzón de mensajes del encabezado: avisos de operaciones cargadas que necesitan autorización (últimos 7 días).
// Un mensaje queda visto cuando su destinatario lo abre (solo ese: los demás siguen sin leer) o, solo, cuando la
// operación ya no espera autorización. "Aceptar" lleva a Aprobaciones. Cuando llega uno nuevo, alerta roja animada.
import { api } from './api.js';
import { h, poner, modal, pill, fechaHora, error } from './ui.js';

const ESTADOS = { PENDIENTE_APROBACION: ['Pendiente de autorización', 'warn'], ENVIANDO: ['Enviando', ''], ENVIADA: ['Enviada', 'ok'],
  ACREDITADA: ['Acreditada', 'ok'], RECHAZADA: ['Rechazada', 'bad'], ERROR: ['Error', 'bad'] };
const estadoPill = (e) => (e ? pill(...(ESTADOS[e] ?? [e])) : null);

export function buzon(ctx) {
  const destino = ctx.me.puedeAprobar ? 'aprobaciones' : 'transferencias'; // quien no aprueba ve la operación en el registro
  const contador = h('span', { class: 'buzon-n', hidden: true });
  const boton = h('button', { class: 'btn chico buzon', title: 'Mensajes', 'aria-label': 'Mensajes', onclick: () => abrirLista() }, '✉ Mensajes', contador);
  // Solo se abre solo un mensaje que llegó DESPUÉS del último que ya conocíamos (al entrar, el más nuevo sin leer):
  // los demás sin leer quedan así hasta que el usuario los abra.
  let conocido = null;
  const hayModal = () => !!document.querySelector('.modal-fondo'); // no interrumpe otro diálogo abierto

  // Con mensajes sin leer el botón queda rojo y latiendo; al llegar uno nuevo, además se sacude
  const pintar = (n) => { contador.hidden = !n; contador.textContent = n > 99 ? '99+' : String(n); boton.classList.toggle('con-nuevos', n > 0); };
  const sacudir = () => { boton.classList.remove('llego'); void boton.offsetWidth; boton.classList.add('llego'); };

  // Leer = marcar como visto (solo la primera vez queda registrada la hora)
  const leer = async (m) => { if (!m.visto_en) { await api(`/mensajes/${m.id}/visto`, { method: 'POST' }); m.visto_en = new Date().toISOString(); } };

  const abrirMensaje = async (m, alCerrar, nuevo = false) => {
    try { await leer(m); } catch (x) { error(x); }
    const listo = () => { alCerrar?.(); setTimeout(revisar, 0); };
    const cerrar = modal(m.titulo,
      h('p', { class: 'nota' }, `${fechaHora(m.creado_en)} · ${m.empresas.join(', ') || '—'}`, ' ', estadoPill(m.estado_operacion)),
      h('p', {}, m.texto),
      h('div', { class: 'fila' },
        h('button', { class: 'btn primario', onclick: () => { cerrar(); listo(); ctx.ir(destino); } }, 'Aceptar'),
        h('button', { class: 'btn', onclick: () => { cerrar(); listo(); } }, 'Cerrar')),
      h('p', { class: 'nota' }, ctx.me.puedeAprobar ? '"Aceptar" lleva a Aprobaciones.' : '"Aceptar" lleva al registro de Transferencias (no tenés el rol para aprobar).'));
    // Mensaje recién llegado: el diálogo entra con una franja roja animada
    if (nuevo) [...document.querySelectorAll('.modal')].at(-1)?.prepend(h('div', { class: 'alerta-nueva', role: 'alert' }, '● Nuevo mensaje · operación para autorizar'));
    [...document.querySelectorAll('.modal')].at(-1)?.classList.toggle('modal-alerta', nuevo);
  };

  const abrirLista = async () => {
    let lista;
    try { lista = await api('/mensajes'); } catch (x) { return error(x); }
    const cuerpo = h('div', {});
    const dibujar = () => poner(cuerpo, !lista.length ? h('p', { class: 'vacio' }, 'No tenés mensajes.')
      : h('ul', { class: 'buzon-lista' }, lista.map((m) => h('li', { class: m.visto_en ? 'visto' : 'nuevo' },
        h('button', { class: 'buzon-item', onclick: () => { cerrar(); abrirMensaje(m); } },
          h('span', { class: 'buzon-tit' }, !m.visto_en && pill('Sin leer', 'bad'), ' ', m.titulo),
          h('span', { class: 'nota' }, `${fechaHora(m.creado_en)} · ${m.empresas.join(', ')}`, ' ', estadoPill(m.estado_operacion),
            m.visto_motivo === 'operacion_resuelta' ? ' · se marcó como leído porque la operación ya no espera autorización' : ''))))));
    dibujar();
    const cerrar = modal(`Mensajes${lista.some((m) => !m.visto_en) ? ` · ${lista.filter((m) => !m.visto_en).length} sin leer` : ''}`, cuerpo,
      h('p', { class: 'nota' }, 'Últimos 7 días. Avisos de operaciones cargadas por otros usuarios en los clientes que tenés asociados. Un mensaje queda como leído al abrirlo (los demás siguen sin leer) o solo, cuando su operación ya fue autorizada o resuelta.'));
  };

  // Revisa si hay mensajes nuevos: actualiza el contador y, si llegó uno nuevo, lo muestra con la alerta
  const revisar = async () => {
    let r;
    try { r = await api('/mensajes/no-vistos'); } catch { return; } // sin red: se reintenta en la próxima vuelta
    pintar(r.noVistos);
    const nuevo = r.ultimo && (conocido == null || Number(r.ultimo) > Number(conocido));
    if (!r.noVistos || !nuevo || hayModal() || document.hidden) return;
    conocido = r.ultimo;
    const m = (await api('/mensajes').catch(() => [])).find((x) => String(x.id) === r.ultimo && !x.visto_en);
    if (m) { sacudir(); abrirMensaje(m, null, true); }
  };
  revisar();
  setInterval(revisar, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  return boton;
}
