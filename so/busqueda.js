// SO · búsqueda difusa y ranking (relevancia + recencia + frecuencia) para la paleta de comandos y la búsqueda global.
// Solo ordena lo que el servidor ya devolvió con los permisos del usuario: no amplía el acceso. Puro.

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// 0 = no coincide. Prefiere coincidencia contigua, al inicio de palabra y más corta.
export function puntaje(consulta, texto) {
  const q = norm(consulta).trim(), t = norm(texto);
  if (!q) return 1;
  const pos = t.indexOf(q);
  if (pos >= 0) return 100 - Math.min(40, pos) + (pos === 0 || t[pos - 1] === ' ' ? 30 : 0) - Math.min(20, t.length / 10);
  let i = 0, salto = 0, previo = -1;
  for (const c of q) {
    if (c === ' ') continue;
    const j = t.indexOf(c, previo + 1);
    if (j < 0) return 0;
    salto += previo >= 0 ? j - previo - 1 : (j === 0 || t[j - 1] === ' ' ? 0 : Math.min(j, 10));   // empezar en una palabra no penaliza
    previo = j; i++;
  }
  return Math.max(1, 50 - salto * 2 - Math.min(20, t.length / 10));
}

/**
 * @param {string} consulta
 * @param {{ titulo: string, extra?: string, fecha?: string|null, frecuencia?: number, favorito?: boolean }[]} items
 * @param {number} ahora ms
 */
export function rankear(consulta, items, ahora = Date.now()) {
  return items.map((it) => {
    const rel = Math.max(puntaje(consulta, it.titulo), puntaje(consulta, it.extra || '') * 0.6);
    if (!rel) return null;
    const dias = it.fecha ? (ahora - new Date(it.fecha).getTime()) / 864e5 : 365;
    const recencia = 20 / (1 + Math.max(0, dias));
    const frecuencia = Math.min(15, Math.log2(1 + (it.frecuencia || 0)) * 5);
    // El Workspace es el catálogo: a igual relevancia, un artefacto va antes que un archivo o una conversación.
    return { ...it, score: rel + recencia + frecuencia + (it.favorito ? 10 : 0) + (it.tipo === 'artefacto' ? 8 : 0) };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}
