# Usuarios del Home Banking desde la PC (emergencias: el administrador olvidó la clave o quedó bloqueado).
#   powershell -File scripts\usuarios.ps1 listar
#   powershell -File scripts\usuarios.ps1 restablecer <usuario>           clave temporal nueva, habilitado y desbloqueado
#   powershell -File scripts\usuarios.ps1 crear-admin <usuario> <email>   otro administrador de seguridad
# El día a día (altas, perfiles, roles, bloqueos, OTP) se hace en la aplicación: pestaña "Usuarios y permisos".
Set-Location (Join-Path $PSScriptRoot '..')
docker compose -f docker-compose.yml exec -T backend node src/cli/usuarios.js @args
