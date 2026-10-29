import { renderArtefacto } from '../vista.js';

const cfg = window.SO_SUPABASE;
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// /so/shared/<id> (vía 404.html), /so/shared/#<id> o /so/shared/?a=<id>
const id = (location.hash.match(UUID) || new URLSearchParams(location.search).get('a')?.match(UUID) || location.pathname.match(UUID) || [])[0];
const PERMISOS = { OWNER: 'dueño', EDIT: 'puede editar', USE: 'puede ver y cargar datos', VIEW: 'solo lectura' };

$('formLogin').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email')), password: String(fd.get('password')) });
  $('errorLogin').hidden = !error;
  if (error) $('errorLogin').textContent = 'No se pudo entrar: revisá correo y contraseña.';
};
$('salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function cargar() {
  $('login').hidden = true; $('vista').hidden = false;
  if (!id) { $('artefacto').innerHTML = '<p class="vacio">Falta el identificador del tablero en el link.</p>'; return; }
  const { data, error } = await sb.rpc('so_shared_get', { p_artifact: id });
  if (error) {
    $('titulo').textContent = 'Sin acceso';
    $('artefacto').innerHTML = '<p class="vacio">Este tablero no existe, no está compartido con tu correo o el acceso fue revocado.</p>';
    return;
  }
  $('titulo').textContent = data.name;
  $('meta').textContent = `v${data.version} · ${PERMISOS[data.permission] || data.permission}`;
  renderArtefacto($('artefacto'), { ...data, configuration: data.view }, {
    onAdd: async (period, registro) => {
      const r = await sb.rpc('so_shared_add_record', { p_artifact: id, p_period: period, p_data: registro, p_key: crypto.randomUUID() });
      if (r.error) throw new Error(/permiso/i.test(r.error.message) ? 'No tenés permiso para cargar datos.' : r.error.message);
      cargar();
    },
  });
}

let iniciado = false;
sb.auth.onAuthStateChange((_e, session) => { if (session && !iniciado) { iniciado = true; cargar(); } });
sb.auth.getSession().then(({ data }) => { if (!data.session) $('login').hidden = false; });
