#!/bin/sh
# Genera los secretos locales en ./secrets (no se suben al repositorio).
# En producción, reemplazar por los del gestor de secretos de VALO.
set -eu
cd "$(dirname "$0")/.."
mkdir -p secrets frontend/certs
gen() { [ -f "secrets/$1.txt" ] || { openssl rand -base64 "${2:-24}" | tr -d '\n' > "secrets/$1.txt"; echo "creado secrets/$1.txt"; }; }
# Claves de SQL Server: la de sa (db_owner_password) tiene que cumplir la política de complejidad de SQL Server
# (mayúsculas, minúsculas, números y símbolos, 8+ caracteres): se agrega un sufijo fijo a la parte aleatoria.
genbd() { [ -f "secrets/$1.txt" ] || { { openssl rand -base64 24 | tr -d '\n='; printf 'Aa1_'; } > "secrets/$1.txt"; echo "creado secrets/$1.txt"; }; }
genbd db_owner_password   # login sa (solo lo usa db-init)
genbd db_app_password
genbd db_hist_ro_password
genbd db_jobs_app_password   # login hb_jobs (servicio jobs)
genbd db_jobs_password       # login hb_pase (pase mensual a la histórica)
genbd dbh_jobs_password      # login hb_pase_h
gen credenciales_master_key 32
# Clave temporal del primer administrador del Home Banking (usuario "admin"): se usa solo si la base no tiene
# usuarios y hay que cambiarla en el primer ingreso. Letras y números (cumple la política de claves).
[ -f secrets/admin_inicial_password.txt ] || { { openssl rand -base64 18 | tr -d '\n/+='; printf '7k'; } > secrets/admin_inicial_password.txt; echo "creado secrets/admin_inicial_password.txt"; }
# Clave de cifrado de los resguardos (scripts/resguardo.sh): no se monta en ningún contenedor.
# Guardarla también fuera del servidor: sin ella los resguardos no se pueden descifrar.
gen resguardo_clave 32
# Clave del servidor de correo (SMTP): se crea vacía; con un servidor real, escribirla acá (sin salto de línea)
[ -f secrets/smtp_password.txt ] || : > secrets/smtp_password.txt
# Idem para el SMTP de respaldo (HB_SMTP2_*): archivo vacío si no se usa; la clave NO va en el .env
[ -f secrets/smtp2_password.txt ] || : > secrets/smtp2_password.txt
# Permisos: la carpeta solo la abre el dueño (700). Los archivos quedan legibles (644) porque
# docker compose los monta tal cual dentro de los contenedores, que corren con otros usuarios
# (node, mssql); con 600 el backend y la inicialización de las bases no pueden leerlos.
chmod 700 secrets
chmod 644 secrets/*.txt
chmod 600 secrets/resguardo_clave.txt   # solo el dueño: no la usa ningún contenedor
# El certificado HTTPS lo genera el contenedor web al arrancar si frontend/certs está vacío (frontend/30-certificado.sh).
