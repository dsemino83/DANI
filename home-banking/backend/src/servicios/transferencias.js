// Circuito de transferencias: CREAR (interno, sin banco) -> APROBAR (otro usuario) -> ENVIAR (API del banco).
import { operativa, historica, tx } from '../db.js';
import { auditar } from '../auditoria.js';
import { conflicto, noEncontrado, prohibido, invalido } from '../errores.js';
import { exigirCuenta } from '../permisos.js';
import { cuentasPropias } from '../bdv/cliente.js';
import { API_POR_TIPO, armarRequest, enviar } from '../bdv/transferencias.js';

const apiCorta = (tipo) => API_POR_TIPO[tipo].split('/')[1];

export async function cuentaOrigenDelBanco(numero) {
  const c = (await cuentasPropias()).find((x) => String(x.productNumber) === String(numero));
  if (!c) throw invalido('La cuenta origen no figura en el banco');
  return c;
}

// Inserta una transferencia PENDIENTE_APROBACION. No llama a ninguna API de transferencia.
export async function crearPendiente(cliente, req, { tipo, origen, datos, loteId = null }) {
  const request = armarRequest(tipo, origen, datos);
  const { rows } = await cliente.query(
    `INSERT INTO transferencia (tipo, api, cuenta_origen, moneda, destino, titular, cuit_destino, importe, concepto, request, creador, estado, lote_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDIENTE_APROBACION', $12)
     RETURNING id, creado_en`,
    [tipo, apiCorta(tipo), origen.productNumber, Number(origen.currencyId) === 80 ? 'ARS' : 'USD', String(datos.destino ?? ''),
      datos.titular ?? null, datos.cuitDestino ?? null, Number(datos.importe), datos.concepto ?? datos.conceptoLibre ?? null,
      request, req.user.usuario, loteId],
  );
  const t = rows[0];
  await cliente.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
    [t.id, 'PENDIENTE_APROBACION', req.user.usuario, loteId ? `Lote ${loteId}` : 'Carga individual']);
  return { id: t.id, request };
}

export async function crear(req, { tipo, cuentaOrigen, ...datos }) {
  if (!API_POR_TIPO[tipo]) throw invalido('Tipo de transferencia inválido');
  await exigirCuenta(req.user.usuario, cuentaOrigen, { operar: true });
  const origen = await cuentaOrigenDelBanco(cuentaOrigen);
  return tx(operativa, async (c) => {
    const t = await crearPendiente(c, req, { tipo, origen, datos });
    await auditar(c, req, {
      tipo: 'Transferencias', accion: `Cargó transferencia ${tipo}`, ref: { tipo: 'transferencia', id: t.id },
      detalle: `OP-${t.id} · ${datos.titular ?? ''} ${datos.destino ?? ''} · ${datos.importe} · queda pendiente de aprobación`,
    });
    return { id: t.id, estado: 'PENDIENTE_APROBACION', request: t.request };
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
    const estado = aprobar ? 'ENVIANDO' : 'RECHAZADA';
    // Condicional sobre el estado: si otra aprobación ganó la carrera, no cambia nada y se aborta.
    const u = await c.query(`UPDATE transferencia SET estado = $2, aprobador = $3, aprobado_en = now(), actualizado_en = now()
                              WHERE id = $1 AND estado = 'PENDIENTE_APROBACION'`, [id, estado, req.user.usuario]);
    if (u.rowCount !== 1) throw conflicto('La transferencia ya fue procesada por otro usuario');
    await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
      [id, estado, req.user.usuario, aprobar ? `Aprobada; se envía por ${t.api}` : 'Rechazada; no se envía al banco']);
    await auditar(c, req, {
      tipo: 'Transferencias', accion: aprobar ? 'Aprobó transferencia' : 'Rechazó transferencia', api: aprobar ? t.api : null,
      detalle: `OP-${id} · ${t.titular ?? t.destino} · ${t.importe} ${t.moneda} · cargada por ${t.creador}`, ref: { tipo: 'transferencia', id },
    });
    return t;
  });
}

// Registra el resultado del banco (estado final o pendiente) con auditoría.
export async function registrarResultado(req, t, r) {
  await tx(operativa, async (c) => {
    const u = await c.query(
      `UPDATE transferencia SET estado = $2, transaction_id = $3, nro_control = $4, respuesta = $5, actualizado_en = now()
        WHERE id = $1 AND estado = 'ENVIANDO'`,
      [t.id, r.estado, r.transactionId, r.nroControl, r.respuesta ?? null]);
    if (u.rowCount !== 1) throw new Error(`OP-${t.id}: no estaba en ENVIANDO al registrar la respuesta del banco`);
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
  const t = await tomarParaDecision(req, id, true);
  const r = await enviar(t.tipo, t.request); // recién acá se conecta con el banco
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
