#!/bin/sh
# Genera los secretos locales en ./secrets (no se suben al repositorio).
# En producción, reemplazar por los del gestor de secretos de VALO.
set -eu
cd "$(dirname "$0")/.."
mkdir -p secrets frontend/certs
gen() { [ -f "secrets/$1.txt" ] || { openssl rand -base64 "${2:-24}" | tr -d '\n' > "secrets/$1.txt"; echo "creado secrets/$1.txt"; }; }
gen db_owner_password
gen dbh_owner_password
gen db_app_password
gen db_hist_ro_password
gen credenciales_master_key 32
# Secret de la service account de Keycloak: en desarrollo coincide con keycloak/realm-staff-dev.json
[ -f secrets/keycloak_admin_client_secret.txt ] || printf 'dev-solo-local-cambiar' > secrets/keycloak_admin_client_secret.txt
# Permisos: la carpeta solo la abre el dueño (700). Los archivos quedan legibles (644) porque
# docker compose los monta tal cual dentro de los contenedores, que corren con otros usuarios
# (node, postgres); con 600 el backend y la inicialización de las bases no pueden leerlos.
chmod 700 secrets
chmod 644 secrets/*.txt
# Certificado autofirmado solo para desarrollo
if [ ! -f frontend/certs/tls.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" \
    -keyout frontend/certs/tls.key -out frontend/certs/tls.crt 2>/dev/null
  echo "creado certificado autofirmado en frontend/certs"
fi
