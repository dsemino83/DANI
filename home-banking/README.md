# Home Banking VALO — frontend, backend y despliegue

Backend (BFF) en Node.js 22 + Fastify, dos Postgres (base operativa: mes en curso + `HB_RETENCION_MESES`, 1 por defecto; y base histórica) y Nginx, todo con Docker Compose. Los usuarios se autentican en el SSO de VALO (`https://ssohomo.valo.ar/valo/realms/staff`) y solo el backend se conecta con las APIs del Banco de Valores, con la credencial de VALO (más una adicional, exclusiva de los envíos programados de correo).

```
navegador ──HTTPS──> frontend (Nginx) ──/api──> backend ──> APIs Banco de Valores
     │                                             │ ├──> postgres (operativa, mes en curso + N, particionada por mes)
     └── login OIDC + PKCE ──> SSO VALO <── JWKS ───┘ └──> postgres-historico (solo lectura)
                                         jobs: estado de transferencias (cada 5 min), envíos programados de correo (cola),
                                               feriados (diario) y pase a la base histórica (día 1)
```

**Documentación:** el manual de usuario, la documentación para auditoría y la técnica están en `backend/src/docs/` y viajan dentro de la aplicación (pestaña **Documentación** para administrador y auditor; el manual también en **Ayuda**).

## Puesta en marcha

> **Sin instalar nada:** una máquina de prueba en la web (GitHub Codespaces + Portainer) levanta todo sola. Ver [DESPLIEGUE.md](DESPLIEGUE.md), **Máquina de prueba en la web**.

```sh
cd home-banking
sh scripts/generar-secretos.sh      # crea ./secrets/*.txt y un certificado autofirmado (solo desarrollo)
cp .env.example .env                # completar OIDC_ISSUER, OIDC_ORIGIN, BDV_AMBIENTE, etc.
docker compose up -d --build        # homologación / producción (SSO de VALO)
docker compose --profile sso-local up -d  # con Keycloak propio en https://<servidor>/auth (usuarios y perfiles desde Docker)
```

Después de levantar:
1. Entrar en `https://<host>/` con el **administrador de seguridad** y cargar la credencial API Banking en **Credenciales API** (usuario, clave, DNI, terminal y llave pública RSA del banco; la URL la define el ambiente); queda probarla con “Probar conexión”. La clave se cifra con AES-256-GCM y nunca se vuelve a mostrar.
2. En **Empresas**, dar de alta empresas y asignarles cuentas; en **Permisos**, otorgar Ver / Operar por empresa.
3. En **Permisos**, asignar los roles Crear (`transferencias:crear`) y Aprobar (`transferencias:aprobar`); también se pueden asignar directamente en el SSO.

### Lo que tiene que crear el equipo de Identidad en el realm `staff`

| Client | Tipo | Para qué |
|---|---|---|
| `home-banking-web` | público, Authorization Code + PKCE S256, mapper de audiencia `home-banking-api` | Login de la SPA |
| `home-banking-api` | bearer-only, con los roles de cliente `operador`, `autorizante`, `auditor`, `administrador`, `transferencias:crear`, `transferencias:aprobar` | Audiencia y roles del token |
| `home-banking-admin` | confidencial, service account con `realm-management: view-users, manage-users, view-clients` | Asignar Crear/Aprobar desde Permisos |

`keycloak/realm-staff-dev.json` es un ejemplo completo para desarrollo (usuarios `mgomez`, `lrodriguez`, `svillalba`, `admin.ti` con claves temporales).

## Primera prueba con producción (sin mover dinero)

> Paso a paso completo para levantar todo en una PC y probar con la API de producción en modo solo consultas: [PRUEBA-INTEGRADA.md](PRUEBA-INTEGRADA.md).

La prueba se hace con la aplicación desplegada en la infraestructura de VALO: el prototipo no se conecta al banco y la credencial de producción nunca sale del backend.

1. En `.env`: `BDV_AMBIENTE=prod` y `BDV_SOLO_CONSULTAS=true`. La URL pasa a ser `https://api.bancodevalores.com/…` sola.
2. `docker compose up -d --build` (o `docker compose up -d backend` si ya estaba levantado).
3. Confirmar con el banco que la IP de salida del servidor esté habilitada para producción.
4. Entrar como administrador de seguridad → **Credenciales API** → **Producción**: cargar usuario, clave, DNI y terminal; si el banco entregó la clave ya cifrada, tildar **La clave ya viene cifrada por el banco** (no hace falta la llave RSA); si no, cargar la llave RSA → **Probar conexión** (solo hace `login` y `getUserEntityInformation`).
5. Dar de alta las empresas, asignarles las cuentas reales y otorgar permisos **Ver** a quienes van a probar.
6. Con un usuario operador: Saldos, Movimientos (Excel incluido), Débitos realizados y Consulta CBU con datos reales. El encabezado muestra "Banco: Producción" y el aviso de modo solo consultas.
7. Si se carga una transferencia de prueba, queda pendiente: **Aprobar** la rechaza el backend y no llega al banco.
8. Para habilitar transferencias reales: `BDV_SOLO_CONSULTAS=false` y reiniciar el backend. Conviene que la primera sea de importe mínimo entre cuentas propias.

### Probar la credencial sin desplegar

`scripts/probar-api.mjs` hace solo lectura (login, getUserEntityInformation, getOwnAccounts y, opcional, movimientos del día) y nunca llama a una API de transferencia. La credencial va por variables de entorno; las cuentas se muestran enmascaradas. Tiene que correr desde una máquina con salida habilitada por el banco:

```sh
BDV_AMBIENTE=prod BDV_LOGIN=<usuario> BDV_PASSWORD_CIFRADA='<clave cifrada en base64>' \
BDV_TERMINAL=<terminal> BDV_IDENTIFICATION=<DNI> node scripts/probar-api.mjs
```

## Imágenes publicadas (Docker Hub)

El workflow `.github/workflows/home-banking-imagenes.yml` corre en cada push a `ALYC`:

1. **Pruebas del backend** (`npm test`): reglas de negocio y separación de funciones por rol.
2. **Seguridad:** `npm audit` de producción (bloquea en vulnerabilidad crítica), gitleaks (secretos en el repo e historial) y Trivy (vulnerabilidades e IaC, informativo).
3. **Autorización de punta a punta** (`backend/test/e2e`, con un SSO y un banco simulados): acceso por empresa (BOLA), operación por id (IDOR), doble control y envío único, y límite de pedidos por usuario.
4. **Prueba de humo:** levanta el stack completo con Docker (bases, backend, frontend y Keycloak local) y verifica frontend, `config.json`, las cabeceras de seguridad y la CSP, `/api/health`, que la API pida token, Keycloak y el esquema de la base.
5. **Publicación** en Docker Hub, solo si todo lo anterior pasa: `docker.io/<usuario>/home-banking-valo` con los tags `backend-alyc`, `frontend-alyc` y `backend-<commit>` / `frontend-<commit>`.

Requiere dos secretos en GitHub (Settings → Secrets and variables → Actions): `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN` (access token de Docker Hub con permiso **Read & Write**; con Read-only la publicación falla con "insufficient scopes"). Conviene que el repositorio de Docker Hub sea **privado**.

Paso a paso completo del despliegue en un servidor (certificado, SSO, actualizaciones, resguardo): [DESPLIEGUE.md](DESPLIEGUE.md).

Para desplegar sin compilar, en el `.env` del servidor:

```env
HB_IMAGEN=docker.io/<usuario>/home-banking-valo
HB_VERSION=alyc        # o el commit, por ejemplo 73a4d34, para fijar una versión exacta
```

```sh
docker login                      # solo si el repositorio de Docker Hub es privado
docker compose pull
docker compose up -d              # agregar --profile sso-local para el Keycloak propio
```

Las imágenes no contienen secretos: claves, certificado y credencial del banco se generan o cargan en cada servidor.

## Secretos

| Archivo en `./secrets` | Uso |
|---|---|
| `db_owner_password.txt` / `dbh_owner_password.txt` | Dueño (postgres) de cada base: solo inicialización y migraciones; ya no lo usa ningún servicio de la app |
| `db_jobs_password.txt` / `dbh_jobs_password.txt` | Roles `hb_pase` / `hb_pase_h` del pase mensual a la histórica (job): dueños solo de las tablas que mueve |
| `db_app_password.txt` | Usuario `hb_app` de la operativa: sin DELETE en transferencias ni UPDATE/DELETE en auditoría |
| `db_hist_ro_password.txt` | Usuario `hb_hist_ro`: solo lectura de la histórica |
| `credenciales_master_key.txt` | Llave AES-256 (32 bytes base64) que cifra la clave API en reposo |
| `keycloak_admin_client_secret.txt` | Secret de la service account `home-banking-admin` |

Ninguno se sube al repositorio (`.gitignore`). En producción conviene reemplazarlos por el gestor de secretos de VALO (Vault u otro) manteniendo los mismos nombres `*_FILE`.

## API (`/api`, todas con `Authorization: Bearer <token del SSO>`)

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /me` | todos | Usuario, rol y si puede crear / aprobar |
| `GET /cuentas[?empresa=]` | operador, autorizante, auditor | Saldos de las cuentas habilitadas (getOwnAccounts filtrado por empresa) |
| `GET /cuentas/{n}/detalle` | ídem | getBalancesDetail |
| `GET /cuentas/{n}/movimientos?desde&hasta[&formato=xlsx]` | ídem | getMovementsDetail paginado de a 900; exporta .xlsx |
| `GET /debitos?desde&hasta[&empresa][&formato=xlsx]` | ídem | Débitos realizados de todas las cuentas visibles |
| `POST /cbu` | operador, autorizante | getCustomerInformationCbu |
| `POST /transferencias` | rol Crear | **Carga interna** con `referencia` (ID de la operación, único): queda PENDIENTE_APROBACION, no llama al banco |
| `GET /aprobaciones` | rol Aprobar | Pendientes (individuales y lotes) |
| `POST /transferencias/{id}/aprobar` · `/rechazar` | rol Aprobar, distinto de quien cargó | **Aprobar envía al banco** por la API del tipo |
| `POST /lotes` (multipart `archivo`) | rol Crear | CSV / XLSX / TXT con columna `id` → detalle previo (sin APIs de transferencia) |
| `POST /lotes/{id}/confirmar` | quien lo subió | Crea una transferencia pendiente por fila válida |
| `POST /lotes/{id}/aprobar` · `/rechazar` | rol Aprobar, distinto de quien lo subió | Una llamada al banco por fila |
| `GET /transferencias?desde&hasta[&estado]` | operativos | Base operativa (desde el corte) |
| `GET /historico/transferencias?desde&hasta[&pagina]` | operativos | Base histórica (solo fechas anteriores al corte) |
| `GET /transferencias/{id}/auditoria` | operativos | Historial completo de una operación (⚙) |
| `GET /debitos/{movimiento}/auditoria` | operativos | Auditoría de un débito: si salió del Home Banking, la de su transferencia (⚙) |
| `POST /lotes/{id}/descartar` | quien lo subió | Descarta un lote en detalle previo |
| `GET /admin/usuarios` | administrador | Usuarios con roles de Home Banking en Keycloak |
| `GET /auditoria` · `GET /historico/auditoria` | auditor, administrador | Auditoría general, cada base por separado |
| `/admin/empresas`, `/admin/permisos/{usuario}`, `/admin/usuarios/{usuario}/roles`, `/admin/credenciales/{amb}?uso=principal\|envios` | administrador | Empresas, cuentas, permisos, roles y credenciales API (principal y exclusiva de envíos programados) |
| `POST /admin/usuarios` · `PUT /admin/usuarios/{u}/perfil` · `PATCH /admin/usuarios/{u}` · `POST /admin/usuarios/{u}/clave` | administrador | Alta de usuario, perfil, habilitación y clave temporal en el SSO (nunca sobre sí mismo) |

## Frontend (`frontend/`)

SPA en JavaScript (módulos ES, sin paso de build) servida por Nginx, con las pantallas del prototipo:

| Perfil | Pestañas |
|---|---|
| Operador / Autorizante | Saldos · Movimientos · Débitos realizados · Consulta CBU · Transferencias · Ayuda; **Transferir** y **Carga masiva** con rol Crear; **Aprobaciones** con rol Aprobar |
| Auditor | Saldos · Movimientos · Débitos realizados · Transferencias · Auditoría · Documentación · Ayuda |
| Administrador de seguridad | Empresas · Permisos · Credenciales API · Auditoría · Documentación · Ayuda |

- **Login** con el SSO de VALO (OIDC Authorization Code + PKCE, cliente público `home-banking-web`). La SPA nunca ve la contraseña; los tokens viven en `sessionStorage` y se renuevan con el refresh token.
- **Configuración en tiempo de ejecución:** `40-config-runtime.sh` genera `/config.json` desde `OIDC_ISSUER` y `OIDC_CLIENT_ID`; la misma imagen sirve para homologación y producción.
- **CSP estricta** (`script-src 'self'; style-src 'self'`, sin estilos ni scripts en línea); `OIDC_ORIGIN` habilita solo el SSO. Todo dato se inserta como texto (`textContent`), nunca como HTML.
- Logo y paleta VALO (Pantone 186 C / Cool Gray 10), botón de modo oscuro recordado por navegador, ⚙ de auditoría por transacción en Transferencias, Aprobaciones y Débitos.
- Ocultar una pestaña es solo comodidad: cada permiso lo vuelve a validar el backend.

## Reglas que hace cumplir el backend (no solo la pantalla)

- **URL del banco según el ambiente**, nunca cargada a mano: `BDV_AMBIENTE=homo` usa `https://apihomo.bancodevalores.com/…` (la del PDF) y `BDV_AMBIENTE=prod` usa `https://api.bancodevalores.com/…`. Antes de cada login se verifica que la URL sea la del ambiente. `BDV_URL_HOMO` solo reemplaza la de homologación (simuladores); la de producción no se puede cambiar.
- **Doble control:** quien carga no puede aprobar (validado en el backend y con `CHECK (aprobador <> creador)` en la base).
- **Un ID de operación, una sola transferencia, para siempre.** Cada carga (individual o fila de un archivo) lleva un ID de hasta 40 caracteres (letras, números, `. _ / -`), sin distinguir mayúsculas ni espacios. Se reserva en `referencia_usada` (clave primaria, solo inserción, fuera del pase histórico) en la misma transacción que la carga: un ID repetido se rechaza indicando la operación original, aunque esa operación se haya rechazado o ya esté en la base histórica. El detalle previo de la carga masiva marca los IDs repetidos en el archivo y los ya usados.
- **Nunca dos envíos al banco por la misma operación**, con cuatro barreras independientes:
  1. La aprobación bloquea la fila y es un `UPDATE` condicional sobre `PENDIENTE_APROBACION`: de N aprobaciones simultáneas pasa una sola.
  2. Antes de llamar al banco se confirma una fila en `envio_banco` (clave primaria = id de la transferencia, solo inserción). Si ya existe, no se envía. `enviarUnaVez` es el único camino a una API de transferencia (lo verifica una prueba).
  3. Un trigger (`hb_transicion_valida`) rechaza cualquier cambio de estado fuera del circuito: nada vuelve a `PENDIENTE_APROBACION` ni a `ENVIANDO`.
  4. Los envíos nunca se reintentan automáticamente (ni por sesión vencida). `ERROR_API` solo cuando es seguro que no se ejecutó (no conectó, 4xx, `success:false`); timeout, corte, 5xx o respuesta ilegible quedan `ENVIADA` (incierta) para conciliar.
- **Transferencias interrumpidas:** el job `recuperar-enviando` (cada 5 minutos) toma las que quedaron en `ENVIANDO` más de 10 minutos. Con fila en `envio_banco` pasan a `ENVIADA` (incierta); sin ella, a `ERROR_API` (nunca salió). Nunca las reenvía.
- **Las consultas no requieren aprobación; las operaciones sí.** Crear no toca el banco; solo aprobar envía.
- **Permisos por empresa** en cada llamada: el banco devuelve todas las cuentas de VALO, así que el backend filtra por empresa activa y permiso Ver / Operar.
- **Administrador de seguridad** sin acceso a saldos ni operaciones, aunque el token traiga roles de operación.
- **Auditoría en la misma transacción** que cada acción; tablas de auditoría e historial de estados de solo inserción (trigger + permisos).
- **Pase mensual a la base histórica** (día 1, 02:10): la operativa conserva el mes en curso y `HB_RETENCION_MESES` meses completos anteriores (1 por defecto). Todo mes anterior se copia a la histórica, se verifica filas + hash y recién entonces se elimina de la operativa: transferencias, historial de estados y auditoría (partición del mes entera) y cola y log de envíos de correo (filas terminadas). Si un mes tiene transferencias sin estado final, se omite y se reintenta el mes siguiente; mientras tanto el corte de las consultas se corre a ese mes para que nada quede invisible.

## Pruebas

```sh
cd backend && npm install && npm test     # reglas: requests según el PDF, estados, RSA, cifrado, roles, TXT, pase histórico
```

**Pruebas de autorización de punta a punta** (contra el servidor real, con un SSO y un banco simulados). Necesitan Postgres; en el CI corren con un contenedor de servicio. Localmente, con `PGHOST/PGPORT/PGUSER/PGPASSWORD` apuntando a un Postgres:

```sh
cd backend && PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres sh test/e2e/correr.sh
```

Verifican acceso por empresa (BOLA), operación por id (IDOR), doble control y envío único, y límites de pedidos por usuario.

## Pendientes a confirmar

- Con el banco: qué campo de `getTransfersStatus` (`code` o `idTrn`) corresponde al `transactionId` devuelto al enviar; si los campos `ddjj*` de transferMep van como booleanos (ejemplo del PDF) o `S`/`N` (diccionario de datos).
- Con Operaciones: layout definitivo del TXT de ancho fijo (hoy es una propuesta en `src/servicios/lotes.js`).
- Con Cumplimiento: retención de la base histórica.


## Estado de validación y salida a producción

El código y el pipeline automatizado no sustituyen la habilitación operativa. Antes de una salida real:

- desplegar una **versión inmutable** usando `HB_VERSION=<commit>`, no depender solo de `alyc`;
- comenzar contra producción con `BDV_SOLO_CONSULTAS=true` y completar `PRUEBA-INTEGRADA.md`;
- custodiar secretos y la llave maestra fuera del servidor, en el mecanismo corporativo aprobado;
- conservar al menos una copia de resguardo **fuera del servidor** y probar periódicamente su restauración;
- habilitar métricas, monitor sintético y alertas; OpenTelemetry está disponible para integración con la plataforma de observabilidad;
- ejecutar pruebas controladas de indisponibilidad del banco, SSO, SMTP y base antes de habilitar transferencias.

La rama `ALYC` debe protegerse administrativamente en GitHub con PR y checks obligatorios. Esta configuración es externa al código y debe verificarse en el repositorio.
