#!/bin/sh
# Si no hay certificado en /etc/nginx/certs (carpeta frontend/certs), genera uno autofirmado válido para localhost,
# 127.0.0.1 y HB_NOMBRE_SERVIDOR (nombre o IP con que entran las otras PCs de la red, si se configura).
# Para que el navegador no muestre la advertencia, poner ahí tls.crt y tls.key emitidos por la CA interna de VALO.
set -eu
D=/etc/nginx/certs
[ -s "$D/tls.crt" ] && [ -s "$D/tls.key" ] && exit 0
SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "${HB_NOMBRE_SERVIDOR:-}" ]; then
  case "$HB_NOMBRE_SERVIDOR" in
    *[!0-9.]*) SAN="$SAN,DNS:$HB_NOMBRE_SERVIDOR" ;;
    *) SAN="$SAN,IP:$HB_NOMBRE_SERVIDOR" ;;
  esac
fi
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=${HB_NOMBRE_SERVIDOR:-localhost}" -addext "subjectAltName=$SAN" \
  -keyout "$D/tls.key" -out "$D/tls.crt" 2>/dev/null
chmod 644 "$D/tls.crt"; chmod 600 "$D/tls.key"
echo "certificado autofirmado creado ($SAN)"
