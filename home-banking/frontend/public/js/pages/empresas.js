// Maestro de empresas (administrador de seguridad): alta, cuentas asignadas, activar/desactivar y baja.
import { api } from '../api.js';
import { h, poner, card, campo, tabla, pill, fecha, confirmar, toast, error, cargando } from '../ui.js';

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
    if (!(await confirmar('Eliminar empresa', `${e.razon_social}: se liberan sus cuentas (quedan sin asignar) y se quitan todos los permisos sobre ella. Queda registrado en auditoría.`, 'Eliminar'))) return;
    try {
      const r = await api(`/admin/empresas/${e.id}`, { method: 'DELETE' });
      toast(`${e.razon_social} eliminada · ${r.cuentasLiberadas} cuentas liberadas · ${r.permisosQuitados} permisos quitados.`);
      if (elegida?.id === e.id) elegida = null;
    } catch (x) { error(x); }
    await cargar();
  };

  const dibujarLista = () => poner(lista, tabla([
    { t: 'Razón social', v: (e) => e.razon_social }, { t: 'CUIT', v: (e) => e.cuit, cls: 'mono' }, { t: 'Cuentas', v: (e) => e.cuentas, cls: 'num' },
    { t: 'Estado', v: (e) => pill(e.activa ? 'Activa' : 'Inactiva', e.activa ? 'ok' : 'warn') }, { t: 'Alta', v: (e) => `${fecha(e.creada_en)} · ${e.creada_por}` },
    { t: 'Acción', cls: 'acc', v: (e) => h('span', {},
      h('button', { class: 'btn chico', onclick: (ev) => { ev.stopPropagation(); cambiarEstado(e); } }, e.activa ? 'Desactivar' : 'Activar'),
      h('button', { class: 'btn chico', onclick: (ev) => { ev.stopPropagation(); eliminar(e); } }, 'Eliminar')) },
  ], empresas, { alClic: (e) => { elegida = e; dibujarLista(); dibujarDetalle(); }, sel: (e) => e.id === elegida?.id, vacio: 'No hay empresas cargadas.' }));

  const dibujarDetalle = async () => {
    if (!elegida) return poner(detalle, card('Cuentas de la empresa', 'Elegí una empresa de la lista para asignarle cuentas.'));
    poner(detalle, cargando());
    const cuentas = await api(`/admin/empresas/${elegida.id}/cuentas`);
    const checks = cuentas.map((c) => [c, h('input', { type: 'checkbox', checked: c.asignada })]);
    const guardar = async () => {
      try {
        const r = await api(`/admin/empresas/${elegida.id}/cuentas`, { method: 'PUT', body: { cuentas: checks.filter(([, x]) => x.checked).map(([c]) => c.cuenta) } });
        toast(`Asignación guardada · ${r.altas} altas · ${r.bajas} bajas.`);
      } catch (x) { error(x); }
      await cargar();
    };
    poner(detalle, card(`Cuentas de ${elegida.razon_social}`, 'Se listan las cuentas sin asignar y las que ya son de esta empresa. Una cuenta pertenece a una sola empresa.',
      !elegida.activa && h('p', { class: 'aviso rojo' }, 'Empresa inactiva: los permisos sobre estas cuentas están suspendidos.'),
      tabla([
        { t: 'Asignada', v: ([, x]) => x, cls: 'c' }, { t: 'Cuenta', v: ([c]) => c.cuenta, cls: 'mono' }, { t: 'Alias', v: ([c]) => c.alias ?? '' }, { t: 'Moneda', v: ([c]) => c.moneda },
      ], checks, { vacio: 'No hay cuentas sin asignar.' }),
      h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: guardar }, 'Guardar asignación'))));
  };

  const razon = h('input', { placeholder: 'Razón social' }), cuit = h('input', { placeholder: '30712345678', inputmode: 'numeric', maxlength: 11 });
  const alta = async () => {
    if (!razon.value.trim() || !/^\d{11}$/.test(cuit.value.trim())) return toast('Completá la razón social y un CUIT de 11 dígitos.', true);
    try {
      const e = await api('/admin/empresas', { method: 'POST', body: { razonSocial: razon.value.trim(), cuit: cuit.value.trim() } });
      toast(`${e.razon_social ?? razon.value} dada de alta.`); razon.value = ''; cuit.value = ''; elegida = e;
    } catch (x) { error(x); }
    await cargar();
  };

  poner(main, 
    card('Empresas', 'Maestro de empresas: los permisos de los usuarios se dan por empresa (Ver / Operar) sobre las cuentas asignadas. Desactivar suspende los permisos; eliminar libera las cuentas y quita los permisos.',
      h('div', { class: 'fila' }, campo('Razón social', razon), campo('CUIT', cuit), h('button', { class: 'btn primario', onclick: alta }, 'Dar de alta')),
      lista),
    detalle);
  await cargar().catch(error);
}
