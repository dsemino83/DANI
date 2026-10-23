// Usuarios y permisos (administrador de seguridad): alta, edición y baja de usuarios, perfil, habilitación, desbloqueo y claves
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

  // Datos de la cuenta en el SSO: perfil, habilitación, bloqueo y clave
  const cardCuenta = (u, est) => {
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
    const accion = async (ruta, titulo, texto, boton, ok) => {
      if (!(await confirmar(titulo, texto, boton))) return;
      try { const r = await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/${ruta}`, { method: 'POST' }); toast(ok(r)); } catch (x) { error(x); }
      await cargar();
    };
    const desbloquear = () => accion('desbloquear', 'Desbloquear usuario', `${u.usuario} quedó bloqueado por intentos fallidos de ingreso. Se quita el bloqueo y puede volver a intentar.`, 'Desbloquear', () => `${u.usuario} desbloqueado.`);
    const forzar = () => accion('forzar-cambio-clave', 'Forzar cambio de clave', `${u.usuario} entra con su clave actual y en ese momento tiene que elegir una nueva. Se cierran sus sesiones abiertas.`, 'Forzar cambio', () => `${u.usuario} elige una clave nueva en su próximo ingreso.`);
    const correo = () => accion('correo-clave', 'Enviar correo para cambiar la clave', `Se envía a ${est?.email || u.email} un link, válido 24 horas, para que ${u.usuario} elija una clave nueva.`, 'Enviar correo', (r) => `Correo enviado a ${r.email}.`);
    const estado = est ? [
      pill(est.habilitado ? 'Habilitado' : 'Deshabilitado', est.habilitado ? 'ok' : 'bad'),
      est.bloqueado && pill(`Bloqueado por intentos fallidos (${est.intentosFallidos})`, 'bad'),
      est.debeCambiarClave && pill('Debe cambiar la clave', 'warn'),
      est.requiereOtp && pill(est.otpConfigurado ? 'OTP obligatorio' : 'OTP pendiente de enrolar', est.otpConfigurado ? 'ok' : 'warn'),
    ].filter(Boolean) : [pill('Estado no disponible', 'warn')];
    // OTP por usuario: lo define el administrador. Activar = lo enrola en el próximo ingreso; desactivar
    // borra sus credenciales OTP (se confirma, porque le saca un factor de seguridad).
    const otp = h('input', { type: 'checkbox', checked: !!est?.requiereOtp, disabled: !est });
    otp.addEventListener('change', async () => {
      const activar = otp.checked;
      if (!activar && !(await confirmar('Quitar OTP obligatorio',
        `${u.usuario} deja de necesitar código OTP para ingresar y se borran sus credenciales OTP del SSO (tendrá que volver a configurarlo si se reactiva). Se cierran sus sesiones abiertas.`, 'Quitar OTP'))) { otp.checked = true; return; }
      otp.disabled = true;
      try {
        await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/otp`, { method: 'PUT', body: { requiereOtp: activar } });
        toast(activar ? `${u.usuario}: OTP obligatorio. Configura la app de autenticación en su próximo ingreso.` : `${u.usuario}: OTP ya no es obligatorio.`);
      } catch (x) { otp.checked = !activar; error(x); }
      otp.disabled = false;
      await cargar();
    });
    const datos = { nombre: h('input', { value: u.nombres ?? '' }), apellido: h('input', { value: u.apellido ?? '' }), email: h('input', { type: 'email', value: u.email ?? '' }) };
    const guardarDatos = async () => {
      try {
        const r = await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/datos`, { method: 'PUT', body: { nombre: datos.nombre.value, apellido: datos.apellido.value, email: datos.email.value } });
        toast(r.cambios.length ? `${u.usuario}: ${r.cambios.join(' · ')}.` : 'Sin cambios.');
      } catch (x) { error(x); return; }
      await cargar();
    };
    const eliminar = async () => {
      if (!(await confirmar('Eliminar usuario', `${u.usuario} se borra del inicio de sesión y pierde todos sus permisos por empresa. No se puede deshacer: para que vuelva a ingresar hay que darlo de alta de nuevo. Su historial en la auditoría se conserva.`, 'Eliminar usuario'))) return;
      try { await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}`, { method: 'DELETE' }); toast(`${u.usuario} eliminado.`); elegido = null; } catch (x) { error(x); return; }
      await cargar();
    };
    return card(`Usuario · ${u.usuario}`, `${u.nombre || ''}${u.email ? ` · ${u.email}` : ''}`,
      h('div', { class: 'fila' }, ...estado),
      h('div', { class: 'fila' }, campo('Nombre', datos.nombre), campo('Apellido', datos.apellido), campo('Email', datos.email),
        h('button', { class: 'btn', onclick: guardarDatos }, 'Guardar datos')),
      h('div', { class: 'fila' }, campo('Perfil', perfil), h('button', { class: 'btn primario', onclick: guardarPerfil }, 'Guardar perfil'),
        h('button', { class: 'btn', onclick: cambiarEstado }, u.habilitado === false ? 'Habilitar' : 'Deshabilitar'),
        est?.bloqueado && h('button', { class: 'btn', onclick: desbloquear }, 'Desbloquear')),
      h('div', { class: 'fila' }, h('label', { class: 'campo check' }, otp, 'Requiere OTP (código de la app de autenticación) para ingresar'),
        est?.otpPendiente && !est?.otpConfigurado && h('span', { class: 'nota' }, 'Lo configura en su próximo ingreso.')),
      h('p', { class: 'nota' }, 'Clave: enviale un correo para que la cambie él mismo, obligalo a cambiarla en su próximo ingreso, o cargale una clave temporal.'),
      h('div', { class: 'fila' },
        h('button', { class: 'btn', onclick: correo, disabled: !(est?.email || u.email) }, 'Enviar correo para cambiar la clave'),
        h('button', { class: 'btn', onclick: forzar }, 'Forzar cambio en el próximo ingreso')),
      h('div', { class: 'fila' }, campo('Nueva clave temporal', clave), h('button', { class: 'btn', onclick: restablecer }, 'Restablecer clave')),
      h('div', { class: 'fila' }, h('button', { class: 'btn peligro', onclick: eliminar }, 'Eliminar usuario')));
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
    const est = await api(`/admin/usuarios/${encodeURIComponent(u.usuario)}/estado`).catch(() => null);
    if (elegido?.usuario !== u.usuario) return; // se eligió otro mientras cargaba
    const cuenta = cardCuenta(u, est);
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
      card('Usuarios', 'Usuarios con algún perfil de Home Banking en el SSO. Elegí uno para cambiar su perfil, habilitarlo, desbloquearlo o gestionar su clave, y para asignarle roles y empresas.',
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => { altaAbierta = true; dibujarAlta(); } }, 'Nuevo usuario')),
        lista),
      detalle));
  await cargar().catch(error);
}
