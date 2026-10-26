// Credenciales API Banking de VALO, por ambiente: la principal (Home Banking) y una adicional, exclusiva de los
// envíos programados de correo. La clave es de solo escritura: nunca se muestra.
import { api } from '../api.js';
import { h, poner, card, campo, seg, pill, fechaHora, confirmar, toast, error, cargando } from '../ui.js';

export async function render(main) {
  let amb = 'homo', uso = 'principal';
  const cuerpo = h('div', {}, cargando());
  const selector = h('div', { class: 'fila' });
  const pintarSelector = () => poner(selector,
    seg([['homo', 'Homologación'], ['prod', 'Producción']], amb, (v) => { amb = v; pintarSelector(); dibujar().catch(error); }),
    seg([['principal', 'Principal (Home Banking)'], ['envios', 'Envíos programados']], uso, (v) => { uso = v; pintarSelector(); dibujar().catch(error); }));
  pintarSelector();
  const ruta = (extra = '') => `/admin/credenciales/${amb}${extra}?uso=${uso}`;
  const nombreUso = () => (uso === 'envios' ? 'de envíos programados' : 'principal');

  const dibujar = async () => {
    poner(cuerpo, cargando());
    const e = await api(ruta());
    const f = {
      url: h('input', { value: e.url ?? '', readonly: true, title: 'La define el ambiente; no se edita' }),
      usuario: h('input', { value: e.usuario ?? '', autocomplete: 'off' }),
      identification: h('input', { inputmode: 'numeric', maxlength: 11, autocomplete: 'off', placeholder: e.configurada ? `${e.identification} · vacío = se conserva` : 'DNI / CUIT del usuario API' }),
      terminal: h('input', { value: e.terminal ?? '', autocomplete: 'off' }),
      channel: h('input', { value: e.channel ?? '3', inputmode: 'numeric', maxlength: 4, autocomplete: 'off' }), // solo en envíos programados
      clave: h('input', { type: 'password', autocomplete: 'new-password', placeholder: e.configurada ? 'Vacío = se conserva la actual' : 'Clave del usuario API' }),
      yaCifrada: h('input', { type: 'checkbox', checked: !!e.claveYaCifrada }),
      aviso: h('div', {}),
      rsa: h('textarea', { rows: 4, spellcheck: false, placeholder: e.rsaCargada ? 'Vacío = se conserva la llave actual' : 'Llave pública RSA del banco (base64 o PEM)' }),
    };
    const guardar = async () => {
      const body = { usuario: f.usuario.value.trim(), terminal: f.terminal.value.trim() };
      if (uso === 'envios') body.channel = f.channel.value.trim() || '3';
      if (f.identification.value.trim()) body.identification = f.identification.value.trim();
      if (f.clave.value) { body.clave = f.clave.value; body.claveYaCifrada = f.yaCifrada.checked; }
      if (f.rsa.value.trim()) body.rsaPublicKey = f.rsa.value.trim();
      if (!(await confirmar(`Guardar credencial ${nombreUso()}`, `Ambiente ${amb === 'prod' ? 'Producción' : 'Homologación'}: la próxima llamada al banco usará estos datos. Queda registrado en auditoría (sin el valor de la clave).`, 'Guardar'))) return;
      // Si el backend rechaza, el formulario queda como estaba y el motivo queda a la vista (no solo en el aviso temporal)
      try { await api(ruta(), { method: 'PUT', body }); } catch (x) {
        poner(f.aviso, h('p', { class: 'nota mal', role: 'alert' }, `No se guardó: ${x?.message ?? x}`));
        error(x);
        return;
      }
      toast('Credencial guardada. La clave no se vuelve a mostrar: queda indicada en Estado.');
      await dibujar();
    };
    const probar = async () => {
      try {
        const r = await api(ruta('/probar'), { method: 'POST' });
        toast(r.ok ? `Conexión OK${r.cliente ? ` · ${r.cliente}` : ''}.` : `No se pudo conectar: ${r.error}`, !r.ok);
      } catch (x) { error(x); }
    };

    // Interruptor: desactivar corta el acceso al banco (no se hace login ni se opera) sin borrar la clave; reactivar no la pide de nuevo
    const cambiarEstado = async () => {
      const activar = e.activa === false;
      const ambTxt = amb === 'prod' ? 'Producción' : 'Homologación';
      const ok = await confirmar(activar ? `Activar credencial ${nombreUso()}` : `Desactivar credencial ${nombreUso()}`,
        activar ? `Ambiente ${ambTxt}: el Home Banking vuelve a poder conectarse al banco con esta credencial.`
          : `Ambiente ${ambTxt}: se corta ya el acceso al banco con esta credencial. Consultas, transferencias y envíos que la usen van a fallar hasta que se reactive. No se borra la clave. Queda registrado en auditoría.`,
        activar ? 'Activar' : 'Desactivar');
      if (!ok) return;
      try { await api(ruta('/estado'), { method: 'PUT', body: { activa: activar } }); } catch (x) { error(x); return; }
      toast(activar ? 'Credencial activada.' : 'Credencial desactivada. El acceso al banco quedó cortado.');
      await dibujar();
    };

    poner(cuerpo, 
      h('div', { class: 'grid' },
        card(uso === 'envios' ? 'Datos de acceso · envíos programados' : 'Datos de acceso · principal', uso === 'envios'
          ? 'Usuario API exclusivo para los correos programados a los clientes: tiene su propia sesión en el banco, así los envíos no cortan la sesión del Home Banking. Tiene que ser un usuario distinto del principal. Misma URL, mismo cifrado. El channel es editable (por defecto 3).'
          : 'La URL la fija el ambiente: Homologación usa apihomo.bancodevalores.com y Producción api.bancodevalores.com. La clave y la llave RSA se cifran en el backend (AES-256-GCM) y nunca se devuelven a la pantalla. channel = 3.',
          h('div', { class: 'campos' },
            campo('URL de la API (según el ambiente)', f.url), campo('Usuario', f.usuario), campo('identification', f.identification), campo('Terminal', f.terminal),
            uso === 'envios' && campo('channel', f.channel),
            campo('Clave (solo escritura)', f.clave),
            campo('La clave ya viene cifrada por el banco (texto base64): se envía tal cual y no hace falta la llave RSA', f.yaCifrada, 'check'),
            campo('Llave pública RSA del banco (solo si la clave está en texto plano)', f.rsa)),
          f.aviso,
          h('div', { class: 'fila' },
            h('button', { class: 'btn primario', onclick: guardar }, 'Guardar'),
            h('button', { class: 'btn', disabled: !e.configurada, onclick: probar }, 'Probar conexión'))),
        card('Estado', null,
          h('dl', { class: 'dl' },
            h('dt', {}, 'Configurada'), h('dd', {}, pill(e.configurada ? 'Sí' : e.usaPrincipal ? 'No · usa la principal' : 'No', e.configurada ? 'ok' : 'warn')),
            h('dt', {}, 'Estado'), h('dd', {}, !e.configurada ? '—' : pill(e.activa === false ? 'Desactivada' : 'Activa', e.activa === false ? 'bad' : 'ok')),
            h('dt', {}, 'Clave'), h('dd', {}, !e.configurada ? '—' : e.claveYaCifrada ? 'Ya cifrada por el banco' : 'Texto plano (se cifra con RSA)'),
            h('dt', {}, 'Llave RSA'), h('dd', {}, e.rsaCargada ? 'Cargada' : e.claveYaCifrada ? 'No hace falta' : 'Falta'),
            h('dt', {}, 'Clave cargada por'), h('dd', {}, e.claveCargadaPor ? `${e.claveCargadaPor} · ${fechaHora(e.claveCargadaEn)}` : '—'),
            h('dt', {}, 'Última modificación'), h('dd', {}, e.actualizadoPor ? `${e.actualizadoPor} · ${fechaHora(e.actualizadoEn)}` : '—')),
          e.configurada && h('div', { class: 'fila' }, h('button', { class: e.activa === false ? 'btn' : 'btn peligro', onclick: cambiarEstado }, e.activa === false ? 'Activar credencial' : 'Desactivar credencial')),
          h('p', { class: 'nota' }, uso === 'envios'
            ? (e.configurada ? 'Solo la usan los envíos programados de correo (servicio jobs). El resto del Home Banking usa la principal.'
              : 'Mientras no se cargue, los envíos programados usan la credencial principal (comparten usuario con el Home Banking).')
            : 'Es una credencial de VALO para todas las empresas: el filtrado por empresa lo hace el Home Banking según los permisos de cada usuario. Los envíos programados usan la suya si está cargada.'))));
  };

  poner(main, card('Credenciales API Banking', 'Credenciales de VALO ante la API del Banco de Valores: la principal y una adicional, exclusiva de los envíos programados de correo. Solo las carga el administrador de seguridad.',
    selector), cuerpo);
  await dibujar().catch(error);
}
