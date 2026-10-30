#!/bin/bash
# Tarea de arranque (servicio db-init), en CADA arranque del stack y termina:
#  1) espera a SQL Server;
#  2) crea las bases homebanking (operativa) y homebanking_hist (histórica) si faltan;
#  3) aplica, una sola vez cada una y dentro de una transacción, las migraciones de esquema/<base>/NNN_*.sql
#     (queda registro en dbo.hb_migracion);
#  4) aplica permisos.sql de cada base: crea los logins y usuarios de mínimo privilegio si faltan y SIEMPRE sincroniza su
#     clave con el secreto (también en un volumen ya existente o si se rota la clave).
# backend y jobs esperan a que termine bien. Las claves salen de los secretos (variables de entorno del proceso), nunca de la
# línea de comandos.
set -euo pipefail
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
HOST="${DB_HOST:-sqlserver}"
export SQLCMDPASSWORD="$(cat /run/secrets/db_owner_password)"
q() { "$SQLCMD" -C -S "$HOST" -U sa -b -I "$@"; }

leer() { # variable secreto: valida que sea seguro incrustarla en el script SQL
  local v; v="$(cat "/run/secrets/$2")"
  [[ "$v" =~ ^[A-Za-z0-9+/=_.-]+$ ]] || { echo "db-init: el secreto $2 tiene caracteres no admitidos" >&2; exit 1; }
  export "$1=$v"
}
leer HB_APP_PASS      db_app_password
leer HB_JOBS_PASS     db_jobs_app_password
leer HB_PASE_PASS     db_jobs_password
leer HB_HIST_RO_PASS  db_hist_ro_password
leer HB_PASE_H_PASS   dbh_jobs_password

for i in $(seq 1 90); do q -Q "SELECT 1" >/dev/null 2>&1 && break; [ "$i" = 90 ] && { echo "db-init: SQL Server no responde" >&2; exit 1; }; sleep 2; done

crear_base() { # nombre
  q -Q "IF DB_ID(N'$1') IS NULL CREATE DATABASE [$1];"
  # Lecturas sin bloqueos compartidos (como el MVCC de Postgres): los bloqueos explícitos (UPDLOCK) siguen donde se piden
  q -Q "IF EXISTS (SELECT 1 FROM sys.databases WHERE name = N'$1' AND is_read_committed_snapshot_on = 0) ALTER DATABASE [$1] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;"
}

migrar() { # base carpeta
  local base="$1" dir="/opt/hb/esquema/$2"
  q -d "$base" -Q "IF OBJECT_ID(N'dbo.hb_migracion') IS NULL CREATE TABLE dbo.hb_migracion (archivo nvarchar(200) NOT NULL PRIMARY KEY, aplicada_en datetimeoffset(3) NOT NULL DEFAULT SYSDATETIMEOFFSET());"
  local f n tmp
  for f in "$dir"/[0-9]*.sql; do
    [ -f "$f" ] || continue
    n="$(basename "$f")"
    if [ "$(q -d "$base" -h -1 -W -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.hb_migracion WHERE archivo = N'$n'")" != "0" ]; then continue; fi
    tmp="$(mktemp)"
    { echo "SET XACT_ABORT ON;"; echo "BEGIN TRANSACTION;"; echo "GO"; cat "$f"; echo; echo "GO"
      echo "INSERT INTO dbo.hb_migracion (archivo) VALUES (N'$n');"; echo "COMMIT TRANSACTION;"; echo "GO"; } > "$tmp"
    q -d "$base" -i "$tmp"
    rm -f "$tmp"
    echo "migración aplicada: $2/$n"
  done
}

crear_base homebanking
crear_base homebanking_hist
migrar homebanking operativa
migrar homebanking_hist historica
q -i /opt/hb/esquema/operativa/permisos.sql
q -i /opt/hb/esquema/historica/permisos.sql
echo "roles de las bases sincronizados"
