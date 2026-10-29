// SO · Francisco: chat + workspace dinámico. Lo determinista (crear/modificar/compartir/cargar) lo resuelve el motor de
// intención y se ejecuta contra Supabase con la sesión del usuario (RLS); la conversación libre va a la Edge Function.
import { interpretar, armarRegistro } from './intent.js';
import { renderArtefacto, esc } from './vista.js';
import { crearAvatar } from './avatar.js';

const cfg = window.SO_SUPABASE;
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const BASE_SHARED = new URL('shared/', location.href).href;

const st = {
  user: null, modo: localStorage.getItem('so.modo') === 'personal' ? 'personal' : 'work',
  proyecto: null, chats: [], chatId: null, artefactos: [], activoId: null, ocupado: false,
};

const avatares = {
  marca: crearAvatar($('avatarMarca'), { modo: st.modo }),
  login: crearAvatar($('avatarLogin'), { modo: 'work' }),
  grande: null,
};
const todos = () => [avatares.marca, avatares.grande].filter(Boolean);
const fase = (f) => todos().forEach((a) => a.setFase(f));

// ---------------------------------------------------------------- tema
const TEMAS = ['auto', 'light', 'dark'];
function aplicarTema(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $('tema').textContent = `Tema: ${{ auto: 'automático', light: 'claro', dark: 'oscuro' }[t]}`;
}
let tema = (() => { try { return localStorage.getItem('so.tema') || 'auto'; } catch { return 'auto'; } })();
aplicarTema(tema);
$('tema').onclick = () => { tema = TEMAS[(TEMAS.indexOf(tema) + 1) % 3]; try { localStorage.setItem('so.tema', tema); } catch {} aplicarTema(tema); };

// ---------------------------------------------------------------- sesión
$('formLogin').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('errorLogin').hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email')), password: String(fd.get('password')) });
  if (error) { $('errorLogin').textContent = 'No se pudo entrar: revisá correo y contraseña.'; $('errorLogin').hidden = false; }
};
$('salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };
$('abrirMenu').onclick = () => $('lateral').classList.toggle('abierto');

sb.auth.onAuthStateChange((_ev, session) => {
  if (session?.user && st.user?.id !== session.user.id) iniciar(session.user);
  if (!session) { $('app').hidden = true; $('login').hidden = false; }
});

async function iniciar(user) {
  st.user = user;
  $('login').hidden = true; $('app').hidden = false;
  $('usuario').textContent = user.email;
  // Usuarios que solo recibieron tableros compartidos: ven esos tableros, nunca chat ni workspace propio.
  const { data: habilitado } = await sb.rpc('es_valo');
  if (!habilitado) return soloCompartidos();
  await cambiarModo(st.modo, false);
  window.addEventListener('hashchange', ruta);
  ruta();
}

// ---------------------------------------------------------------- utilidades de datos
async function q(promesa) {
  const { data, error } = await promesa;
  if (error) throw new Error(traducirError(error));
  return data;
}
function traducirError(e) {
  const m = e?.message || String(e);
  if (/row-level security|sin permiso|42501/i.test(m)) return 'No tenés permiso para esa operación.';
  if (/campo desconocido|debe ser/i.test(m)) return m;
  return m;
}
async function senal(skill, signal, meta = {}, artifact_id = null, inferred = false) {
  try { await sb.from('so_signals').insert({ skill, signal, meta, artifact_id, inferred }); } catch { /* no bloquea */ }
}

async function asegurarProyecto() {
  if (st.modo !== 'work') { st.proyecto = null; return; }
  const ps = await q(sb.from('so_projects').select('id, name, memory').eq('mode', 'work').order('created_at').limit(1));
  st.proyecto = ps[0] || (await q(sb.from('so_projects').insert({ name: 'Trabajo', mode: 'work' }).select('id, name, memory').single()));
}

async function cargarArtefactos() {
  if (st.modo !== 'work') { st.artefactos = []; pintarMenu(); return; }
  st.artefactos = await q(sb.from('so_artifacts')
    .select('id, name, type, version, route, state, datasource_id, configuration, specification, schema, deleted_at, updated_at')
    .is('deleted_at', null).order('updated_at', { ascending: false }));
  pintarMenu();
  const compartidos = await q(sb.rpc('so_shared_list'));
  $('tituloCompartidos').hidden = !compartidos.length;
  $('menuCompartidos').innerHTML = compartidos.map((a) =>
    `<a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)} <span class="etiqueta">${esc(a.permission)}</span></a>`).join('');
}

function pintarMenu() {
  const items = st.artefactos.filter((a) => a.state === 'published');
  $('menuWorkspace').innerHTML = items.length
    ? items.map((a) => `<a href="#/a/${a.id}" ${location.hash === `#/a/${a.id}` ? 'aria-current="page"' : ''}>📊 ${esc(a.name)}</a>`).join('')
    : '<span class="vacio">Pedile a Francisco: "Creá un dashboard de ventas con histórico".</span>';
}

async function cargarChats() {
  st.chats = await q(sb.from('so_chats').select('id, title, mode, updated_at').eq('mode', st.modo).order('updated_at', { ascending: false }).limit(30));
  $('listaChats').innerHTML = st.chats.length
    ? st.chats.map((c) => `<a href="#/c/${c.id}" ${c.id === st.chatId ? 'aria-current="page"' : ''}>💬 ${esc(c.title)}</a>`).join('')
    : '<span class="vacio">Sin conversaciones todavía.</span>';
}

async function cambiarModo(modo, navegar = true) {
  st.modo = modo;
  try { localStorage.setItem('so.modo', modo); } catch {}
  document.querySelectorAll('.modos button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
  todos().forEach((a) => a.setModo(modo));
  $('bloqueWorkspace').hidden = modo !== 'work';
  st.chatId = null;
  await asegurarProyecto();
  await Promise.all([cargarArtefactos(), cargarChats()]);
  if (navegar) location.hash = '#/';
}
document.querySelectorAll('.modos button').forEach((b) => { b.onclick = () => cambiarModo(b.dataset.modo); });
$('nuevoChat').onclick = () => { st.chatId = null; location.hash = '#/'; ruta(); };

// ---------------------------------------------------------------- rutas
async function ruta() {
  $('lateral').classList.remove('abierto');
  const h = location.hash;
  const a = h.match(/^#\/a\/([0-9a-f-]{36})$/);
  const c = h.match(/^#\/c\/([0-9a-f-]{36})$/);
  if (a && st.modo === 'work') return abrirArtefacto(a[1]);
  $('vistaArtefacto').hidden = true; $('vistaChat').hidden = false;
  if (c) { st.chatId = c[1]; } else if (!h || h === '#/') { st.chatId = null; }
  await pintarChat();
  pintarMenu();
  cargarChats();
}

// ---------------------------------------------------------------- chat
function burbuja(m) {
  const d = document.createElement('div');
  d.className = `msg ${m.role}`;
  d.innerHTML = esc(m.content).replace(/(#\/a\/[0-9a-f-]{36}|https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}">${u.startsWith('#') ? 'Abrir' : u}</a>`);
  return d;
}

async function pintarChat() {
  const cont = $('mensajes');
  cont.innerHTML = '';
  $('titulo').textContent = st.modo === 'work' ? 'Francisco · Trabajo' : 'Francisco · Personal';
  $('meta').textContent = '';
  if (!st.chatId) {
    const b = document.createElement('div');
    b.className = 'bienvenida';
    b.innerHTML = `<span id="avatarGrande"></span><p>${st.modo === 'work'
      ? 'Contame qué necesitás. Puedo armar dashboards con histórico, agregarles datos, compartirlos y más.'
      : 'Modo Personal: charlamos tranquilos. Acá no publico tableros.'}</p>
      <div class="sugerencias">${(st.modo === 'work'
        ? ['Creá un dashboard de ventas con histórico', 'Armá un tablero de gastos con campos monto y categoría', '¿Qué dashboards tengo?']
        : ['¿Me ayudás a organizar la semana?', 'Recomendame un libro']).map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>`;
    cont.append(b);
    avatares.grande = crearAvatar(b.querySelector('#avatarGrande'), { modo: st.modo });
    b.querySelectorAll('.sugerencias button').forEach((x) => { x.onclick = () => { $('texto').value = x.textContent; $('formChat').requestSubmit(); }; });
    return;
  }
  avatares.grande = null;
  const msgs = await q(sb.from('so_messages').select('id, role, content, meta').eq('chat_id', st.chatId).order('id', { ascending: false }).limit(100));
  msgs.reverse().forEach((m) => cont.append(burbuja(m)));
  const chat = st.chats.find((x) => x.id === st.chatId);
  if (chat) $('titulo').textContent = chat.title;
  cont.scrollTop = cont.scrollHeight;
}

async function guardarMensaje(role, content, meta = {}) {
  const m = await q(sb.from('so_messages').insert({ chat_id: st.chatId, role, content, meta }).select('id, role, content, meta').single());
  await sb.from('so_chats').update({ updated_at: new Date().toISOString() }).eq('id', st.chatId);
  if (!$('mensajes').querySelector('.bienvenida')) $('mensajes').append(burbuja(m));
  $('mensajes').scrollTop = $('mensajes').scrollHeight;
  return m;
}

$('texto').addEventListener('input', (e) => {
  e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`;
  fase(e.target.value ? 'listening' : 'idle');
});
$('texto').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('formChat').requestSubmit(); } });

$('formChat').onsubmit = async (e) => {
  e.preventDefault();
  const texto = $('texto').value.trim();
  if (!texto || st.ocupado) return;
  st.ocupado = true; $('enviar').disabled = true;
  $('texto').value = ''; $('texto').style.height = 'auto';
  const inicio = performance.now();
  fase('thinking');
  try {
    if (!st.chatId) {
      const c = await q(sb.from('so_chats').insert({ mode: st.modo, project_id: st.proyecto?.id ?? null, title: texto.slice(0, 60) }).select('id').single());
      st.chatId = c.id;
      history.replaceState(null, '', `#/c/${c.id}`);
      $('mensajes').innerHTML = '';
      cargarChats();
    }
    await guardarMensaje('user', texto);
    const accion = interpretar(texto, { modo: st.modo, artefactos: st.artefactos, activoId: st.activoId });
    const r = await ejecutar(accion, texto);
    fase('responding');
    await guardarMensaje('assistant', r.texto, r.meta || {});
    fase(r.ok === false ? 'error' : 'success');
    await sb.from('so_obs').insert({ request_id: crypto.randomUUID(), project_id: st.proyecto?.id ?? null, model: r.modelo || null,
      skills: r.skills || ['FranciscoIntent'], capabilities: r.capacidades || [], latency_ms: Math.round(performance.now() - inicio),
      tokens: r.tokens ?? null, result: r.ok === false ? 'error' : 'ok' });
  } catch (err) {
    fase('error');
    if (st.chatId) await guardarMensaje('assistant', `No pude completarlo: ${err.message || err}`, { error: true }).catch(() => {});
  } finally {
    st.ocupado = false; $('enviar').disabled = false; $('texto').focus();
  }
};

// ---------------------------------------------------------------- ejecución de intenciones
async function ejecutar(acc, texto) {
  switch (acc.tipo) {
    case 'crear': return crearArtefacto(acc.artefacto);
    case 'agregar_campos': return agregarCampos(acc);
    case 'grafico': return actualizarArtefacto(acc.artefactoId, (a) => ({ configuration: { ...a.configuration, grafico: acc.grafico } }),
      `Listo: el gráfico ahora es de ${{ bar: 'barras', line: 'líneas', pie: 'torta' }[acc.grafico]}.`);
    case 'renombrar': {
      const r = await actualizarArtefacto(acc.artefactoId, () => ({ name: acc.nombre }), `Listo, ahora se llama "${acc.nombre}".`);
      await sb.from('so_menu').update({ name: acc.nombre }).eq('artifact_id', acc.artefactoId);
      return r;
    }
    case 'compartir': {
      await q(sb.rpc('so_compartir', { p_artifact: acc.artefactoId, p_email: acc.email, p_permission: acc.permiso }));
      await senal('FranciscoSecurity', 'success', { op: 'share', permiso: acc.permiso }, acc.artefactoId);
      const a = st.artefactos.find((x) => x.id === acc.artefactoId);
      return { texto: `Compartí "${a?.name}" con ${acc.email} (${{ VIEW: 'solo ver', USE: 'usar: ver y cargar datos', EDIT: 'editar' }[acc.permiso]}). ` +
        `No ve tus conversaciones ni otros tableros.\nLink: ${BASE_SHARED}${acc.artefactoId}\n` +
        `Tiene que entrar con ese mismo correo (si no tiene usuario, hay que crearlo en Supabase).`, meta: { artifactId: acc.artefactoId }, skills: ['FranciscoIntent', 'FranciscoSecurity'] };
    }
    case 'revocar': {
      let qs = sb.from('so_shares').select('id, grantee_email').eq('artifact_id', acc.artefactoId).is('revoked_at', null);
      if (acc.email) qs = qs.ilike('grantee_email', acc.email);
      const ss = await q(qs);
      if (!ss.length) return { texto: 'No encontré accesos activos para revocar en ese tablero.', meta: { artifactId: acc.artefactoId } };
      for (const s of ss) await q(sb.rpc('so_revocar', { p_share: s.id }));
      return { texto: `Listo: revoqué el acceso de ${ss.map((s) => s.grantee_email).join(', ')}.`, meta: { artifactId: acc.artefactoId }, skills: ['FranciscoIntent', 'FranciscoSecurity'] };
    }
    case 'borrar_visualizacion': {
      const a = st.artefactos.find((x) => x.id === acc.artefactoId);
      await q(sb.from('so_artifacts').update({ state: 'deleted', deleted_at: new Date().toISOString() }).eq('id', acc.artefactoId));
      await sb.from('so_menu').update({ status: 'removed' }).eq('artifact_id', acc.artefactoId);
      await cargarArtefactos();
      return { texto: `Saqué "${a?.name}" del workspace. Los datos históricos quedan guardados; si querés borrarlos también, pedime "borrá los datos" de ese tablero.`, meta: { artifactId: acc.artefactoId } };
    }
    case 'borrar_datos': {
      const a = st.artefactos.find((x) => x.id === acc.artefactoId);
      if (!a?.datasource_id) return { texto: 'Ese tablero no tiene datos guardados.' };
      const { count } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('datasource_id', a.datasource_id);
      if (!confirm(`Vas a borrar DEFINITIVAMENTE ${count ?? 0} registros históricos de "${a.name}". Esto no se puede deshacer. ¿Confirmás?`)) {
        return { texto: 'No borré nada. Los datos siguen guardados.', meta: { artifactId: a.id } };
      }
      await q(sb.from('so_records').delete().eq('datasource_id', a.datasource_id));
      await sb.from('so_decisions').insert({ project_id: st.proyecto?.id, chat_id: st.chatId, artifact_id: a.id, decision: `Se borraron los datos de "${a.name}" (${count ?? 0} registros), con confirmación explícita.` });
      return { texto: `Borré ${count ?? 0} registros de "${a.name}". El tablero sigue disponible, vacío.`, meta: { artifactId: a.id } };
    }
    case 'registrar': {
      const a = st.artefactos.find((x) => x.id === acc.artefactoId);
      const ds = await q(sb.from('so_datasources').select('fields').eq('id', a.datasource_id).single());
      const data = armarRegistro(ds.fields, acc);
      if (!Object.keys(data).length) return { texto: 'No identifiqué qué dato cargar. Probá con "registrá 1500 canal web".' };
      const period = acc.fecha || new Date().toISOString().slice(0, 10);
      await q(sb.from('so_records').insert({ datasource_id: a.datasource_id, owner_id: st.user.id, period, data, idempotency_key: crypto.randomUUID() }));
      await senal('FranciscoData', 'success', { op: 'record' }, a.id);
      return { texto: `Guardé en "${a.name}" (${period}): ${Object.entries(data).map(([k, v]) => `${k} = ${v}`).join(', ')}.\n#/a/${a.id}`, meta: { artifactId: a.id }, skills: ['FranciscoIntent', 'FranciscoData'] };
    }
    case 'listar': {
      const ps = st.artefactos.filter((a) => a.state === 'published');
      return { texto: ps.length ? `Tenés ${ps.length}:\n${ps.map((a) => `• ${a.name} (v${a.version}) #/a/${a.id}`).join('\n')}` : 'Todavía no tenés tableros. ¿Armamos uno?' };
    }
    case 'decision': {
      await q(sb.from('so_decisions').insert({ project_id: st.proyecto?.id ?? null, chat_id: st.chatId, decision: acc.texto }));
      if (acc.preferencia) await senal('FranciscoIntent', 'preference', { value: acc.texto.slice(0, 300) });
      return { texto: 'Anotado. Lo tengo en cuenta de ahora en más.', skills: ['FranciscoIntent'] };
    }
    case 'bloqueado': return { texto: 'En modo Personal solo charlamos; los tableros y herramientas se crean en modo Trabajo.' };
    case 'falta_email': return { texto: '¿Con qué correo lo comparto? (lo necesito para dar el acceso).' };
    case 'falta_artefacto': return { texto: st.artefactos.length ? `¿Sobre cuál? Tenés: ${st.artefactos.map((a) => a.name).join(', ')}.` : 'Todavía no hay tableros. ¿Querés que cree uno?' };
    default: return conversar();
  }
}

async function crearArtefacto(spec) {
  if (!st.proyecto) throw new Error('No hay proyecto de trabajo.');
  const id = crypto.randomUUID();
  const ds = await q(sb.from('so_datasources').insert({ project_id: st.proyecto.id, name: spec.name, fields: spec.campos }).select('id').single());
  await q(sb.from('so_artifacts').insert({
    id, project_id: st.proyecto.id, name: spec.name, type: spec.type, route: `#/a/${id}`, datasource_id: ds.id,
    menu: { icon: 'chart' }, specification: { tema: spec.tema, origen: 'FranciscoIntent' }, schema: { fields: spec.campos },
    permissions: { default: 'owner' }, sharing: { default: 'USE' },
    configuration: { grafico: spec.grafico, metrica: spec.campos.find((c) => c.type === 'number')?.key ?? null, historical: spec.persistentStorage },
    state: 'published', deployment_state: 'available',
  }));
  await q(sb.from('so_menu').insert({ artifact_id: id, name: spec.name, route: `#/a/${id}`, ord: st.artefactos.length }));
  await sb.from('so_decisions').insert({ project_id: st.proyecto.id, chat_id: st.chatId, artifact_id: id,
    decision: `Se creó "${spec.name}" con campos ${spec.campos.map((c) => c.label).join(', ')}${spec.persistentStorage ? ' y almacenamiento histórico' : ''}.` });
  await senal('FranciscoArtifact', 'success', { op: 'create', type: spec.type }, id);
  st.activoId = id;
  await cargarArtefactos();
  return {
    texto: `Listo: creé "${spec.name}" y lo publiqué en el menú.\nCampos: ${spec.campos.map((c) => c.label).join(', ')}.` +
      `${spec.persistentStorage ? '\nLos datos quedan guardados con historial para comparar períodos.' : ''}\n#/a/${id}`,
    meta: { artifactId: id }, skills: ['FranciscoIntent', 'FranciscoArtifact', 'FranciscoData'], capacidades: ['supabase'],
  };
}

async function actualizarArtefacto(id, cambio, texto) {
  const a = st.artefactos.find((x) => x.id === id);
  await q(sb.from('so_artifacts').update(cambio(a)).eq('id', id));
  st.activoId = id;
  await cargarArtefactos();
  await senal('FranciscoArtifact', 'success', { op: 'update' }, id);
  return { texto: `${texto}\n#/a/${id}`, meta: { artifactId: id }, skills: ['FranciscoIntent', 'FranciscoArtifact'] };
}

async function agregarCampos(acc) {
  const a = st.artefactos.find((x) => x.id === acc.artefactoId);
  const ds = await q(sb.from('so_datasources').select('fields').eq('id', a.datasource_id).single());
  const nuevos = acc.campos.filter((c) => !ds.fields.some((f) => f.key === c.key));
  if (!nuevos.length) return { texto: `"${a.name}" ya tiene esos campos.`, meta: { artifactId: a.id } };
  const fields = [...ds.fields, ...nuevos];
  await q(sb.from('so_datasources').update({ fields, updated_at: new Date().toISOString() }).eq('id', a.datasource_id));
  return actualizarArtefacto(a.id, () => ({ schema: { ...a.schema, fields } }), `Agregué ${nuevos.map((c) => `"${c.label}"`).join(', ')} a "${a.name}".`);
}

async function conversar() {
  const { data, error } = await sb.functions.invoke('francisco', { body: { chatId: st.chatId } });
  if (!error) return { texto: data.reply, modelo: data.model, tokens: data.tokens, skills: ['FranciscoContext'], capacidades: ['llm'] };
  const status = error.context?.status;
  if (status === 503 || status === 404 || /Failed to send|FunctionsFetchError|not found/i.test(error.message || '')) {
    return { ok: false, texto: st.modo === 'work'
      ? 'Todavía no tengo conectado el modelo de lenguaje para conversar libremente. Lo que sí puedo hacer ya: crear dashboards ("creá un dashboard de ventas con histórico"), agregarles campos o gráficos, cargar datos, compartirlos y revocarlos.'
      : 'Todavía no tengo conectado el modelo de lenguaje, así que por ahora no puedo charlar libremente.' };
  }
  if (status === 429) return { ok: false, texto: 'Estoy con mucha demanda; probá de nuevo en un momento.' };
  return { ok: false, texto: 'No pude responder ahora (error del servicio). Probá de nuevo.' };
}

// ---------------------------------------------------------------- vista de artefacto
async function abrirArtefacto(id) {
  $('vistaChat').hidden = true; $('vistaArtefacto').hidden = false;
  st.activoId = id;
  pintarMenu();
  const a = st.artefactos.find((x) => x.id === id) || (await q(sb.from('so_artifacts').select('*').eq('id', id).maybeSingle()));
  if (!a || a.deleted_at) { $('artefacto').innerHTML = '<p class="vacio">Ese tablero no existe o fue eliminado.</p>'; return; }
  $('titulo').textContent = a.name;
  $('meta').textContent = `v${a.version} · ${a.state === 'published' ? 'publicado' : a.state}`;
  const [ds, recs] = await Promise.all([
    q(sb.from('so_datasources').select('fields').eq('id', a.datasource_id).single()),
    q(sb.from('so_records').select('id, period, data, created_at').eq('datasource_id', a.datasource_id).order('period').order('id').limit(5000)),
  ]);
  renderArtefacto($('artefacto'), { ...a, fields: ds.fields, records: recs, permission: 'OWNER' }, {
    onAdd: async (period, data) => {
      await q(sb.from('so_records').insert({ datasource_id: a.datasource_id, owner_id: st.user.id, period, data, idempotency_key: crypto.randomUUID() }));
      await senal('FranciscoData', 'success', { op: 'record', via: 'form' }, a.id);
      abrirArtefacto(id);
    },
  });
  pintarCompartidos(a);
  pintarVersiones(a);
}

async function pintarCompartidos(a) {
  const ss = await q(sb.from('so_shares').select('id, grantee_email, permission, created_at').eq('artifact_id', a.id).is('revoked_at', null).order('created_at'));
  $('linkCompartido').innerHTML = `Link para compartidos: <a href="${esc(BASE_SHARED + a.id)}">${esc(BASE_SHARED + a.id)}</a>`;
  $('listaCompartidos').innerHTML = ss.map((s) => `<li><span>${esc(s.grantee_email)} <span class="etiqueta">${esc(s.permission)}</span></span>
    <button type="button" data-revocar="${s.id}">Revocar</button></li>`).join('') || '<li class="vacio">No está compartido con nadie.</li>';
  $('listaCompartidos').querySelectorAll('[data-revocar]').forEach((b) => {
    b.onclick = async () => { b.disabled = true; try { await q(sb.rpc('so_revocar', { p_share: b.dataset.revocar })); } catch (e) { alert(e.message); } pintarCompartidos(a); };
  });
  $('formCompartir').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await q(sb.rpc('so_compartir', { p_artifact: a.id, p_email: String(fd.get('email')), p_permission: String(fd.get('permiso')) }));
      e.target.reset();
      await senal('FranciscoSecurity', 'success', { op: 'share', via: 'form' }, a.id);
    } catch (err) { alert(`No se pudo compartir: ${err.message}`); }
    pintarCompartidos(a);
  };
}

async function pintarVersiones(a) {
  const vs = await q(sb.from('so_artifact_versions').select('version, created_at').eq('artifact_id', a.id).order('version', { ascending: false }).limit(20));
  $('listaVersiones').innerHTML = vs.map((v) => `<li><span>v${v.version} · ${new Date(v.created_at).toLocaleString('es-AR')}</span>
    ${v.version === a.version ? '<span class="etiqueta">actual</span>' : `<button type="button" data-v="${v.version}">Restaurar</button>`}</li>`).join('');
  $('listaVersiones').querySelectorAll('[data-v]').forEach((b) => {
    b.onclick = async () => {
      try { await q(sb.rpc('so_restaurar_version', { p_artifact: a.id, p_version: Number(b.dataset.v) })); } catch (e) { alert(e.message); }
      await cargarArtefactos(); abrirArtefacto(a.id);
    };
  });
}

async function soloCompartidos() {
  document.querySelector('.modos').hidden = true; $('nuevoChat').hidden = true; $('vistaChat').hidden = true;
  $('listaChats').previousElementSibling.hidden = true; $('listaChats').hidden = true;
  $('menuWorkspace').previousElementSibling.hidden = true; $('menuWorkspace').hidden = true;
  $('titulo').textContent = 'Tableros compartidos conmigo';
  const compartidos = await q(sb.rpc('so_shared_list'));
  $('tituloCompartidos').hidden = false;
  $('menuCompartidos').innerHTML = compartidos.map((a) => `<a href="${esc(BASE_SHARED + a.id)}">📎 ${esc(a.name)}</a>`).join('')
    || '<span class="vacio">No tenés tableros compartidos.</span>';
}

// arranque: si no hay sesión, mostrar login
sb.auth.getSession().then(({ data }) => { if (!data.session) { $('login').hidden = false; } });
