# Home Banking VALO · instalación local (sin SSO, sin exposición a internet)

Todo corre en **una máquina de la red interna** con Docker. Nadie puede entrar desde internet, y los usuarios no
dependen de Keycloak ni de ningún SSO: viven en la base de datos y se administran desde la propia aplicación.

| | |
| --- | --- |
| Quién entra | Por defecto, **solo esa máquina** (`https://localhost`). Opcional: las PCs de la red interna |
| Usuarios | Propios del Home Banking: alta, perfiles, roles, bloqueos, claves y OTP en **Usuarios y permisos** |
| Banco | **Real** (el servidor solo *sale* hacia el Banco de Valores) o **simulador** (sin internet, datos ficticios) |
| Correo | Buzón local en `http://localhost:8025` o el servidor de correo interno de VALO |

## 1. Requisitos

- **Windows 10/11 o Mac:** [Docker Desktop](https://www.docker.com/products/docker-desktop/). **Linux:** Docker Engine con el plugin compose.
- 4 GB de RAM libres para Docker (SQL Server pide 2 GB) y 15 GB de disco.

## 2. Iniciar

Desde esta carpeta (`home-banking-local`):

| | Linux / Mac | Windows (PowerShell) |
| --- | --- | --- |
| Con el banco real | `./iniciar.sh` | `powershell -ExecutionPolicy Bypass -File iniciar.ps1` |
| Sin internet (simulador) | `./iniciar.sh simulador` | `powershell -ExecutionPolicy Bypass -File iniciar.ps1 simulador` |
| Detener (conserva los datos) | `./detener.sh` | `powershell -File detener.ps1` |

La primera vez tarda varios minutos (compila las imágenes y crea la base). Al terminar muestra la dirección y la
**clave temporal del usuario `admin`**, que también queda en `secrets/admin_inicial_password.txt`.

1. Abrí `https://localhost`. El navegador advierte por el certificado autofirmado: es esperable (ver punto 6).
2. Ingresá con `admin` y la clave temporal. Te pide elegir una clave nueva: desde ahí la temporal ya no sirve.
3. En **Usuarios y permisos** dá de alta a las personas (cada una recibe una clave temporal que cambia en su primer ingreso).
4. Con el banco real: en **Credenciales API** cargá la credencial del Banco de Valores. Con el simulador ya viene cargada.
   Si pasás del simulador al banco real, reemplazá ahí la credencial de homologación (la del simulador no sirve con el banco).
5. En **Empresas** creá las empresas y asignales cuentas; en **Usuarios y permisos**, los permisos Ver/Operar por empresa.

## 3. Usuarios (sin Keycloak)

Todo desde la pestaña **Usuarios y permisos** (perfil administrador):

- **Alta** con clave temporal: el usuario la cambia en su primer ingreso. Mínimo 12 caracteres, con letras y números.
- **Perfil** (operador, autorizante, auditor, administrador) y roles **Crear / Aprobar** transferencias. El administrador nunca opera.
- **Deshabilitar / habilitar.** Deshabilitar corta sus sesiones abiertas en el acto.
- **Desbloquear:** tras 5 claves u OTP erróneos seguidos el usuario queda bloqueado 15 minutos (se configura en `.env`).
- **Claves:** cargar una clave temporal, obligar a cambiarla en el próximo ingreso o enviar un **link por correo**, válido 24 h y de un solo uso.
- **OTP obligatorio** por usuario: en su próximo ingreso escanea un QR con una app de autenticación (Google o Microsoft Authenticator, FreeOTP…).
- Cada usuario puede **cambiar su clave** con el botón del encabezado.
- Todo queda en la **Auditoría**: ingresos, rechazos y bloqueos (tipo *Accesos*) y cada acción del administrador.

**Emergencias** (el administrador olvidó la clave, quedó bloqueado o se deshabilitó), desde la máquina:

```sh
sh scripts/usuarios.sh listar
sh scripts/usuarios.sh restablecer admin                      # clave temporal nueva, habilitado y desbloqueado
sh scripts/usuarios.sh crear-admin otro.admin admin2@valo.ar  # otro administrador de seguridad
```

En Windows: `powershell -File scripts\usuarios.ps1 restablecer admin`.

## 4. Red: quién puede entrar

En `.env`:

- `HB_ESCUCHA=127.0.0.1` (por defecto): solo esta máquina.
- `HB_ESCUCHA=0.0.0.0`: también las otras PCs de la red interna, con `https://<nombre o IP de esta máquina>`.
  Completá también `HB_NOMBRE_SERVIDOR` y `HB_URL_PUBLICA` con ese nombre o IP, borrá `frontend/certs/*` para que se
  regenere el certificado y volvé a correr `iniciar`. **No abras ni redirijas el puerto 443 hacia internet** en el router o firewall.

Qué sale de la máquina:

| Modo | Salidas |
| --- | --- |
| Banco real | Solo HTTPS hacia `api.bancodevalores.com` / `apihomo.bancodevalores.com`. Opcionales: el servidor de correo de VALO, si se configura; la consulta de feriados (si no responde, se usan los de fecha fija); las alertas por Teams (`HB_POWERAUTOMATE_URL`, apagadas por defecto). |
| Simulador | Ninguna: todas las redes de Docker quedan internas. |

En el firewall se puede permitir solo esos destinos de salida y bloquear toda conexión entrante desde internet.

## 5. Instalar en una máquina sin internet

1. En una PC **con** internet y Docker: `sh scripts/exportar-imagenes.sh` (o `scripts\exportar-imagenes.ps1`). Genera `imagenes-home-banking.tar.gz` (incluye SQL Server: puede pesar cerca de 1 GB).
2. Copiá esta carpeta y ese archivo a la máquina de destino. **No copies** `secrets/` ni `.env` de la PC de origen.
3. En el destino: `sh scripts/importar-imagenes.sh` (o `scripts\importar-imagenes.ps1`) y después `./iniciar.sh simulador` (o `./iniciar.sh` si esa máquina puede salir al banco).

## 6. Certificado HTTPS

Si `frontend/certs/` está vacía, el contenedor web crea un certificado autofirmado para `localhost`, `127.0.0.1` y
`HB_NOMBRE_SERVIDOR`. Para que el navegador no muestre la advertencia, poné en esa carpeta `tls.crt` y `tls.key`
emitidos por la CA interna de VALO y volvé a correr `iniciar`.

## 7. Correo

Sin configurar nada, los correos de la aplicación (links para elegir clave, envíos programados a empresas) quedan en el
buzón local `http://localhost:8025` y no salen de la máquina. Para usar el servidor de correo interno de VALO, completá
`HB_SMTP_HOST`, `HB_SMTP_PORT`, `HB_SMTP_FROM` y `HB_SMTP_USUARIO` en `.env`, la clave en `secrets/smtp_password.txt`, y
volvé a correr `iniciar`.

## 8. Datos y resguardos

- Los datos viven en el volumen de Docker `home-banking-valo_mssql_datos`. `detener` **no** los borra.
- `./detener.sh --borrar-datos` (o `detener.ps1 -BorrarDatos`) borra todo y vuelve a empezar (pide confirmación).
- Resguardos cifrados: `sh scripts/resguardo.sh`. Restaurar: `sh scripts/restaurar-resguardo.sh`. Guardá `secrets/` en un lugar seguro: sin `credenciales_master_key` no se pueden leer las credenciales API ni los OTP, y sin `resguardo_clave` no se pueden abrir los resguardos.

## 9. Actualizar el código

Después de cambiar o actualizar el código: `./iniciar.sh --reconstruir` (o `iniciar.ps1 -Reconstruir`). Las migraciones
de la base se aplican solas al arrancar.

## 10. Problemas frecuentes

| Síntoma | Qué hacer |
| --- | --- |
| "Docker no está corriendo" | Abrir Docker Desktop y esperar a que diga *running*. |
| El puerto 443 está ocupado | `HTTPS_PORT=8443` en `.env` y entrar a `https://localhost:8443`. |
| "Usuario bloqueado" | El administrador lo desbloquea en Usuarios y permisos (o esperar 15 minutos). |
| Nadie puede entrar como administrador | `sh scripts/usuarios.sh restablecer admin` |
| Ver qué pasa | `docker compose logs -f backend` |
