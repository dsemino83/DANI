// Dos pools: base operativa (lectura/escritura, últimos 3 meses) y base histórica (solo lectura).
import pg from 'pg';
import { config } from './config.js';

// numeric -> number para importes (dos decimales; dentro del rango seguro de JS)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

function poolMedido(nombre, opciones) {
  const pool = new pg.Pool(opciones);
  const queryOriginal = pool.query.bind(pool);
  pool.query = async (...args) => {
    const inicio = performance.now();
    try {
      const r = await queryOriginal(...args);
      const duracionMs = Math.round((performance.now() - inicio) * 10) / 10;
      if (duracionMs >= 100) console.warn(JSON.stringify({ metrica: 'db_query_lenta', base: nombre, duracionMs, filas: r.rowCount }));
      return r;
    } catch (e) {
      const duracionMs = Math.round((performance.now() - inicio) * 10) / 10;
      console.warn(JSON.stringify({ metrica: 'db_query_error', base: nombre, duracionMs, codigo: e.code }));
      throw e;
    }
  };
  pool.on('error', (e) => console.error(JSON.stringify({ metrica: 'db_pool_error', base: nombre, codigo: e.code })));
  return pool;
}

export const operativa = poolMedido('operativa', config.db.operativa);
export const historica = poolMedido('historica', config.db.historica);

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
