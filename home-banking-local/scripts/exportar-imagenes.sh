#!/bin/sh
# Para instalar en una máquina SIN INTERNET. Se corre en una PC CON internet (y Docker): compila las imágenes del
# Home Banking, descarga las de terceros y las guarda en un solo archivo, que se copia (pendrive, carpeta compartida)
# a la máquina de destino junto con esta carpeta. Allá: sh scripts/importar-imagenes.sh y después ./iniciar.sh
#   sh scripts/exportar-imagenes.sh            -> imagenes-home-banking.tar.gz
set -eu
cd "$(dirname "$0")/.."
ARCHIVOS="-f docker-compose.yml -f docker-compose.sin-internet.yml"
[ -f .env ] || cp .env.example .env
sh scripts/generar-secretos.sh >/dev/null   # compose valida que existan los archivos de secretos (no viajan en las imágenes)
echo "Compilando las imágenes del Home Banking..."
# shellcheck disable=SC2086
docker compose $ARCHIVOS build
docker pull axllent/mailpit:v1.20.5
IMAGENES=$(docker compose $ARCHIVOS config --images | sort -u)
echo "Guardando:"; echo "$IMAGENES" | sed 's/^/  /'
# shellcheck disable=SC2086
docker save $IMAGENES | gzip > imagenes-home-banking.tar.gz
echo "Listo: imagenes-home-banking.tar.gz ($(du -h imagenes-home-banking.tar.gz | cut -f1)). Copiarlo junto con esta carpeta a la máquina de destino."
echo "IMPORTANTE: no copiar la carpeta secrets/ ni .env de esta PC; la máquina de destino genera los suyos."
