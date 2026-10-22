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

// CBU de una cuenta propia según getOwnAccounts (el nombre del campo varía); null si no viene.
export const cbuDeCuenta = (c) => [c?.cbu, c?.cbuNumber, c?.productCbu, c?.cbuCvu]
  .map((v) => String(v ?? '').replace(/\D/g, '')).find((v) => v.length === 22) ?? null;

// Arma la fila de empresa_cbu con la respuesta de COELSA; valida que el CBU sea el de la cuenta.
export function filaCoelsa(cuenta, r) {
  const cbu = String(r?.cbu ?? '').replace(/\D/g, '');
  if (cbu.length !== 22) throw new Error('COELSA no devolvió un CBU válido');
  const propio = cbuDeCuenta(cuenta);
  if (propio && propio !== cbu) throw new Error(`COELSA devolvió otro CBU (${cbu}) que el informado por el banco (${propio})`);
  return { cbu, alias: r.alias || null, titular: r.headline || null, cuitTitular: r.cuit ? String(r.cuit) : null };
}
