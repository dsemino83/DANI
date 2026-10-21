#!/bin/sh
# hb_hist_ro: la aplicación solo lee la base histórica.
set -eu
RO_PASS="$(cat /run/secrets/db_hist_ro_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ro_pass="$RO_PASS" <<'SQL'
CREATE ROLE hb_hist_ro LOGIN PASSWORD :'ro_pass';
GRANT USAGE ON SCHEMA public TO hb_hist_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hb_hist_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO hb_hist_ro;
SQL
