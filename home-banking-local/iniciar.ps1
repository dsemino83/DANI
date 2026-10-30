# Inicia el Home Banking en esta PC con Windows (Docker Desktop). Se puede correr las veces que haga falta: no borra datos.
#   powershell -ExecutionPolicy Bypass -File iniciar.ps1                 banco real (solo sale hacia el Banco de Valores)
#   powershell -ExecutionPolicy Bypass -File iniciar.ps1 simulador       sin internet: simulador del banco (datos ficticios)
#   ... iniciar.ps1 [simulador] -Reconstruir                             vuelve a compilar las imágenes
param([ValidateSet('real', 'simulador')][string]$Modo = 'real', [switch]$Reconstruir)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Falta Docker: instalar Docker Desktop.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker no está corriendo: abrir Docker Desktop y volver a intentar.' }

& (Join-Path $PSScriptRoot 'scripts\generar-secretos.ps1')
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host 'creado .env (configuración; se puede editar)' }
$archivos = @('-f', 'docker-compose.yml')
if ($Modo -eq 'simulador') { $archivos += @('-f', 'docker-compose.sin-internet.yml') }
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot '.modo'), $Modo)

Write-Host "Iniciando ($(if ($Modo -eq 'simulador') { 'SIN INTERNET, con el simulador del banco' } else { 'banco real' }))... la primera vez tarda varios minutos."
$extra = @('up', '-d', '--remove-orphans')
if ($Reconstruir) { $extra += '--build' }
docker compose @archivos @extra
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar. Ver el detalle con: docker compose logs' }
# Espera a los servicios permanentes (db-init es una tarea que termina: no se espera con --wait)
docker compose @archivos up -d --no-deps --wait --wait-timeout 900 frontend jobs mailpit
if ($LASTEXITCODE -ne 0) { throw 'Algún servicio no quedó funcionando. Ver el detalle con: docker compose logs' }

$envTxt = Get-Content '.env'
$puerto = ($envTxt | Where-Object { $_ -match '^HTTPS_PORT=' } | Select-Object -Last 1) -replace '^HTTPS_PORT=', ''
$escucha = ($envTxt | Where-Object { $_ -match '^HB_ESCUCHA=' } | Select-Object -Last 1) -replace '^HB_ESCUCHA=', ''
$url = if ($puerto -and $puerto -ne '443') { "https://localhost:$puerto" } else { 'https://localhost' }
Write-Host ''
Write-Host '================================================================'
Write-Host " Home Banking listo:   $url"
if (-not $escucha -or $escucha -eq '127.0.0.1') { Write-Host ' Acceso: solo desde esta PC.' } else { Write-Host " Acceso: red interna (HB_ESCUCHA=$escucha). No abrir el puerto hacia internet." }
Write-Host ' Correos de la aplicación (buzón local): http://localhost:8025'
Write-Host ''
Write-Host ' Primer ingreso:  usuario admin'
Write-Host "                  clave temporal: $(Get-Content 'secrets\admin_inicial_password.txt')"
Write-Host '                  (se cambia en el primer ingreso; después esta clave ya no sirve)'
Write-Host ' Olvido o bloqueo del administrador:  powershell -File scripts\usuarios.ps1 restablecer admin'
if ($Modo -eq 'simulador') { Write-Host ' Banco: SIMULADOR (datos ficticios). Volver al real: iniciar.ps1' } else { Write-Host " Banco: real. Cargar la credencial API en 'Credenciales API' (usuario admin)." }
Write-Host ' Detener:  powershell -File detener.ps1'
Write-Host '================================================================'
Write-Host ' El navegador va a advertir por el certificado autofirmado: es esperable en la red interna.'
