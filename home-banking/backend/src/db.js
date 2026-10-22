// Dos pools: base operativa (lectura/escritura, mes en curso + HB_RETENCION_MESES) y base histórica (solo lectura).
import pg from 'pg';
import { config } from './config.js';
import { mesCorte } from './corte.js';

// numeric -> number para importes (dos decimales; dentro del rango seguro de JS)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> 'AAAA-MM-DD' tal cual (sin pasar por Date, que lo corre de zona horaria)
pg.types.setTypeParser(1082, (v) => v);

export const operativa = new pg.Pool(config.db.operativa);
export const historica = new pg.Pool(config.db.historica);

// Ejecuta fn dentro de una transacción; si fn lanza, revierte todo (incluida la auditoría).
export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Fecha de corte de una tabla: lo anterior vive en la base histórica. Es el primer día del mes de retención,
// salvo que la operativa todavía tenga un mes anterior sin pasar (el pase corre el día 1 de madrugada, o se
// omitió porque había transferencias abiertas): entonces el corte es ese mes, porque ahí están los datos.
export async function fechaCorte(tabla = 'transferencia', hoy = new Date()) {
  const corte = mesCorte(hoy, config.retencionMesesOperativa);
  const { rows: [r] } = await operativa.query(
    `SELECT min(to_date(substring(c.relname from '_(\\d{4}_\\d{2})$'), 'YYYY_MM'))::text AS desde
       FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = $1 AND c.relname ~ '_\\d{4}_\\d{2}$'`, [tabla]);
  return r?.desde && r.desde < corte ? r.desde : corte;
}
