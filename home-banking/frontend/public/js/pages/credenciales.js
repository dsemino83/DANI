// Credencial API Banking de VALO (una sola por ambiente). La clave es de solo escritura: nunca se muestra.
import { api } from '../api.js';
import { h, poner, card, campo, seg, pill, fechaHora, confirmar, toast, error, cargando } from '../ui.js';

export async function render(main) {
  let amb = 'homo';
  const cuerpo = h('div', {}, cargando());
  const selector = h('div', {});
  const pintarSelector = () => poner(selector, seg([['homo', 'Homologación'], ['prod', 'Producción']], amb, (v) => { amb = v; pintarSelector(); dibujar().catch(error); }));
  pintarSelector();

  const dibujar = async () => {
    poner(cuerpo, cargando());
    const e = await api(`/admin/credenciales/${amb}`);
    const f = {
      url: h('input', { type: 'url', value: e.url ?? '', placeholder: 'https://…' }),
      usuario: h('input', { value: e.usuario ?? '', autocomplete: 'off' }),
      identification: h('input', { inputmode: 'numeric', maxlength: 11, autocomplete: 'off', placeholder: e.configurada ? `${e.identification} · vacío = se conserva` : 'DNI / CUIT del usuario API' }),
      terminal: h('input', { value: e.terminal ?? '', autocomplete: 'off' }),
      clave: h('input', { type: 'password', autocomplete: 'new-password', placeholder: e.configurada ? 'Vacío = se conserva la actual' : 'Clave del usuario API' }),
      rsa: h('textarea', { rows: 4, spellcheck: false, placeholder: e.rsaCargada ? 'Vacío = se conserva la llave actual' : 'Llave pública RSA del banco (base64 o PEM)' }),
    };
    const guardar = async () => {
      const body = { url: f.url.value.trim(), usuario: f.usuario.value.trim(), terminal: f.terminal.value.trim() };
      if (f.identification.value.trim()) body.identification = f.identification.value.trim();
      if (f.clave.value) body.clave = f.clave.value;
      if (f.rsa.value.trim()) body.rsaPublicKey = f.rsa.value.trim();
      if (!(await confirmar('Guardar credencial', `Ambiente ${amb === 'prod' ? 'Producción' : 'Homologación'}: la próxima llamada al banco usará estos datos. Queda registrado en auditoría (sin el valor de la clave).`, 'Guardar'))) return;
      try { await api(`/admin/credenciales/${amb}`, { method: 'PUT', body }); toast('Credencial guardada.'); } catch (x) { error(x); }
      f.clave.value = '';
      await dibujar();
    };
    const probar = async () => {
      try {
        const r = await api(`/admin/credenciales/${amb}/probar`, { method: 'POST' });
        toast(r.ok ? `Conexión OK${r.cliente ? ` · ${r.cliente}` : ''}.` : `No se pudo conectar: ${r.error}`, !r.ok);
      } catch (x) { error(x); }
    };

    poner(cuerpo, 
      h('div', { class: 'grid' },
        card('Datos de acceso', 'La clave y la llave RSA se cifran en el backend (AES-256-GCM) y nunca se devuelven a la pantalla. channel = 3.',
          h('div', { class: 'campos' },
            campo('URL base de la API', f.url), campo('Usuario', f.usuario), campo('identification', f.identification), campo('Terminal', f.terminal),
            campo('Clave (solo escritura)', f.clave), campo('Llave pública RSA del banco', f.rsa)),
          h('div', { class: 'fila' },
            h('button', { class: 'btn primario', onclick: guardar }, 'Guardar'),
            h('button', { class: 'btn', disabled: !e.configurada, onclick: probar }, 'Probar conexión'))),
        card('Estado', null,
          h('dl', { class: 'dl' },
            h('dt', {}, 'Configurada'), h('dd', {}, pill(e.configurada ? 'Sí' : 'No', e.configurada ? 'ok' : 'warn')),
            h('dt', {}, 'Llave RSA'), h('dd', {}, e.rsaCargada ? 'Cargada' : 'Falta'),
            h('dt', {}, 'Clave cargada por'), h('dd', {}, e.claveCargadaPor ? `${e.claveCargadaPor} · ${fechaHora(e.claveCargadaEn)}` : '—'),
            h('dt', {}, 'Última modificación'), h('dd', {}, e.actualizadoPor ? `${e.actualizadoPor} · ${fechaHora(e.actualizadoEn)}` : '—')),
          h('p', { class: 'nota' }, 'Es una única credencial de VALO para todas las empresas: el filtrado por empresa lo hace el Home Banking según los permisos de cada usuario.'))));
  };

  poner(main, card('Credenciales API Banking', 'Credencial de VALO ante la API del Banco de Valores. Solo la carga el administrador de seguridad.',
    selector), cuerpo);
  await dibujar().catch(error);
}
