// Maestro de empresas (administrador de seguridad): alta con emails, cuentas asignadas (agregar con buscador y
// quitar de a una), activar/desactivar y baja.
import { api } from '../api.js';
import { h, poner, card, campo, tabla, pill, fecha, confirmar, toast, error, cargando, modal } from '../ui.js';

// Búsqueda "contiene" sin distinguir mayúsculas ni acentos (igual que el backend)
const plano = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const coincide = (c, texto) => !texto.trim() || [c.nombre, c.alias, c.cuenta, c.cbu].some((v) => plano(v).includes(plano(texto).trim()));
const separarEmails = (texto) => String(texto).split(/[,;\n]+/).map((e) => e.trim()).filter(Boolean);

export async function render(main) {
  let empresas = [], elegida = null;
  const lista = h('div', {}, cargando()), detalle = h('div', {});

  const cargar = async () => {
    empresas = await api('/admin/empresas');
    if (elegida) elegida = empresas.find((e) => e.id === elegida.id) ?? null;
    dibujarLista();
    await dibujarDetalle();
  };

  const cambiarEstado = async (e) => {
    const activar = !e.activa;
    const ok = await confirmar(activar ? 'Activar empresa' : 'Desactivar empresa',
      activar ? `${e.razon_social}: sus permisos Ver/Operar vuelven a tener efecto.` : `${e.razon_social}: se suspenden los permisos Ver/Operar de todos los usuarios sobre sus cuentas hasta que se reactive.`,
      activar ? 'Activar' : 'Desactivar');
    if (!ok) return;
    try { await api(`/admin/empresas/${e.id}`, { method: 'PATCH', body: { activa: activar } }); toast(`${e.razon_social} ${activar ? 'activada' : 'desactivada'}.`); } catch (x) { error(x); }
    await cargar();
  };
  const eliminar = async (e) => {
    if (!(await confirmar('Eliminar empresa', `${e.razon_social}: sus cuentas pasan a estado "baja" (quedan en el historial con el CUIT) y se quitan todos los permisos sobre ella. Queda registrado en auditoría.`, 'Eliminar'))) return;
    try {
      const r = await api(`/admin/empresas/${e.id}`, { method: 'DELETE' });
      toast(`${e.razon_social} eliminada · ${r.cuentasLiberadas.length} cuentas dadas de baja · ${r.permisosQuitados.length} permisos quitados.`);
      if (elegida?.id === e.id) elegida = null;
    } catch (x) { error(x); }
    await cargar();
  };

  const dibujarLista = () => poner(lista, tabla([
    { t: 'Razón social', v: (e) => e.razon_social }, { t: 'CUIT', v: (e) => e.cuit, cls: 'mono' },
    { t: 'Emails', v: (e) => (e.emails?.length ? e.emails.join(', ') : pill('Sin email', 'warn')) }, { t: 'Cuentas', v: (e) => e.cuentas, cls: 'num' },
    { t: 'Estado', v: (e) => pill(e.activa ? 'Activa' : 'Inactiva', e.activa ? 'ok' : 'warn') }, { t: 'Alta', v: (e) => `${fecha(e.creada_en)} · ${e.creada_por}` },
    { t: 'Acción', cls: 'acc', v: (e) => h('span', {},
      h('button', { class: 'btn chico', onclick: (ev) => { ev.stopPropagation(); cambiarEstado(e); } }, e.activa ? 'Desactivar' : 'Activar'),
      h('button', { class: 'btn chico', onclick: (ev) => { ev.stopPropagation(); eliminar(e); } }, 'Eliminar')) },
  ], empresas, { alClic: (e) => { elegida = e; dibujarLista(); dibujarDetalle(); }, sel: (e) => e.id === elegida?.id, vacio: 'No hay empresas cargadas.' }));

  // Emails de la empresa: se agregan de a uno o varios (separados por coma) y se quitan con ✕
  const cardEmails = (e) => {
    const nuevo = h('input', { type: 'email', placeholder: 'tesoreria@empresa.com.ar', multiple: true });
    const guardar = async (emails, msj) => {
      try { await api(`/admin/empresas/${e.id}/emails`, { method: 'PUT', body: { emails } }); toast(msj); } catch (x) { error(x); return; }
      await cargar();
    };
    const agregar = () => {
      const lista = separarEmails(nuevo.value);
      if (!lista.length) return toast('Escribí un email.', true);
      guardar([...(e.emails ?? []), ...lista], `${lista.join(', ')} agregado.`);
    };
    nuevo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') agregar(); });
    const quitar = (mail) => {
      if ((e.emails ?? []).length <= 1) return toast('La empresa tiene que tener al menos un email: agregá otro antes de quitar este.', true);
      guardar(e.emails.filter((x) => x !== mail), `${mail} quitado.`);
    };
    return card(`Emails de ${e.razon_social}`, 'Contactos de la empresa. Puede tener más de uno.',
      h('div', { class: 'fila' }, ...(e.emails ?? []).map((m) => h('span', { class: 'chip' }, m, h('button', { class: 'chip-x', title: `Quitar ${m}`, 'aria-label': `Quitar ${m}`, onclick: () => quitar(m) }, '✕')))),
      !(e.emails ?? []).length && h('p', { class: 'aviso' }, 'Esta empresa no tiene emails cargados.'),
      h('div', { class: 'fila' }, campo('Agregar email', nuevo), h('button', { class: 'btn', onclick: agregar }, 'Agregar')));
  };

  // "Agregar cuentas": solo las que no están asignadas a ninguna empresa, con buscador y selección múltiple
  const agregarCuentas = async (e) => {
    let disponibles;
    try { disponibles = await api('/admin/cuentas-disponibles'); } catch (x) { return error(x); }
    if (!disponibles.length) return toast('No quedan cuentas sin asignar.', true);
    const elegidas = new Set();
    const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, descripción, número o CBU (contiene)', autofocus: true });
    const cuerpo = h('div', {}), contador = h('span', { class: 'nota' }), boton = h('button', { class: 'btn primario', disabled: true }, 'Agregar seleccionadas');
    const filtradas = () => disponibles.filter((c) => coincide(c, buscar.value));
    const actualizar = () => {
      contador.textContent = `${elegidas.size} seleccionada(s) · ${filtradas().length} de ${disponibles.length} cuentas`;
      boton.disabled = !elegidas.size;
    };
    const dibujar = () => {
      const f = filtradas();
      const todas = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todas las que se ven', checked: f.length > 0 && f.every((c) => elegidas.has(c.cuenta)) });
      todas.addEventListener('change', () => { f.forEach((c) => (todas.checked ? elegidas.add(c.cuenta) : elegidas.delete(c.cuenta))); dibujar(); });
      poner(cuerpo,
        h('label', { class: 'campo check' }, todas, `Seleccionar las ${f.length} que se ven`),
        h('div', { class: 'lista-scroll' }, tabla([
          { t: '', cls: 'c', v: (c) => { const x = h('input', { type: 'checkbox', checked: elegidas.has(c.cuenta), 'aria-label': `Elegir ${c.cuenta}` }); x.addEventListener('change', () => { x.checked ? elegidas.add(c.cuenta) : elegidas.delete(c.cuenta); dibujar(); }); return x; } },
          { t: 'Nombre', v: (c) => c.nombre }, { t: 'Cuenta', v: (c) => c.cuenta, cls: 'mono' },
          { t: 'CBU', v: (c) => (c.cbu ? h('span', { class: 'mono' }, c.cbu) : pill('Sin CBU del banco', 'warn')) },
          { t: 'Descripción', v: (c) => c.alias }, { t: 'Moneda', v: (c) => c.moneda },
        ], f, { vacio: 'Ninguna cuenta coincide con la búsqueda.' })));
      actualizar();
    };
    buscar.addEventListener('input', dibujar);
    const cerrar = modal(`Agregar cuentas a ${e.razon_social}`,
      h('p', { class: 'nota' }, 'Solo se listan las cuentas que no están asignadas a ninguna empresa. Una cuenta pertenece a una sola empresa.'),
      h('p', { class: 'nota' }, 'Al agregar, cada cuenta se consulta en COELSA y se guardan su CBU, alias y titular.'),
      campo('Buscar', buscar), cuerpo, h('div', { class: 'fila' }, boton, contador));
    boton.addEventListener('click', async () => {
      boton.disabled = true; boton.textContent = `Consultando COELSA (${elegidas.size})…`;
      try {
        const r = await api(`/admin/empresas/${e.id}/cuentas`, { method: 'POST', body: { cuentas: [...elegidas] } });
        cerrar();
        if (r.rechazadas.length) {
          modal('Cuentas no agregadas', h('p', {}, `${r.agregadas.length} agregada(s). Estas no se agregaron porque COELSA no devolvió su CBU y alias:`),
            tabla([{ t: 'Cuenta', v: (x) => x.cuenta, cls: 'mono' }, { t: 'Motivo', v: (x) => x.motivo }], r.rechazadas));
        } else toast(`${r.agregadas.length} cuenta(s) agregada(s) a ${e.razon_social} con CBU y alias de COELSA.`);
      } catch (x) { error(x); boton.disabled = false; boton.textContent = 'Agregar seleccionadas'; return; }
      await cargar();
    });
    dibujar();
    buscar.focus();
  };

  const quitarCuenta = async (e, c) => {
    if (!(await confirmar('Dar de baja cuenta', `${c.cuenta}${c.alias ? ` (alias ${c.alias})` : ''} deja de pertenecer a ${e.razon_social}: la relación pasa a estado "baja" y queda en el historial. Los usuarios con permiso sobre la empresa dejan de verla y la cuenta vuelve a estar disponible.`, 'Dar de baja'))) return;
    try { await api(`/admin/empresas/${e.id}/cuentas/${encodeURIComponent(c.cuenta)}`, { method: 'DELETE' }); toast(`Cuenta ${c.cuenta} dada de baja.`); } catch (x) { error(x); }
    await cargar();
  };
  const reconsultar = async (e, c) => {
    try { const r = await api(`/admin/empresas/${e.id}/cuentas/${encodeURIComponent(c.cuenta)}/coelsa`, { method: 'POST' }); toast(`COELSA: CBU ${r.cbu} · alias ${r.alias ?? '—'}.`); } catch (x) { error(x); }
    await cargar();
  };

  const dibujarDetalle = async () => {
    if (!elegida) return poner(detalle, card('Cuentas de la empresa', 'Elegí una empresa de la lista para ver sus emails y cuentas.'));
    const e = elegida;
    poner(detalle, cardEmails(e), cargando());
    let cuentas;
    try { cuentas = await api(`/admin/empresas/${e.id}/cuentas`); } catch (x) { return poner(detalle, cardEmails(e), card(`Cuentas de ${e.razon_social}`, null, h('p', { class: 'aviso rojo' }, `No se pudieron leer las cuentas del banco: ${x.message}`))); }
    if (elegida?.id !== e.id) return; // se eligió otra mientras cargaba
    const activas = cuentas.filter((c) => c.estado === 'activa'), bajas = cuentas.filter((c) => c.estado === 'baja');
    const cbu = (c) => (c.cbu ? h('span', { class: 'mono' }, c.cbu) : pill('CBU pendiente', 'warn'));
    poner(detalle, cardEmails(e), card(`Cuentas de ${e.razon_social} · CUIT ${e.cuit}`, 'Cada cuenta (CBU) tiene una sola relación activa con una empresa. "Agregar cuentas" muestra solo las que no tienen empresa; el CBU y el alias salen de COELSA.',
      !e.activa && h('p', { class: 'aviso rojo' }, 'Empresa inactiva: los permisos sobre estas cuentas están suspendidos.'),
      h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => agregarCuentas(e) }, 'Agregar cuentas')),
      tabla([
        { t: 'Nombre', v: (c) => c.nombre }, { t: 'Cuenta', v: (c) => c.cuenta, cls: 'mono' }, { t: 'CBU', v: cbu }, { t: 'Alias (COELSA)', v: (c) => c.alias ?? '' },
        { t: 'Titular', v: (c) => [c.titular, c.cuitTitular].filter(Boolean).join(' · ') }, { t: 'Moneda', v: (c) => c.moneda },
        { t: 'Alta', v: (c) => `${fecha(c.asignadaEn)} · ${c.asignadaPor}` },
        { t: 'Acción', cls: 'acc', v: (c) => h('span', {},
          !c.cbu && h('button', { class: 'btn chico', onclick: () => reconsultar(e, c) }, 'Consultar COELSA'),
          h('button', { class: 'btn chico', onclick: () => quitarCuenta(e, c) }, 'Dar de baja')) },
      ], activas, { vacio: 'La empresa no tiene cuentas activas. Usá "Agregar cuentas".' }),
      bajas.length > 0 && h('details', {}, h('summary', {}, `Historial: ${bajas.length} cuenta(s) dada(s) de baja`),
        tabla([
          { t: 'Cuenta', v: (c) => c.cuenta, cls: 'mono' }, { t: 'CBU', v: cbu }, { t: 'Alias', v: (c) => c.alias ?? '' },
          { t: 'Estado', v: () => pill('Baja', 'warn') }, { t: 'Alta', v: (c) => `${fecha(c.asignadaEn)} · ${c.asignadaPor}` }, { t: 'Baja', v: (c) => `${fecha(c.bajaEn)} · ${c.bajaPor}` },
        ], bajas))));
  };

  const razon = h('input', { placeholder: 'Razón social' }), cuit = h('input', { placeholder: '30712345678', inputmode: 'numeric', maxlength: 11 });
  const emails = h('input', { placeholder: 'tesoreria@empresa.com.ar, pagos@empresa.com.ar', multiple: true });
  const alta = async () => {
    if (!razon.value.trim() || !/^\d{11}$/.test(cuit.value.trim())) return toast('Completá la razón social y un CUIT de 11 dígitos.', true);
    if (!separarEmails(emails.value).length) return toast('Cargá al menos un email de la empresa (varios, separados por coma).', true);
    try {
      const e = await api('/admin/empresas', { method: 'POST', body: { razonSocial: razon.value.trim(), cuit: cuit.value.trim(), emails: separarEmails(emails.value) } });
      toast(`${e.razon_social ?? razon.value} dada de alta.`); razon.value = ''; cuit.value = ''; emails.value = ''; elegida = e;
    } catch (x) { error(x); }
    await cargar();
  };

  poner(main, 
    card('Empresas', 'Maestro de empresas: los permisos de los usuarios se dan por empresa (Ver / Operar) sobre las cuentas asignadas. Desactivar suspende los permisos; eliminar libera las cuentas y quita los permisos.',
      h('div', { class: 'fila' }, campo('Razón social', razon), campo('CUIT', cuit), campo('Emails (uno o más, separados por coma)', emails), h('button', { class: 'btn primario', onclick: alta }, 'Dar de alta')),
      lista),
    detalle);
  await cargar().catch(error);
}
