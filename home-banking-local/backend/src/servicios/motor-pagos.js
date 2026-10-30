// Motor de pagos. Las autorizaciones dejan la transferencia EN_COLA; este motor la toma y la envía al
// banco pasando por el MISMO camino único de siempre (enviarUnaVez → envio_banco con PK = id, así nunca
// sale dos veces). Ordena por hora de creación y paraleliza SOLO entre endpoints (api) distintos: hay un
// drenador por endpoint, cada uno procesa de a una y en orden; los distintos endpoints corren a la vez.
import { operativa, tx } from '../db.js';
import { config } from '../config.js';
import { enviarUnaVez, registrarResultado } from './transferencias.js';

let trabajando = false;

// Toma la transferencia EN_COLA más vieja de un endpoint y la pasa a ENVIANDO (atómico, sin pisarse con
// otro proceso). Devuelve la fila tomada, o null si no hay nada encolado para ese endpoint.
async function tomarDeEndpoint(api) {
  return tx(operativa, async (c) => {
    // UPDLOCK + READPAST: salta las filas que otro proceso ya tiene tomadas (equivale a FOR UPDATE SKIP LOCKED)
    const sig = (await c.query(
      `SELECT TOP (1) id FROM transferencia WITH (UPDLOCK, READPAST, ROWLOCK) WHERE estado = N'EN_COLA' AND api = $1 ORDER BY creado_en, id`, [api])).rows[0];
    if (!sig) return null;
    await c.query(`UPDATE transferencia SET estado = N'ENVIANDO', actualizado_en = SYSDATETIMEOFFSET() WHERE id = $1 AND estado = N'EN_COLA'`, [sig.id]);
    return (await c.query('SELECT * FROM transferencia WHERE id = $1', [sig.id])).rows[0];
  });
}

async function enviarUna(t, log) {
  // Historial: deja registrado el paso a ENVIANDO (el motor, no una persona).
  await operativa.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
    [t.id, 'ENVIANDO', 'Motor de pagos', `Enviando al banco por ${t.api}`]);
  // El envío se audita a nombre del autorizante que la aprobó.
  const req = { user: { usuario: t.aprobador ?? 'sistema', rol: 'autorizante' } };
  try {
    const r = await enviarUnaVez(req, t);
    await registrarResultado(req, t, r);
    log?.info?.(`OP-${t.id} enviada por ${t.api}: ${r.estado}`);
  } catch (e) {
    // Si ya tenía envío registrado (409) o el banco cortó, queda en ENVIANDO: el job de estado lo concilia
    // con getTransfersStatus. Nunca se reintenta el envío (envio_banco lo impediría igual).
    log?.warn?.(`OP-${t.id} por ${t.api}: ${e.message}. Queda ENVIANDO; lo concilia el job de estado.`);
  }
}

// Drena un endpoint: de a una y en orden de creación, hasta vaciarlo.
async function drenarEndpoint(api, log) {
  for (let t = await tomarDeEndpoint(api); t; t = await tomarDeEndpoint(api)) await enviarUna(t, log);
}

// Una pasada del motor: procesa todos los endpoints con pagos encolados, en paralelo entre sí.
export async function procesarPagos(log) {
  if (config.soloConsultas) return { soloConsultas: true };
  if (trabajando) return { enCurso: true };
  trabajando = true;
  try {
    const { rows } = await operativa.query(`SELECT DISTINCT api FROM transferencia WHERE estado = N'EN_COLA'`);
    await Promise.all(rows.map((r) => drenarEndpoint(r.api, log)));
    return { endpoints: rows.map((r) => r.api) };
  } finally { trabajando = false; }
}
