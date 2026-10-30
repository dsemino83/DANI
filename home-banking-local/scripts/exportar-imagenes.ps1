# Para instalar en una PC SIN INTERNET (versión Windows). Se corre en una PC CON internet y Docker Desktop: compila las
# imágenes, descarga las de terceros y las guarda en imagenes-home-banking.tar. Copiar ese archivo y esta carpeta
# (sin secrets\ ni .env) a la PC de destino y ahí: powershell -File scripts\importar-imagenes.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$archivos = @('-f', 'docker-compose.yml', '-f', 'docker-compose.sin-internet.yml')
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
& (Join-Path $PSScriptRoot 'generar-secretos.ps1') | Out-Null
Write-Host 'Compilando las imágenes del Home Banking...'
docker compose @archivos build
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación' }
docker pull axllent/mailpit:v1.20.5
$imagenes = docker compose @archivos config --images | Sort-Object -Unique
Write-Host 'Guardando:'; $imagenes | ForEach-Object { Write-Host "  $_" }
docker save -o imagenes-home-banking.tar @imagenes
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron guardar las imágenes' }
Write-Host 'Listo: imagenes-home-banking.tar. Copiarlo junto con esta carpeta a la PC de destino (sin secrets\ ni .env).'
