# Home Banking VALO — Documentación técnica

## Arquitectura

Contenedores Docker Compose, instalados en una máquina de la red interna de VALO (`iniciar.sh` / `iniciar.ps1`):

| Servicio | Imagen | Función |
| --- | --- | --- |
| `frontend` | Nginx 1.27 + SPA (JavaScript, módulos ES) | Sirve la aplicación en 443 y reenvía `/api/` al backend; CSP estricta |
| `backend` | Node 22 + Fastify | API para el navegador; valida usuarios y sesiones; único que habla con el banco |
| `jobs` | Misma imagen que el backend | Tareas programadas: estado de transferencias, envíos de correo, feriados, pase a la base histórica |
| `sqlserver` | SQL Server 2025 | Una instancia con dos bases: `homebanking` (operativa, mes en curso + `HB_RETENCION_MESES`) y `homebanking_hist` (histórica, solo lectura para la aplicación) |
| `mailpit` | Mailpit | Buzón local en `http://localhost:8025` (links para elegir clave, envíos programados) mientras no se configure el correo de VALO |
| `simulador` (solo modo sin internet) | Node 22 | Simulador del Banco de Valores con datos ficticios (`docker-compose.sin-internet.yml`) |

Las bases están en una red interna sin salida a internet. El navegador nunca habla con el banco. Por defecto el sitio se publica solo en `127.0.0.1` (la misma máquina); con `HB_ESCUCHA=0.0.0.0` lo ven las otras PCs de la red interna. En modo sin internet ningún contenedor tiene salida.

El **panel de estado del sistema** (pestaña del administrador) reinicia subsistemas lógicos dentro del backend —sesión con el banco, cola de envíos, feriados, verificación de integridad— pero **no** reinicia contenedores: eso se deja en la herramienta de operaciones (Portainer / `docker compose`), para no montar el socket de Docker en el backend y conservar el endurecimiento de los contenedores.

## Frontend

- SPA sin paso de build en `home-banking/frontend/public`. Nginx sirve los estáticos con `expires epoch` + ETag (siempre la última versión).
- Ingreso con usuario y clave propios (pantalla de la aplicación, sin SSO): clave temporal → clave nueva → OTP si corresponde. Token de sesión en `sessionStorage`, renovado mientras se usa.
- CSP `default-src 'self'` sin scripts ni estilos en línea: los anchos dinámicos se fijan por CSSOM.
- Datos del banco cacheados por sesión (`/cuentas*`, `/debitos*`); **↻ Actualizar datos** los vuelve a pedir.
- Buzón de mensajes: consulta `/mensajes/no-vistos` cada 30 s; alerta roja animada (respeta `prefers-reduced-motion`).

## Autenticación y autorización

| Dato | Valor |
| --- | --- |
| Usuarios | Tabla `usuario` de la base operativa; se administran en **Usuarios y permisos** |
| Claves | Hash scrypt (N=32768, r=8, p=1) con sal propia; mínimo 12 caracteres con letras y números; la temporal se cambia en el primer ingreso |
| Segundo factor | OTP (TOTP, RFC 6238) opcional por usuario; secreto cifrado con AES-256-GCM; un código no se acepta dos veces |
| Bloqueo | `HB_INTENTOS_MAX` claves u OTP erróneos seguidos → bloqueo de `HB_BLOQUEO_MINUTOS` (o hasta que el administrador lo desbloquee); además límite por IP en Nginx y en el backend |
| Sesión | JWT HS256 (llave derivada de la llave maestra) de `HB_SESION_MINUTOS`, renovable hasta `HB_SESION_HORAS_MAX`; en cada pedido se relee el usuario: deshabilitar, cambiar la clave, forzar el cambio o cerrar sesión invalida sus sesiones en el acto |
| Recupero | El administrador carga una clave temporal o envía un link por correo (válido 24 h, de un solo uso). Emergencias: `scripts/usuarios.sh restablecer <usuario>` desde la máquina |
| Primer administrador | `admin`, con la clave temporal de `secrets/admin_inicial_password.txt` (solo si la base no tiene usuarios) |

Roles: `operador`, `autorizante`, `auditor`, `administrador`, `transferencias:crear`, `transferencias:aprobar`. Permisos por empresa (Ver / Operar) y cartera de oficiales en SQL Server. El backend valida token, rol y permiso en cada pedido.

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
| `permiso_empresa`, `cartera_oficial`, `oficial_chat` | Ver / Operar por usuario; cartera de cada oficial; oficiales que reciben alertas por chat |
| `credencial_api` | Por ambiente y uso (`principal` / `envios`), clave cifrada AES-256-GCM, channel |
| `transferencia`, `transferencia_estado`, `auditoria` | Se pasan a la histórica por filas, mes a mes |
| `lote`, `lote_fila`, `envio_banco`, `referencia_usada`, `debito_transferencia` | Carga masiva, envío único, ID único, vínculo débito ↔ transferencia |
| `programacion_envio`, `ejecucion_envio`, `cola_envio`, `envio_mail_log`, `feriado` | Envíos programados de correo (programación → ejecución EJ-… → tareas) |
| `mensaje` | Buzón: destinatario, operación, leído (`visto_en`, `visto_motivo`) |
| `pase_historico` | Registro de cada pase a la histórica |

Esquema en `db/esquema/<base>/NNN_*.sql` (T-SQL), aplicado una sola vez cada archivo y dentro de una transacción por `db-init` (queda registrado en `dbo.hb_migracion`); `scripts/migrar-bases.sh` (y `hb-actualizar`) lo repite sobre una instalación existente. La tabla `oficial_chat` marca qué oficiales reciben las alertas por chat de Teams.

## Motor de pagos

La autorización no envía al banco en el acto. **Aprobar** valida (doble control, riesgo, permiso) y deja la transferencia en estado **`EN_COLA`**; un **motor de pagos** la toma y la envía. Esto evita superposiciones y deja una sola fila de la verdad.

- **Circuito de estados** (lo fuerza la base con el trigger `hb_transicion_valida`, no se puede saltear): `PENDIENTE_APROBACION` → **`EN_COLA`** (autorizada) → `ENVIANDO` (la tomó el motor) → `DEBITADA` / `PEND_AUTORIZACION` / `ERROR_API` / `RECHAZADA_BANCO`. Rechazar va de `PENDIENTE_APROBACION` a `RECHAZADA`. Ninguna retrocede.
- **Autorización única:** el paso a `EN_COLA` es un `UPDATE` condicional bajo `FOR UPDATE`; dos autorizaciones simultáneas de la misma operación → solo una entra, la otra recibe *"ya fue autorizada"*. Al banco se envía una sola vez (`envio_banco`, PK = id de la transferencia).
- **Motor** (`src/servicios/motor-pagos.js`, corriendo en `jobs` cada 2 s): toma la `EN_COLA` más vieja de **cada endpoint** (`api`) con `FOR UPDATE SKIP LOCKED` ordenando por `creado_en`, y **paraleliza solo entre endpoints distintos** (inmediata, propias, terceros, MEP); dentro de un endpoint es estrictamente serie y por orden de creación. Reutiliza el único camino de envío (`enviarUnaVez`). **No reintenta**: un envío con error queda `ENVIANDO`/`ERROR_API` y lo concilia el job de estado con `getTransfersStatus`.
- En **modo solo consultas** el motor no envía nada (y la autorización ya se rechaza antes de encolar).
- **Pantalla "Pagos en proceso"** (`GET /pagos/cola`, perfiles operativos; no el administrador): en cola por orden de creación, enviándose y resueltas de las últimas 24 h, con resumen por endpoint. Se filtra por las cuentas habilitadas del usuario.

## Envíos programados de correo

- **Motor** (hora de Argentina, UTC-3): turnos diarios, cada hora o cada 30 minutos entre "desde" y "hasta"; días de la semana, inicio, fin y feriados (ArgentinaDatos, con Nolaborables de respaldo; manuales para días bancarios).
- **Cola** `cola_envio`: el programador encola una tarea por cliente y turno (única); un único trabajador las toma con `FOR UPDATE SKIP LOCKED` cada 15 s. Reintentos a 1, 5 y 15 min; tareas colgadas se retoman a los 10 min.
- **Diaria = extracto:** saldos y/o movimientos del día. **Horaria / 30 min = alerta:** movimientos con hora en `[turno − 29:59, turno]` (si cruza la medianoche consulta los dos días); sin movimientos no se envía.
- **Correo:** nodemailer por `HB_SMTP_*` (remitente `alyc@valo.ar`), logo embebido (CID). Adjunto opcional: un Excel con una pestaña por cuenta, logo, título y cliente (exceljs).
- **Salida de respaldo (opcional):** con `HB_SMTP2_*` configurado, si el servidor principal falla el correo se reintenta por el secundario y la tarea lo anota (*"por SMTP de respaldo"*). Evita que una caída del relay deje a los clientes sin alerta y, de paso, que se corte la notificación por chat (va después del correo). El respaldo debe ser una salida **aprobada**: estos correos llevan movimientos de cuentas de clientes.
- Un cliente: un extracto y una alerta activos como máximo.
- **Alertas por chat de Teams (Power Automate):** solo las alertas de movimientos (no el extracto). Después del correo al cliente, y una vez por tarea, el motor llama a un flujo de Power Automate (`HB_POWERAUTOMATE_URL`, secreto; vacío = no se envía) que publica el **mismo contenido** por chat de Teams a los oficiales de la cartera del cliente con el chat activado (`oficial_chat`). El destinatario se arma con el usuario: si no contiene `@valo` se le agrega `HB_CHAT_DOMINIO` (por defecto `@valo.ar`). Es best-effort: un error del flujo no falla la tarea (el correo ya salió) y queda en el detalle. El flujo está documentado en `powerautomate/ALERTAS-TEAMS.md`.
- **Id transaccional de ejecución** (`ejecucion_envio`, código `EJ-000123`): cada turno (o "Ejecutar ahora") crea, en la misma transacción que encola, una ejecución única por programación y turno; cada tarea de la cola lleva su `ejecucion_id`. La ejecución acumula tareas, enviadas, omitidas, errores y **consultas reales al banco**, y queda *terminada* cuando no le queda nada en cola.
- **Consultas al banco optimizadas:** caché compartida por toda la cola con una sola consulta en vuelo por clave: `getOwnAccounts` 60 s; `getMovementsDetail` por cuenta y día, 60 s el día en curso y 30 min los días cerrados. Solo se consultan las cuentas elegidas, los movimientos solo si el contenido los necesita, la alerta solo el día de la franja (y el anterior si cruza la medianoche), y las tareas omitidas no consultan nada. Los errores no se guardan en la caché.

## Base operativa e histórica

- `HB_RETENCION_MESES` (1): la operativa conserva el mes en curso y ese número de meses completos.
- Pase el día 1 a las 02:10 (`src/jobs/pase-historico.js`): filas de transferencias, estados y auditoría anteriores al corte; de `cola_envio`, `ejecucion_envio`, `envio_mail_log` y mensajes, solo las terminadas. Un mes con transferencias abiertas se omite. Copia en lotes JSON, verifica filas + SHA-256 y recién entonces borra el origen.
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
HB_ESCUCHA=127.0.0.1   # 0.0.0.0 = red interna
```

Secretos en `secrets/*.txt` (fuera del repositorio): claves de las bases, `credenciales_master_key`, `admin_inicial_password`, `smtp_password`.

## Operación

- **Iniciar / actualizar:** `./iniciar.sh` (banco real) o `./iniciar.sh simulador` (sin internet); después de cambiar el código, `--reconstruir`. Las migraciones se aplican solas al arrancar. **Detener:** `./detener.sh`.
- **Resguardo:** `BACKUP DATABASE` diario de ambas bases; nunca `docker compose down -v` en el servidor.
- **CI:** GitHub Actions corre, antes de publicar las imágenes y como compuerta (si algo falla no se publica):
  - **pruebas** unitarias del backend (incluye la separación de funciones por rol);
  - **seguridad:** `npm audit` de producción (bloquea en crítica), gitleaks (secretos en el repo e historial) y Trivy (vulnerabilidades e IaC, informativo);
  - **autorización** de punta a punta contra el servidor real con un banco simulado e ingreso real con usuario y clave (`backend/test/e2e`): acceso por empresa (BOLA), operación por id (IDOR), doble control y envío único, y límite de pedidos por usuario;
  - **humo:** levanta el stack completo y verifica esquema, migraciones, correo (Mailpit), las cabeceras de seguridad y la CSP.

## Seguridad aplicada y hoja de ruta

| Pilar | Aplicado en el sistema | Pendiente (requiere infraestructura o a otras áreas) |
| --- | --- | --- |
| Cifrado | TLS 1.3/1.2 sin tickets, HSTS; credenciales API con AES-256-GCM (llave maestra en secreto de Docker); resguardos cifrados AES-256 con HMAC | Llaves en **HSM / Vault** con rotación automática; mTLS entre servicios (service mesh) |
| Zero Trust y red | Redes separadas `app` y `datos` sin salida a internet (el frontend no llega a las bases); contenedores sin capacidades, sin escalada de privilegios, backend y jobs de solo lectura; límites de memoria y procesos | Kubernetes con Cilium/OPA; ZTNA para el acceso del personal; acceso privilegiado just-in-time |
| Identidad | Usuarios propios con clave scrypt, OTP opcional por usuario, bloqueo por intentos, roles y permisos por empresa validados en cada pedido, doble control, límites de pedidos por usuario e IP | **Passkeys (FIDO2)** y step-up para aprobar; integración con el directorio corporativo si se decide volver a un SSO |
| Fraude | Señales de riesgo por transferencia (destino nuevo, monto atípico o alto, ráfagas, fuera de horario); riesgo ALTO exige confirmación explícita y queda auditado | Motor de fraude en tiempo real con modelos; biometría comportamental |
| Privacidad | Datos del banco no se almacenan (solo lo propio de la app); CBU/CUIT/cuentas enmascarados en los logs; datos de prueba sintéticos | Tokenización de CBU/CUIT en una bóveda; base analítica separada con datos seudonimizados |
| Auditoría | Solo inserción, **cadena de hashes SHA-256** verificable (pantalla y diaria), id de pedido de punta a punta, base histórica de solo lectura | Envío al **SIEM** (Sentinel / Splunk / Wazuh) y almacenamiento WORM de logs |
| Resiliencia | Healthchecks, reinicio automático, cola con reintentos, una sola consulta al banco por clave; resguardo cifrado con prueba de restauración | Alta disponibilidad (SQL Server con Always On o clúster, 2+ nodos), segunda región, RPO/RTO cercanos a cero |
| Verificación | Pruebas de seguridad automatizadas como compuerta del CI: separación de roles, acceso por empresa (BOLA), operación por id (IDOR), doble control y envío único, límites de pedidos, cabeceras y CSP, dependencias y secretos | Prueba de penetración contra el banco y el SSO reales; escaneo dinámico (ZAP) periódico contra staging |

## API del backend (principales rutas)

| Ruta | Perfil | Uso |
| --- | --- | --- |
| `GET /me` | todos | Usuario, roles, corte de las bases |
| `GET /cuentas`, `/cuentas/:n/movimientos`, `/debitos` | operativos | Consultas al banco (`?formato=xlsx` exporta) |
| `GET /cuentas/:n/constancia` | operativos | Constancia de CBU |
| `POST /transferencias`, `/lotes` | rol Crear | Carga (queda pendiente) |
| `POST /transferencias/:id/aprobar` | rol Aprobar | Autoriza y encola el pago (EN_COLA); el motor lo envía |
| `GET /pagos/cola` | operativos (no administrador) | Estado del motor de pagos: en cola, enviándose, resueltas 24 h |
| `GET /historico/transferencias`, `/historico/auditoria` | operativos / auditor | Base histórica |
| `/envios`, `/envios/cola`, `/feriados` | autorizante | Envíos programados |
| `GET /mensajes`, `/mensajes/no-vistos`, `POST /mensajes/:id/visto` | todos | Buzón |
| `/admin/...` | administrador | Empresas, usuarios, permisos, credenciales (`?uso=principal\|envios`) |
| `GET /sistema/estado` | administrador | Estado de cada subsistema (backend, bases, banco, cola, feriados, auditoría, pase) |
| `POST /sistema/{reconectar-banco,reprocesar-cola,refrescar-feriados,verificar-integridad}` | administrador | Reinicios seguros por subsistema, sin tocar contenedores; auditados |
| `GET /docs/:nombre` | manual: todos; auditoría y técnica: auditor y administrador | Esta documentación |
| `GET /auditoria/integridad` | auditor y administrador | Verifica la cadena de hashes de la auditoría |


## Mínimo privilegio de base de datos

Los procesos no comparten un usuario privilegiado:

- `backend`: `hb_app`;
- `jobs`: `hb_jobs`, con permisos explícitos solo sobre las tablas/secuencias que necesita y sin DELETE;
- pase histórico: `hb_pase` y `hb_pase_h`;
- lectura histórica: `hb_hist_ro`.

El login `sa` queda reservado para inicialización/migración y no son credenciales de ejecución de la aplicación.

## Observabilidad y DR

`METRICS_ENABLED` habilita métricas para Prometheus y `SYNTHETIC_MONITOR_ENABLED` ejecuta comprobaciones sintéticas de solo lectura del banco. OpenTelemetry se habilita con `OTEL_ENABLED` y exporta por OTLP; la configuración de referencia está en `ops/docker-compose.otel.yml`. La persistencia/retención de trazas depende de la plataforma de observabilidad elegida.

El CI ejecuta `resguardo.sh` y un simulacro de restauración mediante `probar-dr.sh`. Un fallo del `BACKUP` impide marcar el resguardo como completo y la restauración de prueba valida tablas centrales. Para producción se requiere además copia externa al host, retención y simulacros periódicos.

## Versionado de despliegue

Para una liberación aprobada usar `HB_VERSION=<commit>` y registrar ese commit como evidencia. La etiqueta `alyc` es útil para pruebas continuas, pero una versión fijada facilita trazabilidad y rollback.
