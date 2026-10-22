// Envíos programados (aprobador / perfil autorizante, sobre las empresas que ve): correos automáticos a las empresas con saldos y/o movimientos del
// día, una vez al día o cada hora / cada 30 minutos dentro de una franja, por días de la semana, con inicio, fin y feriados.
import { api } from '../api.js';
import { h, poner, card, campo, tabla, pill, toast, error, cargando, confirmar, fechaHora, contiene, sinPerderFoco } from '../ui.js';

const FORMATO = [['cuerpo', 'Solo en el cuerpo del correo (alertas)'], ['cuerpo_excel', 'Cuerpo del correo + Excel adjunto']];
const CONTENIDO = [['saldos', 'Saldos'], ['movimientos', 'Movimientos del día'], ['saldos_movimientos', 'Saldos y movimientos del día']];
const DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']];
const hoy = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export async function render(main) {
  let progs = [], empresas = [], elegida = null, anio = new Date().getFullYear();
  const lista = h('div', {}, cargando()), editor = h('div', {}), historial = h('div', {}), cola = h('div', {}), feriados = h('div', {});

  const cargar = async () => {
    [progs, empresas] = await Promise.all([api('/envios'), api('/envios/empresas')]);
    if (elegida) elegida = progs.find((p) => p.id === elegida.id) ?? null;
    pintarLista();
    await pintarHistorial();
  };

  const pintarLista = () => poner(lista, tabla([
    { t: 'Nombre', v: (p) => p.nombre }, { t: 'Programación', v: (p) => p.descripcion },
    { t: 'Destino', v: (p) => (p.todas_empresas ? 'Todos mis clientes' : `${(p.destinos ?? []).length} cliente(s)${(p.destinos ?? []).some((d) => d.cuentas?.length) ? ' · cuentas elegidas' : ''}`) },
    { t: 'Estado', v: (p) => pill(p.activa ? 'Activa' : 'Pausada', p.activa ? 'ok' : 'warn') },
    { t: 'Próximo envío', v: (p) => (p.proximo ? fechaHora(p.proximo) : '—') },
    { t: 'Último', v: (p) => (p.ultimo_envio ? fechaHora(p.ultimo_envio) : '—') },
  ], progs, { alClic: (p) => { elegida = p; pintarLista(); pintarEditor(p); pintarHistorial(); }, sel: (p) => p.id === elegida?.id, vacio: 'Todavía no hay envíos programados.' }));

  // Formulario de alta / edición
  const pintarEditor = (p = null) => {
    const f = {
      nombre: h('input', { value: p?.nombre ?? '', placeholder: 'Resumen diario de saldos' }),
      contenido: h('select', {}, CONTENIDO.map(([v, t]) => h('option', { value: v, selected: (p?.contenido ?? 'saldos') === v }, t))),
      formato: h('select', {}, FORMATO.map(([v, t]) => h('option', { value: v, selected: (p?.formato ?? 'cuerpo') === v }, t))),
      frecuencia: h('select', {}, h('option', { value: 'diaria', selected: (p?.frecuencia ?? 'diaria') === 'diaria' }, '1 vez al día · extracto diario'), h('option', { value: 'horaria', selected: p?.frecuencia === 'horaria' }, '1 vez cada hora · alerta de movimientos'),
        h('option', { value: 'media_hora', selected: p?.frecuencia === 'media_hora' }, '1 vez cada 30 minutos · alerta de movimientos')),
      hora: h('input', { type: 'time', value: String(p?.hora ?? '09:00').slice(0, 5) }),
      horaHasta: h('input', { type: 'time', value: String(p?.hora_hasta ?? '18:00').slice(0, 5) }),
      inicio: h('input', { type: 'date', value: p?.fecha_inicio ?? hoy() }),
      fin: h('input', { type: 'date', value: p?.fecha_fin ?? '' }),
      feriados: h('input', { type: 'checkbox', checked: p ? p.saltar_feriados : true }),
      activa: h('input', { type: 'checkbox', checked: p ? p.activa : true }),
      todas: h('input', { type: 'checkbox', checked: p ? p.todas_empresas : true }),
    };
    const dias = DIAS.map(([n, t]) => [n, h('input', { type: 'checkbox', checked: (p?.dias_semana ?? [1, 2, 3, 4, 5]).map(Number).includes(n), 'aria-label': t }), t]);
    // Destino: primero el cliente y después sus cuentas. elegidos: empresaId -> Set de cuentas (vacío = todas)
    const elegidos = new Map((p?.destinos ?? []).map((d) => [Number(d.empresaId), new Set(d.cuentas ?? [])]));
    const buscar = h('input', { type: 'search', placeholder: 'Buscar empresa (contiene)' });
    const listaEmp = h('div', { class: 'lista-scroll' });
    // El buscador y la lista se redibujan solos al tildar/destildar "Todas" (sin rearmar el formulario)
    const pintarEmpresas = () => poner(listaEmp, f.todas.checked ? h('p', { class: 'nota' }, 'Se envía a todos los clientes que ves, con todas sus cuentas (activos, con emails y cuentas).')
      : [campo('Buscar cliente', buscar), ...empresas.filter((e) => contiene(buscar.value, e.razon_social, e.cuit)).map((e) => {
        const id = Number(e.id), sel = elegidos.get(id);
        const chkCli = h('input', { type: 'checkbox', checked: !!sel, 'aria-label': e.razon_social });
        chkCli.addEventListener('change', () => { chkCli.checked ? elegidos.set(id, new Set()) : elegidos.delete(id); sinPerderFoco(pintarEmpresas); });
        const cuentas = sel && h('div', { class: 'dest-cuentas' },
          h('label', { class: 'campo check' }, (() => { const x = h('input', { type: 'checkbox', checked: sel.size === 0 }); x.addEventListener('change', () => { if (x.checked) sel.clear(); else e.cuentas.forEach((c) => sel.add(c.cuenta)); pintarEmpresas(); }); return x; })(), 'Todas las cuentas'),
          ...e.cuentas.map((c) => {
            const x = h('input', { type: 'checkbox', checked: sel.size === 0 || sel.has(c.cuenta), disabled: sel.size === 0 });
            x.addEventListener('change', () => { x.checked ? sel.add(c.cuenta) : sel.delete(c.cuenta); if (!sel.size) elegidos.set(id, new Set()); pintarEmpresas(); });
            return h('label', { class: 'campo check' }, x, `${c.cuenta}${c.alias ? ` · ${c.alias}` : ''}${c.moneda ? ` (${c.moneda})` : ''}`);
          }),
          !e.cuentas.length && h('p', { class: 'aviso' }, 'Este cliente no tiene cuentas activas.'));
        return h('div', { class: 'dest-cliente' },
          h('label', { class: 'campo check' }, chkCli, h('b', {}, e.razon_social), ` · CUIT ${e.cuit} · `, e.emails?.length ? e.emails.join(', ') : pill('Sin email', 'warn')), cuentas);
      })]);
    buscar.addEventListener('input', () => sinPerderFoco(pintarEmpresas));
    buscar.dataset.foco = 'envios-empresa';
    f.todas.addEventListener('change', pintarEmpresas);
    const franja = h('div', { class: 'fila' });
    const explicacion = h('p', { class: 'nota' });
    const pintarFranja = () => {
      const diaria = f.frecuencia.value === 'diaria';
      poner(franja, diaria ? campo('Hora del envío', f.hora) : [campo('Desde (primer envío)', f.hora), campo('Hasta (último envío)', f.horaHasta)]);
      // La alerta (cada hora o cada 30 minutos) siempre informa movimientos: el contenido solo se elige en el extracto diario
      f.contenido.disabled = !diaria;
      if (!diaria) f.contenido.value = 'movimientos';
      poner(explicacion, diaria
        ? 'Extracto diario: asunto "Envío de extracto diario", saludo al cliente, saldos y/o movimientos del día por cuenta (débitos y créditos separados). Con Excel, el cuerpo va igual y se adjunta el extracto con el logo del banco y todos los movimientos.'
        : 'Alerta de movimientos: en cada ejecución consulta los movimientos del día de las cuentas elegidas entre esa hora y 29:59 minutos antes (ej. 10:00 → de 09:30:01 a 10:00:00). Solo se envía si hubo movimientos: asunto "Alerta de movimientos", la franja horaria y, por cuenta, débitos y créditos en tablas con todo el detalle.');
    };
    f.frecuencia.addEventListener('change', pintarFranja);
    pintarFranja(); pintarEmpresas();

    const guardar = async () => {
      const body = {
        nombre: f.nombre.value, contenido: f.contenido.value, formato: f.formato.value, frecuencia: f.frecuencia.value, hora: f.hora.value, horaHasta: f.horaHasta.value,
        diasSemana: dias.filter(([, x]) => x.checked).map(([n]) => n), saltarFeriados: f.feriados.checked, fechaInicio: f.inicio.value, fechaFin: f.fin.value || null,
        todasEmpresas: f.todas.checked, destinos: [...elegidos].map(([empresaId, cs]) => ({ empresaId, cuentas: [...cs] })), activa: f.activa.checked,
      };
      try {
        const r = await api(p ? `/envios/${p.id}` : '/envios', { method: p ? 'PUT' : 'POST', body });
        toast(p ? 'Programación guardada.' : 'Programación creada.'); elegida = r;
      } catch (x) { return error(x); }
      await cargar(); pintarEditor(progs.find((x) => x.id === elegida?.id) ?? null);
    };
    const eliminar = async () => {
      if (!(await confirmar('Eliminar envío programado', `"${p.nombre}" deja de enviarse. Su historial de envíos se conserva.`, 'Eliminar'))) return;
      try { await api(`/envios/${p.id}`, { method: 'DELETE' }); toast('Programación eliminada.'); elegida = null; } catch (x) { return error(x); }
      poner(editor); await cargar();
    };
    const ejecutar = async () => {
      if (!(await confirmar('Ejecutar ahora', `Se encola ya un envío por cliente de "${p.nombre}". La cola los procesa de a uno en los próximos segundos (no cambia la programación).`, 'Encolar ahora'))) return;
      try { const r = await api(`/envios/${p.id}/ejecutar`, { method: 'POST' }); toast(`Ejecución ${r.ejecucion}: ${r.encoladas} envío(s) encolado(s). Seguilos en "Cola de envíos".`); } catch (x) { error(x); }
      await cargar(); pintarCola();
    };

    poner(editor, card(p ? `Editar · ${p.nombre}` : 'Nuevo envío programado', 'Hora de Argentina. "1 vez cada hora" y "1 vez cada 30 minutos" ejecutan a la hora de "Desde" y después cada hora o cada 30 minutos hasta "Hasta", inclusive. Cada cliente puede tener una sola programación activa de cada tipo (un extracto diario y una alerta). Las consultas al banco usan la credencial de envíos programados.',
      h('div', { class: 'fila' }, campo('Nombre', f.nombre), campo('Tipo y repetición', f.frecuencia), campo('Contenido', f.contenido), campo('Formato', f.formato)),
      explicacion,
      franja,
      h('div', { class: 'fila' }, h('span', { class: 'nota' }, 'Días:'), ...dias.map(([, x, t]) => h('label', { class: 'campo check' }, x, t))),
      h('div', { class: 'fila' }, campo('Inicio', f.inicio), campo('Fin (vacío = sin fin)', f.fin),
        h('label', { class: 'campo check' }, f.feriados, 'No enviar en feriados'), h('label', { class: 'campo check' }, f.activa, 'Activa')),
      h('label', { class: 'campo check' }, f.todas, 'Todos mis clientes'),
      listaEmp,
      h('div', { class: 'fila' },
        h('button', { class: 'btn primario', onclick: guardar }, p ? 'Guardar cambios' : 'Crear'),
        p && h('button', { class: 'btn', onclick: ejecutar }, 'Ejecutar ahora'),
        p && h('button', { class: 'btn peligro', onclick: eliminar }, 'Eliminar'),
        p && h('button', { class: 'btn', onclick: () => { elegida = null; pintarLista(); pintarEditor(); pintarHistorial(); } }, 'Nuevo'))));
  };

  const pintarHistorial = async () => {
    if (!elegida) return poner(historial);
    const [ejecuciones, filas] = await Promise.all([api(`/envios/${elegida.id}/ejecuciones`).catch(() => []), api(`/envios/${elegida.id}/historial`).catch(() => [])]);
    poner(historial,
      card(`Ejecuciones · ${elegida.nombre}`, 'Cada ejecución (un turno o un "Ejecutar ahora") tiene un id transaccional que agrupa sus tareas de la cola. "Consultas al banco" cuenta solo las llamadas reales: lo que ya estaba consultado se reutiliza.',
        tabla([
          { t: 'Ejecución', v: (x) => x.codigo, cls: 'mono' }, { t: 'Turno', v: (x) => (x.manual ? 'manual' : x.turno.replace('T', ' ')), cls: 'mono' },
          { t: 'Inicio', v: (x) => fechaHora(x.creada_en) }, { t: 'Fin', v: (x) => (x.terminada_en ? fechaHora(x.terminada_en) : '—') },
          { t: 'Estado', v: (x) => pill(x.estado === 'terminada' ? 'Terminada' : 'En curso', x.estado === 'terminada' ? (x.errores ? 'bad' : 'ok') : 'warn') },
          { t: 'Tareas', v: (x) => x.tareas, cls: 'num' }, { t: 'Enviadas', v: (x) => x.enviadas, cls: 'num' }, { t: 'Omitidas', v: (x) => x.omitidas, cls: 'num' },
          { t: 'Errores', v: (x) => x.errores, cls: 'num' }, { t: 'Consultas al banco', v: (x) => x.consultas_banco, cls: 'num' },
        ], ejecuciones, { vacio: 'Todavía no hay ejecuciones.' })),
      card(`Historial · ${elegida.nombre}`, 'Últimas 200 tareas (una por cliente y turno).', tablaTareas(filas, false)));
  };

  // Tareas de la cola (también se usa para el historial de una programación)
  const ESTADO = { pendiente: ['En cola', 'warn'], procesando: ['Procesando', 'warn'], enviado: ['Enviado', 'ok'], error: ['Error', 'bad'], omitido: ['Omitido', 'warn'] };
  const reintentar = async (t) => {
    try { await api(`/envios/cola/${t.id}/reintentar`, { method: 'POST' }); toast('Vuelve a la cola.'); } catch (x) { error(x); }
    pintarCola(); pintarHistorial();
  };
  const tablaTareas = (filas, conProgramacion) => tabla([
    { t: 'Ejecución', v: (x) => x.ejecucion ?? '—', cls: 'mono' },
    { t: 'Encolada', v: (x) => fechaHora(x.encolada_en) }, conProgramacion && { t: 'Programación', v: (x) => x.programacion },
    { t: 'Turno', v: (x) => (x.manual ? 'manual' : x.turno.replace('T', ' ')), cls: 'mono' }, { t: 'Cliente', v: (x) => x.empresa },
    { t: 'Cuentas', v: (x) => (x.cuentas?.length ? x.cuentas.join(', ') : 'todas') },
    { t: 'Estado', v: (x) => pill(...ESTADO[x.estado]) }, { t: 'Intentos', v: (x) => `${x.intentos}/${x.max_intentos}`, cls: 'num' },
    { t: 'Consultas al banco', v: (x) => x.consultas_banco ?? 0, cls: 'num' },
    { t: 'Detalle', v: (x) => [x.detalle ?? '', x.destinatarios?.length ? ` → ${x.destinatarios.join(', ')}` : ''].join('') },
    { t: '', cls: 'acc', v: (x) => x.estado === 'error' && h('button', { class: 'btn chico', onclick: () => reintentar(x) }, 'Reintentar') },
  ].filter(Boolean), filas, { vacio: 'No hay tareas.' });

  const pintarCola = async () => {
    const r = await api('/envios/cola').catch(() => null);
    if (!r) return;
    const n = (k) => r.ultimas24h[k] ?? 0;
    poner(cola, card('Cola de envíos', 'Cada turno genera una tarea por cliente. Un único proceso las toma de a una, en orden, así no se superponen; cada tarea termina en un correo. Si falla, se reintenta a los 1, 5 y 15 minutos.',
      h('div', { class: 'fila' },
        pill(`En cola ${r.tareas.filter((t) => t.estado === 'pendiente').length}`, 'warn'), pill(`Procesando ${r.tareas.filter((t) => t.estado === 'procesando').length}`, 'warn'),
        h('span', { class: 'nota' }, `Últimas 24 h: ${n('enviado')} enviados · ${n('error')} con error · ${n('omitido')} omitidos · ${n('consultasBanco')} consultas al banco`),
        h('button', { class: 'btn chico', onclick: pintarCola }, '↻ Actualizar')),
      h('div', { class: 'lista-scroll' }, tablaTareas(r.tareas, true))));
  };

  // Feriados: de fuentes públicas (ArgentinaDatos / Nolaborables) + los cargados a mano (p. ej. Día del Bancario)
  const pintarFeriados = async () => {
    const lista = await api(`/feriados?anio=${anio}`).catch((x) => { error(x); return []; });
    const fecha = h('input', { type: 'date' }), nombre = h('input', { placeholder: 'Día del Bancario' });
    const sincronizar = async () => {
      try { const r = await api('/feriados/sincronizar', { method: 'POST', body: { anio } }); toast(`${r.feriados} feriados de ${anio} (${r.fuente}).`); } catch (x) { error(x); }
      pintarFeriados(); cargar();
    };
    const agregar = async () => {
      try { await api('/feriados', { method: 'POST', body: { fecha: fecha.value, nombre: nombre.value } }); toast('Feriado cargado.'); } catch (x) { return error(x); }
      pintarFeriados(); cargar();
    };
    const borrar = async (x) => {
      try { await api(`/feriados/${x.fecha}`, { method: 'DELETE' }); toast('Feriado borrado.'); } catch (e) { return error(e); }
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
    editor, cola, historial, feriados);
  await cargar().catch(error);
  pintarCola();
  pintarFeriados();
}
