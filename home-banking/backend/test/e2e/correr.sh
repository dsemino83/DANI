#!/bin/sh
# Pruebas de autorización y de doble control / envío único de punta a punta. Para cada suite prepara
# las bases desde cero, (re)levanta el servidor real y corre la prueba contra él, con el mock de SSO y
# banco. Sale != 0 si alguna falla.
# Postgres: se toma de PGHOST/PGPORT/PGUSER/PGPASSWORD (por defecto localhost:5432, usuario postgres).
set -eu
AQUI=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)   # .../backend/test/e2e
BACKEND=$(CDPATH= cd -- "$AQUI/../.." && pwd)        # .../backend
DB=$(CDPATH= cd -- "$BACKEND/../db" && pwd)          # .../db
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432} PGUSER=${PGUSER:-postgres} PGPASSWORD=${PGPASSWORD:-postgres}
PSQL="psql -v ON_ERROR_STOP=1 -q"
TOKENS=$(mktemp)
MOCK_PORT=18080; PORT=18090
export MOCK_PORT PORT
MASTER=$(openssl rand -base64 32)

limpiar() { kill "${SRV_PID:-}" "${MOCK_PID:-}" 2>/dev/null || true; rm -f "$TOKENS"; }
trap limpiar EXIT

grant() { sed -n "/<<'SQL'/,/^SQL/p" "$1" | sed '1d;$d' | grep -v 'CREATE ROLE'; }
bases() {
  $PSQL -d postgres -c "DROP DATABASE IF EXISTS homebanking WITH (FORCE)" -c "DROP DATABASE IF EXISTS homebanking_hist WITH (FORCE)"
  $PSQL -d postgres -c "DROP ROLE IF EXISTS hb_app" -c "DROP ROLE IF EXISTS hb_hist_ro"
  $PSQL -d postgres -c "CREATE ROLE hb_app LOGIN PASSWORD 'apppass'" -c "CREATE ROLE hb_hist_ro LOGIN PASSWORD 'ropass'"
  $PSQL -d postgres -c "CREATE DATABASE homebanking" -c "CREATE DATABASE homebanking_hist"
  # Los GRANT salen del mismo script de init del repo (sin el CREATE ROLE, que ya hicimos arriba).
  $PSQL -d homebanking -f "$DB/operativa/01_esquema.sql" >/dev/null
  grant "$DB/operativa/02_roles.sh" | $PSQL -d homebanking
  for m in "$DB"/operativa/migraciones/*.sql; do $PSQL -d homebanking -f "$m" >/dev/null; done
  $PSQL -d homebanking_hist -f "$DB/historica/01_esquema.sql" >/dev/null
  grant "$DB/historica/02_roles.sh" | $PSQL -d homebanking_hist
}

echo "== Levantar mock (SSO + banco)"
node "$AQUI/mock.mjs" "$TOKENS" & MOCK_PID=$!
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$MOCK_PORT/realms/staff/protocol/openid-connect/certs" >/dev/null 2>&1 && break; sleep 0.5; done

# Cada suite: bases limpias + servidor nuevo (así una no contamina a la otra). El mock queda igual.
for suite in autorizacion envio-unico limites; do
  echo "== $suite: preparar bases"
  bases
  OIDC_ISSUER="http://127.0.0.1:$MOCK_PORT/realms/staff" \
  BDV_AMBIENTE=homo BDV_URL_HOMO="http://127.0.0.1:$MOCK_PORT/bdv" BDV_SOLO_CONSULTAS=false BDV_TIMEOUT_MS=5000 \
  DB_HOST="$PGHOST" DB_PORT="$PGPORT" DB_NAME=homebanking DB_USER=hb_app DB_PASSWORD=apppass \
  DBH_HOST="$PGHOST" DBH_PORT="$PGPORT" DBH_NAME=homebanking_hist DBH_USER=hb_hist_ro DBH_PASSWORD=ropass \
  CREDENCIALES_MASTER_KEY="$MASTER" LOG_LEVEL=warn PORT=$PORT \
  node "$BACKEND/src/server.js" & SRV_PID=$!
  for i in $(seq 1 40); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
  echo "== $suite: correr"
  PORT=$PORT MOCK_PORT=$MOCK_PORT node "$AQUI/$suite.mjs" "$TOKENS" || { CODE=$?; kill "$SRV_PID" 2>/dev/null || true; exit $CODE; }
  kill "$SRV_PID" 2>/dev/null || true; SRV_PID=; sleep 1   # liberar el puerto antes del próximo servidor
done
