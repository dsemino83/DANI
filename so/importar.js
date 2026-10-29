// SO · importación CSV (tarea en segundo plano). Parseo y validación puros; la app los manda por lotes idempotentes.
import { normalizar, clave } from './intent.js';

// CSV con separador , o ; (detectado), comillas dobles y saltos de línea dentro de comillas.
export function parseCSV(texto) {
  const t = String(texto).replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] || '';
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

export function numeroAR(v) {
  let s = String(v ?? '').trim().replace(/[$\s]/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function fechaISO(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Mapea columnas a campos del datasource (por clave o etiqueta) y valida cada fila.
 * @returns {{ filas: { linea: number, period: string, data: object }[], omitidas: { linea: number, motivo: string }[], columnas: object, sinUsar: string[] }}
 */
export function mapear(filas, campos, hoy = new Date().toISOString().slice(0, 10)) {
  const [cab, ...datos] = filas;
  if (!cab) return { filas: [], omitidas: [], columnas: {}, sinUsar: [] };
  const columnas = {}; const sinUsar = []; let colFecha = -1;
  cab.forEach((h, i) => {
    const n = normalizar(h), k = clave(h);
    if (colFecha < 0 && /^(fecha|period|periodo|dia)$/.test(n)) { colFecha = i; return; }
    const f = campos.find((c) => c.key === k || normalizar(c.label || '') === n);
    if (f) columnas[i] = f; else sinUsar.push(h);
  });
  const out = [], omitidas = [];
  datos.forEach((fila, j) => {
    const linea = j + 2; const data = {};
    let error = null;
    for (const [i, f] of Object.entries(columnas)) {
      const crudo = fila[i];
      if (crudo == null || String(crudo).trim() === '') continue;
      if (f.type === 'number') {
        const n = numeroAR(crudo);
        if (Number.isNaN(n)) { error = `"${crudo}" no es un número en ${f.label || f.key}`; break; }
        data[f.key] = n;
      } else if (f.type === 'date') {
        const d = fechaISO(crudo);
        if (!d) { error = `"${crudo}" no es una fecha en ${f.label || f.key}`; break; }
        data[f.key] = d;
      } else data[f.key] = String(crudo).trim().slice(0, 2000);
    }
    const period = colFecha >= 0 ? fechaISO(fila[colFecha]) : hoy;
    if (!error && colFecha >= 0 && !period) error = `fecha inválida "${fila[colFecha]}"`;
    if (!error && !Object.keys(data).length) error = 'fila sin datos reconocibles';
    if (error) omitidas.push({ linea, motivo: error }); else out.push({ linea, period, data });
  });
  return { filas: out, omitidas, columnas: Object.fromEntries(Object.entries(columnas).map(([i, f]) => [cab[i], f.key])), sinUsar };
}
