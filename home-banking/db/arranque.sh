#!/bin/bash
# Arranca SQL Server con la clave de 'sa' tomada del Docker secret (la imagen oficial solo acepta la variable de entorno).
# 'sa' es el dueño: solo lo usan este servidor y db-init; la aplicación entra con roles de mínimo privilegio.
set -euo pipefail
export MSSQL_SA_PASSWORD="$(cat /run/secrets/db_owner_password)"
exec /opt/mssql/bin/sqlservr
