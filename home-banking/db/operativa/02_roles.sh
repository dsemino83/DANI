#!/bin/sh
# Crea el usuario de la aplicación (hb_app) con permisos mínimos.
# La clave sale del Docker secret; nunca queda en el repositorio.
set -eu
APP_PASS="$(cat /run/secrets/db_app_password)"
JOBS_PASS="$(cat /run/secrets/db_jobs_password)"
JOBSAPP_PASS="$(cat /run/secrets/db_jobs_app_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_pass="$APP_PASS" -v jobs_pass="$JOBS_PASS" -v jobsapp_pass="$JOBSAPP_PASS" <<'SQL'
CREATE ROLE hb_app LOGIN PASSWORD :'app_pass';
CREATE ROLE hb_jobs LOGIN PASSWORD :'jobsapp_pass';   -- servicio jobs (programador); permisos en migraciones/018_rol_jobs.sql
CREATE ROLE hb_pase LOGIN PASSWORD :'jobs_pass';   -- pase mensual (job); permisos en migraciones/017_rol_pase.sql
GRANT USAGE ON SCHEMA public TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON empresa, permiso_empresa, cartera_oficial, oficial_chat, credencial_api,
      lote, lote_fila, debito_transferencia TO hb_app;
GRANT SELECT, INSERT, UPDATE ON transferencia TO hb_app;          -- sin DELETE
GRANT SELECT, INSERT, UPDATE ON empresa_cbu TO hb_app;            -- sin DELETE: quitar una cuenta es pasarla a baja
GRANT SELECT, INSERT ON transferencia_estado, auditoria, envio_banco, referencia_usada TO hb_app; -- solo inserción
GRANT SELECT ON pase_historico TO hb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hb_app;
-- Las particiones nuevas heredan los permisos de la tabla madre al consultarse por ella.
SQL
