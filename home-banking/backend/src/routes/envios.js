// Envíos programados de correo a las empresas y feriados. Solo el aprobador (perfil autorizante), y solo
// sobre las empresas que él ve (permiso Ver del administrador). Todo auditado.
import { auditar } from '../auditoria.js';
import { exigirRol } from '../auth.js';
import { operativa, tx } from '../db.js';
import { invalido, noEncontrado } from '../errores.js';
import { encolarTurno } from '../servicios/envios.js';
import { feriadosCargados, sincronizarFeriados } from '../servicios/feriados.js';
import { enArgentina, proximoTurno, validarProgramacion } from '../servicios/programacion.js';

const CONTENIDO = { saldos: 'saldos', movimientos: 'movimientos del día', saldos_movimientos: 'saldos y movimientos del día' };
const DIAS = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const destinoTxt = (p) => (p.todas_empresas ? 'todos sus clientes' : `${(p.destinos ?? []).length} cliente(s)${(p.destinos ?? []).some((d) => d.cuentas?.length) ? ' (con cuentas elegidas)' : ''}`);
export const describir = (p) => `${CONTENIDO[p.contenido]}${p.formato === 'cuerpo_excel' ? ' con Excel adjunto' : ' en el cuerpo del correo'} · ${p.frecuencia === 'diaria' ? `diaria a las ${String(p.hora).slice(0, 5)}`
  : `cada hora de ${String(p.hora).slice(0, 5)} a ${String(p.hora_hasta).slice(0, 5)}`} · ${(p.dias_semana ?? []).map((d) => DIAS[d]).join(', ')}`
  + `${p.saltar_feriados ? ' · sin feriados' : ''} · desde ${String(p.fecha_inicio).slice(0, 10)}${p.fecha_fin ? ` hasta ${String(p.fecha_fin).slice(0, 10)}` : ''}`;

export default async function rutasEnvios(app) {
  app.addHook('preHandler', exigirRol('autorizante'));
  app.addHook('onError', async (req, reply, error) => {
    if (req.method === 'GET') return;
    await auditar(null, req, { tipo: 'Administración', accion: `Acción rechazada: ${req.method} ${req.routeOptions?.url ?? req.url}`, detalle: error.message, resultado: 'Error' }).catch(() => {});
  });

  // Empresas que el aprobador ve (las únicas que puede elegir como destino)
  const visibles = async (usuario) => (await operativa.query(
    `SELECT e.id, e.razon_social, e.cuit, e.emails FROM empresa e JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1 AND p.ver
      WHERE e.activa ORDER BY e.razon_social`, [usuario])).rows;
  // Para elegir destino: cliente y después sus cuentas (las vinculadas activas; sin consultar al banco)
  app.get('/envios/empresas', async (req) => {
    const emp = await visibles(req.user.usuario);
    const ctas = (await operativa.query(`SELECT empresa_id::text, product_number, alias, moneda FROM empresa_cbu WHERE estado = 'activa' AND empresa_id = ANY($1) ORDER BY product_number`,
      [emp.map((e) => e.id)])).rows;
    return emp.map((e) => ({ ...e, cuentas: ctas.filter((c) => c.empresa_id === String(e.id)).map((c) => ({ cuenta: c.product_number, alias: c.alias, moneda: c.moneda })) }));
  });

  app.get('/envios', async () => {
    const esFeriado = await feriadosCargados();
    const { rows } = await operativa.query(`SELECT p.*, (SELECT max(terminada_en) FROM cola_envio c WHERE c.programacion_id = p.id AND c.estado = 'enviado') AS ultimo_envio FROM programacion_envio p ORDER BY p.nombre`);
    return rows.map((p) => ({ ...p, descripcion: describir(p), proximo: proximoTurno(p, new Date(), esFeriado) }));
  });

  const guardar = (id) => async (req, reply) => {
    const d = validarProgramacion(req.body ?? {});
    return tx(operativa, async (c) => {
      if (!d.todas) { // cada cliente tiene que verlo el aprobador y cada cuenta tiene que ser de ese cliente
        const mias = new Set((await visibles(req.user.usuario)).map((e) => Number(e.id)));
        if (d.destinos.some((x) => !mias.has(x.empresaId))) throw invalido('Solo podés elegir clientes que ves');
        const activas = (await c.query(`SELECT empresa_id::int AS e, product_number FROM empresa_cbu WHERE estado = 'activa' AND empresa_id = ANY($1)`, [d.destinos.map((x) => x.empresaId)])).rows;
        const ajenas = d.destinos.flatMap((x) => x.cuentas.filter((n) => !activas.some((a) => a.e === x.empresaId && a.product_number === n)));
        if (ajenas.length) throw invalido(`Cuentas que no son del cliente elegido: ${ajenas.join(', ')}`);
      }
      const v = [d.nombre, d.contenido, d.todas, d.destinos.map((x) => x.empresaId), d.frecuencia, d.hora, d.horaHasta, d.dias, d.saltarFeriados, d.fechaInicio, d.fechaFin, d.activa, req.user.usuario, JSON.stringify(d.destinos), d.formato];
      const { rows } = id == null
        ? await c.query(`INSERT INTO programacion_envio (nombre, contenido, todas_empresas, empresas, frecuencia, hora, hora_hasta, dias_semana, saltar_feriados, fecha_inicio, fecha_fin, activa, creada_por, destinos, formato)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`, v)
        : await c.query(`UPDATE programacion_envio SET nombre = $1, contenido = $2, todas_empresas = $3, empresas = $4, frecuencia = $5, hora = $6, hora_hasta = $7,
            dias_semana = $8, saltar_feriados = $9, fecha_inicio = $10, fecha_fin = $11, activa = $12, actualizada_por = $13, destinos = $14, formato = $15, actualizada_en = now() WHERE id = $16 RETURNING *`, [...v, id(req)]);
      if (!rows[0]) throw noEncontrado('Programación inexistente');
      await auditar(c, req, { tipo: 'Administración', accion: id == null ? 'Creó envío programado' : 'Modificó envío programado', ref: { tipo: 'envio', id: rows[0].id },
        detalle: `${rows[0].nombre} · ${describir(rows[0])} · ${destinoTxt(rows[0])}${rows[0].activa ? '' : ' · pausada'}` });
      if (id == null) reply.code(201);
      return rows[0];
    });
  };
  app.post('/envios', guardar(null));
  app.put('/envios/:id', guardar((req) => req.params.id));

  app.delete('/envios/:id', async (req) => tx(operativa, async (c) => {
    const { rows } = await c.query('DELETE FROM programacion_envio WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) throw noEncontrado('Programación inexistente');
    await auditar(c, req, { tipo: 'Administración', accion: 'Eliminó envío programado', ref: { tipo: 'envio', id: req.params.id }, detalle: `${rows[0].nombre} · ${describir(rows[0])}` });
    return { eliminada: true };
  }));

  // Ejecutar ahora (prueba): encola una tarea por cliente ya; el trabajador la procesa en segundos, en orden,
  // sin superponerse con los envíos programados. No toca los turnos programados.
  app.post('/envios/:id/ejecutar', async (req) => {
    const p = (await operativa.query('SELECT * FROM programacion_envio WHERE id = $1', [req.params.id])).rows[0];
    if (!p) throw noEncontrado('Programación inexistente');
    const encoladas = await encolarTurno(p, `manual ${new Date().toISOString()}`, { manual: true });
    await auditar(null, req, { tipo: 'Administración', accion: 'Encoló envío programado a mano', ref: { tipo: 'envio', id: p.id }, detalle: `${p.nombre} · ${encoladas} tarea(s)` });
    return { encoladas };
  });

  // Historial de una programación (las tareas de la cola)
  app.get('/envios/:id/historial', async (req) => (await operativa.query(
    'SELECT * FROM cola_envio WHERE programacion_id = $1 ORDER BY encolada_en DESC, id DESC LIMIT 200', [req.params.id])).rows);

  // Cola: lo pendiente y en proceso, más lo último terminado
  app.get('/envios/cola', async () => {
    const { rows } = await operativa.query(`(SELECT * FROM cola_envio WHERE estado IN ('pendiente', 'procesando') ORDER BY disponible_en, id LIMIT 500)
      UNION ALL (SELECT * FROM cola_envio WHERE estado NOT IN ('pendiente', 'procesando') ORDER BY terminada_en DESC NULLS LAST LIMIT 50)`);
    const resumen = (await operativa.query(`SELECT estado, count(*)::int AS n FROM cola_envio WHERE encolada_en > now() - interval '24 hours' GROUP BY estado`)).rows;
    return { tareas: rows, ultimas24h: Object.fromEntries(resumen.map((r) => [r.estado, r.n])) };
  });

  // Reintentar una tarea que terminó con error (vuelve al final de la cola)
  app.post('/envios/cola/:id/reintentar', async (req) => {
    const r = await operativa.query(`UPDATE cola_envio SET estado = 'pendiente', intentos = 0, disponible_en = now(), detalle = 'Reintento manual', terminada_en = NULL
      WHERE id = $1 AND estado = 'error' RETURNING programacion, empresa, turno`, [req.params.id]);
    if (!r.rowCount) throw invalido('Solo se reintentan tareas con error');
    await auditar(null, req, { tipo: 'Administración', accion: 'Reintentó envío de la cola', detalle: `${r.rows[0].programacion} · ${r.rows[0].empresa} · ${r.rows[0].turno}` });
    return { reintentada: Number(req.params.id) };
  });

  // ---------------- Feriados ----------------
  app.get('/feriados', async (req) => {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    return (await operativa.query(`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, tipo, fuente FROM feriado WHERE extract(year FROM fecha) = $1 ORDER BY fecha`, [anio])).rows;
  });

  app.post('/feriados/sincronizar', async (req) => {
    const anio = Number(req.body?.anio) || new Date().getFullYear();
    const r = await sincronizarFeriados(anio);
    await auditar(null, req, { tipo: 'Administración', accion: 'Sincronizó feriados', detalle: `${anio} · ${r.feriados} feriados de ${r.fuente}` });
    return r;
  });

  app.post('/feriados', async (req) => {
    const fecha = String(req.body?.fecha ?? ''), nombre = String(req.body?.nombre ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !nombre) throw invalido('Indicá fecha (AAAA-MM-DD) y nombre');
    await operativa.query(`INSERT INTO feriado (fecha, nombre, tipo, fuente) VALUES ($1, $2, 'no laborable bancario', 'manual')
      ON CONFLICT (fecha) DO UPDATE SET nombre = $2, tipo = 'no laborable bancario', fuente = 'manual', actualizado_en = now()`, [fecha, nombre]);
    await auditar(null, req, { tipo: 'Administración', accion: 'Cargó feriado', detalle: `${fecha} · ${nombre}` });
    return { fecha, nombre };
  });

  app.delete('/feriados/:fecha', async (req) => {
    const r = await operativa.query(`DELETE FROM feriado WHERE fecha = $1 AND fuente = 'manual' RETURNING nombre`, [req.params.fecha]);
    if (!r.rowCount) throw invalido('Solo se pueden borrar los feriados cargados a mano');
    await auditar(null, req, { tipo: 'Administración', accion: 'Borró feriado', detalle: `${req.params.fecha} · ${r.rows[0].nombre}` });
    return { borrado: req.params.fecha };
  });
}
