// CBU de cada cuenta desde el modelo semántico "CUENTAS CBU" de Power BI (área Patrimonios), igual que la rama VALO:
// - API: aplicación de Microsoft Entra (service principal) → executeQueries. PBI_TENANT_ID + PBI_CLIENT_ID + secreto.
// - Flujo: Power Automate con "Ejecutar una consulta en un conjunto de datos". PBI_FLUJO_URL + secreto (la clave del flujo).
// El secreto (client secret o clave del flujo) es un Docker secret; nunca viaja al navegador ni a los logs.
import { config } from './config.js';

const pbi = config.powerbi;
const MINUTOS_CACHE = 10;

export const modoPowerBI = (c = pbi) => (!c.secreto ? null : c.flujoUrl ? 'flujo' : c.tenantId && c.clientId ? 'api' : null);

const columna = (tabla, col) => `'${tabla.replace(/'/g, "''")}'[${col.replace(/]/g, ']]')}]`;
export const daxCbus = ({ tabla, colCuenta, colCbu } = pbi) =>
  `EVALUATE SELECTCOLUMNS('${tabla.replace(/'/g, "''")}', "cuenta", ${columna(tabla, colCuenta)}, "cbu", ${columna(tabla, colCbu)})`;

// Power BI devuelve las columnas como "[cuenta]" (o "Tabla[cuenta]"); el flujo, las filas tal cual.
const nombreColumna = (k) => (String(k).match(/\[([^\]]+)\]$/)?.[1] ?? String(k)).toLowerCase();
export function leerFilas(respuesta) {
  const filas = Array.isArray(respuesta) ? respuesta
    : respuesta?.results?.[0]?.tables?.[0]?.rows ?? respuesta?.firstTableRows ?? respuesta?.filas;
  if (!Array.isArray(filas)) throw new Error('Power BI no devolvió filas');
  return filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [nombreColumna(k), v])));
}

// Mismo número de cuenta aunque uno venga con ceros a la izquierda o separadores.
export const claveCuenta = (n) => String(n ?? '').replace(/\D/g, '').replace(/^0+/, '');

// { cuenta → CBU }. Un CBU numérico de más de 15 dígitos pierde precisión en JSON y queda descartado por el largo;
// una cuenta con dos CBU distintos en el modelo queda sin CBU (no se adivina).
export function mapaCbus(filas) {
  const m = new Map(), dudosas = new Set();
  for (const f of filas) {
    const cuenta = claveCuenta(f.cuenta);
    const cbu = typeof f.cbu === 'string' ? f.cbu.replace(/\D/g, '') : '';
    if (!cuenta || cbu.length !== 22) continue;
    if (m.has(cuenta) && m.get(cuenta) !== cbu) dudosas.add(cuenta);
    m.set(cuenta, cbu);
  }
  for (const c of dudosas) m.delete(c);
  return m;
}

async function pedir(url, opciones, que) {
  let res;
  try { res = await fetch(url, { ...opciones, signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new Error(`no se pudo conectar con ${que} (${e.name})`); }
  const texto = await res.text();
  if (!res.ok) throw new Error(`${que} respondió HTTP ${res.status}: ${texto.slice(0, 200)}`);
  try { return JSON.parse(texto); } catch { throw new Error(`${que} devolvió una respuesta ilegible`); }
}

let token = null, tokenVence = 0;
async function tokenEntra() {
  if (token && Date.now() < tokenVence) return token;
  const j = await pedir(`https://login.microsoftonline.com/${encodeURIComponent(pbi.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: pbi.clientId, client_secret: pbi.secreto,
      scope: 'https://analysis.windows.net/powerbi/api/.default' }),
  }, 'el login de Microsoft');
  token = j.access_token;
  tokenVence = Date.now() + (Number(j.expires_in ?? 3600) - 300) * 1000;
  return token;
}

export async function consultarPowerBI(dax) {
  const modo = modoPowerBI();
  if (!modo) throw new Error('Power BI no está configurado (PBI_TENANT_ID, PBI_CLIENT_ID y secreto, o PBI_FLUJO_URL y clave)');
  if (modo === 'flujo') {
    return leerFilas(await pedir(pbi.flujoUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave: pbi.secreto, consulta: dax }) }, 'el flujo de Power BI'));
  }
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${pbi.grupo}/datasets/${pbi.modelo}/executeQueries`;
  const body = JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } });
  const llamar = async () => pedir(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenEntra()}` }, body }, 'Power BI');
  try { return leerFilas(await llamar()); }
  catch (e) {
    if (!/HTTP 401/.test(e.message)) throw e;
    token = null; // token revocado o vencido antes de tiempo: uno nuevo y un reintento
    return leerFilas(await llamar());
  }
}

let cache = null, cacheEn = 0;
export async function cbusPowerBI() {
  if (!modoPowerBI()) return null;
  if (cache && Date.now() - cacheEn < MINUTOS_CACHE * 60000) return cache;
  cache = mapaCbus(await consultarPowerBI(daxCbus()));
  cacheEn = Date.now();
  return cache;
}
