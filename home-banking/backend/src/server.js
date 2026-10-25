// Backend (BFF) del Home Banking VALO.
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { autenticar } from './auth.js';
import { ErrorHttp } from './errores.js';
import { ErrorBanco } from './bdv/cliente.js';
import { operativa, historica } from './db.js';
import rutasConsultas from './routes/consultas.js';
import rutasTransferencias from './routes/transferencias.js';
import rutasAdmin from './routes/admin.js';
import rutasCartera from './routes/cartera.js';
import rutasCentroComando from './routes/centro-comando.js';
import rutasAuditoria from './routes/auditoria.js';

const app = Fastify({
  trustProxy: true, // detrás de Nginx: req.ip = IP real del usuario
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Nunca loguear tokens, cookies ni el cuerpo con claves
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  },
});

await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// Telemetría de latencia end-to-end. No registra query strings para evitar datos sensibles.
app.addHook('onRequest', async (req) => { req.inicioMs = performance.now(); });
app.addHook('onResponse', async (req, reply) => {
  const duracionMs = Math.round((performance.now() - req.inicioMs) * 10) / 10;
  const ruta = req.routeOptions?.url ?? 'desconocida';
  const nivel = duracionMs >= 1000 ? 'warn' : 'info';
  req.log[nivel]({ metrica: 'http_latency', ruta, metodo: req.method, status: reply.statusCode, duracionMs }, 'latencia HTTP');
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ErrorHttp) return reply.code(err.status).send({ error: err.codigo, mensaje: err.message });
  if (err instanceof ErrorBanco) {
    req.log.warn({ codigo: err.codigo, http: err.http }, 'Error del Banco de Valores');
    return reply.code(502).send({ error: 'banco', mensaje: err.message, codigo: err.codigo });
  }
  if (err.validation) return reply.code(400).send({ error: 'invalido', mensaje: err.message });
  if (err.code === '23514' || err.code === '23505') return reply.code(409).send({ error: 'conflicto', mensaje: err.detail ?? err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'interno', mensaje: 'Error interno' });
});

app.get('/api/health', async () => {
  const inicio = performance.now();
  await Promise.all([operativa.query('SELECT 1'), historica.query('SELECT 1')]);
  return {
    ok: true,
    dbMs: Math.round((performance.now() - inicio) * 10) / 10,
    pools: {
      operativa: { total: operativa.totalCount, idle: operativa.idleCount, esperando: operativa.waitingCount },
      historica: { total: historica.totalCount, idle: historica.idleCount, esperando: historica.waitingCount },
    },
  };
});

await app.register(async (api) => {
  api.addHook('onRequest', autenticar);
  await api.register(rutasConsultas);
  await api.register(rutasTransferencias);
  await api.register(rutasAuditoria);
  await api.register(rutasAdmin, { prefix: '/admin' });
  await api.register(rutasCentroComando, { prefix: '/admin/centro-comando' });
  await api.register(rutasCartera, { prefix: '/cartera' });
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
