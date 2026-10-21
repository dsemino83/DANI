# Despliegue en un servidor con las imágenes de Docker Hub

El servidor no compila nada: descarga las imágenes que publica GitHub Actions (`<usuario>/home-banking-valo`) y las levanta con `docker compose`. En el servidor solo quedan la configuración, los secretos y los datos.

## 1. Requisitos del servidor

- Linux (por ejemplo Ubuntu 22.04/24.04) con 2 vCPU, 4 GB de RAM y 20 GB de disco como mínimo.
- **Docker Engine** con el plugin **compose**. En Ubuntu: `curl -fsSL https://get.docker.com | sh`.
- **Entrada:** puerto **443** (HTTPS) abierto para los usuarios. No exponer ningún otro puerto.
- **Salida HTTPS:** `api.bancodevalores.com` (producción) o `apihomo.bancodevalores.com` (homologación), el SSO de VALO (`ssohomo.valo.ar` o el de producción) y `registry-1.docker.io` (descarga de imágenes).

## 2. Archivos de configuración (kit)

Todo lo ejecutable está en Docker Hub, en el repositorio `home-banking-valo`:

| Tag | Qué es |
|---|---|
| `backend-<versión>` | API y tareas programadas (jobs) |
| `frontend-<versión>` | Nginx con la aplicación web |
| `db-operativa-<versión>` | Postgres 16 con el esquema y los usuarios de la base operativa |
| `db-historica-<versión>` | Postgres 16 con el esquema y el usuario de solo lectura de la base histórica |
| `keycloak-dev-<versión>` | Keycloak con usuarios de prueba (solo para pruebas locales) |

El servidor solo necesita el **kit**: `docker-compose.yml`, `.env.example`, `scripts/` (para generar los secretos) y la carpeta `frontend/certs/`. Dos formas de obtenerlo:

- **Descargarlo:** en GitHub → **Actions** → la última ejecución verde de *Home Banking · imágenes Docker* → **Artifacts** → `kit-despliegue-home-banking`. Descomprimir y entrar en `home-banking-valo/`.
- **Clonar la rama:** `git clone -b ALYC https://github.com/dsemino83/DANI.git` y entrar en `DANI/home-banking`.

El pipeline prueba exactamente esto en cada versión: con el kit solo, descarga las imágenes de Docker Hub, levanta todo y verifica frontend, backend, Keycloak y las dos bases.

## 3. Certificado HTTPS

- **Servidor real:** copiá el certificado y la llave del dominio, emitidos por VALO, como `frontend/certs/tls.crt` y `frontend/certs/tls.key`.
- **Prueba:** el paso 4 genera uno autofirmado si no hay ninguno.

## 4. Secretos

```sh
sh scripts/generar-secretos.sh
```

Crea las claves de las bases y la llave maestra que cifra la credencial del banco en `secrets/` (carpeta 700, archivos 644). **Guardalos en el resguardo de secretos de VALO**: sin la llave maestra no se puede descifrar la credencial guardada en la base.

## 5. `.env`

```sh
cp .env.example .env
```

Valores a revisar:

```env
# Imágenes publicadas
HB_IMAGEN=docker.io/<usuario-docker-hub>/home-banking-valo
HB_VERSION=alyc                 # o un commit (p. ej. bea7a2e) para fijar la versión exacta

# Banco
BDV_AMBIENTE=prod               # homo | prod (define la URL del banco)
BDV_SOLO_CONSULTAS=true         # true hasta validar; false habilita el envío de transferencias

# SSO de VALO (Identidad tiene que crear los clientes; ver README)
OIDC_ISSUER=https://ssohomo.valo.ar/valo/realms/staff
OIDC_ORIGIN=https://ssohomo.valo.ar
OIDC_CLIENT_ID=home-banking-web
OIDC_AUDIENCE=home-banking-api
OIDC_ROLES_CLIENT=home-banking-api
KEYCLOAK_ADMIN_CLIENT_ID=home-banking-admin
```

El secret de la service account `home-banking-admin` que entregue Identidad va en `secrets/keycloak_admin_client_secret.txt`, sin salto de línea. En el cliente `home-banking-web`, Identidad tiene que registrar `https://<dominio-del-servidor>/*` como redirect URI y `https://<dominio-del-servidor>` como web origin.

### Alternativa: identidad en Docker (Keycloak propio)

Mientras no estén los clientes en el SSO de VALO, usuarios, perfiles y roles se manejan con el Keycloak que viene en el kit (imagen `keycloak-dev`). Se publica por el mismo HTTPS de la app en `https://<servidor>/auth`, sin abrir otro puerto, y guarda los usuarios en el volumen `keycloak_datos`. En el `.env`:

```env
HB_URL_PUBLICA=https://<nombre-o-IP-del-servidor>
OIDC_ISSUER=https://<nombre-o-IP-del-servidor>/auth/realms/staff
OIDC_INTERNAL_URL=http://keycloak:8080/auth/realms/staff
OIDC_ORIGIN=https://<nombre-o-IP-del-servidor>
```

Y en los comandos del paso 6 agregá `--profile sso-local` (`docker compose --profile sso-local pull`, `docker compose --profile sso-local up -d --no-build`). Ver **Usuarios, perfiles y permisos** más abajo.

## 6. Descargar y levantar

```sh
docker login -u <usuario-docker-hub>     # repositorio privado: usar un token de solo lectura (Read-only)
docker compose pull
docker compose up -d --no-build           # --no-build: usa solo las imágenes descargadas
docker compose ps                         # postgres, postgres-historico, backend, jobs y frontend en "healthy"
```

Después: `https://<dominio-del-servidor>` → entrar con un usuario del SSO que tenga el rol **administrador** → **Credenciales API** → cargar la credencial del banco → **Probar conexión**. Luego seguir con Empresas y Permisos, como en `PRUEBA-INTEGRADA.md`.

## Usuarios, perfiles y permisos (Keycloak propio)

| Qué | Dónde | Quién |
|---|---|---|
| Alta, baja, datos y clave de usuarios; **perfil** (operador, autorizante, auditor, administrador) | Consola del realm: `https://<servidor>/auth/admin/staff/console/` → **Users** → usuario → **Role mapping** → **Assign role** → *Filter by clients* → `home-banking-api` | `admin.ti` (administrador de seguridad) |
| Roles **Crear** / **Aprobar** transferencias | En la app: **Permisos** → usuario (o en la consola, roles `transferencias:crear` / `transferencias:aprobar`) | `admin.ti` |
| Empresas y permisos **Ver** / **Operar** por empresa | En la app: **Empresas** y **Permisos** | `admin.ti` |

Usuarios iniciales: `admin.ti`, `mgomez` (operador, Crear), `lrodriguez` (autorizante, Aprobar) y `svillalba` (auditor), con clave temporal `Dev-<usuario>-1` (por ejemplo `Dev-admin-1`) que **se cambia obligatoriamente en el primer ingreso**. Para un usuario nuevo: crearlo en la consola, cargarle una clave temporal en **Credentials** y asignarle el perfil.

La consola maestra (`https://<servidor>/auth/admin/`, usuario `admin`, clave en `secrets/keycloak_bootstrap_password.txt`) es solo para emergencias: el trabajo diario lo hace `admin.ti` en la consola del realm `staff`. Todo cambio de roles que se haga desde la app queda en la auditoría del Home Banking; los que se hagan en la consola quedan en los eventos de Keycloak.

## 7. Actualizar a una versión nueva

Cada push a `ALYC` que pasa las pruebas publica `backend-alyc`/`frontend-alyc` y la versión fija `backend-<commit>`/`frontend-<commit>`.

```sh
# en .env: HB_VERSION=<commit nuevo>
docker compose pull
docker compose up -d                      # recrea solo lo que cambió; las bases y sus datos se mantienen
```

**Volver atrás:** poner el `HB_VERSION` anterior y repetir los dos comandos. Si una versión nueva cambió el esquema de la base, consultar antes de volver atrás.

## 8. Resguardo de las bases

Los datos viven en los volúmenes `pg_operativa` y `pg_historica`. Copia diaria, por ejemplo con cron a las 03:00:

```sh
docker compose exec -T postgres           pg_dump -U postgres -Fc homebanking      > /resguardo/operativa-$(date +%F).dump
docker compose exec -T postgres-historico pg_dump -U postgres -Fc homebanking_hist > /resguardo/historica-$(date +%F).dump
```

Guardar también `secrets/` y `.env`. **`docker compose down -v` borra los volúmenes con todos los datos: no usarlo en el servidor.**

## Problemas

| Síntoma | Qué revisar |
|---|---|
| `pull access denied` o `unauthorized` en `docker compose pull` | Falta `docker login`, o el token no tiene acceso al repositorio privado |
| Un servicio no llega a `healthy` | `docker compose logs <servicio>` |
| `EACCES … /run/secrets/…` | Permisos de `secrets/`: `chmod 700 secrets && chmod 644 secrets/*.txt` |
| El login vuelve a la pantalla de ingreso | Redirect URI y web origin del cliente `home-banking-web` en el SSO, y `OIDC_ISSUER` / `OIDC_ORIGIN` |
| "Probar conexión" no conecta con el banco | Salida HTTPS del servidor hacia el host del banco, y el filtrado por IP del banco |
