// SO · entrada universal en la interfaz: adjuntos del chat, vista previa de archivos, acciones de Francisco sobre
// archivos/APIs/linaje, panel "Datos y fuentes" del tablero, vista previa de importación (mapeo editable) y alta de
// APIs con credencial segura. Todo pasa por UniversalInputService (ingesta/entrada.js) y el importador con lotes.
import { crearEntrada, etiquetaEstado, BUCKET } from './ingesta/entrada.js';
import { planificar, ejecutar as importar, incidenciasCSV, ESTRATEGIAS, resumenErrores } from './ingesta/importador.js';
import { mapear, convertir, inferirEstrategia, camposDesdeColumnas } from './ingesta/mapeo.js';
import { perfilar } from './ingesta/perfil.js';
import { resolverArchivo } from './ingesta/intencion.js';
import { recuperar, refTexto } from './ingesta/documentos.js';
import { aMatriz } from './supabase/functions/so-api/seguridad.js';
import { nombreMes } from './analisis.js';

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const ICONO = { image: '🖼', table: '📊', document: '📄', presentation: '📽', other: '📦' };
const tam = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export function crearDatos(d) {
  const { sb, cfg, st, E, q, esc, $ } = d;
  const bandeja = [];          // ids de items pendientes del próximo mensaje
  const archivosCache = new Map();
  let ultimaListaArchivos = null;

  const entrada = crearEntrada({
    sb, cfg,
    contexto: () => ({ proyectoId: E.get().proyectoId }),
    onCambio: (it) => { pintarBandeja(); d.onCambioArchivo?.(it); },
    log: (x) => sb.from('so_ingest_log').insert(x).then(() => {}, () => {}),
  });

  // ---------------------------------------------------------------- composer: adjuntar, soltar, pegar, cámara
  async function adjuntar(files) {
    if (!files?.length) return;
    const nuevos = await entrada.agregar(files, 'chat', { chatId: st.chatId });
    bandeja.push(...nuevos.map((x) => x.id));
    pintarBandeja();
    d.abrirFrancisco?.();   // soltar o adjuntar en cualquier superficie trae a Francisco con el adjunto listo
    $('texto').focus();
  }
  $('adjuntar').onclick = () => $('inpArchivos').click();
  $('camara').onclick = () => $('inpCamara').click();
  $('inpArchivos').onchange = (e) => { adjuntar(e.target.files); e.target.value = ''; };
  $('inpCamara').onchange = (e) => { adjuntar(e.target.files); e.target.value = ''; };
  $('texto').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); adjuntar(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pegado-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${i ? `-${i}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })))); }
  });
  let arrastres = 0;
  const panel = $('panelFrancisco');
  document.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { arrastres++; $('soltar').hidden = false; } });
  document.addEventListener('dragleave', () => { arrastres = Math.max(0, arrastres - 1); if (!arrastres) $('soltar').hidden = true; });
  document.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); arrastres = 0; $('soltar').hidden = true;
    // Sobre un tablero abierto, el archivo alimenta ese tablero (input contextual); en el Workspace o en Francisco,
    // va como adjunto y Francisco propone qué hacer.
    if (E.get().vista === 'artefacto' && !panel.contains(e.target) && st.puedeImportarAqui) abrirImportacion(e.dataTransfer.files[0], E.get().artefactoId);
    else adjuntar(e.dataTransfer.files);
  });

  function pintarBandeja() {
    const items = bandeja.map((id) => entrada.items.get(id)).filter(Boolean);
    $('bandeja').innerHTML = items.map((it) => {
      const enCurso = ['esperando', 'subiendo', 'procesando'].includes(it.estado);
      const prog = enCurso && it.progreso > 0 && it.progreso < 1 ? `<progress max="1" value="${it.progreso}" aria-label="Progreso de ${esc(it.nombre)}"></progress>` : '';
      return `<div class="adj ${it.estado}" data-adj="${it.id}">
        ${it.miniatura ? `<img src="${it.miniatura.url}" alt="">` : `<span class="adj-ic" aria-hidden="true">${ICONO[it.info?.kind] || '📦'}</span>`}
        <span class="adj-txt"><strong>${esc(it.nombre)}</strong><small>${esc(tam(it.size))} · ${esc(etiquetaEstado(it.estado))}${it.error ? ` — ${esc(it.error)}` : ''}</small>${prog}</span>
        ${it.estado === 'subiendo' ? `<button type="button" data-cancelar aria-label="Cancelar ${esc(it.nombre)}">Cancelar</button>` : ''}
        ${['fallo', 'cancelado'].includes(it.estado) ? `<button type="button" data-reintentar aria-label="Reintentar ${esc(it.nombre)}">Reintentar</button>` : ''}
        <button type="button" data-quitar aria-label="Quitar ${esc(it.nombre)}">×</button></div>`;
    }).join('');
    $('bandeja').querySelectorAll('[data-adj]').forEach((n) => {
      const id = n.dataset.adj;
      n.querySelector('[data-cancelar]')?.addEventListener('click', () => entrada.cancelar(id));
      n.querySelector('[data-reintentar]')?.addEventListener('click', () => { d.evento('retry', null, { via: 'adjunto' }); entrada.reintentar(id); });
      n.querySelector('[data-quitar]').addEventListener('click', () => { entrada.quitar(id); bandeja.splice(bandeja.indexOf(id), 1); pintarBandeja(); });
    });
  }

  // Al enviar: espera subidas en curso; los que fallan no bloquean el mensaje (se informa cuáles quedaron afuera).
  async function tomarAdjuntos() {
    const items = bandeja.map((id) => entrada.items.get(id)).filter(Boolean);
    if (!items.length) return { adjuntos: [], fuera: [] };
    if (items.some((it) => ['esperando', 'subiendo', 'procesando'].includes(it.estado))) d.actividad('subiendo');
    await Promise.all(items.map((it) => it.promesa).filter(Boolean));
    const ok = items.filter((it) => ['listo', 'parcial', 'subido'].includes(it.estado) && it.fileId);
    const fuera = items.filter((it) => !ok.includes(it));
    bandeja.length = 0; pintarBandeja();
    return { adjuntos: ok.map((it) => ({ fileId: it.fileId, nombre: it.nombre, kind: it.info.kind, tipo: it.info.tipo, miniatura: it.miniatura?.url && it.miniatura.url.length < 60000 ? it.miniatura.url : null })),
      fuera: fuera.map((it) => `${it.nombre} (${it.error || etiquetaEstado(it.estado)})`) };
  }
  async function asociarMensaje(adjuntos, mensajeId) {
    if (adjuntos.length) await sb.from('so_files').update({ message_id: mensajeId, chat_id: st.chatId }).in('id', adjuntos.map((a) => a.fileId));
  }

  // ---------------------------------------------------------------- archivos guardados
  async function archivo(id) {
    if (archivosCache.has(id)) return archivosCache.get(id);
    const f = await q(sb.from('so_files').select('*').eq('id', id).maybeSingle());
    if (f) archivosCache.set(id, f);
    return f;
  }
  async function listaArchivos() {
    if (ultimaListaArchivos && Date.now() - ultimaListaArchivos.t < 30000) return ultimaListaArchivos.f;
    const f = await q(sb.from('so_files').select('id, original_name, detected_type, kind, created_at, version, status, meta, storage_path, size, artifact_id, checksum, origin, collection, chat_id, change_summary').order('created_at', { ascending: false }).limit(300));
    ultimaListaArchivos = { t: Date.now(), f };
    return f;
  }
  // Tras cambiar metadatos (colección, estado) la próxima lectura va a la base.
  function olvidar(ids = []) { for (const id of ids) archivosCache.delete(id); ultimaListaArchivos = null; }
  async function urlFirmada(f, descargar = false) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(f.storage_path, 300, descargar ? { download: f.original_name } : undefined);
    return data?.signedUrl || null;
  }

  function htmlAdjuntos(adjuntos = []) {
    if (!adjuntos.length) return '';
    return `<div class="adjuntos">${adjuntos.map((a) => a.kind === 'image' && a.miniatura
      ? `<button type="button" class="adj-img" data-ver-archivo="${a.fileId}" aria-label="Ver ${esc(a.nombre)}"><img src="${a.miniatura}" alt="${esc(a.nombre)}"></button>`
      : `<button type="button" class="adj-chip" data-ver-archivo="${a.fileId}">${ICONO[a.kind] || '📦'} ${esc(a.nombre)}</button>`).join('')}</div>`;
  }
  function conectarAdjuntos(raiz) {
    raiz.querySelectorAll('[data-ver-archivo]').forEach((b) => b.addEventListener('click', () => vistaPrevia(b.dataset.verArchivo)));
  }

  // FilePreview: adaptado al tipo; nada se renderiza como HTML ejecutable.
  async function vistaPrevia(id) {
    const f = await archivo(id);
    const c = $('dlgArchivoCuerpo');
    if (!f) { c.innerHTML = '<p>No encontré ese archivo.</p>'; $('dlgArchivo').showModal(); return; }
    const avisos = f.meta?.avisos || [];
    c.innerHTML = `<header class="dlg-cab"><h2>${ICONO[f.kind] || '📦'} ${esc(f.original_name)}</h2><button type="button" data-cerrar aria-label="Cerrar">✕</button></header>
      <p class="vacio">${esc(f.detected_type.toUpperCase())} · ${esc(tam(f.size))}${f.version > 1 ? ` · versión ${f.version}` : ''} · ${esc(etiquetaEstado({ ready: 'listo', partial: 'parcial', failed: 'fallo' }[f.status] || f.status))} · subido ${esc(new Date(f.created_at).toLocaleString('es-AR'))}</p>
      ${avisos.length ? `<ul class="avisos-archivo">${avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <div id="dlgContenido"><p class="vacio">Cargando vista previa…</p></div>
      <p class="vacio seguridad">Tipo verificado por su contenido. Nunca se ejecutan macros ni scripts. Antivirus: no disponible en este entorno.</p>
      <div class="msg-acc"><button type="button" data-descargar>Descargar</button>
        ${f.kind === 'table' && E.get().modo === 'work' ? '<button type="button" data-crear>Crear tablero con estos datos</button><button type="button" data-usar>Usar en un tablero…</button>' : ''}
        ${f.stage_error ? '<button type="button" data-reprocesar>Reintentar lectura</button>' : ''}</div>`;
    $('dlgArchivo').showModal();
    c.querySelector('[data-cerrar]').onclick = () => $('dlgArchivo').close();
    c.querySelector('[data-descargar]').onclick = async () => { const u = await urlFirmada(f, true); if (u) location.href = u; };
    c.querySelector('[data-crear]')?.addEventListener('click', () => { $('dlgArchivo').close(); d.procesarTexto('Creá un dashboard con estos datos', [{ fileId: f.id, nombre: f.original_name, kind: f.kind, tipo: f.detected_type }]); });
    c.querySelector('[data-usar]')?.addEventListener('click', () => { $('dlgArchivo').close(); d.prellenar('Usá este archivo en ', [{ fileId: f.id, nombre: f.original_name, kind: f.kind, tipo: f.detected_type }]); });
    c.querySelector('[data-reprocesar]')?.addEventListener('click', async () => { archivosCache.delete(f.id); try { await entrada.tablaDe(f.id); } catch {} vistaPrevia(f.id); });
    const cont = c.querySelector('#dlgContenido');
    try {
      if (f.kind === 'image') {
        const u = ['png', 'jpeg', 'gif', 'webp'].includes(f.detected_type) ? await urlFirmada(f) : null;
        cont.innerHTML = u ? `<img class="previa-img" src="${esc(u)}" alt="${esc(f.original_name)}">` : '<p class="vacio">Este formato de imagen no se puede mostrar en el navegador.</p>';
      } else if (f.kind === 'table') {
        const { tabla } = await entrada.tablaDe(f.id);
        const p = tabla?.perfil;
        cont.innerHTML = p ? `${(f.meta?.hojas || []).length > 1 ? `<p>Hojas: ${f.meta.hojas.map((h) => `${esc(h.nombre)} (${h.filas})`).join(', ')}</p>` : ''}
          <p>${p.filas} filas · ${p.columnas.length} columnas${p.problemas.length ? ` · ${esc(p.problemas.join('; '))}` : ''}</p>
          <div class="tabla-scroll"><table><thead><tr>${p.columnas.map((c2) => `<th>${esc(c2.nombre)}<br><small>${esc({ number: 'número', date: 'fecha', text: 'texto' }[c2.tipo])}</small></th>`).join('')}</tr></thead>
          <tbody>${p.datos.slice(0, 15).map((r) => `<tr>${p.columnas.map((c2) => `<td>${esc(r[c2.indice] instanceof Date ? r[c2.indice].toISOString().slice(0, 10) : r[c2.indice] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="vacio">No encontré una tabla.</p>';
      } else {
        const frs = await q(sb.from('so_file_chunks').select('ord, ref, content').eq('file_id', f.id).order('ord').limit(4));
        cont.innerHTML = `${f.meta?.paginas ? `<p>${f.meta.paginas} páginas</p>` : ''}${f.meta?.estructura ? `<p>Estructura: ${esc(f.meta.estructura)}</p>` : ''}
          ${f.meta?.resumen ? `<p><strong>Resumen:</strong> ${esc(f.meta.resumen)}</p>` : ''}
          ${frs.map((x) => `<blockquote><small>${esc(refTexto(x.ref) || 'inicio')}</small><br>${esc(x.content.slice(0, 600))}${x.content.length > 600 ? '…' : ''}</blockquote>`).join('') || '<p class="vacio">Sin texto extraído.</p>'}`;
      }
    } catch (err) { cont.innerHTML = `<p class="error">No pude armar la vista previa: ${esc(err.message)}.</p>`; }
  }

  // ---------------------------------------------------------------- acciones de Francisco
  async function objetivos(acc) {
    if (acc.adjuntos?.length) return Promise.all(acc.adjuntos.map(archivo)).then((xs) => xs.filter(Boolean));
    if (acc.referencia) return resolverArchivo(acc.referencia, await listaArchivos());
    return [];
  }
  const sinArchivo = () => ({ texto: 'No encontré el archivo. Adjuntalo con el botón + o decime cuál (por ejemplo: "el Excel de ventas que subí ayer").' });
  const tarjetaImport = (r, nombre, a) => ({
    texto: `${nombre}\n${fmt.format(r.aceptadas)} registros incorporados${r.rechazadas.length ? `\n${fmt.format(r.rechazadas.length)} registros necesitan revisión` : ''}${r.reemplazadas ? `\n${fmt.format(r.reemplazadas)} registros anteriores reemplazados (se pueden recuperar)` : ''}${r.camposAgregados.length ? `\nCampos nuevos: ${r.camposAgregados.map((c) => c.label).join(', ')}` : ''}\nTablero actualizado.`,
    meta: { estado: 'verificado', artifactId: a.id, abrir: a.id, lote: r.loteId, incidencias: r.rechazadas.length ? r.loteId : null,
      undo: { tipo: 'importacion', loteId: r.loteId, artifactId: a.id },
      porque: `Estrategia: ${ESTRATEGIAS[r.estrategia]}.${r.rechazadas.length ? ` Motivos: ${resumenErrores(r.rechazadas)}.` : ''}`,
      fuente: { origen: nombre, operacion: `importación ${r.estrategia}`, registros: r.aceptadas, at: new Date().toISOString() } },
  });

  async function datasetDe(a) {
    const ds = await q(sb.from('so_datasources').select('id, owner_id, name, fields, source_types').eq('id', a.datasource_id).single());
    return ds;
  }

  async function importarArchivo(f, a, { texto = '', estrategia = null, clave = null, asignaciones = null, columnaFecha, forzar = false, agregarCampos = true, loteExistente = null, tareaId = null } = {}) {
    d.actividad('analizando');
    const { tabla } = await entrada.tablaDe(f.id);
    if (!tabla) return { ok: false, texto: `No encontré una tabla en ${f.original_name}.`, meta: { estado: 'fallo' } };
    const dataset = await datasetDe(a);
    const plan = await planificar(sb, { perfil: tabla.perfil, dataset, texto, checksum: forzar ? null : f.checksum });
    if (columnaFecha !== undefined) plan.columnaFecha = columnaFecha;
    if (plan.previo && !forzar) {
      return { texto: `Este archivo parece haber sido importado anteriormente en "${a.name}" (${new Date(plan.previo.started_at).toLocaleDateString('es-AR')}, ${fmt.format(plan.previo.rows_accepted)} registros). No lo volví a cargar para no duplicar.`,
        meta: { estado: 'propuesta', preview: { accion: { tipo: 'importar_forzado', fileId: f.id, artefactoId: a.id, texto }, boton: 'Importar igual' }, artifactId: a.id } };
    }
    if (!asignaciones && !plan.mapeo.inequivoco && plan.mapeo.asignaciones.length + plan.nuevas.length === 0) {
      return { texto: `No pude relacionar las columnas de ${f.original_name} con "${a.name}".`, meta: { estado: 'propuesta', revisar: { fileId: f.id, artefactoId: a.id } } };
    }
    if (!asignaciones && plan.mapeo.pregunta) {
      d.actividad('esperando');
      return { texto: plan.mapeo.pregunta, meta: { revisar: { fileId: f.id, artefactoId: a.id, texto } } };
    }
    const est = estrategia || plan.estrategia.estrategia;
    if (est === 'REPLACE' && !estrategia) {
      return { texto: `Antes de reemplazar: los ${fmt.format(await contarActivos(dataset.id))} registros actuales de "${a.name}" dejan de mostrarse y se reemplazan por los ${fmt.format(tabla.perfil.filas)} del archivo. Es reversible con "Deshacer importación".`,
        meta: { estado: 'propuesta', preview: { accion: { tipo: 'importar_confirmado', fileId: f.id, artefactoId: a.id, estrategia: 'REPLACE', texto }, boton: 'Reemplazar' }, artifactId: a.id } };
    }
    d.actividad('actualizando');
    const grande = tabla.perfil.filas > 5000;
    let tarea = tareaId ? { id: tareaId } : null;
    if (grande && !tarea) tarea = await q(sb.from('so_tasks').insert({ kind: 'import', name: `Importar ${f.original_name}`, artifact_id: a.id, status: 'running', progress: 0,
      idempotency_key: `import:${a.id}:${f.checksum}:${Date.now()}`, input: { archivo: f.original_name, filas: tabla.perfil.filas, fileId: f.id, estrategia: est } }).select('id').single());
    if (tarea && tareaId) await sb.from('so_tasks').update({ status: 'running', needs_action: null, error: null, updated_at: new Date().toISOString() }).eq('id', tareaId);
    st.tareasVivas ||= new Set(); if (tarea) st.tareasVivas.add(tarea.id);
    const r = await importar(sb, plan, { dataset, artifactId: a.id, inputId: await inputArchivo(a, dataset), fileId: f.id, checksum: f.checksum, nombre: f.original_name,
      estrategia: est, clave: clave || plan.estrategia.clave, asignaciones: asignaciones || plan.mapeo.asignaciones, agregarCampos, loteExistente,
      alCrearLote: async (id) => { if (tarea) await sb.from('so_tasks').update({ input: { archivo: f.original_name, filas: tabla.perfil.filas, fileId: f.id, estrategia: est, loteId: id, artefactoId: a.id } }).eq('id', tarea.id); },
      progreso: (p) => { if (tarea) sb.from('so_tasks').update({ progress: p, updated_at: new Date().toISOString() }).eq('id', tarea.id).then(() => {}, () => {}); } })
      .catch(async (err) => {
        if (tarea) { await sb.from('so_tasks').update({ status: 'failed', error: err.message.slice(0, 300), needs_action: 'Reanudar', updated_at: new Date().toISOString() }).eq('id', tarea.id); st.tareasVivas.delete(tarea.id); }
        d.notificar('action', `No pude terminar de importar ${f.original_name}`, 'El archivo quedó guardado: podés reanudar sin volver a subirlo.', { group_key: `import:${a.id}`, artifact_id: a.id, task_id: tarea?.id ?? null });
        d.evento('task_failed', null, { kind: 'import' });
        throw err;
      });
    if (tarea) st.tareasVivas.delete(tarea.id);
    d.actividad('verificando');
    const { count } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('import_batch_id', r.loteId);
    if (tarea) {
      await sb.from('so_tasks').update({ status: 'completed', progress: 1, result: { importadas: r.aceptadas, omitidas: r.rechazadas.slice(0, 20) }, updated_at: new Date().toISOString() }).eq('id', tarea.id);
      d.notificar('success', `Importé ${fmt.format(r.aceptadas)} filas de ${f.original_name} en "${a.name}"`, r.rechazadas.length ? `${r.rechazadas.length} filas necesitan revisión.` : null, { group_key: `import:${a.id}`, artifact_id: a.id, task_id: tarea.id });
    }
    d.evento('task_completed', r.aceptadas, { kind: 'import', estrategia: est });
    st.datos.delete(a.id);
    if ((count ?? 0) !== r.aceptadas) return { ok: false, texto: `La importación no quedó completa: esperaba ${r.aceptadas} registros y hay ${count ?? 0}.`, meta: { estado: 'fallo' } };
    if (E.get().vista === 'artefacto' && E.get().artefactoId === a.id) d.abrirArtefacto(a.id, { forzar: true });
    return tarjetaImport(r, f.original_name, a);
  }

  async function contarActivos(dsId) {
    const { count } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('datasource_id', dsId).is('superseded_by', null);
    return count ?? 0;
  }

  // DataInput FILE_UPLOAD del tablero (se crea una vez y se reutiliza en cada carga).
  async function inputArchivo(a, dataset, extra = {}) {
    const ex = await q(sb.from('so_data_inputs').select('id').eq('artifact_id', a.id).eq('type', 'FILE_UPLOAD').neq('status', 'removed').limit(1));
    if (ex[0]) return ex[0].id;
    const r = await q(sb.from('so_data_inputs').insert({ artifact_id: a.id, dataset_id: dataset.id, name: 'Archivos', type: 'FILE_UPLOAD',
      configuration: { estrategia: 'APPEND', historico: true, ...extra }, schema: { fields: dataset.fields } }).select('id').single());
    if (!dataset.source_types?.includes('file')) await sb.from('so_datasources').update({ source_types: [...(dataset.source_types || []), 'file'] }).eq('id', dataset.id);
    return r.id;
  }

  function nombreDesdeArchivo(n) {
    const base = n.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `Dashboard de ${base.charAt(0).toLowerCase() + base.slice(1)}`.slice(0, 120);
  }

  async function dashboardDesdeArchivo(f, { historico = true } = {}) {
    d.actividad('analizando');
    const { tabla } = await entrada.tablaDe(f.id);
    if (!tabla) return { ok: false, texto: `No encontré una tabla en ${f.original_name} para armar un tablero.`, meta: { estado: 'fallo' } };
    const campos = camposDesdeColumnas(tabla.perfil.columnas, tabla.perfil.columnaFecha ? [tabla.perfil.columnaFecha] : []);
    if (!campos.some((c) => c.type === 'number')) return { texto: `${f.original_name} no tiene columnas numéricas: puedo guardarlo, pero un tablero necesita algún valor para medir.` };
    d.actividad('creando');
    const cr = await d.crearArtefacto({ type: 'dashboard', name: nombreDesdeArchivo(f.original_name), tema: f.original_name, persistentStorage: historico, campos, camposExplicitos: true, grafico: null });
    const a = d.artefacto(cr.meta.artifactId);
    const r = await importarArchivo(f, a, { agregarCampos: false });
    if (r.ok === false) return r;
    return { ...r, texto: `Creé "${a.name}" con ${f.original_name}.\n${r.texto}`, meta: { ...r.meta, tarjeta: true, undo: { tipo: 'crear', artifactId: a.id },
      porque: `Usé ${campos.map((c) => c.label).join(', ')}${tabla.perfil.columnaFecha ? ` y la columna de fecha para el historial` : ' (sin columna de fecha: se toma la fecha de hoy)'}. ${r.meta.porque || ''}` } };
  }

  async function compararArchivos(fs, a) {
    d.actividad('analizando');
    const [t1, t2] = await Promise.all(fs.slice(0, 2).map((f) => entrada.tablaDe(f.id).then((x) => x.tabla)));
    if (!t1) return { texto: 'No encontré una tabla para comparar.' };
    if (t2) {
      const p1 = t1.perfil, p2 = t2.perfil;
      const comunes = p1.columnas.filter((c) => p2.columnas.some((x) => x.key === c.key));
      const clave = p1.clavesProbables.find((k) => p2.clavesProbables.includes(k));
      const firma = (p, f) => comunes.map((c) => String(f[p.columnas.find((x) => x.key === c.key).indice] ?? '')).join('|');
      const s1 = new Set(p1.datos.map((f) => firma(p1, f))), s2 = new Set(p2.datos.map((f) => firma(p2, f)));
      const nuevas = [...s2].filter((x) => !s1.has(x)).length, quitadas = [...s1].filter((x) => !s2.has(x)).length;
      const totales = comunes.filter((c) => c.tipo === 'number').slice(0, 3).map((c) => {
        const tot = (p) => p.datos.reduce((s, f) => s + (Number(String(f[p.columnas.find((x) => x.key === c.key).indice] ?? '').replace(/\./g, '').replace(',', '.')) || 0), 0);
        const a1 = tot(p1), a2 = tot(p2);
        return `${c.nombre}: ${fmt.format(a1)} → ${fmt.format(a2)} (${a2 - a1 >= 0 ? '+' : '−'}${fmt.format(Math.abs(a2 - a1))})`;
      });
      const colsNuevas = p2.columnas.filter((c) => !p1.columnas.some((x) => x.key === c.key)).map((c) => c.nombre);
      return { texto: `${fs[0].original_name} → ${fs[1].original_name}: ${p1.filas} → ${p2.filas} filas; ${nuevas} filas nuevas o cambiadas y ${quitadas} que ya no están${clave ? ` (comparé por "${clave}")` : ''}.${totales.length ? `\n${totales.join('\n')}` : ''}${colsNuevas.length ? `\nColumnas nuevas: ${colsNuevas.join(', ')}` : ''}`,
        meta: { estado: 'ejecutado', fuente: { origen: `${fs[0].original_name} y ${fs[1].original_name}`, operacion: 'comparación fila a fila', registros: p1.filas + p2.filas, at: new Date().toISOString() } } };
    }
    if (!a) return { texto: '¿Contra qué tablero lo comparo?' };
    const ds = await datasetDe(a);
    const plan = await planificar(sb, { perfil: t1.perfil, dataset: ds });
    const { validas } = convertir(t1.perfil, plan.mapeo.asignaciones, ds.fields, { columnaFecha: plan.columnaFecha });
    const { a: _a, records } = await d.datosDe(a.id, { forzar: true });
    const firma = (p, dt) => `${p}|${plan.mapeo.asignaciones.map((x) => dt[x.campo] ?? '').join('|')}`;
    const base = new Set(records.map((r) => firma(r.period, r.data)));
    const nuevas = validas.filter((v) => !base.has(firma(v.period, v.data)));
    const meses = [...new Set(nuevas.map((v) => v.period.slice(0, 7)))].sort();
    return { texto: `${fs[0].original_name} vs. "${a.name}": de ${validas.length} filas válidas, ${nuevas.length} no están en la base${meses.length ? ` (meses: ${meses.map(nombreMes).join(', ')})` : ''}. ${nuevas.length ? 'Si querés, decime "sumá estos datos" y cargo solo lo nuevo.' : 'No hay nada nuevo para cargar.'}`,
      meta: { estado: 'ejecutado', fuente: { origen: `${fs[0].original_name} y ${ds.name}`, operacion: 'comparación por fecha y valores mapeados', registros: validas.length + records.length, at: new Date().toISOString() } } };
  }

  async function analizarArchivos(fs, pregunta = null) {
    d.actividad('analizando');
    const partes = [];
    for (const f of fs.slice(0, 3)) {
      if (f.kind === 'table') {
        const { tabla } = await entrada.tablaDe(f.id);
        if (!tabla) { partes.push(`${f.original_name}: no encontré una tabla.`); continue; }
        const p = tabla.perfil;
        const nums = p.columnas.filter((c) => c.tipo === 'number').slice(0, 3).map((c) => {
          const vs = p.datos.map((r) => r[c.indice]).map((v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')))).filter(Number.isFinite);
          return `${c.nombre}: total ${fmt.format(vs.reduce((s, v) => s + v, 0))}, promedio ${fmt.format(vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0)}`;
        });
        const fechaCol = p.columnas.find((c) => c.key === p.columnaFecha);
        const fechas = fechaCol ? p.datos.map((r) => r[fechaCol.indice]).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))).filter(Boolean).sort() : [];
        partes.push(`${f.original_name}: ${p.filas} filas, ${p.columnas.length} columnas (${p.columnas.map((c) => c.nombre).join(', ')}).${fechas.length ? ` Período: ${fechas[0]} a ${fechas.at(-1)}.` : ''}${nums.length ? `\n${nums.join('\n')}` : ''}${p.problemas.length ? `\nA revisar: ${p.problemas.join('; ')}.` : ''}`);
      } else if (f.kind === 'image') {
        partes.push(`${f.original_name}: imagen ${f.detected_type.toUpperCase()}${f.meta?.ancho ? ` de ${f.meta.ancho}×${f.meta.alto}` : ''}.`);
      } else {
        partes.push(`${f.original_name}: ${f.meta?.paginas ? `${f.meta.paginas} páginas. ` : ''}${f.meta?.resumen || 'sin texto extraído.'}`);
      }
    }
    // Con el modelo conectado, Francisco responde usando solo fragmentos relevantes; si no, respuesta extractiva con referencias.
    const llm = fs.some((f) => f.kind !== 'table') ? await d.conversar({ archivos: fs.map((f) => f.id), silencioso: true }) : null;
    if (llm && llm.ok !== false && llm.texto) return { ...llm, meta: { ...(llm.meta || {}), fuente: { origen: fs.map((f) => f.original_name).join(', '), operacion: 'fragmentos relevantes del archivo', registros: fs.length, at: new Date().toISOString() } } };
    if (pregunta && fs.some((f) => f.kind === 'document' || f.kind === 'presentation')) {
      let frs = [];
      try { frs = await q(sb.rpc('so_buscar_fragmentos', { p_files: fs.map((f) => f.id), p_q: pregunta, p_limit: 6 })); } catch { frs = []; }
      const top = recuperar(frs.map((x) => ({ ...x, content: x.content })), pregunta, 2);
      if (top.length) {
        const nombre = Object.fromEntries(fs.map((f) => [f.id, f.original_name]));
        return { texto: `Esto es lo que dice el archivo sobre tu pregunta:\n${top.map((t) => `• ${nombre[t.file_id] || ''}${refTexto(t.ref) ? `, ${refTexto(t.ref)}` : ''}: "${t.content.slice(0, 400)}${t.content.length > 400 ? '…' : ''}"`).join('\n')}`,
          meta: { estado: 'ejecutado', confianza: { nivel: 'incompleta', motivo: 'son citas textuales del archivo; para una respuesta redactada falta conectar el modelo de lenguaje' },
            fuente: { origen: fs.map((f) => f.original_name).join(', '), operacion: 'búsqueda en el contenido indexado', registros: top.length, at: new Date().toISOString() } } };
      }
    }
    if (fs.some((f) => f.kind === 'image')) partes.push('Para describir lo que aparece en la imagen necesito el modelo de lenguaje con visión, que todavía no está conectado. La imagen quedó guardada y asociada a esta conversación.');
    return { texto: partes.join('\n\n'), meta: { estado: 'ejecutado', fuente: { origen: fs.map((f) => f.original_name).join(', '), operacion: 'lectura y perfil del archivo', registros: fs.length, at: new Date().toISOString() } } };
  }

  async function origen() {
    const s = E.get();
    const sel = s.seleccion;
    if (!sel || !s.artefactoId) return { texto: 'Seleccioná el dato en el tablero (una fila, un punto del gráfico o un indicador) y preguntame de nuevo.' };
    d.actividad('buscando');
    if (sel.tipo === 'fila') {
      const o = await q(sb.rpc('so_origen_registro', { p_record: sel.recordId }));
      if (!o) return { texto: 'No encontré ese registro.' };
      const de = o.archivo ? `del archivo ${o.archivo.nombre}${o.archivo.version > 1 ? ` (versión ${o.archivo.version})` : ''}${o.ref?.fila ? `, fila ${o.ref.fila}` : ''}`
        : o.api ? `de la API ${o.api.nombre} (${o.api.host})` : o.lote?.origen === 'shared' ? `de una carga desde el tablero compartido${o.ref?.fila ? `, fila ${o.ref.fila}` : ''}` : 'de una carga manual';
      return { texto: `Ese dato (${o.periodo}) salió ${de}${o.lote ? `, importado el ${new Date(o.lote.fecha).toLocaleString('es-AR')} (${ESTRATEGIAS[o.lote.estrategia] || o.lote.estrategia})` : `, cargado el ${new Date(o.cargado).toLocaleString('es-AR')}`}${o.por ? ` por ${o.por}` : ''}.${o.activo ? '' : ' Hoy está reemplazado por una importación posterior.'}`,
        meta: { estado: 'verificado', fuente: { origen: o.dataset, operacion: 'linaje registro → lote → origen', registros: 1, at: new Date().toISOString() } } };
    }
    const { a, records } = await d.datosDe(s.artefactoId);
    const rs = sel.mes ? records.filter((r) => String(r.period).slice(0, 7) === sel.mes) : records;
    const porLote = new Map();
    for (const r of rs) porLote.set(r.import_batch_id || 'manual', (porLote.get(r.import_batch_id || 'manual') || 0) + 1);
    const ids = [...porLote.keys()].filter((k) => k !== 'manual');
    const lotes = ids.length ? await q(sb.from('so_import_batches').select('id, source_name, source_type, started_at').in('id', ids)) : [];
    const lineas = [...porLote.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => {
      const l = lotes.find((x) => x.id === k);
      return `• ${fmt.format(n)} registros ${l ? `de ${l.source_type === 'api' ? 'la API' : ''} ${l.source_name || 'una importación'} (${new Date(l.started_at).toLocaleDateString('es-AR')})` : 'cargados a mano o por Francisco'}`;
    });
    return { texto: `${sel.etiqueta} se calcula con ${fmt.format(rs.length)} registros de "${a.name}":\n${lineas.join('\n')}`,
      meta: { estado: 'verificado', fuente: { origen: a.name, operacion: 'agregación por lote de origen', registros: rs.length, at: new Date().toISOString() } } };
  }

  async function asegurarTablero(acc, tema = 'datos') {
    if (acc.artefactoId) return d.artefacto(acc.artefactoId);
    if (E.get().artefactoId) return d.artefacto(E.get().artefactoId);
    const cr = await d.crearArtefacto({ type: 'dashboard', name: `Dashboard de ${tema}`, tema, persistentStorage: true,
      campos: [{ key: 'valor', label: 'Valor', type: 'number' }, { key: 'detalle', label: 'Detalle', type: 'text' }], grafico: null });
    return d.artefacto(cr.meta.artifactId);
  }

  async function conectarApi(acc) {
    const a = await asegurarTablero(acc, 'cotizaciones');
    const ds = await datasetDe(a);
    d.actividad('actualizando');
    const host = new URL(acc.url).hostname;
    const src = await q(sb.from('so_api_sources').insert({ artifact_id: a.id, dataset_id: ds.id, name: host, base_url: acc.url, refresh_strategy: acc.refresco }).select('*').single());
    const inp = await q(sb.from('so_data_inputs').insert({ artifact_id: a.id, dataset_id: ds.id, name: `API ${host}`, type: 'API', refresh_strategy: acc.refresco,
      configuration: { apiSourceId: src.id, historico: acc.historico } }).select('id').single());
    await sb.from('so_api_sources').update({ input_id: inp.id }).eq('id', src.id);
    return probarYSincronizar({ ...src, input_id: inp.id }, a, ds);
  }

  async function probarYSincronizar(src, a, ds) {
    d.actividad('buscando');
    const { data: pr, error } = await sb.functions.invoke('so-api', { body: { accion: 'probar', sourceId: src.id } });
    if (error) {
      const st2 = error.context?.status; let cuerpo = null;
      try { cuerpo = await error.context?.json?.(); } catch {}
      if (st2 === 409 && cuerpo?.error === 'falta_credencial' || /credencial/.test(cuerpo?.mensaje || '')) {
        d.actividad('esperando');
        return { texto: `La API de ${src.name} necesita una credencial. Cargala en el formulario seguro (no la pegues en el chat): queda guardada cifrada y nunca vuelve a mostrarse.`,
          meta: { credencial: src.id, artifactId: a.id } };
      }
      return { ok: false, texto: `No pude consultar la API: ${cuerpo?.mensaje || (st2 ? `error ${st2}` : 'el servicio de APIs no está disponible')}.`, meta: { estado: 'fallo', reintentarApi: src.id } };
    }
    if (!pr.total) return { ok: false, texto: 'La API respondió, pero no encontré datos con forma de tabla.', meta: { estado: 'fallo' } };
    const perfil = perfilar(aMatriz(pr.muestra.length ? pr.muestra : [], 50));
    let campos = ds.fields;
    let m = mapear(perfil.columnas.filter((c) => c.key !== perfil.columnaFecha), campos);
    const sinDatosPropios = await contarActivos(ds.id) === 0;
    if (!m.inequivoco && sinDatosPropios) {
      // Tablero nuevo o vacío: adopta las columnas de la API como campos.
      campos = camposDesdeColumnas(perfil.columnas, perfil.columnaFecha ? [perfil.columnaFecha] : []);
      await q(sb.from('so_datasources').update({ fields: campos, source_types: [...new Set([...(ds.source_types || []), 'api'])] }).eq('id', ds.id));
      await q(sb.from('so_artifacts').update({ schema: { fields: campos }, configuration: { ...a.configuration, metrica: campos.find((c) => c.type === 'number')?.key ?? null, historical: true } }).eq('id', a.id));
      m = mapear(perfil.columnas.filter((c) => c.key !== perfil.columnaFecha), campos);
    }
    if (!m.inequivoco) { d.actividad('esperando'); return { texto: m.pregunta || 'No pude relacionar los datos de la API con el tablero.', meta: { artifactId: a.id } }; }
    const colOriginal = (k) => perfil.columnas.find((c) => c.key === k)?.nombre;
    const response_mapping = { ruta: pr.ruta, fecha: perfil.columnaFecha ? colOriginal(perfil.columnaFecha) : null,
      asignaciones: m.asignaciones.map((x) => ({ columna: x.columna, campo: x.campo })) };
    await q(sb.from('so_api_sources').update({ response_mapping }).eq('id', src.id));
    d.actividad('actualizando');
    const { data: sy, error: e2 } = await sb.functions.invoke('so-api', { body: { accion: 'sincronizar', sourceId: src.id } });
    if (e2) return { ok: false, texto: 'Configuré la API, pero falló la primera actualización.', meta: { estado: 'fallo', reintentarApi: src.id } };
    d.actividad('verificando');
    const { count } = await sb.from('so_records').select('id', { count: 'exact', head: true }).eq('import_batch_id', sy.lote);
    st.datos.delete(a.id);
    await d.cargarArtefactos();
    if (E.get().vista === 'artefacto' && E.get().artefactoId === a.id) d.abrirArtefacto(a.id, { forzar: true });
    return { texto: `Conecté ${src.name} a "${a.name}": ${fmt.format(sy.recibidas)} datos recibidos, ${fmt.format(sy.nuevas)} nuevos guardados${sy.repetidas ? `, ${fmt.format(sy.repetidas)} ya estaban` : ''}${sy.rechazadas ? `, ${sy.rechazadas} con problemas` : ''}. ${src.refresh_strategy === 'ON_OPEN' ? 'Se actualiza al abrir el tablero.' : 'Actualizalo cuando quieras desde "Datos y fuentes".'} Cada actualización suma al historial.`,
      meta: { estado: (count ?? 0) === sy.nuevas ? 'verificado' : 'ejecutado', artifactId: a.id, tarjeta: true,
        porque: `Mapeo: ${m.asignaciones.map((x) => `${x.columna} → ${x.campo}`).join(', ')}${response_mapping.fecha ? `; fecha: ${response_mapping.fecha}` : '; fecha: el día de la consulta'}. La credencial (si hay) se usa solo en el servidor.`,
        fuente: { origen: src.base_url, operacion: 'consulta desde el servidor + historial en Supabase', registros: sy.nuevas, at: new Date().toISOString() } } };
  }

  async function ejecutarEntrada(acc) {
    switch (acc.tipo) {
      case 'origen': return origen();
      case 'api_conectar': return conectarApi(acc);
      case 'input_archivo': {
        const a = await asegurarTablero(acc, acc.tema);
        const ds = await datasetDe(a);
        await inputArchivo(a, ds, { periodicidad: acc.periodicidad });
        await q(sb.from('so_artifacts').update({ configuration: { ...a.configuration, historical: true } }).eq('id', a.id));
        await d.cargarArtefactos();
        return { texto: `Listo: "${a.name}" recibe un archivo ${acc.periodicidad === 'semanal' ? 'por semana' : 'por mes'}. Adjuntalo acá o soltalo sobre el tablero; cada carga se suma al historial sin duplicar (si subís el mismo archivo dos veces, te aviso).`,
          meta: { estado: 'verificado', artifactId: a.id, tarjeta: true, porque: 'Estrategia: sumar al histórico. Las columnas se relacionan solas; si algo es ambiguo, te pregunto solo eso.' } };
      }
    }
    const fs = await objetivos(acc);
    if (!fs.length) return sinArchivo();
    switch (acc.tipo) {
      case 'archivo_analizar': return analizarArchivos(fs);
      case 'archivo_pregunta': case 'imagen_pregunta': return analizarArchivos(fs, acc.pregunta);
      case 'archivo_dashboard': return dashboardDesdeArchivo(fs[0], acc);
      case 'archivo_comparar': {
        if (fs.length === 1 && !acc.contraBase) {
          // "el anterior": la versión previa del mismo archivo o, si no hay, el archivo del mismo tipo subido antes.
          const previo = fs[0].version_of ? await archivo(fs[0].version_of)
            : (await listaArchivos()).find((x) => x.id !== fs[0].id && x.kind === fs[0].kind && x.created_at < fs[0].created_at);
          if (!previo) return { texto: `No encontré un archivo anterior para comparar con ${fs[0].original_name}.` };
          return compararArchivos([previo, fs[0]], null);
        }
        if (fs.length >= 2) return compararArchivos(fs[0].version_of === fs[1].id || fs[0].created_at > fs[1].created_at ? [fs[1], fs[0]] : fs, null);
        return compararArchivos(fs, acc.artefactoId ? d.artefacto(acc.artefactoId) : d.artefacto(E.get().artefactoId));
      }
      case 'archivo_importar': {
        const a = acc.artefactoId ? d.artefacto(acc.artefactoId) : d.artefacto(E.get().artefactoId);
        if (!a) {
          if (fs[0].kind === 'table') return dashboardDesdeArchivo(fs[0]);
          return { texto: '¿En qué tablero lo cargo?' };
        }
        if (fs[0].kind !== 'table') return { texto: `${fs[0].original_name} no tiene datos en forma de tabla para cargar en "${a.name}". Puedo analizarlo o responder preguntas sobre su contenido.` };
        return importarArchivo(fs[0], a, { texto: acc.texto });
      }
      case 'importar_forzado': return importarArchivo(await archivo(acc.fileId), d.artefacto(acc.artefactoId), { texto: acc.texto, forzar: true });
      case 'importar_confirmado': return importarArchivo(await archivo(acc.fileId), d.artefacto(acc.artefactoId), { texto: acc.texto, estrategia: acc.estrategia });
    }
    return null;
  }
  // Las propuestas de alto impacto vuelven por acá al confirmarse.
  const esAccionDatos = (t) => ['importar_forzado', 'importar_confirmado'].includes(t);

  // ---------------------------------------------------------------- vista previa de importación (ImportPreview + MappingEditor)
  async function abrirImportacion(fileOrId, artefactoId) {
    const a = d.artefacto(artefactoId);
    if (!a) return;
    let f;
    if (typeof fileOrId === 'string') f = await archivo(fileOrId);
    else {
      const [it] = await entrada.agregar([fileOrId], 'dashboard', { artifactId: a.id });
      d.notificar('info', `Subiendo ${it.nombre}…`, null, { group_key: `subida:${a.id}`, artifact_id: a.id });
      await it.promesa;
      if (!['listo', 'parcial'].includes(it.estado)) { d.notificar('action', `No pude cargar ${it.nombre}`, it.error, { group_key: `subida:${a.id}`, artifact_id: a.id }); return; }
      archivosCache.delete(it.fileId);
      f = await archivo(it.fileId);
    }
    const ds = await datasetDe(a);
    const { tabla, normal } = await entrada.tablaDe(f.id);
    const form = $('formImportar');
    if (!tabla) { form.innerHTML = `<header class="dlg-cab"><h2>${esc(f.original_name)}</h2></header><p>No encontré una tabla en el archivo.</p><div class="msg-acc"><button value="cancelar">Cerrar</button></div>`; $('dlgImportar').showModal(); return; }
    let hoja = 0;
    const pintar = async () => {
      const p = normal.tablas[hoja].perfil;
      const plan = await planificar(sb, { perfil: p, dataset: ds, checksum: f.checksum });
      const cols = p.columnas;
      form.innerHTML = `<header class="dlg-cab"><h2>Importar ${esc(f.original_name)} en "${esc(a.name)}"</h2><button type="button" data-cerrar aria-label="Cerrar">✕</button></header>
        ${normal.tablas.length > 1 ? `<label>Hoja <select name="hoja">${normal.tablas.map((t, i) => `<option value="${i}" ${i === hoja ? 'selected' : ''}>${esc(t.nombre)} (${t.perfil.filas} filas)</option>`).join('')}</select></label>` : ''}
        <p>${p.filas} filas · ${cols.length} columnas${p.problemas.length ? ` · <span class="aviso-txt">${esc(p.problemas.join('; '))}</span>` : ''}</p>
        ${plan.previo ? `<p class="alerta-txt" role="alert">Este archivo parece haber sido importado anteriormente (${new Date(plan.previo.started_at).toLocaleDateString('es-AR')}, ${fmt.format(plan.previo.rows_accepted)} registros). Si lo importás igual, se suman de nuevo.</p>` : ''}
        <fieldset><legend>Columnas</legend><div class="mapeo">${cols.map((c) => {
          const asig = plan.mapeo.asignaciones.find((x) => x.columnaKey === c.key);
          const sel = c.key === plan.columnaFecha ? '__fecha' : asig ? asig.campo : plan.nuevas.some((x) => x.key === c.key) ? '__nuevo' : '__no';
          return `<label><span>${esc(c.nombre)} <small>${esc({ number: 'número', date: 'fecha', text: 'texto' }[c.tipo])}${c.muestra.length ? ` · ej. ${esc(String(c.muestra[0]).slice(0, 20))}` : ''}</small></span>
            <select name="col:${esc(c.key)}"><option value="__fecha" ${sel === '__fecha' ? 'selected' : ''}>Fecha del registro</option>
            ${ds.fields.map((fl) => `<option value="${esc(fl.key)}" ${sel === fl.key ? 'selected' : ''}>${esc(fl.label || fl.key)}</option>`).join('')}
            <option value="__nuevo" ${sel === '__nuevo' ? 'selected' : ''}>Campo nuevo</option><option value="__no" ${sel === '__no' ? 'selected' : ''}>No importar</option></select></label>`;
        }).join('')}</div>${plan.mapeo.ambiguedades.length ? `<p class="aviso-txt">${esc(plan.mapeo.pregunta)}</p>` : ''}</fieldset>
        <fieldset><legend>Cómo cargarlo</legend>${Object.entries(ESTRATEGIAS).map(([k, v]) => `<label class="radio"><input type="radio" name="estrategia" value="${k}" ${k === (plan.estrategia.estrategia === 'REPLACE' ? 'APPEND' : plan.estrategia.estrategia) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
          <label class="clave" ${plan.estrategia.estrategia === 'UPSERT' ? '' : 'hidden'}>Clave <select name="clave">${cols.map((c) => `<option value="${esc(c.key)}" ${p.clavesProbables[0] === c.key ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label></fieldset>
        <p class="resumen-import" aria-live="polite"></p>
        <div class="msg-acc"><button type="submit" value="importar" class="primario">Importar</button><button type="button" data-cerrar>Cancelar</button></div>`;
      const leer = () => {
        const fd = new FormData(form);
        const asignaciones = []; let fecha = null; const nuevos = [];
        for (const c of cols) {
          const v = fd.get(`col:${c.key}`);
          if (v === '__fecha') fecha = c.key; else if (v === '__nuevo') nuevos.push(c); else if (v !== '__no') asignaciones.push({ columna: c.nombre, columnaKey: c.key, campo: v, confianza: 1 });
        }
        return { asignaciones, fecha, nuevos, estrategia: fd.get('estrategia'), clave: fd.get('clave') };
      };
      const resumen = () => {
        const x = leer();
        form.querySelector('.clave').hidden = x.estrategia !== 'UPSERT';
        const campos = [...ds.fields, ...camposDesdeColumnas(x.nuevos)];
        const conv = convertir(p, [...x.asignaciones, ...x.nuevos.map((c) => ({ columna: c.nombre, columnaKey: c.key, campo: c.key }))], campos, { columnaFecha: x.fecha });
        const dupCampo = x.asignaciones.map((y) => y.campo).find((c, i, arr) => arr.indexOf(c) !== i);
        form.querySelector('.resumen-import').innerHTML = dupCampo ? `<span class="aviso-txt">Dos columnas van al mismo campo (${esc(dupCampo)}): elegí una.</span>`
          : `Se incorporarán <strong>${fmt.format(conv.validas.length)}</strong> registros${conv.rechazadas.length ? `; <strong>${fmt.format(conv.rechazadas.length)}</strong> necesitan revisión (por ejemplo, fila ${conv.rechazadas[0].fila}: ${esc(conv.rechazadas[0].motivo)})` : ''}.${x.estrategia === 'REPLACE' ? ' Los registros actuales dejan de mostrarse (reversible).' : ''}${!x.fecha ? ' Sin columna de fecha: se usa la fecha de hoy.' : ''}`;
        form.querySelector('[value="importar"]').disabled = !!dupCampo || !conv.validas.length;
      };
      form.querySelectorAll('select, input').forEach((el) => el.addEventListener('change', (e) => { if (e.target.name === 'hoja') { hoja = Number(e.target.value); pintar(); } else resumen(); }));
      form.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => $('dlgImportar').close()));
      resumen();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const x = leer();
        if (x.estrategia === 'REPLACE' && !confirm('Los registros actuales del tablero dejan de mostrarse y se reemplazan por los del archivo. Podés deshacerlo después. ¿Confirmás?')) return;
        form.querySelector('[value="importar"]').disabled = true;
        form.querySelector('.resumen-import').textContent = 'Importando…';
        try {
          const plan2 = { ...plan, columnaFecha: x.fecha, nuevas: x.nuevos };
          const r = await importar(sb, plan2, { dataset: ds, artifactId: a.id, inputId: await inputArchivo(a, ds), fileId: f.id, checksum: f.checksum, nombre: f.original_name,
            estrategia: x.estrategia, clave: x.clave, asignaciones: x.asignaciones, agregarCampos: true,
            progreso: (pp) => { form.querySelector('.resumen-import').textContent = `Importando… ${Math.round(pp * 100)}%`; } });
          $('dlgImportar').close();
          st.datos.delete(a.id);
          const t = tarjetaImport(r, f.original_name, a);
          d.notificar(r.rechazadas.length ? 'action' : 'success', `${f.original_name}: ${fmt.format(r.aceptadas)} registros incorporados${r.rechazadas.length ? `, ${r.rechazadas.length} necesitan revisión` : ''}`, null,
            { group_key: `import:${a.id}`, artifact_id: a.id });
          d.evento('task_completed', r.aceptadas, { kind: 'import', via: 'panel' });
          d.resultadoImportacion?.(t);
          d.abrirArtefacto(a.id, { forzar: true });
        } catch (err) {
          form.querySelector('.resumen-import').innerHTML = `<span class="aviso-txt">No pude importar: ${esc(err.message)}. El archivo quedó guardado; podés reintentar.</span>`;
          form.querySelector('[value="importar"]').disabled = false;
        }
      };
    };
    await pintar();
    if (!$('dlgImportar').open) $('dlgImportar').showModal();
  }

  // ---------------------------------------------------------------- formulario de API (credencial segura)
  function abrirApi(artefactoId, srcExistente = null) {
    const a = d.artefacto(artefactoId);
    const form = $('formApi');
    form.innerHTML = `<header class="dlg-cab"><h2>${srcExistente ? 'Credencial de la API' : `Conectar una API a "${esc(a?.name || '')}"`}</h2><button type="button" data-cerrar aria-label="Cerrar">✕</button></header>
      ${srcExistente ? `<p>${esc(srcExistente.name)} · ${esc(srcExistente.base_url)}</p>` : `<label>Dirección (https) <input name="url" type="url" required placeholder="https://api.ejemplo.com/v1/datos" pattern="https://.*"></label>
      <label>Actualización <select name="refresco"><option value="MANUAL">Cuando yo lo pida</option><option value="ON_OPEN">Al abrir el tablero (si pasaron 15 min)</option></select></label>`}
      <fieldset><legend>Credencial (si la API la pide)</legend>
        <label>Tipo <select name="esquema"><option value="none">No necesita</option><option value="bearer">Token (Bearer)</option><option value="header">Encabezado</option><option value="query">Parámetro en la dirección</option></select></label>
        <label class="cred" hidden>Nombre <input name="nombre" placeholder="X-API-Key" pattern="[A-Za-z0-9_-]{1,64}"></label>
        <label class="cred" hidden>Valor <input name="secreto" type="password" autocomplete="off" spellcheck="false"></label>
        <p class="vacio">Se guarda cifrada en Supabase Vault; nunca vuelve a mostrarse ni se envía al navegador. Las llamadas salen del servidor.</p></fieldset>
      <p class="resumen-import" aria-live="polite"></p>
      <div class="msg-acc"><button type="submit" class="primario">${srcExistente ? 'Guardar y probar' : 'Probar y conectar'}</button><button type="button" data-cerrar>Cancelar</button></div>`;
    const esq = form.querySelector('[name="esquema"]');
    const actualizar = () => form.querySelectorAll('.cred').forEach((el, i) => { el.hidden = esq.value === 'none' || (i === 0 && esq.value === 'bearer'); });
    esq.onchange = actualizar; actualizar();
    form.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => $('dlgApi').close()));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const out = form.querySelector('.resumen-import');
      out.textContent = 'Probando…';
      try {
        let src = srcExistente;
        if (!src) {
          const ds = await datasetDe(a);
          const url = String(fd.get('url'));
          src = await q(sb.from('so_api_sources').insert({ artifact_id: a.id, dataset_id: ds.id, name: new URL(url).hostname, base_url: url, refresh_strategy: String(fd.get('refresco')),
            auth_scheme: String(fd.get('esquema')), auth_name: fd.get('nombre') ? String(fd.get('nombre')) : null }).select('*').single());
          const inp = await q(sb.from('so_data_inputs').insert({ artifact_id: a.id, dataset_id: ds.id, name: `API ${src.name}`, type: 'API', refresh_strategy: src.refresh_strategy,
            configuration: { apiSourceId: src.id } }).select('id').single());
          await sb.from('so_api_sources').update({ input_id: inp.id }).eq('id', src.id);
          src.input_id = inp.id;
        } else if (fd.get('esquema') !== 'none') {
          await q(sb.from('so_api_sources').update({ auth_scheme: String(fd.get('esquema')), auth_name: fd.get('nombre') ? String(fd.get('nombre')) : null }).eq('id', src.id));
        }
        const secreto = String(fd.get('secreto') || '');
        if (secreto) await q(sb.rpc('so_api_guardar_secreto', { p_source: src.id, p_secreto: secreto }));
        form.querySelector('[name="secreto"]').value = '';
        const r = await probarYSincronizar(src, a, await datasetDe(a));
        $('dlgApi').close();
        d.resultadoImportacion?.(r);
        pintarPanel(a.id);
      } catch (err) { out.innerHTML = `<span class="aviso-txt">No pude conectarla: ${esc(err.message)}.</span>`; }
    };
    $('dlgApi').showModal();
  }

  // ---------------------------------------------------------------- panel "Datos y fuentes" (DataSourceManager)
  async function pintarPanel(artefactoId) {
    const a = d.artefacto(artefactoId);
    const c = $('datosCuerpo');
    if (!a) { c.innerHTML = ''; return; }
    st.puedeImportarAqui = true;
    let ds, inputs = [], apis = [], lotes = [], usan = [], activos = 0;
    try {
      [ds, inputs, apis, lotes, usan, activos] = await Promise.all([
        datasetDe(a),
        q(sb.from('so_data_inputs').select('*').eq('artifact_id', a.id).neq('status', 'removed').order('created_at')),
        q(sb.from('so_api_sources').select('id, name, base_url, status, last_sync_at, last_error, refresh_strategy, auth_scheme, auth_ref, input_id').eq('artifact_id', a.id)),
        q(sb.from('so_import_batches').select('id, source_name, source_type, strategy, status, rows_accepted, rows_rejected, rows_superseded, started_at, errors, anulacion').eq('dataset_id', a.datasource_id).order('started_at', { ascending: false }).limit(200)),
        q(sb.from('so_artifacts').select('id, name').eq('datasource_id', a.datasource_id).neq('id', a.id).is('deleted_at', null)),
        contarActivos(a.datasource_id),
      ]);
    } catch (err) { c.innerHTML = `<p class="error">No pude cargar las fuentes: ${esc(err.message)}. <button type="button" class="enlace" data-reintentar-panel>Reintentar</button></p>`; c.querySelector('[data-reintentar-panel]').onclick = () => pintarPanel(artefactoId); return; }
    const compartirCarga = !!a.permissions?.shared_input;
    const tab = st.tabDatos === 'historicos' ? 'historicos' : 'fuentes';
    const vigentes = lotes.filter((l) => l.status !== 'undone').length;
    const fecha = (x) => new Date(x).toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    c.innerHTML = `
      <div class="tabs-datos" role="tablist" aria-label="Datos del tablero">
        <button type="button" role="tab" data-tabd="fuentes" aria-selected="${tab === 'fuentes'}">Fuentes</button>
        <button type="button" role="tab" data-tabd="historicos" aria-selected="${tab === 'historicos'}">Históricos <small>${fmt.format(vigentes)}${lotes.length > vigentes ? ` + ${fmt.format(lotes.length - vigentes)} anuladas` : ''}</small></button>
      </div>
      <section data-panel-d="historicos" role="tabpanel"${tab === 'historicos' ? '' : ' hidden'}>
        <p class="vacio">Cada subida queda en el histórico con su fecha. Anularla saca sus datos del tablero <b>sin borrarlos</b>: si había reemplazado datos anteriores, esos vuelven. Podés restaurarla mientras no haya subidas posteriores.</p>
        <ul class="lista historicos">${lotes.map((l) => {
          const anulada = l.status === 'undone';
          const puedeRestaurar = anulada && l.anulacion && !l.anulacion.restaurada_at;
          return `<li class="${anulada ? 'anulada' : ''}"><span>${{ file: '📄', api: '🔌', shared: '👥', manual: '✍️' }[l.source_type] || '•'} ${esc(l.source_name || 'importación')}
            <small>${esc(fecha(l.started_at))} · ${esc(ESTRATEGIAS[l.strategy])} · ${fmt.format(l.rows_accepted)} incorporados${l.rows_rejected ? ` · ${fmt.format(l.rows_rejected)} a revisar` : ''}${l.rows_superseded ? ` · ${fmt.format(l.rows_superseded)} reemplazados` : ''} · ${esc({ ready: 'vigente', partial: 'vigente (parcial)', failed: 'falló', undone: 'anulada', importing: 'en curso', expired: 'vencida' }[l.status])}${anulada && l.anulacion?.at ? ` el ${esc(fecha(l.anulacion.at))}` : ''}</small></span>
            <span class="fila-acc">${l.rows_rejected ? `<button type="button" data-incid="${l.id}">Ver incidencias</button>` : ''}${anulada ? (puedeRestaurar ? `<button type="button" data-restaurar-lote="${l.id}">Restaurar</button>` : '') : `<button type="button" data-anular-lote="${l.id}">Anular</button>`}</span></li>`;
        }).join('') || '<li class="vacio">Todavía no hubo subidas.</li>'}</ul>
      </section>
      <section data-panel-d="fuentes" role="tabpanel"${tab === 'fuentes' ? '' : ' hidden'}>
      <p class="vacio">Dataset <strong>${esc(ds.name)}</strong> · ${fmt.format(activos)} registros activos · ${ds.fields.length} campos${usan.length ? ` · también lo usan: ${usan.map((x) => esc(x.name)).join(', ')}` : ''}</p>
      <div class="msg-acc"><label class="boton-archivo">Subir archivo<input type="file" data-subir hidden></label>
        <button type="button" data-api>Conectar API</button>
        <button type="button" data-dataset>Usar otro dataset…</button></div>
      <h4>Fuentes</h4>
      <ul class="lista">${inputs.map((i) => {
        const api = apis.find((x) => x.input_id === i.id);
        const etiqueta = { FILE_UPLOAD: '📄 Archivos', API: '🔌 API', MANUAL_INPUT: '✍️ Carga manual', EXISTING_DATASET: '🗃 Dataset', CONNECTOR: '🔗 Conector', GENERATED: '⚙️ Generado' }[i.type];
        const detalle = api ? api.name : etiqueta.includes(i.name) ? (i.configuration?.periodicidad ? `(${i.configuration.periodicidad})` : '') : i.name;
        return `<li><span>${etiqueta} ${esc(detalle)}
          <small>${api ? `${esc({ ok: 'funcionando', error: `con error${api.last_error ? `: ${api.last_error}` : ''}`, draft: 'sin probar', paused: 'pausada' }[api.status])} · ${api.last_sync_at ? `actualizada ${esc(d.haceCuanto(api.last_sync_at))}` : 'sin actualizar'} · ${api.refresh_strategy === 'ON_OPEN' ? 'al abrir' : 'manual'}${api.auth_scheme !== 'none' ? ` · credencial ${api.auth_ref ? 'guardada' : 'pendiente'}` : ''}`
            : i.last_updated_at ? `última carga ${esc(d.haceCuanto(i.last_updated_at))}` : 'sin cargas todavía'}</small></span>
          <span class="fila-acc">${api ? `<button type="button" data-sync="${api.id}">Actualizar ahora</button><button type="button" data-cred="${api.id}">Credencial</button>` : ''}
          <button type="button" data-quitar-input="${i.id}">Quitar</button></span></li>`;
      }).join('') || '<li class="vacio">Sin fuentes declaradas: los datos se cargan a mano o con Francisco.</li>'}</ul>
      <label class="radio"><input type="checkbox" data-shared-input ${compartirCarga ? 'checked' : ''}> Quienes usan este tablero compartido pueden cargar datos</label>
      <p class="vacio">${compartirCarga ? 'Las personas con permiso "Usar" pueden cargar filas o archivos (nunca ven tus archivos fuente ni otras fuentes).' : 'Solo vos y quienes pueden modificarlo cargan datos.'}</p>
      </section>`;
    c.querySelectorAll('[data-tabd]').forEach((b) => b.addEventListener('click', () => {
      st.tabDatos = b.dataset.tabd;
      c.querySelectorAll('[data-tabd]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      c.querySelectorAll('[data-panel-d]').forEach((p) => { p.hidden = p.dataset.panelD !== b.dataset.tabd; });
    }));
    c.querySelector('[data-subir]').onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) abrirImportacion(f, a.id); };
    c.querySelector('[data-api]').onclick = () => abrirApi(a.id);
    c.querySelector('[data-dataset]').onclick = () => elegirDataset(a);
    c.querySelectorAll('[data-sync]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Actualizando…';
      const src = apis.find((x) => x.id === b.dataset.sync);
      const { data, error } = await sb.functions.invoke('so-api', { body: { accion: 'sincronizar', sourceId: src.id } });
      let msg = null; if (error) { try { msg = (await error.context?.json?.())?.mensaje; } catch {} }
      d.notificar(error ? 'action' : 'success', error ? `No pude actualizar ${src.name}` : `${src.name}: ${data.nuevas} datos nuevos`, error ? (msg || 'Probá de nuevo en un momento.') : null, { group_key: `api:${src.id}`, artifact_id: a.id });
      st.datos.delete(a.id); d.abrirArtefacto(a.id, { forzar: true });
    }));
    c.querySelectorAll('[data-cred]').forEach((b) => b.addEventListener('click', () => abrirApi(a.id, apis.find((x) => x.id === b.dataset.cred))));
    c.querySelectorAll('[data-quitar-input]').forEach((b) => b.addEventListener('click', async () => {
      await q(sb.from('so_data_inputs').update({ status: 'removed' }).eq('id', b.dataset.quitarInput));
      const api = apis.find((x) => x.input_id === b.dataset.quitarInput);
      if (api) await q(sb.from('so_api_sources').update({ status: 'paused' }).eq('id', api.id));
      pintarPanel(a.id);   // los datos ya importados se conservan
    }));
    c.querySelectorAll('[data-incid]').forEach((b) => b.addEventListener('click', () => verIncidencias(lotes.find((l) => l.id === b.dataset.incid))));
    // Anular / restaurar una subida del histórico (no borra filas; ver so_anular_importacion).
    const recargar = () => { st.datos.delete(a.id); pintarPanel(a.id); d.abrirArtefacto(a.id, { forzar: true }); };
    c.querySelectorAll('[data-anular-lote]').forEach((b) => b.addEventListener('click', async () => {
      const l = lotes.find((x) => x.id === b.dataset.anularLote);
      if (!confirm(`¿Anular "${l.source_name || 'la subida'}" del ${fecha(l.started_at)}? Sus ${fmt.format(l.rows_accepted)} registros dejan de contar en el tablero${l.rows_superseded ? ' y vuelven los datos que había reemplazado' : ''}. No se borra nada: podés restaurarla.`)) return;
      b.disabled = true;
      try { const r = await q(sb.rpc('so_anular_importacion', { p_batch: l.id })); d.evento('undo', null, { tipo: 'importacion' });
        d.notificar('info', `Subida anulada: ${fmt.format(r.anuladas || 0)} registros fuera del tablero${r.reactivadas ? `, ${fmt.format(r.reactivadas)} recuperados` : ''}`, 'Podés restaurarla desde Datos y fuentes → Históricos.', { artifact_id: a.id }); }
      catch (err) { d.notificar('action', 'No pude anular la subida', err.message, { artifact_id: a.id }); }
      recargar();
    }));
    c.querySelectorAll('[data-restaurar-lote]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await q(sb.rpc('so_restaurar_importacion', { p_batch: b.dataset.restaurarLote }));
        d.notificar('success', `Subida restaurada: ${fmt.format(r.restauradas || 0)} registros vuelven al tablero`, null, { artifact_id: a.id }); }
      catch (err) { d.notificar('action', 'No pude restaurar la subida', err.message, { artifact_id: a.id }); }
      recargar();
    }));
    c.querySelector('[data-shared-input]').onchange = async (e) => {
      await q(sb.from('so_artifacts').update({ permissions: { ...(a.permissions || {}), shared_input: e.target.checked } }).eq('id', a.id));
      await d.cargarArtefactos(); pintarPanel(a.id);
    };
  }

  function verIncidencias(l) {
    const c = $('dlgArchivoCuerpo');
    c.innerHTML = `<header class="dlg-cab"><h2>Incidencias de ${esc(l.source_name || 'la importación')}</h2><button type="button" data-cerrar aria-label="Cerrar">✕</button></header>
      <p>${fmt.format(l.rows_rejected)} filas no se incorporaron. Nada inválido se cargó.</p>
      <ul class="lista">${(l.errors || []).slice(0, 100).map((e) => `<li>Fila ${esc(e.fila)} — ${esc(e.motivo)}</li>`).join('')}</ul>
      <div class="msg-acc"><button type="button" data-csv>Descargar incidencias</button></div>`;
    c.querySelector('[data-cerrar]').onclick = () => $('dlgArchivo').close();
    c.querySelector('[data-csv]').onclick = () => {
      const url = URL.createObjectURL(new Blob([incidenciasCSV(l.errors || [])], { type: 'text/csv' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `incidencias-${(l.source_name || 'importacion').replace(/\.[a-z0-9]+$/i, '')}.csv` });
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $('dlgArchivo').showModal();
  }

  async function elegirDataset(a) {
    const dss = await q(sb.from('so_datasources').select('id, name, fields').neq('id', a.datasource_id).order('updated_at', { ascending: false }).limit(50));
    const c = $('dlgArchivoCuerpo');
    c.innerHTML = `<header class="dlg-cab"><h2>Usar un dataset existente</h2><button type="button" data-cerrar aria-label="Cerrar">✕</button></header>
      <p class="vacio">"${esc(a.name)}" pasa a mostrar los datos del dataset elegido (sin copiarlos). El dataset actual no se borra.</p>
      <ul class="lista">${dss.map((x) => `<li><span>🗃 ${esc(x.name)} <small>${x.fields.length} campos</small></span><button type="button" data-usar="${x.id}">Usar</button></li>`).join('') || '<li class="vacio">No tenés otros datasets.</li>'}</ul>`;
    c.querySelector('[data-cerrar]').onclick = () => $('dlgArchivo').close();
    c.querySelectorAll('[data-usar]').forEach((b) => b.addEventListener('click', async () => {
      const nuevo = dss.find((x) => x.id === b.dataset.usar);
      await q(sb.from('so_artifacts').update({ datasource_id: nuevo.id, schema: { fields: nuevo.fields }, configuration: { ...a.configuration, metrica: nuevo.fields.find((f) => f.type === 'number')?.key ?? null } }).eq('id', a.id));
      await sb.from('so_data_inputs').insert({ artifact_id: a.id, dataset_id: nuevo.id, name: nuevo.name, type: 'EXISTING_DATASET', configuration: { anterior: a.datasource_id } });
      $('dlgArchivo').close();
      d.resultadoImportacion?.({ texto: `"${a.name}" ahora usa el dataset "${nuevo.name}".`, meta: { estado: 'verificado', artifactId: a.id, undo: { tipo: 'dataset', artifactId: a.id, anterior: a.datasource_id } } });
      st.datos.delete(a.id); await d.cargarArtefactos(); d.abrirArtefacto(a.id, { forzar: true });
    }));
    $('dlgArchivo').showModal();
  }

  // ON_OPEN: al abrir el tablero, actualiza en segundo plano las APIs vencidas (≥ 15 min), sin bloquear.
  async function refrescarAlAbrir(artefactoId) {
    let apis = [];
    try { apis = await q(sb.from('so_api_sources').select('id, name, last_sync_at').eq('artifact_id', artefactoId).eq('refresh_strategy', 'ON_OPEN').eq('status', 'ok')); } catch { return; }
    const vencidas = apis.filter((x) => !x.last_sync_at || Date.now() - Date.parse(x.last_sync_at) > 15 * 60000);
    for (const x of vencidas) {
      const { data, error } = await sb.functions.invoke('so-api', { body: { accion: 'sincronizar', sourceId: x.id } });
      if (!error && data?.nuevas) { st.datos.delete(artefactoId); if (E.get().artefactoId === artefactoId) d.abrirArtefacto(artefactoId, { forzar: true }); }
    }
  }

  // Reanudar una importación interrumpida (página cerrada o error): usa el archivo ya guardado y el mismo lote.
  async function reanudar(t) {
    const f = await archivo(t.input?.fileId);
    const a = d.artefacto(t.artifact_id);
    if (!f || !a) return d.notificar('action', 'No pude reanudar la importación', 'El archivo o el tablero ya no están disponibles.');
    d.evento('retry', null, { kind: 'import' });
    try {
      const r = await importarArchivo(f, a, { forzar: true, estrategia: t.input?.estrategia || 'APPEND', loteExistente: t.input?.loteId || null, tareaId: t.id });
      if (r.ok !== false) d.evento('recovery_success', null, { kind: 'import' });
      d.resultadoImportacion?.(r);
    } catch { /* ya notificado */ }
  }

  async function incidenciasDe(loteId) {
    const l = await q(sb.from('so_import_batches').select('id, source_name, rows_rejected, errors').eq('id', loteId).single());
    verIncidencias(l);
  }
  async function reintentarApi(srcId) {
    const src = await q(sb.from('so_api_sources').select('*').eq('id', srcId).single());
    const a = d.artefacto(src.artifact_id);
    return probarYSincronizar(src, a, await datasetDe(a));
  }
  async function credencial(srcId) {
    const src = await q(sb.from('so_api_sources').select('*').eq('id', srcId).single());
    abrirApi(src.artifact_id, src);
  }

  return { adjuntar, tomarAdjuntos, asociarMensaje, htmlAdjuntos, conectarAdjuntos, vistaPrevia, ejecutarEntrada, esAccionDatos, pintarPanel, abrirImportacion,
    abrirApi, refrescarAlAbrir, probarYSincronizar, archivo, entrada, listaArchivos, olvidar, incidenciasDe, reintentarApi, credencial, reanudar };
}
