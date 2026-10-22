#!/bin/sh
# Apunta el Keycloak propio (perfil sso-local) a la dirección pública con la que entran los usuarios,
# por ejemplo https://ealyc.valo.ar: actualiza las URLs permitidas del cliente home-banking-web.
# Toma HB_URL_PUBLICA del entorno o de .env. Después de cambiar HB_URL_PUBLICA (y OIDC_ISSUER / OIDC_ORIGIN)
# en .env: docker compose --profile sso-local up -d  y  sh scripts/configurar-dominio.sh
set -eu
cd "$(dirname "$0")/.."
URL=${HB_URL_PUBLICA:-$(grep -E '^HB_URL_PUBLICA=' .env 2>/dev/null | tail -1 | cut -d= -f2-)}
URL=${URL%/}
case "$URL" in https://*) ;; *) echo "HB_URL_PUBLICA tiene que empezar con https:// (vale: '$URL')" >&2; exit 1 ;; esac
COMPOSE_PROFILES=sso-local docker compose exec -T -e URL="$URL" keycloak bash -c '
  K=/opt/keycloak/bin/kcadm.sh; C="--config /tmp/kcadm-dominio.config"
  $K config credentials $C --server http://localhost:8080/auth --realm master --user admin --password "$(cat /run/secrets/keycloak_bootstrap_password)" >/dev/null
  ID=$($K get clients -r staff $C -q clientId=home-banking-web --fields id --format csv --noquotes)
  printf "{\"rootUrl\":\"%s\",\"redirectUris\":[\"%s/*\"],\"webOrigins\":[\"%s\"],\"attributes\":{\"pkce.code.challenge.method\":\"S256\",\"post.logout.redirect.uris\":\"%s/*\"}}" "$URL" "$URL" "$URL" "$URL" |
    $K update "clients/$ID" -r staff $C -f -
  rm -f /tmp/kcadm-dominio.config'
echo "Keycloak: cliente home-banking-web habilitado para ${URL}"
