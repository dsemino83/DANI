#!/bin/sh
# Carga en esta máquina (sin internet) las imágenes guardadas con scripts/exportar-imagenes.sh. Después: ./iniciar.sh
#   sh scripts/importar-imagenes.sh [imagenes-home-banking.tar.gz]
set -eu
cd "$(dirname "$0")/.."
ARCHIVO=${1:-imagenes-home-banking.tar.gz}
[ -f "$ARCHIVO" ] || { echo "No encuentro $ARCHIVO (copiarlo a esta carpeta)" >&2; exit 1; }
gunzip -c "$ARCHIVO" | docker load
echo "Imágenes cargadas. Iniciar con: ./iniciar.sh  (o ./iniciar.sh simulador)"
