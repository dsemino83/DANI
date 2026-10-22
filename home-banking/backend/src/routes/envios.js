// Envíos programados de correo a las empresas y feriados. Solo el aprobador (perfil autorizante), y solo
// sobre las empresas que él ve (permiso Ver del administrador). Todo auditado.
import { auditar } from '../auditoria.js';
import { exigirRol } from '../auth.js';
import { operativa, tx } from '../db.js';
import { invalido, noEncontrado } from '../errores.js';
import { ejecutarProgramacion } from '../servicios/envios.js';
import { feriadosCargados, sincronizarFeriados } from '../servicios/feriados.js';
import { enArgentina, proximoTurno, validarProgramacion } from '../servicios/programacion.js';

const CONTENIDO = { saldos: 'saldos', movimientos: 'movimientos del día', saldos_movimientos: 'saldos y movimientos del día' };
const DIAS = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const describir = (p) => `${CONTENIDO[p.contenido]} · ${p.frecuencia === 'diaria' ? `diaria a las ${String(p.hora).slice(0, 5)}`
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
  app.get('/envios/empresas', async (req) => visibles(req.user.usuario));

  app.get('/envios', async () => {
    const esFeriado = await feriadosCargados();
    const { rows } = await operativa.query(`SELECT p.*, (SELECT max(en) FROM envio_mail_log l WHERE l.programacion_id = p.id) AS ultimo_envio FROM programacion_envio p ORDER BY p.nombre`);
    return rows.map((p) => ({ ...p, descripcion: describir(p), proximo: proximoTurno(p, new Date(), esFeriado) }));
  });

  const guardar = (id) => async (req, reply) => {
    const d = validarProgramacion(req.body ?? {});
    return tx(operativa, async (c) => {
      if (!d.todas) {
        const mias = new Set((await visibles(req.user.usuario)).map((e) => Number(e.id)));
        if (d.empresas.some((id) => !mias.has(id))) throw invalido('Solo podés elegir empresas que ves');
      }
      const v = [d.nombre, d.contenido, d.todas, d.empresas, d.frecuencia, d.hora, d.horaHasta, d.dias, d.saltarFeriados, d.fechaInicio, d.fechaFin, d.activa, req.user.usuario];
      const { rows } = id == null
        ? await c.query(`INSERT INTO programacion_envio (nombre, contenido, todas_empresas, empresas, frecuencia, hora, hora_hasta, dias_semana, saltar_feriados, fecha_inicio, fecha_fin, activa, creada_por)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`, v)
        : await c.query(`UPDATE programacion_envio SET nombre = $1, contenido = $2, todas_empresas = $3, empresas = $4, frecuencia = $5, hora = $6, hora_hasta = $7,
            dias_semana = $8, saltar_feriados = $9, fecha_inicio = $10, fecha_fin = $11, activa = $12, actualizada_por = $13, actualizada_en = now() WHERE id = $14 RETURNING *`, [...v, id(req)]);
      if (!rows[0]) throw noEncontrado('Programación inexistente');
      await auditar(c, req, { tipo: 'Administración', accion: id == null ? 'Creó envío programado' : 'Modificó envío programado', ref: { tipo: 'envio', id: rows[0].id },
        detalle: `${rows[0].nombre} · ${describir(rows[0])} · ${rows[0].todas_empresas ? 'todas las empresas' : `${rows[0].empresas.length} empresa(s)`}${rows[0].activa ? '' : ' · pausada'}` });
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

  // Ejecutar ahora (prueba): manda los correos ya, sin esperar el horario ni tocar los turnos programados
  app.post('/envios/:id/ejecutar', async (req) => {
    const p = (await operativa.query('SELECT * FROM programacion_envio WHERE id = $1', [req.params.id])).rows[0];
    if (!p) throw noEncontrado('Programación inexistente');
    const { fecha, hora } = enArgentina();
    const r = await ejecutarProgramacion(p, `${fecha}T${hora}`, { manual: true });
    await auditar(null, req, { tipo: 'Administración', accion: 'Ejecutó envío programado a mano', ref: { tipo: 'envio', id: p.id },
      detalle: `${p.nombre} · enviados ${r.enviados} · errores ${r.errores} · omitidos ${r.omitidos}` });
    return r;
  });

  app.get('/envios/:id/historial', async (req) => (await operativa.query(
    'SELECT * FROM envio_mail_log WHERE programacion_id = $1 ORDER BY en DESC LIMIT 200', [req.params.id])).rows);

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
