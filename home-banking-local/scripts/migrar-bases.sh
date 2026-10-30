#!/bin/sh
# Aplica a las bases los cambios de esquema de una versión nueva (db/esquema, incluidos en la imagen en /opt/hb/esquema)
# y sincroniza logins y permisos con los secretos. Es idempotente: correrlo de más no cambia nada. Correrlo después de cada
# "docker compose pull" + "up -d". Una base nueva ya nace con el esquema completo.
set -eu
cd "$(dirname "$0")/.."
# Una sola fuente de verdad: los mismos pasos que corren solos en cada "up" (servicio db-init): crear las bases si faltan,
# migraciones pendientes (registradas en dbo.hb_migracion) y logins hb_app / hb_jobs / hb_pase / hb_pase_h / hb_hist_ro
# con su clave sincronizada con los secretos.
docker compose run --rm -T db-init
