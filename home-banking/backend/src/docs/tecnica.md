# Home Banking VALO — Documentación técnica

## Arquitectura

Contenedores Docker Compose (imágenes publicadas por GitHub Actions en Docker Hub, etiqueta `alyc` o el commit):

| Servicio | Imagen | Función |
| --- | --- | --- |
| `frontend` | Nginx 1.27 + SPA (JavaScript, módulos ES) | Sirve la aplicación en 443 y reenvía `/api/` al backend; CSP estricta |
| `backend` | Node 22 + Fastify | API para el navegador; único que habla con el SSO y con el banco |
| `jobs` | Misma imagen que el backend | Tareas programadas: estado de transferencias, envíos de correo, feriados, pase a la base histórica |
| `postgres` | Postgres 16.4 | Base operativa (mes en curso + `HB_RETENCION_MESES`) |
| `postgres-historico` | Postgres 16.4 | Base histórica, solo lectura para la aplicación |
| `keycloak` (perfil `sso-local`) | Keycloak 26 en `/auth` | SSO propio para pruebas; en VALO se usa el SSO corporativo |
| `mailpit` (perfil `correo-prueba`) | Mailpit | Buzón de prueba en el puerto 8025 |

Las bases están en una red interna sin salida a internet. El navegador nunca habla con el banco.

## Frontend

- SPA sin paso de build en `home-banking/frontend/public`. Nginx sirve los estáticos con `expires epoch` + ETag (siempre la última versión).
- Login OIDC Authorization Code + PKCE (S256); tokens en `sessionStorage`.
- CSP `default-src 'self'` sin scripts ni estilos en línea: los anchos dinámicos se fijan por CSSOM.
- Datos del banco cacheados por sesión (`/cuentas*`, `/debitos*`); **↻ Actualizar datos** los vuelve a pedir.
- Buzón de mensajes: consulta `/mensajes/no-vistos` cada 30 s; alerta roja animada (respeta `prefers-reduced-motion`).

## Autenticación y autorización

| Dato | Valor |
| --- | --- |
| Issuer | `OIDC_ISSUER` (SSO de VALO, realm `staff`) |
| Cliente SPA | `home-banking-web` (público, PKCE) |
| Audiencia / roles | `home-banking-api` |
| Administración de usuarios | Service account `home-banking-admin` (secreto `keycloak_admin_client_secret`) |

Roles: `operador`, `autorizante`, `auditor`, `administrador`, `transferencias:crear`, `transferencias:aprobar`. Permisos por empresa (Ver / Operar) y cartera de oficiales en Postgres. El backend valida token, rol y permiso en cada pedido.

## Integración con el Banco de Valores

- URL según `BDV_AMBIENTE` (`homo` → apihomo.bancodevalores.com, `prod` → api.bancodevalores.com); no se carga a mano.
- **Dos clientes del banco**, cada uno con su sesión: el **principal** (Home Banking) y el de **envíos programados** (credencial `uso = envios`; si no está cargada usa la principal). El proceso `jobs` detecta en menos de un minuto que una credencial cambió.
- Sesión: `login` (clave cifrada RSA o ya cifrada por el banco) → `getUserEntityInformation`. Si el banco no entrega cookie, se prueba el `sessionId` de la respuesta. La sesión vence por inactividad (`BDV_SESION_MINUTOS`, 20).
- `getMovementsDetail` pagina de a 900 (`mode` 0/1 con `sequential`/`uniqueSequential`).
- **Causal del movimiento:** campo `reference` ("Referencia causa"); `cbuOri` se informa solo en las causales **366 y 367**.
- COELSA: `getCustomerInformationCbu` (si `cbu` viene vacío se usa el consultado).

## Modelo de datos (base operativa)

| Tabla | Contenido |
| --- | --- |
| `empresa`, `empresa_cbu` | Clientes (CUIT, emails) y sus cuentas / CBU |
| `permiso_empresa`, `cartera_oficial` | Ver / Operar por usuario; cartera de cada oficial |
| `credencial_api` | Por ambiente y uso (`principal` / `envios`), clave cifrada AES-256-GCM, channel |
| `transferencia`, `transferencia_estado`, `auditoria` | Particionadas por mes |
| `lote`, `lote_fila`, `envio_banco`, `referencia_usada`, `debito_transferencia` | Carga masiva, envío único, ID único, vínculo débito ↔ transferencia |
| `programacion_envio`, `ejecucion_envio`, `cola_envio`, `envio_mail_log`, `feriado` | Envíos programados de correo (programación → ejecución EJ-… → tareas) |
| `mensaje` | Buzón: destinatario, operación, leído (`visto_en`, `visto_motivo`) |
| `pase_historico` | Registro de cada pase a la histórica |

Migraciones idempotentes en `db/operativa/migraciones` (001 a 013): una base nueva las aplica al crearse; `scripts/migrar-bases.sh` (y `hb-actualizar`) en una existente.

## Envíos programados de correo

- **Motor** (hora de Argentina, UTC-3): turnos diarios, cada hora o cada 30 minutos entre "desde" y "hasta"; días de la semana, inicio, fin y feriados (ArgentinaDatos, con Nolaborables de respaldo; manuales para días bancarios).
- **Cola** `cola_envio`: el programador encola una tarea por cliente y turno (única); un único trabajador las toma con `FOR UPDATE SKIP LOCKED` cada 15 s. Reintentos a 1, 5 y 15 min; tareas colgadas se retoman a los 10 min.
- **Diaria = extracto:** saldos y/o movimientos del día. **Horaria / 30 min = alerta:** movimientos con hora en `[turno − 29:59, turno]` (si cruza la medianoche consulta los dos días); sin movimientos no se envía.
- **Correo:** nodemailer por `HB_SMTP_*` (remitente `alyc@valo.ar`), logo embebido (CID). Adjunto opcional: un Excel con una pestaña por cuenta, logo, título y cliente (exceljs).
- Un cliente: un extracto y una alerta activos como máximo.
- **Id transaccional de ejecución** (`ejecucion_envio`, código `EJ-000123`): cada turno (o "Ejecutar ahora") crea, en la misma transacción que encola, una ejecución única por programación y turno; cada tarea de la cola lleva su `ejecucion_id`. La ejecución acumula tareas, enviadas, omitidas, errores y **consultas reales al banco**, y queda *terminada* cuando no le queda nada en cola.
- **Consultas al banco optimizadas:** caché compartida por toda la cola con una sola consulta en vuelo por clave: `getOwnAccounts` 60 s; `getMovementsDetail` por cuenta y día, 60 s el día en curso y 30 min los días cerrados. Solo se consultan las cuentas elegidas, los movimientos solo si el contenido los necesita, la alerta solo el día de la franja (y el anterior si cruza la medianoche), y las tareas omitidas no consultan nada. Los errores no se guardan en la caché.

## Base operativa e histórica

- `HB_RETENCION_MESES` (1): la operativa conserva el mes en curso y ese número de meses completos.
- Pase el día 1 a las 02:10 (`src/jobs/pase-historico.js`): particiones de transferencias, estados y auditoría; filas terminadas de `cola_envio`, `envio_mail_log` y mensajes leídos. Copia en lotes JSON, verifica filas + hash, borra el origen.
- El corte de las consultas (`fechaCorte`) se corre al mes más viejo que todavía esté en la operativa, para que nada quede invisible.
- Manual: `docker compose exec jobs node src/jobs/pase-historico.js`.

## Configuración

```env
BDV_AMBIENTE=prod
BDV_SOLO_CONSULTAS=true
HB_RETENCION_MESES=1
HB_SMTP_HOST=...
HB_SMTP_PORT=587
HB_SMTP_FROM=alyc@valo.ar
HB_SMTP_USUARIO=...
OIDC_ISSUER=https://ssohomo.valo.ar/valo/realms/staff
```

Secretos en `secrets/*.txt` (fuera del repositorio): claves de las bases, `credenciales_master_key`, `keycloak_admin_client_secret`, `smtp_password`.

## Operación

- **Actualizar** (máquina de prueba): `hb-actualizar` (cambia a la rama ALYC, baja imágenes, levanta y migra). Servidor: `docker compose pull && docker compose up -d && sh scripts/migrar-bases.sh`.
- **Resguardo:** `pg_dump` diario de ambas bases; nunca `docker compose down -v` en el servidor.
- **CI:** GitHub Actions construye las imágenes, levanta el stack completo y prueba esquema, migraciones, correo (Mailpit), Keycloak y la CSP antes de publicar.

## Seguridad aplicada y hoja de ruta

| Pilar | Aplicado en el sistema | Pendiente (requiere infraestructura o a otras áreas) |
| --- | --- | --- |
| Cifrado | TLS 1.3/1.2 sin tickets, HSTS; credenciales API con AES-256-GCM (llave maestra en secreto de Docker); resguardos cifrados AES-256 con HMAC | Llaves en **HSM / Vault** con rotación automática; mTLS entre servicios (service mesh) |
| Zero Trust y red | Redes separadas `app` y `datos` sin salida a internet (el frontend no llega a las bases); contenedores sin capacidades, sin escalada de privilegios, backend y jobs de solo lectura; límites de memoria y procesos | Kubernetes con Cilium/OPA; ZTNA para el acceso del personal; acceso privilegiado just-in-time |
| Identidad | SSO OIDC + PKCE, roles y permisos por empresa validados en cada pedido, doble control, límites de pedidos por usuario e IP | MFA / **passkeys (FIDO2)** y step-up para aprobar: se configuran en el SSO de VALO (Identidad) |
| Fraude | Señales de riesgo por transferencia (destino nuevo, monto atípico o alto, ráfagas, fuera de horario); riesgo ALTO exige confirmación explícita y queda auditado | Motor de fraude en tiempo real con modelos; biometría comportamental |
| Privacidad | Datos del banco no se almacenan (solo lo propio de la app); CBU/CUIT/cuentas enmascarados en los logs; datos de prueba sintéticos | Tokenización de CBU/CUIT en una bóveda; base analítica separada con datos seudonimizados |
| Auditoría | Solo inserción, **cadena de hashes SHA-256** verificable (pantalla y diaria), id de pedido de punta a punta, base histórica de solo lectura | Envío al **SIEM** (Sentinel / Splunk / Wazuh) y almacenamiento WORM de logs |
| Resiliencia | Healthchecks, reinicio automático, cola con reintentos, una sola consulta al banco por clave; resguardo cifrado con prueba de restauración | Alta disponibilidad (Postgres con réplica, 2+ nodos), segunda región, RPO/RTO cercanos a cero |

## API del backend (principales rutas)

| Ruta | Perfil | Uso |
| --- | --- | --- |
| `GET /me` | todos | Usuario, roles, corte de las bases |
| `GET /cuentas`, `/cuentas/:n/movimientos`, `/debitos` | operativos | Consultas al banco (`?formato=xlsx` exporta) |
| `GET /cuentas/:n/constancia` | operativos | Constancia de CBU |
| `POST /transferencias`, `/lotes` | rol Crear | Carga (queda pendiente) |
| `POST /transferencias/:id/aprobar` | rol Aprobar | Aprobación y envío |
| `GET /historico/transferencias`, `/historico/auditoria` | operativos / auditor | Base histórica |
| `/envios`, `/envios/cola`, `/feriados` | autorizante | Envíos programados |
| `GET /mensajes`, `/mensajes/no-vistos`, `POST /mensajes/:id/visto` | todos | Buzón |
| `/admin/...` | administrador | Empresas, usuarios, permisos, credenciales (`?uso=principal\|envios`) |
| `GET /docs/:nombre` | manual: todos; auditoría y técnica: auditor y administrador | Esta documentación |
| `GET /auditoria/integridad` | auditor y administrador | Verifica la cadena de hashes de la auditoría |
