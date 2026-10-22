#!/bin/sh
# Genera /config.json para la SPA a partir de variables de entorno (una imagen para todos los ambientes).
set -eu
: "${OIDC_ISSUER:?Falta OIDC_ISSUER}"
cat > /usr/share/nginx/html/config.json <<EOF
{
  "oidcIssuer": "${OIDC_ISSUER}",
  "oidcClientId": "${OIDC_CLIENT_ID:-home-banking-web}"
}
EOF
