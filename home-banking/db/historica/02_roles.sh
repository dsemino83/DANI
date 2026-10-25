#!/bin/sh
# hb_hist_ro: la aplicación solo lee la base histórica.
set -eu
RO_PASS="$(cat /run/secrets/db_hist_ro_password)"
JOBS_PASS="$(cat /run/secrets/dbh_jobs_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ro_pass="$RO_PASS" -v jobs_pass="$JOBS_PASS" <<'SQL'
CREATE ROLE hb_hist_ro LOGIN PASSWORD :'ro_pass';
CREATE ROLE hb_pase_h LOGIN PASSWORD :'jobs_pass';   -- pase mensual (job); permisos en rol-pase.sql (corre a continuación)
GRANT USAGE ON SCHEMA public TO hb_hist_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hb_hist_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO hb_hist_ro;
SQL
