// Feriados nacionales de Argentina desde fuentes públicas, guardados en la base (tabla feriado).
// Fuentes, en orden: ArgentinaDatos y Nolaborables. Los cargados a mano (fuente 'manual') no se pisan.
import { operativa } from '../db.js';

const FUENTES = [
  { nombre: 'argentinadatos', url: (a) => `https://api.argentinadatos.com/v1/feriados/${a}`,
    leer: (j, a) => j.map((f) => ({ fecha: f.fecha, nombre: f.nombre, tipo: f.tipo })) },
  { nombre: 'nolaborables', url: (a) => `https://nolaborables.com.ar/api/v2/feriados/${a}`,
    leer: (j, a) => j.map((f) => ({ fecha: `${a}-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`, nombre: f.motivo, tipo: f.tipo })) },
];

export async function sincronizarFeriados(anio = new Date().getFullYear()) {
  const errores = [];
  for (const f of FUENTES) {
    try {
      const res = await fetch(f.url(anio), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lista = f.leer(await res.json(), anio).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) && x.fecha.startsWith(String(anio)) && x.nombre);
      if (!lista.length) throw new Error('sin datos');
      for (const x of lista) {
        await operativa.query(`INSERT INTO feriado (fecha, nombre, tipo, fuente) VALUES ($1, $2, $3, $4)
          ON CONFLICT (fecha) DO UPDATE SET nombre = $2, tipo = $3, fuente = $4, actualizado_en = now() WHERE feriado.fuente <> 'manual'`,
        [x.fecha, x.nombre, x.tipo ?? null, f.nombre]);
      }
      return { anio, fuente: f.nombre, feriados: lista.length };
    } catch (e) { errores.push(`${f.nombre}: ${e.message}`); }
  }
  throw new Error(`No se pudieron traer los feriados de ${anio} (${errores.join(' · ')})`);
}

// Conjunto de fechas feriadas (para el motor de programación)
export async function feriadosCargados() {
  const { rows } = await operativa.query(`SELECT to_char(fecha, 'YYYY-MM-DD') AS f FROM feriado`);
  const s = new Set(rows.map((r) => r.f));
  return (fecha) => s.has(fecha);
}
