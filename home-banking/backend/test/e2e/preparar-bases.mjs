// Deja las dos bases (homebanking y homebanking_hist) vacías y con el esquema y los permisos del repo (db/esquema),
// igual que db-init pero sin sqlcmd. Se conecta como sa a SQL Server: MSSQL_HOST, MSSQL_PORT, MSSQL_SA_PASSWORD.
// Claves de los logins (solo pruebas): HB_APP_PASS, HB_JOBS_PASS, HB_PASE_PASS, HB_HIST_RO_PASS, HB_PASE_H_PASS.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const ESQUEMA = join(dirname(fileURLToPath(import.meta.url)), '../../../db/esquema');
const claves = { HB_APP_PASS: 'apppass-Aa1', HB_JOBS_PASS: 'jobspass-Aa1', HB_PASE_PASS: 'pasepass-Aa1', HB_HIST_RO_PASS: 'ropass-Aa1', HB_PASE_H_PASS: 'pasehpass-Aa1' };
const env = { ...claves, ...Object.fromEntries(Object.keys(claves).filter((k) => process.env[k]).map((k) => [k, process.env[k]])) };

const pool = new sql.ConnectionPool({
  server: process.env.MSSQL_HOST ?? 'localhost', port: Number(process.env.MSSQL_PORT ?? 1433), user: 'sa', password: process.env.MSSQL_SA_PASSWORD,
  database: 'master', pool: { max: 1, min: 1 }, requestTimeout: 120_000, options: { encrypt: true, trustServerCertificate: true },
});
await pool.connect();

// Un archivo .sql se parte en lotes por las líneas "GO" y se reemplazan las variables de sqlcmd $(NOMBRE)
async function aplicar(archivo) {
  const texto = readFileSync(join(ESQUEMA, archivo), 'utf8').replace(/\$\((\w+)\)/g, (_, n) => env[n] ?? (() => { throw new Error(`Falta ${n}`); })());
  for (const lote of texto.split(/^\s*GO\s*$/gim)) if (lote.trim()) await pool.request().batch(lote);
}
const ejecutar = (q) => pool.request().batch(q);

for (const base of ['homebanking', 'homebanking_hist']) {
  await ejecutar(`IF DB_ID(N'${base}') IS NOT NULL BEGIN ALTER DATABASE [${base}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${base}]; END`);
  await ejecutar(`CREATE DATABASE [${base}]`);
  await ejecutar(`ALTER DATABASE [${base}] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE`);
}
for (const [base, carpeta] of [['homebanking', 'operativa'], ['homebanking_hist', 'historica']]) {
  await ejecutar(`USE [${base}]`);
  await aplicar(`${carpeta}/001_esquema.sql`);
  await aplicar(`${carpeta}/permisos.sql`);
}
await pool.close();
console.log('bases listas');
