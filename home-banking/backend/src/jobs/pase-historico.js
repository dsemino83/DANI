// Pase mensual a la base histórica (día 1 de cada mes): todo lo anterior al corte (mes en curso menos
// HB_RETENCION_MESES, 1 por defecto) se copia a la histórica, se verifica (filas + SHA-256) y recién entonces
// se elimina de la operativa. Se mueve por filas, mes a mes y solo lo terminado.
// Usa logins dedicados del pase (hb_pase / hb_pase_h): solo pueden leer y borrar lo que mueven, no son los de la aplicación ni sa.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Base, tx } from '../db.js';
import { config } from '../config.js';
import { mesCorte } from '../corte.js';

export { mesCorte };

const leer = (n, d) => (process.env[`${n}_FILE`] ? readFileSync(process.env[`${n}_FILE`], 'utf8').trim() : process.env[n] ?? d);

const NO_FINALES = ['PENDIENTE_APROBACION', 'EN_COLA', 'ENVIADA', 'ENVIANDO', 'PEND_AUTORIZACION'];
const LOTE = 5000;

// Qué se pasa: la columna de fecha de cada tabla y cuándo una fila se considera terminada (lo pendiente o no leído sigue en la operativa).
export const TABLAS = [
  { tabla: 'transferencia', columna: 'creado_en', terminadas: '1 = 1' },
  // el historial de estados pasa cuando su transferencia ya pasó (las abiertas conservan su historial en la operativa)
  { tabla: 'transferencia_estado', columna: 'en', terminadas: 'NOT EXISTS (SELECT 1 FROM dbo.transferencia tr WHERE tr.id = transferencia_estado.transferencia_id)' },
  { tabla: 'auditoria', columna: 'en', terminadas: '1 = 1' },
  { tabla: 'cola_envio', columna: 'encolada_en', terminadas: "estado IN (N'enviado', N'error', N'omitido')" },
  { tabla: 'ejecucion_envio', columna: 'creada_en', terminadas: "estado = N'terminada'" },
  { tabla: 'mensaje', columna: 'creado_en', terminadas: 'visto_en IS NOT NULL' },
  { tabla: 'envio_mail_log', columna: 'en', terminadas: '1 = 1' },
];

const sha256 = () => createHash('sha256');
const primerDiaSiguiente = (periodo) => new Date(Date.UTC(+periodo.slice(0, 4), +periodo.slice(5, 7), 1)).toISOString().slice(0, 10);

// Tipo de T-SQL de cada columna, para leer el JSON de la copia con OPENJSON ... WITH
function tipoSql(c) {
  const t = c.DATA_TYPE;
  if (['nvarchar', 'varchar', 'varbinary', 'nchar', 'char'].includes(t)) return `${t}(${c.CHARACTER_MAXIMUM_LENGTH === -1 ? 'max' : c.CHARACTER_MAXIMUM_LENGTH})`;
  if (['decimal', 'numeric'].includes(t)) return `${t}(${c.NUMERIC_PRECISION},${c.NUMERIC_SCALE})`;
  if (['datetimeoffset', 'datetime2', 'time'].includes(t)) return `${t}(${c.DATETIME_PRECISION})`;
  return t;
}

async function columnas(op, tabla) {
  const { rows } = await op.query(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
       FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = $1 ORDER BY ORDINAL_POSITION`, [tabla]);
  if (!rows.length) throw new Error(`La tabla ${tabla} no existe`);
  return rows.map((r) => ({ nombre: r.COLUMN_NAME, tipo: tipoSql(r) }));
}

// Cada fila como JSON (mismas columnas, mismo orden, en ambas bases): sirve para copiar y para calcular el hash.
const filasJson = (base, tabla, cols, ids) => base.query(
  `SELECT (SELECT ${cols.map((c) => `t.[${c.nombre}]`).join(', ')} FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS j
     FROM dbo.${tabla} t WHERE t.id IN (SELECT CAST(value AS bigint) FROM OPENJSON($1)) ORDER BY t.id`, [ids], { crudo: true });

async function huella(base, tabla, cols, ids) {
  const h = sha256();
  let filas = 0;
  for (let i = 0; i < ids.length; i += LOTE) {
    for (const { j } of (await filasJson(base, tabla, cols, ids.slice(i, i + LOTE))).rows) { h.update(j); h.update('\n'); filas++; }
  }
  return { filas, hash: h.digest('hex') };
}

export async function ejecutarPase(log = console) {
  const abrir = (cfg) => new Base({ ...cfg, max: 2, encrypt: config.db.operativa.encrypt, trustServerCertificate: config.db.operativa.trustServerCertificate, requestTimeoutMs: 300_000 });
  const op = abrir({ host: leer('DB_HOST', 'sqlserver'), port: Number(leer('DB_PORT', '1433')), database: leer('DB_NAME', 'homebanking'), user: leer('DB_PASE_USER', 'hb_pase'), password: leer('DB_PASE_PASSWORD') });
  const hi = abrir({ host: leer('DBH_HOST', leer('DB_HOST', 'sqlserver')), port: Number(leer('DBH_PORT', leer('DB_PORT', '1433'))), database: leer('DBH_NAME', 'homebanking_hist'), user: leer('DBH_PASE_USER', 'hb_pase_h'), password: leer('DBH_PASE_PASSWORD') });
  const corte = mesCorte();
  const resumen = [];
  try {
    for (const t of TABLAS) resumen.push(...(await pasarTabla(op, hi, t, corte, log)));
  } finally {
    await op.end();
    await hi.end();
  }
  return resumen;
}

// Pasa mes a mes lo terminado anterior al corte: copia, verifica y recién entonces borra.
async function pasarTabla(op, hi, { tabla, columna, terminadas }, corte, log) {
  const resumen = [];
  const { rows: meses } = await op.query(
    `SELECT DISTINCT CONVERT(varchar(10), DATEFROMPARTS(YEAR(m.v), MONTH(m.v), 1), 23) AS periodo
       FROM (SELECT SWITCHOFFSET(${columna}, '+00:00') AS v FROM dbo.${tabla} WHERE ${columna} < CAST($1 AS date) AND ${terminadas}) m ORDER BY 1`, [corte]);
  if (!meses.length) return resumen;
  const cols = await columnas(op, tabla);
  const lista = cols.map((c) => `[${c.nombre}]`).join(', ');
  const con = cols.map((c) => `[${c.nombre}] ${c.tipo} '$."${c.nombre}"'`).join(', ');
  for (const { periodo } of meses) {
    const hasta = primerDiaSiguiente(periodo);
    const registrar = (estado, filas, hash, detalle) => op.query(
      'INSERT INTO pase_historico (tabla, periodo, filas, hash, estado, detalle) VALUES ($1, $2, $3, $4, $5, $6)', [tabla, periodo, filas, hash, estado, detalle]);
    if (tabla === 'transferencia') {
      const abiertas = (await op.query(
        `SELECT COUNT(*) AS n FROM dbo.transferencia WHERE ${columna} >= CAST($1 AS date) AND ${columna} < CAST($2 AS date) AND estado IN (SELECT value FROM OPENJSON($3))`,
        [periodo, hasta, NO_FINALES])).rows[0].n;
      if (abiertas) {
        await registrar('OMITIDO', null, null, `${abiertas} transferencias sin estado final; se reintenta el mes próximo`);
        log.warn?.(`Pase omitido ${tabla} ${periodo}: ${abiertas} transferencias abiertas`);
        resumen.push({ tabla, periodo, estado: 'OMITIDO' });
        continue;
      }
    }
    const ids = (await op.query(
      `SELECT CAST(id AS varchar(20)) AS id FROM dbo.${tabla} WHERE ${columna} >= CAST($1 AS date) AND ${columna} < CAST($2 AS date) AND ${terminadas} ORDER BY id`,
      [periodo, hasta])).rows.map((r) => r.id);
    if (!ids.length) continue;
    const origen = await huella(op, tabla, cols, ids);
    try {
      await tx(hi, async (c) => {
        for (let i = 0; i < ids.length; i += LOTE) {
          const { rows } = await filasJson(op, tabla, cols, ids.slice(i, i + LOTE));
          await c.query(
            `INSERT INTO dbo.${tabla} (${lista})
             SELECT ${lista} FROM OPENJSON($1) WITH (${con}) n
              WHERE NOT EXISTS (SELECT 1 FROM dbo.${tabla} h WHERE h.id = n.id)`, [`[${rows.map((r) => r.j).join(',')}]`], { crudo: true });
        }
        const destino = await huella({ query: (q, p, o) => c.query(q, p, o) }, tabla, cols, ids);
        if (destino.filas !== origen.filas || destino.hash !== origen.hash) {
          throw new Error(`Verificación fallida: origen ${origen.filas}/${origen.hash} vs destino ${destino.filas}/${destino.hash}`);
        }
        // Un mes puede pasar en más de una vuelta (filas que terminaron después): se acumula el comprobante
        await c.query(`UPDATE pase_recibido SET filas = filas + $3, hash = $4, recibido_en = SYSDATETIMEOFFSET() WHERE tabla = $1 AND periodo = $2;
          IF @@ROWCOUNT = 0 INSERT INTO pase_recibido (tabla, periodo, filas, hash) VALUES ($1, $2, $3, $4);`, [tabla, periodo, origen.filas, origen.hash]);
      });
    } catch (e) {
      await registrar('ERROR', origen.filas, origen.hash, e.message);
      log.error?.(`Pase con error ${tabla} ${periodo}: ${e.message}`);
      resumen.push({ tabla, periodo, estado: 'ERROR' });
      continue; // las filas quedan en la operativa
    }
    // Copia verificada: recién ahora se borra de la operativa.
    await tx(op, async (c) => {
      for (let i = 0; i < ids.length; i += LOTE) {
        await c.query('DELETE FROM dbo.' + tabla + ' WHERE id IN (SELECT CAST(value AS bigint) FROM OPENJSON($1))', [ids.slice(i, i + LOTE)]);
      }
      await c.query('INSERT INTO pase_historico (tabla, periodo, filas, hash, estado, detalle) VALUES ($1, $2, $3, $4, $5, $6)',
        [tabla, periodo, origen.filas, origen.hash, 'OK', `Movidas a la base histórica (${columna} ${periodo} a ${hasta})`]);
      await c.query(`INSERT INTO auditoria (usuario, rol, tipo, accion, detalle, resultado) VALUES (N'sistema', N'sistema', N'Sistema', N'Pase a base histórica', $1, N'OK')`,
        [`${tabla} ${periodo.slice(0, 7)} · ${origen.filas} filas · hash ${origen.hash}`]);
    });
    resumen.push({ tabla, periodo, estado: 'OK', filas: origen.filas });
  }
  return resumen;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await ejecutarPase());
}
