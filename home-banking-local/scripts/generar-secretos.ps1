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

# Claves de SQL Server: la de sa tiene que cumplir su política de complejidad (mayúsculas, minúsculas, números y símbolos)
function GenerarBd([string]$nombre) {
  $ruta = "secrets\$nombre.txt"
  if (Test-Path $ruta) { return }
  $buffer = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  Guardar $ruta (([Convert]::ToBase64String($buffer)).TrimEnd('=') + 'Aa1_')
  Write-Host "creado $ruta"
}
GenerarBd 'db_owner_password'   # login sa (solo lo usa db-init)
GenerarBd 'db_app_password'
GenerarBd 'db_hist_ro_password'
GenerarBd 'db_jobs_app_password'
GenerarBd 'db_jobs_password'
GenerarBd 'dbh_jobs_password'
Generar 'credenciales_master_key' 32
Generar 'resguardo_clave' 32   # cifrado de los resguardos (no se monta en contenedores)
# Clave temporal del primer administrador del Home Banking (usuario "admin"): se usa solo si la base no tiene
# usuarios y hay que cambiarla en el primer ingreso. Letras y números (cumple la política de claves).
if (-not (Test-Path 'secrets\admin_inicial_password.txt')) {
  $buffer = New-Object byte[] 18
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  Guardar 'secrets\admin_inicial_password.txt' ((([Convert]::ToBase64String($buffer)) -replace '[/+=]', '') + '7k')
  Write-Host 'creado secrets\admin_inicial_password.txt'
}
# Clave del servidor de correo (SMTP): se crea vacía; con un servidor real, escribirla en el archivo
if (-not (Test-Path 'secrets\smtp_password.txt')) { Guardar 'secrets\smtp_password.txt' '' }
if (-not (Test-Path 'secrets\smtp2_password.txt')) { Guardar 'secrets\smtp2_password.txt' '' }

# El certificado HTTPS lo genera el contenedor web al arrancar si frontend\certs está vacío.
Write-Host 'Listo.'
