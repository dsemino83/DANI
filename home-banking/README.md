# Home Banking VALO — backend y despliegue

Backend (BFF) en Node.js 22 + Fastify, dos Postgres (base operativa de 3 meses y base histórica) y Nginx, todo con Docker Compose. Los usuarios se autentican en el SSO de VALO (`https://ssohomo.valo.ar/valo/realms/staff`) y solo el backend se conecta con las APIs del Banco de Valores, con una única credencial (la de VALO).

```
navegador ──HTTPS──> frontend (Nginx) ──/api──> backend ──> APIs Banco de Valores
     │                                             │ ├──> postgres (operativa, 3 meses, particionada por mes)
     └── login OIDC + PKCE ──> SSO VALO <── JWKS ───┘ └──> postgres-historico (solo lectura)
                                         jobs: estado de transferencias (cada 5 min) y pase histórico (mensual)
```

## Puesta en marcha

```sh
cd home-banking
sh scripts/generar-secretos.sh      # crea ./secrets/*.txt y un certificado autofirmado (solo desarrollo)
cp .env.example .env                # completar OIDC_ISSUER, BDV_AMBIENTE, etc.
docker compose up -d --build        # homologación / producción (SSO de VALO)
docker compose --profile dev up -d  # además, Keycloak local en http://localhost:8081 (realm "staff" de prueba)
```

Después de levantar:
1. Entrar con el **administrador de seguridad** y cargar la credencial API Banking en `PUT /api/admin/credenciales/homo` (URL, usuario, clave, DNI, terminal y llave pública RSA del banco). La clave se cifra con AES-256-GCM y nunca se vuelve a mostrar.
2. Dar de alta empresas, asignarles cuentas y otorgar permisos Ver / Operar por empresa.
3. Asignar los roles `transferencias:crear` y `transferencias:aprobar` a los usuarios (en el SSO o vía `PUT /api/admin/usuarios/{usuario}/roles`).

### Lo que tiene que crear el equipo de Identidad en el realm `staff`

| Client | Tipo | Para qué |
|---|---|---|
| `home-banking-web` | público, Authorization Code + PKCE S256, mapper de audiencia `home-banking-api` | Login de la SPA |
| `home-banking-api` | bearer-only, con los roles de cliente `operador`, `autorizante`, `auditor`, `administrador`, `transferencias:crear`, `transferencias:aprobar` | Audiencia y roles del token |
| `home-banking-admin` | confidencial, service account con `realm-management: view-users, manage-users, view-clients` | Asignar Crear/Aprobar desde Permisos |

`keycloak/realm-staff-dev.json` es un ejemplo completo para desarrollo (usuarios `mgomez`, `lrodriguez`, `svillalba`, `admin.ti` con claves temporales).

## Secretos

| Archivo en `./secrets` | Uso |
|---|---|
| `db_owner_password.txt` / `dbh_owner_password.txt` | Dueño de cada base (solo inicialización y job del pase histórico) |
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
| `POST /transferencias` | rol Crear | **Carga interna**: queda PENDIENTE_APROBACION, no llama al banco |
| `GET /aprobaciones` | rol Aprobar | Pendientes (individuales y lotes) |
| `POST /transferencias/{id}/aprobar` · `/rechazar` | rol Aprobar, distinto de quien cargó | **Aprobar envía al banco** por la API del tipo |
| `POST /lotes` (multipart `archivo`) | rol Crear | CSV / XLSX / TXT → detalle previo (sin APIs de transferencia) |
| `POST /lotes/{id}/confirmar` | quien lo subió | Crea una transferencia pendiente por fila válida |
| `POST /lotes/{id}/aprobar` · `/rechazar` | rol Aprobar, distinto de quien lo subió | Una llamada al banco por fila |
| `GET /transferencias?desde&hasta[&estado]` | operativos | Base operativa (máximo 3 meses) |
| `GET /historico/transferencias?desde&hasta[&pagina]` | operativos | Base histórica (solo fechas anteriores al corte) |
| `GET /transferencias/{id}/auditoria` | operativos | Historial completo de una operación (⚙) |
| `GET /auditoria` · `GET /historico/auditoria` | auditor, administrador | Auditoría general, cada base por separado |
| `/admin/empresas`, `/admin/permisos/{usuario}`, `/admin/usuarios/{usuario}/roles`, `/admin/credenciales/{amb}` | administrador | Empresas, cuentas, permisos, roles y credencial API |

## Reglas que hace cumplir el backend (no solo la pantalla)

- **Doble control:** quien carga no puede aprobar (validado en el backend y con `CHECK (aprobador <> creador)` en la base). La aprobación es un `UPDATE` condicional sobre `PENDIENTE_APROBACION`: dos aprobaciones simultáneas no pueden enviar dos veces.
- **Las consultas no requieren aprobación; las operaciones sí.** Crear no toca el banco; solo aprobar envía.
- **Permisos por empresa** en cada llamada: el banco devuelve todas las cuentas de VALO, así que el backend filtra por empresa activa y permiso Ver / Operar.
- **Administrador de seguridad** sin acceso a saldos ni operaciones, aunque el token traiga roles de operación.
- **Auditoría en la misma transacción** que cada acción; tablas de auditoría e historial de estados de solo inserción (trigger + permisos).
- **Sin respuesta del banco tras enviar** (timeout): la transferencia queda `ENVIADA` sin reintento automático y se concilia con `getTransfersStatus`, para no duplicar pagos.
- **Pase mensual a la base histórica** (día 1, 02:10): copia cada partición de más de 3 meses, verifica filas + hash y recién entonces la separa y elimina de la operativa. Si un mes tiene transferencias sin estado final, se omite y se reintenta el mes siguiente.

## Pruebas

```sh
cd backend && npm install && npm test     # reglas: requests según el PDF, estados, RSA, cifrado, roles, TXT, pase histórico
```

## Pendientes a confirmar

- Con el banco: qué campo de `getTransfersStatus` (`code` o `idTrn`) corresponde al `transactionId` devuelto al enviar; si los campos `ddjj*` de transferMep van como booleanos (ejemplo del PDF) o `S`/`N` (diccionario de datos).
- Con Operaciones: layout definitivo del TXT de ancho fijo (hoy es una propuesta en `src/servicios/lotes.js`).
- Con Cumplimiento: retención de la base histórica.
- El frontend es un placeholder: falta el build de la SPA con las pantallas del prototipo.
