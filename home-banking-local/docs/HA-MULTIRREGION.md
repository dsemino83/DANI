# Alta disponibilidad, Kubernetes y multi-región (preparación)

Documento de **preparación**. Nada de lo de acá está desplegado: hoy el sistema corre en Docker Compose
single-node. Se separa explícitamente lo implementado, lo preparado y lo que requiere infraestructura.

## Alta disponibilidad (HA)

Objetivo: tolerar la caída de una instancia sin corte del servicio.

- **Backend**: es stateless (la sesión del banco se re-login sola; no hay estado local crítico). Escala a N
  réplicas detrás de un balanceador. **PREPARADO** (el diseño lo permite). **REQUIERE INFRAESTRUCTURA**
  (balanceador, orquestador).
- **SQL Server**: operativa + histórica. HA con Always On (grupo de disponibilidad) o el HA del proveedor y
  failover. **REQUIERE INFRAESTRUCTURA.**
- **Keycloak**: cluster con Infinispan para sesiones. **REQUIERE INFRAESTRUCTURA** (ver
  `docs/seguridad-iam-keycloak.md`).
- **Banco de Valores**: no es nuestro. El circuit breaker y el monitoreo sintético detectan su caída;
  contingencia = esperar su recuperación (no hay "BDV secundario").

## Kubernetes

Preparación para correr en K8s sin volverlo obligatorio:

- **liveness** → `GET /api/health` (ya existe; valida ambas bases).
- **readiness** → `GET /api/health`.
- **startup** → `GET /api/health` con mayor margen inicial (Keycloak/DB tardan en levantar).
- **resources**: requests/limits equivalentes a los `mem_limit`/`pids_limit` del compose.
- **HPA**: escalar por CPU / requests por segundo (métrica de Prometheus).
- **PDB**: mínimo de réplicas disponibles durante un drain.
- **rolling update**: `maxUnavailable: 0` para no cortar.

Los manifests concretos **REQUIEREN INFRAESTRUCTURA** (un cluster). Kubernetes **no** es dependencia: el mismo
backend corre en Compose.

## Multi-región

| Pieza | Región A (activa) | Región B |
|---|---|---|
| Backend | réplicas activas | réplicas en espera / activas |
| SQL Server | primaria | réplica (grupo de disponibilidad, asíncrono) |
| Keycloak | cluster | cluster (o federación) |
| Failover | — | promover B, repuntar DNS |

- **Replicación**: asíncrona de SQL Server (operativa e histórica) hacia la región B.
- **DNS / failover**: cambio de DNS o balanceador global ante caída de A.
- **RPO/RTO**: ver `docs/DISASTER-RECOVERY.md` (RPO ≤ 24 h, RTO inicial ≤ 2 h como objetivo).

Todo multi-región es **REQUIERE INFRAESTRUCTURA**. No se afirma que exista una segunda región.

## Clasificación

| Tema | Estado |
|---|---|
| Backend stateless escalable | PREPARADO |
| Health checks para probes | IMPLEMENTADO (`/api/health`) |
| Manifests K8s | PENDIENTE / REQUIERE INFRAESTRUCTURA |
| SQL Server HA | REQUIERE INFRAESTRUCTURA |
| Keycloak HA | REQUIERE INFRAESTRUCTURA |
| Multi-región | REQUIERE INFRAESTRUCTURA |
