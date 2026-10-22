// Auditoría general: solo lectura para auditor y administrador de seguridad.
// Base operativa (desde el corte) e histórica se consultan por separado.
import { exigirRol } from '../auth.js';
import { auditar } from '../auditoria.js';
import { fechaCorte, historica, operativa } from '../db.js';
import { invalido } from '../errores.js';
import { verificarAuditoria } from '../servicios/integridad.js';

const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f ?? '');

async function consultar(pool, req, { desde, hasta }) {
  const pagina = Math.max(0, Number(req.query.pagina ?? 0)), tam = 1000;
  const { rows } = await pool.query(
    `SELECT id, en, usuario, rol, tipo, accion, api, detalle, resultado
       FROM auditoria
      WHERE en >= $1::date AND en < $2::date + 1
        AND ($3::text IS NULL OR usuario = $3) AND ($4::text IS NULL OR tipo = $4)
        AND ($5::text IS NULL OR (accion || ' ' || coalesce(detalle, '') || ' ' || coalesce(api, '')) ILIKE '%' || $5 || '%')
      ORDER BY en DESC, id DESC OFFSET $6 LIMIT $7`,
    [desde, hasta, req.query.usuario ?? null, req.query.tipo ?? null, req.query.q ?? null, pagina * tam, tam + 1]);
  return { pagina, hayMas: rows.length > tam, registros: rows.slice(0, tam) };
}

export default async function rutasAuditoria(app) {
  app.addHook('preHandler', exigirRol('auditor', 'administrador'));

  app.get('/auditoria', async (req) => {
    const corte = await fechaCorte('auditoria');
    const desde = req.query.desde ?? corte, hasta = req.query.hasta ?? new Date().toISOString().slice(0, 10);
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Rango de fechas inválido');
    if (desde < corte) throw invalido(`La base operativa guarda desde el ${corte}. Para fechas anteriores usá /historico/auditoria`);
    return { base: 'operativa', desde, hasta, ...(await consultar(operativa, req, { desde, hasta })) };
  });

  // Integridad: verifica la cadena de hashes de la auditoría (registros modificados, borrados o intercalados)
  app.get('/auditoria/integridad', async (req) => {
    const r = await verificarAuditoria();
    await auditar(null, req, { tipo: 'Consultas', accion: 'Verificó la integridad de la auditoría', resultado: r.ok ? 'OK' : 'Error',
      detalle: `${r.filas} registros (orden ${r.desdeOrden ?? '—'} a ${r.hastaOrden ?? '—'}) · ${r.ok ? 'cadena íntegra' : `${r.problemas.length} problema(s)`}` });
    return r;
  });

  app.get('/historico/auditoria', async (req) => {
    const corte = await fechaCorte('auditoria');
    const { desde, hasta } = req.query;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Indicá desde y hasta (AAAA-MM-DD)');
    if (hasta >= corte) throw invalido(`La base histórica tiene lo anterior al ${corte}`);
    const r = await consultar(historica, req, { desde, hasta });
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó base histórica de auditoría', detalle: `${desde} a ${hasta}` });
    return { base: 'historica', desde, hasta, ...r };
  });
}
