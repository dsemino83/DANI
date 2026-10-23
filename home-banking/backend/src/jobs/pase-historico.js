// Pase mensual a la base histórica (día 1 de cada mes): todo mes anterior al corte (mes en curso menos
// HB_RETENCION_MESES, 1 por defecto) se copia a la histórica, se verifica (filas + hash) y recién entonces
// se elimina de la operativa. Tablas particionadas: se mueve la partición del mes entera. Tablas sin
// partición (cola y log de envíos de correo): se mueven las filas terminadas de ese mes.
// Usa usuarios dueños de cada base (no el de la aplicación).
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { mesCorte } from '../corte.js';

export { mesCorte };

const leer = (n, d) => (process.env[`${n}_FILE`] ? readFileSync(process.env[`${n}_FILE`], 'utf8').trim() : process.env[n] ?? d);

export const TABLAS = [
  { tabla: 'transferencia', columna: 'creado_en' },
  { tabla: 'transferencia_estado', columna: 'en' },
  { tabla: 'auditoria', columna: 'en' },
];
const NO_FINALES = ['PENDIENTE_APROBACION', 'EN_COLA', 'ENVIANDO', 'ENVIADA', 'PEND_AUTORIZACION'];
const LOTE = 5000;

// Tablas sin partición: se pasan por filas, solo las terminadas (lo pendiente o no leído sigue en la operativa).
// La histórica las crea si no existen (bases creadas antes de que existieran estas tablas).
export const TABLAS_FILAS = [
  {
    tabla: 'cola_envio', columna: 'encolada_en', terminadas: "estado IN ('enviado', 'error', 'omitido')",
    ddl: `CREATE TABLE IF NOT EXISTS cola_envio (
      id bigint PRIMARY KEY, programacion_id bigint, programacion text NOT NULL, turno text NOT NULL,
      empresa_id bigint NOT NULL, empresa text NOT NULL, cuentas text[] NOT NULL, contenido text NOT NULL,
      responsable text NOT NULL, manual boolean NOT NULL, estado text NOT NULL, intentos smallint NOT NULL,
      max_intentos smallint NOT NULL, disponible_en timestamptz NOT NULL, encolada_en timestamptz NOT NULL,
      tomada_en timestamptz, terminada_en timestamptz, destinatarios text[] NOT NULL, detalle text);
      CREATE INDEX IF NOT EXISTS h_cola_envio_prog_idx ON cola_envio (programacion_id, encolada_en);
      ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'cuerpo';
      ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS frecuencia text NOT NULL DEFAULT 'diaria';
      ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS ejecucion_id bigint;
      ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS consultas_banco int NOT NULL DEFAULT 0`,  // migraciones 007, 009 y 012
  },
  {
    tabla: 'ejecucion_envio', columna: 'creada_en', terminadas: "estado = 'terminada'",
    ddl: `CREATE TABLE IF NOT EXISTS ejecucion_envio (
      id bigint PRIMARY KEY, programacion_id bigint, programacion text NOT NULL, turno text NOT NULL, frecuencia text NOT NULL,
      manual boolean NOT NULL, responsable text NOT NULL, estado text NOT NULL, tareas int NOT NULL, enviadas int NOT NULL,
      omitidas int NOT NULL, errores int NOT NULL, consultas_banco int NOT NULL, creada_en timestamptz NOT NULL, terminada_en timestamptz);
      CREATE INDEX IF NOT EXISTS h_ejecucion_envio_prog_idx ON ejecucion_envio (programacion_id, creada_en)`,
  },
  {
    tabla: 'mensaje', columna: 'creado_en', terminadas: 'visto_en IS NOT NULL',
    ddl: `CREATE TABLE IF NOT EXISTS mensaje (
      id bigint PRIMARY KEY, usuario text NOT NULL, tipo text NOT NULL, titulo text NOT NULL, texto text NOT NULL,
      empresas text[] NOT NULL, ref_tipo text, ref_id bigint, creado_por text NOT NULL, creado_en timestamptz NOT NULL, visto_en timestamptz);
      CREATE INDEX IF NOT EXISTS h_mensaje_usuario_idx ON mensaje (usuario, creado_en);
      ALTER TABLE mensaje ADD COLUMN IF NOT EXISTS visto_motivo text`,  // migración 011
  },
  {
    tabla: 'envio_mail_log', columna: 'en', terminadas: 'true',
    ddl: `CREATE TABLE IF NOT EXISTS envio_mail_log (
      id bigint PRIMARY KEY, programacion_id bigint, turno text NOT NULL, empresa_id bigint, empresa text,
      destinatarios text[] NOT NULL, estado text NOT NULL, detalle text, manual boolean NOT NULL, en timestamptz NOT NULL);
      CREATE INDEX IF NOT EXISTS h_envio_mail_log_prog_idx ON envio_mail_log (programacion_id, en)`,
  },
];

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
    // Desde el corte: los meses ya pasados no se vuelven a crear vacíos en la operativa
    await op.query('SELECT hb_asegurar_particiones($1::date)', [corte]);
    // La histórica recibe la cadena de hashes de la auditoría (migración 013), en el mismo orden de columnas
    await hi.query('ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS orden bigint, ADD COLUMN IF NOT EXISTS hash_anterior text, ADD COLUMN IF NOT EXISTS hash text');
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
    for (const t of TABLAS_FILAS) resumen.push(...(await pasarFilas(op, hi, t, corte, log)));
  } finally {
    await op.end();
    await hi.end();
  }
  return resumen;
}

// Hash independiente del orden de columnas (las tablas de la histórica se crean aparte)
const hashFilas = (tabla) => `SELECT count(*)::bigint AS filas, coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id)), '') AS hash FROM ${tabla} t WHERE id = ANY($1::bigint[])`;

// Pasa por filas, mes a mes, lo terminado anterior al corte: copia, verifica y recién entonces borra.
async function pasarFilas(op, hi, { tabla, columna, terminadas, ddl }, corte, log) {
  const resumen = [];
  const existe = (await op.query('SELECT to_regclass($1) IS NOT NULL AS ok', [tabla])).rows[0].ok;
  if (!existe) return resumen;
  const { rows: meses } = await op.query(
    `SELECT DISTINCT to_char(date_trunc('month', ${columna}), 'YYYY-MM-01') AS periodo FROM ${tabla}
      WHERE ${columna} < $1::date AND ${terminadas} ORDER BY 1`, [corte]);
  if (!meses.length) return resumen;
  await hi.query(ddl);
  await hi.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_hist_ro') THEN GRANT SELECT ON ${tabla} TO hb_hist_ro; END IF;
    END $$`);
  await hi.query(`CREATE OR REPLACE TRIGGER h_${tabla}_inmutable BEFORE UPDATE OR DELETE ON ${tabla} FOR EACH ROW EXECUTE FUNCTION hb_solo_lectura()`);
  for (const { periodo } of meses) {
    const hasta = new Date(Date.UTC(+periodo.slice(0, 4), +periodo.slice(5, 7), 1)).toISOString().slice(0, 10);
    const ids = (await op.query(
      `SELECT array_agg(id ORDER BY id)::text[] AS ids FROM ${tabla} WHERE ${columna} >= $1::date AND ${columna} < $2::date AND ${terminadas}`,
      [periodo, hasta])).rows[0].ids ?? [];
    if (!ids.length) continue;
    const registrar = (estado, filas, hash, detalle) => op.query(
      'INSERT INTO pase_historico (tabla, periodo, filas, hash, estado, detalle) VALUES ($1, $2, $3, $4, $5, $6)', [tabla, periodo, filas, hash, estado, detalle]);
    const origen = (await op.query(hashFilas(tabla), [ids])).rows[0];
    try {
      await hi.query('BEGIN');
      for (let i = 0; i < ids.length; i += LOTE) {
        const { rows: [l] } = await op.query(
          `SELECT coalesce(json_agg(t ORDER BY id), '[]')::text AS j FROM ${tabla} t WHERE id = ANY($1::bigint[])`, [ids.slice(i, i + LOTE)]);
        await hi.query(`INSERT INTO ${tabla} SELECT * FROM json_populate_recordset(null::${tabla}, $1::json) ON CONFLICT DO NOTHING`, [l.j]);
      }
      const destino = (await hi.query(hashFilas(tabla), [ids])).rows[0];
      if (destino.filas !== origen.filas || destino.hash !== origen.hash) {
        throw new Error(`Verificación fallida: origen ${origen.filas}/${origen.hash} vs destino ${destino.filas}/${destino.hash}`);
      }
      // Un mes puede pasar en más de una vuelta (filas que terminaron después): se acumula el comprobante
      await hi.query(`INSERT INTO pase_recibido (tabla, periodo, filas, hash) VALUES ($1, $2, $3, $4)
        ON CONFLICT (tabla, periodo) DO UPDATE SET filas = pase_recibido.filas + EXCLUDED.filas, hash = EXCLUDED.hash, recibido_en = now()`,
        [tabla, periodo, origen.filas, origen.hash]);
      await hi.query('COMMIT');
    } catch (e) {
      await hi.query('ROLLBACK');
      await registrar('ERROR', origen.filas, origen.hash, e.message);
      log.error?.(`Pase con error ${tabla} ${periodo}: ${e.message}`);
      resumen.push({ tabla, periodo, estado: 'ERROR' });
      continue; // las filas quedan en la operativa
    }
    await op.query('BEGIN');
    await op.query(`DELETE FROM ${tabla} WHERE id = ANY($1::bigint[])`, [ids]);
    await registrar('OK', origen.filas, origen.hash, `Movidas a la base histórica (${columna} ${periodo} a ${hasta}, terminadas)`);
    await op.query(`INSERT INTO auditoria (usuario, rol, tipo, accion, detalle, resultado) VALUES ('sistema', 'sistema', 'Sistema', 'Pase a base histórica', $1, 'OK')`,
      [`${tabla} ${periodo.slice(0, 7)} · ${origen.filas} filas · hash ${origen.hash}`]);
    await op.query('COMMIT');
    resumen.push({ tabla, periodo, estado: 'OK', filas: origen.filas });
  }
  return resumen;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await ejecutarPase());
}
