// Shell de la SPA: login con el SSO, encabezado, pestañas según rol y ruteo por hash.
import { autenticado, iniciar, login, logout } from './auth.js';
import { api } from './api.js';
import { $, h, error } from './ui.js';
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

const PAGINAS = {
  saldos: ['Saldos', saldos], movimientos: ['Movimientos', movimientos], debitos: ['Débitos realizados', debitos],
  transferir: ['Transferir', transferir], cbu: ['Consulta CBU', cbu], masiva: ['Carga masiva', masiva],
  transferencias: ['Transferencias', transferencias], aprobaciones: ['Aprobaciones', aprobaciones], auditoria: ['Auditoría', auditoria],
  empresas: ['Empresas', empresas], permisos: ['Usuarios y permisos', permisos], credenciales: ['Credenciales API', credenciales],
  cartera: ['Cartera de oficiales', cartera], documentacion: ['Documentación', documentacion], ayuda: ['Ayuda', ayuda],
};

// Pestañas por perfil; Transferir/Carga masiva requieren rol Crear y Aprobaciones rol Aprobar.
function pestanas(me) {
  if (me.rol === 'administrador') return ['empresas', 'permisos', 'credenciales', 'auditoria', 'documentacion', 'ayuda'];
  const base = { operador: ['saldos', 'movimientos', 'debitos', 'cbu', 'transferencias'], autorizante: ['saldos', 'movimientos', 'debitos', 'cbu', 'transferencias', 'cartera'], auditor: ['saldos', 'movimientos', 'debitos', 'transferencias', 'auditoria', 'documentacion'] }[me.rol] ?? [];
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

function pantallaLogin(mensaje) {
  $('#raiz').replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card' },
    h('div', { class: 'fila' }, h('span', { class: 'realm' }, 'VALO SSO · realm staff'), h('button', { class: 'btn chico btn-tema', onclick: alternarTema })),
    ...logos(),
    h('h1', {}, 'Home Banking'),
    mensaje && h('p', { class: 'aviso rojo' }, mensaje),
    h('button', { class: 'btn primario', onclick: () => login() }, 'Ingresar con usuario de VALO'),
    h('p', { class: 'nota' }, 'Vas a ingresar en el inicio de sesión corporativo de VALO. Recupero de clave y desbloqueos se gestionan ahí.'))));
  aplicarTema(temaGuardado());
}

async function pantallaApp() {
  const me = ctx.me;
  const tabs = pestanas(me);
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Secciones' });
  const main = h('main', { id: 'contenido' });
  $('#raiz').replaceChildren(h('div', { class: 'app' },
    h('header', { class: 'top' },
      h('div', { class: 'marca' }, ...logos(), h('h1', {}, 'Home Banking')),
      h('div', { class: 'sesion' }, h('span', {}, 'Sesión: ', h('b', {}, `${me.usuario} · ${me.rol}`), ` · Banco: ${me.ambiente === 'prod' ? 'Producción' : 'Homologación'}`),
        h('a', { class: 'btn chico', href: '#ayuda' }, 'Ayuda'),
        h('button', { class: 'btn chico btn-tema', onclick: alternarTema }),
        h('button', { class: 'btn chico', onclick: logout }, 'Cerrar sesión'))),
    me.soloConsultas && h('p', { class: 'aviso rojo' }, h('b', {}, 'Modo solo consultas. '), 'Saldos, movimientos, débitos y CBU son reales; las transferencias se pueden cargar pero ninguna aprobación las envía al banco.'),
    nav, main));
  aplicarTema(temaGuardado());

  const mostrar = async () => {
    const pag = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : tabs[0];
    nav.replaceChildren(...tabs.map((p) => h('a', { href: `#${p}`, 'aria-current': p === pag ? 'page' : null }, PAGINAS[p][0])));
    main.replaceChildren();
    try { await PAGINAS[pag][1].render(main, ctx); } catch (e) { error(e); }
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
      pantallaLogin(`El sistema está iniciando, reintentando… (${intento + 1})`);
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
}

(async () => {
  try {
    ctx.cfg = await iniciar();
    if (!autenticado()) return login(); // directo al inicio de sesión (Keycloak); la pantalla propia queda para errores
    ctx.me = await esperarBackend();
    await pantallaApp();
  } catch (e) {
    pantallaLogin(e.message);
  }
})();
