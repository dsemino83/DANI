// Modo sin internet (docker-compose.sin-internet.yml): carga sola la credencial API del simulador del banco la
// primera vez, para no tener que pedirla ni tipearla. Solo actúa en homologación, con HB_SIMULADOR_LLAVE_URL
// definida y sin credencial principal cargada: nunca pisa una credencial existente ni toca producción.
import { config } from '../config.js';
import { operativa } from '../db.js';
import { urlBase } from '../bdv/ambientes.js';
import { cifrar } from '../secretos.js';
import { auditarSistema } from '../auditoria.js';

export async function cargarCredencialSimulador(log) {
  const urlLlave = process.env.HB_SIMULADOR_LLAVE_URL;
  if (!urlLlave || config.ambiente !== 'homo') return false;
  const { rows } = await operativa.query(`SELECT COUNT(*) AS n FROM credencial_api WHERE ambiente = N'homo' AND uso = N'principal'`);
  if (rows[0].n > 0) return false;
  let llave = '';
  for (let i = 0; i < 10 && !llave; i++) {
    try { llave = (await (await fetch(urlLlave, { signal: AbortSignal.timeout(3000) })).text()).trim(); } catch { await new Promise((ok) => setTimeout(ok, 2000)); }
  }
  if (!llave) { log.warn('No se pudo leer la llave del simulador del banco: cargar la credencial a mano en Credenciales API'); return false; }
  const clave = cifrar(process.env.SIM_CLAVE || 'clave-simulador');
  await operativa.query(
    `INSERT INTO credencial_api (ambiente, uso, url, usuario, identification, terminal, channel, rsa_public_key, clave_ya_cifrada,
                                 clave_cifrada, clave_iv, clave_tag, clave_cargada_por, clave_cargada_en, actualizado_por)
     VALUES (N'homo', N'principal', $1, N'simulador', N'30500000018', N'HB-LOCAL', N'3', $2, 0, $3, $4, $5, N'sistema', SYSDATETIMEOFFSET(), N'sistema')`,
    [urlBase('homo'), llave, clave.cifrado, clave.iv, clave.tag]);
  await auditarSistema(null, { tipo: 'Administración', accion: 'Cargó la credencial del simulador del banco', api: 'Credenciales API', detalle: 'modo sin internet · homologación · datos ficticios' });
  log.info('Credencial del simulador del banco cargada');
  return true;
}
