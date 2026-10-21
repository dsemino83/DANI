# Prueba integrada con datos productivos (antes del despliegue en VALO)

Se levanta la aplicación completa en una PC (frontend, backend, bases operativa e histórica y un Keycloak local con usuarios de prueba) y el backend se conecta a la **API de producción del Banco de Valores en modo solo consultas**: saldos, movimientos, débitos y CBU reales, sin que ninguna transferencia llegue al banco.

La prueba con Power Automate mostró que el banco aceptó llamadas desde la nube de Microsoft, así que no debería hacer falta habilitar la IP de la PC. Si el login falla por conexión, ver **Problemas** al final.

## 1. Requisitos de la PC

- Windows 10/11, macOS o Linux, con 8 GB de RAM libres y el puerto **443** sin usar.
- **Docker**: Docker Desktop, o Rancher Desktop o Podman si la licencia de Docker Desktop no aplica a VALO (es paga para empresas grandes).
- **Git** ([git-scm.com](https://git-scm.com)).

Los comandos de esta guía van en **PowerShell** en Windows y en una terminal en macOS/Linux; donde cambian, están las dos versiones. Docker Desktop tiene que estar **abierto** (ícono de la ballena en verde) antes de correrlos.
- Salida a internet hacia `api.bancodevalores.com` (HTTPS) sin proxy obligatorio (ver **Problemas**).

## 2. Bajar el código

```sh
git clone -b ALYC https://github.com/dsemino83/DANI.git
cd DANI/home-banking
```

## 3. Generar secretos y certificado de prueba

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\generar-secretos.ps1
```

**macOS / Linux:**

```sh
sh scripts/generar-secretos.sh
```

Crea las claves de las bases, la llave maestra que cifra la credencial del banco y un certificado autofirmado para `https://localhost`. Nada de eso se sube al repositorio.

## 4. Configurar `.env`

Copiá `.env.example` como `.env`:

- **Windows (PowerShell):** `Copy-Item .env.example .env` y después `notepad .env`
- **macOS / Linux:** `cp .env.example .env`

Dejá estos valores (si una línea ya existe, cambiá el valor; si no, agregala):

```env
BDV_AMBIENTE=prod
BDV_SOLO_CONSULTAS=true

# Keycloak propio en Docker (perfil sso-local), en https://localhost/auth
HB_URL_PUBLICA=https://localhost
OIDC_ISSUER=https://localhost/auth/realms/staff
OIDC_INTERNAL_URL=http://keycloak:8080/auth/realms/staff
OIDC_ORIGIN=https://localhost
OIDC_CLIENT_ID=home-banking-web
OIDC_AUDIENCE=home-banking-api
OIDC_ROLES_CLIENT=home-banking-api
KEYCLOAK_ADMIN_CLIENT_ID=home-banking-admin
HTTPS_PORT=443
```

`BDV_SOLO_CONSULTAS=true` es lo que garantiza que no se mueva dinero: aprobar una transferencia se rechaza antes de llegar al banco.

## 5. Levantar

> Si ya están publicadas las imágenes en Docker Hub (ver README, **Imágenes publicadas**), agregá `HB_IMAGEN` y `HB_VERSION` al `.env` y usá `docker compose --profile sso-local pull` seguido de `docker compose --profile sso-local up -d --no-build`: no compila nada en la PC (bases y Keycloak de prueba incluidos). Alcanza con el kit descargable (ver DESPLIEGUE.md, paso 2), sin clonar el código.

```sh
docker compose --profile sso-local up -d --build
docker compose ps
```

La primera vez tarda unos minutos (descarga imágenes y compila). Esperá a que `postgres`, `postgres-historico` y `backend` figuren como **healthy**. Si algo no arranca: `docker compose logs backend` (o el servicio que falle).

## 6. Cargar la credencial de producción

1. Abrí **https://localhost** y aceptá el aviso del certificado autofirmado.
2. **Ingresar con usuario de VALO** → usuario `admin.ti`, clave `Dev-admin-1` (usuario del Keycloak local).
3. **Credenciales API** → **Producción**. La URL ya muestra `https://api.bancodevalores.com/…`.
4. Completá **Usuario**, **identification** (DNI) y **Terminal**. En **Clave** pegá el texto cifrado en base64 que entregó el banco y tildá **La clave ya viene cifrada por el banco**. La llave RSA no hace falta.
5. **Guardar** → **Probar conexión**. Tiene que decir "Conexión OK" con el nombre de la entidad.

La clave se guarda cifrada (AES-256-GCM) en la base local y no se vuelve a mostrar.

## 7. Empresas y permisos

Con `admin.ti`:

1. **Empresas** → dá de alta una o dos empresas reales (razón social y CUIT) y asignales algunas cuentas. La lista de cuentas sin asignar son las cuentas reales que devuelve el banco.
2. **Usuarios y permisos** → a `mgomez` (operador), `lrodriguez` (autorizante) y `svillalba` (auditor) dales **Ver** sobre esas empresas. Ahí mismo se crean usuarios nuevos (**Nuevo usuario**), se cambia el perfil, se deshabilita o se restablece la clave (ver DESPLIEGUE.md, **Usuarios, perfiles y permisos**).

## 8. Probar como usuario

Cerrá sesión y entrá con `mgomez` / `Dev-mgomez-1`. El encabezado tiene que mostrar **Banco: Producción** y el aviso rojo de **modo solo consultas**.

| Pantalla | Qué validar |
|---|---|
| **Saldos** | Sin empresa elegida: el total de todas tus empresas. Al elegir una: sus cuentas y saldos, que tienen que coincidir con el banco |
| **Movimientos** | Movimientos del día de una cuenta; con **Histórico**, un período con más de 900 movimientos para probar la paginación; **Exportar a Excel** |
| **Débitos realizados** | Débitos del día por empresa; la ⚙ de un débito del banco dice que es un débito externo |
| **Consulta CBU** | Un CBU o alias real: titular, CUIT y estado |
| **Transferir** (opcional) | Cargar una con un ID: queda **Pendiente de aprobación**. Con `lrodriguez`, en **Aprobaciones** dice "Modo solo consultas: no se envía al banco" |
| **Auditoría** | Con `svillalba` / `Dev-svillalba-1` o `admin.ti`: cada consulta y cambio de configuración registrado con usuario y hora |

Ninguna cuenta fuera de las empresas con permiso tiene que aparecer en ninguna pantalla.

## 9. Al terminar

```sh
docker compose --profile sso-local down -v
```

`-v` borra las bases locales, con la credencial cifrada y los datos consultados. Después pedile al banco que cambie la clave, porque el texto cifrado circuló por canales no seguros.

## Problemas

| Síntoma | Causa probable |
|---|---|
| "Probar conexión" falla con "No se pudo conectar" | La PC no llega a `api.bancodevalores.com`: firewall, o la red exige un proxy corporativo. El backend no usa proxy; probá desde una red con salida directa, o pedí que se agregue soporte de proxy |
| Falla con HTTP 403 o "Sin respuesta" | El banco filtra por IP: pedile que habilite la IP pública de esa red |
| "El banco rechazó el login" | Usuario, DNI, terminal o clave incorrectos, o el texto cifrado no corresponde a producción. El mensaje trae el código del banco |
| El login de la aplicación no abre o vuelve a la pantalla de ingreso | Keycloak todavía está arrancando (esperá 1 minuto), o el `.env` no tiene los valores del paso 4 |
| El backend se reinicia con `EACCES: permission denied, open '/run/secrets/…'` (Linux/macOS) | Secretos generados con una versión anterior del script: `chmod 700 secrets && chmod 644 secrets/*.txt`, después `docker compose --profile sso-local down -v` (la base quedó a medio inicializar) y volver a levantar |
| `docker compose` falla en Windows con errores en archivos `.sh` | Clonado con fines de línea de Windows: volvé a clonar (el repositorio ya fuerza LF en esos archivos) |
