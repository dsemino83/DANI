import { renderArtefacto } from '../vista.js';
import { crearEstado } from '../estado.js';
import { identificar, validar } from '../ingesta/tipos.js';
import { leerEnWorker, normalizar, sha256 } from '../ingesta/entrada.js';
import { mapear, convertir } from '../ingesta/mapeo.js';

const cfg = window.SO_SUPABASE;
const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// /so/shared/<id> (vía 404.html), /so/shared/#<id> o /so/shared/?a=<id>
const id = (location.hash.match(UUID) || new URLSearchParams(location.search).get('a')?.match(UUID) || location.pathname.match(UUID) || [])[0];
const PERMISOS = { VIEW: 'Podés verlo, sin cargar datos ni modificarlo', USE: 'Podés usarlo, sin modificarlo', EDIT: 'Podés verlo, cargar datos y modificarlo', OWNER: 'Es tuyo' };
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
    puedeCargar: !!datos.puede_cargar,
    onImportar: datos.puede_cargar ? importarArchivo : null,
    onAdd: async (period, registro) => {
      const r = await sb.rpc('so_shared_add_record', { p_artifact: id, p_period: period, p_data: registro, p_key: crypto.randomUUID() });
      if (r.error) throw new Error(/permiso/i.test(r.error.message) ? 'no tenés permiso para cargar datos' : r.error.message);
      await cargar();
    },
  });
}
E.sub(() => { if (datos) pintar(); });

// Importación desde el tablero compartido: siempre suma (APPEND), filas inválidas a revisión, archivo repetido detectado.
async function importarArchivo(file, forzar = false) {
  const aviso = (t) => { $('estadoImport').textContent = t; };
  if (!$('estadoImport')) $('artefacto').insertAdjacentHTML('afterbegin', '<p class="tarjeta" id="estadoImport" role="status"></p>');
  const info = identificar(new Uint8Array(await file.slice(0, 4100).arrayBuffer()), file.name, file.type);
  const motivo = validar(info, file.size);
  if (motivo) return aviso(motivo);
  if (info.kind !== 'table') return aviso('Para cargar datos necesito una planilla (CSV, Excel, ODS, JSON o XML con una tabla).');
  aviso(`Leyendo ${file.name}…`);
  try {
    const norm = normalizar((await leerEnWorker(file, info.tipo, (p) => aviso(`Leyendo ${file.name}… ${Math.round(p * 100)}%`))).r, info);
    const t = norm.tablas[0];
    if (!t) return aviso('No encontré una tabla en el archivo.');
    const m = mapear(t.perfil.columnas.filter((c) => c.key !== t.perfil.columnaFecha), datos.fields);
    if (!m.inequivoco) return aviso(m.pregunta || 'Las columnas no coinciden con las del tablero; pedile al dueño que lo importe.');
    const { validas, rechazadas } = convertir(t.perfil, m.asignaciones, datos.fields);
    const checksum = await sha256(file);
    const lote = crypto.randomUUID();
    let r = null;
    for (let i = 0; i < Math.max(1, validas.length); i += 1000) {
      const final = i + 1000 >= validas.length;
      const { data, error } = await sb.rpc('so_shared_importar', { p_artifact: id, p_lote: lote, p_nombre: file.name, p_checksum: checksum,
        p_filas: validas.slice(i, i + 1000), p_rechazadas: i === 0 ? rechazadas.slice(0, 500) : [], p_final: final, p_forzar: forzar });
      if (error) throw new Error(/permiso/i.test(error.message) ? 'no tenés permiso para cargar datos' : error.message);
      if (data.duplicado) {
        $('estadoImport').innerHTML = 'Este archivo parece haber sido importado anteriormente. <button type="button" id="importarIgual">Importar igual</button>';
        $('importarIgual').onclick = () => importarArchivo(file, true);
        return;
      }
      r = data;
      aviso(`Importando… ${Math.round(Math.min(1, (i + 1000) / Math.max(1, validas.length)) * 100)}%`);
    }
    await cargar();
    if (!$('estadoImport')) $('artefacto').insertAdjacentHTML('afterbegin', '<p class="tarjeta" id="estadoImport" role="status"></p>');
    aviso(`${file.name}: ${r.aceptadas} registros incorporados${r.rechazadas ? `, ${r.rechazadas} necesitan revisión (el dueño ve el detalle)` : ''}. Tablero actualizado.`);
  } catch (err) { aviso(`No pude importar: ${err.message}.`); }
}

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
  $('meta').textContent = `v${data.version} · ${data.permission === 'USE' && data.puede_cargar ? 'Podés verlo y cargar datos, sin modificarlo' : PERMISOS[data.permission] || data.permission}`;
  pintar();
}

let iniciado = false;
sb.auth.onAuthStateChange((_e, session) => { if (session && !iniciado) { iniciado = true; cargar(); } });
sb.auth.getSession().then(({ data }) => { if (!data.session) $('login').hidden = false; });
