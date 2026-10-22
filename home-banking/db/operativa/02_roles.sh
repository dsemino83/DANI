#!/bin/sh
# Crea el usuario de la aplicación (hb_app) con permisos mínimos.
# La clave sale del Docker secret; nunca queda en el repositorio.
set -eu
APP_PASS="$(cat /run/secrets/db_app_password)"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_pass="$APP_PASS" <<'SQL'
CREATE ROLE hb_app LOGIN PASSWORD :'app_pass';
GRANT USAGE ON SCHEMA public TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON empresa, permiso_empresa, cartera_oficial, credencial_api,
      lote, lote_fila, debito_transferencia TO hb_app;
GRANT SELECT, INSERT, UPDATE ON transferencia TO hb_app;          -- sin DELETE
GRANT SELECT, INSERT, UPDATE ON empresa_cbu TO hb_app;            -- sin DELETE: quitar una cuenta es pasarla a baja
GRANT SELECT, INSERT ON transferencia_estado, auditoria, envio_banco, referencia_usada TO hb_app; -- solo inserción
GRANT SELECT ON pase_historico TO hb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hb_app;
-- Las particiones nuevas heredan los permisos de la tabla madre al consultarse por ella.
SQL
