// Registro de transferencias: base operativa (hoy / desde el corte) o base histórica, por separado.
import { api } from '../api.js';
import { h, poner, card, tabla, campo, seg, dinero, iso, fecha, fechaHora, estadoPill, ESTADOS, engranaje, cargando, error, toast } from '../ui.js';
import { auditoriaTransferencia } from '../auditoria-modal.js';

const diaAntes = (d) => iso(new Date(new Date(`${d}T12:00:00`).getTime() - 864e5));

export async function render(main, ctx) {
  const corte = ctx.me.corte, st = ctx.estado;
  st.tModo ??= 'hoy'; st.tDesde ??= corte; st.tHasta ??= iso();
  st.tArchHasta ??= diaAntes(corte); st.tArchDesde ??= iso(new Date(new Date(`${corte}T12:00:00`).getTime() - 180 * 864e5));
  let datos = null, estado = '', q = '';

  const dibujar = () => {
    const arch = st.tModo === 'arch';
    const d1 = h('input', { type: 'date', value: arch ? st.tArchDesde : st.tDesde, min: arch ? null : corte, max: arch ? diaAntes(corte) : iso() });
    const d2 = h('input', { type: 'date', value: arch ? st.tArchHasta : st.tHasta, min: arch ? null : corte, max: arch ? diaAntes(corte) : iso() });
    const filas = (datos ?? []).filter((t) => (!estado || t.estado === estado) && (!q || [t.id, t.referencia, t.destino, t.titular, t.creador, t.aprobador, t.tipo, t.transaction_id].join(' ').toLowerCase().includes(q)));
    const conteo = Object.keys(ESTADOS).map((e) => [e, (datos ?? []).filter((t) => t.estado === e).length]).filter(([e, n]) => n || e === estado);
    poner(main, card('Transferencias · registro histórico', 'Todo lo cargado, individual y por lote, con su estado, quién lo cargó y aprobó y la respuesta del banco. La consulta diaria usa la base operativa (mes en curso y el anterior); lo anterior se consulta aparte en la base histórica.',
      h('div', { class: 'fila' },
        campo('Período', seg([['hoy', 'Hoy'], ['hist', 'Base operativa'], ['arch', 'Base histórica']], st.tModo, (v) => { st.tModo = v; cargar(); })),
        st.tModo !== 'hoy' && [campo('Desde', d1), campo('Hasta', d2), h('button', { class: 'btn primario', onclick: () => {
          if (!d1.value || !d2.value || d1.value > d2.value) return toast('Ingresá un rango de fechas válido.', true);
          if (!arch && d1.value < corte) return toast(`La base operativa guarda desde el ${fecha(corte)}. Para fechas anteriores usá “Base histórica”.`, true);
          if (arch && d2.value >= corte) return toast(`La base histórica tiene lo anterior al ${fecha(corte)}.`, true);
          if (arch) { st.tArchDesde = d1.value; st.tArchHasta = d2.value; } else { st.tDesde = d1.value; st.tHasta = d2.value; }
          cargar();
        } }, 'Consultar')],
        campo('Buscar', h('input', { type: 'search', value: q, placeholder: 'OP, ID, destino, titular, usuario…', oninput: (e) => { q = e.target.value.toLowerCase(); dibujar(); } }))),
      h('p', { class: `aviso ${arch ? '' : 'rojo'}` }, h('b', {}, arch ? 'Base histórica · solo lectura. ' : 'Base operativa. '),
        arch ? `Operaciones anteriores al ${fecha(corte)}.` : `Base operativa: desde el ${fecha(corte)}; es la que usa la consulta diaria. El día 1 de cada mes lo más viejo pasa a la base histórica.`),
      datos ? [
        h('div', { class: 'chips' }, h('button', { class: 'chip', 'aria-pressed': String(!estado), onclick: () => { estado = ''; dibujar(); } }, 'Todas', h('b', {}, datos.length)),
          conteo.map(([e, n]) => h('button', { class: 'chip', 'aria-pressed': String(estado === e), onclick: () => { estado = estado === e ? '' : e; dibujar(); } }, ESTADOS[e][0], h('b', {}, n)))),
        tabla([
          { t: 'OP', v: (t) => `OP-${t.id}`, cls: 'mono' }, { t: 'ID', v: (t) => t.referencia ?? '', cls: 'mono' }, { t: 'Fecha', v: (t) => fechaHora(t.creado_en), cls: 'mono' }, { t: 'Tipo', v: (t) => t.tipo },
          { t: 'Cuenta origen', v: (t) => t.cuenta_origen, cls: 'mono' }, { t: 'Destino', v: (t) => t.destino, cls: 'mono' }, { t: 'Titular', v: (t) => t.titular ?? '' },
          { t: 'Importe', v: (t) => dinero(t.importe, t.moneda), cls: 'num' }, { t: 'Cargó', v: (t) => t.creador }, { t: 'Aprobó', v: (t) => t.aprobador ?? '' },
          { t: 'Estado', v: (t) => estadoPill(t.estado) }, { t: 'transactionId', v: (t) => t.transaction_id ?? '', cls: 'mono' },
          { t: 'Auditoría', v: (t) => engranaje(`OP-${t.id}`, () => auditoriaTransferencia(t.id)), cls: 'c' },
        ], filas, { vacio: 'No hay transferencias para este período y filtro.' }),
      ] : cargando()));
  };
  const cargar = async () => {
    datos = null; dibujar();
    try {
      if (st.tModo === 'arch') {
        const todas = [];
        let cursor = '';
        for (let p = 0; p < 20; p++) {
          const r = await api(`/historico/transferencias?desde=${st.tArchDesde}&hasta=${st.tArchHasta}${cursor}`);
          todas.push(...r.transferencias);
          if (!r.hayMas || !r.siguiente) break;
          cursor = `&cursor=${encodeURIComponent(r.siguiente)}`;
        }
        datos = todas;
      } else {
        const [d, hst] = st.tModo === 'hoy' ? [iso(), iso()] : [st.tDesde, st.tHasta];
        datos = (await api(`/transferencias?desde=${d}&hasta=${hst}`)).transferencias;
      }
    } catch (e) { error(e); datos = []; }
    dibujar();
  };
  await cargar();
}
