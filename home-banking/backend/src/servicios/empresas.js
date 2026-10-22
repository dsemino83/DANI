// Reglas del maestro de empresas que no dependen de la base (se prueban en npm test).
import { invalido } from '../errores.js';

export const MAX_EMAILS = 20;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Acepta una lista o un texto separado por comas, punto y coma o saltos de línea. Devuelve los emails
// en minúscula, sin repetidos y en el orden en que llegaron.
export function normalizarEmails(entrada) {
  const crudos = Array.isArray(entrada) ? entrada : String(entrada ?? '').split(/[,;\n]+/);
  const emails = [...new Set(crudos.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  const malos = emails.filter((e) => !EMAIL.test(e));
  if (malos.length) throw invalido(`Email inválido: ${malos.join(', ')}`);
  if (emails.length > MAX_EMAILS) throw invalido(`Hasta ${MAX_EMAILS} emails por empresa`);
  return emails;
}

// Búsqueda "contiene", sin distinguir mayúsculas ni acentos (nombre, alias o número de la cuenta).
const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const coincide = (cuenta, texto) => !texto || [cuenta.nombre, cuenta.alias, cuenta.cuenta].some((v) => plano(v).includes(plano(texto).trim()));

// CBU de una cuenta propia según getOwnAccounts: el banco lo informa en accountCbu. Por si cambia el
// nombre, si no está se toma otro campo cuyo nombre contenga "cbu" o cualquier valor de 22 dígitos.
export function cbuDeCuenta(c) {
  if (!c || typeof c !== 'object') return null;
  const limpio = (v) => String(v ?? '').replace(/[\s-]/g, '');
  const ok = (v) => /^\d{22}$/.test(v);
  if (ok(limpio(c.accountCbu))) return limpio(c.accountCbu);
  const valores = Object.entries(c).map(([k, v]) => [k.toLowerCase(), limpio(v)]);
  return valores.find(([k, v]) => k.includes('cbu') && ok(v))?.[1] ?? valores.find(([, v]) => ok(v))?.[1] ?? null;
}

// Arma la fila de empresa_cbu con la respuesta de COELSA. Si la consulta fue por el CBU de la cuenta y la
// respuesta no lo repite, vale ese CBU; si lo repite, tiene que ser el mismo.
export function filaCoelsa(cuenta, r) {
  const propio = cbuDeCuenta(cuenta);
  const devuelto = String(r?.cbu ?? '').replace(/\D/g, '');
  if (devuelto && devuelto.length === 22 && propio && devuelto !== propio) throw new Error(`COELSA devolvió otro CBU (${devuelto}) que el informado por el banco (${propio})`);
  const cbu = devuelto.length === 22 ? devuelto : propio;
  if (!cbu) throw new Error('COELSA no devolvió un CBU válido');
  const campo = (patron) => Object.entries(r ?? {}).find(([k, v]) => patron.test(k) && typeof v !== 'object' && v !== '')?.[1];
  const alias = r?.alias || campo(/alias/i) || null;
  return { cbu, alias: alias ? String(alias) : null, titular: r?.headline || null, cuitTitular: r?.cuit ? String(r.cuit) : null };
}
