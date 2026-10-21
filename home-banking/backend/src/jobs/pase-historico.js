// Pase mensual a la base histórica: toda partición mensual que quedó fuera de los últimos 3 meses
// se copia a la histórica, se verifica (filas + hash) y recién entonces se separa y elimina de la operativa.
// Usa usuarios dueños de cada base (no el de la aplicación).
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const leer = (n, d) => (process.env[`${n}_FILE`] ? readFileSync(process.env[`${n}_FILE`], 'utf8').trim() : process.env[n] ?? d);

export const TABLAS = [
  { tabla: 'transferencia', columna: 'creado_en' },
  { tabla: 'transferencia_estado', columna: 'en' },
  { tabla: 'auditoria', columna: 'en' },
];
const NO_FINALES = ['PENDIENTE_APROBACION', 'ENVIANDO', 'ENVIADA', 'PEND_AUTORIZACION'];
const LOTE = 5000;

// Primer día del mes más antiguo que se conserva en la operativa (mes actual - 3)
export function mesCorte(hoy = new Date()) {
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
}

// Particiones <tabla>_AAAA_MM cuyo mes es anterior al corte
export function particionesAPasar(nombres, tabla, corte) {
  return nombres
    .map((n) => n.match(new RegExp(`^${tabla}_(\\d{4})_(\\d{2})$`)))
    .filter(Boolean)
    .map((m) => ({ particion: m[0], periodo: `${m[1]}-${m[2]}-01` }))
    .filter((p) => p.periodo < corte)
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}

const hashSql = (rel) => `SELECT count(*)::bigint AS filas, coalesce(md5(string_agg(md5(t::text), '' ORDER BY id)), '') AS hash FROM ${rel} t`;

export async function ejecutarPase(log = console) {
  const op = new pg.Client({ host: leer('DB_HOST', 'postgres'), port: Number(leer('DB_PORT', '5432')), database: leer('DB_NAME', 'homebanking'), user: leer('DB_OWNER_USER', 'postgres'), password: leer('DB_OWNER_PASSWORD') });
  const hi = new pg.Client({ host: leer('DBH_HOST', 'postgres-historico'), port: Number(leer('DBH_PORT', '5432')), database: leer('DBH_NAME', 'homebanking_hist'), user: leer('DBH_OWNER_USER', 'postgres'), password: leer('DBH_OWNER_PASSWORD') });
  await op.connect();
  await hi.connect();
  await op.query("SET TIME ZONE 'UTC'");
  await hi.query("SET TIME ZONE 'UTC'");
  const corte = mesCorte();
  const resumen = [];
  try {
    await op.query('SELECT hb_asegurar_particiones()');
    for (const { tabla, columna } of TABLAS) {
      const { rows } = await op.query(
        `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = $1`, [tabla]);
      for (const { particion, periodo } of particionesAPasar(rows.map((r) => r.relname), tabla, corte)) {
        const registrar = (estado, filas, hash, detalle) => op.query(
          'INSERT INTO pase_historico (tabla, periodo, filas, hash, estado, detalle) VALUES ($1, $2, $3, $4, $5, $6)', [tabla, periodo, filas, hash, estado, detalle]);
        if (tabla === 'transferencia') {
          const abiertas = (await op.query(`SELECT count(*)::int AS n FROM ${particion} WHERE estado = ANY($1)`, [NO_FINALES])).rows[0].n;
          if (abiertas) {
            await registrar('OMITIDO', null, null, `${abiertas} transferencias sin estado final; se reintenta el mes próximo`);
            log.warn?.(`Pase omitido ${particion}: ${abiertas} transferencias abiertas`);
            resumen.push({ particion, estado: 'OMITIDO' });
            continue;
          }
        }
        const origen = (await op.query(hashSql(particion))).rows[0];
        const hasta = new Date(Date.UTC(+periodo.slice(0, 4), +periodo.slice(5, 7), 1)).toISOString().slice(0, 10);
        try {
          await hi.query('BEGIN');
          await hi.query(`CREATE TABLE IF NOT EXISTS ${particion} PARTITION OF ${tabla} FOR VALUES FROM ('${periodo}') TO ('${hasta}')`);
          // Las filas viajan como JSON generado por Postgres (conserva microsegundos y numeric exactos).
          let ultimo = '-1';
          for (;;) {
            const { rows: [l] } = await op.query(
              `SELECT coalesce(json_agg(t ORDER BY id), '[]')::text AS j, max(id)::text AS ultimo
                 FROM (SELECT * FROM ${particion} WHERE id > $1 ORDER BY id LIMIT ${LOTE}) t`, [ultimo]);
            if (!l.ultimo) break;
            await hi.query(`INSERT INTO ${tabla} SELECT * FROM json_populate_recordset(null::${tabla}, $1::json) ON CONFLICT DO NOTHING`, [l.j]);
            ultimo = l.ultimo;
          }
          const destino = (await hi.query(hashSql(particion))).rows[0];
          if (destino.filas !== origen.filas || destino.hash !== origen.hash) {
            throw new Error(`Verificación fallida: origen ${origen.filas}/${origen.hash} vs destino ${destino.filas}/${destino.hash}`);
          }
          await hi.query('INSERT INTO pase_recibido (tabla, periodo, filas, hash) VALUES ($1, $2, $3, $4)', [tabla, periodo, origen.filas, origen.hash]);
          await hi.query('COMMIT');
        } catch (e) {
          await hi.query('ROLLBACK');
          await registrar('ERROR', origen.filas, origen.hash, e.message);
          log.error?.(`Pase con error ${particion}: ${e.message}`);
          resumen.push({ particion, estado: 'ERROR' });
          continue; // la partición queda en la operativa
        }
        // Copia verificada: recién ahora se separa y elimina de la operativa.
        await op.query('BEGIN');
        await op.query(`ALTER TABLE ${tabla} DETACH PARTITION ${particion}`);
        await op.query(`DROP TABLE ${particion}`);
        await registrar('OK', origen.filas, origen.hash, `Movida a la base histórica (${columna} ${periodo} a ${hasta})`);
        await op.query(`INSERT INTO auditoria (usuario, rol, tipo, accion, detalle, resultado) VALUES ('sistema', 'sistema', 'Sistema', 'Pase a base histórica', $1, 'OK')`,
          [`${tabla} ${periodo.slice(0, 7)} · ${origen.filas} filas · hash ${origen.hash}`]);
        await op.query('COMMIT');
        resumen.push({ particion, estado: 'OK', filas: origen.filas });
      }
    }
  } finally {
    await op.end();
    await hi.end();
  }
  return resumen;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await ejecutarPase());
}
