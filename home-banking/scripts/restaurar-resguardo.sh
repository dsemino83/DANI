#!/bin/sh
# Verifica (HMAC y SHA-256) y descifra un resguardo de scripts/resguardo.sh.
#   sh scripts/restaurar-resguardo.sh <carpeta> --probar    → restaura en bases temporales y cuenta tablas (no toca nada)
#   sh scripts/restaurar-resguardo.sh <carpeta> --restaurar → restaura sobre las bases reales (pide confirmar)
set -eu
cd "$(dirname "$0")/.."
DIR="${1:?Indicá la carpeta del resguardo}"; MODO="${2:---probar}"
CLAVE=secrets/resguardo_clave.txt
( cd "$DIR" && sha256sum -c MANIFIESTO.sha256 ) >/dev/null || { echo "MANIFIESTO: los archivos no coinciden" >&2; exit 2; }
for n in operativa historica; do
  [ "$(openssl dgst -sha256 -hmac "$(cat "$CLAVE")" -r "$DIR/$n.dump.enc" | cut -d' ' -f1)" = "$(cat "$DIR/$n.hmac")" ] \
    || { echo "$n: HMAC inválido (alterado o clave equivocada)" >&2; exit 2; }
done
echo "integridad OK (SHA-256 y HMAC)"
descifrar() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$CLAVE" -in "$DIR/$1.dump.enc"; }
restaurar() { # servicio base-destino nombre
  descifrar "$3" | docker compose exec -T "$1" pg_restore -U postgres --no-owner -d "$2" ${4:-}
}
case "$MODO" in
  --probar)
    for par in "postgres homebanking operativa" "postgres-historico homebanking_hist historica"; do
      set -- $par
      docker compose exec -T "$1" psql -U postgres -qc "DROP DATABASE IF EXISTS hb_prueba_restore" -c "CREATE DATABASE hb_prueba_restore"
      restaurar "$1" hb_prueba_restore "$3"
      echo "$3: $(docker compose exec -T "$1" psql -U postgres -d hb_prueba_restore -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'") tablas restauradas"
      # Una restauración "vacía" no es una prueba válida: tienen que estar las tablas centrales de la base
      [ "$(docker compose exec -T "$1" psql -U postgres -d hb_prueba_restore -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('transferencia', 'auditoria')")" = 2 ] \
        || { echo "$3: faltan tablas centrales (transferencia, auditoria) tras restaurar" >&2; docker compose exec -T "$1" psql -U postgres -qc "DROP DATABASE IF EXISTS hb_prueba_restore"; exit 4; }
      docker compose exec -T "$1" psql -U postgres -qc "DROP DATABASE hb_prueba_restore"
    done
    echo "prueba de restauración OK";;
  --restaurar)
    printf 'Esto REEMPLAZA los datos de las bases con el resguardo %s. Escribí RESTAURAR para seguir: ' "$DIR"; read -r ok
    [ "$ok" = RESTAURAR ] || { echo cancelado; exit 1; }
    restaurar postgres homebanking operativa "--clean --if-exists"
    restaurar postgres-historico homebanking_hist historica "--clean --if-exists"
    # El resguardo va --no-owner: se vuelve a dar la propiedad de las tablas del pase a hb_pase / hb_pase_h (idempotente).
    sh "$(dirname "$0")/migrar-bases.sh"
    echo "restaurado";;
  *) echo "modo: --probar o --restaurar" >&2; exit 1;;
esac
