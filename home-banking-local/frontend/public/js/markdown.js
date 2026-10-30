// Markdown → elementos del DOM (sin innerHTML), para la documentación incluida en la aplicación.
// Admite títulos, párrafos, listas (con un nivel de anidado), tablas, bloques de código, **negrita** y `código`.
import { h } from './ui.js';

// Texto en línea: **negrita**, `código` y \| (barra escapada en tablas)
function enLinea(texto) {
  const partes = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let i = 0, m;
  while ((m = re.exec(texto))) {
    if (m.index > i) partes.push(texto.slice(i, m.index));
    partes.push(m[1] != null ? h('strong', {}, ...enLinea(m[1])) : h('code', {}, m[2]));
    i = re.lastIndex;
  }
  if (i < texto.length) partes.push(texto.slice(i));
  return partes.map((p) => (typeof p === 'string' ? p.replaceAll('\\|', '|') : p));
}

const celdas = (linea) => linea.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function markdown(texto) {
  const lineas = texto.replace(/\r/g, '').split('\n');
  const salida = [];
  for (let i = 0; i < lineas.length;) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { salida.push(h(`h${m[1].length}`, {}, ...enLinea(m[2]))); i++; continue; }
    if (l.startsWith('```')) {
      const codigo = [];
      for (i++; i < lineas.length && !lineas[i].startsWith('```'); i++) codigo.push(lineas[i]);
      i++; salida.push(h('pre', {}, h('code', {}, codigo.join('\n')))); continue;
    }
    if (l.trim().startsWith('|') && lineas[i + 1]?.match(/^\s*\|?\s*:?-{3,}/)) {
      const cab = celdas(l); const filas = [];
      for (i += 2; i < lineas.length && lineas[i].trim().startsWith('|'); i++) filas.push(celdas(lineas[i]));
      salida.push(h('div', { class: 'tabla' }, h('table', {}, h('thead', {}, h('tr', {}, cab.map((c) => h('th', {}, ...enLinea(c))))),
        h('tbody', {}, filas.map((f) => h('tr', {}, f.map((c) => h('td', {}, ...enLinea(c)))))))));
      continue;
    }
    if ((m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/))) {
      const ordenada = /\d/.test(m[2]), lista = h(ordenada ? 'ol' : 'ul', {});
      let ultimo = null;
      for (; i < lineas.length && (m = lineas[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/)); i++) {
        if (m[1].length >= 2 && ultimo) { // segundo nivel
          let sub = ultimo.querySelector(':scope > ul, :scope > ol');
          if (!sub) { sub = h(/\d/.test(m[2]) ? 'ol' : 'ul', {}); ultimo.append(sub); }
          sub.append(h('li', {}, ...enLinea(m[3])));
        } else { ultimo = h('li', {}, ...enLinea(m[3])); lista.append(ultimo); }
      }
      salida.push(lista); continue;
    }
    const parrafo = [];
    for (; i < lineas.length && lineas[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s|\s*\|)/.test(lineas[i]); i++) parrafo.push(lineas[i].trim());
    if (!parrafo.length) { salida.push(h('p', {}, ...enLinea(l))); i++; continue; }
    salida.push(h('p', {}, ...enLinea(parrafo.join(' '))));
  }
  return salida;
}
