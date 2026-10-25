# OpenTelemetry (trazas distribuidas)

Instrumentación OTEL del backend: trazas HTTP → Fastify → PostgreSQL → BDV. **Apagado por defecto**
(`OTEL_ENABLED=false`): con OTEL apagado no se carga nada. La observabilidad **nunca bloquea** una operación:
si faltan dependencias o el collector está caído, el Home Banking sigue funcionando.

## Qué se instrumenta

- **HTTP** entrante (`@opentelemetry/instrumentation-http`), ignorando `/api/health` y `/api/metrics`.
- **Fastify** (`@opentelemetry/instrumentation-fastify`): la ruta queda como **patrón** (p. ej.
  `/api/transferencias/:id/aprobar`), no la URL concreta.
- **PostgreSQL** (`@opentelemetry/instrumentation-pg`) con `enhancedDatabaseReporting: false`: **no** captura
  los valores de los parámetros.

## Qué se registra / qué NO

Se registra: `trace_id`, `span_id`, método, ruta (patrón), status, duración. Los logs del backend incluyen
`trace_id`/`span_id` cuando OTEL está activo (correlación).

**Nunca** se registran: CBU, CUIT, número de cuenta, saldo, movimientos, tokens, cookies, `Authorization`,
cuerpos de request/response ni respuestas financieras. Las instrumentaciones se configuran sin captura de
encabezados ni cuerpos, y los logs ya redactan `authorization`/`cookie`/`set-cookie`.

## Variables (con defaults)

| Variable | Default | |
|---|---|---|
| `OTEL_ENABLED` | `false` | Enciende la instrumentación |
| `OTEL_SERVICE_NAME` | `home-banking-backend` | Nombre del servicio |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | Collector (red interna) |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` | Muestreo |
| `OTEL_TRACES_SAMPLER_ARG` | `0.10` | 10% de las trazas |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | `15000` | Intervalo de métricas |

## Cómo encenderlo

```sh
docker compose -f docker-compose.yml -f ops/docker-compose.otel.yml up -d
```

Esto levanta el **OTEL Collector** (`ops/otel-collector/config.yaml`) en la red interna `app` (OTLP gRPC 4317 /
HTTP 4318, **no** expuesto al público) y enciende `OTEL_ENABLED=true` en el backend. El collector por defecto
solo imprime un resumen de las trazas (exporter `debug`): es autosuficiente. En un entorno real se reemplaza
ese exporter por Tempo / Jaeger / el backend de trazas elegido.

Para encenderlo sin el overlay, basta `OTEL_ENABLED=true` en `.env` apuntando a un collector existente.

## Dónde está en el código

- `backend/src/otel.js` — bootstrap OTEL (no-op si está apagado; nunca tira) y `contextoTraza()` para la
  correlación de logs.
- `backend/src/server.js` — importa `otel.js` **primero** (antes de Fastify/pg) y usa `contextoTraza()` en el
  `mixin` del logger.
- `ops/otel-collector/config.yaml`, `ops/docker-compose.otel.yml` — collector y overlay.

## Estado

**IMPLEMENTADO EN CÓDIGO, NO VALIDADO DE PUNTA A PUNTA.** Está verificado que `otel.js` carga apagado sin
efecto y, encendido, inicia el SDK sin romper la app aunque el collector no esté. La recepción real de trazas
en el collector y su visualización NO se validaron en este entorno (requiere levantar el collector). No se
afirma "OTEL OK".
