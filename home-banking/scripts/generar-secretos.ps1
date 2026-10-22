# Genera los secretos locales en .\secrets y un certificado autofirmado (versión Windows / PowerShell).
# Hace lo mismo que generar-secretos.sh. Los archivos no se suben al repositorio.
# Uso, desde la carpeta home-banking:
#   powershell -ExecutionPolicy Bypass -File scripts\generar-secretos.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force -Path 'secrets', 'frontend\certs' | Out-Null

function Guardar([string]$ruta, [string]$texto) {
  # sin BOM y sin salto de línea final: los contenedores leen el archivo tal cual
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $ruta), $texto, (New-Object System.Text.UTF8Encoding($false)))
}

function Generar([string]$nombre, [int]$bytes = 24) {
  $ruta = "secrets\$nombre.txt"
  if (Test-Path $ruta) { return }
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  Guardar $ruta ([Convert]::ToBase64String($buffer))
  Write-Host "creado $ruta"
}

Generar 'db_owner_password'
Generar 'dbh_owner_password'
Generar 'db_app_password'
Generar 'db_hist_ro_password'
Generar 'credenciales_master_key' 32
Generar 'resguardo_clave' 32   # cifrado de los resguardos (no se monta en contenedores)
# Keycloak: secret de la service account home-banking-admin (el Keycloak propio lo toma de acá;
# con el SSO de VALO, reemplazarlo por el que entregue Identidad) y clave inicial de la consola maestra.
Generar 'keycloak_admin_client_secret' 32
Generar 'keycloak_bootstrap_password'
# Clave del servidor de correo (SMTP): se crea vacía; con un servidor real, escribirla en el archivo
if (-not (Test-Path 'secrets\smtp_password.txt')) { Guardar 'secrets\smtp_password.txt' '' }

# Certificado autofirmado solo para desarrollo: se genera con openssl dentro de un contenedor
if (-not (Test-Path 'frontend\certs\tls.crt')) {
  $certs = (Resolve-Path 'frontend\certs').Path
  docker run --rm -v "${certs}:/certs" alpine:3.20 sh -c "apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj /CN=localhost -keyout /certs/tls.key -out /certs/tls.crt 2>/dev/null"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el certificado: ¿Docker está abierto?' }
  Write-Host 'creado certificado autofirmado en frontend\certs'
}
Write-Host 'Listo.'
