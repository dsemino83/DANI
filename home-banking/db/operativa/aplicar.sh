#!/bin/sh
# Provisión idempotente de la base operativa, corre en CADA arranque del stack (servicio db-init) con el dueño
# (postgres) y termina. Así no depende de que alguien corra scripts/migrar-bases.sh ni del orden de arranque:
#  1) espera a la base real (el healthcheck puede pasar durante la inicialización, que solo escucha por socket);
#  2) crea el rol hb_jobs (servicio jobs) y hb_pase (pase mensual) si faltan y SIEMPRE sincroniza su clave con el secreto;
#  3) aplica las migraciones (idempotentes), que dan los permisos mínimos a esos roles.
# backend y jobs esperan a que termine bien. Las claves salen de los secretos, nunca de la línea de comandos.
set -eu
export PGHOST="${PGHOST:-postgres}" PGUSER=postgres PGPASSWORD="$(cat /run/secrets/db_owner_password)"
for i in $(seq 1 60); do psql -d homebanking -Atqc 'SELECT 1' >/dev/null 2>&1 && break; [ "$i" = 60 ] && { echo "db-init: la base no responde" >&2; exit 1; }; sleep 2; done
rol() { # nombre secreto
  psql -v ON_ERROR_STOP=1 -q -d homebanking -v r="$1" -v p="$(cat "/run/secrets/$2")" -f - <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'r', :'p') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'r') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'r', :'p') \gexec
SQL
  echo "rol $1 sincronizado"
}
rol hb_jobs db_jobs_app_password
rol hb_pase db_jobs_password
for f in /migraciones/*.sql; do
  [ -f "$f" ] || continue
  psql -v ON_ERROR_STOP=1 -q -d homebanking -f "$f"
  echo "migración aplicada: $(basename "$f")"
done
