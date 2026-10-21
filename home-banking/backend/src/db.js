// Dos pools: base operativa (lectura/escritura, últimos 3 meses) y base histórica (solo lectura).
import pg from 'pg';
import { config } from './config.js';

// numeric -> number para importes (dos decimales; dentro del rango seguro de JS)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

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

// Fecha de corte: lo anterior vive en la base histórica.
export function fechaCorte(hoy = new Date()) {
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - config.retencionMesesOperativa, hoy.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
