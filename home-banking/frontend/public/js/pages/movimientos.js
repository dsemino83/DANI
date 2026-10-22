// Movimientos de una cuenta: hoy por defecto o histórico; el backend pagina de a 900 contra el banco.
import { api, descargar } from '../api.js';
import { h, poner, card, kpi, tabla, campo, seg, dinero, iso, haceDias, fecha, cargando, error, toast, contiene, sinPerderFoco } from '../ui.js';

const PAGINA = 900;
const MAX_CAUSALES = 10;

// Créditos del período agrupados por causal (la descripción del movimiento): ranking por importe con barra,
// cantidad y porcentaje. Los que exceden MAX_CAUSALES se suman en "Otras causales". Clic = filtrar el detalle.
// El ancho va por CSSOM (la CSP no permite atributos style en línea)
const barra = (porc) => { const b = h('div', { class: 'barra' }); b.style.width = `${porc}%`; return b; };

function resumenCreditos(movimientos, moneda, filtrar) {
  const grupos = new Map();
  for (const m of movimientos.filter((x) => x.signDC === 'C')) {
    const causal = String(m.description ?? '').trim().replace(/\s+/g, ' ') || 'Sin descripción';
    const g = grupos.get(causal) ?? { causal, n: 0, total: 0 };
    g.n++; g.total += Number(m.amount);
    grupos.set(causal, g);
  }
  if (!grupos.size) return null;
  let filas = [...grupos.values()].sort((a, b) => b.total - a.total);
  if (filas.length > MAX_CAUSALES) {
    const resto = filas.slice(MAX_CAUSALES - 1);
    filas = [...filas.slice(0, MAX_CAUSALES - 1), { causal: `Otras causales (${resto.length})`, n: resto.reduce((s, g) => s + g.n, 0), total: resto.reduce((s, g) => s + g.total, 0), otras: true }];
  }
  const total = filas.reduce((s, g) => s + g.total, 0), max = Math.max(...filas.map((g) => g.total));
  const pct = (v) => (total ? `${(v / total * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %` : '—');
  return card('Créditos por causal', `${grupos.size} causales · ${dinero(total, moneda)} en el período. Hacé clic en una causal para ver sus movimientos.`,
    h('div', { class: 'tabla' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Causal'), h('th', { class: 'num' }, 'Movimientos'), h('th', { class: 'num' }, 'Importe'), h('th', { class: 'num' }, '%'), h('th', {}, h('span', { class: 'vh' }, 'Proporción')))),
      h('tbody', {}, filas.map((g) => {
        const tr = h('tr', { class: g.otras ? '' : 'causal-fila', tabindex: g.otras ? null : 0, title: `${g.causal}: ${dinero(g.total, moneda)} (${pct(g.total)}) · ${g.n} movimiento(s)` },
          h('td', {}, g.causal), h('td', { class: 'num' }, g.n), h('td', { class: 'num' }, dinero(g.total, moneda)), h('td', { class: 'num' }, pct(g.total)),
          h('td', {}, h('div', { class: 'barra-fondo' }, barra(max ? Math.max(1, g.total / max * 100) : 0))));
        if (!g.otras) {
          tr.addEventListener('click', () => filtrar(g.causal));
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') filtrar(g.causal); });
        }
        return tr;
      })))));
}

export async function render(main, ctx) {
  poner(main, cargando());
  const cuentas = await api('/cuentas');
  const empresas = [...new Map(cuentas.map((c) => [c.empresa.id, c.empresa])).values()];
  const st = ctx.estado;
  st.movModo ??= 'hoy'; st.movDesde ??= haceDias(30); st.movHasta ??= iso();
  if (!cuentas.some((c) => c.cuenta === st.cuenta)) st.cuenta = cuentas[0]?.cuenta;
  let datos = null, pagina = 0, q = '';
  // Buscador de cliente o cuenta: "contiene" en nombre (producto), alias, número, razón social o CUIT.
  const buscarCta = h('input', { type: 'search', value: st.buscarMov ?? '', 'data-foco': 'cta', placeholder: 'Nombre de la cuenta, alias, número o cliente' });
  buscarCta.addEventListener('input', () => { st.buscarMov = buscarCta.value; redibujar(); });
  const coincide = (x) => contiene(buscarCta.value, x.producto, x.alias, x.cuenta, x.empresa.razonSocial, x.empresa.cuit);
  const redibujar = () => sinPerderFoco(dibujar);

  const dibujar = () => {
    const c = cuentas.find((x) => x.cuenta === st.cuenta);
    const encontradas = buscarCta.value.trim() ? cuentas.filter(coincide) : [];
    const desde = st.movModo === 'hoy' ? iso() : st.movDesde, hasta = st.movModo === 'hoy' ? iso() : st.movHasta;
    const selCli = h('select', { onchange: (e) => { st.cuenta = cuentas.find((x) => String(x.empresa.id) === e.target.value)?.cuenta; cargar(); } },
      empresas.filter((e) => e.id === c?.empresa.id || cuentas.some((x) => x.empresa.id === e.id && coincide(x)))
        .map((e) => h('option', { value: e.id, selected: c?.empresa.id === e.id }, e.razonSocial)));
    const selCta = h('select', { onchange: (e) => { st.cuenta = e.target.value; cargar(); } },
      cuentas.filter((x) => x.empresa.id === c?.empresa.id && (x.cuenta === st.cuenta || coincide(x)))
        .map((x) => h('option', { value: x.cuenta, selected: x.cuenta === st.cuenta }, `${x.producto ? `${x.producto} · ` : ''}${x.alias} · ${x.cuenta} (${x.moneda})`)));
    const d1 = h('input', { type: 'date', value: st.movDesde, max: iso() }), d2 = h('input', { type: 'date', value: st.movHasta, max: iso() });
    const movs = (datos?.movimientos ?? []).filter((m) => !q || [m.description, m.beneficiary, m.documentNumber, m.transactionId].join(' ').toLowerCase().includes(q));
    const cred = movs.filter((m) => m.signDC === 'C').reduce((s, m) => s + Number(m.amount), 0), deb = movs.filter((m) => m.signDC === 'D').reduce((s, m) => s + Number(m.amount), 0);
    const paginas = Math.max(1, Math.ceil(movs.length / PAGINA));
    pagina = Math.min(pagina, paginas - 1);
    const vista = movs.slice(pagina * PAGINA, (pagina + 1) * PAGINA);
    poner(main, 
      h('div', { class: 'fila' }, campo('Buscar cliente o cuenta (contiene)', buscarCta)),
      encontradas.length > 0 && card(`Cuentas que coinciden (${encontradas.length})`, 'Elegí una para ver sus movimientos.',
        h('div', { class: 'lista-scroll' }, tabla([
          { t: 'Cliente', v: (x) => x.empresa.razonSocial }, { t: 'Nombre', v: (x) => x.producto }, { t: 'Alias', v: (x) => x.alias },
          { t: 'Cuenta', v: (x) => x.cuenta, cls: 'mono' }, { t: 'Moneda', v: (x) => x.moneda },
        ], encontradas, { alClic: (x) => { st.cuenta = x.cuenta; cargar(); }, sel: (x) => x.cuenta === st.cuenta }))),
      buscarCta.value.trim() && !encontradas.length && h('p', { class: 'aviso' }, 'Ninguna cuenta coincide con la búsqueda.'),
      h('div', { class: 'fila' },
        campo('Cliente', selCli), campo('Cuenta', selCta),
        campo('Período', seg([['hoy', 'Hoy'], ['hist', 'Histórico']], st.movModo, (v) => { st.movModo = v; cargar(); })),
        h('button', { class: 'btn', title: 'Vuelve a pedir al banco los movimientos de esta cuenta y período', onclick: () => cargar(true) }, '↻ Consultar nuevamente'),
        st.movModo === 'hist' && [campo('Desde', d1), campo('Hasta', d2), h('button', { class: 'btn primario', onclick: () => {
          if (!d1.value || !d2.value || d1.value > d2.value) return toast('Ingresá un rango de fechas válido.', true);
          st.movDesde = d1.value; st.movHasta = d2.value; cargar();
        } }, 'Consultar')],
        campo('Buscar movimiento', h('input', { type: 'search', value: q, 'data-foco': 'mov', placeholder: 'Descripción, beneficiario, CUIT…', oninput: (e) => { q = e.target.value.toLowerCase(); pagina = 0; redibujar(); } }))),
      h('p', { class: 'nota' }, `Período consultado: ${st.movModo === 'hoy' ? `hoy, ${fecha(desde)}` : `${fecha(desde)} al ${fecha(hasta)}`}.`),
      datos?.error ? card('No se pudieron consultar los movimientos', null,
        h('p', { class: 'aviso rojo' }, `El banco no respondió: ${datos.error}. No es que la cuenta no tenga movimientos.`),
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => cargar() }, 'Reintentar')))
      : datos ? [
        h('div', { class: 'kpis' }, kpi('Créditos', dinero(cred, c?.moneda), 'pos'), kpi('Débitos', dinero(deb, c?.moneda), 'neg'), kpi('Cantidad de movimientos', movs.length)),
        resumenCreditos(datos.movimientos, c?.moneda, (causal) => { q = causal.toLowerCase(); pagina = 0; redibujar(); }),
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

  const cargar = async (fresco = false) => {
    datos = null; pagina = 0;
    dibujar();
    if (!st.cuenta) return;
    const desde = st.movModo === 'hoy' ? iso() : st.movDesde, hasta = st.movModo === 'hoy' ? iso() : st.movHasta;
    try { datos = await api(`/cuentas/${st.cuenta}/movimientos?desde=${desde}&hasta=${hasta}`, { fresco }); } catch (e) { datos = { error: e.message }; }
    dibujar();
  };
  if (!cuentas.length) return poner(main, h('p', { class: 'vacio' }, 'No tenés cuentas habilitadas.'));
  await cargar();
}
