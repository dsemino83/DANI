// SO · CommandRouter: un solo punto de entrada (barra universal y ⌘K) clasifica el texto en
// NAVIGATE · SEARCH · ASK · CREATE · EXECUTE · UPLOAD · CONNECT · SHARE y delega en los servicios existentes
// (navegación, búsqueda, Francisco, entrada universal). No contiene lógica de negocio. Puro: se prueba en node.
import { normalizar } from './intent.js';

export const TIPOS = ['NAVIGATE', 'SEARCH', 'ASK', 'CREATE', 'EXECUTE', 'UPLOAD', 'CONNECT', 'SHARE'];

/**
 * @param {string} texto
 * @param {{ artefactos?: {id:string,name:string}[] }} ctx
 * @returns {{ tipo: string, artefactoId?: string, consulta?: string }}
 */
export function clasificar(texto, ctx = {}) {
  const n = normalizar(texto);
  if (!n) return { tipo: 'SEARCH', consulta: '' };
  const arts = ctx.artefactos || [];
  const nombrado = arts.find((a) => normalizar(a.name) === n) || null;
  if (/^(subi|subir|adjunta|adjuntar|carga(r)? (un |el )?archivo|importa(r)? (un |el )?archivo)\b/.test(n)) return { tipo: 'UPLOAD' };
  if (/\b(conecta|conectar|vincula)\b.*\b(api|endpoint|servicio|url)\b|^api\b/.test(n)) return { tipo: 'CONNECT' };
  if (/\b(compart|pasale|dale acceso)/.test(n)) return { tipo: 'SHARE', artefactoId: resolver(n, arts)?.id };
  if (/^(abri|abrir|abrime|ir a|anda a|llevame a|mostrame el|mostrame la)\b/.test(n)) {
    const a = resolver(n, arts);
    return a ? { tipo: 'NAVIGATE', artefactoId: a.id } : { tipo: 'ASK' };
  }
  if (/\b(crea|crear|armame|arma|armar|haceme|nuevo|nueva|necesito|quiero un|quiero una)\b/.test(n)) return { tipo: 'CREATE' };
  if (/\b(actualiza|refresca|exporta|descarga|pasame|generame|genera|deshace|borra|elimina|archiva|registra|carga|filtra|mostrame solo|compara|sumale|agregale)\b/.test(n)) return { tipo: 'EXECUTE', artefactoId: resolver(n, arts)?.id };
  if (/[?¿]/.test(texto) || /^(por que|que |cual|cuanto|como |cuando|donde|quien|explica|analiza|resumi)/.test(n)) return { tipo: 'ASK' };
  if (nombrado) return { tipo: 'NAVIGATE', artefactoId: nombrado.id };
  if (n.split(' ').length <= 3) return { tipo: 'SEARCH', consulta: texto.trim() };
  return { tipo: 'ASK' };
}

function resolver(n, arts) {
  const VACIAS = new Set(['dashboard', 'tablero', 'panel', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'reporte', 'herramienta']);
  let mejor = null, puntos = 0;
  for (const a of arts) {
    const ps = normalizar(a.name).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !VACIAS.has(w));
    const p = ps.filter((w) => new RegExp(`\\b${w}`).test(n)).length;
    if (p > puntos) { mejor = a; puntos = p; }
  }
  return mejor;
}

/**
 * Acciones contextuales que la paleta ofrece para un texto (ej. "ventas" → Actualizar Ventas, Exportar…, Preguntar).
 * Solo propone acciones posibles: la autorización real la hace el servidor.
 */
export function accionesPara(texto, arts = []) {
  const n = normalizar(texto);
  if (n.length < 2) return [];
  const out = [];
  for (const a of arts) {
    if (!normalizar(a.name).includes(n) && !n.split(' ').every((w) => normalizar(a.name).includes(w))) continue;
    out.push({ id: `actualizar:${a.id}`, titulo: `Actualizar ${a.name}`, accion: 'actualizar', artefactoId: a.id });
    out.push({ id: `exportar:${a.id}`, titulo: `Exportar ${a.name} a Excel`, accion: 'exportar', formato: 'xlsx', artefactoId: a.id });
    out.push({ id: `compartir:${a.id}`, titulo: `Compartir ${a.name}`, accion: 'compartir', artefactoId: a.id });
    if (out.length >= 6) break;
  }
  return out;
}
