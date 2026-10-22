// Verificación de la cadena de hashes de la auditoría: recalcula el SHA-256 de cada registro (en la base, con la
// misma función que lo generó) y controla que cada uno apunte al anterior, sin huecos, y que el último coincida con
// la cabeza de la cadena. Detecta registros modificados, borrados (en el medio o al final) o intercalados.
import { historica, operativa } from '../db.js';

const LOTE = 5000, MAX_PROBLEMAS = 50;
const RECALCULO = `encode(sha256(convert_to(hb_auditoria_canonico(orden, id, en, usuario, rol, tipo, accion, api, detalle, resultado,
  ip, ref_tipo, ref_id, hash_anterior), 'UTF8')), 'hex')`;

export async function verificarAuditoria() {
  const cab = (await operativa.query('SELECT ultimo_orden::text, ultimo_hash FROM auditoria_cadena WHERE id = 1')).rows[0];
  const problemas = [];
  const anotar = (orden, problema) => { if (problemas.length < MAX_PROBLEMAS) problemas.push({ orden: Number(orden), problema }); };
  let previo = null, primero = null, filas = 0;
  for (let desde = 0; ;) {
    const { rows } = await operativa.query(
      `SELECT orden::text, id::text, hash, hash_anterior, ${RECALCULO} AS recalculado FROM auditoria a WHERE a.orden > $1 ORDER BY a.orden LIMIT ${LOTE}`, [desde]);
    if (!rows.length) break;
    for (const r of rows) {
      filas++;
      primero ??= r;
      if (r.recalculado !== r.hash) anotar(r.orden, `Registro ${r.id}: el contenido no coincide con su hash (fue modificado)`);
      if (previo) {
        if (BigInt(r.orden) !== BigInt(previo.orden) + 1n) anotar(r.orden, `Faltan registros entre el orden ${previo.orden} y el ${r.orden} (fueron borrados)`);
        else if (r.hash_anterior !== previo.hash) anotar(r.orden, `Registro ${r.id}: no apunta al registro anterior (cadena rota)`);
      }
      previo = r;
    }
    desde = rows.at(-1).orden;
  }
  if (previo && (previo.orden !== cab.ultimo_orden || previo.hash !== cab.ultimo_hash)) {
    anotar(previo.orden, `El último registro (orden ${previo.orden}) no es la cabeza de la cadena (orden ${cab.ultimo_orden}): se borraron los registros finales`);
  }
  if (!previo && cab.ultimo_orden !== '0') anotar(cab.ultimo_orden, 'La cadena tiene registros pero la base operativa no tiene ninguno');
  // Empalme con la base histórica: el primer registro de la operativa tiene que apuntar al último que pasó a la histórica
  let empalme = null;
  if (primero && primero.orden !== '1') {
    try {
      const h = (await historica.query('SELECT hash FROM auditoria WHERE orden = $1', [String(BigInt(primero.orden) - 1n)])).rows[0];
      empalme = h ? h.hash === primero.hash_anterior : null;
      if (h && !empalme) anotar(primero.orden, 'El primer registro de la operativa no continúa la cadena de la base histórica');
    } catch { empalme = null; /* histórica sin la columna todavía (antes del primer pase con cadena) */ }
  }
  return { ok: problemas.length === 0, filas, desdeOrden: primero ? Number(primero.orden) : null, hastaOrden: previo ? Number(previo.orden) : null,
    cabeza: cab.ultimo_hash, empalmeHistorica: empalme, problemas, verificadoEn: new Date().toISOString() };
}
