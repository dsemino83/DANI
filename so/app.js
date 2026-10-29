// SO · Francisco: workspace AI-native. Un solo estado (estado.js) lo comparten la UI y Francisco; las intenciones
// deterministas se ejecutan contra Supabase con la sesión del usuario (RLS) y se verifican releyendo antes de
// informar éxito. La conversación libre va a la Edge Function. Patrones: bajo riesgo → ejecutar; medio → ejecutar +
// Deshacer; alto → vista previa breve. Las notificaciones operativas y tareas largas viven fuera del chat.
import { interpretar, armarRegistro, normalizar, resolverArtefacto } from './intent.js';
import { renderArtefacto, esc, haceCuanto, categoriaUtil } from './vista.js';
import { crearAvatar, cargarManifest } from './avatar.js';
import { icono } from './iconos.js';
import { presentacion, calcularPreview, previewVigente, ordenarWorkspace, reordenar, recientesPorUso, continuar, htmlTarjeta, htmlVistazo, accionesMenu, sparkline } from './workspace.js';
import { clasificar, accionesPara } from './comando.js';
import { renderUI, validar as validarUI, specsComparacion } from './genui.js';
import { crearArchivos } from './archivos/servicio.js';
import { formatoPedido, FORMATOS } from './archivos/generar.js';
import { interpretarEdicion } from './archivos/tablas.js';
import { exportacionDe, nombreApertura } from './archivos/doc.js';
import { interpretarHorario, describirHorario, proximaEjecucion, FORMATOS_SERVIDOR, TZ_POR_DEFECTO } from './archivos/programadas.js';
import { crearEstado, chips, riesgo, explicarPermiso, paraContinuidad } from './estado.js';
import { analizar, comparar, mesAnterior, mesesConDatos, nombreMes, totalMes } from './analisis.js';
import { rankear } from './busqueda.js';
import { crearDatos } from './datos.js';
import { interpretarEntrada } from './ingesta/intencion.js';
import { pareceSecreto } from './ingesta/tipos.js';

const cfg = window.SO_SUPABASE;
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const BASE_SHARED = new URL('shared/', location.href).href;
const hoy = () => new Date().toISOString().slice(0, 10);
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: seguimos */ } },
  limpiar() { try { Object.keys(localStorage).filter((k) => k.startsWith('so.')).forEach((k) => localStorage.removeItem(k)); } catch {} },
};

const E = crearEstado({ modo: ls.get('so.modo') === 'personal' ? 'personal' : 'work' });
const st = {
  user: null, proyectos: [], chats: [], chatId: null, mensajes: [], artefactos: [], menu: new Map(), compartidos: [],
  tareas: [], avisos: [], datos: new Map(), archivos: new Map(), ocupado: false, lastVisit: null, firstSeen: null, resume: null,
  inicio: performance.now(), tabCentro: 'tareas', preferencias: {}, panel: 'cerrado',
};

// Íconos: un único sistema (iconos.js). Los botones de solo ícono ya tienen aria-label y title en el HTML.
document.querySelectorAll('[data-ic]').forEach((n) => { n.innerHTML = icono(n.dataset.ic); });
for (const [id, ic] of Object.entries({ colapsar: 'lateral', abrirMenu: 'lateral', btnBuscar: 'buscar', ampliarPanel: 'conversacion', cerrarPanel: 'cerrar', camara: 'imagen', cerrarHoja: 'cerrar', cerrarCentro: 'cerrar' })) $(id).innerHTML = icono(ic);

const avatares = { marca: crearAvatar($('avatarMarca'), { modo: E.get().modo }), login: crearAvatar($('avatarLogin'), { modo: 'work' }),
  panel: crearAvatar($('avatarPanel'), { modo: E.get().modo }), orb: crearAvatar($('avatarOrb'), { modo: E.get().modo }), grande: null };
const todosAv = () => [avatares.marca, avatares.panel, avatares.orb, avatares.grande].filter(Boolean);
cargarManifest();   // AssetCache: imágenes de OpenArt si cargan; si no, sigue el SVG local
const ORB = { idle: 'idle', listening: 'listening', thinking: 'thinking', executing: 'working', responding: 'working', success: 'done', error: 'attention' };
const fase = (f) => { todosAv().forEach((a) => a.setFase(f)); $('orb').dataset.estado = ORB[f] || 'idle'; };

// ---------------------------------------------------------------- utilidades
async function q(promesa) {
  const { data, error } = await promesa;
  if (error) throw new Error(traducirError(error));
  return data;
}
function traducirError(e) {
  const m = e?.message || String(e);
  if (/row-level security|sin permiso|42501/i.test(m)) return 'no tenés permiso para esa operación';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'no hay conexión con el servidor';
  return m;
}
const evento = (name, value = null, props = {}) => sb.from('so_events').insert({ name, value, props }).then(() => {}, () => {});
const senal = (skill, signal, meta = {}, artifact_id = null, inferred = false) =>
  sb.from('so_signals').insert({ skill, signal, meta, artifact_id, inferred }).then(() => {}, () => {});
const proyecto = () => st.proyectos.find((p) => p.id === E.get().proyectoId) || null;
const artefacto = (id) => st.artefactos.find((a) => a.id === id) || null;

// Modelo de actividad: solo el estado relevante, nunca razonamiento interno.
const ACT = { subiendo: 'Subiendo adjuntos', entendiendo: 'Entendiendo', buscando: 'Buscando', analizando: 'Analizando', creando: 'Creando', actualizando: 'Actualizando',
  verificando: 'Verificando', esperando: 'Esperando información', listo: 'Listo', atencion: 'Necesita atención' };
let tAct = null;
function actividad(clave) {
  const p = $('actividad');
  clearTimeout(tAct);
  p.textContent = clave ? ACT[clave] : '';
  p.dataset.tipo = clave || '';
  if (clave === 'listo') tAct = setTimeout(() => { p.textContent = ''; p.dataset.tipo = ''; }, 2500);
}

// Entrada universal (adjuntos, archivos, importaciones, APIs). Las dependencias son funciones de este módulo.
const D = crearDatos({ sb, cfg, st, E, q, esc, $, actividad: (k) => actividad(k), notificar: (...a) => notificar(...a), evento: (...a) => evento(...a),
  abrirArtefacto: (...a) => abrirArtefacto(...a), datosDe: (...a) => datosDe(...a), crearArtefacto: (...a) => crearArtefacto(...a), artefacto: (id) => artefacto(id),
  cargarArtefactos: () => cargarArtefactos(), conversar: (o) => conversar(o), haceCuanto,
  procesarTexto: (t, adj) => procesar(t, { adjuntosDirectos: adj }),
  prellenar: (t, adj) => { st.adjuntosPrellenados = adj; $('texto').value = t; abrirPanel(); $('texto').focus(); },
  abrirFrancisco: () => abrirPanel(),
  resultadoImportacion: async (r) => { if (!r) return; if (!st.chatId) await asegurarChat('Datos'); await guardarMensaje('assistant', r.texto, r.meta || {}); await trasImportar(r); } });

// Archivos generados, versiones, comparación, consolidación, plantillas y automatizaciones.
const A = crearArchivos({ sb, cfg, st, E, q, D, notificar: (...a) => notificar(...a), evento: (...a) => evento(...a), artefacto: (id) => artefacto(id), datosDe: (...a) => datosDe(...a) });

// ---------------------------------------------------------------- tema y sesión
const TEMAS = ['auto', 'light', 'dark'];
let tema = ls.get('so.tema') || 'auto';
function aplicarTema(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $('tema').textContent = `Tema: ${{ auto: 'automático', light: 'claro', dark: 'oscuro' }[t]}`;
}
aplicarTema(tema);
function ciclarTema() { tema = TEMAS[(TEMAS.indexOf(tema) + 1) % 3]; ls.set('so.tema', tema); aplicarTema(tema); }
$('tema').onclick = ciclarTema;

$('formLogin').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('errorLogin').hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email')), password: String(fd.get('password')) });
  if (error) { $('errorLogin').textContent = 'No se pudo entrar: revisá correo y contraseña.'; $('errorLogin').hidden = false; }
};
$('salir').onclick = async () => { ls.limpiar(); await sb.auth.signOut(); location.reload(); };
$('abrirMenu').onclick = () => $('lateral').classList.toggle('abierto');

sb.auth.onAuthStateChange((_ev, session) => {
  if (session?.user && st.user?.id !== session.user.id) iniciar(session.user);
  if (!session) { $('app').hidden = true; $('login').hidden = false; }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) $('login').hidden = false; });

async function iniciar(user) {
  st.user = user;
  $('login').hidden = true; $('app').hidden = false;
  $('usuario').textContent = user.email;
  const { data: habilitado } = await sb.rpc('es_valo');
  if (!habilitado) return soloCompartidos();
  await cargarContinuidad();
  await cambiarModo(E.get().modo, false);
  cargarCentro();
  setInterval(cargarCentro, 60000);
  window.addEventListener('hashchange', ruta);
  ruta();
}

// Continuidad: proyecto, artefacto, filtros y última visita (no se sincroniza lo efímero).
async function cargarContinuidad() {
  try {
    const filas = await q(sb.from('so_user_state').select('key, value'));
    const m = Object.fromEntries(filas.map((f) => [f.key, f.value]));
    st.resume = m.resume || null;
    st.lastVisit = m.last_visit?.at || null;
    st.firstSeen = m.first_seen?.at || null;
    if (!ls.get('so.modo') && st.resume?.modo) E.set({ modo: st.resume.modo });
    const ahora = new Date().toISOString();
    const upserts = [{ key: 'last_visit', value: { at: ahora } }];
    if (!st.firstSeen) { st.firstSeen = ahora; upserts.push({ key: 'first_seen', value: { at: ahora } }); }
    sb.from('so_user_state').upsert(upserts.map((u) => ({ ...u, updated_at: ahora }))).then(() => {}, () => {});
  } catch { /* la continuidad nunca bloquea */ }
}
// La vista del tablero se redibuja ante cualquier cambio de contexto, venga de la UI, de un chip o de Francisco.
E.sub((s, prev) => {
  if (s.vista !== 'artefacto' || !s.artefactoId) return;
  const cambio = ['desde', 'hasta', 'filtro', 'comparar', 'seleccion'].some((k) => JSON.stringify(s[k]) !== JSON.stringify(prev[k]));
  const d = st.datos.get(s.artefactoId);
  const a = artefacto(s.artefactoId);
  if (cambio && d && a && prev.artefactoId === s.artefactoId) pintarArtefacto(a, d);
});
let tResume = null;
E.sub((s) => {
  pintarContexto();
  ls.set('so.modo', s.modo);
  clearTimeout(tResume);
  tResume = setTimeout(() => {
    // Salir de un tablero no borra "lo último en lo que trabajaste": solo se reemplaza al abrir otro.
    const base = s.artefactoId ? paraContinuidad(s) : { ...(st.resume || {}), modo: s.modo, proyectoId: s.proyectoId };
    const value = { ...base, chatId: st.chatId, at: new Date().toISOString() };
    st.resume = value;
    sb.from('so_user_state').upsert({ key: 'resume', value, updated_at: value.at }).then(() => {}, () => {});
  }, 1500);
});

// ---------------------------------------------------------------- datos del workspace
// Filtro de modo sin el texto "eq.work" en la URL: algunos filtros de red locales bloquean ese pedido (403 en el
// preflight). mode solo admite 'work' o 'personal', así que "distinto de personal" es exactamente "work".
async function cargarProyectos() {
  if (E.get().modo !== 'work') { E.set({ proyectoId: null }); return; }
  st.proyectos = await q(sb.from('so_espacios').select('id, name, memoria, updated_at').neq('mode', 'personal').order('created_at'));
  if (!st.proyectos.length) st.proyectos = [await q(sb.from('so_espacios').insert({ name: 'Trabajo', mode: 'work' }).select('id, name, memoria, updated_at').single())];
  const preferido = st.resume?.proyectoId && st.proyectos.some((p) => p.id === st.resume.proyectoId) ? st.resume.proyectoId : st.proyectos[0].id;
  if (!st.proyectos.some((p) => p.id === E.get().proyectoId)) E.set({ proyectoId: preferido });
}

async function cargarArtefactos() {
  if (E.get().modo !== 'work') { st.artefactos = []; pintarMenu(); return; }
  const [arts, menu, comp, prefs] = await Promise.all([
    q(sb.from('so_artifacts').select('id, project_id, name, type, version, route, state, datasource_id, configuration, specification, schema, deleted_at, created_at, updated_at')
      .eq('project_id', E.get().proyectoId).is('deleted_at', null).order('updated_at', { ascending: false })),
    q(sb.from('so_menu').select('artifact_id, name, favorite, last_opened_at, open_count, status, ord, size, preview, preview_at')),
    q(sb.rpc('so_shared_list')),
    q(sb.from('so_signals').select('meta').eq('signal', 'preference').eq('inferred', false).order('id', { ascending: false }).limit(50)),
  ]);
  st.artefactos = arts;
  st.menu = new Map(menu.map((m) => [m.artifact_id, m]));
  st.compartidos = comp;
  // Preferencia confirmada de gráfico (solo elecciones explícitas, nunca inferencias débiles).
  const cuenta = {};
  prefs.map((p) => p.meta?.value).filter((v) => /^grafico:/.test(v || '')).forEach((v) => { cuenta[v] = (cuenta[v] || 0) + 1; });
  const top = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
  st.preferencias.grafico = top && top[1] >= 2 ? top[0].split(':')[1] : null;
  pintarMenu();
}

const publicados = () => st.artefactos.filter((a) => a.state === 'published');
function recientes(n = 8) {
  return publicados().map((a) => ({ a, m: st.menu.get(a.id) || {} }))
    .sort((x, y) => String(y.m.last_opened_at || y.a.updated_at).localeCompare(String(x.m.last_opened_at || x.a.updated_at))).slice(0, n);
}

// Navegación secundaria: solo Favoritos y Recientes (por apertura real). El catálogo vive en el Workspace.
function pintarMenu() {
  const actual = location.hash.match(/^#\/a\/(.+)$/)?.[1];
  const link = (a, ic = 'chart', relleno = false) => `<a href="#/a/${a.id}" ${actual === a.id ? 'aria-current="page"' : ''}>${icono(ic, { relleno })}<span>${esc(a.name)}</span></a>`;
  const favs = publicados().filter((a) => st.menu.get(a.id)?.favorite);
  $('tituloFavoritos').hidden = !favs.length;
  $('menuFavoritos').innerHTML = favs.slice(0, 6).map((a) => link(a, 'estrella', true)).join('');
  const recs = recientesPorUso(publicados(), st.menu, 5).filter((a) => !st.menu.get(a.id)?.favorite);
  $('tituloRecientes').hidden = !recs.length;
  $('menuWorkspace').innerHTML = recs.map((a) => link(a, presentacion(a).icon)).join('');
  $('tituloCompartidos').hidden = !st.compartidos.length;
  $('menuCompartidos').innerHTML = st.compartidos.map((a) => `<a href="${esc(BASE_SHARED + a.id)}">${icono('compartir')}<span>${esc(a.name)}</span></a>`).join('');
  $('linkInicio').toggleAttribute('aria-current', !location.hash || location.hash === '#/' || location.hash === '#/work');
}

async function cargarChats() {
  st.chats = await q(sb.from('so_chats').select('id, title, mode, updated_at')[E.get().modo === 'work' ? 'neq' : 'eq']('mode', 'personal').order('updated_at', { ascending: false }).limit(50));
  $('listaChats').innerHTML = st.chats.slice(0, 6).map((c) => `<a href="#/c/${c.id}" ${c.id === st.chatId ? 'aria-current="page"' : ''}>${icono('conversacion')}<span>${esc(c.title)}</span></a>`).join('')
    || '<span class="vacio">Sin conversaciones todavía.</span>';
}

async function cambiarModo(modo, navegar = true) {
  // Todo el cambio está protegido: la vista se repinta siempre y, si algo falla, se muestra el motivo real.
  try {
    E.set({ modo, artefactoId: null });
    ls.set('so.modo', modo);
    document.querySelectorAll('.modos button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
    $('bloqueWorkspace').hidden = modo !== 'work';
    st.chatId = null; st.mensajes = [];
    try { todosAv().forEach((a) => a.setModo(modo)); } catch (err) { console.error('avatar', err); }
    await cargarProyectos();
    await Promise.all([cargarArtefactos(), cargarChats()]);
  } catch (err) {
    console.error('cambiarModo', err);
    toast(`No pude cargar ${modo === 'work' ? 'Trabajo' : 'Personal'}: ${err?.message || err}.`);
  }
  try { if (navegar) { if (location.hash === '#/' || !location.hash) ruta(); else location.hash = '#/'; } }
  catch (err) { console.error('ruta', err); toast(`No pude mostrar ${modo === 'work' ? 'Trabajo' : 'Personal'}: ${err?.message || err}.`); }
}
document.querySelectorAll('.modos button').forEach((b) => { b.onclick = () => cambiarModo(b.dataset.modo); });

async function cambiarProyecto(id) {
  E.set({ proyectoId: id, artefactoId: null });
  await cargarArtefactos();
  if (location.hash === '#/' || !location.hash) ruta(); else location.hash = '#/';
}

// ---------------------------------------------------------------- rutas y vistas
function vista(nombre) {
  const app = $('app');
  const prev = E.get().vista;
  app.classList.remove('vista-home', 'vista-chat', 'vista-artefacto', 'vista-archivo');
  app.classList.add(`vista-${nombre}`);
  $('vistaHome').hidden = nombre !== 'home';
  $('vistaArtefacto').hidden = nombre !== 'artefacto';
  $('vistaArchivo').hidden = nombre !== 'archivo';
  $('volver').hidden = !['artefacto', 'archivo'].includes(nombre) || E.get().modo !== 'work';
  if (nombre !== 'artefacto') { $('accionesCab').innerHTML = ''; $('tituloIcono').innerHTML = ''; salirFoco(); }
  // Francisco no ocupa espacio permanente: se cierra al cambiar de superficie (salvo que él mismo esté navegando).
  if (nombre === 'chat') panel('abierto');
  else if (prev !== nombre && !st.ocupado) panel('cerrado');
  E.set({ vista: nombre });
}

// ---------------------------------------------------------------- Francisco contextual: cerrado · compacto · abierto
function panel(estado) {
  st.panel = estado;
  const app = $('app');
  app.classList.toggle('panel-abierto', estado !== 'cerrado');
  app.classList.toggle('panel-compacto', estado === 'compacto');
  $('panelFrancisco').dataset.estado = estado;
  $('orb').setAttribute('aria-expanded', String(estado !== 'cerrado'));
  $('orb').setAttribute('aria-label', estado === 'cerrado' ? 'Abrir Francisco' : 'Cerrar Francisco');
  $('ampliarPanel').hidden = E.get().vista === 'chat' || !st.chatId;
  if (estado !== 'cerrado') { pintarContexto(); const m = $('mensajes'); m.scrollTop = m.scrollHeight; }
}
function abrirPanel({ foco = true } = {}) {
  if (E.get().vista !== 'chat') panel('abierto');
  if (foco) setTimeout(() => $('texto').focus(), 0);
}
$('orb').onclick = () => (['abierto', 'compacto'].includes(st.panel) && E.get().vista !== 'chat' ? panel('cerrado') : abrirPanel());
$('cerrarPanel').onclick = () => {
  if (E.get().vista === 'chat') location.hash = E.get().modo === 'work' ? '#/' : '#/';
  else { panel('cerrado'); $('orb').focus(); }
};
$('ampliarPanel').onclick = () => { if (st.chatId) location.hash = `#/c/${st.chatId}`; };
$('volver').addEventListener('click', (e) => { if (st.desdeWorkspace) { e.preventDefault(); history.back(); } });

// Modo foco: oculta navegación secundaria y maximiza el artefacto. Esc restaura.
function entrarFoco() { $('app').classList.add('foco'); st.foco = true; pintarCabecera(); }
function salirFoco() { if (!st.foco) return; $('app').classList.remove('foco'); st.foco = false; if (E.get().vista === 'artefacto') pintarCabecera(); }

$('colapsar').onclick = () => {
  const c = !$('app').classList.contains('lateral-mini');
  $('app').classList.toggle('lateral-mini', c);
  $('colapsar').setAttribute('aria-expanded', String(!c));
  ls.set('so.lateralMini', c);
};
if (ls.get('so.lateralMini')) { $('app').classList.add('lateral-mini'); $('colapsar').setAttribute('aria-expanded', 'false'); }
$('btnBuscar').onclick = () => abrirPaleta();

async function ruta() {
  $('lateral').classList.remove('abierto');
  const h = location.hash;
  // Rutas compatibles: #/work y #/work/:id son alias del contrato estable (#/ y #/a/:id).
  const w = h.match(/^#\/work\/([0-9a-f-]{36})$/);
  if (w) { location.replace(`#/a/${w[1]}`); return; }
  if (h === '#/work') { location.replace('#/'); return; }
  if (E.get().vista === 'home' && !$('vistaHome').hidden) st.wsScroll = $('vistaHome').scrollTop;   // continuidad espacial
  const a = h.match(/^#\/a\/([0-9a-f-]{36})$/);
  const f = h.match(/^#\/f\/([0-9a-f-]{36})$/);
  const c = h.match(/^#\/c\/([0-9a-f-]{36})$/);
  const col = h.match(/^#\/col\/(.+)$/);
  st.desdeWorkspace = !!(a || f || col) && st.ultimaRuta === 'home';
  if (col && E.get().modo === 'work') { st.ultimaRuta = 'coleccion'; pintarMenu(); let nombre = col[1]; try { nombre = decodeURIComponent(col[1]); } catch { /* nombre literal */ } return abrirColeccion(nombre); }
  if (a && E.get().modo === 'work') { st.ultimaRuta = 'artefacto'; pintarMenu(); return abrirArtefacto(a[1]); }
  if (f) { st.ultimaRuta = 'archivo'; pintarMenu(); return abrirArchivo(f[1]); }
  if (c) {
    if (st.chatId !== c[1]) { st.chatId = c[1]; await cargarMensajes(); }
    vista('chat');
    const chat = st.chats.find((x) => x.id === c[1]);
    $('titulo').textContent = chat?.title || 'Conversación';
    $('meta').textContent = '';
    st.ultimaRuta = 'chat';
  } else if (E.get().modo === 'personal') {
    vista('chat');   // Personal: solo conversación
    $('titulo').textContent = 'Personal'; $('meta').textContent = '';
    st.ultimaRuta = 'chat';
  } else {
    vista('home');
    E.set({ artefactoId: null });
    pintarWorkspace();
    st.ultimaRuta = 'home';
    if (st.wsScroll != null) $('vistaHome').scrollTop = st.wsScroll;
    if (st.ultimaTarjeta) $('vistaHome').querySelector(`.lcard[data-art="${st.ultimaTarjeta}"]`)?.focus({ preventScroll: true });
  }
  pintarMensajes();
  pintarMenu();
  cargarChats().catch(() => {});
}

// ---------------------------------------------------------------- Workspace Home
const pvDe = (id) => { const m = st.menu.get(id); return m?.preview?.v ? m.preview : ls.get(`so.pv.${id}`); };
const editable = () => true;   // el dueño ve su propio Workspace; lo compartido conmigo se abre en /so/shared (permiso real del servidor)

function itemContinuar(c) {
  const ic = { atencion: 'alerta', artefacto: 'chart', hecho: 'ok', aviso: 'campana' }[c.tipo];
  if (c.tipo === 'artefacto') return `<button type="button" class="cont-item" data-continuar="${esc(c.artefactoId)}">${icono(ic)}<span><strong>Continuar ${esc(c.titulo)}</strong><small>${esc(c.detalle)}</small></span></button>`;
  return `<button type="button" class="cont-item ${c.tipo}" data-centro="${c.tipo === 'aviso' ? 'avisos' : 'tareas'}">${icono(ic)}<span><strong>${esc(c.titulo)}</strong><small>${esc(c.detalle)}</small></span></button>`;
}

function pintarWorkspace() {
  const p = proyecto();
  $('titulo').textContent = 'Trabajo';
  $('meta').textContent = st.proyectos.length > 1 ? (p?.name || '') : '';
  const h = $('vistaHome');
  const todos = publicados();
  const ocultos = todos.filter((a) => st.menu.get(a.id)?.status === 'hidden');
  const visibles = todos.filter((a) => st.menu.get(a.id)?.status !== 'hidden');
  const archivados = st.artefactos.filter((a) => a.state === 'archived');
  // Campo de escritura real (como en Personal): Enter se lo pasa a Francisco, que decide qué hacer.
  const cmd = `<form class="comando" data-ws="comando" role="search"><button type="button" class="adjuntar" data-ws="adjuntar" aria-label="Adjuntar archivos" title="Adjuntar archivos (también podés soltarlos en cualquier lugar)">+</button><input type="text" name="pedido" autocomplete="off" placeholder="Escribile a Francisco: creá, analizá, abrí o buscá lo que necesites…" aria-label="Pedirle algo a Francisco"><kbd title="También con Ctrl+K">⌘K</kbd></form>`;
  avatares.grande = null;
  if (!todos.length && !archivados.length) {
    h.innerHTML = `<div class="ws-vacio"><span id="avatarGrande"></span>
      <h2>¿Qué querés crear?</h2>
      <p>Soy Francisco. Decime qué querés conseguir y lo armo: tableros, análisis y seguimientos con su historial guardado. Lo que creemos aparece acá como tarjetas vivas que podés abrir, compartir y actualizar.</p>
      ${cmd}
      <div class="ws-sugerencias" role="group" aria-label="Ideas para empezar">
        ${[['chart', 'Dashboard', 'Creá un dashboard de ventas con histórico'], ['chispa', 'Análisis', '__archivo'], ['linea', 'Seguimiento', 'Necesito seguimiento de clientes mes a mes'], ['doc', 'Reporte', 'Creá un reporte de gastos con histórico']]
          .map(([ic, t, pedido]) => `<button type="button" class="sug-card" data-pedido="${esc(pedido)}">${icono(ic, { tam: 22 })}<strong>${t}</strong><small>${pedido === '__archivo' ? 'Subí un archivo y lo analizo' : esc(pedido)}</small></button>`).join('')}
      </div>
      <p class="vacio">También podés soltar un archivo en cualquier lugar.</p></div>`;
    avatares.grande = crearAvatar(h.querySelector('#avatarGrande'), { modo: 'work' });
    h.querySelectorAll('[data-pedido]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.pedido === '__archivo') { abrirPanel(); $('inpArchivos').click(); return; }
      pedirAFrancisco(b.dataset.pedido);
    }));
    conectarComando(h);
    return;
  }
  const cont = continuar({ resume: st.resume, artefactos: todos, tareas: st.tareas, avisos: st.avisos, lastVisit: st.lastVisit });
  const recs = recientesPorUso(visibles, st.menu, 5);
  const lista = st.wsVer === 'archivados' ? archivados : st.wsVer === 'ocultos' ? ocultos : ordenarWorkspace(visibles, st.menu);
  const archivosRec = (st.archivosRecientes || []).slice(0, 4);
  h.innerHTML = `<div class="ws">
    <div class="ws-cab">${cmd}</div>
    ${cont.length ? `<section class="ws-sec" aria-labelledby="tCont"><h2 id="tCont" class="ws-tit">Continuar</h2><div class="continuar-lista">${cont.map(itemContinuar).join('')}</div></section>` : ''}
    ${recs.length > 1 ? `<section class="ws-sec" aria-labelledby="tRec"><h2 id="tRec" class="ws-tit">Recientes</h2><div class="recientes-fila">${recs.map((a) =>
      `<a class="rec-chip" href="#/a/${esc(a.id)}">${icono(presentacion(a).icon, { tam: 16 })}<span>${esc(a.name)}</span><small>${esc(haceCuanto(st.menu.get(a.id).last_opened_at))}</small></a>`).join('')}</div></section>` : ''}
    <section class="ws-sec" aria-labelledby="tGrid">
      <div class="ws-tit-fila"><h2 id="tGrid" class="ws-tit">${st.wsVer === 'archivados' ? 'Archivados' : st.wsVer === 'ocultos' ? 'Ocultos' : 'Tu espacio de trabajo'}</h2>
        ${st.wsVer ? '<button type="button" class="enlace" data-ws="todo">Volver al Workspace</button>' : `${archivados.length ? `<button type="button" class="enlace" data-ws="archivados">Archivados (${archivados.length})</button>` : ''}${ocultos.length ? `<button type="button" class="enlace" data-ws="ocultos">Ocultos (${ocultos.length})</button>` : ''}`}</div>
      <div class="bento" id="bento">${lista.map((a) => htmlTarjeta(a, st.menu.get(a.id) || {}, pvDe(a.id), { editable: editable(a) })).join('')}
        ${st.wsVer ? '' : `<button type="button" class="lcard crear" data-ws="crear">${icono('agregar', { tam: 26 })}<strong>Crear</strong><small>Pedile a Francisco un tablero, un análisis o un seguimiento</small></button>`}</div>
      ${lista.length > 1 && !st.wsVer ? '<p class="vacio ayuda-orden">Arrastrá las tarjetas para ordenarlas, o usá ••• → Mover.</p>' : ''}
    </section>
    ${(archivosRec.length || st.colecciones?.length) && !st.wsVer ? `<section class="ws-sec" aria-labelledby="tArch"><h2 id="tArch" class="ws-tit">Archivos</h2>
      ${st.colecciones?.length ? `<div class="colecciones-fila" role="list" aria-label="Colecciones">${st.colecciones.map((c) => `<a role="listitem" class="col-chip" href="#/col/${esc(encodeURIComponent(c.nombre))}">${icono('archivar', { tam: 16 })}<span>${esc(c.nombre)}</span><small>${c.archivos}</small></a>`).join('')}</div>` : ''}
      <div class="archivos-fila">${archivosRec.map((f) =>
      `<a class="arch-chip" href="#/f/${esc(f.id)}">${icono(f.kind === 'table' ? 'tabla' : f.kind === 'presentation' ? 'pres' : f.kind === 'image' ? 'imagen' : 'doc', { tam: 18 })}<span><strong>${esc(f.original_name)}</strong><small>${esc((f.detected_type || '').toUpperCase())}${f.version > 1 ? ` · v${f.version}` : ''} · ${esc({ generated: 'generado por Francisco', export: 'exportado' }[f.origin] || 'subido')} · ${esc(haceCuanto(f.created_at))}</small></span></a>`).join('')}</div></section>` : ''}
    ${st.compartidos.length && !st.wsVer ? `<section class="ws-sec" aria-labelledby="tComp"><h2 id="tComp" class="ws-tit">Compartidos conmigo</h2><div class="archivos-fila">${st.compartidos.map((a) =>
      `<a class="arch-chip" href="${esc(BASE_SHARED + a.id)}">${icono('compartir', { tam: 18 })}<span><strong>${esc(a.name)}</strong><small>${esc({ VIEW: 'Podés verlo', USE: 'Podés usarlo', EDIT: 'Podés editarlo' }[a.permission])}</small></span></a>`).join('')}</div></section>` : ''}
  </div>`;
  conectarWorkspace(h);
  programarPreviews();
  if (!st.archivosRecientes) D.listaArchivos().then((fs) => { st.archivosRecientes = fs; if (E.get().vista === 'home' && fs.length) pintarWorkspace(); }).catch(() => { st.archivosRecientes = []; });
  if (!st.colecciones) A.colecciones().then((cs) => { st.colecciones = cs; if (E.get().vista === 'home' && cs.length) pintarWorkspace(); }).catch(() => { st.colecciones = []; });
}

function pintarHome() { if (E.get().modo === 'work' && E.get().vista === 'home') pintarWorkspace(); }

function pedirAFrancisco(texto) { abrirPanel({ foco: false }); $('texto').value = texto; $('formChat').requestSubmit(); }

function conectarComando(h) {
  // El selector de archivos se abre en el mismo clic (si no, el navegador lo bloquea); los adjuntos van a la bandeja de Francisco.
  h.querySelector('[data-ws="adjuntar"]')?.addEventListener('click', () => { $('inpArchivos').click(); abrirPanel({ foco: false }); });
  h.querySelector('[data-ws="comando"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = e.target.elements.pedido.value.trim();
    if (t) pedirAFrancisco(t);
  });
}

function conectarWorkspace(h) {
  conectarComando(h);
  h.querySelector('[data-ws="crear"]')?.addEventListener('click', () => {
    abrirPanel();
    $('texto').placeholder = 'Ej: "Creá un dashboard de cobranzas", "Necesito seguimiento de clientes"';
  });
  for (const k of ['archivados', 'ocultos', 'todo']) h.querySelector(`[data-ws="${k}"]`)?.addEventListener('click', () => { st.wsVer = k === 'todo' ? null : k; pintarWorkspace(); h.querySelector('#tGrid')?.focus?.(); });
  h.querySelectorAll('[data-continuar]').forEach((b) => b.addEventListener('click', () => {
    const rs = st.resume;
    location.hash = `#/a/${b.dataset.continuar}`;
    if (rs?.artefactoId === b.dataset.continuar) setTimeout(() => E.set({ desde: rs.desde, hasta: rs.hasta, filtro: rs.filtro }), 0);
  }));
  h.querySelectorAll('[data-centro]').forEach((b) => b.addEventListener('click', () => abrirCentro(b.dataset.centro)));
  const bento = h.querySelector('#bento');
  if (!bento) return;
  const abrir = (id) => { st.ultimaTarjeta = id; location.hash = `#/a/${id}`; };
  bento.addEventListener('click', (e) => {
    const card = e.target.closest('.lcard[data-art]');
    if (!card) return;
    const b = e.target.closest('[data-lc]');
    if (b) { e.stopPropagation(); return accionTarjeta(b.dataset.lc === 'menu' ? null : b.dataset.lc, card.dataset.art, b); }
    if (e.target.closest('a')) return;
    abrir(card.dataset.art);
  });
  bento.addEventListener('keydown', (e) => {
    const card = e.target.classList?.contains('lcard') ? e.target : null;
    if (!card?.dataset.art) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(card.dataset.art); }
  });
  // Arrastrar para ordenar (alternativa accesible: ••• → Mover antes/después).
  let arrastrada = null;
  bento.addEventListener('dragstart', (e) => { const c = e.target.closest?.('.lcard[data-art]'); if (!c) return; arrastrada = c.dataset.art; c.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', arrastrada); });
  bento.addEventListener('dragend', () => { bento.querySelectorAll('.arrastrando, .destino').forEach((n) => n.classList.remove('arrastrando', 'destino')); });
  bento.addEventListener('dragover', (e) => { if (!arrastrada) return; const c = e.target.closest('.lcard[data-art]'); if (c && c.dataset.art !== arrastrada) { e.preventDefault(); bento.querySelectorAll('.destino').forEach((n) => n.classList.remove('destino')); c.classList.add('destino'); } });
  bento.addEventListener('drop', (e) => {
    const c = e.target.closest('.lcard[data-art]');
    if (!arrastrada || !c || [...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    moverTarjeta(arrastrada, c.dataset.art);
    arrastrada = null;
  });
}

async function moverTarjeta(id, destino) {
  const ids = ordenarWorkspace(publicados().filter((a) => st.menu.get(a.id)?.status !== 'hidden'), st.menu).map((a) => a.id);
  const nuevo = reordenar(ids, id, destino);
  nuevo.forEach((x, i) => { const m = st.menu.get(x); if (m) m.ord = i; });
  pintarWorkspace();
  $('vistaHome').querySelector(`.lcard[data-art="${id}"]`)?.focus();
  try { await Promise.all(nuevo.map((x, i) => q(sb.from('so_menu').update({ ord: i }).eq('artifact_id', x)))); }
  catch (err) { toast(`No pude guardar el orden: ${err.message}.`); }
}

// ArtifactPreviewCache: se recalcula en segundo plano, de a uno, solo lo vencido. Nunca bloquea el Workspace.
let tPreviews = null;
function programarPreviews() {
  clearTimeout(tPreviews);
  tPreviews = setTimeout(async () => {
    for (const a of publicados()) {
      if (E.get().vista !== 'home') return;
      if (previewVigente(pvDe(a.id), a) || !a.datasource_id) continue;
      try { await actualizarPreview(a.id); } catch { /* la tarjeta queda con su último estado */ }
    }
  }, 'requestIdleCallback' in window ? 300 : 600);
}
async function actualizarPreview(id, d = null) {
  const a = artefacto(id);
  if (!a?.datasource_id) return null;
  d ||= await datosDe(id);
  const pv = calcularPreview(d.records, d.fields, a.configuration, hoy());
  ls.set(`so.pv.${id}`, pv);
  const m = st.menu.get(id);
  if (m) { m.preview = pv; m.preview_at = pv.at; }
  sb.from('so_menu').update({ preview: pv, preview_at: pv.at }).eq('artifact_id', id).then(() => {}, () => {});
  const card = $('vistaHome').querySelector(`.lcard[data-art="${id}"]`);
  if (card && !card.classList.contains('expandida')) {
    const foco = document.activeElement === card;
    card.outerHTML = htmlTarjeta(a, m || {}, pv, { editable: editable(a) });
    if (foco) $('vistaHome').querySelector(`.lcard[data-art="${id}"]`)?.focus();
  }
  return pv;
}
function invalidarPreview(id) { const m = st.menu.get(id); if (m) m.preview = null; ls.set(`so.pv.${id}`, null); }

// Toast con Deshacer (undo-first para acciones reversibles; nada de confirmaciones innecesarias).
function toast(texto, accion = null) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.append(t); }
  t.innerHTML = `<span>${esc(texto)}</span>${accion ? `<button type="button">${esc(accion.texto)}</button>` : ''}`;
  t.hidden = false;
  t.querySelector('button')?.addEventListener('click', async () => { t.hidden = true; await accion.fn(); });
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 7000);
}

// Menú contextual genérico (tarjetas y •••): teclado completo, Esc cierra y devuelve el foco.
function abrirMenuFlotante(ancla, items, alElegir) {
  const m = $('menuFlotante');
  m.innerHTML = items.map((it) => `<button type="button" role="menuitem" data-mi="${esc(it.id)}" ${it.peligro ? 'class="peligro-txt"' : ''}>${esc(it.texto)}</button>`).join('');
  m.hidden = false;
  const r = ancla.getBoundingClientRect();
  const ancho = Math.min(260, innerWidth - 16);
  m.style.left = `${Math.max(8, Math.min(innerWidth - ancho - 8, r.right - ancho))}px`;
  m.style.top = `${Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 6)}px`;
  ancla.setAttribute('aria-expanded', 'true');
  const botones = [...m.querySelectorAll('[role="menuitem"]')];
  botones[0]?.focus();
  const cerrar = (devolver = true) => { m.hidden = true; ancla.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', fuera, true); if (devolver && ancla.isConnected) ancla.focus(); };
  const fuera = (e) => { if (!m.contains(e.target) && e.target !== ancla) cerrar(false); };
  document.addEventListener('pointerdown', fuera, true);
  m.onkeydown = (e) => {
    const i = botones.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); botones[(i + 1) % botones.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); botones[(i - 1 + botones.length) % botones.length].focus(); }
    if (e.key === 'Tab') cerrar(false);
  };
  m.onclick = (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; cerrar(false); alElegir(b.dataset.mi); };
}

async function accionTarjeta(accion, id, ancla = null) {
  const a = artefacto(id);
  if (!a) return;
  const m = st.menu.get(id) || {};
  if (accion === null) {
    return abrirMenuFlotante(ancla, accionesMenu({ editable: editable(a), favorito: m.favorite, oculto: m.status === 'hidden', archivado: a.state === 'archived', tam: m.size || 'M' }),
      (x) => accionTarjeta(x, id, ancla));
  }
  const card = () => $('vistaHome').querySelector(`.lcard[data-art="${id}"]`);
  switch (accion) {
    case 'abrir': st.ultimaTarjeta = id; location.hash = `#/a/${id}`; return;
    case 'vistazo': {
      const c = card(); if (!c) return;
      if (c.classList.contains('expandida')) return cerrarVistazo(id);
      $('vistaHome').querySelectorAll('.lcard.expandida').forEach((n) => cerrarVistazo(n.dataset.art));
      c.classList.add('expandida');
      c.setAttribute('role', 'group');
      c.innerHTML = htmlVistazo(a, m, pvDe(id), { editable: editable(a) });
      c.querySelector('a.boton')?.focus();
      c.querySelector('[data-lc="cerrar-vistazo"]').addEventListener('click', (e) => { e.stopPropagation(); cerrarVistazo(id); });
      return;
    }
    case 'cerrar-vistazo': return cerrarVistazo(id);
    case 'preguntar': case 'editar':
      E.set({ artefactoId: id });
      abrirPanel();
      $('texto').placeholder = accion === 'editar' ? `¿Qué querés cambiar de ${a.name}?` : `Preguntá sobre ${a.name}…`;
      return;
    case 'actualizar': {
      toast(`Actualizando ${a.name}…`);
      st.datos.delete(id);
      try { await D.refrescarAlAbrir(id); const pv = await actualizarPreview(id, await datosDe(id, { forzar: true })); toast(`${a.name} actualizado${pv?.ultimo ? ` · último dato ${haceCuanto(pv.ultimo)}` : ''}.`); }
      catch (err) { toast(`No pude actualizar ${a.name}: ${err.message}. Seguís viendo los últimos datos.`); }
      if (card()?.classList.contains('expandida')) accionTarjeta('vistazo', id);
      return;
    }
    case 'compartir': location.hash = `#/a/${id}`; setTimeout(() => abrirHoja('compartir'), 250); return;
    case 'favorito': await procesarAccion({ tipo: 'favorito', artefactoId: id, valor: !m.favorite }); pintarWorkspace(); card()?.querySelector('[data-lc="favorito"]')?.focus(); return;
    case 'tam-S': case 'tam-M': case 'tam-L': {
      const size = accion.slice(4);
      m.size = size;
      const c = card(); if (c) c.dataset.size = size;
      c?.focus();
      sb.from('so_menu').update({ size }).eq('artifact_id', id).then(({ error }) => { if (error) toast('No pude guardar el tamaño.'); });
      return;
    }
    case 'antes': case 'despues': {
      const ids = ordenarWorkspace(publicados().filter((x) => st.menu.get(x.id)?.status !== 'hidden'), st.menu).map((x) => x.id);
      const i = ids.indexOf(id);
      return moverTarjeta(id, accion === 'antes' ? Math.max(0, i - 1) : Math.min(ids.length - 1, i + 1));
    }
    case 'ocultar': case 'mostrar': {
      const status = accion === 'ocultar' ? 'hidden' : 'available';
      await q(sb.from('so_menu').update({ status }).eq('artifact_id', id)); m.status = status;
      pintarWorkspace();
      toast(accion === 'ocultar' ? `Oculté ${a.name} del Workspace.` : `${a.name} vuelve al Workspace.`, { texto: 'Deshacer', fn: async () => { await q(sb.from('so_menu').update({ status: status === 'hidden' ? 'available' : 'hidden' }).eq('artifact_id', id)); m.status = status === 'hidden' ? 'available' : 'hidden'; pintarWorkspace(); } });
      return;
    }
    case 'archivar': case 'desarchivar': {
      const state = accion === 'archivar' ? 'archived' : 'published';
      await q(sb.from('so_artifacts').update({ state }).eq('id', id));
      const v = await q(sb.from('so_artifacts').select('state').eq('id', id).single());
      await cargarArtefactos(); pintarWorkspace();
      if (v.state !== state) return toast(`No pude ${accion} ${a.name}.`);
      toast(accion === 'archivar' ? `Archivé ${a.name}. Los datos siguen guardados.` : `${a.name} volvió al Workspace.`, { texto: 'Deshacer', fn: async () => { await q(sb.from('so_artifacts').update({ state: state === 'archived' ? 'published' : 'archived' }).eq('id', id)); await cargarArtefactos(); pintarWorkspace(); } });
      return;
    }
    case 'duplicar': {
      const nid = crypto.randomUUID();
      const nombre = `${a.name} (copia)`.slice(0, 120);
      await q(sb.from('so_artifacts').insert({ id: nid, project_id: a.project_id, name: nombre, type: a.type, route: `#/a/${nid}`, datasource_id: a.datasource_id, menu: a.menu || {},
        specification: { ...a.specification, duplicadoDe: a.id }, schema: a.schema, configuration: a.configuration, permissions: { default: 'owner' }, sharing: { default: 'USE' }, state: 'published', deployment_state: 'available' }));
      await q(sb.from('so_menu').insert({ artifact_id: nid, name: nombre, route: `#/a/${nid}`, ord: (m.ord ?? 0) + 1, size: m.size || 'M' }));
      const ok = (await q(sb.from('so_artifacts').select('id').eq('id', nid))).length === 1;
      await cargarArtefactos(); pintarWorkspace();
      if (!ok) return toast('No pude confirmar la copia.');
      toast(`Dupliqué ${a.name}: usa la misma fuente de datos (no se copian registros).`, { texto: 'Deshacer', fn: async () => { await q(sb.from('so_artifacts').update({ state: 'deleted', deleted_at: new Date().toISOString() }).eq('id', nid)); await sb.from('so_menu').update({ status: 'removed' }).eq('artifact_id', nid); await cargarArtefactos(); pintarWorkspace(); } });
      return;
    }
    case 'eliminar': {
      // Destrucción material: se explica el impacto antes (los datos históricos se conservan y es reversible).
      if (!confirm(`Eliminar "${a.name}" quita la visualización del Workspace. Los datos históricos, archivos y fuentes se conservan y podés deshacerlo desde la conversación. ¿Continuar?`)) return;
      await procesarAccion({ tipo: 'borrar_visualizacion', artefactoId: id });
      pintarWorkspace();
      return;
    }
  }
}
function cerrarVistazo(id) {
  const c = $('vistaHome').querySelector(`.lcard[data-art="${id}"]`);
  if (!c) return;
  const a = artefacto(id);
  c.outerHTML = htmlTarjeta(a, st.menu.get(id) || {}, pvDe(id), { editable: editable(a) });
  $('vistaHome').querySelector(`.lcard[data-art="${id}"]`)?.focus();
}

// Tarjeta de artefacto dentro de la conversación (misma Living Card, versión compacta).
function tarjetaArtefacto(a) {
  return `<div class="msg-card">${htmlTarjeta(a, st.menu.get(a.id) || {}, pvDe(a.id), { editable: false })}<a class="boton primario" href="#/a/${a.id}">Abrir</a></div>`;
}
function conectarTarjetas(raiz) {
  raiz.querySelectorAll('.msg-card .lcard[data-art]').forEach((c) => {
    c.setAttribute('draggable', 'false');
    c.addEventListener('click', (e) => { const b = e.target.closest('[data-lc]'); if (b) { e.stopPropagation(); return accionTarjeta(b.dataset.lc === 'menu' ? null : b.dataset.lc, c.dataset.art, b); } location.hash = `#/a/${c.dataset.art}`; });
    c.addEventListener('keydown', (e) => { if (e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = `#/a/${c.dataset.art}`; } });
  });
}

function editarConFrancisco(id) {
  E.set({ artefactoId: id });
  if (location.hash !== `#/a/${id}`) location.hash = `#/a/${id}`;
  abrirPanel();
  $('texto').placeholder = `¿Qué querés cambiar o saber de ${artefacto(id)?.name || 'este tablero'}?`;
}

// ---------------------------------------------------------------- contexto visible y sugerencias
// Contexto compacto: "Ventas · Sep 2026 · Web". Al tocarlo se ve el detalle y cada parte se puede quitar.
function pintarContexto() {
  const s = E.get();
  const a = s.artefactoId && artefacto(s.artefactoId);
  const periodo = s.desde || s.hasta ? (s.desde === s.hasta || !s.hasta || !s.desde ? nombreMes(s.desde || s.hasta) : `${nombreMes(s.desde)} – ${nombreMes(s.hasta)}`) : null;
  const lista = chips(s, { proyecto: st.proyectos.length > 1 ? proyecto()?.name : null, artefacto: a?.name, periodo, comparar: s.comparar && nombreMes(s.comparar) });
  const corto = [a?.name, periodo, s.filtro?.valor, s.comparar ? `vs. ${nombreMes(s.comparar)}` : null, s.seleccion?.etiqueta].filter(Boolean);
  const abierto = !!st.ctxAbierto;
  $('contexto').innerHTML = corto.length ? `<button type="button" class="ctx-resumen" aria-expanded="${abierto}" aria-controls="ctxChips" title="Ver y editar el contexto">${icono('chispa', { tam: 14 })}<span>${esc(corto.join(' · '))}</span></button>
    <div class="ctx-chips" id="ctxChips" ${abierto ? '' : 'hidden'}>${lista.map((c) => `<span class="chip">${esc(c.texto)}${c.quitar ? `<button type="button" data-quitar="${c.id}" aria-label="Quitar ${esc(c.texto)}">×</button>` : ''}</span>`).join('')}</div>` : '';
  $('contexto').querySelector('.ctx-resumen')?.addEventListener('click', () => { st.ctxAbierto = !st.ctxAbierto; pintarContexto(); $('contexto').querySelector('.ctx-resumen')?.focus(); });
  $('contexto').querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
    const c = lista.find((x) => x.id === b.dataset.quitar);
    E.set(c.quitar);
    if (c.id === 'artefacto' && location.hash.startsWith('#/a/')) location.hash = '#/';
  }));
  pintarSugerencias();
  if (E.get().vista === 'artefacto') pintarCabecera();
}

function pintarSugerencias() {
  const s = E.get();
  let sug = [];
  const vacio = !st.mensajes.length;
  if (s.seleccion) sug = ['¿Por qué cambió esto?', 'Comparalo con el mes anterior'];
  else if (s.artefactoId && vacio) sug = ['Analizá este tablero', 'Compará con el mes anterior', 'Compartí este tablero'];
  else if (vacio && (s.vista === 'home' || s.vista === 'chat') && !s.artefactoId) {
    sug = s.modo === 'work'
      ? (st.artefactos.length ? ['Analizá mis ventas', 'Compará estos períodos', 'Creá una herramienta para…', 'Abrí el dashboard que usamos ayer']
        : ['Creá un dashboard de ventas con histórico', 'Analizá mis ventas', 'Guardá este histórico', 'Creá una herramienta para…', 'Compartí este dashboard'])
      : ['Ayudame a organizar…', 'Analizá…', 'Investigá…', 'Recordame…'];
  }
  $('sugerencias').innerHTML = sug.map((t) => `<button type="button">${esc(t)}</button>`).join('');
  $('sugerencias').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const t = b.textContent;
    if (t.endsWith('…')) { $('texto').value = t.slice(0, -1); $('texto').focus(); return; }
    $('texto').value = t; $('formChat').requestSubmit();
  }));
}

// ---------------------------------------------------------------- mensajes
async function cargarMensajes() {
  st.mensajes = st.chatId ? (await q(sb.from('so_messages').select('id, role, content, meta, created_at').eq('chat_id', st.chatId).order('id', { ascending: false }).limit(100))).reverse() : [];
}

const ESTADOS = { verificado: ['✓ Verificado', 'ok'], ejecutado: ['Hecho', 'ok'], propuesta: ['Propuesta · esperando tu confirmación', 'aviso'],
  fallo: ['No se pudo completar', 'mal'], cancelado: ['Cancelado', ''], deshecho: ['Deshecho', ''] };

function htmlMensaje(m) {
  const meta = m.meta || {};
  let html = esc(m.content).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}">${u}</a>`);
  if (m.role !== 'assistant') return `<div class="msg ${m.role}">${html}${D.htmlAdjuntos(meta.adjuntos)}</div>`;
  const est = meta.deshecho ? 'deshecho' : meta.preview && meta.resuelto ? meta.resuelto : meta.estado;
  const badge = est && ESTADOS[est] ? `<span class="estado-msg ${ESTADOS[est][1]}">${ESTADOS[est][0]}</span>` : '';
  const conf = meta.confianza && meta.confianza.nivel !== 'confirmado'
    ? `<p class="confianza incompleta">Información incompleta${meta.confianza.motivo ? `: ${esc(meta.confianza.motivo)}` : ''}</p>` : '';
  const det = meta.porque || meta.fuente ? `<details class="detalles"><summary>${meta.fuente ? 'Ver fuentes' : 'Ver detalles'}</summary>
    ${meta.porque ? `<p>${esc(meta.porque)}</p>` : ''}${meta.fuente ? `<p class="vacio">Fuente: ${esc(meta.fuente.origen)} · ${esc(meta.fuente.operacion)} · ${esc(meta.fuente.registros)} registros · ${esc(new Date(meta.fuente.at).toLocaleString('es-AR'))}</p>` : ''}</details>` : '';
  const a = meta.artifactId && meta.tarjeta && artefacto(meta.artifactId);
  const card = a ? tarjetaArtefacto(a) : '';
  const acciones = [];
  if (meta.undo && !meta.deshecho) acciones.push(`<button type="button" data-undo="${m.id}">Deshacer</button>`);
  if (meta.preview && !meta.resuelto) acciones.push(`<button type="button" class="peligro" data-confirmar="${m.id}">${esc(meta.preview.boton || 'Confirmar')}</button><button type="button" data-cancelar="${m.id}">Cancelar</button>`);
  if (meta.reintentar && !meta.reintentado) acciones.push(`<button type="button" data-reintentar="${m.id}">Reintentar</button>`);
  if (meta.abrir && !a) acciones.push(`<a class="boton" href="#/a/${meta.abrir}">Ver dashboard</a>`);
  if (meta.incidencias) acciones.push(`<button type="button" data-incidencias="${meta.incidencias}">Ver incidencias</button>`);
  if (meta.revisar && !meta.resuelto) acciones.push(`<button type="button" data-revisar="${m.id}">Revisar columnas</button>`);
  if (meta.credencial) acciones.push(`<button type="button" class="primario" data-credencial="${meta.credencial}">Cargar credencial de forma segura</button>`);
  if (meta.reintentarApi && !meta.reintentado) acciones.push(`<button type="button" data-reintentar-api="${m.id}">Reintentar</button>`);
  if (meta.pin && !meta.fijado && !meta.deshecho) acciones.push(`<button type="button" data-fijar="${m.id}">${icono('agregar', { tam: 14 })} Fijar en Workspace</button>`);
  if (meta.fijado) acciones.push(`<a class="boton" href="#/a/${esc(meta.fijado)}">Ver en el Workspace</a>`);
  // Change Card: qué cambió, en lenguaje humano (nunca un diff técnico).
  const cambios = meta.cambios?.length && meta.artifactId ? `<div class="change-card ${meta.deshecho ? 'deshecho' : ''}"><strong>Francisco actualizó ${esc(artefacto(meta.artifactId)?.name || 'el tablero')}</strong>
    <ul>${meta.cambios.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>${E.get().artefactoId !== meta.artifactId || E.get().vista !== 'artefacto' ? `<a class="enlace" href="#/a/${esc(meta.artifactId)}">Ver</a>` : ''}</div>` : '';
  const ui = meta.ui?.length ? renderUI(meta.ui) : '';
  return `<div class="msg assistant">${badge}<div>${html}</div>${ui}${cambios}${conf}${det}${card}${acciones.length ? `<div class="msg-acc">${acciones.join('')}</div>` : ''}${htmlConformidad(m)}</div>`;
}

// Al terminar algo concreto (crear, cambiar, generar, fijar), Francisco pregunta si quedó como el usuario quería:
// la respuesta es una señal explícita de aprendizaje (no inferida) y cambia la emoción del avatar.
const entregable = (m) => {
  const x = m.meta || {};
  return m.role === 'assistant' && ['verificado', 'ejecutado'].includes(x.estado) && !x.deshecho && !x.preview
    && !!(x.artifactId || x.archivo || x.ui?.length || x.cambios?.length || x.fijado);
};
function htmlConformidad(m) {
  const c = m.meta?.conformidad;
  if (c === 'si') return '<p class="conformidad hecha">¡Genial! Lo tengo en cuenta para la próxima.</p>';
  if (c === 'no') return '<p class="conformidad hecha">Contame qué cambio y lo ajusto.</p>';
  const ultimo = [...st.mensajes].reverse().find((y) => y.role === 'assistant');
  if (!entregable(m) || ultimo?.id !== m.id) return '';   // solo en la última entrega, para no llenar el chat de preguntas
  return `<div class="conformidad" role="group" aria-label="¿Quedó como querías?"><span>¿Quedó como querías?</span>
    <button type="button" data-conforme="${m.id}" data-si="1">Sí, así</button><button type="button" data-conforme="${m.id}" data-si="0">No, ajustar</button></div>`;
}

async function responderConformidad(id, si) {
  const m = st.mensajes.find((y) => y.id === id);
  if (!m) return;
  const previo = st.mensajes[st.mensajes.indexOf(m) - 1];
  await actualizarMeta(id, { conformidad: si ? 'si' : 'no' });
  sb.from('so_signals').insert({ skill: m.meta?.artifactId ? 'FranciscoArtifact' : 'FranciscoIntent', signal: si ? 'acceptance' : 'correction', inferred: false,
    artifact_id: m.meta?.artifactId ?? null, meta: { pedido: previo?.role === 'user' ? previo.content.slice(0, 300) : null } }).then(() => {}, () => {});
  todosAv().forEach((a) => a.emocionar(si ? 'happy' : 'concerned'));
  setTimeout(() => todosAv().forEach((a) => a.emocionar('neutral')), 4000);
  if (!si) {
    st.esperandoAjuste = { artifactId: m.meta?.artifactId ?? null };
    abrirPanel({ foco: true });
    $('texto').placeholder = 'Contame qué querés distinto (por ejemplo: "en barras", "sólo web", "sin decimales")';
  }
  pintarMensajes();
}

function pintarMensajes() {
  const cont = $('mensajes');
  const bienvenida = !st.mensajes.length && E.get().vista === 'chat';
  cont.innerHTML = bienvenida ? `<div class="bienvenida"><span id="avatarChat"></span><h2>${E.get().modo === 'work' ? 'Soy Francisco. Decime qué querés conseguir.' : 'Soy Francisco. Acá charlamos tranquilos.'}</h2>
    <p class="vacio">${E.get().modo === 'work' ? 'Lo que creemos aparece en el Workspace.' : 'En Personal solo conversamos: no se crean tableros.'}</p></div>` : st.mensajes.map(htmlMensaje).join('');
  if (bienvenida) crearAvatar(cont.querySelector('#avatarChat'), { modo: E.get().modo });
  cont.querySelectorAll('.gu-file[data-file]').forEach((n) => n.querySelectorAll('[data-gf]').forEach((b) => b.addEventListener('click', () => accionArchivo(b.dataset.gf, n.dataset.file, b))));
  cont.querySelectorAll('[data-gu-accion]').forEach((b) => b.addEventListener('click', () => accionUI(b.dataset.guAccion, JSON.parse(b.dataset.guDatos || '{}'), b)));
  cont.querySelectorAll('[data-fijar]').forEach((b) => b.addEventListener('click', () => fijarEnWorkspace(Number(b.dataset.fijar))));
  cont.querySelectorAll('[data-conforme]').forEach((b) => b.addEventListener('click', () => responderConformidad(Number(b.dataset.conforme), b.dataset.si === '1')));
  conectarTarjetas(cont);
  cont.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => deshacerMensaje(Number(b.dataset.undo))));
  cont.querySelectorAll('[data-confirmar]').forEach((b) => b.addEventListener('click', () => resolverPreview(Number(b.dataset.confirmar), true)));
  cont.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', () => resolverPreview(Number(b.dataset.cancelar), false)));
  cont.querySelectorAll('[data-reintentar]').forEach((b) => b.addEventListener('click', () => reintentar(Number(b.dataset.reintentar))));
  D.conectarAdjuntos(cont);
  cont.querySelectorAll('[data-incidencias]').forEach((b) => b.addEventListener('click', () => D.incidenciasDe(b.dataset.incidencias)));
  cont.querySelectorAll('[data-revisar]').forEach((b) => b.addEventListener('click', () => {
    const x = st.mensajes.find((y) => y.id === Number(b.dataset.revisar))?.meta?.revisar;
    if (x) D.abrirImportacion(x.fileId, x.artefactoId);
  }));
  cont.querySelectorAll('[data-credencial]').forEach((b) => b.addEventListener('click', () => D.credencial(b.dataset.credencial)));
  cont.querySelectorAll('[data-reintentar-api]').forEach((b) => b.addEventListener('click', async () => {
    const m = st.mensajes.find((y) => y.id === Number(b.dataset.reintentarApi));
    await actualizarMeta(m.id, { reintentado: true });
    evento('retry', null, { via: 'api' });
    const r = await D.reintentarApi(m.meta.reintentarApi).catch((e) => ({ ok: false, texto: `No pude: ${e.message}.`, meta: { estado: 'fallo' } }));
    await guardarMensaje('assistant', r.texto, r.meta || {});
    if (r.ok !== false) evento('recovery_success', null, { via: 'api' });
  }));
  cont.scrollTop = cont.scrollHeight;
  pintarSugerencias();
}

// Nueva conversación: se empieza vacía y se crea en la base con el primer mensaje (asegurarChat), sin chats huérfanos.
function nuevaConversacion() {
  st.chatId = null; st.mensajes = []; st.archivoFoco = null;
  if (E.get().modo === 'personal' || E.get().vista === 'chat') { if (location.hash === '#/') ruta(); else location.hash = '#/'; }
  pintarMensajes(); pintarMenu();
  abrirPanel({ foco: true });
  $('lateral').classList.remove('abierto');
}
$('nuevaConversacion').onclick = nuevaConversacion;
$('nuevaConvPanel').onclick = nuevaConversacion;

async function asegurarChat(titulo) {
  if (st.chatId) return;
  const c = await q(sb.from('so_chats').insert({ mode: E.get().modo, project_id: E.get().proyectoId ?? null, title: titulo.slice(0, 60) }).select('id, title, mode, updated_at').single());
  st.chatId = c.id; st.mensajes = [];
  st.chats.unshift(c);
  cargarChats().catch(() => {});
  if (E.get().vista === 'chat') {   // en Personal o en la conversación completa, la URL refleja el chat
    history.replaceState(null, '', `#/c/${c.id}`);
    $('titulo').textContent = c.title;
  }
  $('ampliarPanel').hidden = E.get().vista === 'chat';
}

async function guardarMensaje(role, content, meta = {}) {
  const m = await q(sb.from('so_messages').insert({ chat_id: st.chatId, role, content, meta }).select('id, role, content, meta, created_at').single());
  sb.from('so_chats').update({ updated_at: new Date().toISOString() }).eq('id', st.chatId).then(() => {}, () => {});
  st.mensajes.push(m);
  pintarMensajes();
  return m;
}

async function actualizarMeta(id, patch) {
  const m = st.mensajes.find((x) => x.id === id);
  if (!m) return;
  m.meta = { ...m.meta, ...patch };
  pintarMensajes();
  await sb.from('so_messages').update({ meta: m.meta }).eq('id', id);
}

$('texto').addEventListener('input', (e) => {
  e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`;
  fase(e.target.value ? 'listening' : 'idle');
});
$('texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('formChat').requestSubmit(); } });

$('formChat').onsubmit = async (e) => {
  e.preventDefault();
  const texto = $('texto').value.trim();
  const hayAdjuntos = $('bandeja').children.length > 0 || st.adjuntosPrellenados?.length;
  if ((!texto && !hayAdjuntos) || st.ocupado) return;
  if (pareceSecreto(texto)) {
    // Una credencial no debe viajar ni quedar guardada en la conversación: no se envía.
    actividad('atencion');
    $('actividad').textContent = 'Eso parece una credencial: no la mandes por el chat. Cargala en "Datos y fuentes" → Conectar API (se guarda cifrada).';
    return;
  }
  $('texto').value = ''; $('texto').style.height = 'auto';
  await procesar(texto);
};

// ---------------------------------------------------------------- archivos: intención → archivo real (generar, editar, comparar, consolidar)
async function intencionArchivo(texto, adjuntos) {
  const n = normalizar(texto);
  const s = E.get();
  if (/\bcada vez que\b/.test(n) && /\b(cargue|cargo|suba|subo|importe|llegue|entre|actualice)\b/.test(n)) return crearAutomatizacionDesde(texto);
  if (/\b(mis|las|que) automatizaciones\b|\bque (tengo |hay )?programad[oa]s?\b|\bautomatizaciones (activas|programadas)\b/.test(n)) return listarAutomatizaciones();
  const pausa = n.match(/\b(pausa\w*|deten\w*|desactiva\w*|frena\w*|reactiva\w*|reanuda\w*|activa\w*)\b.*\b(automatizacion|programad[oa]|envio)/);
  if (pausa) return pausarAutomatizacion(texto, !/^(reactiva|reanuda|activa)/.test(pausa[1]));
  if (/\b(cada|todos los|todas las) (lunes|martes|miercoles|jueves|viernes|sabado|domingo|dia|dias|semana|semanas|mes|meses|manana|mananas|\d+ (horas|minutos))\b|\bde lunes a viernes\b|\bde cada mes\b/.test(n) && /\b(genera\w*|manda\w*|envia\w*|arma\w*|prepara\w*|informe|reporte|excel|pdf|word|csv|powerpoint|presentacion|planilla|export\w*)\b/.test(n)) {
    return programarDesde(texto);
  }
  const pl = texto.match(/guard[aá]\w*\s+(?:esto|este informe|este reporte|el informe|esta exportaci[oó]n|este archivo)?\s*como\s+plantilla(?:\s+(?:de\s+|llamada\s+)?["“]?([^"”.]+)["”]?)?/i);
  if (pl) {
    const f = st.archivoFoco && await D.archivo(st.archivoFoco);
    const aid = f?.artifact_id || s.artefactoId;
    if (!f || !aid) return { texto: 'Primero generá un informe desde un tablero (por ejemplo "exportá ventas a PDF") y después pedime que lo guarde como plantilla.' };
    return A.guardarPlantilla((pl[1] || `Informe de ${artefacto(aid)?.name || 'datos'}`).trim(), { formato: f.detected_type, artifactId: aid });
  }
  if (/\b(genera|generame|arma|armame|hace|haceme|prepara|preparame)\b/.test(n)) {
    const ps = await A.plantillas().catch(() => []);
    const p = ps.find((x) => n.includes(normalizar(x.name)));
    if (p) { actividad('creando'); return A.usarPlantilla(p); }
  }
  const archivosDe = async (lista) => (await Promise.all(lista.map((x) => D.archivo(x.fileId)))).filter(Boolean);
  if (/\b(consolid|unifica|unificar|junta|juntar|combina|combinar)\w*/.test(n) && adjuntos.length >= 2) {
    actividad('analizando');
    return A.consolidarArchivos(await archivosDe(adjuntos), (p) => { $('actividad').textContent = `Procesando · ${p}`; });
  }
  if (/\b(compar\w*|que cambio|diferencias)\b/.test(n) && !/\bcompart/.test(n)) {
    if (adjuntos.length >= 2) {
      actividad('analizando');
      const fs = (await archivosDe(adjuntos)).sort((x, y) => (x.version || 1) - (y.version || 1) || String(x.created_at).localeCompare(String(y.created_at)));
      return A.compararDos(fs[0], fs[1]);
    }
    if (/\b(version anterior|la anterior|version previa|v\d+)\b/.test(n) && st.archivoFoco) {
      actividad('analizando');
      const f = await D.archivo(st.archivoFoco);
      const vs = await A.versionesDe(f);
      const i = vs.findIndex((v) => v.id === f.id);
      return i > 0 ? A.compararDos(vs[i - 1], vs[i]) : { texto: `${f.original_name} no tiene una versión anterior.` };
    }
  }
  // Aperturas de exportación (como el saldo de deuda de VALO): en pantalla resumido, al exportar abierto.
  // "apertura(s)" solo existe al exportar: alcanza para reconocer el pedido aunque no diga "exportar".
  if (/\baperturas?\b/.test(n) || (/\b(exporta\w*|exportacion|excel|al exportar|cuando (lo )?export\w*|en el (excel|archivo|pdf))\b/.test(n)
      && /\b(abri\w*|abrir|desglos\w*|agrega\w*|suma\w*|inclui\w*|quiero|saca\w*|quita\w*|por dia|total por|detalle por)\b/.test(n))) {
    const r = await definirAperturas(texto);
    if (r) return r;
  }
  // Colecciones y paquetes ("descargar todo"): la colección es un metadato lógico y el paquete un ZIP verificado;
  // ninguno mueve, copia ni cambia el contenido de los archivos.
  const colM = texto.match(/colecci[oó]n\s+(?:de\s+|llamada\s+)?["“]?([^"”.,;!?]+?)["”]?\s*(?:[.,;!?]|$)/i);
  const coleccion = colM ? A.nombreColeccion(colM[1]) : null;
  const paqueteDe = /\b(descarga\w*|baja\w*|zip|paquete|comprimi\w*)\b/.test(n);
  if (coleccion) {
    if (paqueteDe) {
      actividad('creando');
      const fs = await A.archivosDeColeccion(coleccion);
      return fs.length ? A.paquete(fs, coleccion) : { texto: `La colección "${coleccion}" está vacía o no existe.` };
    }
    if (/\b(guarda\w*|move\w*|agrega\w*|pone\w*|mete\w*|suma\w*|archiva\w*)\b/.test(n)) {
      const fs = adjuntos.length ? await archivosDe(adjuntos) : /\b(estos|todos los|los archivos)\b/.test(n) ? await generadosDelChat() : st.archivoFoco ? [await D.archivo(st.archivoFoco)].filter(Boolean) : [];
      if (!fs.length) return { texto: `¿Qué archivo guardo en "${coleccion}"? Abrí uno o adjuntalo y pedímelo de nuevo.` };
      const r = await A.aColeccion(fs, coleccion);
      D.olvidar(fs.map((f) => f.id)); st.archivosRecientes = null;
      return r;
    }
    const fs = await A.archivosDeColeccion(coleccion);
    location.hash = `#/col/${encodeURIComponent(coleccion)}`;
    return { texto: fs.length ? `La colección "${coleccion}" tiene ${fs.length} ${fs.length === 1 ? 'archivo' : 'archivos'}: ${fs.slice(0, 8).map((f) => f.original_name).join(', ')}${fs.length > 8 ? '…' : ''}.` : `No hay archivos en la colección "${coleccion}".`, meta: { estado: 'ejecutado' } };
  }
  if (paqueteDe && /\b(todo|todos|todas|juntos|zip|paquete)\b/.test(n)) {
    const fs = adjuntos.length >= 2 ? await archivosDe(adjuntos) : await generadosDelChat();
    if (fs.length < 2) return { texto: 'No hay varios archivos para juntar en esta conversación. Adjuntalos o nombrá una colección ("descargá la colección Cierre").' };
    actividad('creando');
    return A.paquete(fs, s.artefactoId && artefacto(s.artefactoId) ? `Archivos ${artefacto(s.artefactoId).name}` : null);
  }
  const formato = formatoPedido(texto);
  if (formato) {
    actividad('creando');
    if (adjuntos.length === 1) return A.convertirArchivo(await D.archivo(adjuntos[0].fileId), formato);
    const deictico = /\b(esto|eso|este archivo|ese archivo|el archivo|lo que generaste|el que generaste|el excel|el pdf|la planilla|esa planilla)\b/.test(n);
    const datos = /\b(todos los datos|todo el historial|historial completo|sin filtros?|todo lo guardado|datos completos|detalle completo)\b/.test(n) ? 'todo' : null;
    if (s.vista === 'artefacto' && s.artefactoId && !(deictico && st.archivoFoco && /\b(archivo|generaste|planilla)\b/.test(n))) return A.exportarArtefacto(artefacto(s.artefactoId), formato, { datos });
    if (deictico && st.archivoFoco) return A.convertirArchivo(await D.archivo(st.archivoFoco), formato);
    const nombrado = publicados().find((a) => normalizar(a.name).split(/\s+/).filter((w) => w.length > 3 && !['dashboard', 'tablero'].includes(w)).some((w) => n.includes(w)));
    if (nombrado) return A.exportarArtefacto(nombrado, formato, { datos });
    if (s.artefactoId && artefacto(s.artefactoId)) return A.exportarArtefacto(artefacto(s.artefactoId), formato, { datos });
    return { texto: `¿De qué querés el ${FORMATOS[formato].etiqueta}? Abrí un tablero o adjuntá un archivo y pedímelo de nuevo.` };
  }
  if (st.archivoFoco && /\b(margen|duplicad\w*|repetid\w*|ordena\w*|deja solo|dejame solo|filtra\w* las filas|quita\w* la columna|saca\w* la columna)\b/.test(n) && (s.vista !== 'artefacto' || /\b(archivo|planilla|excel)\b/.test(n))) {
    const f = await D.archivo(st.archivoFoco);
    if (f?.kind === 'table') { actividad('actualizando'); const r = await A.editarArchivo(f, texto); if (r) return r; }
  }
  return null;
}

// "Cuando exporte, abrilo por canal y mes", "agregá la apertura por día", "sacá la apertura por canal".
async function definirAperturas(texto) {
  const n = normalizar(texto);
  const a = resolverArtefacto(texto, publicados().filter((x) => !x.configuration?.surface), E.get().artefactoId);
  if (!a) return { texto: '¿Para qué tablero? Por ejemplo: "cuando exporte ventas, abrilo por canal y mes".', meta: { estado: 'propuesta' } };
  const d = await datosDe(a.id).catch(() => null);
  const campos = (d?.fields || a.schema?.fields || []).filter((f) => f.type === 'text');
  const campo = campos.find((f) => n.includes(normalizar(f.label || f.key)) || n.includes(normalizar(f.key)));
  const ex = exportacionDe(a);
  const quitar = /\b(saca\w*|quita\w*|elimina\w*|borra\w*)\b/.test(n);
  const pedidas = [];
  if (/\bpor dia\b|\bdiari[ao]\b/.test(n)) pedidas.push({ tipo: 'dia' });
  if (campo) pedidas.push({ tipo: /\by (por )?mes\b|\bmes a mes\b|\bpor mes\b/.test(n) ? 'campo_mes' : 'campo', campo: campo.key });
  if (!pedidas.length) {
    if (!campos.length && !/\bdia\b/.test(n)) return null;
    return { texto: `¿Por qué querés abrir "${a.name}" al exportar? Puedo abrirlo por día (con el total de cada mes)${campos.length ? ` o por ${campos.map((f) => f.label || f.key).join(', ')}, solo o también por mes` : ''}.`, meta: { estado: 'propuesta' } };
  }
  const igual = (p, q) => p.tipo === q.tipo && (p.campo || null) === (q.campo || null);
  const mismaBase = (p, q) => (p.campo || null) === (q.campo || null) && (p.tipo === 'dia') === (q.tipo === 'dia');
  let aperturas = ex.aperturas.slice();
  if (quitar) aperturas = aperturas.filter((x) => !pedidas.some((p) => mismaBase(p, x)));
  else for (const p of pedidas) if (!aperturas.some((x) => igual(x, p))) aperturas = [...aperturas.filter((x) => !mismaBase(x, p)), p];
  const anterior = a.configuration?.exportacion ?? null;
  const exportacion = { ...(anterior || {}), aperturas };
  const [act] = await q(sb.from('so_artifacts').update({ configuration: { ...a.configuration, exportacion } }).eq('id', a.id).select('id, configuration, version'));
  if (!act) throw new Error('no pude guardar la exportación');
  Object.assign(a, { configuration: act.configuration, version: act.version });
  const lista = aperturas.map((x) => nombreApertura(x, d?.fields || [])).join('; ');
  return { texto: quitar
      ? `Listo: saqué esa apertura. ${aperturas.length ? `Al exportar "${a.name}" quedan: ${lista}.` : `"${a.name}" se exporta sin aperturas extra.`}`
      : `Listo: cuando exportes "${a.name}" (Excel, PDF o Word), además del resumen va a incluir: ${lista}. En Excel cada una es una hoja. El tablero se sigue viendo igual.`,
    meta: { estado: 'verificado', artifactId: a.id, cambios: pedidas.map((p) => `${quitar ? '−' : '+'} ${nombreApertura(p, d?.fields || [])} (al exportar)`),
      undo: { tipo: 'exportacion', artifactId: a.id, anterior },
      porque: 'Lo que se ve y lo que se exporta son configuraciones separadas: podés ver el tablero resumido y exportarlo abierto. También se usa en las plantillas y automatizaciones.' } };
}

// Archivos que Francisco generó o exportó en esta conversación (sin paquetes previos).
async function generadosDelChat() {
  if (!st.chatId) return [];
  const fs = await q(sb.from('so_files').select('*').eq('chat_id', st.chatId).in('origin', ['generated', 'export']).eq('status', 'ready').order('created_at').limit(200));
  return fs.filter((f) => f.detected_type !== 'zip');
}

// Automatización por calendario: corre en el servidor (Edge Function + pg_cron) aunque SO esté cerrado.
const fechaLocal = (d, tz) => d.toLocaleString('es-AR', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
async function programarDesde(texto) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || TZ_POR_DEFECTO;
  const h = interpretarHorario(texto, { tz });
  if (!h) return { texto: 'Puedo programar tareas diarias, semanales o mensuales (por ejemplo "cada lunes a las 9", "de lunes a viernes a las 8" o "el 1 de cada mes"). Intervalos de horas o minutos todavía no.', meta: { estado: 'propuesta' } };
  const a = resolverArtefacto(texto, publicados().filter((x) => !x.configuration?.surface), E.get().artefactoId);
  if (!a) return { texto: '¿De qué tablero? Por ejemplo: "Cada lunes a las 9 generá el PDF de ventas".', meta: { estado: 'propuesta' } };
  const pedido = formatoPedido(`generame ${texto}`);
  if (pedido && FORMATOS[pedido]?.imagen) return { texto: `Las imágenes (${FORMATOS[pedido].etiqueta}) se dibujan en tu navegador, así que no puedo generarlas en el servidor. Puedo programar PDF, Excel, Word, PowerPoint, CSV, JSON, XML, RTF o Markdown.`, meta: { estado: 'propuesta' } };
  const formato = pedido && FORMATOS_SERVIDOR.includes(pedido) ? pedido : 'pdf';
  const pasos = [formato, 'avisar'];   // programada: siempre se avisa (el usuario no está mirando)
  const proxima = proximaEjecucion(h);
  const nombre = `${describirHorario(h).replace(/^./, (c) => c.toUpperCase())}: ${FORMATOS[formato].etiqueta} de ${a.name}`.slice(0, 200);
  const auto = await q(sb.from('so_automations').insert({ artifact_id: a.id, name: nombre, trigger: { tipo: 'programada' }, action: { pasos }, schedule: h, next_run_at: proxima.toISOString() }).select('id, next_run_at').single());
  const ok = (await q(sb.from('so_automations').select('id, schedule, next_run_at, enabled').eq('id', auto.id))).some((x) => x.enabled && x.schedule?.hora === h.hora);
  return { texto: `Listo: ${describirHorario(h)} genero el ${FORMATOS[formato].etiqueta} de "${a.name}" con los datos del momento y te aviso. Corre en el servidor, aunque SO esté cerrado. Próxima: ${fechaLocal(proxima, h.tz)}.`,
    meta: { estado: ok ? 'verificado' : 'ejecutado', artifactId: a.id, undo: { tipo: 'automatizacion', id: auto.id, artifactId: a.id },
      porque: `Hora de ${h.tz.replace(/_/g, ' ')}. Cada ejecución queda en Actividad y el archivo en Archivos; si algo falla te llega un aviso. Podés pausarla con "pausá la automatización de ${a.name.toLowerCase()}".` } };
}

async function listarAutomatizaciones() {
  const autos = await q(sb.from('so_automations').select('id, name, enabled, schedule, next_run_at, last_run_at, last_status, artifact_id, trigger').order('created_at'));
  if (!autos.length) return { texto: 'No tenés automatizaciones. Probá: "cada lunes a las 9 generá el PDF de ventas" o "cada vez que cargue datos en ventas, avisame".', meta: { estado: 'ejecutado' } };
  const linea = (x) => `• ${x.name}${x.enabled ? '' : ' (pausada)'}${x.schedule ? ` — próxima: ${x.enabled && x.next_run_at ? fechaLocal(new Date(x.next_run_at), x.schedule.tz) : '—'}${x.last_status ? ` · última: ${x.last_status === 'ok' ? 'bien' : 'falló'}` : ''}` : ' — al cargar datos'}`;
  const ui = autos.slice(0, 8).map((x) => ({ type: 'Action', props: { label: `${x.enabled ? 'Pausar' : 'Reactivar'}: ${x.name}`.slice(0, 90), accion: x.enabled ? 'pausar_auto' : 'reanudar_auto', datos: { id: x.id } } }));
  return { texto: `Tus automatizaciones:\n${autos.map(linea).join('\n')}`, meta: { estado: 'ejecutado', ui } };
}

async function cambiarAutomatizacion(id, activa) {
  const [x] = await q(sb.from('so_automations').select('id, name, schedule').eq('id', id));
  if (!x) throw new Error('no encontré esa automatización');
  const cambio = { enabled: activa, ...(activa && x.schedule ? { next_run_at: proximaEjecucion(x.schedule).toISOString() } : {}) };
  const hechos = await q(sb.from('so_automations').update(cambio).eq('id', id).select('id, enabled, next_run_at'));
  if (hechos[0]?.enabled !== activa) throw new Error('no pude guardar el cambio');
  return { texto: activa ? `Reactivé "${x.name}".${x.schedule ? ` Próxima: ${fechaLocal(new Date(hechos[0].next_run_at), x.schedule.tz)}.` : ''}` : `Pausé "${x.name}". No se ejecuta hasta que la reactives.`, meta: { estado: 'verificado' } };
}

async function pausarAutomatizacion(texto, pausar) {
  const autos = await q(sb.from('so_automations').select('id, name, artifact_id, enabled').eq('enabled', pausar));   // pausar: entre las activas; reactivar: entre las pausadas
  const a = resolverArtefacto(texto, publicados(), E.get().artefactoId);
  const elegidas = a ? autos.filter((x) => x.artifact_id === a.id) : autos;
  if (!elegidas.length) return { texto: pausar ? 'No encontré automatizaciones activas para pausar.' : 'No hay automatizaciones pausadas para reactivar.' };
  if (elegidas.length > 1) return listarAutomatizaciones();
  return cambiarAutomatizacion(elegidas[0].id, !pausar);
}

async function crearAutomatizacionDesde(texto) {
  const n = normalizar(texto);
  const a = resolverArtefacto(texto, publicados(), E.get().artefactoId);
  if (!a) return { texto: '¿Para qué tablero? Por ejemplo: "Cada vez que cargue ventas, generá el PDF y avisame".' };
  const pasos = [];
  if (/\bcompar/.test(n)) pasos.push('comparar');
  if (/\bpdf|informe\b/.test(n)) pasos.push('pdf');
  if (/\bexcel|xlsx|planilla\b/.test(n)) pasos.push('xlsx');
  if (/\bavis|notific|aviseme|avisame\b/.test(n)) pasos.push('avisar');
  if (!pasos.some((x) => ['pdf', 'xlsx', 'avisar', 'comparar'].includes(x))) pasos.push('avisar');
  const id = await A.crearAutomatizacion(a, pasos);
  const ok = (await q(sb.from('so_automations').select('id').eq('id', id))).length === 1;
  const que = { comparar: 'lo comparo con el mes anterior', pdf: 'genero el PDF', xlsx: 'genero el Excel', avisar: 'te aviso' };
  return { texto: `Listo: cada vez que cargues datos en "${a.name}" (archivo, API o carga manual de un lote), valido e incorporo al histórico, actualizo el tablero y ${pasos.map((p) => que[p]).join(', ')}. Se ejecuta en SO al completarse la importación, una sola vez por carga.`,
    meta: { estado: ok ? 'verificado' : 'ejecutado', artifactId: a.id, undo: { tipo: 'automatizacion', id, artifactId: a.id },
      porque: 'Por ahora corre en tu sesión de SO al terminar la importación (no en un servidor programado). Cada ejecución queda en el centro de actividad.' } };
}

// Después de cualquier importación (chat, tablero o segundo plano): tarjeta al día + automatizaciones del tablero.
async function trasImportar(r) {
  const u = r?.meta?.undo;
  const aid = r?.meta?.artifactId || u?.artifactId;
  if (aid) invalidarPreview(aid);
  if (u?.tipo === 'importacion' && u.loteId && artefacto(aid)) {
    const res = await A.ejecutarAutomatizaciones(artefacto(aid), u.loteId).catch((e) => { console.error('automatizaciones', e); return []; });
    for (const x of res) {
      if (!st.chatId) await asegurarChat('Automatizaciones');
      await guardarMensaje('assistant', x.ok ? `Automatización de "${artefacto(aid).name}" completada: ${x.hechos.join(', ') || 'aviso enviado'}.` : `La automatización de "${artefacto(aid).name}" falló: ${x.error}`, { estado: x.ok ? 'verificado' : 'fallo' });
    }
    if (res.length) { st.archivosRecientes = null; cargarCentro(); }
  }
}

async function accionArchivo(accion, id, ancla) {
  try {
    if (accion === 'bajar') { await A.descargar(id); return; }
    if (accion === 'ver') { st.archivoFoco = id; return D.vistaPrevia(id); }
    if (accion === 'mas') {
      const f = await D.archivo(id);
      return abrirMenuFlotante(ancla, [{ id: 'abrir', texto: 'Abrir en SO' }, { id: 'usar', texto: 'Usar con Francisco' }, { id: 'versiones', texto: 'Ver versiones' },
        ...(f?.kind === 'table' ? [{ id: 'pdf', texto: 'Convertir a PDF' }, { id: 'pptx', texto: 'Convertir a PowerPoint' }] : []), { id: 'coleccion', texto: 'Guardar en una colección' }], async (x) => {
        if (x === 'abrir' || x === 'versiones') location.hash = `#/f/${id}`;
        if (x === 'coleccion') { st.abrirFormColeccion = true; if (location.hash === `#/f/${id}`) ruta(); else location.hash = `#/f/${id}`; }
        if (x === 'usar') { st.archivoFoco = id; D.prellenar('', [{ fileId: f.id, nombre: f.original_name, kind: f.kind, tipo: f.detected_type }]); }
        if (x === 'pdf' || x === 'pptx') pedirConArchivo(id, x === 'pdf' ? 'Pasalo a PDF' : 'Preparame una presentación con esto');
      });
    }
  } catch (err) { toast(`No pude: ${err.message}.`); }
}
function pedirConArchivo(fileId, texto) {
  D.archivo(fileId).then((f) => { abrirPanel({ foco: false }); procesar(texto, { adjuntosDirectos: [{ fileId: f.id, nombre: f.original_name, kind: f.kind, tipo: f.detected_type }] }); });
}

async function accionUI(accion, datos) {
  if (accion === 'pausar_auto' || accion === 'reanudar_auto') {
    const r = await cambiarAutomatizacion(datos.id, accion === 'reanudar_auto').catch((err) => ({ ok: false, texto: `No pude cambiar la automatización: ${err.message}.`, meta: { estado: 'fallo' } }));
    await guardarMensaje('assistant', r.texto, r.meta || {});
    return;
  }
  if (accion === 'exportar_comparacion') {
    actividad('creando');
    const r = await A.exportarComparacion(datos.a, datos.b).catch((err) => ({ ok: false, texto: `No pude exportar la comparación: ${err.message}.`, meta: { estado: 'fallo' } }));
    await guardarMensaje('assistant', r.texto, r.meta || {});
    actividad(r.ok === false ? 'atencion' : 'listo');
  }
}

// Pin to Workspace: Generative Surface → WorkArtifact → Living Card (con su fuente, para recalcular siempre).
async function fijarEnWorkspace(mensajeId) {
  const m = st.mensajes.find((x) => x.id === mensajeId);
  const pin = m?.meta?.pin;
  if (!pin || m.meta.fijado || st.ocupado) return;
  st.ocupado = true;
  try {
    const p = proyecto();
    const fuente = pin.fuente?.artifactId && artefacto(pin.fuente.artifactId);
    const id = crypto.randomUUID();
    const { specs } = validarUI(m.meta.ui || []);
    await q(sb.from('so_artifacts').insert({ id, project_id: p.id, name: pin.titulo.slice(0, 120), type: 'report', route: `#/a/${id}`, datasource_id: fuente?.datasource_id ?? null,
      menu: { icon: 'chispa' }, specification: { origen: 'GenerativeUI', fijadoDe: mensajeId }, schema: {}, permissions: { default: 'owner' }, sharing: { default: 'USE' },
      configuration: { surface: { ui: specs, fuente: pin.fuente || null }, presentation: { kind: 'analysis', icon: 'chispa', description: pin.titulo } }, state: 'published', deployment_state: 'available' }));
    await q(sb.from('so_menu').insert({ artifact_id: id, name: pin.titulo.slice(0, 120), route: `#/a/${id}`, ord: st.artefactos.length }));
    const ok = (await q(sb.from('so_artifacts').select('id').eq('id', id))).length === 1;
    await cargarArtefactos();
    await actualizarMeta(mensajeId, { fijado: id });
    await guardarMensaje('assistant', `Fijé "${pin.titulo}" en el Workspace. Se recalcula con los datos actuales cada vez que lo abrís.`, { estado: ok ? 'verificado' : 'ejecutado', artifactId: id, undo: { tipo: 'crear', artifactId: id } });
    evento('pin_to_workspace');
  } catch (err) { toast(`No pude fijarlo: ${err.message}.`); } finally { st.ocupado = false; }
}

// File Workspace: Header · Preview · Metadata · Acciones · Versiones (para archivos relevantes, no adjuntos triviales).
async function abrirArchivo(id) {
  vista('archivo');
  const c = $('vistaArchivo');
  c.innerHTML = esqueleto();
  const f = await D.archivo(id).catch(() => null);
  if (!f) { $('titulo').textContent = 'Archivo'; c.innerHTML = '<p class="vacio">Ese archivo no existe o no tenés acceso.</p>'; return; }
  st.archivoFoco = f.id;
  $('titulo').textContent = f.original_name; $('meta').textContent = '';
  $('tituloIcono').innerHTML = icono(f.kind === 'table' ? 'tabla' : f.kind === 'presentation' ? 'pres' : f.kind === 'image' ? 'imagen' : 'doc');
  const vs = await A.versionesDe(f).catch(() => [f]);
  const origen = { generated: 'Generado por Francisco', export: 'Exportado desde un tablero', upload: 'Subido', api: 'Desde una API', connector: 'Desde un conector' }[f.origin || 'upload'];
  const acciones = f.kind === 'table' ? [['analizar', 'Analizar'], ['editar', 'Editar con Francisco'], ['comparar', 'Comparar'], ['tablero', 'Crear tablero'], ['pdf', 'Convertir a PDF'], ['pptx', 'Presentación']]
    : f.kind === 'image' ? [['analizar', 'Analizar'], ['usar', 'Usar con Francisco']]
      : f.kind === 'presentation' ? [['resumir', 'Resumir'], ['pdf', 'Convertir a PDF']]
        : [['resumir', 'Resumir'], ['preguntar', 'Preguntar'], ['comparar', 'Comparar'], ['docx', 'Convertir a Word'], ['pdf', 'Convertir a PDF']];
  const art = f.artifact_id && artefacto(f.artifact_id);
  c.innerHTML = `<div class="archivo">
    <div class="arch-acc"><button type="button" class="primario" data-fa="bajar">${icono('bajar', { tam: 16 })} Descargar</button><button type="button" data-fa="ver">${icono('ojo', { tam: 16 })} Vista previa</button>
      ${acciones.map(([k, t]) => `<button type="button" data-fa="${k}">${esc(t)}</button>`).join('')}</div>
    <dl class="arch-meta"><div><dt>Tipo</dt><dd>${esc((f.detected_type || '').toUpperCase())} · ${esc(tamTxt(f.size))}</dd></div><div><dt>Origen</dt><dd>${esc(origen)}</dd></div>
      <div><dt>Versión</dt><dd>v${f.version || 1}${f.change_summary ? ` — ${esc(f.change_summary)}` : ''}</dd></div><div><dt>Creado</dt><dd>${esc(new Date(f.created_at).toLocaleString('es-AR'))}</dd></div>
      <div><dt>Colección</dt><dd>${f.collection ? `<a href="#/col/${esc(encodeURIComponent(f.collection))}">${esc(f.collection)}</a> · <button type="button" class="enlace" data-fa="sin-coleccion">Quitar</button>` : '<span class="vacio">Ninguna</span>'} · <button type="button" class="enlace" data-fa="coleccion" aria-expanded="false" aria-controls="formColeccion">${f.collection ? 'Cambiar' : 'Guardar en una colección'}</button>
        <form class="form-coleccion" id="formColeccion" hidden><input name="c" list="listaColecciones" maxlength="80" required placeholder="Nombre de la colección" aria-label="Nombre de la colección" value="${esc(f.collection || '')}"><datalist id="listaColecciones">${(st.colecciones || []).map((c) => `<option value="${esc(c.nombre)}">`).join('')}</datalist><button class="primario" type="submit">Guardar</button></form></dd></div>
      ${art ? `<div><dt>Tablero</dt><dd><a href="#/a/${esc(art.id)}">${esc(art.name)}</a></dd></div>` : ''}${f.meta?.resumen ? `<div class="ancho"><dt>Contenido</dt><dd>${esc(f.meta.resumen)}</dd></div>` : ''}</dl>
    <section class="tarjeta"><h3>Versiones</h3><ol class="versiones-arch" reversed>${vs.slice().reverse().map((v) => `<li class="${v.id === f.id ? 'actual' : ''}"><span><strong>v${v.version || 1}</strong> — ${esc(v.change_summary || (v.version > 1 ? 'versión nueva' : 'original'))}</span>
      <small>${esc(haceCuanto(v.created_at))}</small>${v.id === f.id ? '<span class="etiqueta">esta</span>' : `<span class="fila-acc"><a class="enlace" href="#/f/${esc(v.id)}">Abrir</a><button type="button" class="enlace" data-cmp="${esc(v.id)}">Comparar</button><button type="button" class="enlace" data-rest="${esc(v.id)}">Restaurar</button></span>`}</li>`).join('')}</ol>
      <p class="vacio">Editar o restaurar siempre crea una versión nueva: la historia no se pierde.</p></section></div>`;
  const tf = { fileId: f.id, nombre: f.original_name, kind: f.kind, tipo: f.detected_type };
  c.querySelectorAll('[data-fa]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.fa;
    if (k === 'bajar') return accionArchivo('bajar', f.id);
    if (k === 'coleccion') { const fm = c.querySelector('#formColeccion'); fm.hidden = !fm.hidden; b.setAttribute('aria-expanded', String(!fm.hidden)); if (!fm.hidden) fm.elements.c.focus(); return; }
    if (k === 'sin-coleccion') return cambiarColeccion([f], null);
    if (k === 'ver') return D.vistaPrevia(f.id);
    if (k === 'editar' || k === 'preguntar' || k === 'usar') { D.prellenar('', [tf]); $('texto').placeholder = k === 'editar' ? 'Ej: "agregale margen", "sacá duplicados", "ordená por monto"' : 'Preguntá sobre el archivo…'; return; }
    if (k === 'comparar') { const prev = vs[vs.findIndex((v) => v.id === f.id) - 1]; if (prev) return compararVersiones(prev.id, f.id); D.prellenar('Comparalo con ', [tf]); return; }
    const pedido = { analizar: 'Analizá este archivo', resumir: 'Resumí este archivo', tablero: 'Creá un dashboard con estos datos', pdf: 'Pasalo a PDF', pptx: 'Preparame una presentación con esto', docx: 'Pasalo a Word' }[k];
    abrirPanel({ foco: false }); procesar(pedido, { adjuntosDirectos: [tf] });
  }));
  c.querySelector('#formColeccion').addEventListener('submit', (e) => { e.preventDefault(); cambiarColeccion([f], e.target.elements.c.value); });
  if (st.abrirFormColeccion) { st.abrirFormColeccion = false; c.querySelector('[data-fa="coleccion"]').click(); }
  c.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => compararVersiones(b.dataset.cmp, f.id)));
  c.querySelectorAll('[data-rest]').forEach((b) => b.addEventListener('click', async () => {
    abrirPanel({ foco: false });
    const elegida = vs.find((v) => v.id === b.dataset.rest);
    if (!st.chatId) await asegurarChat(`Versiones de ${f.original_name}`);
    const r = await A.restaurar(f, elegida).catch((err) => ({ ok: false, texto: `No pude restaurar: ${err.message}.`, meta: { estado: 'fallo' } }));
    await guardarMensaje('assistant', r.texto, r.meta || {});
    if (r.meta?.archivo) location.hash = `#/f/${r.meta.archivo}`;
  }));
}
// Colección desde la interfaz (manipulación directa): mismo servicio y mismo deshacer que el pedido a Francisco.
async function cambiarColeccion(fs, nombre) {
  try {
    const r = nombre ? await A.aColeccion(fs, nombre) : await A.quitarDeColeccion(fs);
    D.olvidar(fs.map((f) => f.id)); st.archivosRecientes = null; st.colecciones = null;
    const u = r.meta?.undo || { tipo: 'coleccion', ids: fs.map((f) => f.id), anterior: Object.fromEntries(fs.map((f) => [f.id, f.collection ?? null])) };
    toast(r.texto, { texto: 'Deshacer', fn: async () => { await A.deshacerColeccion(u); D.olvidar(u.ids); st.archivosRecientes = null; st.colecciones = null; ruta(); } });
    ruta();
  } catch (err) { toast(`No pude cambiar la colección: ${err.message}.`); }
}

// Vista de colección: archivos agrupados lógicamente, con "Descargar todo" (ZIP verificado).
async function abrirColeccion(nombre) {
  vista('archivo');
  const c = $('vistaArchivo');
  c.innerHTML = esqueleto();
  $('titulo').textContent = nombre; $('meta').textContent = 'Colección';
  $('tituloIcono').innerHTML = icono('archivar');
  const fs = await A.archivosDeColeccion(nombre).catch(() => []);
  const ic = (f) => icono(f.kind === 'table' ? 'tabla' : f.kind === 'presentation' ? 'pres' : f.kind === 'image' ? 'imagen' : f.kind === 'other' ? 'archivo' : 'doc', { tam: 18 });
  c.innerHTML = `<div class="archivo coleccion">
    <div class="arch-acc">${fs.length ? `<button type="button" class="primario" data-col="todo">${icono('bajar', { tam: 16 })} Descargar todo (${fs.length})</button>` : ''}</div>
    ${fs.length ? `<ul class="col-lista">${fs.map((f) => `<li><a class="arch-chip" href="#/f/${esc(f.id)}">${ic(f)}<span><strong>${esc(f.original_name)}</strong><small>${esc((f.detected_type || '').toUpperCase())} · ${esc(tamTxt(f.size))}${f.version > 1 ? ` · v${f.version}` : ''} · ${esc(haceCuanto(f.created_at))}</small></span></a>
      <button type="button" class="enlace" data-col-quitar="${esc(f.id)}" aria-label="Quitar ${esc(f.original_name)} de la colección">Quitar</button></li>`).join('')}</ul>
      <p class="vacio">Una colección agrupa archivos sin moverlos ni copiarlos. "Descargar todo" arma un ZIP y verifica que se pueda bajar.</p>`
      : '<p class="vacio">Esta colección está vacía. Desde un archivo: "Guardar en una colección", o pedile a Francisco "guardá esto en la colección …".</p>'}</div>`;
  c.querySelector('[data-col="todo"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    abrirPanel({ foco: false });
    if (!st.chatId) await asegurarChat(`Colección ${nombre}`);
    actividad('creando');
    const r = await A.paquete(fs, nombre).catch((err) => ({ ok: false, texto: `No pude armar el paquete: ${err.message}.`, meta: { estado: 'fallo', reintentar: `descargá la colección ${nombre}` } }));
    await guardarMensaje('assistant', r.texto, r.meta || {});
    actividad(r.ok === false ? 'atencion' : 'listo');
    if (r.meta?.archivo) { st.archivoFoco = r.meta.archivo; await A.descargar(r.meta.archivo).catch(() => {}); }
    b.disabled = false;
  });
  c.querySelectorAll('[data-col-quitar]').forEach((b) => b.addEventListener('click', () => cambiarColeccion(fs.filter((f) => f.id === b.dataset.colQuitar), null)));
}

const tamTxt = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 102.4) / 10} KB` : `${Math.round(b / 104857.6) / 10} MB`);
async function compararVersiones(idA, idB) {
  abrirPanel({ foco: false });
  if (!st.chatId) await asegurarChat('Comparar versiones');
  actividad('analizando');
  const [fa, fb] = await Promise.all([D.archivo(idA), D.archivo(idB)]);
  const r = await A.compararDos(fa, fb).catch((err) => ({ ok: false, texto: `No pude comparar: ${err.message}.`, meta: { estado: 'fallo' } }));
  await guardarMensaje('assistant', r.texto, r.meta || {});
  actividad(r.ok === false ? 'atencion' : 'listo');
}

// ---------------------------------------------------------------- ciclo: intención → confianza → acción → visibilidad
async function procesar(texto, { reintentoDe = null, adjuntosDirectos = null } = {}) {
  st.ocupado = true; $('enviar').disabled = true;
  const inicio = performance.now();
  fase('thinking'); actividad('entendiendo');
  let r;
  try {
    // Adjuntos: el mensaje espera las subidas en curso; los que fallan no impiden enviar.
    let adjuntos = adjuntosDirectos || [], fuera = [];
    if (!reintentoDe && !adjuntosDirectos) {
      ({ adjuntos, fuera } = await D.tomarAdjuntos());
      if (st.adjuntosPrellenados?.length) { adjuntos = [...adjuntos, ...st.adjuntosPrellenados]; st.adjuntosPrellenados = null; }
    }
    if (!texto && adjuntos.length) texto = adjuntos.length === 1 ? 'Analizá este archivo' : 'Analizá estos archivos';
    if (!texto) { r = { texto: fuera.length ? `No pude adjuntar: ${fuera.join(', ')}.` : 'No hay nada para enviar.', meta: { estado: 'fallo' }, ok: false }; throw Object.assign(new Error('vacío'), { r }); }
    await asegurarChat(texto);
    if (E.get().vista !== 'chat') abrirPanel({ foco: false });   // la respuesta tiene que verse, sin abandonar la superficie actual
    if (!reintentoDe) {
      const m = await guardarMensaje('user', texto, { ...contextoMeta(), ...(adjuntos.length ? { adjuntos } : {}) });
      if (st.esperandoAjuste) {   // la corrección que pidió el usuario es su preferencia explícita (la usa la compactación)
        sb.from('so_signals').insert({ skill: 'FranciscoArtifact', signal: 'preference', inferred: false, artifact_id: st.esperandoAjuste.artifactId, meta: { value: texto.slice(0, 300) } }).then(() => {}, () => {});
        st.esperandoAjuste = null;
      }
      if (adjuntos.length) await D.asociarMensaje(adjuntos, m.id);
    }
    const s = E.get();
    const previos = adjuntos.length ? adjuntos : reintentoDe ? (st.mensajes.find((x) => x.id === reintentoDe)?.meta?.adjuntos || []) : [];
    if (previos.length === 1 && previos[0].kind === 'table') st.archivoFoco = previos[0].fileId;
    const archAcc = s.modo === 'work' ? await intencionArchivo(texto, previos) : null;
    const entradaAcc = archAcc ? null : interpretarEntrada(texto, { modo: s.modo, adjuntos: previos, adjuntosPrevios: ultimosAdjuntos(), artefactos: st.artefactos, activoId: s.artefactoId });
    if (archAcc) r = archAcc;
    else if (entradaAcc && entradaAcc.tipo !== 'bloqueado') { r = await D.ejecutarEntrada(entradaAcc); await trasImportar(r); }
    else if (entradaAcc) r = await ejecutar(entradaAcc, texto);
    else {
      const accion = interpretar(texto, { modo: s.modo, artefactos: st.artefactos, activoId: s.artefactoId, hoy: hoy() });
      if (riesgo(accion) === 'alto') r = await proponer(accion);
      else r = await ejecutar(accion, texto);
    }
    if (r?.meta?.archivo) { st.archivoFoco = r.meta.archivo; st.archivosRecientes = null; }
    if (fuera.length) r = { ...r, texto: `No pude adjuntar ${fuera.join(', ')}; seguí con el resto.\n${r.texto}` };
  } catch (err) {
    r = err.r || { texto: `No pude completarlo: ${err.message || err}.`, meta: { estado: 'fallo', reintentar: texto }, ok: false };
  }
  try {
    fase('responding');
    await guardarMensaje('assistant', r.texto, r.meta || {});
  } catch { /* si ni siquiera se puede guardar, el estado lo muestra */ }
  const ok = r.ok !== false;
  fase(ok ? 'success' : 'error');
  actividad(r.meta?.estado === 'propuesta' ? 'esperando' : ok ? 'listo' : 'atencion');
  if (reintentoDe) evento(ok ? 'recovery_success' : 'retry', null, { mensaje: reintentoDe });
  sb.from('so_obs').insert({ request_id: crypto.randomUUID(), project_id: E.get().proyectoId ?? null, model: r.modelo || null,
    skills: r.skills || ['FranciscoIntent'], capabilities: r.capacidades || [], latency_ms: Math.round(performance.now() - inicio),
    tokens: r.tokens ?? null, result: ok ? 'ok' : 'error' }).then(() => {}, () => {});
  if (ok && r.meta?.estado !== 'propuesta') evento('time_to_result', Math.round(performance.now() - inicio));
  st.ocupado = false; $('enviar').disabled = false;
  $('texto').placeholder = '¿Qué querés conseguir?';
}

// Adjuntos recientes de la conversación (para "analizá este archivo" en un mensaje posterior).
function ultimosAdjuntos() {
  for (const m of [...st.mensajes].reverse().slice(0, 8)) if (m.role === 'user' && m.meta?.adjuntos?.length) return m.meta.adjuntos;
  return [];
}

// La referencia estructurada (no solo el texto visible) viaja con el mensaje.
function contextoMeta() {
  const s = E.get();
  return { contexto: { modo: s.modo, proyectoId: s.proyectoId, artefactoId: s.artefactoId, vista: s.vista, desde: s.desde, hasta: s.hasta,
    filtro: s.filtro, comparar: s.comparar, seleccion: s.seleccion } };
}

async function reintentar(id) {
  const m = st.mensajes.find((x) => x.id === id);
  if (!m?.meta?.reintentar || st.ocupado) return;
  await actualizarMeta(id, { reintentado: true });
  evento('retry');
  await procesar(m.meta.reintentar, { reintentoDe: id });
}

// ---------------------------------------------------------------- alto riesgo: vista previa breve
async function proponer(acc) {
  const a = artefacto(acc.artefactoId);
  if (acc.tipo === 'borrar_datos') {
    if (!a?.datasource_id) return { texto: 'Ese tablero no tiene datos guardados.' };
    const { count } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('datasource_id', a.datasource_id);
    return { texto: `Antes de borrar: se eliminan definitivamente ${count ?? 0} registros históricos de "${a.name}". El tablero queda, vacío. Esto no se puede deshacer.`,
      meta: { estado: 'propuesta', preview: { accion: acc, boton: `Borrar ${count ?? 0} registros` }, artifactId: a.id } };
  }
  if (acc.tipo === 'compartir') {
    return { texto: `Antes de compartir: ${explicarPermiso(acc.email, 'EDIT', `"${a.name}"`)} Va a poder cambiar campos y gráficos.`,
      meta: { estado: 'propuesta', preview: { accion: acc, boton: 'Compartir con permiso para modificar' }, artifactId: a.id } };
  }
  return ejecutar(acc);
}

async function resolverPreview(id, confirmar) {
  const m = st.mensajes.find((x) => x.id === id);
  if (!m?.meta?.preview || m.meta.resuelto || st.ocupado) return;
  await actualizarMeta(id, { resuelto: confirmar ? 'ejecutado' : 'cancelado' });
  evento(confirmar ? 'preview_confirmed' : 'preview_cancelled', null, { tipo: m.meta.preview.accion.tipo });
  if (!confirmar) { await guardarMensaje('assistant', 'No hice nada. Todo queda como estaba.', { estado: 'cancelado' }); return; }
  st.ocupado = true; fase('thinking');
  let r;
  try { r = D.esAccionDatos(m.meta.preview.accion.tipo) ? await D.ejecutarEntrada(m.meta.preview.accion) : await ejecutar(m.meta.preview.accion); } catch (err) { r = { texto: `No pude completarlo: ${err.message}.`, meta: { estado: 'fallo' }, ok: false }; }
  await guardarMensaje('assistant', r.texto, r.meta || {});
  fase(r.ok === false ? 'error' : 'success'); actividad(r.ok === false ? 'atencion' : 'listo');
  st.ocupado = false;
}

// ---------------------------------------------------------------- ejecución
async function datosDe(id, { forzar = false } = {}) {
  const a = artefacto(id) || (await q(sb.from('so_artifacts').select('*').eq('id', id).maybeSingle()));
  if (!a) throw new Error('ese tablero no existe');
  const c = st.datos.get(id);
  if (c && !forzar && Date.now() - Date.parse(c.cargado) < 30000) return { a, ...c };
  const [ds, records] = await Promise.all([
    q(sb.from('so_datasources').select('id, owner_id, name, fields').eq('id', a.datasource_id).single()),
    q(sb.from('so_records').select('id, period, data, created_at, import_batch_id').eq('datasource_id', a.datasource_id).is('superseded_by', null).order('period').order('id').limit(20000)),
  ]);
  const ultimo = records.reduce((m, r) => (r.created_at > m ? r.created_at : m), '') || null;
  const d = { fields: ds.fields, origen: ds.name, records, cargado: new Date().toISOString(), ultimo };
  st.datos.set(id, d);
  ls.set(`so.datos.${id}`, { ...d, records: records.slice(-3000) });
  return { a, ...d };
}

const verbo = { crear: 'crear', agregar_campos: 'actualizar', grafico: 'actualizar', renombrar: 'actualizar', registrar: 'guardar', compartir: 'compartir' };

async function ejecutar(acc, texto = '') {
  const s = E.get();
  switch (acc.tipo) {
    case 'crear': actividad('creando'); return crearArtefacto(acc.artefacto);
    case 'agregar_campos': actividad('actualizando'); return agregarCampos(acc);
    case 'grafico': {
      actividad('actualizando');
      senal('FranciscoUI', 'preference', { value: `grafico:${acc.grafico}` }, acc.artefactoId);
      return actualizarArtefacto(acc.artefactoId, (a) => ({ configuration: { ...a.configuration, grafico: acc.grafico } }),
        `Cambié el gráfico a ${{ bar: 'barras', line: 'líneas', pie: 'torta' }[acc.grafico]}.`, {}, [`~ gráfico de ${{ bar: 'barras', line: 'líneas', pie: 'torta' }[acc.grafico]}`]);
    }
    case 'renombrar': {
      actividad('actualizando');
      const r = await actualizarArtefacto(acc.artefactoId, () => ({ name: acc.nombre }), `Ahora se llama "${acc.nombre}".`, {}, [`~ nombre: ${acc.nombre}`]);
      await sb.from('so_menu').update({ name: acc.nombre }).eq('artifact_id', acc.artefactoId);
      return r;
    }
    case 'compartir': {
      actividad('actualizando');
      const a = artefacto(acc.artefactoId);
      const previo = (await q(sb.from('so_shares').select('id, permission').eq('artifact_id', a.id).ilike('grantee_email', acc.email).is('revoked_at', null)))[0];
      const shareId = await q(sb.rpc('so_compartir', { p_artifact: a.id, p_email: acc.email, p_permission: acc.permiso }));
      actividad('verificando');
      const ok = (await q(sb.from('so_shares').select('id').eq('id', shareId).eq('permission', acc.permiso).is('revoked_at', null))).length === 1;
      if (!ok) return { ok: false, texto: `No pude confirmar que "${a.name}" quedó compartido con ${acc.email}.`, meta: { estado: 'fallo', reintentar: texto } };
      evento('share_success', null, { permiso: acc.permiso });
      if (E.get().vista === 'artefacto' && E.get().artefactoId === a.id) pintarCompartidos(a);
      senal('FranciscoSecurity', 'success', { op: 'share', permiso: acc.permiso }, a.id);
      return { texto: `${explicarPermiso(acc.email, acc.permiso, `"${a.name}"`)} No ve tus conversaciones ni otros tableros.\nLink: ${BASE_SHARED}${a.id}`,
        meta: { estado: 'verificado', artifactId: a.id, undo: { tipo: 'compartir', artifactId: a.id, shareId, email: acc.email, previo: previo?.permission || null },
          porque: 'Tiene que entrar con ese mismo correo. Si no tiene usuario, hay que crearlo en Supabase (el registro libre está cerrado).' },
        skills: ['FranciscoIntent', 'FranciscoSecurity'] };
    }
    case 'revocar': {
      actividad('actualizando');
      let qs = sb.from('so_shares').select('id, grantee_email, permission').eq('artifact_id', acc.artefactoId).is('revoked_at', null);
      if (acc.email) qs = qs.ilike('grantee_email', acc.email);
      const ss = await q(qs);
      if (!ss.length) return { texto: 'Ese tablero no está compartido con esa persona.' };
      for (const x of ss) await q(sb.rpc('so_revocar', { p_share: x.id }));
      actividad('verificando');
      const quedan = await q(sb.from('so_shares').select('id').in('id', ss.map((x) => x.id)).is('revoked_at', null));
      if (quedan.length) return { ok: false, texto: 'No pude confirmar la revocación de todos los accesos.', meta: { estado: 'fallo', reintentar: texto } };
      if (E.get().vista === 'artefacto' && E.get().artefactoId === acc.artefactoId) pintarCompartidos(artefacto(acc.artefactoId));
      return { texto: `${ss.map((x) => x.grantee_email).join(', ')} ya no puede${ss.length > 1 ? 'n' : ''} abrir "${artefacto(acc.artefactoId)?.name}".`,
        meta: { estado: 'verificado', artifactId: acc.artefactoId, undo: { tipo: 'revocar', artifactId: acc.artefactoId, shares: ss.map((x) => ({ email: x.grantee_email, permission: x.permission })) } } };
    }
    case 'borrar_visualizacion': {
      actividad('actualizando');
      const a = artefacto(acc.artefactoId);
      await q(sb.from('so_artifacts').update({ state: 'deleted', deleted_at: new Date().toISOString() }).eq('id', a.id));
      await sb.from('so_menu').update({ status: 'removed' }).eq('artifact_id', a.id);
      E.set({ artefactoId: null });
      await cargarArtefactos();
      if (location.hash === `#/a/${a.id}`) location.hash = '#/';
      return { texto: `Saqué "${a.name}" del workspace. Los datos históricos siguen guardados.`, meta: { estado: 'ejecutado', undo: { tipo: 'restaurar', artifactId: a.id } } };
    }
    case 'borrar_datos': {
      actividad('actualizando');
      const a = artefacto(acc.artefactoId);
      const { count } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('datasource_id', a.datasource_id);
      await q(sb.from('so_records').delete().eq('datasource_id', a.datasource_id));
      actividad('verificando');
      const { count: quedan } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('datasource_id', a.datasource_id);
      await sb.from('so_decisions').insert({ project_id: s.proyectoId, chat_id: st.chatId, artifact_id: a.id, decision: `Se borraron los datos de "${a.name}" (${count ?? 0} registros), con confirmación explícita.` });
      st.datos.delete(a.id);
      if (quedan) return { ok: false, texto: `Quedaron ${quedan} registros sin borrar en "${a.name}".`, meta: { estado: 'fallo' } };
      return { texto: `Borré ${count ?? 0} registros de "${a.name}". El tablero sigue disponible, vacío.`, meta: { estado: 'verificado', artifactId: a.id, tarjeta: true } };
    }
    case 'registrar': {
      actividad('actualizando');
      const { a, fields } = await datosDe(acc.artefactoId);
      const data = armarRegistro(fields, acc);
      if (!Object.keys(data).length) { actividad('esperando'); return { texto: `No identifiqué qué dato cargar en "${a.name}". Probá con "registrá 1500 canal web".` }; }
      const period = acc.fecha || hoy();
      const rec = await q(sb.from('so_records').insert({ datasource_id: a.datasource_id, owner_id: st.user.id, period, data, idempotency_key: crypto.randomUUID() }).select('id').single());
      actividad('verificando');
      const ok = (await q(sb.from('so_records').select('id').eq('id', rec.id))).length === 1;
      st.datos.delete(a.id);
      senal('FranciscoData', 'success', { op: 'record' }, a.id);
      if (E.get().vista === 'artefacto' && E.get().artefactoId === a.id) abrirArtefacto(a.id, { forzar: true });
      return { texto: `Guardé en "${a.name}" (${period}): ${Object.entries(data).map(([k, v]) => `${k} = ${v}`).join(', ')}.`,
        meta: { estado: ok ? 'verificado' : 'ejecutado', abrir: a.id, artifactId: a.id, undo: { tipo: 'registro', recordId: rec.id, artifactId: a.id } }, skills: ['FranciscoIntent', 'FranciscoData'] };
    }
    case 'comparar': {
      actividad('analizando');
      const { a, fields, records, origen } = await datosDe(acc.artefactoId);
      const num = fields.find((f) => f.key === (a.configuration?.metrica || '')) || fields.find((f) => f.type === 'number');
      if (!num) return { texto: `"${a.name}" no tiene campos numéricos para comparar.` };
      const meses = mesesConDatos(records);
      // "noviembre" sin año: si hay datos de ese mes en otro año, se usa el más cercano a los datos (no a hoy).
      const ajustar = (ym) => {
        if (!ym || meses.includes(ym)) return ym;
        const mismos = meses.filter((m) => m.slice(5) === ym.slice(5));
        return mismos.sort((x, y) => Math.abs(+x.slice(0, 4) - +ym.slice(0, 4)) - Math.abs(+y.slice(0, 4) - +ym.slice(0, 4)))[0] || ym;
      };
      const mesA = ajustar(acc.mesA) || s.seleccion?.mes || s.hasta || s.desde || meses.at(-1);
      if (!mesA) return { texto: `Todavía no hay datos en "${a.name}" para comparar.` };
      const mesB = acc.mesB && acc.mesB !== mesA ? ajustar(acc.mesB) : mesAnterior(mesA);
      const base = s.filtro && s.artefactoId === a.id ? records.filter((r) => String(r.data?.[s.filtro.key] ?? '').toLowerCase() === String(s.filtro.valor).toLowerCase()) : records;
      // La explicación usa la categoría más útil: un campo de texto con pocos valores distintos (canal, región…).
      const cat = fields.filter((f) => f.type === 'text').map((f) => ({ f, n: new Set(records.map((r) => r.data?.[f.key]).filter(Boolean)).size }))
        .filter((x) => x.n >= 2 && x.n <= 20).sort((x, y) => x.n - y.n)[0]?.f || null;
      const c = comparar(base, num, mesA, mesB, cat, hoy());
      E.set({ artefactoId: a.id, desde: mesA, hasta: mesA, comparar: mesB, ...(s.artefactoId === a.id ? {} : { filtro: null }) });
      if (location.hash !== `#/a/${a.id}`) location.hash = `#/a/${a.id}`; else abrirArtefacto(a.id);
      const filtro = base !== records ? s.filtro : null;
      return { texto: c.texto, meta: { estado: 'ejecutado', confianza: c.confianza, artifactId: a.id, ui: specsComparacion(c, num, cat),
        pin: { titulo: `${a.name}: ${nombreMes(mesA)} vs. ${nombreMes(mesB)}${filtro ? ` (${filtro.valor})` : ''}`, fuente: { op: 'comparar', artifactId: a.id, campo: num.key, mesA, mesB, filtro } },
        fuente: { origen, operacion: c.evidencia.operacion + (filtro ? ` (solo ${filtro.valor})` : ''), registros: c.evidencia.registros, at: new Date().toISOString() },
        porque: `Usé "${origen}" porque es la fuente asociada a "${a.name}".` }, skills: ['FranciscoIntent', 'FranciscoData', 'GenerativeUI'] };
    }
    case 'por_que': {
      actividad('analizando');
      const sel = s.seleccion?.artefactoId === acc.artefactoId ? s.seleccion : null;
      const mes = acc.mes || sel?.mes || s.hasta || s.desde || null;
      return ejecutar({ tipo: 'comparar', artefactoId: acc.artefactoId, mesA: mes, mesB: null });
    }
    case 'analizar': {
      actividad('analizando');
      const { a, fields, records, origen } = await datosDe(acc.artefactoId);
      const r = analizar(records, fields, hoy());
      const num = fields.find((f) => f.key === a.configuration?.metrica) || fields.find((f) => f.type === 'number');
      const ui = [];
      if (num && r.a) {
        const serie = (await import('./vista.js')).porMes(records, num.key).slice(-12);
        ui.push({ type: 'Metric', props: { label: `${num.label} ${nombreMes(r.a.mes)}`, valor: r.a.total, delta: r.variacion, detalle: `vs. ${nombreMes(r.b.mes)}` } });
        if (serie.length > 1) ui.push({ type: 'Chart', props: { titulo: `${num.label} por mes`, tipo: 'bar', puntos: serie.map((p) => ({ x: p.mes, y: p.total })) } });
        const cat = categoriaUtil(fields, records);
        for (const i of (await import('./analisis.js')).insights(records, num, cat, {}, hoy(), 2)) ui.push({ type: 'Insight', props: { titulo: i.titulo, texto: i.texto, tono: i.tono } });
      }
      return { texto: r.texto, meta: { estado: 'ejecutado', confianza: r.confianza, artifactId: a.id, tarjeta: !ui.length, ui,
        fuente: r.evidencia ? { origen, operacion: r.evidencia.operacion, registros: r.evidencia.registros, at: new Date().toISOString() } : null,
        porque: `Usé "${origen}" porque es la fuente asociada a "${a.name}".` } };
    }
    case 'filtrar': {
      const id = acc.artefactoId || s.artefactoId;
      if (!acc.valor) { E.set({ filtro: null }); return { texto: 'Saqué el filtro: se ven todos los datos.' }; }
      actividad('buscando');
      const { a, fields, records } = await datosDe(id);
      const buscado = normalizar(acc.valor);
      for (const f of fields.filter((x) => x.type === 'text')) {
        const valores = [...new Set(records.map((r) => r.data?.[f.key]).filter(Boolean))];
        const hit = valores.find((v) => normalizar(v) === buscado) || valores.find((v) => normalizar(v).includes(buscado) || buscado.includes(normalizar(v)));
        if (hit) {
          const mes = acc.mes && mesesConDatos(records).includes(acc.mes) ? acc.mes : acc.mes ? mesesConDatos(records).filter((m) => m.slice(5) === acc.mes.slice(5)).at(-1) || acc.mes : null;
          E.set({ artefactoId: a.id, filtro: { key: f.key, valor: hit, label: f.label }, ...(mes ? { desde: mes, hasta: mes } : {}) });
          if (location.hash !== `#/a/${a.id}`) location.hash = `#/a/${a.id}`; else abrirArtefacto(a.id);
          return { texto: `Mostrando solo ${f.label || f.key}: ${hit}${mes ? ` de ${nombreMes(mes)}` : ''} en "${a.name}".`, meta: { estado: 'ejecutado', ui: [{ type: 'Filter', props: { label: f.label || f.key, valor: hit } }, ...(mes ? [{ type: 'Filter', props: { label: 'Mes', valor: nombreMes(mes) } }] : [])] } };
        }
      }
      actividad('esperando');
      const ejemplos = fields.filter((x) => x.type === 'text').map((f) => `${f.label}: ${[...new Set(records.map((r) => r.data?.[f.key]).filter(Boolean))].slice(0, 5).join(', ') || 'sin datos'}`).join(' · ');
      return { texto: `No encontré "${acc.valor}" en los datos de "${a.name}". ${ejemplos ? `Valores disponibles → ${ejemplos}.` : ''}` };
    }
    case 'periodo': {
      const { a, fields, records } = await datosDe(acc.artefactoId);
      E.set({ artefactoId: a.id, desde: acc.mes, hasta: acc.mes, comparar: null });
      if (location.hash !== `#/a/${a.id}`) location.hash = `#/a/${a.id}`; else abrirArtefacto(a.id);
      const num = fields.find((f) => f.type === 'number');
      const t = num ? totalMes(records, num.key, acc.mes) : null;
      return { texto: `Mostrando ${nombreMes(acc.mes)} en "${a.name}"${t ? `: ${num.label} ${new Intl.NumberFormat('es-AR').format(t.total)} en ${t.n} registros` : ''}.`,
        meta: { estado: 'ejecutado', confianza: t && t.n === 0 ? { nivel: 'incompleta', motivo: `no hay datos de ${nombreMes(acc.mes)}` } : null } };
    }
    case 'abrir': {
      actividad('buscando');
      let destino = acc.artefactoId ? artefacto(acc.artefactoId) : null;
      if (acc.cuando != null) {
        const dia = new Date(); dia.setDate(dia.getDate() - acc.cuando);
        const clave = dia.toLocaleDateString('sv');
        const delDia = new Set((ls.get('so.aperturas') || []).filter((x) => new Date(x.at).toLocaleDateString('sv') === clave).map((x) => x.id));
        const cand = recientes(50).filter(({ a, m }) => delDia.has(a.id) || (m.last_opened_at && new Date(m.last_opened_at).toLocaleDateString('sv') === clave))
          .sort((x, y) => (y.m.open_count || 0) - (x.m.open_count || 0));
        destino = acc.cuando === 0 ? recientes(1)[0]?.a : cand[0]?.a;
        if (!destino) return { texto: `No encontré tableros abiertos ${acc.cuando === 1 ? 'ayer' : 'ese día'}. Los más recientes: ${recientes(3).map(({ a }) => a.name).join(', ') || 'ninguno'}.` };
      }
      if (!destino) return { texto: 'No encontré ese tablero.' };
      location.hash = `#/a/${destino.id}`;
      return { texto: `Abrí "${destino.name}".`, meta: { estado: 'ejecutado', artifactId: destino.id } };
    }
    case 'favorito': {
      await q(sb.from('so_menu').update({ favorite: acc.valor }).eq('artifact_id', acc.artefactoId));
      await cargarArtefactos();
      return { texto: acc.valor ? `Agregué "${artefacto(acc.artefactoId)?.name}" a favoritos.` : `Saqué "${artefacto(acc.artefactoId)?.name}" de favoritos.`,
        meta: { estado: 'ejecutado', undo: { tipo: 'favorito', artifactId: acc.artefactoId, valor: !acc.valor } } };
    }
    case 'deshacer': {
      const m = [...st.mensajes].reverse().find((x) => x.meta?.undo && !x.meta?.deshecho);
      if (!m) return { texto: 'No hay un cambio reciente para deshacer en esta conversación.' };
      await deshacerMensaje(m.id, { silencioso: true });
      return { texto: 'Listo, deshice el último cambio.', meta: { estado: 'ejecutado' } };
    }
    case 'proyecto_crear': {
      actividad('creando');
      const p = await q(sb.from('so_espacios').insert({ name: acc.nombre, mode: 'work' }).select('id, name, memoria, updated_at').single());
      st.proyectos.push(p);
      await cambiarProyecto(p.id);
      return { texto: `Creé el proyecto "${p.name}" y estamos trabajando ahí. Lo que crees ahora queda en este proyecto.`, meta: { estado: 'verificado' } };
    }
    case 'proyecto_cambiar': {
      const p = st.proyectos.find((x) => normalizar(x.name) === normalizar(acc.nombre)) || st.proyectos.find((x) => normalizar(x.name).includes(normalizar(acc.nombre)));
      if (!p) return { texto: `No tenés un proyecto "${acc.nombre}". Tus proyectos: ${st.proyectos.map((x) => x.name).join(', ')}.` };
      await cambiarProyecto(p.id);
      return { texto: `Ahora estamos en el proyecto "${p.name}".`, meta: { estado: 'ejecutado' } };
    }
    case 'persistir': {
      const a = artefacto(acc.artefactoId);
      if (!a.configuration?.historical) await q(sb.from('so_artifacts').update({ configuration: { ...a.configuration, historical: true } }).eq('id', a.id));
      return { texto: `"${a.name}" guarda cada dato con su fecha: el historial queda disponible para ver la evolución y comparar períodos.`, meta: { estado: 'verificado', porque: 'Los datos viven en Supabase, separados del tablero: aunque borres la visualización, el historial no se pierde.' } };
    }
    case 'listar': {
      const ps = st.artefactos.filter((a) => a.state === 'published');
      return { texto: ps.length ? `Tenés ${ps.length} en "${proyecto()?.name}":\n${ps.slice(0, 20).map((a) => `• ${a.name} (v${a.version})`).join('\n')}${ps.length > 20 ? '\n…y más: buscalos con ⌘K.' : ''}` : 'Todavía no tenés tableros en este proyecto. ¿Armamos uno?' };
    }
    case 'decision': {
      await q(sb.from('so_decisions').insert({ project_id: s.proyectoId ?? null, chat_id: st.chatId, decision: acc.texto }));
      if (acc.preferencia) senal('FranciscoIntent', 'preference', { value: acc.texto.slice(0, 300) });
      return { texto: 'Anotado. Lo tengo en cuenta de ahora en más.', meta: { estado: 'verificado' } };
    }
    case 'bloqueado': return { texto: 'En modo Personal solo charlamos; los tableros y herramientas se crean en modo Trabajo.' };
    case 'falta_email': actividad('esperando'); return { texto: '¿Con qué correo lo comparto?' };
    case 'falta_artefacto': actividad('esperando'); return { texto: st.artefactos.length ? `¿Sobre cuál? ${recientes(5).map(({ a }) => `"${a.name}"`).join(', ')}.` : 'Todavía no hay tableros. ¿Querés que cree uno? Ej: "Creá un dashboard de ventas con histórico".' };
    case 'sin_datos': return { texto: 'Todavía no tenés datos para analizar. Puedo crear un tablero con historial: "Creá un dashboard de ventas con histórico".' };
    default: actividad('entendiendo'); return conversar();
  }
}

async function crearArtefacto(spec) {
  const p = proyecto();
  if (!p) throw new Error('no hay proyecto de trabajo');
  const id = crypto.randomUUID();
  const grafico = spec.grafico || st.preferencias.grafico || 'line';
  const ds = await q(sb.from('so_datasources').insert({ project_id: p.id, name: spec.name, fields: spec.campos }).select('id').single());
  await q(sb.from('so_artifacts').insert({
    id, project_id: p.id, name: spec.name, type: spec.type, route: `#/a/${id}`, datasource_id: ds.id,
    menu: { icon: 'chart' }, specification: { tema: spec.tema, origen: 'FranciscoIntent' }, schema: { fields: spec.campos },
    permissions: { default: 'owner' }, sharing: { default: 'USE' },
    configuration: { grafico, metrica: spec.campos.find((c) => c.type === 'number')?.key ?? null, historical: spec.persistentStorage },
    state: 'published', deployment_state: 'available',
  }));
  await q(sb.from('so_menu').insert({ artifact_id: id, name: spec.name, route: `#/a/${id}`, ord: st.artefactos.length }));
  actividad('verificando');
  const [art, menu] = await Promise.all([q(sb.from('so_artifacts').select('id, state').eq('id', id)), q(sb.from('so_menu').select('artifact_id').eq('artifact_id', id))]);
  const verificado = art.length === 1 && art[0].state === 'published' && menu.length === 1;
  sb.from('so_decisions').insert({ project_id: p.id, chat_id: st.chatId, artifact_id: id,
    decision: `Se creó "${spec.name}" con campos ${spec.campos.map((c) => c.label).join(', ')}${spec.persistentStorage ? ' y almacenamiento histórico' : ''}.` }).then(() => {}, () => {});
  senal('FranciscoArtifact', 'success', { op: 'create', type: spec.type }, id);
  if (!st.artefactos.length && st.firstSeen) evento('time_to_first_value', Date.now() - Date.parse(st.firstSeen));
  E.set({ artefactoId: id });
  await cargarArtefactos();
  await actualizarPreview(id).catch(() => {});   // la Living Card nace con su estado real (sin datos todavía)
  const porque = `${spec.camposExplicitos ? 'Usé los campos que pediste' : `Elegí ${spec.campos.map((c) => c.label).join(', ')} porque es lo habitual para ${spec.tema}`}` +
    `${spec.grafico ? '' : st.preferencias.grafico ? `; gráfico de ${{ bar: 'barras', line: 'líneas', pie: 'torta' }[grafico]} porque es el que solés elegir` : ''}. Podés pedir "agregale…" o cambiarlo cuando quieras.`;
  return {
    texto: `Creé "${spec.name}"${spec.persistentStorage ? ' con historial guardado para comparar períodos' : ''}. Ya está en tu menú.`,
    meta: { estado: verificado ? 'verificado' : 'ejecutado', artifactId: id, tarjeta: true, porque, undo: { tipo: 'crear', artifactId: id } },
    skills: ['FranciscoIntent', 'FranciscoArtifact', 'FranciscoData'], capacidades: ['supabase'],
  };
}

async function actualizarArtefacto(id, cambio, texto, extraUndo = {}, cambios = null) {
  const a = artefacto(id);
  await q(sb.from('so_artifacts').update(cambio(a)).eq('id', id));
  actividad('verificando');
  const v = await q(sb.from('so_artifacts').select('version').eq('id', id).single());
  E.set({ artefactoId: id });
  await cargarArtefactos();
  if (E.get().vista === 'artefacto') abrirArtefacto(id);
  senal('FranciscoArtifact', 'success', { op: 'update' }, id);
  invalidarPreview(id);
  return { texto: `${texto} (versión ${v.version}).`, meta: { estado: v.version > a.version ? 'verificado' : 'ejecutado', artifactId: id, tarjeta: E.get().vista !== 'artefacto' && !cambios, ...(cambios ? { cambios } : {}),
    undo: { tipo: 'version', artifactId: id, version: a.version, ...extraUndo } }, skills: ['FranciscoIntent', 'FranciscoArtifact'] };
}

async function agregarCampos(acc) {
  const a = artefacto(acc.artefactoId);
  const ds = await q(sb.from('so_datasources').select('fields').eq('id', a.datasource_id).single());
  const nuevos = acc.campos.filter((c) => !ds.fields.some((f) => f.key === c.key));
  if (!nuevos.length) return { texto: `"${a.name}" ya tiene esos campos.` };
  const fields = [...ds.fields, ...nuevos];
  await q(sb.from('so_datasources').update({ fields, updated_at: new Date().toISOString() }).eq('id', a.datasource_id));
  st.datos.delete(a.id);
  return actualizarArtefacto(a.id, () => ({ schema: { ...a.schema, fields } }), `Agregué ${nuevos.map((c) => `"${c.label}"`).join(', ')} a "${a.name}"`,
    { datasourceId: a.datasource_id, fields: ds.fields }, nuevos.map((c) => `+ campo ${c.label}`));
}

// ---------------------------------------------------------------- deshacer
async function deshacerMensaje(id, { silencioso = false } = {}) {
  const m = st.mensajes.find((x) => x.id === id);
  const u = m?.meta?.undo;
  if (!u || m.meta.deshecho) return;
  actividad('actualizando');
  try {
    switch (u.tipo) {
      case 'version':
        await q(sb.rpc('so_restaurar_version', { p_artifact: u.artifactId, p_version: u.version }));
        if (u.datasourceId) await q(sb.from('so_datasources').update({ fields: u.fields }).eq('id', u.datasourceId));
        break;
      case 'crear':
        await q(sb.from('so_artifacts').update({ state: 'deleted', deleted_at: new Date().toISOString() }).eq('id', u.artifactId));
        await sb.from('so_menu').update({ status: 'removed' }).eq('artifact_id', u.artifactId);
        if (location.hash === `#/a/${u.artifactId}`) location.hash = '#/';
        break;
      case 'restaurar':
        await q(sb.from('so_artifacts').update({ state: 'published', deleted_at: null }).eq('id', u.artifactId));
        await sb.from('so_menu').update({ status: 'available' }).eq('artifact_id', u.artifactId);
        break;
      case 'registro': await q(sb.from('so_records').delete().eq('id', u.recordId)); break;
      case 'compartir':
        if (u.previo) await q(sb.rpc('so_compartir', { p_artifact: u.artifactId, p_email: u.email, p_permission: u.previo }));
        else await q(sb.rpc('so_revocar', { p_share: u.shareId }));
        break;
      case 'revocar': for (const x of u.shares) await q(sb.rpc('so_compartir', { p_artifact: u.artifactId, p_email: x.email, p_permission: x.permission })); break;
      case 'favorito': await q(sb.from('so_menu').update({ favorite: u.valor }).eq('artifact_id', u.artifactId)); break;
      case 'automatizacion': await q(sb.from('so_automations').delete().eq('id', u.id)); break;
      case 'exportacion': {
        const a = artefacto(u.artifactId);
        const [act] = await q(sb.from('so_artifacts').update({ configuration: { ...a.configuration, exportacion: u.anterior } }).eq('id', u.artifactId).select('id, configuration, version'));
        if (act) Object.assign(a, { configuration: act.configuration, version: act.version });
        break;
      }
      case 'coleccion': await A.deshacerColeccion(u); D.olvidar(u.ids); st.archivosRecientes = null; st.colecciones = null; break;
      case 'importacion': await q(sb.rpc('so_deshacer_importacion', { p_batch: u.loteId })); break;
      case 'dataset': {
        const a = artefacto(u.artifactId);
        const { data: ds } = await sb.from('so_datasources').select('fields').eq('id', u.anterior).single();
        await q(sb.from('so_artifacts').update({ datasource_id: u.anterior, schema: { fields: ds.fields }, configuration: { ...a.configuration, metrica: ds.fields.find((f) => f.type === 'number')?.key ?? null } }).eq('id', u.artifactId));
        break;
      }
    }
    if (u.artifactId) st.datos.delete(u.artifactId);
    await actualizarMeta(id, { deshecho: true });
    evento('undo', null, { tipo: u.tipo });
    await cargarArtefactos();
    if (E.get().vista === 'artefacto' && E.get().artefactoId) abrirArtefacto(E.get().artefactoId, { forzar: true });
    else if (E.get().vista === 'home') pintarHome();
    actividad('listo');
  } catch (err) {
    actividad('atencion');
    if (!silencioso) await guardarMensaje('assistant', `No pude deshacer: ${err.message}.`, { estado: 'fallo' });
    else throw err;
  }
}

async function conversar({ archivos = null, silencioso = false } = {}) {
  const { data, error } = await sb.functions.invoke('francisco', { body: { chatId: st.chatId, ...(archivos ? { archivos } : {}) } });
  if (!error) return { texto: data.reply, modelo: data.model, tokens: data.tokens, skills: ['FranciscoContext'], capacidades: ['llm'] };
  const status = error.context?.status;
  if (silencioso) return { ok: false, sinModelo: status === 503 || status === 404 || !status };
  if (status === 503 || status === 404 || /Failed to send|FunctionsFetchError|not found/i.test(error.message || '')) {
    return { texto: E.get().modo === 'work'
      ? 'Para conversar libremente todavía no tengo conectado el modelo de lenguaje. Lo que sí puedo hacer ya: crear tableros, analizarlos, comparar períodos, filtrar, cargar e importar datos, compartir y deshacer cambios.'
      : 'Todavía no tengo conectado el modelo de lenguaje, así que por ahora no puedo charlar libremente.', meta: {} };
  }
  if (status === 429) return { ok: false, texto: 'Estoy con mucha demanda.', meta: { estado: 'fallo', reintentar: st.mensajes.at(-1)?.content } };
  return { ok: false, texto: 'No pude responder ahora (error del servicio).', meta: { estado: 'fallo', reintentar: st.mensajes.at(-1)?.content } };
}

// ---------------------------------------------------------------- Focused Artifact
let renderToken = 0;
const esqueleto = () => `<div class="esqueleto" aria-busy="true" aria-label="Cargando"><div class="sk sk-linea"></div><div class="sk-fila">${'<div class="sk sk-kpi"></div>'.repeat(4)}</div><div class="sk sk-graf"></div><div class="sk sk-tabla"></div></div>`;

async function abrirArtefacto(id, { forzar = false } = {}) {
  const token = ++renderToken;
  vista('artefacto');
  if (E.get().artefactoId !== id) E.set({ artefactoId: id });
  const a0 = artefacto(id);
  $('titulo').textContent = a0?.name || 'Tablero';
  $('tituloIcono').innerHTML = a0 ? icono(presentacion(a0).icon) : '';
  $('errorArtefacto').innerHTML = '';
  pintarCabecera();
  if (!st.datos.has(id) && !$('artefacto').querySelector(`[data-art-id="${id}"]`)) $('artefacto').innerHTML = esqueleto();
  if (!forzar && st.menu.get(id) && !st.abiertos?.has(id)) {
    (st.abiertos ||= new Set()).add(id);
    sb.rpc('so_abrir_artefacto', { p_artifact: id }).then(() => {}, () => {});
    const m = st.menu.get(id);
    // Historial de aperturas (en este dispositivo): "el que usamos ayer" sigue resolviendo aunque hoy se haya abierto otra vez.
    const hist = (ls.get('so.aperturas') || []).filter((x) => x.at > new Date(Date.now() - 30 * 864e5).toISOString());
    if (m.last_opened_at) hist.push({ id, at: m.last_opened_at });
    m.last_opened_at = new Date().toISOString();
    hist.push({ id, at: m.last_opened_at });
    ls.set('so.aperturas', hist.slice(-300));
    if ((m.open_count || 0) > 0) evento('artifact_reuse');
    m.open_count = (m.open_count || 0) + 1;
  }
  if (a0?.configuration?.surface && !a0.datasource_id) return renderSuperficie(a0, null);
  let d;
  try {
    d = await datosDe(id, { forzar });
  } catch (err) {
    if (token !== renderToken) return;
    const cache = ls.get(`so.datos.${id}`);
    $('artefacto').innerHTML = '';
    $('errorArtefacto').innerHTML = `<div class="tarjeta alerta" role="alert"><p><strong>No pude actualizar ${esc(a0?.name || 'este tablero')}</strong>. ${cache ? 'Podés seguir con los últimos datos guardados en este dispositivo.' : 'Probá de nuevo en un momento.'}</p>
      <p class="vacio">Detalle: ${esc(err.message)}.</p>
      <button type="button" class="primario" data-r="reintentar">Reintentar</button>${cache ? ' <button type="button" data-r="cache">Seguir usando los últimos datos</button>' : ''}</div>`;
    $('errorArtefacto').querySelector('[data-r="reintentar"]').onclick = async () => { evento('retry'); await abrirArtefacto(id, { forzar: true }); if (!$('errorArtefacto').innerHTML) evento('recovery_success'); };
    $('errorArtefacto').querySelector('[data-r="cache"]')?.addEventListener('click', () => {
      $('errorArtefacto').innerHTML = '';
      pintarArtefacto(a0, { ...cache, cache: true });
      evento('recovery_success', null, { via: 'cache' });
    });
    return;
  }
  if (token !== renderToken) return;
  if (!d.a || d.a.deleted_at) { $('artefacto').innerHTML = '<p class="vacio">Ese tablero no existe o fue eliminado.</p>'; return; }
  if (d.a.configuration?.surface) renderSuperficie(d.a, d);
  else pintarArtefacto(d.a, d);
  actualizarPreview(id, d).catch(() => {});   // la tarjeta del Workspace queda al día sin otra consulta
  pintarCompartidos(d.a);
  pintarVersiones(d.a);
  D.pintarPanel(d.a.id);
  if (!forzar) D.refrescarAlAbrir(d.a.id);
}

function pintarArtefacto(a, d) {
  $('titulo').textContent = a.name;
  $('meta').textContent = '';
  renderArtefacto($('artefacto'), { ...a, fields: d.fields, records: d.records, permission: 'OWNER' }, {
    estado: E.get(), hoy: hoy(),
    onEstado: (c) => E.set(c),   // el render lo hace la suscripción al estado (misma vía que Francisco)
    onSeleccion: (sel) => {
      const actual = E.get().seleccion;
      E.set({ seleccion: !sel || (actual && actual.tipo === sel.tipo && actual.id === sel.id && actual.recordId === sel.recordId && actual.mes === sel.mes) ? null : sel });
    },
    onAccion: (accion, sel) => {
      if (accion === 'explicar') return pedirAFrancisco('¿Por qué cambió esto?');
      if (accion === 'comparar') return pedirAFrancisco('Comparalo con el mes anterior');
      if (accion === 'preguntar') { abrirPanel(); $('texto').placeholder = `Preguntá sobre ${sel?.etiqueta || a.name}…`; }
    },
    onAdd: async (period, data) => {
      await q(sb.from('so_records').insert({ datasource_id: a.datasource_id, owner_id: st.user.id, period, data, idempotency_key: crypto.randomUUID() }));
      senal('FranciscoData', 'success', { op: 'record', via: 'form' }, a.id);
      invalidarPreview(a.id);
      await abrirArtefacto(a.id, { forzar: true });
    },
    onImportar: (file) => D.abrirImportacion(file, a.id),
    frescura: { cargado: d.cargado, ultimo: d.ultimo, cache: d.cache },
    onActualizar: () => abrirArtefacto(a.id, { forzar: true }),
  });
  $('artefacto').firstElementChild?.setAttribute('data-art-id', a.id);
}

// Superficie generada por Francisco y fijada en el Workspace: se recalcula con los datos actuales de su fuente.
async function renderSuperficie(a, d) {
  const sup = a.configuration.surface || {};
  let ui = sup.ui || [], nota = 'Instantánea guardada al fijarla.';
  const f = sup.fuente;
  try {
    if (f?.op === 'comparar' && f.artifactId) {
      const fuente = await datosDe(f.artifactId);
      const num = fuente.fields.find((x) => x.key === f.campo) || fuente.fields.find((x) => x.type === 'number');
      const cat = categoriaUtil(fuente.fields, fuente.records);
      const recs = f.filtro ? fuente.records.filter((r) => String(r.data?.[f.filtro.key] ?? '').toLowerCase() === String(f.filtro.valor).toLowerCase()) : fuente.records;
      const c = (await import('./analisis.js')).comparar(recs, num, f.mesA, f.mesB, cat, hoy());
      ui = specsComparacion(c, num, cat);
      nota = `Calculado ahora con "${fuente.a.name}"${f.filtro ? ` (solo ${f.filtro.valor})` : ''} · ${c.evidencia.registros} registros.`;
    }
  } catch { nota = 'No pude recalcular con los datos actuales: muestro la instantánea guardada.'; }
  $('artefacto').innerHTML = `<div class="superficie" data-art-id="${esc(a.id)}">${renderUI(ui) || '<p class="vacio">Esta superficie no tiene contenido.</p>'}<p class="vacio">${esc(nota)}</p></div>`;
}

// Cabecera del artefacto: ← Trabajo · Nombre · ☆ · Compartir · ••• (y Modo foco). Nada de IA duplicada.
function pintarCabecera() {
  const s = E.get();
  const a = s.vista === 'artefacto' && artefacto(s.artefactoId);
  if (!a) { $('accionesCab').innerHTML = ''; return; }
  const fav = !!st.menu.get(a.id)?.favorite;
  $('accionesCab').innerHTML = `
    <button type="button" class="ib" data-aa="favorito" aria-pressed="${fav}" aria-label="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" title="Favorito">${icono('estrella', { relleno: fav })}</button>
    <button type="button" class="btn-sec" data-aa="compartir">${icono('compartir', { tam: 16 })}<span>Compartir</span></button>
    <button type="button" class="ib" data-aa="foco" aria-pressed="${!!st.foco}" aria-label="${st.foco ? 'Salir del modo foco' : 'Modo foco'}" title="${st.foco ? 'Salir del modo foco (Esc)' : 'Modo foco'}">${icono('foco')}</button>
    <button type="button" class="ib" data-aa="mas" aria-haspopup="menu" aria-expanded="false" aria-label="Más acciones de ${esc(a.name)}" title="Más acciones">${icono('mas')}</button>`;
  const on = (k, f) => $('accionesCab').querySelector(`[data-aa="${k}"]`)?.addEventListener('click', f);
  on('favorito', () => procesarAccion({ tipo: 'favorito', artefactoId: a.id, valor: !fav }));
  on('compartir', () => abrirHoja('compartir'));
  on('foco', () => (st.foco ? salirFoco() : entrarFoco()));
  on('mas', (e) => {
    const g = a.configuration?.grafico || 'line';
    const items = [{ id: 'editar', texto: 'Editar con Francisco' }, { id: 'datos', texto: 'Datos y fuentes' },
      ...['line', 'bar', 'pie'].filter((x) => x !== g).map((x) => ({ id: `graf-${x}`, texto: `Ver gráfico de ${{ line: 'líneas', bar: 'barras', pie: 'torta' }[x]}` })),
      { id: 'exp-pdf', texto: 'Exportar a PDF' }, { id: 'exp-xlsx', texto: 'Exportar a Excel' }, { id: 'exp-csv', texto: 'Exportar a CSV' }, { id: 'exp-png', texto: 'Exportar como imagen (PNG)' }, { id: 'exp-config', texto: 'Exportación…' },
      { id: 'versiones', texto: 'Versiones' }, { id: 'duplicar', texto: 'Duplicar' }, { id: 'archivar', texto: 'Archivar' }];
    abrirMenuFlotante(e.currentTarget, items, async (x) => {
      if (x === 'editar') return editarConFrancisco(a.id);
      if (x === 'datos' || x === 'versiones') return abrirHoja(x);
      if (x.startsWith('graf-')) return procesarAccion({ tipo: 'grafico', artefactoId: a.id, grafico: x.slice(5) });
      if (x === 'exp-config') return configurarExportacion(a);
      if (x.startsWith('exp-')) return exportarDesdeUI(a, x.slice(4));
      if (x === 'duplicar' || x === 'archivar') { await accionTarjeta(x, a.id); if (x === 'archivar') location.hash = '#/'; }
    });
  });
}

async function exportarDesdeUI(a, formato) {
  toast(`Generando ${FORMATOS[formato].etiqueta} de ${a.name}…`);
  actividad('creando');
  const r = await A.exportarArtefacto(a, formato).catch((err) => ({ ok: false, texto: `No pude generar el archivo: ${err.message}.`, meta: { estado: 'fallo' } }));
  if (!st.chatId) await asegurarChat(`Exportar ${a.name}`);
  await guardarMensaje('assistant', r.texto, r.meta || {});
  if (r.meta?.archivo) { st.archivoFoco = r.meta.archivo; st.archivosRecientes = null; }
  actividad(r.ok === false ? 'atencion' : 'listo');
  abrirPanel({ foco: false });
}

// Hoja lateral (compartir · datos y fuentes · versiones): aparece solo cuando se pide.
// Exportación ≠ visualización: el tablero puede verse resumido y exportarse con el detalle completo (o al revés).
// Se guarda en configuration.exportacion y la usan el menú, Francisco, las plantillas y las automatizaciones.
function configurarExportacion(a) {
  const ex = exportacionDe(a);
  const campos = st.datos.get(a.id)?.fields || a.schema?.fields || [];
  const f = $('formExportar');
  const chk = (name, val, txt, on) => `<label class="exp-op"><input type="checkbox" name="${name}" value="${esc(val)}"${on ? ' checked' : ''}> ${esc(txt)}</label>`;
  f.innerHTML = `<p class="vacio">Cómo se exporta "${esc(a.name)}". No cambia cómo se ve el tablero.</p>
    <fieldset><legend>Datos</legend>
      <label class="exp-op"><input type="radio" name="datos" value="vista"${ex.datos === 'vista' ? ' checked' : ''}> Lo que estoy viendo (con filtros y período)</label>
      <label class="exp-op"><input type="radio" name="datos" value="todo"${ex.datos === 'todo' ? ' checked' : ''}> Todos los datos guardados (historial completo)</label></fieldset>
    <fieldset><legend>Secciones</legend>${chk('sec', 'resumen', 'Resumen e insights', ex.secciones.resumen)}${chk('sec', 'mensual', 'Totales por mes', ex.secciones.mensual)}${chk('sec', 'detalle', 'Detalle registro por registro', ex.secciones.detalle)}</fieldset>
    <fieldset><legend>Columnas del detalle</legend><label class="exp-op"><input type="checkbox" checked disabled> Fecha</label>${campos.map((c) => chk('col', c.key, c.label || c.key, !ex.columnas || ex.columnas.includes(c.key))).join('')}</fieldset>
    <fieldset><legend>Aperturas al exportar</legend>${ex.aperturas.length ? ex.aperturas.map((x, i) => `<label class="exp-op"><input type="checkbox" name="ap" value="${i}" checked> ${esc(nombreApertura(x, campos))}</label>`).join('')
      : '<p class="vacio">Ninguna. Pedíselas a Francisco: "cuando exporte, abrilo por canal y mes" o "agregá la apertura por día".</p>'}</fieldset>
    <p class="error" id="errorExportar" hidden></p>
    <div class="msg-acc"><button class="primario" type="submit">Guardar</button><button type="button" data-exp-defecto>Volver a lo predeterminado</button></div>`;
  const guardar = async (exportacion) => {
    try {
      const [act] = await q(sb.from('so_artifacts').update({ configuration: { ...a.configuration, exportacion } }).eq('id', a.id).select('id, configuration, version'));
      if (!act) throw new Error('no se guardó');
      Object.assign(a, { configuration: act.configuration, version: act.version });
      $('hoja').close();
      toast(exportacion ? 'Guardé cómo se exporta este tablero.' : 'La exportación volvió a lo predeterminado.');
    } catch (err) { $('errorExportar').textContent = `No pude guardar: ${err.message}.`; $('errorExportar').hidden = false; }
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const sec = fd.getAll('sec');
    if (!sec.includes('mensual') && !sec.includes('detalle')) { $('errorExportar').textContent = 'Elegí al menos "Totales por mes" o "Detalle": Excel y CSV necesitan una tabla.'; $('errorExportar').hidden = false; return; }
    const cols = fd.getAll('col');
    if (sec.includes('detalle') && campos.length && !cols.length) { $('errorExportar').textContent = 'Elegí al menos una columna para el detalle.'; $('errorExportar').hidden = false; return; }
    guardar({ datos: fd.get('datos') || 'vista', secciones: { resumen: sec.includes('resumen'), mensual: sec.includes('mensual'), detalle: sec.includes('detalle') },
      columnas: cols.length === campos.length ? null : cols, aperturas: fd.getAll('ap').map((i) => ex.aperturas[Number(i)]).filter(Boolean) });
  };
  f.querySelector('[data-exp-defecto]').onclick = () => guardar(null);
  abrirHoja('exportar');
}

function abrirHoja(tipo) {
  const h = $('hoja');
  h.querySelectorAll('[data-hoja]').forEach((n) => { n.hidden = n.dataset.hoja !== tipo; });
  $('hojaTitulo').textContent = { compartir: 'Compartir', datos: 'Datos y fuentes', versiones: 'Versiones', exportar: 'Exportación' }[tipo];
  if (!h.open) h.showModal();
  if (tipo === 'compartir') $('formCompartir').email.focus();
  else h.querySelector(`[data-hoja="${tipo}"] button, [data-hoja="${tipo}"] input, [data-hoja="${tipo}"] select`)?.focus();
}
$('cerrarHoja').onclick = () => $('hoja').close();

// Manipulación directa con el mismo camino que la conversación (mismo estado, mismas verificaciones y Deshacer).
async function procesarAccion(acc) {
  if (st.ocupado) return;
  st.ocupado = true;
  try {
    const r = await ejecutar(acc);
    if (st.chatId) await guardarMensaje('assistant', r.texto, r.meta || {});
    actividad(r.ok === false ? 'atencion' : 'listo');
  } catch (err) {
    actividad('atencion');
    notificar('action', `No pude completar la acción: ${err.message}`);
  } finally { st.ocupado = false; if (E.get().vista === 'artefacto') pintarCabecera(); if (E.get().vista === 'home') pintarWorkspace(); }
}

async function pintarCompartidos(a) {
  let ss = [];
  try { ss = await q(sb.from('so_shares').select('id, grantee_email, permission, created_at').eq('artifact_id', a.id).is('revoked_at', null).order('created_at')); } catch { /* panel informativo */ }
  $('linkCompartido').innerHTML = `Link para quienes lo reciban: <a href="${esc(BASE_SHARED + a.id)}">${esc(BASE_SHARED + a.id)}</a>`;
  $('listaCompartidos').innerHTML = ss.map((s) => `<li data-share="${s.id}"><span>${esc(explicarPermiso(s.grantee_email, s.permission))}</span>
    <span class="fila-acc"><select aria-label="Permiso de ${esc(s.grantee_email)}" data-perm>${['VIEW', 'USE', 'EDIT'].map((p) =>
      `<option value="${p}" ${p === s.permission ? 'selected' : ''}>${{ VIEW: 'Solo ver', USE: 'Usar', EDIT: 'Modificar' }[p]}</option>`).join('')}</select>
    <button type="button" data-revocar>Quitar acceso</button></span><span class="preview-inline" hidden></span></li>`).join('') || '<li class="vacio">No está compartido con nadie.</li>';
  $('listaCompartidos').querySelectorAll('[data-share]').forEach((li) => {
    const s = ss.find((x) => x.id === li.dataset.share);
    li.querySelector('[data-revocar]').onclick = async () => { await procesarAccion({ tipo: 'revocar', artefactoId: a.id, email: s.grantee_email }); pintarCompartidos(a); };
    li.querySelector('[data-perm]').onchange = async (e) => {
      const nuevo = e.target.value;
      const aplicar = async () => { await procesarAccion({ tipo: 'compartir', artefactoId: a.id, email: s.grantee_email, permiso: nuevo }); pintarCompartidos(a); };
      if (nuevo !== 'EDIT') return aplicar();
      const p = li.querySelector('.preview-inline');   // alto impacto: vista previa breve en el lugar
      p.hidden = false;
      p.innerHTML = `${esc(explicarPermiso(s.grantee_email, 'EDIT'))} <button type="button" class="peligro">Confirmar</button> <button type="button">Cancelar</button>`;
      const [ok, no] = p.querySelectorAll('button');
      ok.onclick = () => { evento('preview_confirmed', null, { tipo: 'compartir' }); aplicar(); };
      no.onclick = () => { evento('preview_cancelled', null, { tipo: 'compartir' }); pintarCompartidos(a); };
    };
  });
  $('formCompartir').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const acc = { tipo: 'compartir', artefactoId: a.id, email: String(fd.get('email')).trim().toLowerCase(), permiso: String(fd.get('permiso')) };
    if (acc.permiso === 'EDIT' && !confirm(`${explicarPermiso(acc.email, 'EDIT', `"${a.name}"`)}\n¿Confirmás?`)) { evento('preview_cancelled', null, { tipo: 'compartir' }); return; }
    await procesarAccion(acc);
    e.target.reset();
    pintarCompartidos(a);
  };
}

async function pintarVersiones(a) {
  let vs = [];
  try { vs = await q(sb.from('so_artifact_versions').select('version, created_at').eq('artifact_id', a.id).order('version', { ascending: false }).limit(20)); } catch {}
  $('listaVersiones').innerHTML = vs.map((v) => `<li><span>v${v.version} · ${esc(new Date(v.created_at).toLocaleString('es-AR'))}</span>
    ${v.version === a.version ? '<span class="etiqueta">actual</span>' : `<button type="button" data-v="${v.version}">Restaurar</button>`}</li>`).join('');
  $('listaVersiones').querySelectorAll('[data-v]').forEach((b) => {
    b.onclick = async () => {
      try { await q(sb.rpc('so_restaurar_version', { p_artifact: a.id, p_version: Number(b.dataset.v) })); evento('undo', null, { tipo: 'version' }); }
      catch (e) { notificar('action', `No pude restaurar la versión: ${e.message}`); }
      await cargarArtefactos(); abrirArtefacto(a.id, { forzar: true });
    };
  });
}

// ---------------------------------------------------------------- centro de actividad y avisos (fuera del chat)
async function notificar(priority, title, body = null, extra = {}) {
  try { await sb.from('so_notifications').insert({ priority, title: title.slice(0, 200), body, ...extra }); } catch {}
  await cargarCentro();
}

async function cargarCentro() {
  try {
    const [tareas, avisos] = await Promise.all([
      q(sb.from('so_tasks').select('id, kind, name, status, progress, result, error, needs_action, artifact_id, updated_at, checkpoint, input').order('updated_at', { ascending: false }).limit(30)),
      q(sb.from('so_notifications').select('id, priority, title, body, group_key, artifact_id, read_at, created_at').order('created_at', { ascending: false }).limit(60)),
    ]);
    // Tareas que quedaron "en curso" sin el archivo en memoria (se cerró la página): necesitan atención, no se fingen activas.
    const huerfanas = tareas.filter((t) => t.status === 'running' && !st.tareasVivas?.has(t.id) && Date.now() - Date.parse(t.updated_at) > 120000);
    for (const t of huerfanas) {
      t.status = 'waiting'; t.needs_action = 'Se interrumpió: podés reanudar (el archivo ya está guardado y no se duplican filas)';
      sb.from('so_tasks').update({ status: 'waiting', needs_action: t.needs_action }).eq('id', t.id).then(() => {}, () => {});
    }
    st.tareas = tareas; st.avisos = avisos;
  } catch { /* el centro es informativo: si falla, no bloquea */ }
  const pendientes = st.avisos.filter((n) => !n.read_at && ['critical', 'action'].includes(n.priority)).length + st.tareas.filter((t) => ['failed', 'waiting'].includes(t.status)).length;
  // Número solo para lo que pide acción; un punto discreto para tareas en curso o novedades sin leer (sin fatiga).
  const enCurso = st.tareas.some((t) => t.status === 'running' || t.status === 'queued');
  const novedades = st.avisos.some((n) => !n.read_at);
  $('badgeCentro').hidden = !pendientes && !enCurso && !novedades;
  $('badgeCentro').textContent = pendientes ? String(pendientes) : '';
  $('badgeCentro').classList.toggle('activo', !pendientes && (enCurso || novedades));
  pintarCentroSiAbierto();
  if (E.get().vista === 'home') pintarHome();
}

function pintarCentroSiAbierto() { if ($('centro').open) pintarCentro(); }

function abrirCentro(tab = st.tabCentro) {
  st.tabCentro = tab;
  if (!$('centro').open) $('centro').showModal();
  pintarCentro();
}
$('btnCentro').onclick = () => abrirCentro();
$('cerrarCentro').onclick = () => $('centro').close();
$('centro').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => abrirCentro(b.dataset.tab)));

function pintarCentro() {
  $('centro').querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tabCentro)));
  const c = $('centroCuerpo');
  if (st.tabCentro === 'tareas') {
    const grupos = [
      ['En curso', st.tareas.filter((t) => ['running', 'queued'].includes(t.status))],
      ['Necesitan atención', st.tareas.filter((t) => ['failed', 'waiting'].includes(t.status))],
      ['Finalizadas', st.tareas.filter((t) => ['completed', 'cancelled'].includes(t.status)).slice(0, 10)],
    ];
    c.innerHTML = grupos.map(([titulo, ts]) => `<section><h3>${titulo}</h3>${ts.length ? `<ul class="lista">${ts.map((t) => {
      const art = artefacto(t.artifact_id);
      const prog = t.status === 'running' && t.progress != null ? `<progress max="1" value="${t.progress}" aria-label="Progreso">${Math.round(t.progress * 100)}%</progress> ${Math.round(t.progress * 100)}%` : '';
      const res = t.status === 'completed' && t.result ? `${t.result.importadas} filas importadas${t.result.omitidas?.length ? ` · ${t.result.omitidas.length}+ a revisar` : ''}` : '';
      const det = t.result?.omitidas?.length ? `<details><summary>Ver filas a revisar</summary><ul>${t.result.omitidas.map((o) => `<li>Fila ${o.fila ?? o.linea}: ${esc(o.motivo)}</li>`).join('')}</ul></details>` : '';
      const accion = ['failed', 'waiting'].includes(t.status) && t.kind === 'import' && t.input?.fileId ? `<button type="button" data-reanudar="${t.id}">Reanudar</button>` : '';
      return `<li class="tarea"><div><strong>${esc(t.name || t.kind)}</strong>${art ? ` · <a href="#/a/${art.id}">${esc(art.name)}</a>` : ''}
        <div class="vacio">${esc({ running: 'En curso', queued: 'En cola', waiting: 'Esperando', failed: 'Falló', completed: 'Terminada', cancelled: 'Cancelada' }[t.status])} · ${esc(haceCuanto(t.updated_at))}
        ${t.error ? ` · ${esc(t.error)}` : ''}${t.needs_action && t.status !== 'failed' ? ` · ${esc(t.needs_action)}` : ''}</div>${prog}${res ? `<div>${esc(res)}</div>` : ''}${det}</div>${accion}</li>`;
    }).join('')}</ul>` : '<p class="vacio">Nada por acá.</p>'}</section>`).join('');
    c.querySelectorAll('[data-reanudar]').forEach((b) => b.addEventListener('click', () => {
      b.disabled = true; D.reanudar(st.tareas.find((x) => x.id === b.dataset.reanudar)).finally(cargarCentro);
    }));
  } else {
    // Agrupar avisos repetidos; prioridad critical > action > success > info.
    const orden = { critical: 0, action: 1, success: 2, info: 3 };
    const grupos = new Map();
    for (const n of st.avisos) {
      const k = n.group_key || `n${n.id}`;
      if (!grupos.has(k)) grupos.set(k, { ...n, cantidad: 0 });
      grupos.get(k).cantidad++;
    }
    const lista = [...grupos.values()].sort((a, b) => orden[a.priority] - orden[b.priority] || b.created_at.localeCompare(a.created_at));
    c.innerHTML = lista.length ? `<ul class="lista avisos">${lista.map((n) => `<li class="aviso ${n.priority} ${n.read_at ? '' : 'nuevo'}">
      <span>${{ critical: '⛔', action: '⚠️', success: '✅', info: 'ℹ️' }[n.priority]} <strong>${esc(n.title)}</strong>${n.cantidad > 1 ? ` <span class="etiqueta">×${n.cantidad}</span>` : ''}
      ${n.body ? `<br><small>${esc(n.body)}</small>` : ''}</span><small>${esc(haceCuanto(n.created_at))}${n.artifact_id && artefacto(n.artifact_id) ? ` · <a href="#/a/${n.artifact_id}">Abrir</a>` : ''}</small></li>`).join('')}</ul>`
      : '<p class="vacio">Sin avisos. Acá aparecen importaciones terminadas, errores de procesos y avisos operativos, para que no se mezclen con la conversación.</p>';
    const sinLeer = st.avisos.filter((n) => !n.read_at).map((n) => n.id);
    if (sinLeer.length) sb.from('so_notifications').update({ read_at: new Date().toISOString() }).in('id', sinLeer).then(() => {
      st.avisos.forEach((n) => { n.read_at ||= new Date().toISOString(); });
      const pend = st.tareas.filter((t) => ['failed', 'waiting'].includes(t.status)).length;
      $('badgeCentro').hidden = !pend; $('badgeCentro').textContent = pend ? String(pend) : '';
    }, () => {});
  }
}

// ---------------------------------------------------------------- Universal Command (barra y ⌘K): buscar, abrir o pedir
// Un solo punto de entrada. Resultados agrupados (Recientes · Tableros · Proyectos · Archivos · Acciones · Francisco);
// Enter con texto libre pasa por el CommandRouter, que delega en navegación, búsqueda, Francisco o entrada universal.
let paletaItems = [], paletaSel = 0, paletaElegido = false, tBusca = null, remotos = [];
const GRUPOS = [['reciente', 'Recientes'], ['artefacto', 'Tableros'], ['proyecto', 'Proyectos'], ['archivo', 'Archivos'], ['registro', 'Registros'], ['compartido', 'Compartidos conmigo'],
  ['chat', 'Conversaciones'], ['accion', 'Acciones'], ['pedir', 'Francisco']];
const ICON = { reciente: 'historial', artefacto: 'chart', proyecto: 'trabajo', archivo: 'archivo', registro: 'tabla', compartido: 'compartir', chat: 'conversacion', accion: 'chispa', pedir: 'chispa' };
function itemsLocales() {
  const out = [];
  for (const a of publicados()) {
    const m = st.menu.get(a.id) || {};
    out.push({ tipo: 'artefacto', titulo: a.name, extra: presentacion(a).tipo, fecha: m.last_opened_at || a.updated_at, frecuencia: m.open_count, favorito: m.favorite, run: () => { location.hash = `#/a/${a.id}`; } });
  }
  for (const p of st.proyectos) out.push({ tipo: 'proyecto', titulo: `Proyecto: ${p.name}`, fecha: p.updated_at, run: () => cambiarProyecto(p.id) });
  for (const a of st.compartidos) out.push({ tipo: 'compartido', titulo: a.name, extra: 'compartido conmigo', run: () => { location.href = BASE_SHARED + a.id; } });
  for (const c of st.chats) out.push({ tipo: 'chat', titulo: c.title, extra: 'conversación', fecha: c.updated_at, run: () => { location.hash = `#/c/${c.id}`; } });
  for (const f of st.archivosRecientes || []) out.push({ tipo: 'archivo', titulo: f.original_name, extra: `${(f.detected_type || '').toUpperCase()}${f.version > 1 ? ` · v${f.version}` : ''}`, fecha: f.created_at, run: () => { location.hash = `#/f/${f.id}`; } });
  return out;
}
function abrirPaleta(inicial = '') {
  paletaElegido = false; remotos = [];
  // Si la lista de archivos se invalidó (p. ej. al cambiar una colección), se recarga y se vuelve a filtrar lo escrito.
  if (!st.archivosRecientes) D.listaArchivos().then((fs) => { st.archivosRecientes = fs; if ($('paleta').open && $('paletaInput').value.trim()) filtrarPaleta(false); }).catch(() => {});
  $('paleta').showModal();
  $('paletaInput').value = inicial;
  filtrarPaleta();
  $('paletaInput').focus();
}
function filtrarPaleta(remoto = true) {
  const qy = $('paletaInput').value.trim();
  if (!qy) {
    // Como un chat: sin lista de acciones; solo los recientes para volver rápido. Lo escrito lo resuelve Francisco.
    paletaItems = recientesPorUso(publicados(), st.menu, 5).map((a) => ({ tipo: 'reciente', titulo: a.name, extra: haceCuanto(st.menu.get(a.id).last_opened_at), run: () => { location.hash = `#/a/${a.id}`; } }));
  } else {
    const ruta = clasificar(qy, { artefactos: publicados() });
    const locales = rankear(qy, itemsLocales()).slice(0, 12);
    const contextuales = accionesPara(qy, publicados()).map((x) => ({ tipo: 'accion', titulo: x.titulo, run: () => {
      const a = artefacto(x.artefactoId);
      if (x.accion === 'actualizar') { location.hash = `#/a/${a.id}`; setTimeout(() => abrirArtefacto(a.id, { forzar: true }), 50); }
      if (x.accion === 'exportar') exportarDesdeUI(a, x.formato);
      if (x.accion === 'compartir') { location.hash = `#/a/${a.id}`; setTimeout(() => abrirHoja('compartir'), 250); }
    } }));
    const pedir = { tipo: 'pedir', titulo: `Preguntar a Francisco: "${qy}"`, run: () => pedirAFrancisco(qy) };
    // Si el router ve un pedido (no una búsqueda), "Preguntar a Francisco" va primero.
    const primeroFrancisco = ['ASK', 'CREATE', 'EXECUTE', 'SHARE', 'CONNECT', 'UPLOAD'].includes(ruta.tipo) && !(locales[0] && normalizar(locales[0].titulo) === normalizar(qy));
    paletaItems = primeroFrancisco ? [pedir, ...locales, ...remotos, ...contextuales] : [...locales, ...remotos, ...contextuales, pedir];
  }
  paletaSel = 0;
  // Orden visual = orden de navegación: los grupos se arman respetando el orden de los ítems.
  const orden = [];
  for (const it of paletaItems) if (!orden.includes(it.tipo)) orden.push(it.tipo);
  const grupos = orden.map((t) => [t, paletaItems.map((it, i) => ({ it, i })).filter(({ it }) => it.tipo === t)]);
  paletaItems = grupos.flatMap(([, xs]) => xs.map(({ it }) => it));
  let n = 0;
  $('paletaLista').innerHTML = grupos.map(([t, xs]) => `<div role="group" aria-label="${esc(GRUPOS.find((g) => g[0] === t)?.[1] || t)}"><p class="pal-grupo">${esc(GRUPOS.find((g) => g[0] === t)?.[1] || t)}</p>${xs.map(({ it }) => {
    const i = n++;
    return `<div role="option" class="pal-item" id="op${i}" aria-selected="${i === 0}" data-i="${i}">${icono(ICON[it.tipo] || 'chispa', { tam: 16 })}<span>${esc(it.titulo)}</span>${it.extra && it.tipo !== 'accion' ? `<small>${esc(it.extra)}</small>` : ''}</div>`;
  }).join('')}</div>`).join('');
  $('paletaInput').setAttribute('aria-activedescendant', 'op0');
  $('paletaLista').querySelectorAll('[data-i]').forEach((li) => li.addEventListener('click', () => elegirPaleta(Number(li.dataset.i))));
  if (!remoto) return;
  clearTimeout(tBusca);
  if (qy.length >= 2) tBusca = setTimeout(async () => {
    try {
      const rs = await q(sb.rpc('so_buscar', { p_q: qy, p_limit: 8 }));
      if ($('paletaInput').value.trim() !== qy) return;
      remotos = [...rs.filter((r) => r.kind === 'file').map((r) => ({ tipo: 'archivo', titulo: r.title, extra: r.subtitle, run: () => { location.hash = `#/f/${r.id}`; } })),
        ...rs.filter((r) => r.kind === 'record').map((r) => ({ tipo: 'registro', titulo: r.title, extra: r.subtitle, run: () => { location.hash = `#/a/${r.artifact_id}`; } }))]
        .filter((x) => !(x.tipo === 'archivo' && (st.archivosRecientes || []).some((f) => f.original_name === x.titulo && normalizar(x.titulo).includes(normalizar(qy)))));
      if (remotos.length) filtrarPaleta(false);
    } catch { /* la búsqueda remota es complementaria */ }
  }, 250);
}
function elegirPaleta(i) {
  const it = paletaItems[i];
  if (!it) return;
  paletaElegido = true;
  if ($('paletaInput').value.trim() && it.tipo !== 'pedir') evento('search_success', null, { tipo: it.tipo });
  $('paleta').close();
  it.run();
}
$('paletaInput').addEventListener('input', () => { remotos = []; filtrarPaleta(); });
$('paletaInput').addEventListener('keydown', (e) => {
  const n = paletaItems.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    paletaSel = (paletaSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    $('paletaLista').querySelectorAll('[data-i]').forEach((li) => li.setAttribute('aria-selected', String(Number(li.dataset.i) === paletaSel)));
    $('paletaLista').querySelector(`#op${paletaSel}`)?.scrollIntoView({ block: 'nearest' });
    $('paletaInput').setAttribute('aria-activedescendant', `op${paletaSel}`);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const qy = $('paletaInput').value.trim();
    const ruta = qy ? clasificar(qy, { artefactos: publicados() }) : null;
    // CommandRouter: navegación directa, subir y conectar no necesitan pasar por la conversación.
    if (ruta?.tipo === 'NAVIGATE' && ruta.artefactoId && paletaSel === 0 && paletaItems[0]?.tipo === 'pedir') { $('paleta').close(); location.hash = `#/a/${ruta.artefactoId}`; return; }
    if (ruta?.tipo === 'UPLOAD' && paletaSel === 0) { $('paleta').close(); abrirPanel(); $('inpArchivos').click(); return; }
    elegirPaleta(paletaSel);
  } else if (e.key === 'Escape') {
    e.preventDefault(); $('paleta').close();   // un input de búsqueda se tragaría el primer Esc (lo usa para borrar)
  }
});
$('paleta').addEventListener('close', () => { if (!paletaElegido && $('paletaInput').value.trim()) evento('search_miss'); });
$('abrirPaleta').onclick = () => abrirPaleta();
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('app').hidden) { e.preventDefault(); $('paleta').open ? $('paleta').close() : abrirPaleta(); return; }
  if (e.key !== 'Escape' || $('paleta').open || $('centro').open || $('hoja').open || document.querySelector('dialog[open]') || !$('menuFlotante').hidden) return;
  if (['abierto', 'compacto'].includes(st.panel) && E.get().vista !== 'chat') { panel('cerrado'); $('orb').focus(); return; }
  if (st.foco) { salirFoco(); return; }
  const exp = $('vistaHome').querySelector('.lcard.expandida');
  if (exp) cerrarVistazo(exp.dataset.art);
});

// ---------------------------------------------------------------- usuarios que solo recibieron tableros compartidos
async function soloCompartidos() {
  document.querySelector('.modos').hidden = true; $('abrirPaleta').hidden = true; $('panelFrancisco').hidden = true; $('orb').hidden = true; $('btnCentro').hidden = true;
  $('listaChats').previousElementSibling.hidden = true; $('listaChats').hidden = true;
  $('titulo').textContent = 'Tableros compartidos conmigo';
  const compartidos = await q(sb.rpc('so_shared_list'));
  st.compartidos = compartidos;
  $('tituloCompartidos').hidden = false;
  $('menuCompartidos').innerHTML = compartidos.map((a) => `<a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a>`).join('') || '<span class="vacio">No tenés tableros compartidos.</span>';
  $('vistaHome').innerHTML = `<section class="tarjeta"><h3>Compartidos conmigo</h3><ul class="lista">${compartidos.map((a) =>
    `<li><a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a><small>${esc({ VIEW: 'podés verlo', USE: 'podés usarlo', EDIT: 'podés modificarlo' }[a.permission])}</small></li>`).join('') || '<li class="vacio">Todavía nadie te compartió un tablero.</li>'}</ul></section>`;
}
