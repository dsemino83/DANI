// Dos bases en SQL Server: operativa (lectura/escritura, mes en curso + HB_RETENCION_MESES) e histórica (solo lectura).
// Cada una tiene su pool. Las consultas se escriben en T-SQL con parámetros posicionales $1, $2, ... (se convierten a @p1, @p2 al
// ejecutar); los resultados vuelven como { rows, rowCount } y las listas/JSON guardados como texto se devuelven ya convertidos.
import sql from 'mssql';
import { config } from './config.js';
import { mesCorte } from './corte.js';

// Columnas que guardan una lista o un JSON como texto (nvarchar(max) con ISJSON): se devuelven como arreglo u objeto.
const COLUMNAS_JSON = new Set(['emails', 'destinatarios', 'cuentas', 'empresas', 'dias_semana', 'destinos', 'request', 'respuesta', 'datos']);

// Tipo de cada parámetro según el valor de JS. Las listas y los objetos viajan como JSON (se leen con OPENJSON).
function parametro(v) {
  if (v === null || v === undefined) return [sql.NVarChar(4000), null];
  if (v instanceof Date) return [sql.DateTimeOffset(3), v];
  if (typeof v === 'boolean') return [sql.Bit, v];
  if (typeof v === 'bigint') return [sql.BigInt, v.toString()];
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return Math.abs(v) <= 2147483647 ? [sql.Int, v] : [sql.BigInt, v];
    return [sql.Decimal(28, 6), v];
  }
  if (Buffer.isBuffer(v)) return [sql.VarBinary(sql.MAX), v];
  if (typeof v === 'object') return [sql.NVarChar(sql.MAX), JSON.stringify(v)];
  const s = String(v);
  return [s.length <= 4000 ? sql.NVarChar(4000) : sql.NVarChar(sql.MAX), s];
}

const dosDigitos = (n) => String(n).padStart(2, '0');

// Convierte una fila: date -> 'AAAA-MM-DD', time -> 'HH:MM:SS' (tal cual, sin pasar por la zona horaria) y JSON -> objeto.
function normalizar(filas, columnas, { crudo = false } = {}) {
  const fechas = [], horas = [];
  for (const [nombre, c] of Object.entries(columnas ?? {})) {
    if (c.type === sql.Date) fechas.push(nombre);
    else if (c.type === sql.Time) horas.push(nombre);
  }
  for (const f of filas) {
    for (const n of fechas) if (f[n] instanceof Date) f[n] = f[n].toISOString().slice(0, 10);
    for (const n of horas) {
      if (f[n] instanceof Date) f[n] = `${dosDigitos(f[n].getUTCHours())}:${dosDigitos(f[n].getUTCMinutes())}:${dosDigitos(f[n].getUTCSeconds())}`;
    }
    if (!crudo) {
      for (const n of Object.keys(f)) {
        const v = f[n];
        if (COLUMNAS_JSON.has(n) && typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) f[n] = JSON.parse(v);
      }
    }
  }
  return filas;
}

async function ejecutar(request, texto, params = [], opciones = {}) {
  const sentencia = texto.replace(/\$(\d+)/g, (_, n) => `@p${n}`);
  params.forEach((v, i) => { const [tipo, valor] = parametro(v); request.input(`p${i + 1}`, tipo, valor); });
  const r = await request.query(sentencia);
  const rows = normalizar(r.recordset ?? [], r.recordset?.columns, opciones);
  return { rows, rowCount: r.recordset ? rows.length : (r.rowsAffected?.[0] ?? 0) };
}

// Un cliente dentro de una transacción (lo que recibe la función de tx()).
class Cliente {
  constructor(transaccion) { this.transaccion = transaccion; }
  query(texto, params, opciones) { return ejecutar(new sql.Request(this.transaccion), texto, params, opciones); }
}

export class Base {
  constructor(cfg) {
    this.cfg = cfg;
    this.pool = null;
  }

  async conectar() {
    if (!this.pool) {
      const c = this.cfg;
      const pool = new sql.ConnectionPool({
        server: c.host, port: c.port, database: c.database, user: c.user, password: c.password,
        pool: { max: c.max, min: 0, idleTimeoutMillis: 30_000 },
        requestTimeout: c.requestTimeoutMs, connectionTimeout: 15_000,
        options: { encrypt: c.encrypt, trustServerCertificate: c.trustServerCertificate, useUTC: true, enableArithAbort: true, appName: 'home-banking' },
      });
      pool.on('error', () => { this.pool = null; }); // se vuelve a conectar en la próxima consulta
      this.pool = pool.connect().then(() => pool, (e) => { this.pool = null; throw e; });
    }
    return this.pool;
  }

  async query(texto, params, opciones) {
    return ejecutar((await this.conectar()).request(), texto, params, opciones);
  }

  async transaccion() {
    const t = new sql.Transaction(await this.conectar());
    await t.begin();
    return t;
  }

  async end() {
    if (!this.pool) return;
    const p = await this.pool.catch(() => null);
    this.pool = null;
    await p?.close();
  }
}

// Errores de SQL Server que la aplicación distingue: 2627/2601 = clave duplicada; 547 = violación de CHECK o de clave foránea
export const esDuplicado = (e) => e?.number === 2627 || e?.number === 2601;
export const esRestriccion = (e) => e?.number === 547;

export const operativa = new Base(config.db.operativa);
export const historica = new Base(config.db.historica);

// Ejecuta fn dentro de una transacción; si fn lanza, revierte todo (incluida la auditoría).
export async function tx(base, fn) {
  const t = await base.transaccion();
  try {
    const r = await fn(new Cliente(t));
    await t.commit();
    return r;
  } catch (e) {
    await t.rollback().catch(() => {}); // un trigger puede haber revertido ya la transacción
    throw e;
  }
}

// Qué columna de fecha tiene cada tabla que pasa a la histórica
const COLUMNA_FECHA = { transferencia: 'creado_en', transferencia_estado: 'en', auditoria: 'en' };

// Fecha de corte de una tabla: lo anterior vive en la base histórica. Es el primer día del mes de retención,
// salvo que la operativa todavía tenga un mes anterior sin pasar (el pase corre el día 1 de madrugada, o se
// omitió porque había transferencias abiertas): entonces el corte es ese mes, porque ahí están los datos.
export async function fechaCorte(tabla = 'transferencia', hoy = new Date()) {
  const columna = COLUMNA_FECHA[tabla];
  if (!columna) throw new Error(`Tabla sin fecha de corte: ${tabla}`);
  const corte = mesCorte(hoy, config.retencionMesesOperativa);
  const { rows: [r] } = await operativa.query(
    `SELECT CONVERT(varchar(10), DATEFROMPARTS(YEAR(m.v), MONTH(m.v), 1), 23) AS desde
       FROM (SELECT SWITCHOFFSET(MIN(${columna}), '+00:00') AS v FROM ${tabla}) m`);
  return r?.desde && r.desde < corte ? r.desde : corte;
}
