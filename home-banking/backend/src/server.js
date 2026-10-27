// Backend (BFF) del Home Banking VALO.
import { contextoTraza } from './otel.js'; // PRIMERO: inicia OpenTelemetry (si OTEL_ENABLED) antes de Fastify/pg
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { autenticar } from './auth.js';
import { ErrorHttp } from './errores.js';
import { ErrorBanco } from './bdv/cliente.js';
import { operativa, historica, esDuplicado, esRestriccion } from './db.js';
import { instalarMetricas, metricsPrometheus } from './observabilidad.js';
import { contextoPedido } from './telemetria.js';
import rutasConsultas from './routes/consultas.js';
import rutasTransferencias from './routes/transferencias.js';
import rutasAdmin from './routes/admin.js';
import rutasSistema from './routes/sistema.js';
import rutasCartera from './routes/cartera.js';
import rutasEnvios from './routes/envios.js';
import rutasMensajes from './routes/mensajes.js';
import rutasDocs from './routes/docs.js';
import rutasAuditoria from './routes/auditoria.js';
import { limitarPedidos, mascarar } from './limites.js';

// Id de cada pedido para seguirlo de punta a punta: el que pone Nginx ($request_id) o uno nuevo
const idValido = (v) => (typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);

const app = Fastify({
  trustProxy: true, // detrás de Nginx: req.ip = IP real del usuario
  requestIdHeader: false,
  genReqId: (req) => idValido(req.headers['x-request-id']) ?? randomUUID(),
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Nunca loguear tokens, cookies ni el cuerpo con claves; CBU, CUIT y cuentas enmascarados en las URLs
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    // Correlación de logs: agrega trace_id/span_id cuando OpenTelemetry está activo; {} si no (sin cambios).
    mixin: () => contextoTraza(),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: mascarar(req.url), ip: req.ip }),
    },
  },
});
app.addHook('onSend', async (req, reply) => { reply.header('x-request-id', req.id); });
// El reqId viaja en el contexto asíncrono: la telemetría de llamadas externas lo toma sin pasarlo por cada función.
app.addHook('onRequest', (req, reply, done) => contextoPedido.run({ reqId: req.id }, done));

// Observabilidad: cuenta requests, errores 5xx y tiempos por ruta (sin datos sensibles). Apagada por defecto.
instalarMetricas(app);

await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ErrorHttp) return reply.code(err.status).send({ error: err.codigo, mensaje: err.message });
  if (err instanceof ErrorBanco) {
    req.log.warn({ codigo: err.codigo, http: err.http }, 'Error del Banco de Valores');
    return reply.code(502).send({ error: 'banco', mensaje: err.message, codigo: err.codigo });
  }
  if (err.validation) return reply.code(400).send({ error: 'invalido', mensaje: err.message });
  if (esRestriccion(err) || esDuplicado(err)) return reply.code(409).send({ error: 'conflicto', mensaje: err.detail ?? err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'interno', mensaje: 'Error interno' });
});

app.get('/api/health', async () => {
  await operativa.query('SELECT 1');
  await historica.query('SELECT 1');
  return { ok: true };
});

// Métricas Prometheus: fuera del flujo autenticado por JWT (como /api/health), protegido por METRICS_TOKEN.
// Nginx NO lo expone al público (ver frontend/templates/default.conf.template); Prometheus lo consulta directo
// en la red interna (backend:8080). Apagado por defecto (404). Nunca devuelve datos sensibles.
app.get('/api/metrics', async (req, reply) => {
  if (!config.metricas.habilitado) return reply.code(404).send({ error: 'no_disponible' });
  if (config.metricas.token && req.headers.authorization !== `Bearer ${config.metricas.token}`) {
    return reply.code(401).send({ error: 'no_autorizado' });
  }
  reply.type('text/plain; version=0.0.4; charset=utf-8');
  return metricsPrometheus();
});

await app.register(async (api) => {
  api.addHook('onRequest', autenticar);
  api.addHook('onRequest', limitarPedidos); // después de autenticar: límite por usuario
  await api.register(rutasConsultas);
  await api.register(rutasTransferencias);
  await api.register(rutasAuditoria);
  await api.register(rutasAdmin, { prefix: '/admin' });
  await api.register(rutasSistema);
  await api.register(rutasCartera, { prefix: '/cartera' });
  await api.register(rutasEnvios);
  await api.register(rutasMensajes);
  await api.register(rutasDocs);
}, { prefix: '/api' });

const cerrar = async () => {
  await app.close();
  await operativa.end();
  await historica.end();
  process.exit(0);
};
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);

await app.listen({ port: config.puerto, host: '0.0.0.0' });
