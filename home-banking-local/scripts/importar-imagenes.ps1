# Carga en esta PC (sin internet) las imágenes guardadas con exportar-imagenes (.ps1 o .sh). Después: iniciar.ps1
#   powershell -File scripts\importar-imagenes.ps1 [imagenes-home-banking.tar | imagenes-home-banking.tar.gz]
param([string]$Archivo = '')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not $Archivo) { $Archivo = @('imagenes-home-banking.tar', 'imagenes-home-banking.tar.gz') | Where-Object { Test-Path $_ } | Select-Object -First 1 }
if (-not $Archivo -or -not (Test-Path $Archivo)) { throw 'No encuentro imagenes-home-banking.tar (copiarlo a esta carpeta)' }
docker load -i $Archivo   # docker load acepta el .tar y también el .tar.gz
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron cargar las imágenes' }
Write-Host 'Imágenes cargadas. Iniciar con: powershell -File iniciar.ps1  (o iniciar.ps1 simulador)'
