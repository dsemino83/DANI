// Envíos programados (administrador): correos automáticos a las empresas con saldos y/o movimientos del
// día, una vez al día o cada hora dentro de una franja, por días de la semana, con inicio, fin y feriados.
import { api } from '../api.js';
import { h, poner, card, campo, tabla, pill, toast, error, cargando, confirmar, fechaHora, contiene, sinPerderFoco } from '../ui.js';

const CONTENIDO = [['saldos', 'Saldos'], ['movimientos', 'Movimientos del día'], ['saldos_movimientos', 'Saldos y movimientos del día']];
const DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']];
const hoy = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export async function render(main) {
  let progs = [], empresas = [], elegida = null, anio = new Date().getFullYear();
  const lista = h('div', {}, cargando()), editor = h('div', {}), historial = h('div', {}), feriados = h('div', {});

  const cargar = async () => {
    [progs, empresas] = await Promise.all([api('/admin/envios'), api('/admin/empresas')]);
    if (elegida) elegida = progs.find((p) => p.id === elegida.id) ?? null;
    pintarLista();
    await pintarHistorial();
  };

  const pintarLista = () => poner(lista, tabla([
    { t: 'Nombre', v: (p) => p.nombre }, { t: 'Programación', v: (p) => p.descripcion },
    { t: 'Destino', v: (p) => (p.todas_empresas ? 'Todas las empresas' : `${p.empresas.length} empresa(s)`) },
    { t: 'Estado', v: (p) => pill(p.activa ? 'Activa' : 'Pausada', p.activa ? 'ok' : 'warn') },
    { t: 'Próximo envío', v: (p) => (p.proximo ? fechaHora(p.proximo) : '—') },
    { t: 'Último', v: (p) => (p.ultimo_envio ? fechaHora(p.ultimo_envio) : '—') },
  ], progs, { alClic: (p) => { elegida = p; pintarLista(); pintarEditor(p); pintarHistorial(); }, sel: (p) => p.id === elegida?.id, vacio: 'Todavía no hay envíos programados.' }));

  // Formulario de alta / edición
  const pintarEditor = (p = null) => {
    const f = {
      nombre: h('input', { value: p?.nombre ?? '', placeholder: 'Resumen diario de saldos' }),
      contenido: h('select', {}, CONTENIDO.map(([v, t]) => h('option', { value: v, selected: (p?.contenido ?? 'saldos') === v }, t))),
      frecuencia: h('select', {}, h('option', { value: 'diaria', selected: (p?.frecuencia ?? 'diaria') === 'diaria' }, '1 vez al día'), h('option', { value: 'horaria', selected: p?.frecuencia === 'horaria' }, '1 vez cada hora')),
      hora: h('input', { type: 'time', value: String(p?.hora ?? '09:00').slice(0, 5) }),
      horaHasta: h('input', { type: 'time', value: String(p?.hora_hasta ?? '18:00').slice(0, 5) }),
      inicio: h('input', { type: 'date', value: p?.fecha_inicio ?? hoy() }),
      fin: h('input', { type: 'date', value: p?.fecha_fin ?? '' }),
      feriados: h('input', { type: 'checkbox', checked: p ? p.saltar_feriados : true }),
      activa: h('input', { type: 'checkbox', checked: p ? p.activa : true }),
      todas: h('input', { type: 'checkbox', checked: p ? p.todas_empresas : true }),
    };
    const dias = DIAS.map(([n, t]) => [n, h('input', { type: 'checkbox', checked: (p?.dias_semana ?? [1, 2, 3, 4, 5]).map(Number).includes(n), 'aria-label': t }), t]);
    const elegidas = new Set((p?.empresas ?? []).map(Number));
    const buscar = h('input', { type: 'search', placeholder: 'Buscar empresa (contiene)' });
    const listaEmp = h('div', { class: 'lista-scroll' });
    // El buscador y la lista se redibujan solos al tildar/destildar "Todas" (sin rearmar el formulario)
    const pintarEmpresas = () => poner(listaEmp, f.todas.checked ? h('p', { class: 'nota' }, 'Se envía a todas las empresas activas que tengan emails y cuentas.')
      : [campo('Buscar', buscar), tabla([
        { t: '', cls: 'c', v: (e) => { const x = h('input', { type: 'checkbox', checked: elegidas.has(Number(e.id)), 'aria-label': e.razon_social }); x.addEventListener('change', () => (x.checked ? elegidas.add(Number(e.id)) : elegidas.delete(Number(e.id)))); return x; } },
        { t: 'Empresa', v: (e) => e.razon_social }, { t: 'CUIT', v: (e) => e.cuit, cls: 'mono' },
        { t: 'Emails', v: (e) => (e.emails?.length ? e.emails.join(', ') : pill('Sin email', 'warn')) },
      ], empresas.filter((e) => contiene(buscar.value, e.razon_social, e.cuit)), { vacio: 'Ninguna empresa coincide.' })]);
    buscar.addEventListener('input', () => sinPerderFoco(pintarEmpresas));
    buscar.dataset.foco = 'envios-empresa';
    f.todas.addEventListener('change', pintarEmpresas);
    const franja = h('div', { class: 'fila' });
    const pintarFranja = () => poner(franja, f.frecuencia.value === 'diaria' ? campo('Hora del envío', f.hora)
      : [campo('Desde (primer envío)', f.hora), campo('Hasta (último envío)', f.horaHasta)]);
    f.frecuencia.addEventListener('change', pintarFranja);
    pintarFranja(); pintarEmpresas();

    const guardar = async () => {
      const body = {
        nombre: f.nombre.value, contenido: f.contenido.value, frecuencia: f.frecuencia.value, hora: f.hora.value, horaHasta: f.horaHasta.value,
        diasSemana: dias.filter(([, x]) => x.checked).map(([n]) => n), saltarFeriados: f.feriados.checked, fechaInicio: f.inicio.value, fechaFin: f.fin.value || null,
        todasEmpresas: f.todas.checked, empresas: [...elegidas], activa: f.activa.checked,
      };
      try {
        const r = await api(p ? `/admin/envios/${p.id}` : '/admin/envios', { method: p ? 'PUT' : 'POST', body });
        toast(p ? 'Programación guardada.' : 'Programación creada.'); elegida = r;
      } catch (x) { return error(x); }
      await cargar(); pintarEditor(progs.find((x) => x.id === elegida?.id) ?? null);
    };
    const eliminar = async () => {
      if (!(await confirmar('Eliminar envío programado', `"${p.nombre}" deja de enviarse. Su historial de envíos se conserva.`, 'Eliminar'))) return;
      try { await api(`/admin/envios/${p.id}`, { method: 'DELETE' }); toast('Programación eliminada.'); elegida = null; } catch (x) { return error(x); }
      poner(editor); await cargar();
    };
    const ejecutar = async () => {
      if (!(await confirmar('Ejecutar ahora', `Se envían ya los correos de "${p.nombre}" a las empresas de destino (no cambia la programación).`, 'Enviar ahora'))) return;
      try { const r = await api(`/admin/envios/${p.id}/ejecutar`, { method: 'POST' }); toast(`Enviados ${r.enviados} · errores ${r.errores} · omitidos ${r.omitidos}.`, r.errores > 0); } catch (x) { error(x); }
      await cargar();
    };

    poner(editor, card(p ? `Editar · ${p.nombre}` : 'Nuevo envío programado', 'Hora de Argentina. "1 vez cada hora" envía a la hora en punto de "Desde" y cada hora hasta "Hasta", inclusive.',
      h('div', { class: 'fila' }, campo('Nombre', f.nombre), campo('Contenido', f.contenido), campo('Repetición', f.frecuencia)),
      franja,
      h('div', { class: 'fila' }, h('span', { class: 'nota' }, 'Días:'), ...dias.map(([, x, t]) => h('label', { class: 'campo check' }, x, t))),
      h('div', { class: 'fila' }, campo('Inicio', f.inicio), campo('Fin (vacío = sin fin)', f.fin),
        h('label', { class: 'campo check' }, f.feriados, 'No enviar en feriados'), h('label', { class: 'campo check' }, f.activa, 'Activa')),
      h('label', { class: 'campo check' }, f.todas, 'Todas las empresas'),
      listaEmp,
      h('div', { class: 'fila' },
        h('button', { class: 'btn primario', onclick: guardar }, p ? 'Guardar cambios' : 'Crear'),
        p && h('button', { class: 'btn', onclick: ejecutar }, 'Ejecutar ahora'),
        p && h('button', { class: 'btn peligro', onclick: eliminar }, 'Eliminar'),
        p && h('button', { class: 'btn', onclick: () => { elegida = null; pintarLista(); pintarEditor(); pintarHistorial(); } }, 'Nuevo'))));
  };

  const pintarHistorial = async () => {
    if (!elegida) return poner(historial);
    const filas = await api(`/admin/envios/${elegida.id}/historial`).catch(() => []);
    poner(historial, card(`Historial · ${elegida.nombre}`, 'Últimos 200 envíos (uno por empresa y turno).', tabla([
      { t: 'Fecha', v: (x) => fechaHora(x.en) }, { t: 'Turno', v: (x) => x.turno.replace('T', ' '), cls: 'mono' }, { t: 'Empresa', v: (x) => x.empresa },
      { t: 'Destinatarios', v: (x) => x.destinatarios.join(', ') },
      { t: 'Resultado', v: (x) => pill({ enviado: 'Enviado', error: 'Error', omitido: 'Omitido' }[x.estado], { enviado: 'ok', error: 'bad', omitido: 'warn' }[x.estado]) },
      { t: 'Detalle', v: (x) => `${x.manual ? '(manual) ' : ''}${x.detalle ?? ''}` },
    ], filas, { vacio: 'Todavía no hubo envíos.' })));
  };

  // Feriados: de fuentes públicas (ArgentinaDatos / Nolaborables) + los cargados a mano (p. ej. Día del Bancario)
  const pintarFeriados = async () => {
    const lista = await api(`/admin/feriados?anio=${anio}`).catch((x) => { error(x); return []; });
    const fecha = h('input', { type: 'date' }), nombre = h('input', { placeholder: 'Día del Bancario' });
    const sincronizar = async () => {
      try { const r = await api('/admin/feriados/sincronizar', { method: 'POST', body: { anio } }); toast(`${r.feriados} feriados de ${anio} (${r.fuente}).`); } catch (x) { error(x); }
      pintarFeriados(); cargar();
    };
    const agregar = async () => {
      try { await api('/admin/feriados', { method: 'POST', body: { fecha: fecha.value, nombre: nombre.value } }); toast('Feriado cargado.'); } catch (x) { return error(x); }
      pintarFeriados(); cargar();
    };
    const borrar = async (x) => {
      try { await api(`/admin/feriados/${x.fecha}`, { method: 'DELETE' }); toast('Feriado borrado.'); } catch (e) { return error(e); }
      pintarFeriados(); cargar();
    };
    const selAnio = h('select', { onchange: (e) => { anio = Number(e.target.value); pintarFeriados(); } },
      [anio - 1, anio, anio + 1].map((a) => h('option', { value: a, selected: a === anio }, a)));
    poner(feriados, card('Feriados', 'Se actualizan solos todos los días desde fuentes públicas. Los días no laborables bancarios que no estén (por ejemplo, el Día del Bancario, 6 de noviembre) se cargan a mano.',
      h('div', { class: 'fila' }, campo('Año', selAnio), h('button', { class: 'btn', onclick: sincronizar }, 'Actualizar desde fuentes públicas')),
      h('div', { class: 'lista-scroll' }, tabla([
        { t: 'Fecha', v: (x) => x.fecha.split('-').reverse().join('/'), cls: 'mono' }, { t: 'Feriado', v: (x) => x.nombre }, { t: 'Tipo', v: (x) => x.tipo ?? '' },
        { t: 'Fuente', v: (x) => x.fuente }, { t: '', cls: 'acc', v: (x) => x.fuente === 'manual' && h('button', { class: 'btn chico', onclick: () => borrar(x) }, 'Borrar') },
      ], lista, { vacio: `No hay feriados cargados para ${anio}. Tocá "Actualizar desde fuentes públicas".` })),
      h('div', { class: 'fila' }, campo('Fecha', fecha), campo('Nombre', nombre), h('button', { class: 'btn', onclick: agregar }, 'Agregar feriado'))));
  };

  poner(main,
    card('Envíos programados', 'Correos automáticos a los emails de cada empresa. Elegí uno para editarlo, ejecutarlo o ver su historial.',
      h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => { elegida = null; pintarLista(); pintarEditor(); pintarHistorial(); } }, 'Nuevo envío programado')), lista),
    editor, historial, feriados);
  await cargar().catch(error);
  pintarFeriados();
}
