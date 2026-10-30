#!/bin/sh
# Detiene el Home Banking. Los datos (base, usuarios, auditoría) se conservan para el próximo ./iniciar.sh.
#   ./detener.sh                  detiene
#   ./detener.sh --borrar-datos   detiene y BORRA la base de datos (pide confirmación; no se puede deshacer)
set -eu
cd "$(dirname "$0")"
ARCHIVOS="-f docker-compose.yml"
if [ "$(cat .modo 2>/dev/null)" = simulador ]; then ARCHIVOS="$ARCHIVOS -f docker-compose.sin-internet.yml"; fi
if [ "${1:-}" = --borrar-datos ]; then
  printf 'Se van a BORRAR la base de datos, los usuarios y la auditoría. Escribí BORRAR para confirmar: '
  read -r r
  [ "$r" = BORRAR ] || { echo "Cancelado."; exit 1; }
  # shellcheck disable=SC2086
  docker compose $ARCHIVOS down -v --remove-orphans
  echo "Detenido y datos borrados. La próxima vez se crea el administrador inicial de nuevo."
else
  # shellcheck disable=SC2086
  docker compose $ARCHIVOS down --remove-orphans
  echo "Detenido. Los datos se conservan."
fi
