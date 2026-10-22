#!/bin/sh
# Aplica a la base operativa los cambios de esquema de una versión nueva (db/operativa/migraciones, incluidos
# en la imagen en /migraciones). Son idempotentes: correrlo de más no cambia nada. Correrlo después de cada
# "docker compose pull" + "up -d". Una base nueva ya nace con el esquema completo.
set -eu
cd "$(dirname "$0")/.."
docker compose exec -T postgres sh -c '
  for f in /migraciones/*.sql; do
    [ -f "$f" ] || continue
    psql -v ON_ERROR_STOP=1 -q -U postgres -d homebanking -f "$f" || exit 1
    echo "migración aplicada: $(basename "$f")"
  done'
