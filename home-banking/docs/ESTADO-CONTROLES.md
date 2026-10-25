# Estado de los controles — clasificación honesta

Clasificación de cada control según lo que **realmente** está hecho. No se declara "producción", "HA", "DR
OK" ni "OTEL OK" sin validación real de infraestructura.

Leyenda: **TESTEADO** = implementado y con tests · **IMPLEMENTADO** = en código/config, sin test automático o
sin ejecución real end-to-end · **PREPARADO** = diseño/costura listos, falta integración · **REQUIERE
INFRAESTRUCTURA** = depende de algo externo no desplegado · **PENDIENTE** = no hecho.

> Verificado en este entorno: `npm test` **34/34**, e2e (autorización, doble control/envío único, límites)
> **TODO OK**, secret scan **limpio** (`.gitignore` cubre `.env` y `secrets/*.txt`; no hay secretos reales
> commiteados). Lo que depende de levantar servicios externos (Grafana, OTEL Collector, SIEM, Vault, HSM,
> clusters) **no** se validó end-to-end.

| Control | Estado | Nota |
|---|---|---|
| Autenticación OIDC | TESTEADO | JWT validado server-side; tests de autorización |
| Autorización server-side + permiso por empresa | TESTEADO | `exigirRol`/permisos por cuenta |
| Separación de roles / doble control | TESTEADO | el creador no aprueba; e2e de doble control |
| Idempotencia financiera | TESTEADO | id lógico, `envio_banco`, máquina de estados |
| Transferencia incierta ⇒ sin retry | IMPLEMENTADO | `sinRespuesta` ⇒ ENVIADA, se concilia |
| Rate limiting | TESTEADO | por IP (Nginx) + por usuario (backend) |
| TLS / HSTS / CSP / security headers | IMPLEMENTADO | Nginx |
| Docker hardening + redes segmentadas | IMPLEMENTADO | cap_drop, read_only, pids/mem, publica/app/datos/salida |
| Jobs sin superusuario | IMPLEMENTADO Y PROBADO (local) | el pase usa `hb_pase`/`hb_pase_h` (dueños solo de las tablas del pase); probado un pase real contra Postgres local; no ejecutado en Docker |
| Conciliación débito↔transferencia | TESTEADO | ante candidatos equivalentes: `CONCILIACION_AMBIGUA`, sin asignación (tests con dos débitos idénticos) |
| Histórico de transferencias | IMPLEMENTADO | paginación por cursor `(creado_en,id)`, sin OFFSET |
| `X-Forwarded-For` | IMPLEMENTADO | Nginx lo sobrescribe con la IP real (no falsificable) |
| CI: Trivy | IMPLEMENTADO | bloquea CRITICAL (fs e IaC); HIGH informativo |
| Auditoría (cadena de hash) | IMPLEMENTADO | verificación por job + acción manual |
| Circuit breaker BDV | TESTEADO | OPEN ⇒ sin transferencia; 4xx no abre |
| Prometheus `/api/metrics` | IMPLEMENTADO | off por defecto, no público (Nginx 404), token |
| Grafana dashboard | IMPLEMENTADO, NO EJECUTADO | overlay opcional; no validado con Grafana real |
| Monitoreo sintético (read-only) | IMPLEMENTADO Y TESTEADO (lógica) | agendado en `jobs`, off por defecto (`SYNTHETIC_MONITOR_ENABLED`); lista blanca de una ruta de lectura; no ejecutado contra el banco real |
| Backup (op + histórica, cifrado, manifest, marker completo) | IMPLEMENTADO | `scripts/resguardo.sh` |
| DR — restore de prueba | IMPLEMENTADO, NO EJECUTADO | `scripts/probar-dr.sh`; no se corrió un restore real controlado |
| OpenTelemetry (trazas + correlación de logs) | VERIFICADO PARCIALMENTE | off por defecto; spans HTTP/Fastify exportados por OTLP a un receptor de prueba y sin datos sensibles; sin collector real ni spans de PG verificados; **sin almacenamiento persistente de trazas** (Collector con exporter `debug`) |
| OTEL Collector | IMPLEMENTADO, NO EJECUTADO | overlay; solo red interna |
| SIEM (formato de eventos) | PREPARADO | logs estructurados + contrato; sin SIEM real |
| Vault | PREPARADO / REQUIERE INFRAESTRUCTURA | secretos por archivo hoy; costura documentada |
| HSM / KMS | PREPARADO / REQUIERE INFRAESTRUCTURA | cripto actual sin cambios |
| Centro de comando (panel admin) | IMPLEMENTADO | muestra DB, BDV, circuito, cola, integridad, métricas on/off |
| Auto-healing seguro | PARCIAL | reinicios seguros por subsistema en el panel; no acciones financieras |
| ZAP baseline | PENDIENTE | no incluido en este alcance; sería passive baseline, no "pentest" |
| Detección de anomalías | PENDIENTE | reglas de alerta en Prometheus cubren parte (5xx, latencia, circuito, backend down) |
| Circuit breakers adicionales (OIDC/SMTP/PA/PG) | PENDIENTE | evaluar; hoy solo BDV |
| HA (backend réplicas, PG/Keycloak HA) | PREPARADO / REQUIERE INFRAESTRUCTURA | `docs/HA-MULTIRREGION.md` |
| Kubernetes | PREPARADO / REQUIERE INFRAESTRUCTURA | probes vía `/api/health` |
| Multi-región | REQUIERE INFRAESTRUCTURA | documentado, no desplegado |

## Garantías financieras (verificadas en código/tests)

- **Transferencia incierta ⇒ NO retry automático.**
- **Circuit breaker OPEN ⇒ NINGUNA transferencia.**
- **Observabilidad caída (Prometheus / OTEL Collector / Grafana) ⇒ el Home Banking sigue funcionando.**
- **SMTP caído ⇒ las operaciones financieras no se alteran** (el correo es un envío programado aparte).

## Lo que NO se afirma

- No se dice "producción" (no se validó la infraestructura real).
- No se dice "pentest" (no se corrió ZAP, y un baseline no es un pentest).
- No se dice "HA" ni "multi-región" (solo documentación/preparación).
- No se dice "DR OK" (no se ejecutó un restore real/controlado).
- No se dice "OTEL OK" (solo se agregó y validó que carga/arranca; sin collector real).
