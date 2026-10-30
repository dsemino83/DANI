// Shell de la SPA: ingreso con usuario y clave, encabezado, pestañas según rol y ruteo por hash.
import { autenticado, cambiarMiClave, ingresar, iniciar, logout, restablecer } from './auth.js';
import { api, actualizarDatos, alCambiarDatos, horaDatos } from './api.js';
import { $, h, poner, card, campo, error, modal, toast } from './ui.js';
import { buzon } from './buzon.js';
import * as saldos from './pages/saldos.js';
import * as movimientos from './pages/movimientos.js';
import * as debitos from './pages/debitos.js';
import * as transferir from './pages/transferir.js';
import * as cbu from './pages/cbu.js';
import * as masiva from './pages/masiva.js';
import * as transferencias from './pages/transferencias.js';
import * as aprobaciones from './pages/aprobaciones.js';
import * as auditoria from './pages/auditoria.js';
import * as empresas from './pages/empresas.js';
import * as permisos from './pages/permisos.js';
import * as credenciales from './pages/credenciales.js';
import * as ayuda from './pages/ayuda.js';
import * as documentacion from './pages/documentacion.js';
import * as cartera from './pages/cartera.js';
import * as envios from './pages/envios.js';
import * as sistema from './pages/sistema.js';
import * as pagos from './pages/pagos.js';

const PAGINAS = {
  saldos: ['Saldos', saldos], movimientos: ['Movimientos', movimientos], debitos: ['Débitos realizados', debitos],
  transferir: ['Transferir', transferir], cbu: ['Consulta CBU', cbu], masiva: ['Carga masiva', masiva],
  transferencias: ['Transferencias', transferencias], aprobaciones: ['Aprobaciones', aprobaciones], pagos: ['Pagos en proceso', pagos], auditoria: ['Auditoría', auditoria],
  empresas: ['Empresas', empresas], permisos: ['Usuarios y permisos', permisos], credenciales: ['Credenciales API', credenciales],
  cartera: ['Cartera de oficiales', cartera], envios: ['Envíos programados', envios], documentacion: ['Documentación', documentacion], ayuda: ['Ayuda', ayuda],
  sistema: ['Estado del sistema', sistema],
};

// Pestañas por perfil; Transferir/Carga masiva requieren rol Crear y Aprobaciones rol Aprobar.
function pestanas(me) {
  if (me.rol === 'administrador') return ['empresas', 'permisos', 'credenciales', 'sistema', 'auditoria', 'documentacion', 'ayuda'];
  const base = { operador: ['saldos', 'movimientos', 'debitos', 'cbu', 'transferencias', 'pagos'], autorizante: ['saldos', 'movimientos', 'debitos', 'cbu', 'transferencias', 'pagos', 'cartera', 'envios'], auditor: ['saldos', 'movimientos', 'debitos', 'transferencias', 'pagos', 'auditoria', 'documentacion'] }[me.rol] ?? [];
  return Object.keys(PAGINAS).filter((p) => base.includes(p) || p === 'ayuda'
    || ((p === 'transferir' || p === 'masiva') && me.puedeCrear) || (p === 'aprobaciones' && me.puedeAprobar));
}

// Estado compartido entre pantallas (empresa elegida en Saldos, cuenta para Movimientos, etc.)
export const ctx = { me: null, cfg: null, estado: {}, ir: (p, datos = {}) => { Object.assign(ctx.estado, datos); location.hash = p; } };

// ---- tema claro / oscuro (preferencia del usuario, recordada en este navegador)
const temaGuardado = () => { try { return localStorage.getItem('hb.tema'); } catch { return null; } };
function aplicarTema(t) {
  const tema = t ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = tema;
  document.querySelectorAll('.btn-tema').forEach((b) => { b.textContent = tema === 'dark' ? '☀ Modo claro' : '☾ Modo oscuro'; });
}
function alternarTema() {
  const nuevo = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('hb.tema', nuevo); } catch { /* sin almacenamiento */ }
  aplicarTema(nuevo);
}
const logos = (cls = 'logo') => [h('img', { class: `${cls} logo-claro`, src: '/img/logo-valo.png', alt: 'VALO · Banco de Valores' }), h('img', { class: `${cls} logo-oscuro`, src: '/img/logo-valo-oscuro.png', alt: 'VALO · Banco de Valores' })];

const marco = (...hijos) => {
  $('#raiz').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' },
    h('div', { class: 'fila' }, h('span', { class: 'realm' }, 'Acceso · Home Banking'), h('button', { class: 'btn chico btn-tema', type: 'button', onclick: alternarTema })),
    ...logos(),
    h('h1', {}, 'Home Banking'),
    ...hijos)));
  aplicarTema(temaGuardado());
  $('#raiz input')?.focus();
};
const clave = (ph, auto = 'new-password') => h('input', { type: 'password', autocomplete: auto, placeholder: ph, required: true });

// Ingreso en pasos: usuario y clave → (clave nueva si la actual es temporal) → (código OTP si se lo exige el administrador).
// Usuario y clave quedan solo en memoria de esta pantalla hasta completar el ingreso.
function pantallaLogin(mensaje) {
  const datos = {};
  const aviso = h('p', { class: 'aviso rojo', hidden: !mensaje }, mensaje ?? '');
  const mal = (m) => { aviso.textContent = m; aviso.hidden = false; };

  const enviar = async (form, extra) => {
    const boton = form.querySelector('button[type=submit]');
    boton.disabled = true;
    try {
      const r = await ingresar({ ...datos, ...extra });
      if (r.token) return arrancar();
      Object.assign(datos, extra);
      paso(r);
    } catch (e) {
      // Clave u OTP erróneos: vuelve al primer paso (el bloqueo por intentos lo maneja el servidor).
      if (e.status === 401 || e.status === 423 || e.status === 403) { for (const k of Object.keys(datos)) delete datos[k]; inicio(); }
      mal(e.message);
    } finally { boton.disabled = false; }
  };

  const formulario = (campos, textoBoton, alEnviar) => h('form', { onsubmit: (e) => { e.preventDefault(); alEnviar(e.target); } },
    ...campos, h('button', { class: 'btn primario', type: 'submit' }, textoBoton));

  const inicio = () => {
    const usuario = h('input', { autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: false });
    const c = clave('', 'current-password');
    marco(aviso, formulario([campo('Usuario', usuario), campo('Clave', c)], 'Ingresar', (f) => {
      datos.usuario = usuario.value.trim(); datos.clave = c.value;
      enviar(f, {});
    }), h('p', { class: 'nota' }, '¿Olvidaste la clave o quedaste bloqueado? Pedile al administrador de seguridad que la restablezca o te envíe un link por correo.'));
  };

  const paso = (r) => {
    aviso.hidden = true;
    if (r.paso === 'cambiar_clave') {
      const n1 = clave('Mínimo 12, con letras y números'), n2 = clave('Repetila');
      return marco(h('p', { class: 'aviso' }, 'Tu clave es temporal: elegí una nueva para continuar.'), aviso,
        formulario([campo('Clave nueva', n1), campo('Repetir clave nueva', n2)], 'Guardar y continuar', (f) => {
          if (n1.value !== n2.value) return mal('Las dos claves no coinciden.');
          enviar(f, { claveNueva: n1.value });
        }));
    }
    const codigo = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true, placeholder: '6 dígitos' });
    const mandarCodigo = (f) => enviar(f, { otp: codigo.value.trim() });
    if (r.paso === 'otp_enrolar') {
      return marco(h('p', { class: 'aviso' }, 'Tu usuario necesita un segundo factor. Escaneá el código con una app de autenticación (Google Authenticator, Microsoft Authenticator, FreeOTP…) e ingresá el código de 6 dígitos que muestra.'),
        h('img', { class: 'qr', src: r.qr, alt: 'Código QR para la app de autenticación', width: 220, height: 220 }),
        h('p', { class: 'nota' }, 'Si no podés escanearlo, cargá esta clave a mano: ', h('code', { class: 'clave-otp' }, r.secreto)),
        aviso, formulario([campo('Código de la app', codigo)], 'Confirmar', mandarCodigo));
    }
    if (r.paso === 'otp') return marco(aviso, formulario([campo('Código OTP (app de autenticación)', codigo)], 'Ingresar', mandarCodigo));
    mal('Respuesta inesperada del servidor.');
  };

  inicio();
}

// Link del correo: #restablecer=<token>&u=<usuario>
function pantallaRestablecer(q) {
  const n1 = clave('Mínimo 12, con letras y números'), n2 = clave('Repetila');
  const aviso = h('p', { class: 'aviso rojo', hidden: true });
  marco(h('p', {}, `Elegí una clave nueva para ${q.get('u')}.`), aviso,
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (n1.value !== n2.value) { aviso.textContent = 'Las dos claves no coinciden.'; aviso.hidden = false; return; }
      try {
        await restablecer({ usuario: q.get('u'), token: q.get('restablecer'), claveNueva: n1.value });
        history.replaceState(null, '', '/');
        pantallaLogin();
        toast('Clave guardada. Ya podés ingresar.');
      } catch (x) { aviso.textContent = x.message; aviso.hidden = false; }
    } }, campo('Clave nueva', n1), campo('Repetir clave nueva', n2), h('button', { class: 'btn primario', type: 'submit' }, 'Guardar clave')));
}

// El propio usuario cambia su clave (cierra sus otras sesiones).
function dialogoClave() {
  const actual = clave('', 'current-password'), n1 = clave('Mínimo 12, con letras y números'), n2 = clave('Repetila');
  const cerrar = modal('Cambiar mi clave', h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (n1.value !== n2.value) return toast('Las dos claves no coinciden.', true);
    try { await cambiarMiClave(actual.value, n1.value); cerrar(); toast('Clave cambiada. Se cerraron tus otras sesiones abiertas.'); } catch (x) { error(x); }
  } }, h('div', { class: 'campos' }, campo('Clave actual', actual), campo('Clave nueva', n1), campo('Repetir clave nueva', n2)),
  h('div', { class: 'fila' }, h('button', { class: 'btn primario', type: 'submit' }, 'Cambiar clave'))));
}

async function pantallaApp() {
  const me = ctx.me;
  // Hora de los datos del banco que se están mostrando (se consultan una vez y se reusan hasta "Actualizar datos")
  const marcaDatos = h('span', { class: 'nota' });
  const pintarHora = (d) => { marcaDatos.textContent = d ? `Datos del banco: ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };
  alCambiarDatos(pintarHora); pintarHora(horaDatos());
  const tabs = pestanas(me);
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Secciones' });
  const main = h('main', { id: 'contenido' });
  $('#raiz').replaceChildren(h('div', { class: 'app' },
    h('header', { class: 'top' },
      h('div', { class: 'marca' }, ...logos(), h('h1', {}, 'Home Banking')),
      h('div', { class: 'sesion' }, h('span', {}, 'Sesión: ', h('b', {}, `${me.usuario} · ${me.rol}`), ` · Banco: ${me.ambiente === 'prod' ? 'Producción' : 'Homologación'}`),
        me.rol !== 'administrador' && marcaDatos,
        me.rol !== 'administrador' && h('button', { class: 'btn chico', title: 'Volver a consultar saldos, movimientos y débitos al banco', onclick: () => { actualizarDatos(); mostrar(); } }, '↻ Actualizar datos'),
        me.rol !== 'administrador' && buzon(ctx),
        h('a', { class: 'btn chico', href: '#ayuda' }, 'Ayuda'),
        h('button', { class: 'btn chico btn-tema', onclick: alternarTema }),
        h('button', { class: 'btn chico', onclick: dialogoClave }, 'Cambiar clave'),
        h('button', { class: 'btn chico', onclick: logout }, 'Cerrar sesión'))),
    me.soloConsultas && h('p', { class: 'aviso rojo' }, h('b', {}, 'Modo solo consultas. '), 'Saldos, movimientos, débitos y CBU son reales; las transferencias se pueden cargar pero ninguna aprobación las envía al banco.'),
    nav, main));
  aplicarTema(temaGuardado());

  const mostrar = async () => {
    const pag = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : tabs[0];
    nav.replaceChildren(...tabs.map((p) => h('a', { href: `#${p}`, 'aria-current': p === pag ? 'page' : null }, PAGINAS[p][0])));
    main.replaceChildren();
    try { await PAGINAS[pag][1].render(main, ctx); } catch (e) {
      // En vez de quedar en "Cargando…": el motivo y un botón para reintentar (vuelve a consultar al banco)
      poner(main, card('No se pudo cargar esta pantalla', null, h('p', { class: 'aviso rojo' }, e.message),
        h('div', { class: 'fila' }, h('button', { class: 'btn primario', onclick: () => { actualizarDatos(); mostrar(); } }, 'Reintentar'))));
    }
  };
  window.addEventListener('hashchange', mostrar);
  await mostrar();
}

// Mientras el servidor arranca (por ejemplo, al reactivar la máquina de prueba) nginx responde 502/503/504:
// se avisa y se reintenta solo durante unos minutos en vez de mostrar el error.
async function esperarBackend() {
  for (let intento = 0; ; intento++) {
    try { return await api('/me'); } catch (e) {
      if (![502, 503, 504].includes(e.status) || intento >= 36) throw e;
      marco(h('p', { class: 'aviso' }, `El sistema está iniciando, reintentando… (${intento + 1})`));
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
}

async function arrancar() {
  try {
    ctx.me = await esperarBackend();
    await pantallaApp();
  } catch (e) {
    pantallaLogin(e.message);
  }
}

(async () => {
  ctx.cfg = await iniciar();
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get('restablecer')) return pantallaRestablecer(q);
  if (!autenticado()) return pantallaLogin();
  await arrancar();
})();
