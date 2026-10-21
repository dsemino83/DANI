// Sincroniza el estado de las transferencias enviadas con getTransfersStatus y vincula
// cada débito informado por el banco con su transferencia (auditoría por operación).
import { pathToFileURL } from 'node:url';
import { operativa, tx } from '../db.js';
import { auditarSistema } from '../auditoria.js';
import { cuentasPropias, estadoTransferencias, movimientos } from '../bdv/cliente.js';
import { estadoDesdeBanco } from '../bdv/transferencias.js';

const iso = (d) => new Date(d).toISOString().slice(0, 10);

export async function sincronizarEstados(log = console) {
  const { rows: abiertas } = await operativa.query(
    `SELECT id, creado_en, tipo, api, estado, transaction_id, aprobado_en FROM transferencia
      WHERE estado IN ('ENVIADA', 'PEND_AUTORIZACION') AND creado_en >= now() - interval '3 months'`);
  const sinId = abiertas.filter((t) => !t.transaction_id);
  if (sinId.length) log.warn?.(`${sinId.length} transferencias ENVIADA sin transactionId: requieren conciliación manual con el banco`);
  const conId = abiertas.filter((t) => t.transaction_id);
  if (!conId.length) return { revisadas: 0, cambios: 0 };

  const desde = iso(Math.min(...conId.map((t) => +new Date(t.aprobado_en ?? t.creado_en))));
  const banco = await estadoTransferencias(desde, iso(Date.now()));
  // A confirmar con el banco qué campo coincide con el transactionId devuelto al enviar: se prueba code e idTrn.
  const porId = new Map();
  for (const b of banco) for (const k of [b.code, b.idTrn]) if (k != null) porId.set(String(k), b);

  let cambios = 0;
  for (const t of conId) {
    const b = porId.get(String(t.transaction_id));
    const nuevo = b && estadoDesdeBanco(b);
    if (!nuevo || nuevo === t.estado) continue;
    await tx(operativa, async (c) => {
      const u = await c.query('UPDATE transferencia SET estado = $2, actualizado_en = now() WHERE id = $1 AND estado = $3', [t.id, nuevo, t.estado]);
      if (u.rowCount !== 1) return; // cambió mientras tanto: se revisa en la próxima corrida
      await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
        [t.id, nuevo, 'Banco de Valores', `getTransfersStatus: status ${b.status}${b.executionMessage ? ` · ${b.executionMessage}` : ''}`]);
      await auditarSistema(c, { tipo: 'Transferencias', accion: 'Cambio de estado en el banco', api: 'getTransfersStatus',
        detalle: `OP-${t.id} · ${t.estado} → ${nuevo}`, ref: { tipo: 'transferencia', id: t.id } });
    });
    cambios++;
  }
  return { revisadas: conId.length, cambios };
}

// Transferencias que quedaron en ENVIANDO (el proceso se cortó entre la aprobación y la
// respuesta del banco). NUNCA se reenvían: si hay fila en envio_banco el pedido pudo
// haber salido -> ENVIADA (incierta, a conciliar); si no la hay, nunca se llamó al
// banco -> ERROR_API (no ejecutada). La fila se bloquea antes de mirar envio_banco para
// no cruzarse con un envío en curso.
export async function recuperarEnviando(minutos = 10) {
  const { rows } = await operativa.query(
    `SELECT id FROM transferencia WHERE estado = 'ENVIANDO' AND aprobado_en < now() - make_interval(mins => $1)`, [minutos]);
  let n = 0;
  for (const { id } of rows) {
    await tx(operativa, async (c) => {
      const t = (await c.query('SELECT id, estado FROM transferencia WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (t?.estado !== 'ENVIANDO') return;
      const salio = (await c.query('SELECT 1 FROM envio_banco WHERE transferencia_id = $1', [id])).rowCount === 1;
      const nuevo = salio ? 'ENVIADA' : 'ERROR_API';
      const detalle = salio
        ? 'Sin respuesta registrada del banco: resultado incierto, conciliar con getTransfersStatus. No se reenvía.'
        : 'Aprobada pero nunca se llamó al banco: no se ejecutó. No se reenvía; si corresponde, cargar una nueva.';
      await c.query('UPDATE transferencia SET estado = $2, actualizado_en = now() WHERE id = $1 AND estado = \'ENVIANDO\'', [id, nuevo]);
      await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)', [id, nuevo, 'Sistema', detalle]);
      await auditarSistema(c, { tipo: 'Transferencias', accion: 'Recuperó transferencia interrumpida', detalle: `OP-${id} · ENVIANDO → ${nuevo}`, ref: { tipo: 'transferencia', id } });
      n++;
    });
  }
  return n;
}

// Vincula débitos con transferencias DEBITADA sin vínculo (misma cuenta, fecha e importe).
export async function conciliarDebitos() {
  const { rows } = await operativa.query(
    `SELECT t.id, t.cuenta_origen, t.importe, t.aprobado_en FROM transferencia t
      LEFT JOIN debito_transferencia d ON d.transferencia_id = t.id
     WHERE t.estado = 'DEBITADA' AND d.transferencia_id IS NULL AND t.creado_en >= now() - interval '7 days'`);
  if (!rows.length) return 0;
  const cuentas = new Map((await cuentasPropias()).map((c) => [String(c.productNumber), c]));
  const usados = new Set((await operativa.query('SELECT movimiento_id FROM debito_transferencia')).rows.map((r) => r.movimiento_id));
  let n = 0;
  for (const t of rows) {
    const c = cuentas.get(t.cuenta_origen);
    if (!c) continue;
    const dia = iso(t.aprobado_en);
    const { movimientos: ms } = await movimientos(c, dia, iso(Date.now()));
    const m = ms.find((x) => x.signDC === 'D' && Number(x.amount) === Number(t.importe) && !usados.has(String(x.transactionId)));
    if (!m) continue;
    usados.add(String(m.transactionId));
    await operativa.query('INSERT INTO debito_transferencia (movimiento_id, cuenta, transferencia_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [String(m.transactionId), t.cuenta_origen, t.id]);
    n++;
  }
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await sincronizarEstados();
  console.log('Estados:', r, 'Débitos vinculados:', await conciliarDebitos());
  await operativa.end();
}
