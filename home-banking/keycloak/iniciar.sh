#!/bin/bash
# Lee los secretos montados por docker compose y arranca Keycloak.
# - keycloak_bootstrap_password: clave del usuario "admin" de la consola maestra (solo la primera vez)
# - keycloak_admin_client_secret: secret de la service account home-banking-admin (el realm lo toma
#   del placeholder ${HB_ADMIN_CLIENT_SECRET} al importarse)
set -euo pipefail
if [ -f /run/secrets/keycloak_bootstrap_password ]; then
  export KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat /run/secrets/keycloak_bootstrap_password)"
fi
if [ -f /run/secrets/keycloak_admin_client_secret ]; then
  export HB_ADMIN_CLIENT_SECRET="$(cat /run/secrets/keycloak_admin_client_secret)"
fi
exec /opt/keycloak/bin/kc.sh "$@"
