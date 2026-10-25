# Backup y Disaster Recovery

## Objetivo

Proteger las bases PostgreSQL **operativa** e **histórica** sin alterar la lógica de transferencias.

### Objetivos iniciales

- **RPO objetivo:** 24 horas mientras el resguardo se ejecute diariamente.
- **RTO objetivo inicial:** 2 horas.
- Estos valores son objetivos operativos; deben validarse con simulacros reales y ajustarse al SLA aprobado.

## Resguardo

`scripts/resguardo.sh` genera un `pg_dump` custom de ambas bases, lo cifra con AES-256/PBKDF2, genera HMAC-SHA256 y manifiesto SHA-256 y aplica retención. La clave vive fuera de Git en `secrets/resguardo_clave.txt`.

Para cumplir DR real, `HB_RESGUARDO_COPIAR` debe copiar cada resguardo a almacenamiento **externo al servidor** y preferentemente inmutable/WORM. Una copia que queda únicamente en el host de producción no constituye DR.

## Prueba de restauración

```sh
sh scripts/probar-dr.sh
```

El simulacro toma el resguardo más reciente y llama exclusivamente a:

```sh
sh scripts/restaurar-resguardo.sh <resguardo> --probar
```

Restaura en bases temporales, verifica integridad y elimina las bases de prueba. **Nunca restaura sobre producción.**

El resultado queda en `$HB_DR_STATUS_FILE` o, por defecto, `/var/backups/home-banking/ultimo-simulacro-dr.env`.

## Restauración real

`--restaurar` es una acción manual de emergencia y requiere escribir `RESTAURAR`. Antes de usarla: declarar incidente, aislar escrituras, identificar el punto de recuperación aprobado, conservar evidencia y obtener autorización operativa.

## Frecuencia recomendada

- Resguardo: diario como mínimo.
- Copia externa/inmutable: en cada resguardo.
- Simulacro automatizado de restauración: semanal.
- Simulacro integral de DR con medición de RTO/RPO: trimestral y después de cambios relevantes de infraestructura.

No automatizar una restauración destructiva de producción.
