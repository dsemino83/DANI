// SO · Francisco: workspace AI-native. Un solo estado (estado.js) lo comparten la UI y Francisco; las intenciones
// deterministas se ejecutan contra Supabase con la sesión del usuario (RLS) y se verifican releyendo antes de
// informar éxito. La conversación libre va a la Edge Function. Patrones: bajo riesgo → ejecutar; medio → ejecutar +
// Deshacer; alto → vista previa breve. Las notificaciones operativas y tareas largas viven fuera del chat.
import { interpretar, armarRegistro, normalizar } from './intent.js';
import { renderArtefacto, esc, haceCuanto } from './vista.js';
import { crearAvatar } from './avatar.js';
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
  inicio: performance.now(), tabCentro: 'tareas', preferencias: {},
};

const avatares = { marca: crearAvatar($('avatarMarca'), { modo: E.get().modo }), login: crearAvatar($('avatarLogin'), { modo: 'work' }), grande: null };
const todosAv = () => [avatares.marca, avatares.grande].filter(Boolean);
const fase = (f) => todosAv().forEach((a) => a.setFase(f));

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
  resultadoImportacion: async (r) => { if (!r) return; if (!st.chatId) await asegurarChat('Datos'); await guardarMensaje('assistant', r.texto, r.meta || {}); } });

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
async function cargarProyectos() {
  if (E.get().modo !== 'work') { E.set({ proyectoId: null }); return; }
  st.proyectos = await q(sb.from('so_projects').select('id, name, memory, updated_at').eq('mode', 'work').order('created_at'));
  if (!st.proyectos.length) st.proyectos = [await q(sb.from('so_projects').insert({ name: 'Trabajo', mode: 'work' }).select('id, name, memory, updated_at').single())];
  const preferido = st.resume?.proyectoId && st.proyectos.some((p) => p.id === st.resume.proyectoId) ? st.resume.proyectoId : st.proyectos[0].id;
  if (!st.proyectos.some((p) => p.id === E.get().proyectoId)) E.set({ proyectoId: preferido });
}

async function cargarArtefactos() {
  if (E.get().modo !== 'work') { st.artefactos = []; pintarMenu(); return; }
  const [arts, menu, comp, prefs] = await Promise.all([
    q(sb.from('so_artifacts').select('id, project_id, name, type, version, route, state, datasource_id, configuration, specification, schema, deleted_at, updated_at')
      .eq('project_id', E.get().proyectoId).is('deleted_at', null).order('updated_at', { ascending: false })),
    q(sb.from('so_menu').select('artifact_id, name, favorite, last_opened_at, open_count, status')),
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

function recientes(n = 8) {
  return st.artefactos.filter((a) => a.state === 'published').map((a) => ({ a, m: st.menu.get(a.id) || {} }))
    .sort((x, y) => String(y.m.last_opened_at || y.a.updated_at).localeCompare(String(x.m.last_opened_at || x.a.updated_at))).slice(0, n);
}

function pintarMenu() {
  const actual = location.hash.match(/^#\/a\/(.+)$/)?.[1];
  const link = (a, icono = '📊') => `<a href="#/a/${a.id}" ${actual === a.id ? 'aria-current="page"' : ''}>${icono} ${esc(a.name)}</a>`;
  const favs = st.artefactos.filter((a) => st.menu.get(a.id)?.favorite);
  $('tituloFavoritos').hidden = !favs.length;
  $('menuFavoritos').innerHTML = favs.map((a) => link(a, '★')).join('');
  const recs = recientes(6).filter(({ a }) => !st.menu.get(a.id)?.favorite);
  const total = st.artefactos.filter((a) => a.state === 'published').length;
  $('menuWorkspace').innerHTML = (recs.length ? recs.map(({ a }) => link(a)).join('') : (favs.length ? '' : '<span class="vacio">Lo que crees con Francisco aparece acá.</span>'))
    + (total > 6 ? `<button type="button" class="enlace" data-ver-todos>Ver los ${total} tableros…</button>` : '');
  $('menuWorkspace').querySelector('[data-ver-todos]')?.addEventListener('click', () => abrirPaleta(''));
  $('tituloCompartidos').hidden = !st.compartidos.length;
  $('menuCompartidos').innerHTML = st.compartidos.map((a) => `<a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a>`).join('');
  $('linkInicio').toggleAttribute('aria-current', !location.hash || location.hash === '#/');
}

async function cargarChats() {
  st.chats = await q(sb.from('so_chats').select('id, title, mode, updated_at').eq('mode', E.get().modo).order('updated_at', { ascending: false }).limit(50));
  $('listaChats').innerHTML = st.chats.slice(0, 8).map((c) => `<a href="#/c/${c.id}" ${c.id === st.chatId ? 'aria-current="page"' : ''}>💬 ${esc(c.title)}</a>`).join('')
    || '<span class="vacio">Sin conversaciones todavía.</span>';
}

async function cambiarModo(modo, navegar = true) {
  E.set({ modo, artefactoId: null });
  document.querySelectorAll('.modos button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
  todosAv().forEach((a) => a.setModo(modo));
  $('bloqueWorkspace').hidden = modo !== 'work';
  st.chatId = null; st.mensajes = [];
  await cargarProyectos();
  await Promise.all([cargarArtefactos(), cargarChats()]);
  if (navegar) { if (location.hash === '#/' || !location.hash) ruta(); else location.hash = '#/'; }
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
  app.classList.remove('vista-home', 'vista-chat', 'vista-artefacto', 'panel-abierto');
  app.classList.add(`vista-${nombre}`);
  $('vistaHome').hidden = nombre !== 'home';
  $('vistaArtefacto').hidden = nombre !== 'artefacto';
  E.set({ vista: nombre });
}

async function ruta() {
  $('lateral').classList.remove('abierto');
  const h = location.hash;
  const a = h.match(/^#\/a\/([0-9a-f-]{36})$/);
  const c = h.match(/^#\/c\/([0-9a-f-]{36})$/);
  if (a && E.get().modo === 'work') { pintarMenu(); return abrirArtefacto(a[1]); }
  if (c) {
    if (st.chatId !== c[1]) { st.chatId = c[1]; await cargarMensajes(); }
    vista('chat');
    const chat = st.chats.find((x) => x.id === c[1]);
    $('titulo').textContent = chat?.title || 'Conversación';
    $('meta').textContent = '';
  } else {
    vista('home');
    E.set({ artefactoId: null });
    pintarHome();
  }
  pintarMensajes();
  pintarMenu();
  cargarChats().catch(() => {});
}

// Inicio del proyecto: continuar, recientes, actividad, pendientes, compartidos. Sin métricas decorativas.
function pintarHome() {
  const modo = E.get().modo;
  const p = proyecto();
  $('titulo').textContent = modo === 'work' ? `Inicio · ${p?.name || 'Trabajo'}` : 'Inicio · Personal';
  $('meta').textContent = modo === 'work' && st.proyectos.length > 1 ? 'Cambiá de proyecto con ⌘K' : '';
  const primeraVez = !st.chats.length && !st.artefactos.length;
  const h = $('vistaHome');
  if (primeraVez) {
    h.innerHTML = `<div class="bienvenida"><span id="avatarGrande"></span>
      <h2>${modo === 'work' ? 'Soy Francisco. Decime qué querés conseguir y yo me ocupo del resto.' : 'Soy Francisco. Acá charlamos tranquilos.'}</h2>
      ${modo === 'work' ? `<ul class="explica">
        <li><strong>Pedime objetivos</strong>, no pasos: "quiero seguir mis ventas mes a mes".</li>
        <li><strong>Creo</strong> tableros y herramientas con su historial guardado.</li>
        <li><strong>Modifico</strong> lo que ya existe: "agregale vendedor", "compará con agosto".</li>
        <li><strong>Los resultados</strong> quedan en el menú de la izquierda y en tarjetas que podés abrir y compartir.</li>
      </ul>` : '<p class="vacio">En Personal solo conversamos: no se crean tableros.</p>'}
    </div>`;
    avatares.grande = crearAvatar(h.querySelector('#avatarGrande'), { modo });
    pintarSugerencias();
    return;
  }
  avatares.grande = null;
  const terminadas = st.tareas.filter((t) => t.status === 'completed' && st.lastVisit && t.updated_at > st.lastVisit);
  const atencion = st.tareas.filter((t) => ['failed', 'waiting'].includes(t.status));
  const r = st.resume?.artefactoId && artefacto(st.resume.artefactoId);
  const ultimoChat = st.chats[0];
  const bloques = [];
  if (r || ultimoChat) {
    bloques.push(`<section class="tarjeta"><h3>Continuar trabajando</h3><div class="continuar">
      ${r ? `<button type="button" class="primario" data-continuar>Continuar ${esc(r.name)}${st.resume.filtro ? ` · solo ${esc(st.resume.filtro.valor)}` : ''}${st.resume.desde ? ` · ${esc(nombreMes(st.resume.desde))}` : ''}</button>` : ''}
      ${ultimoChat ? `<a class="boton" href="#/c/${ultimoChat.id}">Seguir la conversación "${esc(ultimoChat.title)}"</a>` : ''}
      ${terminadas.length ? `<button type="button" class="enlace" data-centro>Francisco terminó ${terminadas.length} ${terminadas.length === 1 ? 'tarea' : 'tareas'} desde tu última visita</button>` : ''}
    </div></section>`);
  }
  if (modo === 'work') {
    const recs = recientes(6);
    if (recs.length) bloques.push(`<section><h3 class="titulo-seccion">Recientes</h3><div class="tarjetas">${recs.map(({ a }) => tarjetaArtefacto(a)).join('')}</div></section>`);
    if (atencion.length) bloques.push(`<section class="tarjeta"><h3>Pendientes</h3><ul class="lista">${atencion.map((t) =>
      `<li><span>⚠️ ${esc(t.name || t.kind)}${t.needs_action ? ` — ${esc(t.needs_action)}` : ''}</span><button type="button" class="enlace" data-centro>Ver</button></li>`).join('')}</ul></section>`);
    const rel = st.avisos.filter((n) => !n.read_at).slice(0, 4);
    if (rel.length) bloques.push(`<section class="tarjeta"><h3>Actividad relevante</h3><ul class="lista">${rel.map((n) =>
      `<li><span>${{ critical: '⛔', action: '⚠️', success: '✅', info: 'ℹ️' }[n.priority]} ${esc(n.title)}</span><small>${esc(haceCuanto(n.created_at))}</small></li>`).join('')}</ul></section>`);
    if (st.compartidos.length) bloques.push(`<section class="tarjeta"><h3>Compartidos conmigo</h3><ul class="lista">${st.compartidos.map((a) =>
      `<li><a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a><small>${esc({ VIEW: 'puedo verlo', USE: 'puedo usarlo', EDIT: 'puedo modificarlo' }[a.permission])}</small></li>`).join('')}</ul></section>`);
  } else {
    bloques.push(`<section class="tarjeta"><h3>Conversaciones recientes</h3><ul class="lista">${st.chats.slice(0, 6).map((c) =>
      `<li><a href="#/c/${c.id}">💬 ${esc(c.title)}</a><small>${esc(haceCuanto(c.updated_at))}</small></li>`).join('')}</ul></section>`);
  }
  h.innerHTML = bloques.join('') || '<p class="vacio">Pedile algo a Francisco abajo.</p>';
  h.querySelector('[data-continuar]')?.addEventListener('click', () => {
    const rs = st.resume;
    location.hash = `#/a/${rs.artefactoId}`;
    setTimeout(() => E.set({ desde: rs.desde, hasta: rs.hasta, filtro: rs.filtro }), 0);
  });
  h.querySelectorAll('[data-centro]').forEach((b) => b.addEventListener('click', () => abrirCentro('tareas')));
  conectarTarjetas(h);
  pintarSugerencias();
}

// ---------------------------------------------------------------- ArtifactCard
function tarjetaArtefacto(a, extra = '') {
  const m = st.menu.get(a.id) || {};
  const tipo = { dashboard: 'Tablero', tool: 'Herramienta', form: 'Formulario', report: 'Reporte' }[a.type] || a.type;
  const estado = a.deleted_at || a.state === 'deleted' ? 'Eliminado' : a.state === 'published' ? 'Publicado' : 'Borrador';
  return `<article class="tarjeta-art" data-art="${a.id}">
    <div class="ta-cab"><span class="ta-tipo">📊 ${esc(tipo)}</span>${m.favorite ? '<span title="Favorito">★</span>' : ''}</div>
    <h4>${esc(a.name)}</h4>
    <p class="ta-meta">${esc(estado)} · v${a.version} · actualizado ${esc(haceCuanto(a.updated_at))}</p>
    ${extra}
    ${estado === 'Eliminado' ? '' : `<div class="ta-acc"><a class="boton primario" href="#/a/${a.id}">Abrir</a>
      <button type="button" class="enlace" data-ta="compartir">Compartir</button> ·
      <button type="button" class="enlace" data-ta="editar">Editar con Francisco</button> ·
      <details class="mas"><summary class="enlace">Más</summary><div class="mas-menu">
        <button type="button" data-ta="favorito">${m.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}</button>
        <button type="button" data-ta="versiones">Ver versiones</button></div></details></div>`}
  </article>`;
}

function conectarTarjetas(raiz) {
  raiz.querySelectorAll('[data-art] [data-ta]').forEach((b) => {
    const id = b.closest('[data-art]').dataset.art;
    b.addEventListener('click', () => accionTarjeta(b.dataset.ta, id));
  });
}

async function accionTarjeta(accion, id) {
  const a = artefacto(id);
  if (!a) return;
  if (accion === 'editar') return editarConFrancisco(id);
  if (accion === 'favorito') return procesarAccion({ tipo: 'favorito', artefactoId: id, valor: !st.menu.get(id)?.favorite }, null);
  location.hash = `#/a/${id}`;
  setTimeout(() => {
    if (accion === 'compartir') { $('panelCompartir').scrollIntoView({ behavior: 'smooth' }); $('formCompartir').email.focus(); }
    if (accion === 'versiones') { $('panelVersiones').open = true; $('panelVersiones').scrollIntoView({ behavior: 'smooth' }); }
  }, 300);
}

function editarConFrancisco(id) {
  E.set({ artefactoId: id });
  if (location.hash !== `#/a/${id}`) location.hash = `#/a/${id}`;
  abrirPanel();
  $('texto').placeholder = `¿Qué querés cambiar o saber de ${artefacto(id)?.name || 'este tablero'}?`;
  $('texto').focus();
}

function abrirPanel() { $('app').classList.add('panel-abierto'); }
$('fab').onclick = () => { abrirPanel(); $('texto').focus(); };
$('cerrarPanel').onclick = () => $('app').classList.remove('panel-abierto');

// ---------------------------------------------------------------- contexto visible y sugerencias
function pintarContexto() {
  const s = E.get();
  const a = s.artefactoId && artefacto(s.artefactoId);
  const periodo = s.desde || s.hasta ? (s.desde === s.hasta || !s.hasta || !s.desde ? nombreMes(s.desde || s.hasta) : `${nombreMes(s.desde)} – ${nombreMes(s.hasta)}`) : null;
  const lista = chips(s, { proyecto: st.proyectos.length > 1 ? proyecto()?.name : null, artefacto: a?.name, periodo, comparar: s.comparar && nombreMes(s.comparar) });
  $('contexto').innerHTML = lista.map((c) => `<span class="chip">${esc(c.texto)}${c.quitar ? `<button type="button" data-quitar="${c.id}" aria-label="Quitar ${esc(c.texto)}">×</button>` : ''}</span>`).join('');
  $('contexto').querySelectorAll('[data-quitar]').forEach((b) => b.addEventListener('click', () => {
    const c = lista.find((x) => x.id === b.dataset.quitar);
    E.set(c.quitar);
    if (c.id === 'artefacto' && location.hash.startsWith('#/a/')) location.hash = '#/';
  }));
  pintarSugerencias();
  pintarAccionesArtefacto();
}

function pintarSugerencias() {
  const s = E.get();
  let sug = [];
  const vacio = !st.mensajes.length;
  if (s.seleccion) sug = ['¿Por qué cambió esto?', 'Comparalo con el mes anterior'];
  else if (s.artefactoId && vacio) sug = ['Analizá este tablero', 'Compará con el mes anterior', 'Compartí este tablero'];
  else if (vacio && s.vista === 'home') {
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
  return `<div class="msg assistant">${badge}<div>${html}</div>${conf}${det}${card}${acciones.length ? `<div class="msg-acc">${acciones.join('')}</div>` : ''}</div>`;
}

function pintarMensajes() {
  const cont = $('mensajes');
  cont.innerHTML = st.mensajes.map(htmlMensaje).join('');
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

async function asegurarChat(titulo) {
  if (st.chatId) return;
  const c = await q(sb.from('so_chats').insert({ mode: E.get().modo, project_id: E.get().proyectoId ?? null, title: titulo.slice(0, 60) }).select('id, title, mode, updated_at').single());
  st.chatId = c.id; st.mensajes = [];
  st.chats.unshift(c);
  cargarChats().catch(() => {});
  if (E.get().vista !== 'artefacto') {
    history.replaceState(null, '', `#/c/${c.id}`);
    vista('chat');
    $('titulo').textContent = c.title;
  }
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
    if (E.get().vista === 'home') {   // desde Inicio, la respuesta tiene que verse: se pasa a la conversación
      history.replaceState(null, '', `#/c/${st.chatId}`);
      vista('chat');
      $('titulo').textContent = st.chats.find((x) => x.id === st.chatId)?.title || 'Conversación';
      pintarMensajes();
    }
    if (!reintentoDe) {
      const m = await guardarMensaje('user', texto, { ...contextoMeta(), ...(adjuntos.length ? { adjuntos } : {}) });
      if (adjuntos.length) await D.asociarMensaje(adjuntos, m.id);
    }
    const s = E.get();
    const previos = adjuntos.length ? adjuntos : reintentoDe ? (st.mensajes.find((x) => x.id === reintentoDe)?.meta?.adjuntos || []) : [];
    const entradaAcc = interpretarEntrada(texto, { modo: s.modo, adjuntos: previos, adjuntosPrevios: ultimosAdjuntos(), artefactos: st.artefactos, activoId: s.artefactoId });
    if (entradaAcc && entradaAcc.tipo !== 'bloqueado') r = await D.ejecutarEntrada(entradaAcc);
    else if (entradaAcc) r = await ejecutar(entradaAcc, texto);
    else {
      const accion = interpretar(texto, { modo: s.modo, artefactos: st.artefactos, activoId: s.artefactoId, hoy: hoy() });
      if (riesgo(accion) === 'alto') r = await proponer(accion);
      else r = await ejecutar(accion, texto);
    }
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
        `Cambié el gráfico a ${{ bar: 'barras', line: 'líneas', pie: 'torta' }[acc.grafico]}.`);
    }
    case 'renombrar': {
      actividad('actualizando');
      const r = await actualizarArtefacto(acc.artefactoId, () => ({ name: acc.nombre }), `Ahora se llama "${acc.nombre}".`);
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
      return { texto: c.texto, meta: { estado: 'ejecutado', confianza: c.confianza, artifactId: a.id,
        fuente: { origen, operacion: c.evidencia.operacion + (base !== records ? ` (solo ${s.filtro.valor})` : ''), registros: c.evidencia.registros, at: new Date().toISOString() },
        porque: `Usé "${origen}" porque es la fuente asociada a "${a.name}".` }, skills: ['FranciscoIntent', 'FranciscoData'] };
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
      return { texto: r.texto, meta: { estado: 'ejecutado', confianza: r.confianza, artifactId: a.id, tarjeta: true,
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
          E.set({ artefactoId: a.id, filtro: { key: f.key, valor: hit, label: f.label } });
          if (location.hash !== `#/a/${a.id}`) location.hash = `#/a/${a.id}`; else abrirArtefacto(a.id);
          return { texto: `Mostrando solo ${f.label || f.key}: ${hit} en "${a.name}".`, meta: { estado: 'ejecutado' } };
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
        const cand = recientes(50).filter(({ m }) => m.last_opened_at && new Date(m.last_opened_at).toLocaleDateString('sv') === clave)
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
      const p = await q(sb.from('so_projects').insert({ name: acc.nombre, mode: 'work' }).select('id, name, memory, updated_at').single());
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
  const porque = `${spec.camposExplicitos ? 'Usé los campos que pediste' : `Elegí ${spec.campos.map((c) => c.label).join(', ')} porque es lo habitual para ${spec.tema}`}` +
    `${spec.grafico ? '' : st.preferencias.grafico ? `; gráfico de ${{ bar: 'barras', line: 'líneas', pie: 'torta' }[grafico]} porque es el que solés elegir` : ''}. Podés pedir "agregale…" o cambiarlo cuando quieras.`;
  return {
    texto: `Creé "${spec.name}"${spec.persistentStorage ? ' con historial guardado para comparar períodos' : ''}. Ya está en tu menú.`,
    meta: { estado: verificado ? 'verificado' : 'ejecutado', artifactId: id, tarjeta: true, porque, undo: { tipo: 'crear', artifactId: id } },
    skills: ['FranciscoIntent', 'FranciscoArtifact', 'FranciscoData'], capacidades: ['supabase'],
  };
}

async function actualizarArtefacto(id, cambio, texto, extraUndo = {}) {
  const a = artefacto(id);
  await q(sb.from('so_artifacts').update(cambio(a)).eq('id', id));
  actividad('verificando');
  const v = await q(sb.from('so_artifacts').select('version').eq('id', id).single());
  E.set({ artefactoId: id });
  await cargarArtefactos();
  if (E.get().vista === 'artefacto') abrirArtefacto(id);
  senal('FranciscoArtifact', 'success', { op: 'update' }, id);
  return { texto: `${texto} (versión ${v.version}).`, meta: { estado: v.version > a.version ? 'verificado' : 'ejecutado', artifactId: id, tarjeta: E.get().vista !== 'artefacto',
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
    { datasourceId: a.datasource_id, fields: ds.fields });
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

// ---------------------------------------------------------------- vista de artefacto
let renderToken = 0;
async function abrirArtefacto(id, { forzar = false } = {}) {
  const token = ++renderToken;
  vista('artefacto');
  if (E.get().artefactoId !== id) E.set({ artefactoId: id });
  const a0 = artefacto(id);
  $('titulo').textContent = a0?.name || 'Tablero';
  $('errorArtefacto').innerHTML = '';
  if (!forzar && st.menu.get(id) && !st.abiertos?.has(id)) {
    (st.abiertos ||= new Set()).add(id);
    sb.rpc('so_abrir_artefacto', { p_artifact: id }).then(() => {}, () => {});
    if ((st.menu.get(id).open_count || 0) > 0) evento('artifact_reuse');
  }
  let d;
  try {
    d = await datosDe(id, { forzar });
  } catch (err) {
    if (token !== renderToken) return;
    const cache = ls.get(`so.datos.${id}`);
    $('errorArtefacto').innerHTML = `<div class="tarjeta alerta" role="alert"><p><strong>No pude actualizar ${esc(a0?.name || 'este tablero')}</strong> (${esc(err.message)}).</p>
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
  pintarArtefacto(d.a, d);
  pintarCompartidos(d.a);
  pintarVersiones(d.a);
  D.pintarPanel(d.a.id);
  if (!forzar) D.refrescarAlAbrir(d.a.id);
}

function pintarArtefacto(a, d) {
  $('titulo').textContent = a.name;
  $('meta').textContent = `v${a.version} · ${a.state === 'published' ? 'publicado' : a.state}`;
  renderArtefacto($('artefacto'), { ...a, fields: d.fields, records: d.records, permission: 'OWNER' }, {
    estado: E.get(),
    onEstado: (c) => E.set(c),   // el render lo hace la suscripción al estado (misma vía que Francisco)
    onSeleccion: (sel) => {
      const actual = E.get().seleccion;
      E.set({ seleccion: actual && JSON.stringify(actual) === JSON.stringify(sel) ? null : sel });
    },
    onAdd: async (period, data) => {
      await q(sb.from('so_records').insert({ datasource_id: a.datasource_id, owner_id: st.user.id, period, data, idempotency_key: crypto.randomUUID() }));
      senal('FranciscoData', 'success', { op: 'record', via: 'form' }, a.id);
      await abrirArtefacto(a.id, { forzar: true });
    },
    onImportar: (file) => D.abrirImportacion(file, a.id),
    frescura: { cargado: d.cargado, ultimo: d.ultimo, cache: d.cache },
    onActualizar: () => abrirArtefacto(a.id, { forzar: true }),
  });
}

function pintarAccionesArtefacto() {
  const s = E.get();
  const a = s.vista === 'artefacto' && artefacto(s.artefactoId);
  if (!a) { $('accionesArtefacto').innerHTML = ''; return; }
  const fav = st.menu.get(a.id)?.favorite;
  const g = a.configuration?.grafico || 'line';
  $('accionesArtefacto').innerHTML = `
    <button type="button" data-aa="favorito" aria-pressed="${!!fav}">${fav ? '★ Favorito' : '☆ Favorito'}</button>
    <label class="compacto">Gráfico <select data-aa="grafico"><option value="line" ${g === 'line' ? 'selected' : ''}>Líneas</option><option value="bar" ${g === 'bar' ? 'selected' : ''}>Barras</option><option value="pie" ${g === 'pie' ? 'selected' : ''}>Torta</option></select></label>
    <button type="button" data-aa="compartir">Compartir</button>
    ${s.seleccion ? `<button type="button" class="primario" data-aa="preguntar">Preguntar a Francisco sobre: ${esc(s.seleccion.etiqueta)}</button>`
      : '<button type="button" class="primario" data-aa="editar">Editar con Francisco</button>'}`;
  const on = (k, ev, f) => $('accionesArtefacto').querySelector(`[data-aa="${k}"]`)?.addEventListener(ev, f);
  on('favorito', 'click', () => procesarAccion({ tipo: 'favorito', artefactoId: a.id, valor: !fav }, null));
  on('grafico', 'change', (e) => procesarAccion({ tipo: 'grafico', artefactoId: a.id, grafico: e.target.value }, null));
  on('compartir', 'click', () => { $('panelCompartir').scrollIntoView({ behavior: 'smooth' }); $('formCompartir').email.focus(); });
  on('editar', 'click', () => editarConFrancisco(a.id));
  on('preguntar', 'click', () => { abrirPanel(); $('texto').placeholder = `Preguntá sobre ${s.seleccion.etiqueta}…`; $('texto').focus(); });
}

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
  } finally { st.ocupado = false; pintarAccionesArtefacto(); }
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

// ---------------------------------------------------------------- paleta de comandos (⌘K / Ctrl+K) y búsqueda global
let paletaItems = [], paletaSel = 0, paletaElegido = false, tBusca = null, remotos = [];
function accionesPaleta() {
  const modo = E.get().modo;
  return [
    { tipo: 'accion', titulo: 'Preguntarle a Francisco', extra: 'abrir chat composer', run: () => { abrirPanel(); $('texto').focus(); } },
    { tipo: 'accion', titulo: 'Ir al inicio', run: () => { location.hash = '#/'; } },
    { tipo: 'accion', titulo: 'Nueva conversación', run: () => { st.chatId = null; st.mensajes = []; location.hash = '#/'; ruta(); $('texto').focus(); } },
    ...(modo === 'work' ? [{ tipo: 'accion', titulo: 'Crear un tablero', extra: 'dashboard nuevo', run: () => { $('texto').value = 'Creá un dashboard de '; $('texto').focus(); } }] : []),
    { tipo: 'accion', titulo: modo === 'work' ? 'Cambiar a Personal' : 'Cambiar a Trabajo', run: () => cambiarModo(modo === 'work' ? 'personal' : 'work') },
    { tipo: 'accion', titulo: 'Ver actividad y avisos', run: () => abrirCentro('tareas') },
    { tipo: 'accion', titulo: 'Cambiar tema', run: ciclarTema },
  ];
}
function itemsLocales() {
  const out = [];
  for (const a of st.artefactos.filter((x) => x.state === 'published')) {
    const m = st.menu.get(a.id) || {};
    out.push({ tipo: 'artefacto', titulo: a.name, extra: a.type, fecha: m.last_opened_at || a.updated_at, frecuencia: m.open_count, favorito: m.favorite, run: () => { location.hash = `#/a/${a.id}`; } });
  }
  for (const p of st.proyectos) out.push({ tipo: 'proyecto', titulo: `Proyecto: ${p.name}`, fecha: p.updated_at, run: () => cambiarProyecto(p.id) });
  for (const a of st.compartidos) out.push({ tipo: 'compartido', titulo: a.name, extra: 'compartido conmigo', run: () => { location.href = BASE_SHARED + a.id; } });
  for (const c of st.chats) out.push({ tipo: 'chat', titulo: c.title, extra: 'conversación', fecha: c.updated_at, run: () => { location.hash = `#/c/${c.id}`; } });
  return out;
}
function abrirPaleta(inicial = '') {
  paletaElegido = false; remotos = [];
  $('paleta').showModal();
  $('paletaInput').value = inicial;
  filtrarPaleta();
  $('paletaInput').focus();
}
function filtrarPaleta(remoto = true) {
  const qy = $('paletaInput').value.trim();
  const ICON = { accion: '⚡', artefacto: '📊', proyecto: '🗂', compartido: '📎', chat: '💬', registro: '🧾', archivo: '📄', pedir: '✨' };
  if (!qy) {
    paletaItems = [...recientes(5).map(({ a, m }) => ({ tipo: 'artefacto', titulo: a.name, extra: 'reciente', run: () => { location.hash = `#/a/${a.id}`; } })), ...accionesPaleta()];
  } else {
    paletaItems = [...rankear(qy, [...itemsLocales(), ...accionesPaleta()]).slice(0, 12), ...remotos,
      { tipo: 'pedir', titulo: `Pedirle a Francisco: "${qy}"`, run: () => { abrirPanel(); $('texto').value = qy; $('formChat').requestSubmit(); } }];
  }
  paletaSel = 0;
  $('paletaLista').innerHTML = paletaItems.map((it, i) => `<li role="option" id="op${i}" aria-selected="${i === 0}" data-i="${i}">${ICON[it.tipo] || '•'} ${esc(it.titulo)}${it.extra && it.tipo !== 'accion' ? ` <small>${esc(it.extra)}</small>` : ''}</li>`).join('');
  $('paletaLista').querySelectorAll('li').forEach((li) => li.addEventListener('click', () => elegirPaleta(Number(li.dataset.i))));
  if (!remoto) return;
  clearTimeout(tBusca);
  if (qy.length >= 2) tBusca = setTimeout(async () => {
    try {
      const rs = await q(sb.rpc('so_buscar', { p_q: qy, p_limit: 8 }));
      if ($('paletaInput').value.trim() !== qy) return;
      remotos = [...rs.filter((r) => r.kind === 'file').map((r) => ({ tipo: 'archivo', titulo: r.title, extra: r.subtitle, run: () => D.vistaPrevia(r.id) })),
        ...rs.filter((r) => r.kind === 'record').map((r) => ({ tipo: 'registro', titulo: r.title, extra: r.subtitle, run: () => { location.hash = `#/a/${r.artifact_id}`; } }))];
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
    $('paletaLista').querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === paletaSel)));
    $('paletaLista').querySelector(`#op${paletaSel}`)?.scrollIntoView({ block: 'nearest' });
    $('paletaInput').setAttribute('aria-activedescendant', `op${paletaSel}`);
  } else if (e.key === 'Enter') { e.preventDefault(); elegirPaleta(paletaSel); }
});
$('paleta').addEventListener('close', () => { if (!paletaElegido && $('paletaInput').value.trim()) evento('search_miss'); });
$('abrirPaleta').onclick = () => abrirPaleta();
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('app').hidden) { e.preventDefault(); $('paleta').open ? $('paleta').close() : abrirPaleta(); }
  if (e.key === 'Escape' && $('app').classList.contains('panel-abierto') && !$('paleta').open && !$('centro').open) $('app').classList.remove('panel-abierto');
});

// ---------------------------------------------------------------- usuarios que solo recibieron tableros compartidos
async function soloCompartidos() {
  document.querySelector('.modos').hidden = true; $('abrirPaleta').hidden = true; $('panelFrancisco').hidden = true; $('fab').hidden = true; $('btnCentro').hidden = true;
  $('listaChats').previousElementSibling.hidden = true; $('listaChats').hidden = true;
  $('titulo').textContent = 'Tableros compartidos conmigo';
  const compartidos = await q(sb.rpc('so_shared_list'));
  st.compartidos = compartidos;
  $('tituloCompartidos').hidden = false;
  $('menuCompartidos').innerHTML = compartidos.map((a) => `<a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a>`).join('') || '<span class="vacio">No tenés tableros compartidos.</span>';
  $('vistaHome').innerHTML = `<section class="tarjeta"><h3>Compartidos conmigo</h3><ul class="lista">${compartidos.map((a) =>
    `<li><a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a><small>${esc({ VIEW: 'podés verlo', USE: 'podés usarlo', EDIT: 'podés modificarlo' }[a.permission])}</small></li>`).join('') || '<li class="vacio">Todavía nadie te compartió un tablero.</li>'}</ul></section>`;
}
