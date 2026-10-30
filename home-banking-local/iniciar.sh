#!/bin/sh
# Inicia el Home Banking en esta máquina (Docker). Se puede correr las veces que haga falta: no borra datos.
#   ./iniciar.sh                  banco real: el servidor solo sale hacia el Banco de Valores (nadie entra desde internet)
#   ./iniciar.sh simulador        sin internet: simulador del banco con datos ficticios
#   ./iniciar.sh ... --reconstruir   vuelve a compilar las imágenes (después de actualizar el código)
set -eu
cd "$(dirname "$0")"
MODO=real; CONSTRUIR=
for a in "$@"; do
  case "$a" in
    simulador) MODO=simulador ;;
    real) MODO=real ;;
    --reconstruir) CONSTRUIR=--build ;;
    *) echo "Opción desconocida: $a (usar: simulador, real, --reconstruir)" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "Falta Docker: instalar Docker Desktop (Windows/Mac) o Docker Engine (Linux)." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker no está corriendo: abrir Docker Desktop (o 'sudo systemctl start docker') y volver a intentar." >&2; exit 1; }

sh scripts/generar-secretos.sh
[ -f .env ] || { cp .env.example .env; echo "creado .env (configuración; se puede editar)"; }
ARCHIVOS="-f docker-compose.yml"
if [ "$MODO" = simulador ]; then ARCHIVOS="$ARCHIVOS -f docker-compose.sin-internet.yml"; fi
echo "$MODO" > .modo   # detener.sh y scripts/usuarios.sh usan los mismos archivos

echo "Iniciando ($([ "$MODO" = simulador ] && echo 'SIN INTERNET, con el simulador del banco' || echo 'banco real'))... la primera vez tarda varios minutos."
# shellcheck disable=SC2086
docker compose $ARCHIVOS up -d $CONSTRUIR --remove-orphans
# Espera a los servicios permanentes (db-init es una tarea que termina: no se espera con --wait)
# shellcheck disable=SC2086
docker compose $ARCHIVOS up -d --no-deps --wait --wait-timeout 900 frontend jobs mailpit

PUERTO=$(sed -n 's/^HTTPS_PORT=//p' .env | tr -d '\r' | tail -1)
ESCUCHA=$(sed -n 's/^HB_ESCUCHA=//p' .env | tr -d '\r' | tail -1)
URL=https://localhost
if [ -n "$PUERTO" ] && [ "$PUERTO" != 443 ]; then URL="$URL:$PUERTO"; fi
echo
echo "================================================================"
echo " Home Banking listo:   $URL"
if [ "${ESCUCHA:-127.0.0.1}" = 127.0.0.1 ]; then echo " Acceso: solo desde esta máquina."; else echo " Acceso: red interna (HB_ESCUCHA=$ESCUCHA). No abrir el puerto hacia internet."; fi
echo " Correos de la aplicación (buzón local): http://localhost:8025"
echo
echo " Primer ingreso:  usuario admin"
echo "                  clave temporal: $(cat secrets/admin_inicial_password.txt)"
echo "                  (se cambia en el primer ingreso; después esta clave ya no sirve)"
echo " Olvido o bloqueo del administrador:  sh scripts/usuarios.sh restablecer admin"
if [ "$MODO" = simulador ]; then echo " Banco: SIMULADOR (datos ficticios). Volver al real: ./iniciar.sh"
else echo " Banco: real. Cargar la credencial API en 'Credenciales API' (usuario admin)."; fi
echo " Detener:  ./detener.sh"
echo "================================================================"
echo " El navegador va a advertir por el certificado autofirmado: es esperable en la red interna."
