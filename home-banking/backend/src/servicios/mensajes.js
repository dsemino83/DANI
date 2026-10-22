// Buzón de mensajes: cuando se carga una operación que necesita autorización, avisa a las personas asociadas
// a los clientes de esa operación (permiso Ver sobre la empresa), salvo a quien la cargó (no puede aprobarla).
const pesos = (v, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(v ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Dentro de la misma transacción que crea la operación: si la carga se revierte, no queda ningún aviso.
export async function avisarPendiente(c, req, { refTipo, refId, cuentas, titulo, texto }) {
  const { rows: empresas } = await c.query(
    `SELECT DISTINCT e.id, e.razon_social FROM empresa_cbu ec JOIN empresa e ON e.id = ec.empresa_id
      WHERE ec.estado = 'activa' AND ec.product_number = ANY($1)`, [[...new Set(cuentas.map(String))]]);
  if (!empresas.length) return 0;
  const { rows: destinatarios } = await c.query(
    `SELECT DISTINCT usuario FROM permiso_empresa WHERE ver AND empresa_id = ANY($1) AND usuario <> $2 ORDER BY usuario`,
    [empresas.map((e) => e.id), req.user.usuario]);
  for (const { usuario } of destinatarios) {
    await c.query(`INSERT INTO mensaje (usuario, titulo, texto, empresas, ref_tipo, ref_id, creado_por) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuario, titulo, texto, empresas.map((e) => e.razon_social).sort(), refTipo, refId, req.user.usuario]);
  }
  return destinatarios.length;
}

export const textoTransferencia = (req, t) => ({
  titulo: `Operación pendiente de autorización · OP-${t.id}`,
  texto: `${req.user.usuario} cargó la transferencia OP-${t.id} (${t.tipo}) por ${pesos(t.importe, t.moneda)} desde la cuenta ${t.cuenta_origen}`
    + ` a ${t.titular || t.destino}. Necesita ser autorizada por otro usuario.`,
});

export const textoLote = (req, lote, cantidad) => ({
  titulo: `Lote pendiente de autorización · Lote ${lote.id}`,
  texto: `${req.user.usuario} cargó el lote ${lote.id} (${lote.archivo}) con ${cantidad} transferencia(s) por ${pesos(lote.importe)}. Necesita ser autorizado por otro usuario.`,
});
