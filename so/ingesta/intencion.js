// SO · intenciones sobre adjuntos, archivos guardados y fuentes de datos. Se evalúa antes que el resto de las
// intenciones: si el pedido no habla de archivos, APIs ni origen de datos, devuelve null. Puro.
import { normalizar, resolverArtefacto } from '../intent.js';

const URL_RE = /https:\/\/[^\s<>"')]+/i;
const DOCS = { excel: ['xlsx', 'xls', 'ods', 'csv'], planilla: ['xlsx', 'xls', 'ods', 'csv'], csv: ['csv', 'tsv'], pdf: ['pdf'], word: ['docx', 'odt'],
  documento: ['pdf', 'docx', 'odt', 'txt', 'md', 'rtf'], presentacion: ['pptx', 'odp'], foto: ['png', 'jpeg', 'webp', 'gif', 'heic'], imagen: ['png', 'jpeg', 'webp', 'gif', 'heic'] };

// "el Excel de ventas que subí la semana pasada", "la última versión del presupuesto", "el archivo anterior"
export function referenciaArchivo(n) {
  const tipoM = n.match(/\b(excel|planilla|csv|pdf|word|documento|presentacion|foto|imagen|archivo)s?\b/);
  if (!tipoM) {
    const v = n.match(/\b(?:ultima|ultimo|nueva) version (?:del|de la|de los|de las|de) ([a-z0-9ñ ]+?)(?=\s+(?:en|para|al|a|con)\b|[.,;!?]|$)/);
    return v ? { tipos: null, cuando: null, ultimo: true, anterior: false, texto: v[1].trim() } : null;
  }
  const cuando = /\bayer\b/.test(n) ? 1 : /\bsemana pasada\b/.test(n) ? 7 : /\bmes pasado\b/.test(n) ? 31 : /\bhoy\b/.test(n) ? 0 : null;
  const ultimo = /\b(ultim[oa]|reciente|nuev[oa])\b/.test(n);
  const anterior = /\b(anterior|previo|viejo)\b/.test(n);
  const sobre = (n.match(/\b(?:de|del|sobre)\s+(?:la |las |los |el )?([a-z0-9ñ ]+?)(?=\s+(?:que|de la|del|para|a |al|en |con)\b|[.,;!?]|$)/) || [])[1];
  const sinRuido = sobre && !/^(semana|mes|ayer|hoy|version|ultima|ultimo)/.test(sobre) ? sobre.replace(/\b(ultima|ultimo|version)\b/g, '').trim() : null;
  const subio = /\b(subi|subiste|cargue|mande|pase|adjunte|que use)\b/.test(n);
  if (!cuando && !ultimo && !anterior && !subio && !sinRuido) return null;
  return { tipos: DOCS[tipoM[1]] || null, cuando, ultimo, anterior, texto: sinRuido || null };
}

/** Elige archivos guardados según la referencia: palabras + tipo + fecha; ranking por relevancia y recencia. */
export function resolverArchivo(ref, archivos, ahora = Date.now()) {
  if (!ref) return [];
  const cand = archivos.filter((f) => f.status !== 'expired' && f.status !== 'blocked')
    .filter((f) => !ref.tipos || ref.tipos.includes(f.detected_type))
    .filter((f) => ref.cuando == null || (ahora - Date.parse(f.created_at)) / 864e5 <= ref.cuando + 1 && (ref.cuando === 0 || (ahora - Date.parse(f.created_at)) / 864e5 >= (ref.cuando === 1 ? 0.5 : ref.cuando === 7 ? 1 : 0)))
    .map((f) => {
      const nombre = normalizar(f.original_name);
      const palabras = ref.texto ? ref.texto.split(/\s+/).filter((w) => w.length > 2) : [];
      const coincide = palabras.length ? palabras.filter((w) => nombre.includes(w) || normalizar(f.meta?.resumen || '').includes(w)).length / palabras.length : 0.5;
      return { f, score: coincide * 10 + (f.version || 1) * 0.5 - (ahora - Date.parse(f.created_at)) / 864e5 / 30 };
    }).filter((x) => !ref.texto || x.score > 2).sort((a, b) => b.score - a.score);
  if (ref.anterior) return cand.slice(1, 2).map((x) => x.f);
  return cand.slice(0, 1).map((x) => x.f);
}

// Tablero nombrado explícitamente ("este dashboard", "el de ventas", su nombre). Sin referencia explícita → null
// (para crear algo nuevo en vez de colgarlo del único tablero que exista).
export function artefactoExplicito(original, ctx) {
  const n = normalizar(original);
  if (/\b(este|esta|el mismo|al mismo)\s+(dashboard|tablero|panel|herramienta|reporte)\b/.test(n) && ctx.activoId) return (ctx.artefactos || []).find((a) => a.id === ctx.activoId) || null;
  const lista = (ctx.artefactos || []).filter((a) => !a.deleted_at);
  const hit = resolverArtefacto(original, lista.length > 1 ? lista : [...lista, { id: '__x', name: '__ninguno__' }], null);
  return hit && hit.id !== '__x' ? hit : null;
}

/**
 * @param {string} texto
 * @param {{ modo?: string, adjuntos?: object[], artefactos?: object[], activoId?: string|null, seleccion?: object|null }} ctx
 */
export function interpretarEntrada(texto, ctx = {}) {
  const original = String(texto || '');
  const n = normalizar(original);
  // Adjuntos de mensajes anteriores solo cuentan si el pedido los señala ("este archivo", "estos datos", "la foto"…).
  const deictico = /\b(este|esta|estos|estas|ese|esa|esos|esas|el|la|los|las|mismo|misma)\s+(archivo|archivos|planilla|planillas|excel|csv|pdf|documento|documentos|foto|fotos|imagen|imagenes|datos|informe|adjunto|adjuntos|tabla)\b/.test(n);
  // Una referencia con tipo o fecha ("el pdf que subí hoy") manda sobre los adjuntos anteriores de la conversación.
  const refTipada = referenciaArchivo(n);
  const adj = ctx.adjuntos?.length ? ctx.adjuntos : deictico && !refTipada ? ctx.adjuntosPrevios || [] : [];
  const trabajo = (ctx.modo || 'work') === 'work';
  const imagenes = adj.filter((a) => a.kind === 'image');
  const url = original.match(URL_RE)?.[0]?.replace(/[.,;]+$/, '');

  if (/\b(de donde (sale|salio|viene|vino|surge)|origen de(l| este| ese)? (dato|valor|numero|registro)|quien (lo )?cargo (este|ese) dato|de que archivo (sale|salio|viene))\b/.test(n)) return { tipo: 'origen' };

  if (url && /\b(api|conecta|conectar|traer|trae|consumi|endpoint|cotizacion|fuente|integra)/.test(n)) {
    if (!trabajo) return { tipo: 'bloqueado', motivo: 'personal' };
    const art = artefactoExplicito(original.replace(url, ''), ctx);
    return { tipo: 'api_conectar', url, artefactoId: art?.id || null, refresco: /\b(al abrir|siempre actualizad|cada vez que (lo )?abr)/.test(n) ? 'ON_OPEN' : 'MANUAL',
      historico: /\b(historic|historial|evolucion|seguimiento|guarda|acumula|comparar)/.test(n) };
  }

  if (/\b(quiero|necesito|tengo que|me gustaria) poder (cargar|subir|actualizar|importar)|\b(todos los meses|cada mes|mensualmente|todas las semanas|cada semana)\b.*\b(cargar|subir|importar|actualizar)|\b(cargar|subir|importar|actualizar)\b.*\b(todos los meses|cada mes|mensualmente|todas las semanas|cada semana)\b/.test(n)) {
    if (!trabajo) return { tipo: 'bloqueado', motivo: 'personal' };
    const art = artefactoExplicito(original, ctx);
    const tema = (n.match(/\b(?:cargar|subir|importar|actualizar) (?:las |los |el |la )?([a-z]+)/) || [])[1] || 'datos';
    return { tipo: 'input_archivo', artefactoId: art?.id || null, tema, periodicidad: /semana/.test(n) ? 'semanal' : 'mensual' };
  }

  const ref = referenciaArchivo(n);
  const hayFuente = adj.length > 0 || !!ref;
  if (!hayFuente) return null;
  const base = { adjuntos: adj.map((a) => a.fileId), referencia: adj.length ? null : ref };

  if (/\b(compara|comparar|comparalo|comparala|que cambio|que cambia|diferencia|diferencias)\b/.test(n)) {
    if (!trabajo && /\bbase\b/.test(n)) return { tipo: 'bloqueado', motivo: 'personal' };
    const art = resolverArtefacto(original, ctx.artefactos, ctx.activoId);
    const anterior = /\b(anterior|previo|version vieja|otro)\b/.test(n);
    return { tipo: 'archivo_comparar', ...base, anterior, contraBase: /\b(base|historico|dashboard|tablero|datos guardados|lo cargado)\b/.test(n) || adj.length === 1 && !ref && !anterior, artefactoId: art?.id || null };
  }
  if (/\b(crea|crear|arma|armar|hace|hacer|haceme|armame|creame|genera|generar|quiero)\b.*\b(dashboard|tablero|panel)\b/.test(n)) {
    if (!trabajo) return { tipo: 'bloqueado', motivo: 'personal' };
    return { tipo: 'archivo_dashboard', ...base, historico: /\b(historic|historial|evolucion|seguimiento|mes a mes)/.test(n) };
  }
  const sinReferencia = n.replace(/\bque (subi|subiste|cargue|cargaste|mande|pase|adjunte|use|usamos)\b/g, '');   // "el pdf que subí" no es un pedido de carga
  if (/\b(usa|usar|suma|sumar|sumale|agrega|agregar|agregale|carga|cargar|cargalo|importa|importar|importalo|actualiza|actualizar|reemplaza|reemplazar|incorpora|incorporar|guarda|guardar|guardalo|subi|subir|meti|pasa)\b/.test(sinReferencia)
      && !/\bque (dice|aparece|hay)\b/.test(n)) {
    if (!trabajo) return { tipo: 'bloqueado', motivo: 'personal' };
    const art = resolverArtefacto(original, ctx.artefactos, ctx.activoId);
    return { tipo: 'archivo_importar', ...base, artefactoId: art?.id || null, texto: original };
  }
  if (imagenes.length && (/\b(foto|imagen|captura|que (aparece|hay|se ve|ves|muestra)|describi|describe|lee la)\b/.test(n) || !/\barchivo\b/.test(n))) {
    return { tipo: 'imagen_pregunta', ...base, pregunta: original };
  }
  if (/\?|\b(que|cual|cuales|cuanto|cuantos|cuando|donde|quien|como|por que|segun)\b/.test(n) && !/\b(analiza|resumi|resumen)\b/.test(n)) {
    return { tipo: 'archivo_pregunta', ...base, pregunta: original };
  }
  return { tipo: 'archivo_analizar', ...base };
}
