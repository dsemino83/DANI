#!/bin/bash
# Levanta (o actualiza) el Home Banking completo en una máquina de prueba con Docker, más Portainer
# para manejarlo desde el navegador. Lo corre solo el Codespace al arrancar; volver a correrlo
# actualiza a la última versión publicada. Uso (desde cualquier carpeta): hb-actualizar
#   o bien: bash /workspaces/DANI/home-banking/scripts/maquina-prueba.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RAMA_HB=${HB_RAMA:-ALYC}

# En el Codespace: el código tiene que ser el de la rama del Home Banking y estar al día, para que la
# configuración (compose, scripts, migraciones) coincida con las imágenes que se descargan.
if [ -n "${CODESPACE_NAME:-}" ] && [ -z "${HB_YA_ACTUALIZADO:-}" ]; then
  rama=$(git rev-parse --abbrev-ref HEAD)
  if [ "$rama" != "$RAMA_HB" ]; then
    echo "El Codespace está en la rama '$rama' y el Home Banking está en '$RAMA_HB'. Cambiando de rama..."
    if ! git checkout -q "$RAMA_HB"; then
      echo "No se pudo cambiar a '$RAMA_HB' (hay cambios sin guardar en '$rama'). Revisalos con 'git status' y volvé a correr hb-actualizar." >&2
      exit 1
    fi
  fi
  antes=$(git rev-parse HEAD)
  git pull -q --ff-only origin "$RAMA_HB" || echo "Aviso: no se pudo traer la última versión del código (se sigue con la actual)." >&2
  # Atajo para correr este script desde cualquier carpeta
  grep -q 'alias hb-actualizar=' ~/.bashrc 2>/dev/null || echo "alias hb-actualizar='bash $PWD/scripts/maquina-prueba.sh'" >> ~/.bashrc
  # Si el código cambió, vuelve a empezar con la versión nueva de este mismo script
  if [ "$(git rev-parse HEAD)" != "$antes" ]; then HB_YA_ACTUALIZADO=1 exec bash "$PWD/scripts/maquina-prueba.sh" "$@"; fi
fi

# Dirección pública: en un Codespace, la del puerto 443 reenviado; si no, HB_URL_PUBLICA o localhost.
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-443.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  PANEL="https://${CODESPACE_NAME}-9443.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  CORREO="https://${CODESPACE_NAME}-8025.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  URL="${HB_URL_PUBLICA:-https://localhost}"
  PANEL="https://localhost:9443"
  CORREO="http://localhost:8025"
fi
# Keycloak propio + buzón de correo de prueba (Mailpit) para los avisos de cambio de clave
PERFILES="--profile sso-local --profile correo-prueba"

echo "Esperando a Docker..."
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null

command -v openssl >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq openssl >/dev/null; }
sh scripts/generar-secretos.sh
[ -f secrets/portainer_admin_password.txt ] || { openssl rand -base64 24 | tr -d '\n' > secrets/portainer_admin_password.txt; chmod 644 secrets/portainer_admin_password.txt; }

# .env: se crea una sola vez (los cambios que se hagan después se conservan).
if [ ! -f .env ]; then
  cat > .env <<EOT
# Generado por scripts/maquina-prueba.sh. Banco en producción y solo consultas: no se envían transferencias.
BDV_AMBIENTE=prod
BDV_SOLO_CONSULTAS=true
HB_URL_PUBLICA=${URL}
OIDC_ISSUER=${URL}/auth/realms/staff
OIDC_INTERNAL_URL=http://keycloak:8080/auth/realms/staff
OIDC_ORIGIN=${URL}
OIDC_CLIENT_ID=home-banking-web
OIDC_AUDIENCE=home-banking-api
OIDC_ROLES_CLIENT=home-banking-api
KEYCLOAK_ADMIN_CLIENT_ID=home-banking-admin
HTTPS_PORT=443
EOT
  echo "creado .env"
fi

# Imágenes: las publicadas en Docker Hub si hay credenciales; si no, se compilan acá.
if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin >/dev/null
  export HB_IMAGEN="docker.io/${DOCKERHUB_USERNAME}/home-banking-valo" HB_VERSION="${HB_VERSION:-alyc}"
  echo "Descargando ${HB_IMAGEN} (${HB_VERSION})..."
  docker compose $PERFILES pull
  docker compose $PERFILES up -d --no-build --wait --wait-timeout 300
else
  echo "Sin DOCKERHUB_USERNAME/DOCKERHUB_TOKEN: se compilan las imágenes desde el código."
  docker compose $PERFILES up -d --build --wait --wait-timeout 600
fi

# Cambios de esquema de la versión nueva (idempotentes)
sh scripts/migrar-bases.sh

# Correo saliente de Keycloak (Mailpit, o el servidor real si HB_SMTP_HOST está en .env)
for i in $(seq 1 30); do sh scripts/configurar-correo.sh && break; [ "$i" = 30 ] && exit 1; sleep 5; done

# URLs permitidas del login (por si cambió la dirección pública)
sh scripts/configurar-dominio.sh

# Portainer: panel web para ver, reiniciar, actualizar y leer los logs de los contenedores.
if ! docker container inspect portainer >/dev/null 2>&1; then
  docker run -d --name portainer --restart=always -p 9443:9443 \
    -v /var/run/docker.sock:/var/run/docker.sock -v portainer_datos:/data \
    -v "$PWD/secrets/portainer_admin_password.txt:/run/secrets/portainer:ro" \
    portainer/portainer-ce:2.21.4 --admin-password-file /run/secrets/portainer >/dev/null
else
  docker start portainer >/dev/null
fi

URL_APP=$(grep '^HB_URL_PUBLICA=' .env | cut -d= -f2-)
cat <<EOT

Listo.
  Home Banking: ${URL_APP}   (usuario admin.ti, clave Dev-admin-ti-1; pide cambiarla)
  Portainer:    ${PANEL}   (usuario admin, clave en home-banking/secrets/portainer_admin_password.txt)
  Correo de prueba: ${CORREO}   (los correos de cambio de clave que manda el Home Banking)
Para actualizar a la última versión: bash home-banking/scripts/maquina-prueba.sh
EOT
