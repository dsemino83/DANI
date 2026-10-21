// Ventana de auditoría por operación (ruedita ⚙): historial desde la carga hasta el último cambio de estado.
import { api } from './api.js';
import { h, modal, tabla, dinero, fechaHora, estadoPill, pill, error } from './ui.js';
import { ESTADOS } from './ui.js';

function contenido(r) {
  const t = r.transferencia;
  const pasos = [
    ...r.estados.map((e) => ({ en: e.en, usuario: e.usuario, accion: `Estado: ${ESTADOS[e.estado]?.[0] ?? e.estado}`, detalle: e.detalle ?? '', resultado: e.estado })),
    ...r.auditoria.map((a) => ({ en: a.en, usuario: a.usuario, rol: a.rol, accion: a.accion, detalle: a.detalle ?? '', resultado: a.resultado })),
  ].sort((a, b) => new Date(a.en) - new Date(b.en));
  return [
    h('p', { class: 'nota' }, r.base === 'historica' ? 'Operación en la base histórica (solo lectura).' : 'Operación en la base operativa.'),
    h('dl', { class: 'dl' },
      h('dt', {}, 'Tipo'), h('dd', {}, `${t.tipo} · API ${t.api}`),
      h('dt', {}, 'Cuenta origen'), h('dd', {}, t.cuenta_origen),
      h('dt', {}, 'Destino'), h('dd', {}, [t.titular, t.destino].filter(Boolean).join(' · ')),
      h('dt', {}, 'Importe'), h('dd', {}, dinero(t.importe, t.moneda)),
      h('dt', {}, 'Estado actual'), h('dd', {}, estadoPill(t.estado)),
      h('dt', {}, 'transactionId'), h('dd', {}, t.transaction_id ?? '—'),
      r.debito && [h('dt', {}, 'Débito'), h('dd', {}, `Movimiento ${r.debito.movimiento_id} · cuenta ${r.debito.cuenta}`)]),
    h('h2', {}, 'Historial de la operación'),
    tabla([
      { t: 'Fecha y hora', v: (p) => fechaHora(p.en), cls: 'mono' }, { t: 'Usuario', v: (p) => p.usuario }, { t: 'Rol', v: (p) => p.rol ?? '' },
      { t: 'Acción', v: (p) => p.accion }, { t: 'Detalle', v: (p) => p.detalle },
      { t: 'Resultado', v: (p) => (ESTADOS[p.resultado] ? estadoPill(p.resultado) : pill(p.resultado, p.resultado === 'OK' ? 'ok' : p.resultado === 'Error' ? 'bad' : '')) },
    ], pasos),
    h('p', { class: 'nota' }, 'Registro de solo inserción: nadie puede modificarlo ni borrarlo.'),
  ];
}

export async function auditoriaTransferencia(id) {
  try { modal(`Auditoría · OP-${id}`, ...contenido(await api(`/transferencias/${id}/auditoria`))); } catch (e) { error(e); }
}

export async function auditoriaDebito(movimientoId) {
  try {
    const r = await api(`/debitos/${encodeURIComponent(movimientoId)}/auditoria`);
    if (r.origen === 'externo') {
      modal(`Auditoría · débito ${movimientoId}`, h('p', {}, 'Este débito no se originó en el Home Banking (por ejemplo, una comisión o una operación de otro canal): no tiene carga ni aprobación en la app. Su origen se consulta en el banco.'));
    } else modal(`Auditoría · OP-${r.transferencia.id} · débito ${movimientoId}`, ...contenido(r));
  } catch (e) { error(e); }
}
