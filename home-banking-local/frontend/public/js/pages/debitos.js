// Débitos realizados de todas las cuentas visibles, con auditoría por débito (⚙) y exportación.
import { api, descargar } from '../api.js';
import { h, poner, card, kpi, tabla, campo, seg, dinero, iso, haceDias, fecha, engranaje, cargando, error, toast } from '../ui.js';
import { auditoriaDebito } from '../auditoria-modal.js';

export async function render(main, ctx) {
  poner(main, cargando());
  const cuentas = await api('/cuentas');
  const empresas = [...new Map(cuentas.map((c) => [c.empresa.id, c.empresa])).values()];
  const st = ctx.estado;
  st.debModo ??= 'hoy'; st.debDesde ??= haceDias(30); st.debHasta ??= iso();
  let cli = st.cliDebitos ?? '', cta = st.debCuenta ?? '', mon = st.debMoneda ?? '', q = '', datos = null, fallo = null;

  const rango = () => (st.debModo === 'hoy' ? [iso(), iso()] : [st.debDesde, st.debHasta]);
  const dibujar = () => {
    const [desde, hasta] = rango();
    const d1 = h('input', { type: 'date', value: st.debDesde, max: iso() }), d2 = h('input', { type: 'date', value: st.debHasta, max: iso() });
    // Los totales por moneda ignoran el filtro de moneda (así siempre se ven los dos); la tabla sí lo aplica
    const sinMoneda = (datos ?? []).filter((d) => (!cta || d.cuenta === cta) && (!q || [d.beneficiario, d.cuit, d.descripcion, d.id].join(' ').toLowerCase().includes(q)));
    const filas = sinMoneda.filter((d) => !mon || d.moneda === mon);
    const tot = (m) => -sinMoneda.filter((d) => d.moneda === m).reduce((s, d) => s + d.importe, 0);
    const elegirMoneda = (m) => { mon = mon === m ? '' : m; st.debMoneda = mon; dibujar(); }; // tocar de nuevo = todas
    const kpiMoneda = (m, etiqueta) => h('button', { type: 'button', class: 'card kpi-btn', 'aria-pressed': String(mon === m),
      title: mon === m ? 'Ver todas las monedas' : `Ver solo los débitos en ${m === 'ARS' ? 'pesos' : 'dólares'}`, onclick: () => elegirMoneda(m) },
      h('div', { class: 'kpi-label' }, etiqueta), h('div', { class: 'kpi-val neg' }, m === 'ARS' ? dinero(tot('ARS')) : dinero(tot('USD'), 'USD')));
    poner(main, 
      h('div', { class: 'fila' },
        campo('Período', seg([['hoy', 'Hoy'], ['hist', 'Histórico']], st.debModo, (v) => { st.debModo = v; cargar(); })),
        st.debModo === 'hist' && [campo('Desde', d1), campo('Hasta', d2), h('button', { class: 'btn primario', onclick: () => {
          if (!d1.value || !d2.value || d1.value > d2.value) return toast('Ingresá un rango de fechas válido.', true);
          st.debDesde = d1.value; st.debHasta = d2.value; cargar();
        } }, 'Consultar')],
        campo('Cliente', h('select', { onchange: (e) => { cli = e.target.value; st.cliDebitos = cli; cta = ''; st.debCuenta = ''; cargar(); } },
          h('option', { value: '' }, 'Todos los clientes'), empresas.map((e) => h('option', { value: e.id, selected: String(e.id) === String(cli) }, e.razonSocial)))),
        campo('Buscar', h('input', { type: 'search', value: q, placeholder: 'Beneficiario, CUIT, descripción…', oninput: (e) => { q = e.target.value.toLowerCase(); dibujar(); } }))),
      h('p', { class: 'nota' }, `Período: ${st.debModo === 'hoy' ? `hoy, ${fecha(desde)}` : `${fecha(desde)} al ${fecha(hasta)}`}.`),
      (cta || mon) && h('div', { class: 'fila' },
        cta && h('span', { class: 'chip' }, `Cuenta ${cta}`,
          h('button', { class: 'chip-x', title: 'Ver todas las cuentas', 'aria-label': 'Quitar filtro de cuenta', onclick: () => { cta = ''; st.debCuenta = ''; dibujar(); } }, '✕')),
        mon && h('span', { class: 'chip' }, mon === 'ARS' ? 'Solo pesos' : 'Solo dólares',
          h('button', { class: 'chip-x', title: 'Ver todas las monedas', 'aria-label': 'Quitar filtro de moneda', onclick: () => elegirMoneda(mon) }, '✕'))),
      fallo ? card('No se pudieron consultar los débitos', null,
        h('p', { class: 'aviso rojo' }, `El banco no respondió: ${fallo}. No es que no haya débitos.`),
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => cargar() }, 'Reintentar')))
      : datos ? [
        h('div', { class: 'kpis' }, kpiMoneda('ARS', 'Total debitado en pesos'), kpiMoneda('USD', 'Total debitado en dólares'), kpi(mon ? `Cantidad de débitos en ${mon === 'ARS' ? 'pesos' : 'dólares'}` : 'Cantidad de débitos', filas.length)),
        card('Débitos realizados', 'Débitos (signo D) de las cuentas de tus clientes habilitados. Tocá el total en pesos o en dólares para ver solo esa moneda (de nuevo, todas). Hacé clic en una fila para ir a sus movimientos; la ruedita ⚙ muestra su auditoría.',
          h('div', { class: 'fila' }, h('button', { class: 'btn', disabled: !filas.length, onclick: () => descargar(`/debitos?desde=${desde}&hasta=${hasta}${cli ? `&empresa=${cli}` : ''}&formato=xlsx`, `debitos_realizados_${desde}_${hasta}.xlsx`).catch(error) }, 'Exportar a Excel')),
          tabla([
            { t: 'Fecha', v: (d) => d.fecha, cls: 'mono' }, { t: 'Hora', v: (d) => d.hora, cls: 'mono' }, { t: 'Cliente', v: (d) => d.cliente },
            { t: 'Cuenta', v: (d) => d.cuenta, cls: 'mono' }, { t: 'Descripción', v: (d) => d.descripcion }, { t: 'Beneficiario', v: (d) => d.beneficiario },
            { t: 'CUIT', v: (d) => d.cuit, cls: 'mono' }, { t: 'Importe', v: (d) => `−${dinero(-d.importe, d.moneda)}`, cls: 'num' }, { t: 'ID', v: (d) => d.id, cls: 'mono' },
            { t: 'Auditoría', v: (d) => engranaje(`débito ${d.id}`, () => auditoriaDebito(d.id)), cls: 'c' },
          ], filas, { alClic: (d) => ctx.ir('movimientos', { cuenta: d.cuenta, movModo: st.debModo, movDesde: desde, movHasta: hasta }), vacio: 'No hay débitos para este período y filtro.' })),
      ] : cargando(),
    );
  };
  const cargar = async () => {
    datos = null; fallo = null; dibujar();
    const [desde, hasta] = rango();
    try { datos = (await api(`/debitos?desde=${desde}&hasta=${hasta}${cli ? `&empresa=${cli}` : ''}`)).debitos; } catch (e) { datos = null; fallo = e.message; }
    dibujar();
  };
  await cargar();
}
