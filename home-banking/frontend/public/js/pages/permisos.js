// Usuarios y permisos (administrador de seguridad): alta de usuarios, perfil, habilitación y clave temporal
// en Keycloak; roles Crear/Aprobar; Ver/Operar por empresa. Todo queda en la auditoría.
import { api } from '../api.js';
import { h, poner, card, campo, tabla, pill, toast, error, cargando, confirmar } from '../ui.js';

const ROL = { administrador: 'Administrador', auditor: 'Auditor', autorizante: 'Autorizante', operador: 'Operador', sin_rol: 'Sin rol' };
const PERFILES = ['operador', 'autorizante', 'auditor', 'administrador'];
const selPerfil = (actual) => h('select', {}, PERFILES.map((p) => h('option', { value: p, selected: p === actual }, ROL[p])));

export async function render(main, ctx) {
  let usuarios = [], elegido = null, altaAbierta = false;
  const lista = h('div', {}, cargando()), detalle = h('div', {}), alta = h('div', {});

  const cargar = async () => {
    usuarios = await api('/admin/usuarios');
    if (elegido) elegido = usuarios.find((u) => u.usuario === elegido.usuario) ?? null;
    dibujarLista();
    await dibujarDetalle();
  };

  const dibujarLista = () => poner(lista, tabla([
    { t: 'Usuario', v: (u) => u.usuario, cls: 'mono' }, { t: 'Nombre', v: (u) => u.nombre }, { t: 'Perfil', v: (u) => ROL[u.rol] ?? u.rol },
    { t: 'Crear', v: (u) => (u.crear ? pill('Sí', 'ok') : '—'), cls: 'c' }, { t: 'Aprobar', v: (u) => (u.aprobar ? pill('Sí', 'ok') : '—'), cls: 'c' },
    { t: 'Estado', v: (u) => pill(u.habilitado === false ? 'Deshabilitado' : 'Habilitado', u.habilitado === false ? 'bad' : 'ok') },
  ], usuarios, { alClic: (u) => { elegido = u; dibujarLista(); dibujarDetalle(); }, sel: (u) => u.usuario === elegido?.usuario, vacio: 'No hay usuarios con roles de Home Banking en Keycloak.' }));

  // Datos de la cuenta en el SSO: perfil, habilitación y clave temporal
  const cardCuenta = (u) => {
    const perfil = selPerfil(u.rol);
    const clave = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 12, con letras y números' });
    const guardarPerfil = async () => {
      if (perfil.value === u.rol) return toast('Sin cambios.');
      const aAdmin = perfil.value === 'administrador';
      if (!(await confirmar('Cambiar perfil', `${u.usuario}: ${ROL[u.rol] ?? u.rol} → ${ROL[perfil.value]}.${aAdmin ? ' Como administrador de seguridad pierde los roles Crear/Aprobar y todos sus permisos por empresa.' : ''}`, 'Cambiar perfil'))) return;
      try { await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/perfil`, { method: 'PUT', body: { perfil: perfil.value } }); toast(`${u.usuario}: perfil ${ROL[perfil.value]}.`); } catch (x) { error(x); }
      await cargar();
    };
    const cambiarEstado = async () => {
      const habilitar = u.habilitado === false;
      if (!(await confirmar(habilitar ? 'Habilitar usuario' : 'Deshabilitar usuario', habilitar ? `${u.usuario} vuelve a poder ingresar.` : `${u.usuario} no podrá ingresar y se cierran sus sesiones abiertas. Sus permisos se conservan.`, habilitar ? 'Habilitar' : 'Deshabilitar'))) return;
      try { await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}`, { method: 'PATCH', body: { habilitado: habilitar } }); toast(`${u.usuario} ${habilitar ? 'habilitado' : 'deshabilitado'}.`); } catch (x) { error(x); }
      await cargar();
    };
    const restablecer = async () => {
      if (!clave.value) return toast('Ingresá la clave temporal.', true);
      try {
        await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/clave`, { method: 'POST', body: { claveTemporal: clave.value } });
        toast(`Clave temporal cargada: ${u.usuario} la cambia en su próximo ingreso. Comunicásela por un canal seguro.`);
      } catch (x) { error(x); }
      clave.value = '';
    };
    return card(`Usuario · ${u.usuario}`, `${u.nombre || ''}${u.email ? ` · ${u.email}` : ''}`,
      h('div', { class: 'fila' }, campo('Perfil', perfil), h('button', { class: 'btn primario', onclick: guardarPerfil }, 'Guardar perfil'),
        h('button', { class: 'btn', onclick: cambiarEstado }, u.habilitado === false ? 'Habilitar' : 'Deshabilitar')),
      h('div', { class: 'fila' }, campo('Nueva clave temporal', clave), h('button', { class: 'btn', onclick: restablecer }, 'Restablecer clave')));
  };

  // Alta de usuario en el SSO
  const dibujarAlta = () => {
    if (!altaAbierta) return poner(alta);
    const f = {
      usuario: h('input', { autocomplete: 'off', placeholder: 'jperez' }), nombre: h('input', {}), apellido: h('input', {}),
      email: h('input', { type: 'email', placeholder: 'jperez@valo.ar' }), perfil: selPerfil('operador'),
      clave: h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 12, con letras y números' }),
    };
    const crear = async () => {
      try {
        const r = await api('/admin/usuarios', { method: 'POST', body: { usuario: f.usuario.value, nombre: f.nombre.value, apellido: f.apellido.value, email: f.email.value, perfil: f.perfil.value, claveTemporal: f.clave.value } });
        toast(`${r.usuario} creado con perfil ${ROL[r.perfil]}. Cambia la clave en su primer ingreso; después asignale Crear/Aprobar y empresas.`);
        altaAbierta = false; dibujarAlta();
        await cargar();
        elegido = usuarios.find((u) => u.usuario === r.usuario) ?? null; dibujarLista(); await dibujarDetalle();
      } catch (x) { error(x); }
    };
    poner(alta, card('Nuevo usuario', 'Se crea en el SSO con una clave temporal que debe cambiar en el primer ingreso. Comunicá la clave por un canal seguro.',
      h('div', { class: 'campos' }, campo('Usuario', f.usuario), campo('Email', f.email), campo('Nombre', f.nombre), campo('Apellido', f.apellido),
        campo('Perfil', f.perfil), campo('Clave temporal', f.clave)),
      h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: crear }, 'Crear usuario'),
        h('button', { class: 'btn', onclick: () => { altaAbierta = false; dibujarAlta(); } }, 'Cancelar'))));
  };

  const dibujarDetalle = async () => {
    if (!elegido) return poner(detalle, card('Permisos del usuario', 'Elegí un usuario de la lista.'));
    const u = elegido;
    if (u.usuario === ctx.me.usuario) return poner(detalle, card('Tu usuario', null, h('p', { class: 'aviso' }, 'No podés modificar tu propio usuario ni tus permisos.')));
    const cuenta = cardCuenta(u);
    if (u.rol === 'administrador') return poner(detalle, cuenta, card(`Permisos de ${u.usuario}`, null, h('p', { class: 'aviso' }, 'El administrador de seguridad no puede recibir roles de operación ni permisos sobre empresas.')));
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

    poner(detalle, cuenta,
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
    alta,
    h('div', { class: 'grid' },
      card('Usuarios', 'Usuarios con algún perfil de Home Banking en el SSO. Elegí uno para cambiar su perfil, habilitarlo o restablecer su clave, y para asignarle roles y empresas.',
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => { altaAbierta = true; dibujarAlta(); } }, 'Nuevo usuario')),
        lista),
      detalle));
  await cargar().catch(error);
}
