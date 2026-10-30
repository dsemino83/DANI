# Detiene el Home Banking. Los datos (base, usuarios, auditoría) se conservan para el próximo iniciar.ps1.
#   powershell -ExecutionPolicy Bypass -File detener.ps1                detiene
#   powershell -ExecutionPolicy Bypass -File detener.ps1 -BorrarDatos   detiene y BORRA la base (pide confirmación)
param([switch]$BorrarDatos)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$archivos = @('-f', 'docker-compose.yml')
if ((Test-Path '.modo') -and ((Get-Content '.modo' -Raw).Trim() -eq 'simulador')) { $archivos += @('-f', 'docker-compose.sin-internet.yml') }
if ($BorrarDatos) {
  $r = Read-Host 'Se van a BORRAR la base de datos, los usuarios y la auditoría. Escribí BORRAR para confirmar'
  if ($r -ne 'BORRAR') { Write-Host 'Cancelado.'; exit 1 }
  docker compose @archivos down -v --remove-orphans
  Write-Host 'Detenido y datos borrados. La próxima vez se crea el administrador inicial de nuevo.'
} else {
  docker compose @archivos down --remove-orphans
  Write-Host 'Detenido. Los datos se conservan.'
}
