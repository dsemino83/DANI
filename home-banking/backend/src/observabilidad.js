// Observabilidad: métricas HTTP para Prometheus. NO contiene datos sensibles (ni saldos, CBU, cuentas,
// nombres de clientes, tokens ni payloads del banco): solo método, ruta (el PATRÓN de Fastify, nunca la URL
// con ids ni query string), status y tiempos. La cardinalidad queda acotada porque las rutas son un conjunto fijo.
import { performance } from 'node:perf_hooks';

const metricas = {
  requests: new Map(),   // "metodo|ruta|status" -> total
  errores5xx: new Map(), // "metodo|ruta" -> total
  latencias: new Map(),  // "metodo|ruta" -> { count, sum }  (suma de ms, para la media)
};

// La etiqueta de ruta es el patrón registrado en Fastify (p. ej. /api/transferencias/:id/aprobar),
// nunca la URL concreta: así no se filtran ids ni query strings y la cardinalidad es baja.
const etiquetaRuta = (req) => req.routeOptions?.url ?? 'desconocida';
const incrementar = (mapa, clave, valor = 1) => mapa.set(clave, (mapa.get(clave) ?? 0) + valor);

export function instalarMetricas(app) {
  app.addHook('onRequest', async (req) => { req._metricasInicio = performance.now(); });
  app.addHook('onResponse', async (req, reply) => {
    const ruta = etiquetaRuta(req), metodo = req.method, status = String(reply.statusCode);
    incrementar(metricas.requests, `${metodo}|${ruta}|${status}`);
    if (reply.statusCode >= 500) incrementar(metricas.errores5xx, `${metodo}|${ruta}`);
    const dur = Math.max(0, performance.now() - (req._metricasInicio ?? performance.now()));
    const clave = `${metodo}|${ruta}`;
    const actual = metricas.latencias.get(clave) ?? { count: 0, sum: 0 };
    actual.count += 1; actual.sum += dur;
    metricas.latencias.set(clave, actual);
  });
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

// Texto en formato de exposición de Prometheus (text/plain; version=0.0.4).
export function metricsPrometheus() {
  const out = [];
  out.push('# HELP homebanking_http_requests_total Total de respuestas HTTP.');
  out.push('# TYPE homebanking_http_requests_total counter');
  for (const [clave, valor] of metricas.requests) {
    const [m, r, s] = clave.split('|');
    out.push(`homebanking_http_requests_total{method="${esc(m)}",route="${esc(r)}",status="${esc(s)}"} ${valor}`);
  }
  out.push('# HELP homebanking_http_errors_5xx_total Total de respuestas HTTP 5xx.');
  out.push('# TYPE homebanking_http_errors_5xx_total counter');
  for (const [clave, valor] of metricas.errores5xx) {
    const [m, r] = clave.split('|');
    out.push(`homebanking_http_errors_5xx_total{method="${esc(m)}",route="${esc(r)}"} ${valor}`);
  }
  out.push('# HELP homebanking_http_request_duration_ms_sum Suma de duraciones HTTP (ms).');
  out.push('# TYPE homebanking_http_request_duration_ms_sum counter');
  for (const [clave, valor] of metricas.latencias) {
    const [m, r] = clave.split('|');
    out.push(`homebanking_http_request_duration_ms_sum{method="${esc(m)}",route="${esc(r)}"} ${valor.sum.toFixed(1)}`);
  }
  out.push('# HELP homebanking_http_request_duration_ms_count Cantidad de respuestas HTTP.');
  out.push('# TYPE homebanking_http_request_duration_ms_count counter');
  for (const [clave, valor] of metricas.latencias) {
    const [m, r] = clave.split('|');
    out.push(`homebanking_http_request_duration_ms_count{method="${esc(m)}",route="${esc(r)}"} ${valor.count}`);
  }
  return out.join('\n') + '\n';
}
