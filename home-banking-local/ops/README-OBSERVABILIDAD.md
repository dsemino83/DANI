# Observabilidad (Fase 2) — Prometheus + Grafana

Métricas HTTP del backend (requests, errores 5xx, latencia, por ruta) expuestas para Prometheus y
visualizadas en Grafana. **Apagado por defecto**: no afecta el sistema hasta que se habilita a propósito.

## Qué se agregó

- `backend/src/observabilidad.js` — mide requests, errores 5xx y tiempos por ruta. **Sin datos sensibles**:
  solo método, ruta (el *patrón* de Fastify, nunca la URL con ids ni query string), status y tiempos.
- `backend/src/server.js` — expone `GET /api/metrics` (fuera del JWT, como `/api/health`), apagado por
  defecto y protegido por `METRICS_TOKEN`.
- `frontend/templates/default.conf.template` — Nginx responde 404 a `/api/metrics`: **no se expone al
  público**. Prometheus lo consulta directo al backend por la red interna.
- `ops/prometheus/` — scrape de `backend:8080/api/metrics` y alertas (backend caído, 5xx, latencia).
- `ops/grafana/` — datasource Prometheus y un dashboard inicial.
- `ops/docker-compose.observabilidad.yml` — overlay con Prometheus + Grafana.

## Cómo encenderlo

1. **Token del scrape** (el mismo en los dos lados):

   ```sh
   openssl rand -hex 32 > secrets/metrics_token.txt      # lo lee Prometheus
   echo "METRICS_ENABLED=true" >> .env
   echo "METRICS_TOKEN=$(cat secrets/metrics_token.txt)" >> .env   # lo valida el backend
   ```

2. **Clave de Grafana**:

   ```sh
   openssl rand -base64 24 > secrets/grafana_admin_password.txt
   ```

3. **Levantar** (overlay sobre el compose principal):

   ```sh
   docker compose -f docker-compose.yml -f ops/docker-compose.observabilidad.yml up -d
   ```

4. **Ver Grafana**: en la máquina de prueba se reenvía el puerto `3001` →
   `http://localhost:3001` (usuario `admin`, clave la de `secrets/grafana_admin_password`). El dashboard
   "Home Banking - Seguridad y Resiliencia" queda provisto automáticamente.

Para **apagarlo**: `METRICS_ENABLED=false` en `.env` (el endpoint vuelve a dar 404) y, si querés, bajar el
overlay: `docker compose -f docker-compose.yml -f ops/docker-compose.observabilidad.yml stop prometheus grafana`.

## Seguridad

- `/api/metrics` **no** se publica por Nginx; solo lo alcanza Prometheus en la red interna.
- Las métricas **nunca** incluyen: saldos, CBU, números de cuenta, nombres de clientes, tokens, cookies,
  datos de transferencias ni payloads del Banco de Valores. La etiqueta `route` es el patrón de Fastify, no
  la URL concreta.
- Los secretos (`secrets/metrics_token`, `secrets/grafana_admin_password`) **no** van al repositorio.
- En producción, Grafana y Prometheus van en red interna / detrás del reverse proxy, no publicados.
