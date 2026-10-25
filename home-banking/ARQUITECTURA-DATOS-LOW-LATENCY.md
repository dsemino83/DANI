# Arquitectura de datos low-latency — Home Banking VALO

## Objetivo y SLO
PostgreSQL 16 sigue siendo el system of record. La meta recomendada es p95 < 50 ms y p99 < 150 ms para lecturas internas de DB (sin contar APIs externas), con transferencias priorizando consistencia/durabilidad sobre caché.

## 1. Indexación
Los scripts de performance agregan índices compuestos, de cobertura y parciales alineados con las consultas reales:
- transferencias por cuenta + fecha + id;
- estado + cuenta + fecha;
- bandeja PENDIENTE_APROBACION parcial;
- recuperación ENVIANDO parcial;
- auditoría por fecha/usuario/tipo y trigram para ILIKE;
- historial de estados por transferencia.
No conviene crear un índice por cada columna: cada índice encarece INSERT/UPDATE y WAL.

En PostgreSQL no se recomienda REINDEX periódico por calendario. Primero medir bloat. Usar autovacuum agresivo en particiones activas, VACUUM (ANALYZE), y REINDEX CONCURRENTLY solo cuando exista evidencia de bloat. Particiones históricas cerradas casi no requieren mantenimiento.

## 2. CQRS, histórico y réplicas
El diseño ya separa operativa (3 meses) e histórica, lo que es una buena base CQRS física. Mantener:
- operativa primaria para comandos, aprobación, idempotencia y lecturas read-after-write;
- histórica/read replicas para extractos, auditoría pesada y exportaciones;
- nunca enviar aprobación/estado crítico a una réplica con lag.

Para HA/escala: PostgreSQL primary + streaming replicas gestionadas por Patroni/servicio administrado. Réplica síncrona solo si el RPO=0 justifica la latencia; réplicas de lectura asíncronas para consultas tolerantes a segundos de lag. El router debe observar replay lag antes de derivar tráfico.

PgBouncer en transaction pooling delante de PostgreSQL es recomendable al escalar horizontalmente el backend. Mantener pools pequeños por instancia; el total de pools de todas las réplicas del backend debe quedar muy por debajo de max_connections.

## 3. Query tuning y paginación
Antipatrón:
```sql
SELECT ...
FROM transferencia
ORDER BY creado_en DESC, id DESC
OFFSET 500000 LIMIT 500;
```
El motor debe recorrer/descartar filas previas.

Seek/keyset:
```sql
SELECT ...
FROM transferencia
WHERE creado_en >= $1
  AND creado_en < $2
  AND cuenta_origen = ANY($3)
  AND (creado_en, id) < ($4::timestamptz, $5::bigint)
ORDER BY creado_en DESC, id DESC
LIMIT 501;
```
Con índice `(cuenta_origen, creado_en DESC, id DESC)`, el costo no crece con la profundidad. El backend fue migrado a este patrón para histórico de transferencias y auditoría.

Siempre validar consultas calientes con:
```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS)
SELECT ...;
```
Buscar Seq Scan inesperados, rows removed, lecturas físicas, spills/sorts y estimaciones muy distintas de filas reales.

El particionamiento mensual actual es correcto para pruning siempre que los predicados filtren directamente por `creado_en` / `en`. Evitar envolver esas columnas en funciones en WHERE.

## 4. Caché y materialización
No cachear como fuente autoritativa el estado de una transferencia, la idempotencia, `envio_banco` ni decisiones de autorización críticas.

Redis puede incorporarse para:
- metadatos/perfil y configuración de baja mutación;
- permisos/cartera con TTL corto (por ejemplo 30–120 s) más invalidación por evento;
- resultados de referencia no financieros;
- rate limiting distribuido.

Patrón recomendado: cache-aside + claves versionadas + TTL con jitter. Tras cambios administrativos publicar un evento (Kafka/Redis Streams/outbox) y borrar las claves afectadas. Para eventos financieros, usar Transactional Outbox en PostgreSQL para no perder invalidaciones entre COMMIT y publicación.

Materialized views: solo para dashboards/resúmenes agregados, preferentemente sobre histórica/read replica. Refrescar en background con `REFRESH MATERIALIZED VIEW CONCURRENTLY` y un índice UNIQUE compatible. No usarlas para saldo disponible o decisiones transaccionales en tiempo real.

## 5. Observabilidad / Query Performance Insights
Habilitar `pg_stat_statements` y recolectar:
- p50/p95/p99 por query normalizada;
- calls, total_exec_time, mean_exec_time, rows;
- cache hit ratio y temp bytes;
- locks/waits y deadlocks;
- active/idle connections y saturación del pool;
- replica replay lag;
- WAL bytes/rate;
- autovacuum lag, dead tuples y bloat;
- IOPS, fsync/checkpoint time y CPU.

Alertas iniciales: pool >80%, conexiones DB >75%, replica lag >2 s para rutas de lectura, deadlocks >0, consultas web >500 ms, y crecimiento sostenido de dead tuples.

Ejemplo:
```sql
SELECT queryid, calls, total_exec_time, mean_exec_time, rows,
       shared_blks_hit, shared_blks_read, temp_blks_written
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

## 6. Saldos y movimientos del banco
En el código actual, saldos/movimientos provienen de APIs del Banco de Valores, no de PostgreSQL. Los índices locales no reducen esa latencia externa. Para saldos, evitar caché larga: si se incorpora, TTL de segundos y UI indicando freshness. Para movimientos históricos externos, una estrategia futura es ingestarlos de forma idempotente a un read model propio si el contrato/regulación lo permite.

## 7. Seguridad dinámica y observabilidad

El stack incorpora un baseline nocturno de OWASP ZAP contra staging, ejecutado por el servicio `jobs` a las 02:30 (America/Argentina/Buenos_Aires). Es **pasivo/informativo**: hace crawling y espera el passive scan, pero no ejecuta Active Scan ni intenta explotar vulnerabilidades. Esto es coherente con el objetivo de complementar el monitoreo sin introducir una compuerta de despliegue ni operaciones contra el banco. ZAP indica que el baseline no realiza ataques y que el passive scan no modifica requests/responses. citeturn0search0turn0search1

Controles implementados alrededor del job:
- activación explícita mediante `ZAP_ENABLED=true`;
- `ZAP_TARGET_URL` debe usar exactamente el hostname indicado en `ZAP_STAGING_HOST`;
- API de ZAP solo en red Docker interna, con API key en Docker Secret;
- límite de tiempo configurable;
- informe JSON temporal y resumen de resultados en logs;
- el job no bloquea despliegues ni cambia estados financieros.

El baseline no sustituye el pentest autenticado contra staging. Ese pentest sigue siendo una actividad pendiente de la infraestructura real, junto con HSM/Vault, K8s/service mesh, SIEM, passkeys/MFA, tokenización y los procedimientos operativos de resguardo/rotación/retención/SMTP.

## 7. Despliegue seguro
1. Medir baseline con pg_stat_statements.
2. Aplicar índices en homologación y correr EXPLAIN ANALYZE sobre consultas reales.
3. En producción con datos existentes usar CREATE INDEX CONCURRENTLY.
4. Desplegar keyset pagination; durante transición aceptar cursor y retirar `pagina`.
5. Recién después incorporar PgBouncer/read replicas.
6. Redis/Kafka son fase posterior: no deben agregarse antes de medir el cuello real.

La optimización debe probarse con carga representativa (lecturas, altas, aprobaciones concurrentes, auditoría y jobs), verificando p95/p99 y, especialmente, que no se degrade la semántica de doble control e idempotencia.
