// Auditoría general: solo lectura para auditor y administrador de seguridad.
// Base operativa (últimos 3 meses) e histórica se consultan por separado.
import { exigirRol } from '../auth.js';
import { auditar } from '../auditoria.js';
import { fechaCorte, historica, operativa } from '../db.js';
import { invalido } from '../errores.js';

const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f ?? '');

async function consultar(pool, req, { desde, hasta }) {
  const tam = Math.min(1000, Math.max(1, Number(req.query.tam ?? 1000)));
  const cursorEn = req.query.cursor_en ?? null;
  const cursorId = req.query.cursor_id ? Number(req.query.cursor_id) : null;
  if ((cursorEn && !Number.isFinite(cursorId)) || (!cursorEn && cursorId !== null)) {
    throw invalido('El cursor requiere cursor_en y cursor_id');
  }
  const { rows } = await pool.query(
    `SELECT id, en, usuario, rol, tipo, accion, api, detalle, resultado
       FROM auditoria
      WHERE en >= $1::date AND en < $2::date + 1
        AND ($3::text IS NULL OR usuario = $3) AND ($4::text IS NULL OR tipo = $4)
        AND ($5::text IS NULL OR (accion || ' ' || coalesce(detalle, '') || ' ' || coalesce(api, '')) ILIKE '%' || $5 || '%')
        AND ($6::timestamptz IS NULL OR (en, id) < ($6::timestamptz, $7::bigint))
      ORDER BY en DESC, id DESC
      LIMIT $8`,
    [desde, hasta, req.query.usuario ?? null, req.query.tipo ?? null, req.query.q ?? null, cursorEn, cursorId, tam + 1]);
  const paginaRows = rows.slice(0, tam);
  const ultimo = paginaRows.at(-1);
  const siguienteCursor = rows.length > tam && ultimo
    ? { cursor_en: ultimo.en, cursor_id: ultimo.id }
    : null;
  return { hayMas: rows.length > tam, siguienteCursor, registros: paginaRows };
}

export default async function rutasAuditoria(app) {
  app.addHook('preHandler', exigirRol('auditor', 'administrador'));

  app.get('/auditoria', async (req) => {
    const corte = fechaCorte();
    const desde = req.query.desde ?? corte, hasta = req.query.hasta ?? new Date().toISOString().slice(0, 10);
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Rango de fechas inválido');
    if (desde < corte) throw invalido(`La base operativa guarda desde el ${corte}. Para fechas anteriores usá /historico/auditoria`);
    return { base: 'operativa', desde, hasta, ...(await consultar(operativa, req, { desde, hasta })) };
  });

  app.get('/historico/auditoria', async (req) => {
    const corte = fechaCorte();
    const { desde, hasta } = req.query;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Indicá desde y hasta (AAAA-MM-DD)');
    if (hasta >= corte) throw invalido(`La base histórica tiene lo anterior al ${corte}`);
    const r = await consultar(historica, req, { desde, hasta });
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó base histórica de auditoría', detalle: `${desde} a ${hasta}` });
    return { base: 'historica', desde, hasta, ...r };
  });
}
