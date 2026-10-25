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
gen db_jobs_password     # rol hb_pase (pase mensual a la histórica)
gen dbh_jobs_password    # rol hb_pase_h
gen credenciales_master_key 32
# Keycloak: secret de la service account home-banking-admin (el Keycloak propio lo toma de acá;
# con el SSO de VALO, reemplazarlo por el que entregue Identidad) y clave inicial de la consola maestra.
gen keycloak_admin_client_secret 32
gen keycloak_bootstrap_password
# Clave de cifrado de los resguardos (scripts/resguardo.sh): no se monta en ningún contenedor.
# Guardarla también fuera del servidor: sin ella los resguardos no se pueden descifrar.
gen resguardo_clave 32
# Clave del servidor de correo (SMTP): se crea vacía; con un servidor real, escribirla acá (sin salto de línea)
[ -f secrets/smtp_password.txt ] || : > secrets/smtp_password.txt
# Idem para el SMTP de respaldo (HB_SMTP2_*): archivo vacío si no se usa; la clave NO va en el .env
[ -f secrets/smtp2_password.txt ] || : > secrets/smtp2_password.txt
# Permisos: la carpeta solo la abre el dueño (700). Los archivos quedan legibles (644) porque
# docker compose los monta tal cual dentro de los contenedores, que corren con otros usuarios
# (node, postgres); con 600 el backend y la inicialización de las bases no pueden leerlos.
chmod 700 secrets
chmod 644 secrets/*.txt
chmod 600 secrets/resguardo_clave.txt   # solo el dueño: no la usa ningún contenedor
# Certificado autofirmado solo para desarrollo
if [ ! -f frontend/certs/tls.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" \
    -keyout frontend/certs/tls.key -out frontend/certs/tls.crt 2>/dev/null
  echo "creado certificado autofirmado en frontend/certs"
fi
