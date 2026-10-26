#!/bin/sh
# Provisión idempotente de la base histórica en cada arranque (servicio dbh-init): rol hb_pase_h con su clave
# sincronizada con el secreto, y su propiedad sobre las tablas del pase. Ver db/operativa/aplicar.sh.
set -eu
export PGHOST="${PGHOST:-postgres-historico}" PGUSER=postgres PGPASSWORD="$(cat /run/secrets/dbh_owner_password)"
for i in $(seq 1 60); do psql -d homebanking_hist -Atqc 'SELECT 1' >/dev/null 2>&1 && break; [ "$i" = 60 ] && { echo "dbh-init: la base no responde" >&2; exit 1; }; sleep 2; done
psql -v ON_ERROR_STOP=1 -q -d homebanking_hist -v r=hb_pase_h -v p="$(cat /run/secrets/dbh_jobs_password)" -f - <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'r', :'p') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'r') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'r', :'p') \gexec
SQL
echo "rol hb_pase_h sincronizado"
psql -v ON_ERROR_STOP=1 -q -d homebanking_hist -f /migraciones/rol-pase.sql
echo "rol del pase (histórica) aplicado"
