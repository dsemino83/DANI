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
HB_RETENCION_MESES=1            # meses completos que quedan en la base operativa además del mes en curso

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

Todo se hace desde la aplicación con `admin.ti` (administrador de seguridad), en **Usuarios y permisos**, y queda en la auditoría del Home Banking:

| Qué | Cómo |
|---|---|
| **Alta de usuario** | **Nuevo usuario**: usuario, nombre, apellido, email, perfil y clave temporal (mínimo 12 caracteres con letras y números; se cambia en el primer ingreso) |
| **Editar datos** | Nombre, apellido y email → **Guardar datos** (el nombre de usuario no cambia) |
| **Eliminar** | **Eliminar usuario**: se borra del inicio de sesión y pierde sus permisos por empresa; su historial de auditoría se conserva |
| **Perfil** (operador, autorizante, auditor, administrador) | Elegir el usuario → **Perfil** → **Guardar perfil**. Pasar a administrador quita Crear/Aprobar y los permisos por empresa |
| **Deshabilitar / habilitar** | Botón en el usuario. Deshabilitar cierra sus sesiones abiertas y conserva sus permisos; habilitar también quita un bloqueo por intentos fallidos |
| **Desbloquear** | Aparece cuando el usuario quedó **Bloqueado por intentos fallidos** (5 claves erróneas seguidas) |
| **Restablecer clave** | **Nueva clave temporal** → **Restablecer clave** |
| **Enviar correo para cambiar la clave** | Le llega al email del usuario un link (válido 24 h) para elegir una clave nueva él mismo. Requiere el correo saliente (ver abajo) |
| **Forzar cambio en el próximo ingreso** | Entra con su clave actual y en ese momento tiene que elegir una nueva; se cierran sus sesiones abiertas |
| Roles **Crear** / **Aprobar** transferencias | **Roles de transferencias** del usuario |
| Permisos **Ver** / **Operar** por empresa | **Empresas** del usuario (y el maestro de empresas en **Empresas**) |

**Empresas** (también del administrador): el CUIT es único (la pantalla y la base rechazan una segunda empresa con el mismo CUIT). Cada empresa tiene uno o más **emails** (se cargan al darla de alta, separados por coma, y después se agregan o quitan con ✕). Sus cuentas se asignan con **Agregar cuentas**: lista solo las cuentas sin empresa, con buscador por nombre, alias o número (contiene) y selección múltiple. Al agregarlas, cada cuenta se consulta en **COELSA** y se guardan su CBU, alias y titular en la tabla `empresa_cbu`; las que COELSA no resuelve no se agregan y se muestran con el motivo. **Dar de baja** una cuenta no la borra: la relación pasa a estado `baja` (queda en el historial de la empresa) y la cuenta vuelve a estar disponible. La base garantiza que cada CBU y cada cuenta tenga **una sola relación activa** con una empresa.

**Qué cuentas ve cada usuario:** solo las cuentas activas de empresas activas sobre las que el administrador le dio **Ver** (u **Operar**). Mientras el administrador no cargue empresas, cuentas y permisos, los cargadores no ven ninguna cuenta.

**Cartera de oficiales (aprobador):** el perfil **autorizante** tiene la pestaña **Cartera de oficiales**, donde asigna a cada oficial (perfil operador) los clientes que atiende. Por defecto un oficial ve todos los clientes que le habilitó el administrador; con cartera, solo las cuentas de esos clientes. El aprobador solo puede asignar clientes que él mismo ve, la cartera nunca amplía los permisos del administrador, y cada cambio queda en Auditoría.

**Log del administrador:** cada acción queda en **Auditoría** (tipo *Administración*) con usuario, fecha, IP y detalle; también los intentos rechazados (CUIT repetido, cuenta ya asignada, error de COELSA o del SSO), con el motivo.

La ficha de cada usuario muestra su estado: **Habilitado / Deshabilitado**, **Bloqueado por intentos fallidos** y **Debe cambiar la clave**.

**Correo saliente.** Con el perfil `correo-prueba` (lo usa la máquina de prueba), los correos no salen a internet: llegan a un buzón de prueba en `http://localhost:8025` (en el Codespace, el puerto **8025** de la pestaña **Ports**). Para usar un servidor de correo real, en `.env` completá `HB_SMTP_HOST`, `HB_SMTP_PORT`, `HB_SMTP_FROM` y `HB_SMTP_USUARIO`, guardá la clave en `secrets/smtp_password.txt` y corré `sh scripts/configurar-correo.sh`.

Nadie puede modificar su propio usuario. Para lo que no está en la app (por ejemplo, borrar un usuario o ver los eventos de ingreso), `admin.ti` tiene la consola del realm en `https://<servidor>/auth/admin/staff/console/`.

Usuarios iniciales: `admin.ti`, `mgomez` (operador, Crear), `lrodriguez` (autorizante, Aprobar) y `svillalba` (auditor), con clave temporal `Dev-<usuario>-1` (por ejemplo `Dev-admin-1`) que **se cambia obligatoriamente en el primer ingreso**.

La consola maestra (`https://<servidor>/auth/admin/`, usuario `admin`, clave en `secrets/keycloak_bootstrap_password.txt`) es solo para emergencias: el trabajo diario lo hace `admin.ti` en la consola del realm `staff`. Todo cambio de roles que se haga desde la app queda en la auditoría del Home Banking; los que se hagan en la consola quedan en los eventos de Keycloak.

## Máquina de prueba en la web (GitHub Codespaces)

Para probar sin instalar nada: una máquina virtual de GitHub con Docker que levanta todo sola (bases, Keycloak, backend, frontend) y suma **Portainer**, un panel web para manejar los contenedores. Todo se usa desde el navegador.

**Una sola vez (opcional): usar las imágenes de Docker Hub.** En GitHub → foto de perfil → **Settings** → **Codespaces** → **New secret**, cargá `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN` (token **Read-only**) y en *Repository access* elegí `dsemino83/DANI`. Sin estos secretos la máquina compila las imágenes desde el código (tarda unos minutos más).

**Crear la máquina:**

1. En el repositorio, elegí la rama **ALYC** → botón verde **Code** → pestaña **Codespaces** → **⋯** → **New with options** → máquina de **4 cores** → **Create codespace**.
2. Se abre un editor en el navegador. Abajo, en la terminal, esperá el mensaje **Listo** (5 a 10 minutos la primera vez) con las dos direcciones:
   - **Home Banking:** `https://<nombre>-443.app.github.dev` → `admin.ti` / `Dev-admin-1`.
   - **Portainer:** `https://<nombre>-9443.app.github.dev` → usuario `admin`, clave en `home-banking/secrets/portainer_admin_password.txt` (abrilo desde el explorador de archivos del editor).
   También están en la pestaña **Ports**.
3. Seguí con **Credenciales API**, Empresas y Usuarios y permisos como en `PRUEBA-INTEGRADA.md` (pasos 6 a 8). La máquina ya viene con banco **Producción** y **solo consultas**.

**Manejo desde Portainer** (**Home** → **local** → **Containers**): estado de cada servicio, **Logs**, **Restart**, **Console**. Para actualizar un servicio a la última versión publicada: el contenedor → **Recreate** → activar **Re-pull image**. Para actualizar todo de una vez, en la terminal del Codespace (desde cualquier carpeta): `hb-actualizar` (o `bash /workspaces/DANI/home-banking/scripts/maquina-prueba.sh`). El script se pone solo en la rama **ALYC**, trae el código nuevo, descarga las imágenes, aplica las migraciones y reconfigura Keycloak.

**Cuidados:**

- Los puertos quedan **privados**: solo entra tu usuario de GitHub. No los cambies a *Public*.
- La máquina se apaga sola tras 30 minutos sin uso y se vuelve a levantar al abrirla (**Code** → **Codespaces**); usuarios y datos se conservan. Mientras los servicios arrancan, la app muestra "El sistema está iniciando, reintentando…" y entra sola cuando están listos. Las horas de uso se descuentan del cupo gratuito de GitHub.
- La credencial del banco queda cifrada en la base de la máquina. Al terminar la prueba, **borrá el Codespace** (**Code** → **Codespaces** → **⋯** → **Delete**): se borra todo.
- Si "Probar conexión" no llega al banco, el banco puede estar filtrando por IP: las máquinas de Codespaces no tienen una IP fija.

## Documentación

El manual de usuario, la documentación para auditoría y la técnica viajan **dentro de la aplicación** (`backend/src/docs/*.md`): pestaña **Documentación** (administrador y auditor; cada consulta queda auditada) y **Ayuda → Abrir el manual completo** para todos. Se leen en pantalla y se imprimen o guardan en PDF. Se actualizan con cada versión; no hay que configurar links.

## Buzón de mensajes

En el encabezado, **✉ Mensajes** (con la cantidad sin leer). Cuando alguien carga una transferencia o confirma un lote que necesita autorización, les llega un mensaje a **todas las personas asociadas a esos clientes** (permiso Ver sobre la empresa en *Usuarios y permisos*), salvo a quien la cargó. Se revisa cada 30 segundos: mientras haya mensajes sin leer el botón queda **rojo y latiendo**, y cuando llega uno nuevo se sacude y se abre solo con una **franja roja parpadeante**. Un mensaje queda **leído** cuando el destinatario lo abre (solo ese: si había varios, los demás siguen sin leer); **Aceptar** lleva a **Aprobaciones** (a quien no tiene el rol de aprobar, al registro de Transferencias). Si la operación de un mensaje sin leer ya fue autorizada o resuelta por otro, al actualizar pasa sola a leído. El buzón muestra **solo los últimos 7 días**. Los mensajes ya leídos pasan a la base histórica con el pase mensual.

## Envíos programados de correo a las empresas

Pestaña **Envíos programados**, solo del **aprobador** (perfil autorizante) y solo sobre las empresas que él ve. Cada programación define:

- **Tipo y repetición:**
  - **1 vez al día · extracto diario** a una hora: asunto *Envío de extracto diario · cliente · fecha*, saludo al cliente, saldos y/o movimientos del día (**contenido**) por cuenta, con débitos y créditos en tablas separadas. Se envía aunque no haya movimientos.
  - **1 vez cada hora** o **1 vez cada 30 minutos · alerta de movimientos**, desde una hora hasta otra (inclusive): en cada ejecución consulta los movimientos del día de las cuentas elegidas y se queda con los de la franja **desde 29:59 minutos antes hasta la hora de ejecución** (10:00 → de 09:30:01 a 10:00:00). Cada 30 minutos las franjas quedan contiguas y cubren todo el horario; cada hora, solo la última media hora de cada hora. **Solo se envía si hubo movimientos**: asunto *Alerta de movimientos · cliente · fecha franja*, saludo con la franja horaria y, por cuenta (como título), débitos y créditos en tablas con todo el detalle. Si no hubo, la tarea queda *omitida* (sin correo).
- **Formato:** **solo en el cuerpo del correo** o **cuerpo + Excel adjunto**. Con Excel el cuerpo va igual y el archivo trae el **logo del banco**, el cliente y las hojas Saldos y/o Movimientos con todos los movimientos (importes como números).
- **Destino:** primero el **cliente** y después sus **cuentas** (todas o solo algunas), entre los clientes que ve el aprobador; o "Todos mis clientes". Al enviar se vuelve a verificar con los permisos del aprobador que la guardó.
- **Una por cliente y tipo:** cada cliente puede tener una sola programación activa diaria (extracto) y una sola de alerta (cada hora o cada 30 minutos), entre todos los aprobadores; para otra, pausar o editar la existente.
- **Banco:** las consultas usan la credencial de envíos programados (ver más abajo). Todos los correos llevan el logo de VALO.
- **Días de la semana**, **inicio** y **fin** (opcional), y **No enviar en feriados**.

**Cola de envíos (sin superposición).** Cada minuto, el servicio `jobs` revisa los turnos vencidos (hora de Argentina) y **encola** una tarea por cliente; un turno se encola una sola vez y, si el sistema estuvo apagado, no se encolan los atrasados de más de una hora. Un **único trabajador** toma las tareas de a una, en orden (`FOR UPDATE SKIP LOCKED`), así los procesos nunca se superponen; cada tarea termina en el envío de un correo. Si el envío falla se reintenta a los 1, 5 y 15 minutos; después queda en **Error** y se puede **Reintentar** a mano. Una tarea que quedó "procesando" por un corte se retoma sola a los 10 minutos. La pantalla muestra la **Cola de envíos** (en cola, procesando, últimas terminadas y el resumen de 24 h) y el **Historial** de cada programación. **Ejecutar ahora** encola un envío de prueba. Todo queda en Auditoría.

**Feriados:** se traen solos todos los días de fuentes públicas (ArgentinaDatos y, si falla, Nolaborables) para el año en curso y el siguiente; también con **Actualizar desde fuentes públicas**. Los días no laborables bancarios que no son feriados nacionales (por ejemplo, el **Día del Bancario, 6 de noviembre**) se cargan a mano en la misma pantalla.

**Credencial del banco para los envíos:** en **Credenciales API** (administrador de seguridad, p. ej. `admin.ti`) → **Envíos programados** se carga una credencial API adicional, **exclusiva** de los envíos programados: tiene su propia sesión en el banco, así los correos no cortan la sesión del Home Banking. Tiene que ser un **usuario API distinto** del principal (el banco tiene que darlo de alta). Mientras no se cargue, los envíos usan la principal. Al guardarla, el servicio `jobs` la toma solo en menos de un minuto. **Probar conexión** la verifica sin afectar a la principal. Es la única credencial con el **channel** editable (por defecto 3); la principal usa siempre el 3.

**Correo:** usa el mismo servidor que Keycloak (`HB_SMTP_*` en `.env`, clave en `secrets/smtp_password.txt`). Sin configurar, los correos van al buzón de prueba (Mailpit, puerto 8025). Los correos llevan saldos: con un servidor real, usar TLS (`HB_SMTP_STARTTLS=true`).

## Dirección propia (por ejemplo `ealyc.valo.ar`)

La aplicación y el inicio de sesión usan la misma dirección: al entrar a `https://ealyc.valo.ar` se pasa directo a la pantalla de ingreso de Keycloak (`https://ealyc.valo.ar/auth/…`) y, después de ingresar, se vuelve a la aplicación. Hace falta un servidor con IP fija (en un Codespace la dirección la pone GitHub y no se puede cambiar).

1. **DNS** (lo hace el equipo de redes de VALO): registro `A` de `ealyc.valo.ar` apuntando a la IP pública del servidor.
2. **Certificado** de `ealyc.valo.ar` en `frontend/certs/tls.crt` y `tls.key`.
3. En `.env`: `HB_URL_PUBLICA=https://ealyc.valo.ar`, `OIDC_ISSUER=https://ealyc.valo.ar/auth/realms/staff` y `OIDC_ORIGIN=https://ealyc.valo.ar`.
4. `docker compose --profile sso-local up -d` y `sh scripts/configurar-dominio.sh` (habilita la dirección nueva en el cliente `home-banking-web` de Keycloak; la anterior deja de funcionar).

## 7. Actualizar a una versión nueva

Cada push a `ALYC` que pasa las pruebas publica `backend-alyc`/`frontend-alyc` y la versión fija `backend-<commit>`/`frontend-<commit>`.

```sh
# en .env: HB_VERSION=<commit nuevo>
docker compose pull
docker compose up -d                      # recrea solo lo que cambió; las bases y sus datos se mantienen
sh scripts/migrar-bases.sh                # cambios de esquema de la versión nueva (si no hay, no hace nada)
```

**Volver atrás:** poner el `HB_VERSION` anterior y repetir los dos comandos. Si una versión nueva cambió el esquema de la base, consultar antes de volver atrás.

## 8. Resguardo de las bases

### Base operativa e histórica

Todas las tablas con movimiento tienen su parte activa (base operativa, `postgres`) y su parte histórica (`postgres-historico`, solo lectura para la aplicación). La operativa conserva el **mes en curso y el mes anterior completo** (`HB_RETENCION_MESES=1`). El **día 1 de cada mes a las 02:10** el servicio `jobs` pasa a la histórica todo mes anterior:

| Tabla | Cómo pasa |
|---|---|
| `transferencia`, `transferencia_estado`, `auditoria` | la partición del mes entera |
| `cola_envio`, `envio_mail_log` (envíos de correo) | las filas terminadas del mes (lo pendiente queda) |

Cada mes se copia, se verifica filas + hash en la histórica y recién entonces se borra de la operativa; queda en `pase_historico` (operativa), `pase_recibido` (histórica) y en Auditoría. Si un mes tiene transferencias sin estado final se omite y se reintenta el mes siguiente; mientras tanto las pantallas consultan ese mes en la operativa, así nada queda invisible. En las pantallas, "Base operativa" y "Base histórica" se eligen por separado.

Para correr el pase a mano (por ejemplo para probarlo):

```sh
docker compose exec jobs node src/jobs/pase-historico.js
docker compose exec postgres psql -U postgres -d homebanking -c "SELECT tabla, periodo, filas, estado, detalle, ejecutado_en FROM pase_historico ORDER BY id DESC LIMIT 20"
```

La configuración (empresas, permisos, credenciales, programaciones, feriados) no pasa: vive solo en la operativa. Cuánto se guarda la histórica lo define Cumplimiento.

### Copias

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
