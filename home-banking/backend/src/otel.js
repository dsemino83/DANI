// OpenTelemetry (trazas distribuidas) del backend. APAGADO por defecto: con OTEL_ENABLED != 'true' no hace
// absolutamente nada. Se importa ANTES que Fastify/pg (primera línea de server.js) para poder instrumentarlos.
//
// Reglas (Fases 9-11):
//  - La observabilidad JAMÁS bloquea una operación: si faltan dependencias o el collector está caído, la app
//    sigue funcionando igual (todo envuelto en try/catch; el export es asíncrono y best-effort).
//  - NO se registran datos sensibles: sin cuerpos de request/response, sin encabezados de autenticación
//    (Authorization/Cookie), sin valores de parámetros SQL. Nunca entran CBU/CUIT/cuenta/saldo/tokens/cookies.
//  - La ruta HTTP queda como patrón de Fastify; /api/health y /api/metrics se ignoran.
//
// Endpoint, muestreo e intervalo salen de las variables OTEL_* estándar que lee el SDK
// (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_TRACES_SAMPLER, OTEL_TRACES_SAMPLER_ARG, OTEL_METRIC_EXPORT_INTERVAL_MS).

// API de trazas (paquete liviano, seguro de importar siempre: es no-op si no hay SDK registrado).
// Permite correlacionar logs con trace_id/span_id sin acoplar el resto del código a OTEL.
let apiTrace = null;
try { ({ trace: apiTrace } = await import('@opentelemetry/api')); } catch { /* sin OTEL API: queda null */ }

// Devuelve { trace_id, span_id } del span activo, o {} si no hay OTEL / no hay span. Nunca tira.
export function contextoTraza() {
  try {
    const ctx = apiTrace?.getActiveSpan?.()?.spanContext?.();
    return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : {};
  } catch { return {}; }
}

if (process.env.OTEL_ENABLED === 'true') {
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { resourceFromAttributes } = await import('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');
    const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
    const { FastifyInstrumentation } = await import('@opentelemetry/instrumentation-fastify');
    const { PgInstrumentation } = await import('@opentelemetry/instrumentation-pg');

    const servicio = process.env.OTEL_SERVICE_NAME || 'home-banking-backend';
    const sinInteres = (url = '') => url.startsWith('/api/health') || url.startsWith('/api/metrics');
    // La URL cruda puede traer cuentas/CBU/CUIT en la ruta o datos en la query: el span lleva solo la ruta con los
    // números largos enmascarados y SIN query string. (La ruta-patrón de Fastify viaja aparte en http.route.)
    const rutaSegura = (url = '') => String(url).split('?')[0].replace(/\d{6,}/g, '*');
    const limpiarSpan = (span, req) => {
      const r = rutaSegura(req?.url);
      for (const k of ['http.target', 'url.path', 'http.url', 'url.full']) span.setAttribute(k, r);
      span.setAttribute('url.query', '');
    };

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: servicio }),
      traceExporter: new OTLPTraceExporter(), // usa OTEL_EXPORTER_OTLP_ENDPOINT
      instrumentations: [
        // Sin captura de encabezados ni cuerpos (defaults): nunca Authorization/Cookie/payload en el span.
        new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => sinInteres(req.url ?? ''), requestHook: limpiarSpan }),
        new FastifyInstrumentation(),
        new PgInstrumentation({ enhancedDatabaseReporting: false }), // no captura valores de parámetros SQL
      ],
    });
    sdk.start();
    process.on('SIGTERM', () => { sdk.shutdown().catch(() => {}); });
    console.log(`[otel] trazas activas · servicio ${servicio} · endpoint ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318'}`);
  } catch (e) {
    console.warn(`[otel] no se pudo iniciar (se continúa sin trazas): ${e.message}`);
  }
}
