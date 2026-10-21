// Movimientos de una cuenta: hoy por defecto o histórico; el backend pagina de a 900 contra el banco.
import { api, descargar } from '../api.js';
import { h, poner, card, kpi, tabla, campo, seg, dinero, iso, haceDias, fecha, cargando, error, toast } from '../ui.js';

const PAGINA = 900;

export async function render(main, ctx) {
  poner(main, cargando());
  const cuentas = await api('/cuentas');
  const empresas = [...new Map(cuentas.map((c) => [c.empresa.id, c.empresa])).values()];
  const st = ctx.estado;
  st.movModo ??= 'hoy'; st.movDesde ??= haceDias(30); st.movHasta ??= iso();
  if (!cuentas.some((c) => c.cuenta === st.cuenta)) st.cuenta = cuentas[0]?.cuenta;
  let datos = null, pagina = 0, q = '';

  const dibujar = () => {
    const c = cuentas.find((x) => x.cuenta === st.cuenta);
    const desde = st.movModo === 'hoy' ? iso() : st.movDesde, hasta = st.movModo === 'hoy' ? iso() : st.movHasta;
    const selCli = h('select', { onchange: (e) => { st.cuenta = cuentas.find((x) => String(x.empresa.id) === e.target.value)?.cuenta; cargar(); } },
      empresas.map((e) => h('option', { value: e.id, selected: c?.empresa.id === e.id }, e.razonSocial)));
    const selCta = h('select', { onchange: (e) => { st.cuenta = e.target.value; cargar(); } },
      cuentas.filter((x) => x.empresa.id === c?.empresa.id).map((x) => h('option', { value: x.cuenta, selected: x.cuenta === st.cuenta }, `${x.alias} · ${x.cuenta} (${x.moneda})`)));
    const d1 = h('input', { type: 'date', value: st.movDesde, max: iso() }), d2 = h('input', { type: 'date', value: st.movHasta, max: iso() });
    const movs = (datos?.movimientos ?? []).filter((m) => !q || [m.description, m.beneficiary, m.documentNumber, m.transactionId].join(' ').toLowerCase().includes(q));
    const cred = movs.filter((m) => m.signDC === 'C').reduce((s, m) => s + Number(m.amount), 0), deb = movs.filter((m) => m.signDC === 'D').reduce((s, m) => s + Number(m.amount), 0);
    const paginas = Math.max(1, Math.ceil(movs.length / PAGINA));
    pagina = Math.min(pagina, paginas - 1);
    const vista = movs.slice(pagina * PAGINA, (pagina + 1) * PAGINA);
    poner(main, 
      h('div', { class: 'fila' },
        campo('Cliente', selCli), campo('Cuenta', selCta),
        campo('Período', seg([['hoy', 'Hoy'], ['hist', 'Histórico']], st.movModo, (v) => { st.movModo = v; cargar(); })),
        st.movModo === 'hist' && [campo('Desde', d1), campo('Hasta', d2), h('button', { class: 'btn primario', onclick: () => {
          if (!d1.value || !d2.value || d1.value > d2.value) return toast('Ingresá un rango de fechas válido.', true);
          st.movDesde = d1.value; st.movHasta = d2.value; cargar();
        } }, 'Consultar')],
        campo('Buscar', h('input', { type: 'search', value: q, placeholder: 'Descripción, beneficiario, CUIT…', oninput: (e) => { q = e.target.value.toLowerCase(); pagina = 0; dibujar(); } }))),
      h('p', { class: 'nota' }, `Período consultado: ${st.movModo === 'hoy' ? `hoy, ${fecha(desde)}` : `${fecha(desde)} al ${fecha(hasta)}`}.`),
      datos ? [
        h('div', { class: 'kpis' }, kpi('Créditos', dinero(cred, c?.moneda), 'pos'), kpi('Débitos', dinero(deb, c?.moneda), 'neg'), kpi('Cantidad de movimientos', movs.length)),
        card('Detalle de movimientos', 'getMovementsDetail: el backend pide de a 900 movimientos y pagina con sequential/uniqueSequential hasta recibir menos de 900. Orden descendente.',
          h('div', { class: 'fila' },
            h('button', { class: 'btn', disabled: !movs.length, onclick: () => descargar(`/cuentas/${st.cuenta}/movimientos?desde=${desde}&hasta=${hasta}&formato=xlsx`, `movimientos_${st.cuenta}_${desde}_${hasta}.xlsx`).catch(error) }, 'Exportar a Excel'),
            movs.length > 0 && h('span', { class: 'nota' }, `Mostrando ${pagina * PAGINA + 1}–${pagina * PAGINA + vista.length} de ${movs.length} · ${PAGINA} por página`),
            !datos.completo && h('span', { class: 'bloqueado' }, 'Se alcanzó el tope de páginas: acotá el período.')),
          tabla([
            { t: 'ID', v: (m) => m.transactionId, cls: 'mono' }, { t: 'Fecha', v: (m) => m.processDate, cls: 'mono' }, { t: 'Hora', v: (m) => m.hour, cls: 'mono' },
            { t: 'Descripción', v: (m) => m.description }, { t: 'Beneficiario', v: (m) => m.beneficiary }, { t: 'CUIT', v: (m) => m.documentNumber, cls: 'mono' },
            { t: 'D/C', v: (m) => m.signDC },
            { t: 'Importe', v: (m) => `${m.signDC === 'D' ? '−' : '+'}${dinero(m.amount, c?.moneda)}`, cls: 'num' },
            { t: 'Saldo', v: (m) => dinero(m.availableBalance, c?.moneda), cls: 'num' },
          ], vista, { vacio: 'Sin movimientos para la cuenta en este período.' }),
          paginas > 1 && h('div', { class: 'fila' },
            h('button', { class: 'btn chico', disabled: pagina === 0, onclick: () => { pagina--; dibujar(); } }, '← Anterior'),
            h('span', { class: 'nota' }, `Página ${pagina + 1} de ${paginas}`),
            h('button', { class: 'btn chico', disabled: pagina >= paginas - 1, onclick: () => { pagina++; dibujar(); } }, 'Siguiente →'))),
      ] : cargando(),
    );
  };

  const cargar = async () => {
    datos = null; pagina = 0;
    dibujar();
    if (!st.cuenta) return;
    const desde = st.movModo === 'hoy' ? iso() : st.movDesde, hasta = st.movModo === 'hoy' ? iso() : st.movHasta;
    try { datos = await api(`/cuentas/${st.cuenta}/movimientos?desde=${desde}&hasta=${hasta}`); } catch (e) { error(e); datos = { movimientos: [], completo: true }; }
    dibujar();
  };
  if (!cuentas.length) return poner(main, h('p', { class: 'vacio' }, 'No tenés cuentas habilitadas.'));
  await cargar();
}
