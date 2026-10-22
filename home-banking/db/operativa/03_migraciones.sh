#!/bin/sh
# Base nueva: aplica también las migraciones (son idempotentes), así nace con el esquema completo.
set -e
for f in /migraciones/*.sql; do
  [ -f "$f" ] || continue
  psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done
