#!/bin/sh
# Verifica (HMAC y SHA-256) y descifra un resguardo de scripts/resguardo.sh.
#   sh scripts/restaurar-resguardo.sh <carpeta> --probar    → restaura en bases temporales y cuenta tablas (no toca nada)
#   sh scripts/restaurar-resguardo.sh <carpeta> --restaurar → restaura sobre las bases reales (pide confirmar)
set -eu
cd "$(dirname "$0")/.."
. scripts/sqlcmd.sh
DIR="${1:?Indicá la carpeta del resguardo}"; MODO="${2:---probar}"
CLAVE=secrets/resguardo_clave.txt
( cd "$DIR" && sha256sum -c MANIFIESTO.sha256 ) >/dev/null || { echo "MANIFIESTO: los archivos no coinciden" >&2; exit 2; }
for n in operativa historica; do
  [ "$(openssl dgst -sha256 -hmac "$(cat "$CLAVE")" -r "$DIR/$n.bak.enc" | cut -d' ' -f1)" = "$(cat "$DIR/$n.hmac")" ] \
    || { echo "$n: HMAC inválido (alterado o clave equivocada)" >&2; exit 2; }
done
echo "integridad OK (SHA-256 y HMAC)"
descifrar() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$CLAVE" -in "$DIR/$1.bak.enc"; }
# Restaura el backup en la base destino (los archivos de datos y de log llevan el nombre de la base destino).
# El backup descifrado vive solo un instante dentro del contenedor.
restaurar() { # nombre base-origen base-destino [reemplazar]
  bak="/var/opt/mssql/backup/restaurar_$1.bak"
  sql_contenedor "mkdir -p /var/opt/mssql/backup"
  descifrar "$1" | docker compose exec -T sqlserver sh -c "cat > '$bak'" || return 1
  if sql_exec "RESTORE DATABASE [$3] FROM DISK = N'$bak' WITH CHECKSUM, ${4:+REPLACE, }MOVE N'$2' TO N'/var/opt/mssql/data/$3.mdf', MOVE N'$2_log' TO N'/var/opt/mssql/data/$3_log.ldf'" >/dev/null; then
    sql_contenedor "rm -f '$bak'"
  else
    sql_contenedor "rm -f '$bak'"; return 1
  fi
}
case "$MODO" in
  --probar)
    for par in "operativa homebanking" "historica homebanking_hist"; do
      set -- $par
      sql_exec "IF DB_ID(N'hb_prueba_restore') IS NOT NULL DROP DATABASE hb_prueba_restore" >/dev/null
      restaurar "$1" "$2" hb_prueba_restore || { echo "$1: la restauración falló" >&2; sql_exec "IF DB_ID(N'hb_prueba_restore') IS NOT NULL DROP DATABASE hb_prueba_restore" >/dev/null || true; exit 4; }
      echo "$1: $(sql_valor "SELECT COUNT(*) FROM hb_prueba_restore.sys.tables") tablas restauradas"
      # Una restauración "vacía" no es una prueba válida: tienen que estar las tablas centrales de la base
      [ "$(sql_valor "SELECT COUNT(*) FROM hb_prueba_restore.sys.tables WHERE name IN (N'transferencia', N'auditoria')")" = 2 ] \
        || { echo "$1: faltan tablas centrales (transferencia, auditoria) tras restaurar" >&2; sql_exec "DROP DATABASE hb_prueba_restore" >/dev/null || true; exit 4; }
      sql_exec "DROP DATABASE hb_prueba_restore" >/dev/null
    done
    echo "prueba de restauración OK";;
  --restaurar)
    printf 'Esto REEMPLAZA los datos de las bases con el resguardo %s. Escribí RESTAURAR para seguir: ' "$DIR"; read -r ok
    [ "$ok" = RESTAURAR ] || { echo cancelado; exit 1; }
    # Con la aplicación detenida, para que nadie escriba durante la restauración
    docker compose stop backend jobs >/dev/null 2>&1 || true
    for par in "operativa homebanking" "historica homebanking_hist"; do
      set -- $par
      sql_exec "IF DB_ID(N'$2') IS NOT NULL ALTER DATABASE [$2] SET SINGLE_USER WITH ROLLBACK IMMEDIATE" >/dev/null
      restaurar "$1" "$2" "$2" si || { echo "$1: la restauración falló" >&2; sql_exec "ALTER DATABASE [$2] SET MULTI_USER" >/dev/null || true; exit 4; }
      sql_exec "ALTER DATABASE [$2] SET MULTI_USER" >/dev/null
    done
    # Vuelve a sincronizar logins y permisos (en una instancia nueva los usuarios de la base quedan huérfanos hasta esto) y arranca todo.
    sh "$(dirname "$0")/migrar-bases.sh"
    docker compose up -d backend jobs >/dev/null
    echo "restaurado";;
  *) echo "modo: --probar o --restaurar" >&2; exit 1;;
esac
