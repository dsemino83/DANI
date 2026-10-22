// Circuito de transferencias: CREAR (interno, sin banco) -> APROBAR (otro usuario) -> ENVIAR (API del banco).
import { operativa, historica, tx } from '../db.js';
import { auditar } from '../auditoria.js';
import { conflicto, noEncontrado, prohibido, invalido, riesgoAlto } from '../errores.js';
import { evaluarRiesgo, resumenRiesgo } from './riesgo.js';
import { config } from '../config.js';

// Modo solo consultas: se rechaza la aprobación antes de tocar la transferencia (queda pendiente).
export function exigirEnviosHabilitados() {
  if (config.soloConsultas) throw conflicto('Modo solo consultas (BDV_SOLO_CONSULTAS): las transferencias no se envían al banco. Queda pendiente de aprobación.');
}
import { exigirCuenta } from '../permisos.js';
import { avisarPendiente, textoTransferencia } from './mensajes.js';
import { cuentasPropias } from '../bdv/cliente.js';
import { API_POR_TIPO, armarRequest, enviar } from '../bdv/transferencias.js'; // enviar: solo desde enviarUnaVez

const apiCorta = (tipo) => API_POR_TIPO[tipo].split('/')[1];

export async function cuentaOrigenDelBanco(numero) {
  const c = (await cuentasPropias()).find((x) => String(x.productNumber) === String(numero));
  if (!c) throw invalido('La cuenta origen no figura en el banco');
  return c;
}

// ID de la operación: 1 a 40 caracteres (letras, números, . _ / -), sin distinguir mayúsculas.
export function normalizarId(valor) {
  const id = String(valor ?? '').trim().toUpperCase();
  if (!id) throw invalido('Falta el ID de la operación');
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(id)) throw invalido(`ID de operación inválido: ${id} (hasta 40 caracteres: letras, números, . _ / -)`);
  return id;
}

// IDs ya usados (para avisar en el detalle previo): Map ID -> OP-n
export async function idsUsados(cliente, ids) {
  if (!ids.length) return new Map();
  const { rows } = await cliente.query('SELECT referencia, transferencia_id FROM referencia_usada WHERE referencia = ANY($1)', [ids]);
  return new Map(rows.map((r) => [r.referencia, r.transferencia_id]));
}

// Inserta una transferencia PENDIENTE_APROBACION. No llama a ninguna API de transferencia.
// El ID de operación se reserva en la misma transacción: si ya existe, no se carga nada.
export async function crearPendiente(cliente, req, { tipo, origen, datos, loteId = null }) {
  const referencia = normalizarId(datos.referencia);
  const request = armarRequest(tipo, origen, datos);
  const { rows } = await cliente.query(
    `INSERT INTO transferencia (tipo, api, cuenta_origen, moneda, destino, titular, cuit_destino, importe, concepto, request, creador, estado, lote_id, referencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDIENTE_APROBACION', $12, $13)
     RETURNING id, creado_en`,
    [tipo, apiCorta(tipo), origen.productNumber, Number(origen.currencyId) === 80 ? 'ARS' : 'USD', String(datos.destino ?? ''),
      datos.titular ?? null, datos.cuitDestino ?? null, Number(datos.importe), datos.concepto ?? datos.conceptoLibre ?? null,
      request, req.user.usuario, loteId, referencia],
  );
  const t = rows[0];
  await cliente.query('SAVEPOINT referencia');
  try {
    await cliente.query('INSERT INTO referencia_usada (referencia, transferencia_id, creador) VALUES ($1, $2, $3)', [referencia, t.id, req.user.usuario]);
  } catch (e) {
    if (e.code !== '23505') throw e;
    await cliente.query('ROLLBACK TO SAVEPOINT referencia');
    const previa = (await cliente.query('SELECT transferencia_id FROM referencia_usada WHERE referencia = $1', [referencia])).rows[0];
    throw conflicto(`El ID ${referencia} ya fue cargado${previa ? ` (OP-${previa.transferencia_id})` : ''}: no se puede cargar dos veces la misma transferencia`);
  }
  await cliente.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
    [t.id, 'PENDIENTE_APROBACION', req.user.usuario, `${loteId ? `Lote ${loteId}` : 'Carga individual'} · ID ${referencia}`]);
  return { id: t.id, referencia, request };
}

export async function crear(req, { tipo, cuentaOrigen, ...datos }) {
  if (!API_POR_TIPO[tipo]) throw invalido('Tipo de transferencia inválido');
  normalizarId(datos.referencia); // valida antes de consultar al banco
  await exigirCuenta(req.user.usuario, cuentaOrigen, { operar: true });
  const origen = await cuentaOrigenDelBanco(cuentaOrigen);
  return tx(operativa, async (c) => {
    const t = await crearPendiente(c, req, { tipo, origen, datos });
    await auditar(c, req, {
      tipo: 'Transferencias', accion: `Cargó transferencia ${tipo}`, ref: { tipo: 'transferencia', id: t.id },
      detalle: `OP-${t.id} · ID ${t.referencia} · ${datos.titular ?? ''} ${datos.destino ?? ''} · ${datos.importe} · queda pendiente de aprobación`,
    });
    // Aviso en el buzón de las personas asociadas al cliente de la cuenta de origen
    await avisarPendiente(c, req, { refTipo: 'transferencia', refId: t.id, cuentas: [cuentaOrigen],
      ...textoTransferencia(req, { id: t.id, tipo, importe: datos.importe, moneda: Number(origen.currencyId) === 80 ? 'ARS' : 'USD', cuenta_origen: cuentaOrigen, titular: datos.titular, destino: datos.destino }) });
    return { id: t.id, referencia: t.referencia, estado: 'PENDIENTE_APROBACION', request: t.request };
  });
}

// Bloquea la fila, valida doble control y la pasa a ENVIANDO (o RECHAZADA) en una transacción.
async function tomarParaDecision(req, id, aprobar) {
  return tx(operativa, async (c) => {
    const { rows } = await c.query('SELECT * FROM transferencia WHERE id = $1 FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw noEncontrado('Transferencia inexistente');
    if (t.lote_id) throw conflicto('Pertenece a un lote: se aprueba o rechaza el lote completo');
    if (t.estado !== 'PENDIENTE_APROBACION') throw conflicto(`La transferencia está en estado ${t.estado}`);
    if (t.creador === req.user.usuario) throw prohibido('No podés aprobar ni rechazar una transferencia que cargaste vos');
    await exigirCuenta(req.user.usuario, t.cuenta_origen); // el aprobador también debe ver la empresa
    // Señales de fraude: con riesgo ALTO, aprobar exige que el aprobador confirme que las revisó
    const riesgo = (await evaluarRiesgo([t.id], c)).get(Number(t.id));
    if (aprobar && riesgo?.nivel === 'alto' && req.body?.confirmoRiesgo !== true) {
      throw riesgoAlto(`Riesgo ALTO: ${riesgo.senales.map((x) => x.texto).join('; ')}. Revisá y confirmá para aprobar.`);
    }
    const estado = aprobar ? 'ENVIANDO' : 'RECHAZADA';
    // Condicional sobre el estado: si otra aprobación ganó la carrera, no cambia nada y se aborta.
    const u = await c.query(`UPDATE transferencia SET estado = $2, aprobador = $3, aprobado_en = now(), actualizado_en = now()
                              WHERE id = $1 AND estado = 'PENDIENTE_APROBACION'`, [id, estado, req.user.usuario]);
    if (u.rowCount !== 1) throw conflicto('La transferencia ya fue procesada por otro usuario');
    await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
      [id, estado, req.user.usuario, aprobar ? `Aprobada; se envía por ${t.api}` : 'Rechazada; no se envía al banco']);
    await auditar(c, req, {
      tipo: 'Transferencias', accion: aprobar ? 'Aprobó transferencia' : 'Rechazó transferencia', api: aprobar ? t.api : null,
      detalle: `OP-${id} · ${t.titular ?? t.destino} · ${t.importe} ${t.moneda} · cargada por ${t.creador} · ${resumenRiesgo(riesgo)}${riesgo?.nivel === 'alto' && aprobar ? ' · confirmado por el aprobador' : ''}`, ref: { tipo: 'transferencia', id },
    });
    return t;
  });
}

// ÚNICO camino hacia una API de transferencia. Antes de llamar al banco deja confirmada
// una fila en envio_banco (clave primaria = id de la transferencia): si ya existe, la
// operación ya salió (o está saliendo) y no se envía de nuevo, pase lo que pase.
export async function enviarUnaVez(req, t) {
  exigirEnviosHabilitados(); // segunda barrera: nunca se registra ni se envía nada en este modo
  await tx(operativa, async (c) => {
    const actual = (await c.query('SELECT estado FROM transferencia WHERE id = $1 FOR UPDATE', [t.id])).rows[0];
    if (actual?.estado !== 'ENVIANDO') throw conflicto(`OP-${t.id} está en estado ${actual?.estado ?? 'inexistente'}: no se envía`);
    try {
      await c.query('INSERT INTO envio_banco (transferencia_id, api, aprobador) VALUES ($1, $2, $3)', [t.id, t.api, req.user.usuario]);
    } catch (e) {
      if (e.code === '23505') throw conflicto(`OP-${t.id} ya tiene un envío registrado: nunca se envía dos veces`);
      throw e;
    }
  });
  return enviar(t.tipo, t.request); // recién acá se conecta con el banco
}

// Registra el resultado del banco (estado final o pendiente) con auditoría.
// Acepta ENVIADA por si el job ya la marcó como incierta mientras esperaba la respuesta.
export async function registrarResultado(req, t, r) {
  await tx(operativa, async (c) => {
    const u = await c.query(
      `UPDATE transferencia SET estado = $2, transaction_id = $3, nro_control = $4, respuesta = $5, actualizado_en = now()
        WHERE id = $1 AND estado IN ('ENVIANDO', 'ENVIADA')`,
      [t.id, r.estado, r.transactionId, r.nroControl, r.respuesta ?? null]);
    if (u.rowCount !== 1) throw new Error(`OP-${t.id}: no estaba en ENVIANDO/ENVIADA al registrar la respuesta del banco`);
    await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
      [t.id, r.estado, 'Banco de Valores', r.detalle ?? (r.transactionId ? `transactionId ${r.transactionId}` : '')]);
    await auditar(c, req, {
      tipo: 'Transferencias', accion: `Envió transferencia por ${t.api}`, api: t.api,
      detalle: `OP-${t.id} · ${r.transactionId ? `transactionId ${r.transactionId} · ` : ''}estado ${r.estado}${r.detalle ? ` · ${r.detalle}` : ''}`,
      resultado: r.estado === 'ERROR_API' ? 'Error' : 'OK', ref: { tipo: 'transferencia', id: t.id },
    });
  });
}

export async function aprobar(req, id) {
  exigirEnviosHabilitados();
  const t = await tomarParaDecision(req, id, true);
  const r = await enviarUnaVez(req, t);
  await registrarResultado(req, t, r);
  return { id, estado: r.estado, transactionId: r.transactionId };
}

export async function rechazar(req, id) {
  await tomarParaDecision(req, id, false);
  return { id, estado: 'RECHAZADA' };
}

// Historial completo de una operación (ruedita ⚙): base operativa y, si no está, histórica.
export async function auditoriaDeOperacion(req, id) {
  for (const [pool, base] of [[operativa, 'operativa'], [historica, 'historica']]) {
    const { rows } = await pool.query('SELECT * FROM transferencia WHERE id = $1', [id]);
    if (!rows[0]) continue;
    const t = rows[0];
    await exigirCuenta(req.user.usuario, t.cuenta_origen);
    const estados = (await pool.query('SELECT estado, usuario, detalle, en FROM transferencia_estado WHERE transferencia_id = $1 ORDER BY en, id', [id])).rows;
    const audit = (await pool.query(
      `SELECT en, usuario, rol, accion, api, detalle, resultado FROM auditoria
        WHERE ref_tipo = 'transferencia' AND ref_id = $1 ORDER BY en, id`, [String(id)])).rows;
    const debito = (await operativa.query('SELECT * FROM debito_transferencia WHERE transferencia_id = $1', [id])).rows[0] ?? null;
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó auditoría de la operación', detalle: `OP-${id} (${base})` });
    const { request, respuesta, ...resumen } = t;
    return { base, transferencia: resumen, estados, auditoria: audit, debito };
  }
  throw noEncontrado('Transferencia inexistente');
}
