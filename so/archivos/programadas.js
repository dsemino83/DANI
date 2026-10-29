// SO · Automatizaciones programadas por calendario ("cada lunes a las 9 generá el PDF de ventas").
// Puro y sin DOM: lo usan el navegador (crear la automatización, mostrar la próxima ejecución) y la Edge Function
// so-automatizaciones (ejecutarla en el servidor aunque SO esté cerrado). La hora se interpreta en la zona horaria
// del usuario; la próxima ejecución se calcula siempre con la misma función en los dos lados.
import { generar, validarArchivo, FORMATOS, tablaCsv } from './generar.js';
import { docDeDatos } from './doc.js';
import { sanearNombre } from '../ingesta/tipos.js';

export const TZ_POR_DEFECTO = 'America/Argentina/Buenos_Aires';
const DIAS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const NOMBRE_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Formatos que el servidor genera (las imágenes necesitan el Canvas del navegador).
export const FORMATOS_SERVIDOR = ['pdf', 'xlsx', 'csv', 'docx', 'pptx', 'json', 'xml', 'rtf', 'md', 'txt'];

/**
 * "cada lunes a las 9", "todos los días a las 8:30", "de lunes a viernes", "el 1 de cada mes", "el último día de cada mes".
 * @returns {{ tipo: 'diaria'|'semanal'|'mensual', dias?: number[], dia?: number|'ultimo', hora: string, tz: string } | null}
 */
export function interpretarHorario(texto, { tz = TZ_POR_DEFECTO } = {}) {
  const n = norm(texto);
  const hm = n.match(/\ba\s+las?\s+(\d{1,2})(?:[:.](\d{2}))?\s*(hs|h|am|pm)?\b/) || n.match(/\b(\d{1,2})[:.](\d{2})\s*(hs|h)?\b/);
  let hh = hm ? Number(hm[1]) : 9; const mm = hm?.[2] ? Number(hm[2]) : 0;
  if (hm?.[3] === 'pm' && hh < 12) hh += 12;
  if (hm?.[3] === 'am' && hh === 12) hh = 0;
  if (/\bde la (tarde|noche)\b/.test(n) && hh < 12) hh += 12;
  if (hh > 23 || mm > 59) return null;
  const hora = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  if (/\b(cada|todos los|todas las)\s+mes(es)?\b|\bmensual|\bde cada mes\b|\bpor mes\b/.test(n)) {
    if (/\bultimo dia\b/.test(n)) return { tipo: 'mensual', dia: 'ultimo', hora, tz };
    const d = n.match(/\b(?:el|los)\s+(?:dia\s+)?(\d{1,2})\b(?!\s*(?:hs|h|:))/);
    const dia = d ? Number(d[1]) : 1;
    return dia >= 1 && dia <= 31 ? { tipo: 'mensual', dia, hora, tz } : null;
  }
  if (/\bde lunes a viernes\b|\bdias? habiles?\b|\bentre semana\b/.test(n)) return { tipo: 'semanal', dias: [1, 2, 3, 4, 5], hora, tz };
  const dias = Object.entries(DIAS).filter(([k]) => new RegExp(`\\b${k}s?\\b`).test(n)).map(([, v]) => v);
  if (dias.length) return { tipo: 'semanal', dias: [...new Set(dias)].sort(), hora, tz };
  if (/\b(cada|todos los|todas las)\s+(dia|dias|manana|mananas)\b|\bdiari[ao]\b|\btodos los dias\b/.test(n)) return { tipo: 'diaria', hora, tz };
  if (/\b(cada|todas las)\s+semanas?\b|\bsemanal/.test(n)) return { tipo: 'semanal', dias: [1], hora, tz };
  return null;
}

export function describirHorario(h) {
  if (!h) return '';
  const a = `a las ${h.hora}`;
  if (h.tipo === 'diaria') return `todos los días ${a}`;
  if (h.tipo === 'mensual') return `${h.dia === 'ultimo' ? 'el último día' : `el día ${h.dia}`} de cada mes ${a}`;
  const d = h.dias || [];
  if (d.join() === '1,2,3,4,5') return `de lunes a viernes ${a}`;
  return `cada ${d.length > 1 ? `${d.slice(0, -1).map((x) => NOMBRE_DIA[x]).join(', ')} y ${NOMBRE_DIA[d.at(-1)]}` : NOMBRE_DIA[d[0]]} ${a}`;
}

// Partes de una fecha en una zona horaria (sin librerías: Intl).
function partes(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return p;
}
// Hora local (y, m, d, hh, mm) en tz → instante UTC. Dos pasadas para resolver el cambio de horario.
function utcDeLocal(y, m, d, hh, mm, tz) {
  const ingenuo = Date.UTC(y, m - 1, d, hh, mm);
  const desfase = (t) => { const p = partes(t, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t; };
  let t = ingenuo - desfase(ingenuo);
  t = ingenuo - desfase(t);
  return t;
}

/** Próxima ejecución estrictamente posterior a `desde`. */
export function proximaEjecucion(h, desde = new Date()) {
  const tz = h.tz || TZ_POR_DEFECTO;
  const [hh, mm] = h.hora.split(':').map(Number);
  const hoy = partes(desde.getTime(), tz);
  for (let k = 0; k <= 400; k++) {
    const f = new Date(Date.UTC(hoy.year, hoy.month - 1, hoy.day + k));
    const y = f.getUTCFullYear(), m = f.getUTCMonth() + 1, d = f.getUTCDate(), dow = f.getUTCDay() || 7;
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toca = h.tipo === 'diaria' || (h.tipo === 'semanal' && (h.dias || []).includes(dow))
      || (h.tipo === 'mensual' && (h.dia === 'ultimo' ? d === ultimo : d === Math.min(Number(h.dia), ultimo)));
    if (!toca) continue;
    const t = utcDeLocal(y, m, d, hh, mm, tz);
    if (t > desde.getTime()) return new Date(t);
  }
  return null;
}

async function sha256(bytes) {
  const b = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };

// Registros activos del tablero, paginados (PostgREST devuelve como máximo 1000 filas por pedido).
async function registros(db, dsId, owner) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const lote = await q(db.from('so_records').select('period, data').eq('datasource_id', dsId).eq('owner_id', owner).is('superseded_by', null).order('period').order('id').range(desde, desde + 999));
    out.push(...lote);
    if (lote.length < 1000 || out.length >= 200000) return out;
  }
}

/**
 * Ejecuta una automatización programada con un cliente del servidor (service role). La autorización NO viene de
 * RLS: se fija explícitamente al dueño de la automatización en cada consulta y en la ruta de Storage, y se exige
 * que el dueño siga habilitado. Idempotente por (automatización, horario): una ejecución por turno.
 * @returns {Promise<{ estado: 'ok'|'fallo'|'repetida', archivos?: object[], error?: string }>}
 */
export async function ejecutarProgramada({ db, auto, slot, libs = {}, ahora = new Date(), bucket = 'so-archivos' }) {
  const owner = auto.owner_id;
  const pasos = auto.action?.pasos || [];
  const { data: tarea, error: dup } = await db.from('so_tasks').insert({ owner_id: owner, kind: 'automation', name: auto.name, status: 'running', artifact_id: auto.artifact_id,
    idempotency_key: `sched:${auto.id}:${slot}`, input: { slot, pasos, programada: true } }).select('id').single();
  if (dup) {
    if (dup.code === '23505' || /duplicate|unique|idempotency/i.test(dup.message)) return { estado: 'repetida' };   // ese turno ya se ejecutó
    throw new Error(dup.message);
  }
  const archivos = [];
  let a = null;
  try {
    if (!(await q(db.rpc('so_usuario_habilitado', { p_user: owner })))) throw new Error('el usuario ya no está habilitado en SO');
    a = await q(db.from('so_artifacts').select('*').eq('id', auto.artifact_id).eq('owner_id', owner).is('deleted_at', null).maybeSingle());
    if (!a) throw new Error('el tablero ya no existe');
    if (!a.datasource_id) throw new Error('el tablero no tiene datos guardados');
    const ds = await q(db.from('so_datasources').select('fields').eq('id', a.datasource_id).eq('owner_id', owner).maybeSingle());
    const datos = { fields: ds?.fields || [], records: await registros(db, a.datasource_id, owner) };
    const fecha = ahora.toLocaleDateString('es-AR', { timeZone: auto.schedule?.tz || TZ_POR_DEFECTO }).replace(/\//g, '-');
    for (const formato of pasos.filter((p) => FORMATOS[p])) {
      if (!FORMATOS_SERVIDOR.includes(formato)) throw new Error(`el servidor no genera ${FORMATOS[formato].etiqueta} (necesita el navegador)`);
      const { doc, registros: n } = docDeDatos(a, datos, {}, { formato, hoy: ahora });
      doc.titulo = `${a.name} ${fecha}`;
      const g = await generar(doc, formato, libs);
      const filasEsperadas = formato === 'xlsx' ? doc.secciones.filter((s) => s.tabla).reduce((s, x) => s + x.tabla.filas.length, 0) : formato === 'csv' ? tablaCsv(doc)?.tabla.filas.length ?? null : null;
      const v = validarArchivo(g.bytes, formato, { filasEsperadas, XLSX: libs.XLSX });
      if (!v.ok) throw new Error(`el ${FORMATOS[formato].etiqueta} no pasó la validación: ${v.detalle}`);
      const id = crypto.randomUUID(), safe = sanearNombre(g.nombre), path = `${owner}/${id}/${safe}`;
      await q(db.from('so_files').insert({ id, owner_id: owner, project_id: a.project_id, artifact_id: a.id, original_name: g.nombre, safe_name: safe, mime_type: g.mime, detected_type: formato,
        kind: g.kind, size: g.bytes.length, storage_path: path, checksum: await sha256(g.bytes), status: 'uploading', source: 'dashboard', origin: 'generated', retention: 'active', expires_at: null,
        security: { generado: true, macros: false, antivirus: 'no aplica: archivo generado por SO' },
        meta: { descripcion: `${auto.name} · ${n} registros`, validacion: v.detalle, automatizacion: auto.id, programada: slot, generado_at: ahora.toISOString() } }));
      try {
        const up = await db.storage.from(bucket).upload(path, g.bytes, { contentType: g.mime, upsert: false });
        if (up.error) throw new Error(`el almacenamiento respondió: ${up.error.message}`);
        const bajado = await db.storage.from(bucket).download(path);
        if (bajado.error) throw new Error('no pude leer el archivo guardado');
        const b = new Uint8Array(await bajado.data.arrayBuffer());
        if (b.length !== g.bytes.length || (await sha256(b)) !== (await sha256(g.bytes))) throw new Error('el archivo guardado no coincide con el generado');
      } catch (err) {
        await db.from('so_files').update({ status: 'failed', stage_error: { etapa: 'store', mensaje: err.message } }).eq('id', id).eq('owner_id', owner);
        throw err;
      }
      await q(db.from('so_files').update({ status: 'ready' }).eq('id', id).eq('owner_id', owner).select('id'));
      archivos.push({ id, nombre: g.nombre, formato, validacion: v.detalle });
    }
    const resumen = archivos.length ? archivos.map((f) => f.nombre).join(', ') : 'sin archivos';
    await q(db.from('so_tasks').update({ status: 'completed', progress: 1, result: { archivos: archivos.map((f) => f.id), slot } }).eq('id', tarea.id).eq('owner_id', owner).select('id'));
    await db.from('so_notifications').insert({ owner_id: owner, priority: 'success', title: `${a.name}: ${auto.name}`.slice(0, 200), body: `Generado ${describirHorario(auto.schedule)}: ${resumen}.`.slice(0, 2000), artifact_id: a.id, task_id: tarea.id, group_key: `auto:${auto.id}` });
    return { estado: 'ok', archivos };
  } catch (err) {
    await db.from('so_tasks').update({ status: 'failed', error: String(err.message).slice(0, 500), needs_action: 'La automatización programada falló; revisá el tablero o generá el archivo a mano.' }).eq('id', tarea.id).eq('owner_id', owner);
    await db.from('so_notifications').insert({ owner_id: owner, priority: 'action', title: `${a?.name || 'Automatización'}: no se pudo ejecutar`.slice(0, 200), body: String(err.message).slice(0, 2000), artifact_id: a?.id ?? null, task_id: tarea.id, group_key: `auto:${auto.id}` });
    return { estado: 'fallo', error: err.message, archivos };
  }
}

// Autoprueba del ejecutor (la usa la Edge Function con token): documento fijo → cada formato del servidor. Los formatos
// de texto son deterministas (huella SHA-256 comparable con el repositorio); los binarios llevan fecha y se validan.
export async function autoprueba(libs = {}) {
  const doc = { titulo: 'Autoprueba SO ñ', subtitulo: 'Documento fijo', secciones: [
    { titulo: 'Resumen', metricas: [{ label: 'Total', valor: 1570.5, delta: -0.3174 }], parrafos: ['Texto con {llaves}, <signos> & "comillas".'] },
    { titulo: 'Detalle', tabla: { columnas: [{ label: 'Mes', type: 'text' }, { label: 'Monto', type: 'number' }], filas: [['Ago', 2300], ['Sep', 1570.5]] } }] };
  const out = { proxima: proximaEjecucion({ tipo: 'semanal', dias: [1], hora: '09:00', tz: TZ_POR_DEFECTO }, new Date('2026-10-29T15:00:00Z')).toISOString(), formatos: {} };
  for (const f of FORMATOS_SERVIDOR) {
    try {
      const g = await generar(doc, f, libs);
      const v = validarArchivo(g.bytes, f, { XLSX: libs.XLSX, filasEsperadas: f === 'xlsx' ? 2 : f === 'csv' ? 2 : null });
      out.formatos[f] = { ok: v.ok, detalle: v.detalle, bytes: g.bytes.length, ...(['csv', 'rtf', 'md', 'txt'].includes(f) ? { sha256: await sha256(g.bytes) } : {}) };
    } catch (e) { out.formatos[f] = { ok: false, detalle: e.message }; }
  }
  return out;
}
