#!/bin/sh
# Configura el correo saliente (SMTP) del Keycloak propio (perfil sso-local, realm "staff"). Lo usa
# "Enviar correo para cambiar la clave" en Usuarios y permisos. Se puede correr las veces que haga falta.
# Valores en .env:
#   HB_SMTP_HOST      servidor de correo; vacío = buzón de prueba Mailpit (perfil correo-prueba)
#   HB_SMTP_PORT      587 por defecto (1025 con Mailpit)
#   HB_SMTP_FROM      remitente, p. ej. homebanking@valo.ar
#   HB_SMTP_USUARIO   usuario del servidor de correo (vacío = sin autenticación)
#   HB_SMTP_STARTTLS  true por defecto (false con Mailpit)
# La clave del servidor de correo va en secrets/smtp_password.txt (nunca en .env).
set -eu
cd "$(dirname "$0")/.."
val() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
HOST=$(val HB_SMTP_HOST); FROM=$(val HB_SMTP_FROM); USUARIO=$(val HB_SMTP_USUARIO)
if [ -z "$HOST" ]; then
  HOST=mailpit; PORT=$(val HB_SMTP_PORT); PORT=${PORT:-1025}; STARTTLS=false
else
  PORT=$(val HB_SMTP_PORT); PORT=${PORT:-587}; STARTTLS=$(val HB_SMTP_STARTTLS); STARTTLS=${STARTTLS:-true}
fi
FROM=${FROM:-homebanking@valo.test}
CLAVE=""; [ -f secrets/smtp_password.txt ] && CLAVE=$(cat secrets/smtp_password.txt)
AUTH=false; [ -n "$USUARIO" ] && AUTH=true
command -v jq >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq jq >/dev/null; }
jq -n --arg host "$HOST" --arg port "$PORT" --arg from "$FROM" --arg starttls "$STARTTLS" --arg auth "$AUTH" --arg user "$USUARIO" --arg pass "$CLAVE" \
  '{smtpServer: ({host: $host, port: $port, from: $from, fromDisplayName: "Home Banking VALO", starttls: $starttls, ssl: "false", auth: $auth}
    + (if $auth == "true" then {user: $user, password: $pass} else {} end))}' |
COMPOSE_PROFILES=sso-local docker compose exec -T keycloak bash -c '
  /opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kcadm.config --server http://localhost:8080/auth --realm master \
    --user admin --password "$(cat /run/secrets/keycloak_bootstrap_password)" >/dev/null &&
  /opt/keycloak/bin/kcadm.sh update realms/staff --config /tmp/kcadm.config -f - && rm -f /tmp/kcadm.config'
echo "Correo saliente de Keycloak: ${HOST}:${PORT} (remitente ${FROM})"
