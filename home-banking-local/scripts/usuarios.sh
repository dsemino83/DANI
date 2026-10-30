#!/bin/sh
# Usuarios del Home Banking desde la máquina (emergencias: el administrador olvidó la clave o quedó bloqueado).
#   sh scripts/usuarios.sh listar
#   sh scripts/usuarios.sh restablecer <usuario>           clave temporal nueva, habilitado y desbloqueado
#   sh scripts/usuarios.sh crear-admin <usuario> <email>   otro administrador de seguridad
# El día a día (altas, perfiles, roles, bloqueos, OTP) se hace en la aplicación: pestaña "Usuarios y permisos".
set -eu
cd "$(dirname "$0")/.."
docker compose -f docker-compose.yml exec -T backend node src/cli/usuarios.js "$@"
