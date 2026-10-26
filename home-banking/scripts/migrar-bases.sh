#!/bin/sh
# Aplica a la base operativa los cambios de esquema de una versión nueva (db/operativa/migraciones, incluidos
# en la imagen en /migraciones). Son idempotentes: correrlo de más no cambia nada. Correrlo después de cada
# "docker compose pull" + "up -d". Una base nueva ya nace con el esquema completo.
# También crea/actualiza los roles del pase mensual (hb_pase / hb_pase_h) en bases ya existentes: el servicio
# jobs ya no usa el superusuario postgres. Sus claves salen de los secretos db_jobs_password / dbh_jobs_password.
set -eu
cd "$(dirname "$0")/.."
# Una sola fuente de verdad: los mismos pasos que corren solos en cada "up" (servicios db-init y dbh-init):
# roles hb_jobs / hb_pase / hb_pase_h con su clave sincronizada con los secretos y migraciones idempotentes.
docker compose run --rm -T db-init
docker compose run --rm -T dbh-init
