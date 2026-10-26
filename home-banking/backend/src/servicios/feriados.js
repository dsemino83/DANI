// Feriados nacionales de Argentina desde fuentes públicas, guardados en la base (tabla feriado).
// Fuentes, en orden: ArgentinaDatos y Nolaborables. Los cargados a mano (fuente 'manual') no se pisan.
import { operativa } from '../db.js';
import { clasificarError, medirLlamada } from '../telemetria.js';

const TIMEOUT_MS = 15_000;

const FUENTES = [
  { nombre: 'argentinadatos', url: (a) => `https://api.argentinadatos.com/v1/feriados/${a}`,
    leer: (j, a) => j.map((f) => ({ fecha: f.fecha, nombre: f.nombre, tipo: f.tipo })) },
  { nombre: 'nolaborables', url: (a) => `https://nolaborables.com.ar/api/v2/feriados/${a}`,
    leer: (j, a) => j.map((f) => ({ fecha: `${a}-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`, nombre: f.motivo, tipo: f.tipo })) },
];

// Feriados nacionales de fecha fija: respaldo SOLO si ninguna fuente pública responde y el año no tiene nada cargado.
// Las fuentes públicas los pisan en cuanto responden (salvo los cargados a mano). Los móviles no se inventan.
const FIJOS = [['01-01', 'Año Nuevo'], ['03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'], ['04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'],
  ['05-01', 'Día del Trabajador'], ['05-25', 'Día de la Revolución de Mayo'], ['06-20', 'Paso a la Inmortalidad del General Manuel Belgrano'],
  ['07-09', 'Día de la Independencia'], ['12-08', 'Inmaculada Concepción de María'], ['12-25', 'Navidad']];

// Falla de una fuente, con su causa: red / dns / timeout / tls (no llegó al proveedor) o proveedor (respondió mal).
class ErrorFuente extends Error {}

async function traer(f, anio) {
  let res;
  try {
    res = await medirLlamada({ op: `feriados/${f.nombre}`, destino: f.nombre, timeoutMs: TIMEOUT_MS }, () => fetch(f.url(anio), { signal: AbortSignal.timeout(TIMEOUT_MS) }), { estado: (r) => r.status });
  } catch (e) {
    const { tipo, codigo } = clasificarError(e);
    throw new ErrorFuente(`${tipo}${codigo ? ` (${codigo})` : ''}`);
  }
  if (!res.ok) throw new ErrorFuente(`proveedor: HTTP ${res.status}`);
  let json;
  try { json = await res.json(); } catch { throw new ErrorFuente('proveedor: respuesta ilegible'); }
  let lista;
  try { lista = f.leer(json, anio).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) && x.fecha.startsWith(String(anio)) && x.nombre); } catch { throw new ErrorFuente('proveedor: formato inesperado'); }
  if (!lista.length) throw new ErrorFuente('proveedor: sin datos');
  return lista;
}

const guardar = (lista, fuente) => Promise.all(lista.map((x) => operativa.query(`INSERT INTO feriado (fecha, nombre, tipo, fuente) VALUES ($1, $2, $3, $4)
  ON CONFLICT (fecha) DO UPDATE SET nombre = $2, tipo = $3, fuente = $4, actualizado_en = now() WHERE feriado.fuente <> 'manual'`,
[x.fecha, x.nombre, x.tipo ?? null, fuente])));

export async function sincronizarFeriados(anio = new Date().getFullYear()) {
  const errores = [];
  for (const f of FUENTES) {
    let lista;
    try { lista = await traer(f, anio); } catch (e) { errores.push(`${f.nombre}: ${e.message}`); continue; }
    // La base se maneja aparte: un error de base de datos no es culpa del proveedor ni se resuelve probando otra fuente.
    try { await guardar(lista, f.nombre); } catch (e) { throw new Error(`Feriados ${anio}: error de base de datos al guardar (${e.code ?? e.message})`); }
    return { anio, fuente: f.nombre, feriados: lista.length };
  }
  // Ninguna fuente respondió. Si el año ya tiene feriados cargados, se siguen usando; si no (y es el año en curso o
  // uno pasado), se cargan los de fecha fija como respaldo. Un año futuro todavía no publicado no es un error grave.
  let n;
  try { n = (await operativa.query('SELECT count(*)::int AS n FROM feriado WHERE extract(year FROM fecha) = $1', [anio])).rows[0].n; }
  catch (e) { throw new Error(`Feriados ${anio}: error de base de datos (${e.code ?? e.message}); fuentes: ${errores.join(' · ')}`); }
  if (n > 0) return { anio, fuente: 'base', feriados: n, aviso: `sin fuente pública (${errores.join(' · ')}); se usan los ${n} ya cargados` };
  if (anio <= new Date().getFullYear()) {
    const fijos = FIJOS.map(([md, nombre]) => ({ fecha: `${anio}-${md}`, nombre, tipo: 'inamovible' }));
    try { await guardar(fijos, 'respaldo'); } catch (e) { throw new Error(`Feriados ${anio}: error de base de datos al guardar el respaldo (${e.code ?? e.message})`); }
    return { anio, fuente: 'respaldo', feriados: fijos.length, aviso: `sin fuente pública (${errores.join(' · ')}); cargados solo los feriados de fecha fija` };
  }
  throw new Error(`No se pudieron traer los feriados de ${anio} (${errores.join(' · ')})`);
}

// Conjunto de fechas feriadas (para el motor de programación)
export async function feriadosCargados() {
  const { rows } = await operativa.query(`SELECT to_char(fecha, 'YYYY-MM-DD') AS f FROM feriado`);
  const s = new Set(rows.map((r) => r.f));
  return (fecha) => s.has(fecha);
}
