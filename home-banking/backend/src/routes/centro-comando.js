// Centro de Comando de Seguridad y Resiliencia para el administrador.
import { exigirRol } from '../auth.js';
import { operativa, historica } from '../db.js';

export default async function rutasCentroComando(app) {
  app.addHook('preHandler', exigirRol('administrador'));

  app.get('/estado', async () => {
    const inicio = performance.now();
    const [db, hist, pendientes, inciertas, errores] = await Promise.all([
      operativa.query('SELECT 1 AS ok'),
      historica.query('SELECT 1 AS ok'),
      operativa.query("SELECT count(*)::int AS n FROM transferencia WHERE estado = 'PENDIENTE_APROBACION'"),
      operativa.query("SELECT count(*)::int AS n FROM transferencia WHERE estado = 'ENVIADA'"),
      operativa.query("SELECT count(*)::int AS n FROM transferencia WHERE estado = 'ERROR_API'"),
    ]);
    return {
      ok: true,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
      ambiente: process.env.BDV_AMBIENTE,
      soloConsultas: ['true','1','si','sí'].includes(String(process.env.BDV_SOLO_CONSULTAS ?? '').toLowerCase()),
      latenciaDbMs: Math.round((performance.now() - inicio) * 10) / 10,
      bases: { operativa: !!db.rows[0]?.ok, historica: !!hist.rows[0]?.ok },
      pools: {
        operativa: { total: operativa.totalCount, idle: operativa.idleCount, esperando: operativa.waitingCount },
        historica: { total: historica.totalCount, idle: historica.idleCount, esperando: historica.waitingCount },
      },
      negocio: {
        pendientesAprobacion: pendientes.rows[0].n,
        enviadasInciertas: inciertas.rows[0].n,
        erroresApi: errores.rows[0].n,
      },
      zap: { enabled: process.env.ZAP_ENABLED === 'true', targetConfigured: Boolean(process.env.ZAP_TARGET_URL) },
      remediacion: {
        disponible: false,
        motivo: 'Las acciones disruptivas se delegarán a SOAR/Argo/Ansible con allowlist, doble control y auditoría cuando exista la infraestructura Zero Trust.',
      },
    };
  });
}
