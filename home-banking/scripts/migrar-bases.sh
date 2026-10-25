#!/bin/sh
# Aplica a la base operativa los cambios de esquema de una versión nueva (db/operativa/migraciones, incluidos
# en la imagen en /migraciones). Son idempotentes: correrlo de más no cambia nada. Correrlo después de cada
# "docker compose pull" + "up -d". Una base nueva ya nace con el esquema completo.
# También crea/actualiza los roles del pase mensual (hb_pase / hb_pase_h) en bases ya existentes: el servicio
# jobs ya no usa el superusuario postgres. Sus claves salen de los secretos db_jobs_password / dbh_jobs_password.
set -eu
cd "$(dirname "$0")/.."
# Roles del pase (clave por variable psql: no queda en la línea de comandos ni en logs)
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -q -U postgres -d homebanking -v p="$(cat /run/secrets/db_jobs_password)" -f -' <<'SQL'
SELECT format('CREATE ROLE hb_pase LOGIN PASSWORD %L', :'p') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_pase') \gexec
SELECT format('ALTER ROLE hb_pase PASSWORD %L', :'p') \gexec
SQL
docker compose exec -T postgres sh -c '
  for f in /migraciones/*.sql; do
    [ -f "$f" ] || continue
    psql -v ON_ERROR_STOP=1 -q -U postgres -d homebanking -f "$f" || exit 1
    echo "migración aplicada: $(basename "$f")"
  done'
docker compose exec -T postgres-historico sh -c 'psql -v ON_ERROR_STOP=1 -q -U postgres -d homebanking_hist -v p="$(cat /run/secrets/dbh_jobs_password)" -f -' <<'SQL'
SELECT format('CREATE ROLE hb_pase_h LOGIN PASSWORD %L', :'p') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_pase_h') \gexec
SELECT format('ALTER ROLE hb_pase_h PASSWORD %L', :'p') \gexec
SQL
docker compose exec -T postgres-historico psql -v ON_ERROR_STOP=1 -q -U postgres -d homebanking_hist -f /migraciones/rol-pase.sql && echo "rol del pase (histórica) aplicado"
