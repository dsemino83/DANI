// Aprobaciones (rol Aprobar): aprobar envía al banco; nadie aprueba lo que cargó.
import { api } from '../api.js';
import { h, poner, card, tabla, seg, dinero, iso, haceDias, fechaHora, estadoPill, ESTADOS, engranaje, modal, confirmar, toast, error, cargando } from '../ui.js';
import { auditoriaTransferencia } from '../auditoria-modal.js';

export async function render(main, ctx) {
  let periodo = 'hoy', estadoF = '';
  const pendientes = h('div', {}, cargando()), aprobadas = h('div', {}, cargando());

  // Doble clic o dos pestañas: el backend igual garantiza un solo envío; acá se evita el intento.
  let enCurso = false;
  const decidir = async (ruta, texto, aprobar) => {
    if (enCurso) return;
    if (!(await confirmar(aprobar ? 'Aprobar y enviar al banco' : 'Rechazar', texto, aprobar ? 'Aprobar y enviar' : 'Rechazar'))) return;
    if (enCurso) return;
    enCurso = true;
    pendientes.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const r = await api(ruta, { method: 'POST' });
      if (r.resultados) toast(`Lote ${r.loteId} procesado: ${r.resultados.map((x) => `OP-${x.id} ${x.estado === 'YA_ENVIADA' ? 'ya enviada (no se reenvía)' : ESTADOS[x.estado]?.[0] ?? x.estado}`).join(' · ')}`);
      else toast(aprobar ? `OP-${r.id} enviada al banco · ${ESTADOS[r.estado]?.[0] ?? r.estado}${r.transactionId ? ` · transactionId ${r.transactionId}` : ''}` : `OP-${r.id} rechazada: no se envía al banco.`, r.estado === 'ERROR_API');
    } catch (e) { error(e); }
    enCurso = false;
    await Promise.all([cargarPendientes(), cargarAprobadas()]);
  };
  const acciones = (x, ruta, etiqueta) => (x.propia
    ? h('span', { class: 'bloqueado' }, 'La cargaste vos: no podés aprobarla.')
    : h('span', {},
      h('button', { class: 'btn primario chico', title: 'Aprobar y enviar al banco', onclick: () => decidir(`${ruta}/aprobar`, `${etiqueta}: se enviará al banco ahora.`, true) }, 'Aprobar'),
      h('button', { class: 'btn chico', title: 'Rechazar sin enviar', onclick: () => decidir(`${ruta}/rechazar`, `${etiqueta}: no se enviará al banco.`, false) }, 'Rechazar')));

  const cargarPendientes = async () => {
    const r = await api('/aprobaciones');
    poner(pendientes, 
      tabla([
        { t: 'OP', v: (t) => `OP-${t.id}`, cls: 'mono' }, { t: 'ID', v: (t) => t.referencia, cls: 'mono' }, { t: 'Cargada', v: (t) => fechaHora(t.creado_en), cls: 'mono' }, { t: 'Tipo', v: (t) => t.tipo }, { t: 'API', v: (t) => t.api, cls: 'mono' },
        { t: 'Destino', v: (t) => t.destino, cls: 'mono' }, { t: 'Titular', v: (t) => t.titular ?? '' }, { t: 'Importe', v: (t) => dinero(t.importe, t.moneda), cls: 'num' },
        { t: 'Cargó', v: (t) => t.creador },
        { t: 'Acción', cls: 'acc', v: (t) => h('span', {}, acciones(t, `/transferencias/${t.id}`, `OP-${t.id} · ${dinero(t.importe, t.moneda)}`),
          h('button', { class: 'btn chico', onclick: () => modal(`Request · OP-${t.id}`, h('p', { class: 'nota' }, `POST …/mobilebanking/transfers/${t.api}`), h('pre', {}, JSON.stringify(t.request, null, 2))) }, 'Ver request')) },
      ], r.transferencias, { vacio: 'No hay transferencias individuales pendientes.' }),
      h('h2', {}, 'Lotes pendientes'),
      tabla([
        { t: 'Lote', v: (l) => l.id, cls: 'mono' }, { t: 'Archivo', v: (l) => `${l.archivo} (${l.formato})` }, { t: 'Transferencias', v: (l) => l.validas, cls: 'num' },
        { t: 'Importe', v: (l) => dinero(l.importe), cls: 'num' }, { t: 'Cargó', v: (l) => l.creador }, { t: 'Cargado', v: (l) => fechaHora(l.creado_en), cls: 'mono' },
        { t: 'Acción', cls: 'acc', v: (l) => acciones(l, `/lotes/${l.id}`, `Lote ${l.id} · ${l.validas} transferencias`) },
      ], r.lotes, { vacio: 'No hay lotes pendientes.' }));
  };

  const cargarAprobadas = async () => {
    const desde = periodo === 'hoy' ? iso() : periodo === '7' ? haceDias(6) : ctx.me.corte;
    const r = await api(`/transferencias?desde=${desde}&hasta=${iso()}`);
    const lista = r.transferencias.filter((t) => t.aprobador && !['PENDIENTE_APROBACION', 'RECHAZADA'].includes(t.estado));
    const est = ['PEND_AUTORIZACION', 'DEBITADA', 'ENVIADA', 'ERROR_API', 'RECHAZADA_BANCO'];
    poner(aprobadas, 
      h('div', { class: 'fila' },
        seg([['hoy', 'Hoy'], ['7', 'Últimos 7 días'], ['todo', 'Últimos 3 meses']], periodo, (v) => { periodo = v; cargarAprobadas(); })),
      h('div', { class: 'chips' }, h('button', { class: 'chip', 'aria-pressed': String(!estadoF), onclick: () => { estadoF = ''; cargarAprobadas(); } }, 'Todas', h('b', {}, lista.length)),
        est.map((e) => [e, lista.filter((t) => t.estado === e).length]).filter(([, n]) => n).map(([e, n]) =>
          h('button', { class: 'chip', 'aria-pressed': String(estadoF === e), onclick: () => { estadoF = estadoF === e ? '' : e; cargarAprobadas(); } }, ESTADOS[e][0], h('b', {}, n)))),
      tabla([
        { t: 'OP', v: (t) => `OP-${t.id}`, cls: 'mono' }, { t: 'ID', v: (t) => t.referencia ?? '', cls: 'mono' }, { t: 'Aprobada', v: (t) => fechaHora(t.aprobado_en), cls: 'mono' }, { t: 'Tipo', v: (t) => t.tipo },
        { t: 'Destino', v: (t) => [t.titular, t.destino].filter(Boolean).join(' · ') }, { t: 'Importe', v: (t) => dinero(t.importe, t.moneda), cls: 'num' },
        { t: 'Cargó', v: (t) => t.creador }, { t: 'Aprobó', v: (t) => t.aprobador }, { t: 'Estado en el banco', v: (t) => estadoPill(t.estado) },
        { t: 'transactionId', v: (t) => t.transaction_id ?? '', cls: 'mono' }, { t: 'Auditoría', v: (t) => engranaje(`OP-${t.id}`, () => auditoriaTransferencia(t.id)), cls: 'c' },
      ], lista.filter((t) => !estadoF || t.estado === estadoF), { vacio: 'No hay transferencias aprobadas en este período.' }));
  };

  poner(main, 
    card('Aprobaciones pendientes', 'Aprobar envía la transferencia al banco por su API (immediates, transferBetweenOwnAccount, transferThirdPartyAccount o transferMep) y guarda el transactionId. Nadie puede aprobar lo que cargó.', pendientes),
    card('Estado de las transferencias aprobadas', 'Resultado en el banco: Pendiente de autorización (supera el límite que el banco permite sin autorización) o Debitada. Se actualiza automáticamente con getTransfersStatus.', aprobadas));
  await Promise.all([cargarPendientes().catch(error), cargarAprobadas().catch(error)]);
}
