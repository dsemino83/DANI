// Panel de estado y mantenimiento (solo administrador de seguridad). Muestra el estado de cada parte del
// sistema y permite "reiniciar" subsistemas de forma segura, SIN tocar los contenedores ni el socket de
// Docker (eso rompería el aislamiento): reconectar con el banco, reprocesar la cola de envíos, refrescar
// feriados y re-verificar la integridad de la auditoría. Cada acción queda auditada.
import { exigirRol } from '../auth.js';
import { auditar } from '../auditoria.js';
import { operativa, historica } from '../db.js';
import { config } from '../config.js';
import { bdv, bdvEnvios } from '../bdv/cliente.js';
import { procesarCola } from '../servicios/envios.js';
import { sincronizarFeriados } from '../servicios/feriados.js';
import { verificarAuditoria } from '../servicios/integridad.js';

const arranque = Date.now();

// Corre un chequeo acotado y nunca tira: una parte caída no debe romper el panel entero.
const chequear = async (fn) => {
  const t0 = Date.now();
  try { const extra = (await fn()) ?? {}; return { ok: true, ms: Date.now() - t0, ...extra }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, error: e.message }; }
};

export default async function rutasSistema(app) {
  app.addHook('preHandler', exigirRol('administrador'));

  app.get('/sistema/estado', async () => {
    const [operativaDb, historicaDb, cola, feriados, pase, integridad] = await Promise.all([
      chequear(async () => { await operativa.query('SELECT 1'); }),
      chequear(async () => { await historica.query('SELECT 1'); }),
      chequear(async () => {
        const { rows } = await operativa.query(`SELECT estado, COUNT(*) AS n FROM cola_envio GROUP BY estado`);
        const por = Object.fromEntries(rows.map((r) => [r.estado, r.n]));
        return { pendientes: por.pendiente ?? 0, procesando: por.procesando ?? 0, enviadas: por.enviado ?? 0, errores: por.error ?? 0 };
      }),
      chequear(async () => {
        const anio = new Date().getFullYear();
        const r = (await operativa.query(`SELECT COUNT(*) AS n, MAX(actualizado_en) AS al FROM feriado WHERE YEAR(fecha) = $1`, [anio])).rows[0];
        return { anio, cargados: r.n, actualizadoEn: r.al };
      }),
      chequear(async () => {
        const r = (await operativa.query(`SELECT TOP (1) tabla, periodo, estado, ejecutado_en FROM pase_historico ORDER BY ejecutado_en DESC`)).rows[0];
        return r ? { ultimo: r } : { ultimo: null };
      }),
      // Solo un resumen liviano: cantidad de registros y la cabeza de la cadena (la verificación completa es una acción).
      chequear(async () => {
        const r = (await operativa.query(`SELECT CAST(ultimo_orden AS int) AS orden, ultimo_hash FROM auditoria_cadena WHERE id = 1`)).rows[0];
        return { registros: r?.orden ?? 0, cabeza: r?.ultimo_hash ? `${r.ultimo_hash.slice(0, 12)}…` : null };
      }),
    ]);
    return {
      generadoEn: new Date().toISOString(),
      ambiente: config.ambiente,
      soloConsultas: config.soloConsultas,
      backend: { ok: true, desdeHaceSeg: Math.round((Date.now() - arranque) / 1000) },
      operativaDb, historicaDb, cola, feriados, pase, integridad,
      banco: { principal: bdv.estado(), envios: bdvEnvios.estado() },
    };
  });

  // --- Acciones de mantenimiento (reinicios seguros por subsistema) ---

  // Reconectar con el banco: olvida la sesión cacheada; la próxima llamada hace login de nuevo. No envía nada.
  app.post('/sistema/reconectar-banco', async (req) => {
    bdv.olvidar(); bdvEnvios.olvidar();
    await auditar(null, req, { tipo: 'Administración', accion: 'Reinició la conexión con el banco', api: 'Mantenimiento', detalle: 'Se descartó la sesión; la próxima llamada vuelve a autenticarse' });
    return { ok: true, mensaje: 'Sesión con el banco reiniciada. La próxima consulta vuelve a conectarse.' };
  });

  // Reprocesar la cola de envíos: destraba tareas colgadas y procesa las pendientes.
  app.post('/sistema/reprocesar-cola', async (req) => {
    const r = await procesarCola();
    await auditar(null, req, { tipo: 'Administración', accion: 'Reprocesó la cola de envíos', api: 'Mantenimiento', detalle: r.enCurso ? 'Ya había un proceso en curso' : `Procesadas ${r.procesadas ?? 0} tarea(s)` });
    return { ok: true, ...r };
  });

  // Refrescar feriados del año en curso desde las fuentes públicas.
  app.post('/sistema/refrescar-feriados', async (req) => {
    const r = await sincronizarFeriados();
    await auditar(null, req, { tipo: 'Administración', accion: 'Refrescó los feriados', api: 'Mantenimiento', detalle: `${r.anio}: ${r.feriados} feriado(s) desde ${r.fuente}` });
    return { ok: true, ...r };
  });

  // Re-verificar la integridad de la cadena de auditoría (lo mismo que hace el trabajo diario).
  app.post('/sistema/verificar-integridad', async (req) => {
    const r = await verificarAuditoria();
    await auditar(null, req, { tipo: 'Administración', accion: 'Verificó la integridad de la auditoría', api: 'Mantenimiento',
      detalle: r.ok ? `OK · ${r.filas} registros` : `PROBLEMAS · ${r.problemas.length} hallazgo(s)`, resultado: r.ok ? 'OK' : 'Error' });
    return r;
  });
}
