// SO · UniversalInputService: recibe archivos de cualquier superficie (chat, tablero, compartido) y los lleva por
// receive → identify → validate → securityCheck → store → extract → normalize → classify → index → associate.
// El binario va a Supabase Storage (bucket privado, carpeta del usuario); metadatos y contenido, a PostgreSQL.
// Cada etapa queda registrada: un fallo se reintenta desde esa etapa sin volver a subir lo que ya se guardó.
import { identificar, validar, sanearNombre, LIMITES } from './tipos.js';
import { perfilar } from './perfil.js';
import { fragmentar, resumir } from './documentos.js';
import { detectarTabla, aMatriz } from '../supabase/functions/so-api/seguridad.js';

export const BUCKET = 'so-archivos';
const ESTADOS = { esperando: 'Esperando', subiendo: 'Subiendo', subido: 'Subido', procesando: 'Leyendo', listo: 'Listo', parcial: 'Listo con avisos',
  fallo: 'Falló', cancelado: 'Cancelado', rechazado: 'No aceptado' };
export const etiquetaEstado = (e) => ESTADOS[e] || e;

export async function sha256(blob) {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let worker = null; const pendientes = new Map();
function lector() {
  if (!worker) {
    worker = new Worker(new URL('./lector-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const p = pendientes.get(e.data.id);
      if (!p) return;
      if (e.data.progreso != null) return p.progreso?.(e.data.progreso);
      pendientes.delete(e.data.id);
      e.data.ok ? p.ok(e.data) : p.mal(new Error(e.data.error));
    };
    worker.onerror = (e) => { for (const p of pendientes.values()) p.mal(new Error(e.message || 'el lector falló')); pendientes.clear(); worker = null; };
  }
  return worker;
}
export function leerEnWorker(archivo, tipo, progreso) {
  const id = crypto.randomUUID();
  return new Promise((ok, mal) => { pendientes.set(id, { ok, mal, progreso }); lector().postMessage({ id, archivo, tipo }); });
}

// Normaliza la salida del lector: tablas con perfil, documento en fragmentos con referencia, JSON → tabla.
export function normalizar(r, info) {
  const out = { tablas: [], fragmentos: [], meta: { ...r.meta }, avisos: [...(r.avisos || [])] };
  let tablas = r.tablas || [];
  if (r.json !== undefined) {
    const t = detectarTabla(r.json);
    if (t.filas.length) tablas = [{ nombre: t.ruta || 'datos', filas: aMatriz(t.filas, 300000) }];
    out.meta.estructura = Array.isArray(r.json) ? `lista de ${r.json.length} elementos` : `objeto con ${Object.keys(r.json || {}).length} claves`;
  }
  for (const t of tablas) {
    if (!t.filas?.length) continue;
    const p = perfilar(t.filas);
    out.tablas.push({ nombre: t.nombre, perfil: p });
  }
  if (out.tablas.length) {
    out.meta.hojas = out.tablas.map((t) => ({ nombre: t.nombre, filas: t.perfil.filas, columnas: t.perfil.columnas.map((c) => ({ nombre: c.nombre, tipo: c.tipo })), problemas: t.perfil.problemas }));
    // También se indexa un texto corto por hoja (encabezados + primeras filas) para poder encontrar el archivo después.
    out.fragmentos = fragmentar(out.tablas.map((t) => ({ texto: [t.perfil.columnas.map((c) => c.nombre).join(' | '),
      ...t.perfil.datos.slice(0, 20).map((f) => f.map((x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x ?? '')).join(' | '))].join('\n'), ref: { hoja: t.nombre } })), 1500);
    const t0 = out.tablas[0];
    out.meta.resumen = `${out.tablas.length} ${out.tablas.length === 1 ? 'hoja' : 'hojas'}; ${t0.perfil.filas} filas; columnas: ${t0.perfil.columnas.map((c) => c.nombre).join(', ')}`.slice(0, 1000);
  } else if (r.bloques?.length) {
    out.fragmentos = fragmentar(r.bloques, 1500);
    const s = resumir(out.fragmentos);
    out.meta.resumen = [s.oraciones.join(' '), s.temas.length ? `Temas: ${s.temas.join(', ')}` : ''].filter(Boolean).join(' ').slice(0, 1000);
    out.meta.caracteres = s.caracteres;
  }
  if (info.kind === 'table' && !out.tablas.length) out.avisos.push('No encontré una tabla en el archivo.');
  return out;
}

async function miniatura(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const dims = { ancho: bmp.width, alto: bmp.height };
    bmp.close();
    return { url: c.toDataURL('image/jpeg', 0.8), ...dims };
  } catch { return null; }
}

/**
 * @param {{ sb: any, cfg: { url: string, anonKey: string }, contexto: () => object, onCambio: (item) => void, log?: Function }} op
 */
export function crearEntrada({ sb, cfg, contexto, onCambio, log = () => {} }) {
  const items = new Map();
  const subidas = [];
  const cambio = (it) => { onCambio?.(it); };

  async function registrar(it, stage, status, extra = {}) {
    log({ upload_id: it.id, file_id: it.fileId, stage, status, size: it.size, source_type: it.origen, retry: it.reintentos, ...extra });
  }

  async function agregar(files, origen = 'chat', asociar = {}) {
    const nuevos = [];
    for (const file of [...files].slice(0, LIMITES.archivosPorMensaje)) {
      const it = { id: crypto.randomUUID(), file, nombre: file.name || 'archivo', size: file.size, origen, asociar, estado: 'esperando', progreso: 0, reintentos: 0, avisos: [] };
      items.set(it.id, it); nuevos.push(it);
      // receive → identify → validate → securityCheck (antes de guardar nada)
      const cabecera = new Uint8Array(await file.slice(0, 4100).arrayBuffer());
      it.info = identificar(cabecera, it.nombre, file.type);
      it.avisos.push(...it.info.avisos);
      const motivo = validar(it.info, file.size);
      const ahora = Date.now();
      while (subidas.length && ahora - subidas[0] > 600000) subidas.shift();
      if (motivo) { it.estado = 'rechazado'; it.error = motivo; registrar(it, 'validate', 'rejected'); cambio(it); continue; }
      if (subidas.length >= LIMITES.subidasPor10Min) { it.estado = 'rechazado'; it.error = 'Subiste muchos archivos seguidos; esperá unos minutos.'; cambio(it); continue; }
      subidas.push(ahora);
      if (it.info.kind === 'image' && it.info.tipo !== 'heic' && it.info.tipo !== 'avif') it.miniatura = await miniatura(file);
      cambio(it);
      it.promesa = subir(it).then(() => procesar(it)).catch(() => {});
    }
    return nuevos;
  }

  // store: fila de metadatos + binario en Storage con progreso real y cancelación (XHR).
  async function subir(it) {
    it.estado = 'subiendo'; it.etapa = 'upload'; it.error = null; cambio(it);
    const t0 = performance.now();
    try {
      it.checksum ||= await sha256(it.file);
      const ctx = contexto();
      const { data: ses } = await sb.auth.getSession();
      const uid = ses.session.user.id;
      if (!it.fileId) {
        it.fileId = crypto.randomUUID();
        it.safe = sanearNombre(it.nombre);
        it.path = `${uid}/${it.fileId}/${it.safe}`;
        const { error } = await sb.from('so_files').insert({
          id: it.fileId, project_id: ctx.proyectoId ?? null, artifact_id: it.asociar.artifactId ?? null, chat_id: it.asociar.chatId ?? null,
          original_name: it.nombre.slice(0, 255), safe_name: it.safe, mime_type: it.file.type || null, detected_type: it.info.tipo, kind: it.info.kind,
          size: it.size, storage_path: it.path, checksum: it.checksum, status: 'uploading', source: it.origen,
          security: { firma: it.info.tipo, inconsistente: it.info.inconsistente, macros: it.avisos.some((a) => /macros/i.test(a)), antivirus: 'no disponible' },
          meta: { avisos: it.avisos }, retention: it.origen === 'chat' ? 'temporary' : 'active' });
        if (error) throw new Error(error.message);
      }
      await new Promise((ok, mal) => {
        const xhr = new XMLHttpRequest();
        it.xhr = xhr;
        xhr.open('POST', `${cfg.url}/storage/v1/object/${BUCKET}/${it.path.split('/').map(encodeURIComponent).join('/')}`);
        xhr.setRequestHeader('Authorization', `Bearer ${ses.session.access_token}`);
        xhr.setRequestHeader('apikey', cfg.anonKey);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.setRequestHeader('Content-Type', it.file.type && !/html|svg|javascript/.test(it.file.type) ? it.file.type : 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { it.progreso = e.loaded / e.total; cambio(it); } };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? ok() : mal(new Error(xhr.status === 413 ? 'el archivo supera el límite del almacenamiento' : `el almacenamiento respondió ${xhr.status}`)));
        xhr.onerror = () => mal(new Error('se cortó la conexión durante la subida'));
        xhr.onabort = () => mal(Object.assign(new Error('cancelado'), { cancelado: true }));
        xhr.send(it.file);
      });
      it.xhr = null; it.subido = true;
      await sb.from('so_files').update({ status: 'uploaded', stage_error: null }).eq('id', it.fileId);
      it.estado = 'subido'; it.progreso = 1; cambio(it);
      registrar(it, 'store', 'ok', { ms: Math.round(performance.now() - t0) });
    } catch (err) {
      it.xhr = null;
      it.estado = err.cancelado ? 'cancelado' : 'fallo'; it.error = err.cancelado ? 'Cancelaste la subida.' : `No se pudo subir: ${err.message}.`;
      if (it.fileId) sb.from('so_files').update({ status: 'failed', stage_error: { etapa: 'upload', mensaje: it.error } }).eq('id', it.fileId).then(() => {}, () => {});
      registrar(it, 'store', err.cancelado ? 'cancelled' : 'failed');
      cambio(it);
      throw err;
    }
  }

  // extract → normalize → classify → index → associate. Usa el archivo en memoria o, si no está, lo baja de Storage.
  async function procesar(it) {
    if (!it.info.interpretable) {
      it.estado = 'parcial'; it.avisos.push(`Lo guardé, pero no puedo leer el contenido de archivos ${it.info.tipo.toUpperCase()}.`);
      await sb.from('so_files').update({ status: 'ready', meta: { avisos: it.avisos } }).eq('id', it.fileId);
      cambio(it); return;
    }
    it.estado = 'procesando'; it.etapa = 'extract'; it.progreso = 0; cambio(it);
    const t0 = performance.now();
    try {
      await sb.from('so_files').update({ status: 'processing' }).eq('id', it.fileId);
      if (!it.file) {
        const { data, error } = await sb.storage.from(BUCKET).download(it.path);
        if (error) throw new Error('no pude recuperar el archivo guardado');
        it.file = new File([data], it.safe);
      }
      let norm;
      if (it.info.kind === 'image') {
        it.miniatura ||= it.info.tipo === 'heic' ? null : await miniatura(it.file);
        norm = { tablas: [], fragmentos: [], meta: { ancho: it.miniatura?.ancho, alto: it.miniatura?.alto, resumen: `Imagen ${it.info.tipo.toUpperCase()}${it.miniatura ? ` de ${it.miniatura.ancho}×${it.miniatura.alto}` : ''}` }, avisos: [] };
      } else {
        const r = await leerEnWorker(it.file, it.info.tipo, (p) => { it.progreso = p; cambio(it); });
        norm = normalizar(r.r, it.info);
      }
      it.normal = norm;
      it.avisos.push(...norm.avisos);
      it.etapa = 'index';
      for (let i = 0; i < norm.fragmentos.length; i += 100) {
        const lote = norm.fragmentos.slice(i, i + 100).map((f) => ({ file_id: it.fileId, ord: f.ord, ref: f.ref, content: f.content.slice(0, 8000) }));
        const { error } = await sb.from('so_file_chunks').upsert(lote, { onConflict: 'file_id,ord', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
      const meta = { ...norm.meta, avisos: it.avisos };
      const estado = it.avisos.length ? 'partial' : 'ready';
      const { error } = await sb.from('so_files').update({ status: estado, meta, stage_error: null }).eq('id', it.fileId);
      if (error) throw new Error(error.message);
      it.estado = it.avisos.length ? 'parcial' : 'listo'; it.progreso = 1;
      registrar(it, 'process', 'ok', { ms: Math.round(performance.now() - t0), rows: norm.tablas[0]?.perfil.filas ?? null });
      cambio(it);
    } catch (err) {
      it.estado = 'fallo'; it.error = `No pude leer el archivo: ${err.message}. El archivo quedó guardado; podés reintentar sin volver a subirlo.`;
      await sb.from('so_files').update({ status: 'failed', stage_error: { etapa: it.etapa, mensaje: err.message } }).eq('id', it.fileId).then(() => {}, () => {});
      registrar(it, 'process', 'failed', { ms: Math.round(performance.now() - t0) });
      cambio(it);
    }
  }

  async function reintentar(id) {
    const it = items.get(id);
    if (!it || !['fallo', 'cancelado'].includes(it.estado)) return;
    it.reintentos++;
    it.promesa = (it.subido ? Promise.resolve() : subir(it)).then(() => procesar(it)).catch(() => {});
    return it.promesa;
  }
  function cancelar(id) { const it = items.get(id); it?.xhr?.abort(); }
  function quitar(id) { const it = items.get(id); it?.xhr?.abort(); items.delete(id); }

  // Tabla normalizada de un archivo ya procesado (de memoria, o re-leída desde Storage si se recargó la página).
  async function tablaDe(fileId) {
    for (const it of items.values()) if (it.fileId === fileId && it.normal) return { item: it, tabla: it.normal.tablas[0] || null, normal: it.normal };
    const { data: f } = await sb.from('so_files').select('*').eq('id', fileId).single();
    const it = { id: crypto.randomUUID(), fileId, path: f.storage_path, safe: f.safe_name, nombre: f.original_name, size: f.size, checksum: f.checksum, origen: f.source,
      info: identificar(new Uint8Array(), f.original_name), subido: true, avisos: [], asociar: {}, reintentos: 0, estado: 'subido' };
    it.info = { ...it.info, tipo: f.detected_type, kind: f.kind, interpretable: true };
    items.set(it.id, it);
    await procesar(it);
    if (!it.normal) throw new Error(it.error || 'no pude leer el archivo');
    return { item: it, tabla: it.normal.tablas[0] || null, normal: it.normal };
  }

  return { agregar, reintentar, cancelar, quitar, tablaDe, items };
}
