#!/bin/sh
# Pruebas de autorización y de doble control / envío único de punta a punta. Para cada suite prepara
# las bases desde cero, (re)levanta el servidor real y corre la prueba contra él, con el mock de SSO y
# banco. Sale != 0 si alguna falla.
# SQL Server: se toma de MSSQL_HOST/MSSQL_PORT/MSSQL_SA_PASSWORD (por defecto localhost:1433; la clave de sa es obligatoria).
set -eu
AQUI=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)   # .../backend/test/e2e
BACKEND=$(CDPATH= cd -- "$AQUI/../.." && pwd)        # .../backend
export MSSQL_HOST=${MSSQL_HOST:-localhost} MSSQL_PORT=${MSSQL_PORT:-1433}
: "${MSSQL_SA_PASSWORD:?Falta MSSQL_SA_PASSWORD (clave de sa de la instancia de prueba)}"
export HB_APP_PASS=apppass-Aa1 HB_JOBS_PASS=jobspass-Aa1 HB_HIST_RO_PASS=ropass-Aa1 HB_PASE_PASS=pasepass-Aa1 HB_PASE_H_PASS=pasehpass-Aa1
TOKENS=$(mktemp)
MOCK_PORT=18080; PORT=18090
export MOCK_PORT PORT
MASTER=$(openssl rand -base64 32)

limpiar() { kill "${SRV_PID:-}" "${MOCK_PID:-}" 2>/dev/null || true; rm -f "$TOKENS"; }
trap limpiar EXIT

bases() { node "$AQUI/preparar-bases.mjs"; }

echo "== Levantar mock (SSO + banco)"
node "$AQUI/mock.mjs" "$TOKENS" & MOCK_PID=$!
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$MOCK_PORT/realms/staff/protocol/openid-connect/certs" >/dev/null 2>&1 && break; sleep 0.5; done

# Entorno del backend, compartido por el servidor y por las suites que disparan el motor de pagos
# (test/e2e/motor.mjs importa los servicios del backend y necesita las mismas variables).
export OIDC_ISSUER="http://127.0.0.1:$MOCK_PORT/realms/staff"
export BDV_AMBIENTE=homo BDV_URL_HOMO="http://127.0.0.1:$MOCK_PORT/bdv" BDV_SOLO_CONSULTAS=false BDV_TIMEOUT_MS=5000
export DB_HOST="$MSSQL_HOST" DB_PORT="$MSSQL_PORT" DB_NAME=homebanking DB_USER=hb_app DB_PASSWORD="$HB_APP_PASS" DB_TRUST_SERVER_CERT=true
export DBH_HOST="$MSSQL_HOST" DBH_PORT="$MSSQL_PORT" DBH_NAME=homebanking_hist DBH_USER=hb_hist_ro DBH_PASSWORD="$HB_HIST_RO_PASS"
export CREDENCIALES_MASTER_KEY="$MASTER" BACKEND="$BACKEND"

# Cada suite: bases limpias + servidor nuevo (así una no contamina a la otra). El mock queda igual.
for suite in autorizacion envio-unico limites; do
  echo "== $suite: preparar bases"
  bases
  LOG_LEVEL=warn PORT=$PORT node "$BACKEND/src/server.js" & SRV_PID=$!
  for i in $(seq 1 40); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
  echo "== $suite: correr"
  PORT=$PORT MOCK_PORT=$MOCK_PORT node "$AQUI/$suite.mjs" "$TOKENS" || { CODE=$?; kill "$SRV_PID" 2>/dev/null || true; exit $CODE; }
  kill "$SRV_PID" 2>/dev/null || true; SRV_PID=; sleep 1   # liberar el puerto antes del próximo servidor
done

# Pase a la base histórica y cadena de la auditoría (sin servidor: usa los servicios del backend directamente)
echo "== pase: preparar bases"
bases
echo "== pase: correr"
node "$AQUI/pase.mjs"
