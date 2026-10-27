// Señales de riesgo de fraude de una transferencia pendiente (reglas explicables, sin datos fuera del sistema).
// Se muestran en Aprobaciones; con riesgo ALTO el aprobador tiene que confirmar explícitamente que lo revisó, y
// el riesgo queda en la auditoría de la aprobación. Umbrales: HB_RIESGO_MONTO_ALTO_ARS / _USD.
import { operativa } from '../db.js';

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const UMBRALES = {
  montoAltoARS: num(process.env.HB_RIESGO_MONTO_ALTO_ARS, 10_000_000),
  montoAltoUSD: num(process.env.HB_RIESGO_MONTO_ALTO_USD, 10_000),
  veces: 3,          // monto atípico: más de N veces el promedio de la cuenta
  minimoHistoria: 3, // operaciones previas necesarias para comparar
  rafaga: 3,         // operaciones al mismo destino en una hora
};
// Estados que cuentan como operación real ya hecha (no rechazada ni pendiente)
const HECHAS = ['ENVIANDO', 'ENVIADA', 'PEND_AUTORIZACION', 'DEBITADA'];

export function nivelDe(puntos) { return puntos >= 50 ? 'alto' : puntos >= 25 ? 'medio' : 'bajo'; }

// Reglas puras (testeables): d = datos de la operación y su historia
export function senales(d, u = UMBRALES) {
  const s = [];
  if (Number(d.previasDestino) === 0) s.push({ codigo: 'destino_nuevo', puntos: 30, texto: 'Primera transferencia de esta cuenta a este destino' });
  if (Number(d.historia) >= u.minimoHistoria) {
    if (Number(d.importe) > u.veces * Number(d.promedio)) s.push({ codigo: 'monto_atipico', puntos: 30, texto: `Monto ${(Number(d.importe) / Number(d.promedio)).toFixed(1)} veces mayor al promedio de la cuenta` });
    else if (Number(d.importe) > 2 * Number(d.maximo)) s.push({ codigo: 'monto_maximo', puntos: 20, texto: 'Más del doble del máximo transferido por la cuenta' });
  }
  if ((d.moneda === 'USD' ? u.montoAltoUSD : u.montoAltoARS) <= Number(d.importe)) s.push({ codigo: 'monto_alto', puntos: 20, texto: 'Monto alto' });
  if (Number(d.rafaga) >= u.rafaga) s.push({ codigo: 'rafaga', puntos: 20, texto: `${d.rafaga} operaciones al mismo destino en una hora` });
  if (Number(d.hora) < 8 || Number(d.hora) >= 19 || Number(d.dow) >= 6) s.push({ codigo: 'fuera_de_horario', puntos: 15, texto: 'Cargada fuera del horario bancario' });
  const puntos = Math.min(100, s.reduce((a, x) => a + x.puntos, 0));
  return { puntos, nivel: nivelDe(puntos), senales: s };
}

// Evalúa varias transferencias en una sola consulta: Map id → { puntos, nivel, senales }
export async function evaluarRiesgo(ids, cliente = operativa) {
  if (!ids.length) return new Map();
  const { rows } = await cliente.query(`
    SELECT CAST(t.id AS varchar(30)) AS id, t.importe, t.moneda,
      (SELECT COUNT(*) FROM transferencia p WHERE p.cuenta_origen = t.cuenta_origen AND p.destino = t.destino AND p.id <> t.id
          AND p.creado_en < t.creado_en AND p.estado IN (SELECT value FROM OPENJSON($2))) AS previasDestino,
      h.n AS historia, h.prom AS promedio, h.maximo AS maximo,
      (SELECT COUNT(*) FROM transferencia r WHERE r.destino = t.destino AND r.estado <> N'RECHAZADA'
          AND r.creado_en BETWEEN DATEADD(minute, -60, t.creado_en) AND DATEADD(minute, 60, t.creado_en)) AS rafaga,
      DATEPART(hour, t.creado_en AT TIME ZONE 'Argentina Standard Time') AS hora,
      ((DATEPART(weekday, t.creado_en AT TIME ZONE 'Argentina Standard Time') + @@DATEFIRST - 2) % 7) + 1 AS dow   -- 1 = lunes … 7 = domingo
    FROM transferencia t
    OUTER APPLY (SELECT COUNT(*) AS n, AVG(p.importe) AS prom, MAX(p.importe) AS maximo FROM transferencia p
       WHERE p.cuenta_origen = t.cuenta_origen AND p.id <> t.id AND p.creado_en < t.creado_en AND p.estado IN (SELECT value FROM OPENJSON($2)) AND p.moneda = t.moneda) h
    WHERE t.id IN (SELECT CAST(value AS bigint) FROM OPENJSON($1))`, [ids.map(String), HECHAS]);
  return new Map(rows.map((d) => [Number(d.id), senales(d)]));
}

// Texto para la auditoría
export const resumenRiesgo = (r) => (r ? `riesgo ${r.nivel.toUpperCase()} (${r.puntos})${r.senales.length ? `: ${r.senales.map((x) => x.texto).join('; ')}` : ''}` : 'riesgo —');
