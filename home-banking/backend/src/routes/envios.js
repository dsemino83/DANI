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
export const describir = (p) => `${p.frecuencia === 'diaria' ? `Extracto diario (${CONTENIDO[p.contenido]}) a las ${String(p.hora).slice(0, 5)}`
  : `Alerta de movimientos de la última media hora, ${p.frecuencia === 'media_hora' ? 'cada 30 minutos' : 'cada hora'} de ${String(p.hora).slice(0, 5)} a ${String(p.hora_hasta).slice(0, 5)}`}${p.formato === 'cuerpo_excel' ? ' · cuerpo + Excel' : ' · en el cuerpo del correo'} · ${(p.dias_semana ?? []).map((d) => DIAS[d]).join(', ')}`
  + `${p.saltar_feriados ? ' · sin feriados' : ''} · desde ${String(p.fecha_inicio).slice(0, 10)}${p.fecha_fin ? ` hasta ${String(p.fecha_fin).slice(0, 10)}` : ''}`;

// Id transaccional de la ejecución de cada tarea
const EJ = `CASE WHEN c.ejecucion_id IS NULL THEN NULL ELSE CONCAT(N'EJ-', FORMAT(c.ejecucion_id, N'000000')) END`;

export default async function rutasEnvios(app) {
  app.addHook('preHandler', exigirRol('autorizante'));
  app.addHook('onError', async (req, reply, error) => {
    if (req.method === 'GET') return;
    await auditar(null, req, { tipo: 'Administración', accion: `Acción rechazada: ${req.method} ${req.routeOptions?.url ?? req.url}`, detalle: error.message, resultado: 'Error' }).catch(() => {});
  });

  // Empresas que el aprobador ve (las únicas que puede elegir como destino)
  const visibles = async (usuario) => (await operativa.query(
    `SELECT e.id, e.razon_social, e.cuit, e.emails, e.alertas_horarias FROM empresa e JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1 AND p.ver = 1
      WHERE e.activa = 1 ORDER BY e.razon_social`, [usuario])).rows;
  // Para elegir destino: cliente y después sus cuentas (las vinculadas activas; sin consultar al banco)
  app.get('/envios/empresas', async (req) => {
    const emp = await visibles(req.user.usuario);
    const ctas = (await operativa.query(`SELECT CAST(empresa_id AS varchar(30)) AS empresa_id, product_number, alias, moneda FROM empresa_cbu WHERE estado = N'activa' AND empresa_id IN (SELECT CAST(value AS bigint) FROM OPENJSON($1)) ORDER BY product_number`,
      [emp.map((e) => e.id)])).rows;
    return emp.map((e) => ({ ...e, cuentas: ctas.filter((c) => c.empresa_id === String(e.id)).map((c) => ({ cuenta: c.product_number, alias: c.alias, moneda: c.moneda })) }));
  });

  // Prende/apaga las alertas por hora de un cliente. Apagado: no recibe NINGUNA alerta por hora / cada 30
  // minutos (aunque un envío apunte a "todas las empresas"); el extracto diario le sigue llegando. Solo
  // sobre los clientes que el aprobador ve. Auditado.
  app.put('/envios/empresas/:id/alertas-horarias', async (req) => tx(operativa, async (c) => {
    const recibe = req.body?.alertasHorarias !== false;
    const mias = new Set((await visibles(req.user.usuario)).map((e) => Number(e.id)));
    if (!mias.has(Number(req.params.id))) throw invalido('Solo podés configurar clientes que ves');
    const { rows } = await c.query('UPDATE empresa SET alertas_horarias = $2 OUTPUT inserted.id, inserted.razon_social, inserted.alertas_horarias WHERE id = $1', [req.params.id, recibe]);
    if (!rows[0]) throw noEncontrado('Empresa inexistente');
    await auditar(c, req, { tipo: 'Administración', accion: recibe ? 'Activó alertas por hora de un cliente' : 'Desactivó alertas por hora de un cliente',
      ref: { tipo: 'empresa', id: rows[0].id }, detalle: `${rows[0].razon_social} · alertas por hora: ${recibe ? 'sí' : 'no'}` });
    return rows[0];
  }));

  app.get('/envios', async () => {
    const esFeriado = await feriadosCargados();
    const { rows } = await operativa.query(`SELECT p.*, (SELECT MAX(terminada_en) FROM cola_envio c WHERE c.programacion_id = p.id AND c.estado = N'enviado') AS ultimo_envio FROM programacion_envio p ORDER BY p.nombre`);
    return rows.map((p) => ({ ...p, descripcion: describir(p), proximo: proximoTurno(p, new Date(), esFeriado) }));
  });

  const guardar = (id) => async (req, reply) => {
    const d = validarProgramacion(req.body ?? {});
    return tx(operativa, async (c) => {
      if (!d.todas) { // cada cliente tiene que verlo el aprobador y cada cuenta tiene que ser de ese cliente
        const mias = new Set((await visibles(req.user.usuario)).map((e) => Number(e.id)));
        if (d.destinos.some((x) => !mias.has(x.empresaId))) throw invalido('Solo podés elegir clientes que ves');
        const activas = (await c.query(`SELECT CAST(empresa_id AS int) AS e, product_number FROM empresa_cbu WHERE estado = N'activa' AND empresa_id IN (SELECT CAST(value AS bigint) FROM OPENJSON($1))`, [d.destinos.map((x) => x.empresaId)])).rows;
        const ajenas = d.destinos.flatMap((x) => x.cuentas.filter((n) => !activas.some((a) => a.e === x.empresaId && a.product_number === n)));
        if (ajenas.length) throw invalido(`Cuentas que no son del cliente elegido: ${ajenas.join(', ')}`);
      }
      // Un cliente puede tener una sola programación activa por tipo: extracto diario, y alerta (cada hora o cada 30 minutos)
      if (d.activa) {
        const mias = await visibles(req.user.usuario);
        const propios = d.todas ? mias.map((e) => Number(e.id)) : d.destinos.map((x) => x.empresaId);
        const otras = (await c.query("SELECT * FROM programacion_envio WHERE activa = 1 AND (CASE WHEN frecuencia = N'diaria' THEN 1 ELSE 0 END) = (CASE WHEN $1 = N'diaria' THEN 1 ELSE 0 END) AND id <> $2", [d.frecuencia, id == null ? 0 : Number(id(req))])).rows;
        for (const o of otras) {
          const suyos = o.todas_empresas ? (await visibles(o.actualizada_por ?? o.creada_por)).map((e) => Number(e.id)) : (o.destinos ?? []).map((x) => Number(x.empresaId));
          const repetidos = propios.filter((x) => suyos.includes(x));
          if (repetidos.length) {
            const nombres = repetidos.map((x) => mias.find((e) => Number(e.id) === x)?.razon_social ?? `cliente ${x}`).join(', ');
            throw invalido(`${nombres} ya ${repetidos.length > 1 ? 'tienen' : 'tiene'} ${d.frecuencia === 'diaria' ? 'un extracto diario' : 'una alerta de movimientos'} en "${o.nombre}". Cada cliente puede tener un solo extracto diario y una sola alerta (cada hora o cada 30 minutos); pausá o editá la otra.`);
          }
        }
      }
      const v = [d.nombre, d.contenido, d.todas, d.destinos.map((x) => x.empresaId), d.frecuencia, d.hora, d.horaHasta, d.dias, d.saltarFeriados, d.fechaInicio, d.fechaFin, d.activa, req.user.usuario, JSON.stringify(d.destinos), d.formato];
      const { rows } = id == null
        ? await c.query(`INSERT INTO programacion_envio (nombre, contenido, todas_empresas, empresas, frecuencia, hora, hora_hasta, dias_semana, saltar_feriados, fecha_inicio, fecha_fin, activa, creada_por, destinos, formato)
            OUTPUT inserted.*
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, v)
        : await c.query(`UPDATE programacion_envio SET nombre = $1, contenido = $2, todas_empresas = $3, empresas = $4, frecuencia = $5, hora = $6, hora_hasta = $7,
            dias_semana = $8, saltar_feriados = $9, fecha_inicio = $10, fecha_fin = $11, activa = $12, actualizada_por = $13, destinos = $14, formato = $15, actualizada_en = SYSDATETIMEOFFSET() OUTPUT inserted.* WHERE id = $16`, [...v, id(req)]);
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
    const { rows } = await c.query('DELETE FROM programacion_envio OUTPUT deleted.* WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw noEncontrado('Programación inexistente');
    await auditar(c, req, { tipo: 'Administración', accion: 'Eliminó envío programado', ref: { tipo: 'envio', id: req.params.id }, detalle: `${rows[0].nombre} · ${describir(rows[0])}` });
    return { eliminada: true };
  }));

  // Ejecutar ahora (prueba): encola una tarea por cliente ya; el trabajador la procesa en segundos, en orden,
  // sin superponerse con los envíos programados. No toca los turnos programados.
  app.post('/envios/:id/ejecutar', async (req) => {
    const p = (await operativa.query('SELECT * FROM programacion_envio WHERE id = $1', [req.params.id])).rows[0];
    if (!p) throw noEncontrado('Programación inexistente');
    const r = await encolarTurno(p, `manual ${new Date().toISOString()}`, { manual: true });
    await auditar(null, req, { tipo: 'Administración', accion: 'Encoló envío programado a mano', ref: { tipo: 'envio', id: p.id }, detalle: `${p.nombre} · ${r.ejecucion} · ${r.encoladas} tarea(s)` });
    return r;
  });

  // Historial de una programación (las tareas de la cola, con su id de ejecución)
  app.get('/envios/:id/historial', async (req) => (await operativa.query(
    `SELECT TOP (200) c.*, ${EJ} AS ejecucion FROM cola_envio c WHERE programacion_id = $1 ORDER BY encolada_en DESC, id DESC`, [req.params.id])).rows);

  // Ejecuciones de una programación (id transaccional EJ-…): tareas, resultado y consultas reales al banco
  app.get('/envios/:id/ejecuciones', async (req) => (await operativa.query(
    `SELECT TOP (100) e.*, CONCAT(N'EJ-', FORMAT(e.id, N'000000')) AS codigo FROM ejecucion_envio e WHERE programacion_id = $1 ORDER BY creada_en DESC, id DESC`,
    [req.params.id])).rows);

  // Cola: lo pendiente y en proceso, más lo último terminado
  app.get('/envios/cola', async () => {
    const [abiertas, terminadas] = await Promise.all([
      operativa.query(`SELECT TOP (500) c.*, ${EJ} AS ejecucion FROM cola_envio c WHERE estado IN (N'pendiente', N'procesando') ORDER BY disponible_en, id`),
      operativa.query(`SELECT TOP (50) c.*, ${EJ} AS ejecucion FROM cola_envio c WHERE estado NOT IN (N'pendiente', N'procesando') ORDER BY terminada_en DESC`), // los NULL quedan al final
    ]);
    const rows = [...abiertas.rows, ...terminadas.rows];
    const resumen = (await operativa.query(`SELECT estado, COUNT(*) AS n FROM cola_envio WHERE encolada_en > DATEADD(hour, -24, SYSDATETIMEOFFSET()) GROUP BY estado`)).rows;
    const banco = (await operativa.query(`SELECT COALESCE(SUM(consultas_banco), 0) AS n FROM ejecucion_envio WHERE creada_en > DATEADD(hour, -24, SYSDATETIMEOFFSET())`)).rows[0].n;
    return { tareas: rows, ultimas24h: { ...Object.fromEntries(resumen.map((r) => [r.estado, r.n])), consultasBanco: banco } };
  });

  // Reintentar una tarea ya terminada (vuelve al final de la cola). Si estaba 'enviado' es un REENVÍO:
  // el cliente vuelve a recibir el correo (y, si es alerta, se vuelve a notificar por chat).
  const REINTENTABLES = ['error', 'enviado', 'omitido'];
  app.post('/envios/cola/:id/reintentar', async (req) => tx(operativa, async (c) => {
    const t = (await c.query('SELECT id, estado, programacion, empresa, turno, ejecucion_id FROM cola_envio WITH (UPDLOCK, ROWLOCK) WHERE id = $1', [req.params.id])).rows[0];
    if (!t) throw noEncontrado('Tarea inexistente');
    if (!REINTENTABLES.includes(t.estado)) throw invalido('La tarea todavía está en la cola: esperá a que termine');
    const reenvio = t.estado === 'enviado';
    await c.query(`UPDATE cola_envio SET estado = N'pendiente', intentos = 0, disponible_en = SYSDATETIMEOFFSET(), detalle = $2, terminada_en = NULL WHERE id = $1`,
      [t.id, reenvio ? 'Reenvío manual' : 'Reintento manual']);
    // La ejecución vuelve a quedar en curso hasta que la tarea termine
    if (t.ejecucion_id != null) await c.query(`UPDATE ejecucion_envio SET estado = N'en_curso', terminada_en = NULL WHERE id = $1`, [t.ejecucion_id]);
    await auditar(c, req, { tipo: 'Administración', accion: reenvio ? 'Reenvió una tarea ya enviada' : 'Reintentó envío de la cola',
      detalle: `${t.programacion} · ${t.empresa} · ${t.turno}${reenvio ? ' · el cliente vuelve a recibir el correo' : ''}` });
    return { reintentada: Number(t.id), reenvio };
  }));

  // ---------------- Feriados ----------------
  app.get('/feriados', async (req) => {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    return (await operativa.query(`SELECT CONVERT(varchar(10), fecha, 23) AS fecha, nombre, tipo, fuente FROM feriado WHERE YEAR(fecha) = $1 ORDER BY fecha`, [anio])).rows;
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
    await operativa.query(`SET XACT_ABORT ON; BEGIN TRANSACTION;
      UPDATE feriado WITH (UPDLOCK, SERIALIZABLE) SET nombre = $2, tipo = N'no laborable bancario', fuente = N'manual', actualizado_en = SYSDATETIMEOFFSET() WHERE fecha = $1;
      IF @@ROWCOUNT = 0 INSERT INTO feriado (fecha, nombre, tipo, fuente) VALUES ($1, $2, N'no laborable bancario', N'manual');
      COMMIT TRANSACTION;`, [fecha, nombre]);
    await auditar(null, req, { tipo: 'Administración', accion: 'Cargó feriado', detalle: `${fecha} · ${nombre}` });
    return { fecha, nombre };
  });

  app.delete('/feriados/:fecha', async (req) => {
    const r = await operativa.query(`DELETE FROM feriado OUTPUT deleted.nombre WHERE fecha = $1 AND fuente = N'manual'`, [req.params.fecha]);
    if (!r.rowCount) throw invalido('Solo se pueden borrar los feriados cargados a mano');
    await auditar(null, req, { tipo: 'Administración', accion: 'Borró feriado', detalle: `${req.params.fecha} · ${r.rows[0].nombre}` });
    return { borrado: req.params.fecha };
  });
}
