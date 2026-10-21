// Saldos: total de todas las empresas al ingresar; al elegir una, todo pasa a esa empresa.
import { api } from '../api.js';
import { h, poner, card, kpi, tabla, dinero, iso, pill, cargando, error } from '../ui.js';

const sumar = (cs, mon) => cs.filter((c) => c.moneda === mon).reduce((s, c) => s + Number(c.disponible), 0);

export async function render(main, ctx) {
  poner(main, cargando());
  const hoy = iso();
  const [cuentas, deb] = await Promise.all([
    api('/cuentas'),
    api(`/debitos?desde=${hoy}&hasta=${hoy}`).catch(() => ({ debitos: [] })),
  ]);
  const pend = ctx.me.puedeAprobar ? await api('/aprobaciones').then((r) => r.transferencias).catch(() => []) : [];
  const empresas = [...new Map(cuentas.map((c) => [c.empresa.id, c.empresa])).values()];
  const debDe = (cs) => {
    const set = new Set(cs.map((c) => c.cuenta)), d = deb.debitos.filter((x) => set.has(x.cuenta));
    return { ars: -d.filter((x) => x.moneda === 'ARS').reduce((s, x) => s + x.importe, 0), usd: -d.filter((x) => x.moneda === 'USD').reduce((s, x) => s + x.importe, 0), n: d.length };
  };
  const etiquetaDeb = (d) => (d.n ? pill([d.ars && `−${dinero(d.ars)}`, d.usd && `−${dinero(d.usd, 'USD')}`].filter(Boolean).join(' · ') + ` · ${d.n} ${d.n === 1 ? 'débito' : 'débitos'}`, 'bad') : h('span', { class: 'nota' }, 'Sin débitos hoy'));

  let cli = ctx.estado.cliSaldos ?? null, sel = null;
  const dibujar = async () => {
    const emp = empresas.find((e) => e.id === cli);
    const alcance = emp ? cuentas.filter((c) => c.empresa.id === cli) : cuentas;
    const nombre = emp ? emp.razonSocial : 'todas las empresas';
    const dA = debDe(alcance);
    const pendAlc = pend.filter((t) => alcance.some((c) => c.cuenta === t.cuenta_origen) && t.moneda === 'ARS');
    if (!alcance.some((c) => c.cuenta === sel)) sel = alcance[0]?.cuenta ?? null;
    poner(main, 
      h('div', { class: 'kpis' },
        kpi(`Disponible en pesos · ${nombre}`, dinero(sumar(alcance, 'ARS'))),
        kpi(`Disponible en dólares · ${nombre}`, dinero(sumar(alcance, 'USD'), 'USD')),
        ctx.me.puedeAprobar && kpi(`Pendiente de aprobar (pesos) · ${nombre}`, dinero(pendAlc.reduce((s, t) => s + Number(t.importe), 0))),
        h('div', { class: 'card' }, h('div', { class: 'kpi-label' }, `Débitos realizados hoy (pesos) · ${nombre} · ${dA.n} ${dA.n === 1 ? 'débito' : 'débitos'}`),
          h('div', { class: 'kpi-val neg' }, dinero(dA.ars)),
          h('button', { class: 'btn chico', onclick: () => ctx.ir('debitos', { cliDebitos: cli ?? '' }) }, 'Ver débitos realizados'))),
      card(null, null,
        h('div', { class: 'fila' }, h('h2', {}, 'Clientes'), emp && h('button', { class: 'btn chico', onclick: () => { cli = null; dibujar(); } }, 'Ver todas las empresas')),
        h('p', { class: 'nota' }, 'Empresas que tenés habilitadas. Al ingresar se muestra el total de todas; elegí un cliente para ver solo sus datos (tocalo de nuevo para volver al total).'),
        tabla([
          { t: 'Cliente', v: (e) => e.razonSocial }, { t: 'CUIT', v: (e) => e.cuit, cls: 'mono' },
          { t: 'Cuentas', v: (e) => cuentas.filter((c) => c.empresa.id === e.id).length, cls: 'num' },
          { t: 'Disponible $', v: (e) => dinero(sumar(cuentas.filter((c) => c.empresa.id === e.id), 'ARS')), cls: 'num' },
          { t: 'Disponible US$', v: (e) => dinero(sumar(cuentas.filter((c) => c.empresa.id === e.id), 'USD'), 'USD'), cls: 'num' },
          { t: 'Débitos realizados', v: (e) => etiquetaDeb(debDe(cuentas.filter((c) => c.empresa.id === e.id))) },
        ], empresas, { alClic: (e) => { cli = cli === e.id ? null : e.id; ctx.estado.cliSaldos = cli; dibujar(); }, sel: (e) => e.id === cli, vacio: 'No tenés clientes habilitados. Pedile al administrador de seguridad permisos por empresa.' })),
      card(`Cuentas de ${nombre}`, 'Hacé clic en una cuenta para ver su detalle, o entrá directo a sus movimientos del día.',
        tabla([
          { t: 'Cuenta', v: (c) => c.cuenta, cls: 'mono' }, { t: 'Producto', v: (c) => c.producto }, { t: 'Alias', v: (c) => c.alias }, { t: 'Moneda', v: (c) => c.moneda },
          { t: 'Disponible', v: (c) => dinero(c.disponible, c.moneda), cls: 'num' }, { t: 'Contable', v: (c) => dinero(c.contable, c.moneda), cls: 'num' },
          { t: 'Débitos realizados', v: (c) => etiquetaDeb(debDe([c])) },
          { t: 'Movimientos', v: (c) => h('button', { class: 'btn chico', onclick: (ev) => { ev.stopPropagation(); ctx.ir('movimientos', { cuenta: c.cuenta, movModo: 'hoy' }); } }, 'Ver del día') },
        ], alcance, { alClic: (c) => { sel = c.cuenta; dibujar(); }, sel: (c) => c.cuenta === sel })),
      detalleCard,
    );
    await cargarDetalle();
  };

  const detalleCard = card('Cuenta seleccionada', 'getBalancesDetail de la cuenta elegida.', h('div', { class: 'det' }));
  const cargarDetalle = async () => {
    const c = cuentas.find((x) => x.cuenta === sel);
    const cont = detalleCard.querySelector('.det');
    if (!c) return poner(cont, h('p', { class: 'vacio' }, 'Sin cuentas.'));
    poner(cont, cargando());
    try {
      const d = await api(`/cuentas/${c.cuenta}/detalle`);
      poner(cont, 
        h('dl', { class: 'dl' },
          h('dt', {}, 'Cuenta'), h('dd', {}, `${c.alias} · ${c.cuenta}`), h('dt', {}, 'Estado'), h('dd', {}, d.accountStatus ?? ''),
          h('dt', {}, 'Disponible'), h('dd', {}, dinero(d.availableBalance, c.moneda)), h('dt', {}, 'Contable'), h('dd', {}, dinero(d.accountingBalance, c.moneda)),
          h('dt', {}, 'Montos congelados'), h('dd', {}, dinero(d.frozenAmount, c.moneda)), h('dt', {}, 'Última operación'), h('dd', {}, d.lastOperationDate ?? '—')),
        h('div', { class: 'fila' },
          h('button', { class: 'btn primario', onclick: () => ctx.ir('movimientos', { cuenta: c.cuenta, movModo: 'hoy' }) }, 'Ver movimientos del día'),
          h('button', { class: 'btn', onclick: () => ctx.ir('movimientos', { cuenta: c.cuenta, movModo: 'hist' }) }, 'Consultar histórico')));
    } catch (e) { error(e); cont.replaceChildren(); }
  };
  await dibujar();
}
