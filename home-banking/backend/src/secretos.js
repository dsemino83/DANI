// Credenciales API Banking: una principal por ambiente y una adicional, exclusiva de los envíos programados
// de correo (uso 'envios'). La clave se guarda cifrada (AES-256-GCM) con la llave maestra
// del Docker secret y nunca se devuelve al frontend. En producción puede reemplazarse
// por Vault manteniendo esta misma interfaz (guardar / leer / estado).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { operativa } from './db.js';
import { urlBase } from './bdv/ambientes.js';

export function cifrar(texto) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', config.llaveMaestra, iv);
  const cifrado = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return { cifrado, iv, tag: c.getAuthTag() };
}

export function descifrar({ cifrado, iv, tag }) {
  const d = createDecipheriv('aes-256-gcm', config.llaveMaestra, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(cifrado), d.final()]).toString('utf8');
}

export const USOS = { principal: 'Principal (Home Banking)', envios: 'Envíos programados de correo' };
export const esUso = (u) => Object.hasOwn(USOS, u ?? '');

// Credencial completa (con clave en claro) — solo para el cliente del banco, en memoria.
export async function leerCredencial(ambiente = config.ambiente, uso = 'principal') {
  const { rows } = await operativa.query('SELECT * FROM credencial_api WHERE ambiente = $1 AND uso = $2', [ambiente, uso]);
  const r = rows[0];
  if (!r) return null;
  return {
    ambiente, uso, version: `${uso}@${r.actualizado_en.toISOString()}`, url: urlBase(ambiente), // siempre la del ambiente, nunca una cargada a mano
    usuario: r.usuario, identification: r.identification, terminal: r.terminal, channel: r.channel,
    rsaPublicKey: r.rsa_public_key, claveYaCifrada: r.clave_ya_cifrada, activa: r.activa,
    clave: descifrar({ cifrado: r.clave_cifrada, iv: r.clave_iv, tag: r.clave_tag }),
  };
}

// Estado visible para el administrador: nunca incluye la clave.
// Qué credencial usaría hoy un cliente del banco de ese uso: la propia o, si no está cargada, la principal.
export async function versionCredencial(ambiente, uso) {
  const { rows } = await operativa.query(
    `SELECT uso, actualizado_en FROM credencial_api WHERE ambiente = $1 AND uso = ANY($2) ORDER BY uso = $3 DESC LIMIT 1`,
    [ambiente, [uso, 'principal'], uso]);
  return rows[0] ? `${rows[0].uso}@${rows[0].actualizado_en.toISOString()}` : null;
}

export async function estadoCredencial(ambiente, uso = 'principal') {
  const { rows } = await operativa.query(
    `SELECT ambiente, url, usuario, identification, terminal, channel,
            clave_cargada_por, clave_cargada_en, actualizado_por, actualizado_en,
            (rsa_public_key <> '') AS rsa_cargada, clave_ya_cifrada, activa
       FROM credencial_api WHERE ambiente = $1 AND uso = $2`, [ambiente, uso]);
  const r = rows[0];
  if (!r) return { ambiente, uso, configurada: false, url: urlBase(ambiente) };
  return {
    ambiente, uso, configurada: true, url: urlBase(ambiente), usuario: r.usuario,
    identification: r.identification.replace(/^(\d{2})\d+(\d{2})$/, '$1•••••$2'),
    terminal: r.terminal, channel: r.channel, rsaCargada: r.rsa_cargada, claveYaCifrada: r.clave_ya_cifrada, activa: r.activa,
    claveCargadaPor: r.clave_cargada_por, claveCargadaEn: r.clave_cargada_en,
    actualizadoPor: r.actualizado_por, actualizadoEn: r.actualizado_en,
  };
}
