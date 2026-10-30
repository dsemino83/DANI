#!/bin/sh
# Controles de la base sobre el stack levantado (los usa el CI y sirve para revisar una instalación):
#   sh scripts/verificar-bd.sh esquema | envios | migraciones | permisos | roles
set -eu
cd "$(dirname "$0")/.."
. scripts/sqlcmd.sh
chequear() { # descripción valor-esperado valor-obtenido
  [ "$3" = "$2" ] && echo "$1 OK" || { echo "$1: esperado $2, obtenido '$3'" >&2; exit 1; }
}
case "${1:?esquema | envios | migraciones | permisos | roles}" in
  esquema) chequear 'esquema' 3 "$(sql_valor "SELECT COUNT(*) FROM homebanking.sys.tables WHERE name IN (N'envio_banco', N'referencia_usada', N'credencial_api')")";;
  envios) chequear 'tablas de envíos programados y cola' 3 "$(sql_valor "SELECT COUNT(*) FROM homebanking.sys.tables WHERE name IN (N'programacion_envio', N'cola_envio', N'feriado')")";;
  migraciones) chequear 'migraciones (cada una aplicada una sola vez)' 1 "$(sql_valor "SELECT COUNT(*) FROM homebanking.dbo.hb_migracion WHERE archivo = N'001_esquema.sql'")"
               chequear 'historial de migraciones de la base histórica' 1 "$(sql_valor "SELECT COUNT(*) FROM homebanking_hist.dbo.hb_migracion WHERE archivo = N'001_esquema.sql'")";;
  permisos) # hb_app: UPDATE sí, DELETE no (empresa_cbu se da de baja, no se borra) y sin acceso a la cabeza de la cadena de auditoría
    chequear 'empresa_cbu: hb_app puede actualizar' 1 "$(sql_valor "USE homebanking; EXECUTE AS USER = N'hb_app'; SELECT HAS_PERMS_BY_NAME(N'dbo.empresa_cbu', N'OBJECT', N'UPDATE'); REVERT")"
    chequear 'empresa_cbu: hb_app NO puede borrar' 0 "$(sql_valor "USE homebanking; EXECUTE AS USER = N'hb_app'; SELECT HAS_PERMS_BY_NAME(N'dbo.empresa_cbu', N'OBJECT', N'DELETE'); REVERT")"
    chequear 'auditoria: hb_app NO puede modificar' 0 "$(sql_valor "USE homebanking; EXECUTE AS USER = N'hb_app'; SELECT HAS_PERMS_BY_NAME(N'dbo.auditoria', N'OBJECT', N'UPDATE'); REVERT")";;
  roles)
    chequear 'login hb_app' 1 "$(sql_valor "SELECT COUNT(*) FROM sys.server_principals WHERE name = N'hb_app'")"
    chequear 'login hb_hist_ro' 1 "$(sql_valor "SELECT COUNT(*) FROM sys.server_principals WHERE name = N'hb_hist_ro'")"
    chequear 'base histórica' 1 "$(sql_valor "SELECT COUNT(*) FROM sys.databases WHERE name = N'homebanking_hist'")";;
  *) echo "uso: verificar-bd.sh esquema | envios | migraciones | permisos | roles" >&2; exit 1;;
esac
