// SO · GeneratedFileService + operaciones sobre archivos (en el navegador, con la sesión del usuario y RLS):
// request → generate → validate → store → register → permission → verify download → attach.
// También: versiones (editar nunca sobrescribe), restaurar, comparar, consolidar, plantillas y automatizaciones de
// archivos. Nada se informa como hecho sin verificarlo (estructura del archivo + descarga real desde Storage).
import { generar, validarArchivo, FORMATOS, nombreArchivo } from './generar.js';
import { compararTablas, compararTextos, interpretarEdicion, aplicarEdicion, consolidar } from './tablas.js';
import { sanearNombre } from '../ingesta/tipos.js';
import { sha256, BUCKET } from '../ingesta/entrada.js';
import { kpis, porMes } from '../vista.js';
import { nombreMes, insights, comparar, filtrar as filtrarVista } from '../analisis.js';
import { tamano } from '../genui.js';

const VENDOR = new URL('../../valo/vendor/', import.meta.url).href;
const cargados = new Map();
function script(nombre) {
  if (!cargados.has(nombre)) cargados.set(nombre, new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = VENDOR + nombre; s.onload = ok; s.onerror = () => { cargados.delete(nombre); mal(new Error(`no pude cargar ${nombre}`)); };
    document.head.append(s);
  }));
  return cargados.get(nombre);
}
async function libs(formato) {
  if (formato === 'xlsx') { await script('exceljs.min.js'); await script('xlsx.full.min.js'); return { ExcelJS: window.ExcelJS, XLSX: window.XLSX }; }
  if (formato === 'pdf') { await script('jspdf.umd.min.js'); await script('jspdf.plugin.autotable.min.js'); return { jsPDF: window.jspdf.jsPDF }; }
  return {};
}

// Perfil de una tabla leída (ingesta) → Tabla { columnas, filas } con fechas ISO.
export function tablaDePerfil(p) {
  return { columnas: p.columnas.map((c) => ({ key: c.key, label: c.nombre, type: c.tipo })),
    filas: p.datos.map((f) => p.columnas.map((c) => { const v = f[c.indice]; return v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null; })) };
}

/**
 * @param {{ sb, cfg, st, E, q, D, notificar, evento, artefacto, datosDe }} x
 */
export function crearArchivos(x) {
  const { sb, cfg, st, E, q, D } = x;
  const obs = (op, extra) => sb.from('so_ingest_log').insert({ stage: `generated:${op}`, status: extra.status || 'ok', size: extra.size ?? null, source_type: 'generated', file_id: extra.fileId ?? null, ms: extra.ms ?? null }).then(() => {}, () => {});

  async function subirBytes(path, bytes, mime) {
    const { data: ses } = await sb.auth.getSession();
    const r = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', body: new Blob([bytes], { type: mime }),
      headers: { Authorization: `Bearer ${ses.session.access_token}`, apikey: cfg.anonKey, 'x-upsert': 'false', 'Content-Type': /html|svg|javascript/.test(mime) ? 'application/octet-stream' : mime } });
    if (!r.ok) throw new Error(`el almacenamiento respondió ${r.status}`);
  }

  // Descarga verificada: URL firmada temporal (la crea Storage solo si RLS lo permite) y se comparan los bytes.
  async function verificarDescarga(path, bytes) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw new Error('no pude crear un enlace de descarga autorizado');
    const r = await fetch(data.signedUrl);
    if (!r.ok) throw new Error(`la descarga respondió ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length !== bytes.length || b.subarray(0, 16).some((v, i) => v !== bytes[i])) throw new Error('el archivo descargado no coincide con el generado');
    return true;
  }

  /**
   * Guarda un archivo generado/exportado: valida → Storage privado → so_files → verificación de descarga.
   * @returns {Promise<object>} fila de so_files + validacion
   */
  async function guardar({ bytes, nombre, mime, kind, formato, origin = 'generated', artifactId = null, descripcion = null, parent = null, cambio = null, filasEsperadas = null, coleccion = null }) {
    const t0 = performance.now();
    const XLSX = formato === 'xlsx' ? (await libs('xlsx')).XLSX : null;
    const v = validarArchivo(bytes, formato, { filasEsperadas, XLSX });
    if (!v.ok) { obs('validate', { status: 'failed', size: bytes.length }); throw new Error(`el archivo no pasó la validación: ${v.detalle}`); }
    const { data: ses } = await sb.auth.getSession();
    const id = crypto.randomUUID(), safe = sanearNombre(nombre), path = `${ses.session.user.id}/${id}/${safe}`;
    const checksum = await sha256(new Blob([bytes]));
    const fila = { id, project_id: E.get().proyectoId ?? null, artifact_id: artifactId, chat_id: st.chatId ?? null, original_name: nombre.slice(0, 255), safe_name: safe,
      mime_type: mime, detected_type: formato, kind, size: bytes.length, storage_path: path, checksum, status: 'uploading', source: artifactId ? 'dashboard' : 'chat', origin,
      security: { generado: true, macros: false, antivirus: 'no aplica: archivo generado por SO' }, retention: 'active', expires_at: null, change_summary: cambio, collection: coleccion,
      meta: { descripcion, validacion: v.detalle, parent: parent?.id || null, generado_at: new Date().toISOString() } };
    if (parent) Object.assign(fila, { version_of: parent.id, version: (parent.version || 1) + 1 });
    await q(sb.from('so_files').insert(fila));
    try {
      await subirBytes(path, bytes, mime);
      await verificarDescarga(path, bytes);
    } catch (err) {
      await sb.from('so_files').update({ status: 'failed', stage_error: { etapa: 'store', mensaje: err.message } }).eq('id', id);
      obs('store', { status: 'failed', size: bytes.length, fileId: id });
      throw err;
    }
    const [f] = await q(sb.from('so_files').update({ status: 'ready' }).eq('id', id).select('*'));
    obs('store', { size: bytes.length, fileId: id, ms: Math.round(performance.now() - t0) });
    return { ...(f || fila), status: 'ready', validacion: v.detalle };
  }

  async function generarYGuardar(doc, formato, opciones = {}) {
    const g = await generar(doc, formato, await libs(formato));
    const filas = ['xlsx', 'csv'].includes(formato) ? (doc.secciones || []).filter((s) => s.tabla).reduce((s, x) => s + (formato === 'csv' ? 0 : x.tabla.filas.length), 0) : null;
    const filasCsv = formato === 'csv' ? (doc.secciones || []).find((s) => s.tabla)?.tabla.filas.length ?? null : null;
    return guardar({ ...g, ...opciones, filasEsperadas: formato === 'csv' ? filasCsv : filas });
  }

  // Tarjeta del archivo (GeneratedFileCard) como spec de Generative UI: nunca rutas internas.
  const spec = (f, descripcion) => ({ type: 'File', props: { fileId: f.id, nombre: f.original_name, tipo: f.detected_type, tamano: f.size, version: f.version, estado: 'Verificado', descripcion: descripcion || f.change_summary || f.meta?.descripcion || null } });
  const resultado = (f, texto, extra = {}) => ({ texto, meta: { estado: 'verificado', ui: [spec(f)], archivo: f.id, porque: `Comprobé la estructura (${f.validacion || f.meta?.validacion}) y que la descarga autorizada devuelve exactamente el archivo generado.`, ...extra }, skills: ['FranciscoFiles'], capacidades: ['storage'] });

  // ------------------------------------------------------------------ contenido: artefacto / tabla → DocSpec
  async function docDeArtefacto(a, { formato } = {}) {
    const d = await x.datosDe(a.id);
    const s = E.get().artefactoId === a.id ? E.get() : {};
    const recs = filtrarVista(d.records, s);
    const num = d.fields.find((f) => f.key === a.configuration?.metrica) || d.fields.find((f) => f.type === 'number');
    const cat = d.fields.filter((f) => f.type === 'text').map((f) => ({ f, n: new Set(d.records.map((r) => r.data?.[f.key]).filter(Boolean)).size })).filter((z) => z.n >= 2 && z.n <= 20).sort((p, r) => p.n - r.n)[0]?.f || null;
    const contexto = [s.filtro ? `solo ${s.filtro.label || s.filtro.key}: ${s.filtro.valor}` : '', s.desde ? `desde ${nombreMes(s.desde)}` : '', s.hasta && s.hasta !== s.desde ? `hasta ${nombreMes(s.hasta)}` : ''].filter(Boolean).join(' · ');
    const secciones = [];
    if (num) {
      const k = kpis(recs, num.key);
      const ins = insights(d.records.filter((r) => !s.filtro || String(r.data?.[s.filtro.key] ?? '').toLowerCase() === String(s.filtro.valor).toLowerCase()), num, cat, s, new Date().toISOString().slice(0, 10), 2);
      secciones.push({ titulo: 'Resumen', metricas: [{ label: `Total ${num.label}`, valor: k.total }, ...(k.ultimoMes ? [{ label: `${num.label} ${nombreMes(k.ultimoMes.mes)}`, valor: k.ultimoMes.total, delta: k.variacion }] : []), { label: 'Registros', valor: recs.length }],
        parrafos: ins.map((i) => `${i.titulo}. ${i.texto}`) });
      if (s.comparar) {
        const mesA = s.hasta || s.desde; if (mesA) { const c = comparar(recs.length ? d.records : [], num, mesA, s.comparar, cat); secciones.push({ titulo: `Comparación ${nombreMes(mesA)} vs. ${nombreMes(s.comparar)}`, parrafos: [c.texto] }); }
      }
      const serie = porMes(recs, num.key);
      if (serie.length) secciones.push({ titulo: `${num.label} por mes`, tabla: { columnas: [{ label: 'Mes', type: 'text' }, { label: num.label, type: 'number' }], filas: serie.map((p) => [nombreMes(p.mes), p.total]) } });
    }
    const max = formato === 'pdf' || formato === 'docx' || formato === 'pptx' ? 500 : 200000;
    const detalle = recs.slice(-max);
    secciones.push({ titulo: 'Detalle', parrafos: recs.length > max ? [`Se incluyen los últimos ${max} de ${recs.length} registros; el archivo Excel o CSV trae todos.`] : [],
      tabla: { columnas: [{ label: 'Fecha', type: 'date' }, ...d.fields.map((f) => ({ label: f.label || f.key, type: f.type }))], filas: detalle.map((r) => [String(r.period).slice(0, 10), ...d.fields.map((f) => r.data?.[f.key] ?? null)]) } });
    return { doc: { titulo: a.name, subtitulo: `${contexto || 'Todos los datos'} · generado ${new Date().toLocaleDateString('es-AR')}`, secciones }, registros: recs.length };
  }

  const docDeTabla = (titulo, tabla, subtitulo = null) => ({ titulo, subtitulo: subtitulo || `${tabla.filas.length} filas · generado ${new Date().toLocaleDateString('es-AR')}`, secciones: [{ titulo: 'Datos', tabla }] });

  async function tablaDeArchivo(id) {
    const { tabla } = await D.entrada.tablaDe(id);
    if (!tabla) throw new Error('no encontré una tabla en el archivo');
    return tablaDePerfil(tabla.perfil);
  }

  // ------------------------------------------------------------------ acciones
  async function exportarArtefacto(a, formato) {
    if (!FORMATOS[formato]) return { texto: `Todavía no exporto a ${formato}.` };
    const { doc, registros } = await docDeArtefacto(a, { formato });
    const grande = registros > 20000;
    let tarea = null;
    if (grande) tarea = await q(sb.from('so_tasks').insert({ kind: 'export', name: `Exportar ${a.name} (${FORMATOS[formato].etiqueta})`, status: 'running', artifact_id: a.id, progress: 0.1, input: { formato } }).select('id').single());
    try {
      const f = await generarYGuardar(doc, formato, { origin: 'export', artifactId: a.id, descripcion: `Exportación de "${a.name}" (${registros} registros)` });
      if (tarea) { await sb.from('so_tasks').update({ status: 'completed', progress: 1, result: { archivo: f.id } }).eq('id', tarea.id); x.notificar('success', `${f.original_name} está listo`, `Exportación de ${a.name}`, { artifact_id: a.id }); }
      x.evento('task_completed', null, { tipo: 'export', formato });
      return resultado(f, `Listo: ${f.original_name} (${tamano(f.size)}) con ${registros} registros de "${a.name}".`, { artifactId: a.id });
    } catch (err) {
      if (tarea) await sb.from('so_tasks').update({ status: 'failed', error: err.message }).eq('id', tarea.id);
      return { ok: false, texto: `No pude generar el archivo: ${err.message}.`, meta: { estado: 'fallo', reintentar: `exportá ${a.name} a ${formato}` } };
    }
  }

  async function convertirArchivo(f, formato) {
    if (f.kind !== 'table') {
      if (!['pdf', 'docx', 'txt', 'md'].includes(formato)) return { texto: `${f.original_name} no es una tabla: puedo pasarlo a PDF, Word, texto o Markdown.` };
      const frs = await q(sb.from('so_file_chunks').select('ord, content').eq('file_id', f.id).order('ord').limit(200));
      if (!frs.length) return { texto: `No tengo texto extraído de ${f.original_name} para convertirlo.` };
      const doc = { titulo: f.original_name.replace(/\.[^.]+$/, ''), subtitulo: `Convertido de ${f.detected_type.toUpperCase()}`, secciones: [{ titulo: 'Contenido', parrafos: frs.map((x2) => x2.content) }] };
      const g = await generarYGuardar(doc, formato, { origin: 'generated', descripcion: `Convertido de ${f.original_name}` });
      return resultado(g, `Convertí ${f.original_name} a ${FORMATOS[formato].etiqueta}: ${g.original_name}.`);
    }
    const t = await tablaDeArchivo(f.id);
    const g = await generarYGuardar(docDeTabla(f.original_name.replace(/\.[^.]+$/, ''), t), formato, { origin: 'generated', descripcion: `Convertido de ${f.original_name}` });
    return resultado(g, `Convertí ${f.original_name} a ${FORMATOS[formato].etiqueta}: ${g.original_name} (${t.filas.length} filas).`);
  }

  // Editar = nueva versión (Original → EditSpec → Transform → Validate → New Version). Nunca se toca el original.
  async function editarArchivo(f, texto) {
    if (f.kind !== 'table') return null;
    const t = await tablaDeArchivo(f.id);
    const spec = interpretarEdicion(texto, t);
    if (!spec) return null;
    if (spec.pregunta) return { texto: spec.pregunta, meta: { estado: 'propuesta' } };
    const nueva = aplicarEdicion(t, spec);
    const formato = ['xlsx', 'csv', 'json'].includes(f.detected_type) ? f.detected_type : 'xlsx';
    const base = f.original_name.replace(/\.[^.]+$/, '');
    const g = await generar(docDeTabla(base, { columnas: nueva.columnas, filas: nueva.filas }), formato, await libs(formato));
    const nf = await guardar({ ...g, nombre: formato === f.detected_type ? f.original_name : `${base}.${formato}`, origin: 'generated', parent: f, cambio: `Francisco ${spec.resumen}`,
      descripcion: `${spec.resumen} · ${nueva.antes} → ${nueva.despues} filas`, filasEsperadas: formato === 'json' ? null : nueva.filas.length });
    return resultado(nf, `Hice una versión nueva de ${f.original_name} (v${nf.version}): ${spec.resumen}. ${nueva.antes !== nueva.despues ? `Filas: ${nueva.antes} → ${nueva.despues}. ` : ''}La versión anterior queda intacta.`,
      { cambios: [`+ ${spec.resumen}`], versiones: nf.id });
  }

  // Cadena de versiones (v1 → vN) a partir de cualquier versión.
  async function versionesDe(f) {
    const todos = await q(sb.from('so_files').select('id, original_name, version, version_of, created_at, change_summary, size, detected_type, origin, storage_path, kind, meta').order('created_at').limit(1000));
    let raiz = f; const porId = new Map(todos.map((z) => [z.id, z]));
    while (raiz.version_of && porId.get(raiz.version_of)) raiz = porId.get(raiz.version_of);
    const cadena = [raiz]; const ids = new Set([raiz.id]);
    let cambio = true;
    while (cambio) { cambio = false; for (const z of todos) if (z.version_of && ids.has(z.version_of) && !ids.has(z.id)) { cadena.push(z); ids.add(z.id); cambio = true; } }
    return cadena.sort((p, r) => p.version - r.version || p.created_at.localeCompare(r.created_at));
  }

  async function bajar(f) {
    const { data, error } = await sb.storage.from(BUCKET).download(f.storage_path);
    if (error) throw new Error('no pude leer la versión guardada');
    return new Uint8Array(await data.arrayBuffer());
  }

  // Restaurar crea una versión nueva con el contenido de la elegida (la historia nunca se destruye).
  async function restaurar(actual, elegida) {
    const bytes = await bajar(elegida);
    const ult = (await versionesDe(actual)).at(-1);
    const nf = await guardar({ bytes, nombre: ult.original_name, mime: FORMATOS[elegida.detected_type]?.mime || 'application/octet-stream', kind: elegida.kind, formato: elegida.detected_type,
      origin: 'generated', parent: ult, cambio: `Restaurado desde v${elegida.version}` });
    return resultado(nf, `Restauré la v${elegida.version} como v${nf.version}. Las versiones anteriores siguen disponibles.`);
  }

  async function compararDos(fa, fb) {
    if (fa.kind === 'table' && fb.kind === 'table') {
      const [A, B] = await Promise.all([tablaDeArchivo(fa.id), tablaDeArchivo(fb.id)]);
      const c = compararTablas(A, B);
      const ui = [{ type: 'Diff', props: { titulo: `${fa.original_name}${fa.version ? ` (v${fa.version})` : ''} → ${fb.original_name}${fb.version ? ` (v${fb.version})` : ''}`, resumen: c.resumen,
        agregadas: c.agregadas, quitadas: c.quitadas, cambiadas: c.cambiadas, impacto: c.impacto, columnas: [...c.colAgregadas.map((z) => `+ ${z}`), ...c.colQuitadas.map((z) => `− ${z}`)],
        cambios: c.cambios.slice(0, 40).map((z) => ({ ...z, antes: z.antes ?? null, despues: z.despues ?? null })) } },
        { type: 'Action', props: { label: 'Exportar comparación', accion: 'exportar_comparacion', datos: { a: fa.id, b: fb.id } } }];
      return { texto: c.sinCambios ? 'No hay diferencias entre los dos archivos.' : `${c.resumen} ${c.impacto}`, meta: { estado: 'ejecutado', ui, fuente: { origen: `${fa.original_name} y ${fb.original_name}`, operacion: 'comparación fila por fila', registros: A.filas.length + B.filas.length, at: new Date().toISOString() } } };
    }
    const texto = async (f) => (await q(sb.from('so_file_chunks').select('content').eq('file_id', f.id).order('ord').limit(400))).map((z) => z.content).join('\n');
    const c = compararTextos(await texto(fa), await texto(fb));
    const ui = [{ type: 'Diff', props: { titulo: `${fa.original_name} → ${fb.original_name}`, resumen: c.resumen, agregadas: c.agregados.length, quitadas: c.quitados.length, cambiadas: 0,
      cambios: [...c.agregados.map((p) => ({ tipo: 'agregada', clave: p.slice(0, 80) })), ...c.quitados.map((p) => ({ tipo: 'quitada', clave: p.slice(0, 80) }))] } }];
    return { texto: c.sinCambios ? 'El texto de los dos documentos es igual.' : c.resumen, meta: { estado: 'ejecutado', ui } };
  }

  async function exportarComparacion(idA, idB) {
    const [fa, fb] = await Promise.all([D.archivo(idA), D.archivo(idB)]);
    const [A, B] = await Promise.all([tablaDeArchivo(fa.id), tablaDeArchivo(fb.id)]);
    const c = compararTablas(A, B, { max: 100000 });
    const doc = { titulo: `Comparación ${fa.original_name.replace(/\.[^.]+$/, '')} vs ${fb.original_name.replace(/\.[^.]+$/, '')}`, secciones: [
      { titulo: 'Resumen', parrafos: [c.resumen, c.impacto], metricas: [{ label: 'Filas agregadas', valor: c.agregadas }, { label: 'Filas quitadas', valor: c.quitadas }, { label: 'Filas con cambios', valor: c.cambiadas }] },
      { titulo: 'Cambios', tabla: { columnas: [{ label: 'Tipo', type: 'text' }, { label: c.clave || 'Fila', type: 'text' }, { label: 'Campo', type: 'text' }, { label: 'Antes', type: 'text' }, { label: 'Después', type: 'text' }],
        filas: c.cambios.map((z) => [z.tipo, z.clave, z.campo || '', z.antes ?? '', z.despues ?? '']) } },
      { titulo: 'Totales', tabla: { columnas: [{ label: 'Columna', type: 'text' }, { label: 'Antes', type: 'number' }, { label: 'Después', type: 'number' }, { label: 'Diferencia', type: 'number' }], filas: c.totales.map((z) => [z.columna, z.antes, z.despues, z.delta]) } }] };
    const f = await generarYGuardar(doc, 'xlsx', { descripcion: `Comparación de ${fa.original_name} y ${fb.original_name}` });
    return resultado(f, `Exporté la comparación: ${f.original_name}.`);
  }

  // Consolidación incremental con progreso real ("3/12 procesados").
  async function consolidarArchivos(fs, progreso = () => {}) {
    const tablas = fs.filter((f) => f.kind === 'table');
    if (tablas.length < 2) return { texto: 'Para consolidar necesito al menos dos archivos con tablas.' };
    const lista = [];
    for (const [i, f] of tablas.entries()) { lista.push({ nombre: f.original_name, tabla: await tablaDeArchivo(f.id) }); progreso(`${i + 1}/${tablas.length} procesados`); }
    const r = consolidar(lista);
    if (r.pregunta) return { texto: r.pregunta, meta: { estado: 'propuesta' } };
    const titulo = `Consolidado ${new Date().toISOString().slice(0, 10)}`;
    const f = await generarYGuardar(docDeTabla(titulo, r.tabla, `${tablas.length} archivos · ${r.tabla.filas.length} filas`), 'xlsx', { descripcion: `Consolidación de ${tablas.length} archivos` });
    return resultado(f, `Consolidé ${tablas.length} archivos en ${f.original_name}: ${r.tabla.filas.length} filas (${r.porArchivo.map((z) => `${z.nombre}: ${z.filas}`).join(', ')}). Cada fila conserva su archivo de origen en la columna "Archivo".`,
      { consolidado: { fileId: f.id } });
  }

  // ------------------------------------------------------------------ plantillas y automatizaciones
  async function guardarPlantilla(nombre, { formato, artifactId }) {
    const p = await q(sb.from('so_file_templates').upsert({ name: nombre.slice(0, 120), formato, artifact_id: artifactId, project_id: E.get().proyectoId ?? null, spec: { fuente: 'artefacto', secciones: ['Resumen', 'Por mes', 'Detalle'] } }, { onConflict: 'owner_id,name' }).select('id, name').single());
    return { texto: `Guardé la plantilla "${p.name}" (${FORMATOS[formato].etiqueta}). Pedime "generá ${p.name.toLowerCase()}" y la armo con los datos del momento.`, meta: { estado: 'verificado' } };
  }
  async function plantillas() { return q(sb.from('so_file_templates').select('id, name, formato, artifact_id').order('name')); }
  async function usarPlantilla(p) {
    const a = x.artefacto(p.artifact_id);
    if (!a) return { texto: `La plantilla "${p.name}" apuntaba a un tablero que ya no está.` };
    const { doc } = await docDeArtefacto(a, { formato: p.formato });
    doc.titulo = `${p.name} · ${new Date().toLocaleDateString('es-AR')}`;
    const f = await generarYGuardar(doc, p.formato, { origin: 'generated', artifactId: a.id, descripcion: `Plantilla "${p.name}"` });
    return resultado(f, `Generé "${p.name}" con los datos actuales de "${a.name}": ${f.original_name}.`);
  }

  // Automatización "al cargar datos": se registra en so_automations y se ejecuta al completarse una importación.
  async function crearAutomatizacion(a, pasos) {
    const auto = await q(sb.from('so_automations').insert({ artifact_id: a.id, name: `Al cargar datos en ${a.name}`, trigger: { tipo: 'importacion_completada', artifact_id: a.id }, action: { pasos } }).select('id').single());
    return auto.id;
  }

  async function ejecutarAutomatizaciones(a, loteId) {
    const autos = await q(sb.from('so_automations').select('id, name, action, enabled').eq('artifact_id', a.id).eq('enabled', true));
    const out = [];
    for (const au of autos) {
      // Idempotencia: una ejecución por (automatización, lote). Si ya existe, no se repite.
      const { data: t, error } = await sb.from('so_tasks').insert({ kind: 'automation', name: au.name, status: 'running', artifact_id: a.id, idempotency_key: `auto:${au.id}:${loteId}`, input: { lote: loteId, pasos: au.action.pasos } }).select('id').single();
      if (error || !t) continue;
      const hechos = [];
      try {
        st.datos?.delete?.(a.id);
        for (const paso of au.action.pasos || []) {
          if (paso === 'comparar') hechos.push('comparación con el mes anterior');
          if (['pdf', 'xlsx', 'docx', 'pptx', 'csv'].includes(paso)) { const r = await exportarArtefacto(a, paso); if (r.meta?.archivo) hechos.push(FORMATOS[paso].etiqueta); else throw new Error(r.texto); }
        }
        await sb.from('so_tasks').update({ status: 'completed', progress: 1, result: { hechos } }).eq('id', t.id);
        if ((au.action.pasos || []).includes('avisar')) x.notificar('success', `${a.name}: automatización completada`, hechos.join(', '), { artifact_id: a.id });
        out.push({ ok: true, hechos });
      } catch (err) {
        await sb.from('so_tasks').update({ status: 'failed', error: err.message, needs_action: 'La automatización falló; podés reintentar generando el archivo a mano.' }).eq('id', t.id);
        x.notificar('action', `${a.name}: la automatización falló`, err.message, { artifact_id: a.id });
        out.push({ ok: false, error: err.message });
      }
    }
    return out;
  }

  async function descargar(id) {
    const f = await D.archivo(id);
    if (!f) throw new Error('no encontré ese archivo');
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.storage_path, 60, { download: f.original_name });
    if (error || !data?.signedUrl) throw new Error('no tenés permiso para descargar ese archivo');
    const a = document.createElement('a');
    a.href = data.signedUrl; a.download = f.original_name; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    x.evento('download', null, { tipo: f.detected_type });
    return f;
  }

  return { guardar, generarYGuardar, exportarArtefacto, convertirArchivo, editarArchivo, versionesDe, restaurar, compararDos, exportarComparacion, consolidarArchivos,
    guardarPlantilla, plantillas, usarPlantilla, crearAutomatizacion, ejecutarAutomatizaciones, descargar, tablaDeArchivo, docDeArtefacto, spec, bajar, nombreArchivo };
}
