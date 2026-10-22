#!/bin/sh
# Resguardo cifrado de las dos bases (operativa e histórica), con control de integridad y retención.
#   sh scripts/resguardo.sh                      → /var/backups/home-banking (o HB_RESGUARDO_DIR)
# Cada copia: pg_dump (formato custom) → cifrado AES-256 (clave en secrets/resguardo_clave.txt, que NO se monta en
# ningún contenedor) → HMAC-SHA256 del archivo cifrado (detecta cualquier alteración) → manifiesto con SHA-256.
# Las copias de más de HB_RESGUARDO_DIAS (30) se borran. Para copia fuera del servidor (recomendado, inmutable/WORM):
#   HB_RESGUARDO_COPIAR='rclone copy {dir} remoto:hb-resguardos'   ({dir} = carpeta de la copia)
# Restaurar o probar: sh scripts/restaurar-resguardo.sh <carpeta> [--probar]
set -eu
cd "$(dirname "$0")/.."
CLAVE=secrets/resguardo_clave.txt
[ -s "$CLAVE" ] || { echo "Falta $CLAVE: correr sh scripts/generar-secretos.sh" >&2; exit 1; }
BASE="${HB_RESGUARDO_DIR:-/var/backups/home-banking}"
DIAS="${HB_RESGUARDO_DIAS:-30}"
SELLO="$(date -u +%Y%m%dT%H%M%SZ)"
DIR="$BASE/$SELLO"
umask 077
mkdir -p "$DIR"

volcar() { # servicio base nombre
  docker compose exec -T "$1" pg_dump -U postgres -Fc --no-owner "$2" \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$CLAVE" > "$DIR/$3.dump.enc"
  openssl dgst -sha256 -hmac "$(cat "$CLAVE")" -r "$DIR/$3.dump.enc" | cut -d' ' -f1 > "$DIR/$3.hmac"
  echo "ok $3: $(wc -c < "$DIR/$3.dump.enc") bytes cifrados"
}
volcar postgres homebanking operativa
volcar postgres-historico homebanking_hist historica
( cd "$DIR" && sha256sum ./*.dump.enc > MANIFIESTO.sha256 )
printf 'creado=%s\nversion=%s\n' "$SELLO" "${HB_VERSION:-local}" > "$DIR/INFO"

if [ -n "${HB_RESGUARDO_COPIAR:-}" ]; then
  sh -c "$(printf '%s' "$HB_RESGUARDO_COPIAR" | sed "s#{dir}#$DIR#g")" && echo "copiado fuera del servidor"
fi
# Retención: borra carpetas de copias más viejas que DIAS (solo las con formato de sello)
find "$BASE" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -mtime +"$DIAS" -exec rm -rf {} + 2>/dev/null || true
echo "Resguardo en $DIR"
