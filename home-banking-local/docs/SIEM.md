# SIEM — formato de eventos de seguridad

Especificación del **formato estructurado** de eventos de seguridad para enviar a un SIEM (Loki / Elasticsearch
/ el SIEM del banco). El backend ya emite logs estructurados en JSON por stdout (pino), con `request_id` y
—cuando OpenTelemetry está activo— `trace_id`/`span_id`. Un colector (Fluent Bit / Vector / Promtail) los
envía al destino.

## Campos del evento

| Campo | Ejemplo | |
|---|---|---|
| `timestamp` | `2026-10-25T13:00:00Z` | ISO 8601 UTC |
| `event_type` | `transfer_approved` | ver lista abajo |
| `severity` | `info` / `warning` / `critical` | |
| `service` | `home-banking-backend` | |
| `environment` | `homo` / `prod` | `BDV_AMBIENTE` |
| `request_id` | `9b2a1427-...` | id del pedido (Nginx/backend) |
| `trace_id` | `4bf92f...` | si OTEL activo |
| `result` | `success` / `denied` / `error` / `uncertain` | |

## Tipos de evento

`login_success`, `login_failure`, `permission_denied`, `transfer_requested`, `transfer_approved`,
`transfer_rejected`, `transfer_uncertain`, `bdv_unavailable`, `circuit_open`, `admin_action`,
`security_error`.

## Qué NO se incluye

Nunca: saldos, CBU, CUIT, número de cuenta, montos de clientes, nombres de clientes, tokens, cookies,
`Authorization`, cuerpos ni respuestas financieras. El evento identifica **qué** pasó y **sobre qué recurso**
(por id lógico), no el dato financiero.

## Compatibilidad

- **Loki / Promtail**: los logs JSON por stdout se ingieren directo; `event_type` y `severity` como labels.
- **Elasticsearch / OpenSearch**: vía Filebeat/Fluent Bit, un índice por `environment`.
- **SIEM**: reenvío del colector por syslog/HTTP. La correlación usa `request_id` y `trace_id`.

El backend **no** requiere el SIEM para funcionar: si el colector o el SIEM están caídos, el Home Banking
sigue operando (los eventos son best-effort sobre el log).

## Estado

**PREPARADO.** El backend ya produce logs estructurados con `request_id`/`trace_id` y la redacción de datos
sensibles. Este documento fija el **contrato** de los eventos de seguridad. La emisión explícita de cada
`event_type` en cada punto (login, aprobación, etc.) y el despliegue del colector + SIEM real
**REQUIEREN INFRAESTRUCTURA** y trabajo de integración; no se afirma "SIEM OK".
