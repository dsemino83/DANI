import { renderArtefacto } from '../vista.js';
import { crearEstado } from '../estado.js';

const cfg = window.SO_SUPABASE;
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// /so/shared/<id> (vía 404.html), /so/shared/#<id> o /so/shared/?a=<id>
const id = (location.hash.match(UUID) || new URLSearchParams(location.search).get('a')?.match(UUID) || location.pathname.match(UUID) || [])[0];
const PERMISOS = { VIEW: 'Podés verlo, sin cargar datos ni modificarlo', USE: 'Podés verlo y cargar datos, sin modificarlo', EDIT: 'Podés verlo, cargar datos y modificarlo', OWNER: 'Es tuyo' };
const E = crearEstado({ artefactoId: id });
let datos = null;

$('formLogin').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email')), password: String(fd.get('password')) });
  $('errorLogin').hidden = !error;
  if (error) $('errorLogin').textContent = 'No se pudo entrar: revisá correo y contraseña.';
};
$('salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };

function pintar() {
  renderArtefacto($('artefacto'), { ...datos, configuration: datos.view }, {
    estado: E.get(),
    onEstado: (c) => E.set(c),
    frescura: { cargado: datos.cargado, ultimo: datos.records.reduce((m, r) => (r.created_at > m ? r.created_at : m), '') || null },
    onActualizar: cargar,
    onAdd: async (period, registro) => {
      const r = await sb.rpc('so_shared_add_record', { p_artifact: id, p_period: period, p_data: registro, p_key: crypto.randomUUID() });
      if (r.error) throw new Error(/permiso/i.test(r.error.message) ? 'no tenés permiso para cargar datos' : r.error.message);
      await cargar();
    },
  });
}
E.sub(() => { if (datos) pintar(); });

async function cargar() {
  $('login').hidden = true; $('vista').hidden = false;
  if (!id) { $('artefacto').innerHTML = '<p class="vacio">Falta el identificador del tablero en el link.</p>'; return; }
  const { data, error } = await sb.rpc('so_shared_get', { p_artifact: id });
  if (error) {
    const red = /fetch|network/i.test(error.message || '');
    $('titulo').textContent = red ? 'Sin conexión' : 'Sin acceso';
    $('artefacto').innerHTML = red
      ? `<div class="tarjeta alerta" role="alert"><p><strong>No pude cargar el tablero.</strong></p><button type="button" class="primario" id="reintentar">Reintentar</button>${datos ? ' <button type="button" id="seguir">Seguir usando los últimos datos</button>' : ''}</div>`
      : '<p class="vacio">Este tablero no existe, no está compartido con tu correo o el acceso fue revocado.</p>';
    $('reintentar')?.addEventListener('click', cargar);
    $('seguir')?.addEventListener('click', pintar);
    return;
  }
  datos = { ...data, cargado: new Date().toISOString() };
  $('titulo').textContent = data.name;
  $('meta').textContent = `v${data.version} · ${PERMISOS[data.permission] || data.permission}`;
  pintar();
}

let iniciado = false;
sb.auth.onAuthStateChange((_e, session) => { if (session && !iniciado) { iniciado = true; cargar(); } });
sb.auth.getSession().then(({ data }) => { if (!data.session) $('login').hidden = false; });
