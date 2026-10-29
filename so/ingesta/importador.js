// SO · importación de datos a un dataset con lote (ImportBatch): mapeo, estrategia, filas válidas e inválidas,
// duplicados, linaje y reversión. Lo usan Francisco, el panel "Datos y fuentes" y la vista compartida (vía RPC).
import { mapear, convertir, inferirEstrategia, camposDesdeColumnas } from './mapeo.js';

const LOTE = 500;

/**
 * Plan de importación: qué columnas van a qué campos, estrategia, duplicados y calidad. No escribe nada.
 */
export async function planificar(sb, { perfil, dataset, texto = '', checksum = null }) {
  const campos = dataset.fields || [];
  const cols = perfil.columnas.filter((c) => c.key !== perfil.columnaFecha);
  const mapeo = mapear(cols, campos);
  const est = inferirEstrategia(texto, { claves: perfil.clavesProbables.filter((k) => campos.some((f) => f.key === k) || mapeo.asignaciones.some((a) => a.columnaKey === k)) });
  let previo = null;
  if (checksum) {
    const { data } = await sb.from('so_import_batches').select('id, source_name, started_at, rows_accepted, status')
      .eq('dataset_id', dataset.id).eq('checksum', checksum).in('status', ['importing', 'ready', 'partial']).order('started_at', { ascending: false }).limit(1);
    previo = data?.[0] || null;
  }
  const nuevas = mapeo.nuevas.filter((c) => c.key !== perfil.columnaFecha);
  return { perfil, mapeo, estrategia: est, previo, nuevas, columnaFecha: perfil.columnaFecha };
}

/**
 * Ejecuta el plan: amplía campos si hace falta, crea el lote, inserta por partes (idempotente), aplica la estrategia
 * (REPLACE/UPSERT marcan, no borran) y cierra el lote con el resumen. `progreso(0..1)` informa avance real.
 */
export async function ejecutar(sb, plan, { dataset, artifactId = null, inputId = null, fileId = null, apiSourceId = null, checksum = null, nombre = null,
  estrategia = plan.estrategia.estrategia, clave = plan.estrategia.clave || null, agregarCampos = true, asignaciones = plan.mapeo.asignaciones, sourceType = 'file',
  progreso = () => {}, alCrearLote = () => {}, loteExistente = null, hoy } = {}) {
  let campos = dataset.fields || [];
  let camposAgregados = [];
  let asig = [...asignaciones];
  if (agregarCampos && plan.nuevas.length) {
    camposAgregados = camposDesdeColumnas(plan.nuevas).filter((f) => !campos.some((c) => c.key === f.key));
    if (camposAgregados.length) {
      const fields = [...campos, ...camposAgregados];
      const { error } = await sb.from('so_datasources').update({ fields, updated_at: new Date().toISOString() }).eq('id', dataset.id);
      if (error) throw new Error(error.message);
      campos = fields;
      asig = [...asig, ...camposAgregados.map((f) => ({ columna: plan.nuevas.find((c) => c.key === f.key).nombre, columnaKey: f.key, campo: f.key, confianza: 1, motivo: 'columna nueva' }))];
    }
  }
  if (estrategia === 'UPSERT' && !clave) estrategia = 'APPEND';
  const { validas, rechazadas } = convertir(plan.perfil, asig, campos, { columnaFecha: plan.columnaFecha, hoy });
  // Reanudar: el mismo lote y las mismas claves de idempotencia → lo ya cargado no se duplica.
  const { data: lote, error: e1 } = loteExistente ? await sb.from('so_import_batches').update({ status: 'importing' }).eq('id', loteExistente).select('id').single()
    : await sb.from('so_import_batches').insert({
    dataset_id: dataset.id, artifact_id: artifactId, input_id: inputId, source_file_id: fileId, api_source_id: apiSourceId, source_type: sourceType,
    strategy: estrategia, key_field: estrategia === 'UPSERT' ? clave : null, checksum, source_name: nombre,
    mapping: { asignaciones: asig.map((a) => ({ columna: a.columna, campo: a.campo })), fecha: plan.columnaFecha }, rows_received: validas.length + rechazadas.length,
  }).select('id').single();
  if (e1) throw new Error(e1.message);
  await alCrearLote(lote.id);
  let aceptadas = 0;
  try {
    for (let i = 0; i < validas.length; i += LOTE) {
      const filas = validas.slice(i, i + LOTE).map((v) => ({ datasource_id: dataset.id, owner_id: dataset.owner_id, period: v.period, data: v.data,
        import_batch_id: lote.id, source_ref: { fila: v.fila }, idempotency_key: `${lote.id}:${v.fila}` }));
      const { error } = await sb.from('so_records').upsert(filas, { onConflict: 'datasource_id,idempotency_key', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      aceptadas += filas.length;
      progreso(aceptadas / Math.max(1, validas.length));
    }
    let reemplazadas = 0;
    if (estrategia === 'REPLACE' || estrategia === 'UPSERT') {
      const { data, error } = await sb.rpc('so_aplicar_estrategia', { p_batch: lote.id });
      if (error) throw new Error(error.message);
      reemplazadas = data || 0;
    }
    const estado = rechazadas.length ? 'partial' : 'ready';
    await sb.from('so_import_batches').update({ status: estado, rows_accepted: aceptadas, rows_rejected: rechazadas.length, rows_superseded: reemplazadas,
      errors: rechazadas.slice(0, 500), error_summary: rechazadas.length ? resumenErrores(rechazadas) : null, completed_at: new Date().toISOString() }).eq('id', lote.id);
    if (inputId) await sb.from('so_data_inputs').update({ last_updated_at: new Date().toISOString(), status: 'active' }).eq('id', inputId);
    if (fileId) await sb.from('so_files').update({ status: estado === 'ready' ? 'ready' : 'partial', retention: 'lineage', expires_at: null, artifact_id: artifactId }).eq('id', fileId);
    return { loteId: lote.id, estrategia, aceptadas, rechazadas, reemplazadas, camposAgregados, estado };
  } catch (err) {
    await sb.from('so_import_batches').update({ status: 'failed', rows_accepted: aceptadas, error_summary: err.message.slice(0, 500), completed_at: new Date().toISOString() }).eq('id', lote.id);
    throw Object.assign(err, { loteId: lote.id });
  }
}

export function resumenErrores(rechazadas) {
  const motivos = new Map();
  for (const r of rechazadas) { const k = r.motivo.replace(/\(".*"\)/, '').trim(); motivos.set(k, (motivos.get(k) || 0) + 1); }
  return [...motivos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${n} × ${m}`).join('; ');
}

export function incidenciasCSV(errores) {
  return 'fila;motivo\n' + errores.map((e) => `${e.fila};"${String(e.motivo).replace(/"/g, '""')}"`).join('\n');
}

export const ESTRATEGIAS = {
  APPEND: 'Sumar al histórico', UPSERT: 'Actualizar por clave (sin duplicar)', REPLACE: 'Reemplazar todo (reversible)', TEMPORARY: 'Prueba temporal (24 h)',
};
