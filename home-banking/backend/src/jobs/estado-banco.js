// Sincroniza el estado de las transferencias enviadas con getTransfersStatus y vincula
// cada débito informado por el banco con su transferencia (auditoría por operación).
import { pathToFileURL } from 'node:url';
import { operativa, tx } from '../db.js';
import { auditarSistema } from '../auditoria.js';
import { cuentasPropias, estadoTransferencias, movimientos } from '../bdv/cliente.js';
import { estadoDesdeBanco } from '../bdv/transferencias.js';
import { instante, segundosDeHora } from '../servicios/programacion.js';

const iso = (d) => new Date(d).toISOString().slice(0, 10);

export async function sincronizarEstados(log = console) {
  const { rows: abiertas } = await operativa.query(
    `SELECT id, creado_en, tipo, api, estado, transaction_id, aprobado_en FROM transferencia
      WHERE estado IN (N'ENVIADA', N'PEND_AUTORIZACION') AND creado_en >= DATEADD(month, -3, SYSDATETIMEOFFSET())`);
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
      const u = await c.query('UPDATE transferencia SET estado = $2, actualizado_en = SYSDATETIMEOFFSET() WHERE id = $1 AND estado = $3', [t.id, nuevo, t.estado]);
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
    `SELECT id FROM transferencia WHERE estado = N'ENVIANDO' AND aprobado_en < DATEADD(minute, -$1, SYSDATETIMEOFFSET())`, [minutos]);
  let n = 0;
  for (const { id } of rows) {
    await tx(operativa, async (c) => {
      const t = (await c.query('SELECT id, estado FROM transferencia WITH (UPDLOCK, ROWLOCK) WHERE id = $1', [id])).rows[0];
      if (t?.estado !== 'ENVIANDO') return;
      const salio = (await c.query('SELECT 1 FROM envio_banco WHERE transferencia_id = $1', [id])).rowCount === 1;
      const nuevo = salio ? 'ENVIADA' : 'ERROR_API';
      const detalle = salio
        ? 'Sin respuesta registrada del banco: resultado incierto, conciliar con getTransfersStatus. No se reenvía.'
        : 'Aprobada pero nunca se llamó al banco: no se ejecutó. No se reenvía; si corresponde, cargar una nueva.';
      await c.query("UPDATE transferencia SET estado = $2, actualizado_en = SYSDATETIMEOFFSET() WHERE id = $1 AND estado = N'ENVIANDO'", [id, nuevo]);
      await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)', [id, nuevo, 'Sistema', detalle]);
      await auditarSistema(c, { tipo: 'Transferencias', accion: 'Recuperó transferencia interrumpida', detalle: `OP-${id} · ENVIANDO → ${nuevo}`, ref: { tipo: 'transferencia', id } });
      n++;
    });
  }
  return n;
}

// Conciliación débito ↔ transferencia. Nunca adivina: un débito se asocia a una transferencia solo si la
// coincidencia es ÚNICA. Prioridad: 1) ID / referencia / nro. de control (coincidencia fuerte); 2) cuenta +
// importe + fecha + hora (coincidencia débil). Si hay más de un candidato equivalente (o más de una
// transferencia equivalente compitiendo por el mismo débito) => CONCILIACION_AMBIGUA y NO se asigna nada.
export const CONCILIACION_AMBIGUA = 'CONCILIACION_AMBIGUA';

const idsDeTransferencia = (t) => [t.transaction_id, t.nro_control, t.referencia].filter((x) => x != null && x !== '').map(String);
const idsDeMovimiento = (m) => [m.transactionId, m.reference, m.referencia, m.nroControl, m.controlNumber].filter((x) => x != null && x !== '').map(String);

// Instante del movimiento (processDate ISO o dd/mm/aaaa + hora del banco); null si no se entiende.
function instanteDe(m) {
  const f = String(m.processDate ?? '');
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(f)?.[1] ?? (/^(\d{2})\/(\d{2})\/(\d{4})/.exec(f) ? f.replace(/^(\d{2})\/(\d{2})\/(\d{4}).*/, '$3-$2-$1') : null);
  const seg = segundosDeHora(m.hour);
  if (!iso || seg == null) return null;
  return instante(iso, '00:00').getTime() + seg * 1000;
}

// Decide el movimiento de una transferencia. `usados`: movimientos ya vinculados; `competidoras`: otras
// transferencias pendientes de vincular con la misma cuenta e importe. Devuelve { movimiento } o { ambigua } o {}.
export function elegirMovimiento(t, movimientos, usados = new Set(), competidoras = 0) {
  const libres = movimientos.filter((m) => m.signDC === 'D' && !usados.has(String(m.transactionId)));
  // 1) Coincidencia fuerte por ID / referencia / control
  const mis = new Set(idsDeTransferencia(t));
  const fuertes = libres.filter((m) => idsDeMovimiento(m).some((id) => mis.has(id)));
  if (fuertes.length === 1) return { movimiento: fuertes[0], por: 'id' };
  if (fuertes.length > 1) return { ambigua: true, candidatos: fuertes.length };
  // 2) Cuenta (ya filtrada por la consulta) + importe + fecha/hora
  const desde = t.aprobado_en ? +new Date(t.aprobado_en) - 5 * 60_000 : null;
  const debiles = libres.filter((m) => Number(m.amount) === Number(t.importe) && (desde == null || (instanteDe(m) ?? Infinity) >= desde));
  if (!debiles.length) return {};
  if (debiles.length === 1 && competidoras === 0) return { movimiento: debiles[0], por: 'importe' };
  return { ambigua: true, candidatos: debiles.length, competidoras };
}

export async function conciliarDebitos() {
  const { rows } = await operativa.query(
    `SELECT t.id, t.cuenta_origen, t.importe, t.aprobado_en, t.transaction_id, t.nro_control, t.referencia FROM transferencia t
      LEFT JOIN debito_transferencia d ON d.transferencia_id = t.id
     WHERE t.estado = N'DEBITADA' AND d.transferencia_id IS NULL AND t.creado_en >= DATEADD(day, -7, SYSDATETIMEOFFSET())`);
  if (!rows.length) return 0;
  const cuentas = new Map((await cuentasPropias()).map((c) => [String(c.productNumber), c]));
  const usados = new Set((await operativa.query('SELECT movimiento_id FROM debito_transferencia')).rows.map((r) => r.movimiento_id));
  let n = 0;
  for (const t of rows) {
    const c = cuentas.get(t.cuenta_origen);
    if (!c) continue;
    const dia = iso(t.aprobado_en);
    const { movimientos: ms } = await movimientos(c, dia, iso(Date.now()));
    const competidoras = rows.filter((o) => o.id !== t.id && o.cuenta_origen === t.cuenta_origen && Number(o.importe) === Number(t.importe)).length;
    const r = elegirMovimiento(t, ms, usados, competidoras);
    if (r.ambigua) { await avisarAmbigua(t, r); continue; }   // sin asignación: lo resuelve una persona
    if (!r.movimiento) continue;
    const m = r.movimiento;
    usados.add(String(m.transactionId));
    await operativa.query(`INSERT INTO debito_transferencia (movimiento_id, cuenta, transferencia_id)
                            SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM debito_transferencia WITH (UPDLOCK, HOLDLOCK) WHERE movimiento_id = $1)`,
      [String(m.transactionId), t.cuenta_origen, t.id]);
    n++;
  }
  return n;
}

// Deja constancia (una sola vez por operación) de que no se pudo vincular sin ambigüedad. No toca el estado.
async function avisarAmbigua(t, r) {
  const ya = await operativa.query(`SELECT TOP (1) 1 AS ya FROM auditoria WHERE ref_tipo = N'transferencia' AND ref_id = $1 AND accion = $2`, [t.id, CONCILIACION_AMBIGUA]);
  if (ya.rowCount) return;
  await tx(operativa, (c) => auditarSistema(c, { tipo: 'Transferencias', accion: CONCILIACION_AMBIGUA, api: 'getMovementsDetail', resultado: 'Error',
    detalle: `OP-${t.id} · ${r.candidatos} débito(s) equivalente(s) y ${r.competidoras ?? 0} operación(es) equivalente(s): no se vincula automáticamente, conciliar a mano`,
    ref: { tipo: 'transferencia', id: t.id } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await sincronizarEstados();
  console.log('Estados:', r, 'Débitos vinculados:', await conciliarDebitos());
  await operativa.end();
}
