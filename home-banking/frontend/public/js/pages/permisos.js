// Permisos (administrador de seguridad): roles Crear/Aprobar en Keycloak y Ver/Operar por empresa.
import { api } from '../api.js';
import { h, poner, card, tabla, pill, toast, error, cargando } from '../ui.js';

const ROL = { administrador: 'Administrador', auditor: 'Auditor', autorizante: 'Autorizante', operador: 'Operador', sin_rol: 'Sin rol' };

export async function render(main, ctx) {
  let usuarios = [], elegido = null;
  const lista = h('div', {}, cargando()), detalle = h('div', {});

  const cargar = async () => {
    usuarios = await api('/admin/usuarios');
    if (elegido) elegido = usuarios.find((u) => u.usuario === elegido.usuario) ?? null;
    dibujarLista();
    await dibujarDetalle();
  };

  const dibujarLista = () => poner(lista, tabla([
    { t: 'Usuario', v: (u) => u.usuario, cls: 'mono' }, { t: 'Nombre', v: (u) => u.nombre }, { t: 'Perfil', v: (u) => ROL[u.rol] ?? u.rol },
    { t: 'Crear', v: (u) => (u.crear ? pill('Sí', 'ok') : '—'), cls: 'c' }, { t: 'Aprobar', v: (u) => (u.aprobar ? pill('Sí', 'ok') : '—'), cls: 'c' },
  ], usuarios, { alClic: (u) => { elegido = u; dibujarLista(); dibujarDetalle(); }, sel: (u) => u.usuario === elegido?.usuario, vacio: 'No hay usuarios con roles de Home Banking en Keycloak.' }));

  const dibujarDetalle = async () => {
    if (!elegido) return poner(detalle, card('Permisos del usuario', 'Elegí un usuario de la lista.'));
    const u = elegido;
    if (u.rol === 'administrador') return poner(detalle, card(`Permisos de ${u.usuario}`, null, h('p', { class: 'aviso' }, 'El administrador de seguridad no puede recibir roles de operación ni permisos sobre empresas.')));
    if (u.usuario === ctx.me.usuario) return poner(detalle, card('Tus permisos', null, h('p', { class: 'aviso' }, 'No podés modificar tus propios permisos.')));
    poner(detalle, cargando());
    const permisos = await api(`/admin/permisos/${encodeURIComponent(u.usuario)}`);

    const crear = h('input', { type: 'checkbox', checked: u.crear }), aprobar = h('input', { type: 'checkbox', checked: u.aprobar });
    const guardarRoles = async () => {
      try {
        const r = await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/roles`, { method: 'PUT', body: { crear: crear.checked, aprobar: aprobar.checked } });
        toast(r.cambios.length ? `${u.usuario}: ${r.cambios.join(' · ')}.` : 'Sin cambios.');
      } catch (x) { error(x); }
      await cargar();
    };

    const filas = permisos.map((p) => {
      const ver = h('input', { type: 'checkbox', checked: p.ver }), operar = h('input', { type: 'checkbox', checked: p.operar });
      operar.addEventListener('change', () => { if (operar.checked) ver.checked = true; });
      ver.addEventListener('change', () => { if (!ver.checked) operar.checked = false; });
      return { p, ver, operar };
    });
    const guardarPermisos = async () => {
      try {
        const r = await api(`/admin/permisos/${encodeURIComponent(u.usuario)}`, { method: 'PUT', body: { permisos: filas.map(({ p, ver, operar }) => ({ empresaId: p.empresa_id, ver: ver.checked, operar: operar.checked })) } });
        toast(r.cambios?.length ? `${u.usuario}: ${r.cambios.length} cambios guardados.` : 'Sin cambios.');
      } catch (x) { error(x); }
      await cargar();
    };

    poner(detalle, 
      card(`Roles de transferencias · ${u.usuario}`, 'Se guardan en Keycloak. Una persona puede tener ambos, pero nunca aprueba lo que cargó ella misma.',
        h('div', { class: 'campos' },
          h('label', { class: 'campo check' }, crear, 'Crear: carga transferencias y lotes (quedan pendientes de aprobación)'),
          h('label', { class: 'campo check' }, aprobar, 'Aprobar: aprueba o rechaza lo que cargó otro usuario; aprobar envía al banco')),
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: guardarRoles }, 'Guardar roles'))),
      card(`Empresas · ${u.usuario}`, 'Ver: consulta saldos y movimientos de las cuentas de la empresa. Operar: además puede usarlas como origen de transferencias. Las empresas inactivas no dan acceso aunque estén tildadas.',
        tabla([
          { t: 'Empresa', v: (f) => f.p.razon_social }, { t: 'CUIT', v: (f) => f.p.cuit, cls: 'mono' },
          { t: 'Estado', v: (f) => pill(f.p.activa ? 'Activa' : 'Inactiva', f.p.activa ? 'ok' : 'warn') },
          { t: 'Ver', v: (f) => f.ver, cls: 'c' }, { t: 'Operar', v: (f) => f.operar, cls: 'c' },
        ], filas, { vacio: 'No hay empresas cargadas.' }),
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: guardarPermisos }, 'Guardar permisos'))));
  };

  poner(main, 
    h('div', { class: 'grid' },
      card('Usuarios', 'Usuarios con algún rol de Home Banking en el realm de VALO. El alta de usuarios y sus claves se gestionan en Keycloak.', lista),
      detalle));
  await cargar().catch(error);
}
