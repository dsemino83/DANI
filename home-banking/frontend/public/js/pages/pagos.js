// Pagos en proceso: cómo avanza el motor de pagos. Las transferencias autorizadas quedan en cola y el
// motor las envía en orden de creación, en paralelo solo entre endpoints distintos. Lo ven los perfiles
// operativos (operador, autorizante, auditor); no el administrador de seguridad.
import { api } from '../api.js';
import { h, poner, card, kpi, tabla, dinero, fechaHora, estadoPill, cargando, error } from '../ui.js';

const ENDPOINT = { INMEDIATA: 'Inmediata', PROPIAS: 'Entre cuentas propias', TERCEROS: 'Terceros BdV', MEP: 'MEP' };

export async function render(main, ctx) {
  const cuerpo = h('div', {}, cargando());
  poner(main, h('div', { class: 'seccion' }, cuerpo));

  const dibujar = async () => {
    let d;
    try { d = await api('/pagos/cola'); } catch (e) { return error(e); }
    const aps = Object.keys(d.porEndpoint);
    const col = (titulo, filas, extra = []) => tabla([
      { t: 'OP', v: (t) => `OP-${t.id}`, cls: 'mono' },
      { t: 'Endpoint', v: (t) => ENDPOINT[t.tipo] ?? t.tipo },
      { t: 'Cuenta', v: (t) => t.cuenta_origen, cls: 'mono' },
      { t: 'Destino', v: (t) => t.titular ?? t.destino },
      { t: 'Importe', v: (t) => dinero(t.importe, t.moneda), cls: 'num' },
      { t: 'Cargada', v: (t) => fechaHora(t.creado_en), cls: 'mono' },
      { t: 'Autorizó', v: (t) => t.aprobador ?? '' },
      ...extra,
    ], filas, { vacio: titulo });

    poner(cuerpo,
      card('Pagos en proceso', 'Las transferencias autorizadas se envían al banco por este motor, en orden de creación; solo se paralelizan endpoints distintos.',
        h('div', { class: 'fila' },
          kpi('En cola', String(d.enCola.length)),
          kpi('Enviándose', String(d.enviando.length), 'warn'),
          ...aps.map((a) => kpi(ENDPOINT[tipoDeApi(a, d)] ?? a, `${d.porEndpoint[a].enCola} en cola · ${d.porEndpoint[a].enviando} enviando`))),
        h('div', { class: 'fila' }, h('button', { class: 'btn chico', onclick: () => dibujar().catch(error) }, '↻ Actualizar'),
          h('span', { class: 'nota' }, 'Se actualiza solo cada 3 segundos.'))),
      card('Enviándose ahora', null, col('No hay pagos enviándose en este momento.', d.enviando)),
      card('En cola (por orden de creación)', null, col('No hay pagos esperando en la cola.', d.enCola)),
      card('Resueltas en las últimas 24 horas', null, tabla([
        { t: 'OP', v: (t) => `OP-${t.id}`, cls: 'mono' },
        { t: 'Endpoint', v: (t) => ENDPOINT[t.tipo] ?? t.tipo },
        { t: 'Destino', v: (t) => t.titular ?? t.destino },
        { t: 'Importe', v: (t) => dinero(t.importe, t.moneda), cls: 'num' },
        { t: 'Estado', v: (t) => estadoPill(t.estado) },
        { t: 'transactionId', v: (t) => t.transaction_id ?? '', cls: 'mono' },
        { t: 'Actualizada', v: (t) => fechaHora(t.actualizado_en), cls: 'mono' },
      ], d.recientes, { vacio: 'Todavía no se resolvió ningún pago hoy.' })));
  };

  await dibujar();
  // Auto-refresco mientras la pantalla siga visible; se corta al navegar a otra sección.
  const raiz = main.firstChild;
  const timer = setInterval(() => { if (!document.contains(raiz)) return clearInterval(timer); dibujar().catch(() => {}); }, 3000);
}

// El resumen viene por api (nombre técnico del banco); para el título mostramos el tipo lindo si lo ubicamos.
function tipoDeApi(apiNombre, d) {
  const t = [...d.enCola, ...d.enviando].find((x) => x.api === apiNombre);
  return t?.tipo ?? apiNombre;
}
