# Home Banking VALO — Documentación para auditoría

## Alcance y objetivo

Este documento describe los controles del Home Banking VALO, aplicación interna que consulta saldos y movimientos y opera transferencias de las empresas clientes a través de las APIs del Banco de Valores (Documentación Técnica APIs Banco de Valores v1.22). Incluye además los envíos programados de correo a los clientes y el buzón de avisos interno.

| Elemento | Detalle |
| --- | --- |
| Sistema | Home Banking VALO: frontend, backend, proceso de tareas (jobs), base operativa y base histórica, con Docker |
| Usuarios | Personal de VALO con usuario propio del Home Banking (alta, perfil y bajas a cargo del administrador de seguridad) |
| Funciones auditadas | Consultas (saldos, movimientos, débitos, CBU, constancias); carga y aprobación de transferencias; administración de empresas, usuarios, permisos y credenciales; envíos programados de correo; pase a la base histórica |
| APIs del banco | login, getUserEntityInformation, getOwnAccounts, getBalancesDetail, getMovementsDetail, getCustomerInformationCbu, immediates, transferBetweenOwnAccount, transferThirdPartyAccount, transferMep, getTransfersStatus |
| Fuera de alcance | eCheq; conciliación por ID de movimiento (no disponible en la API v1.22) |

## Roles y segregación de funciones

Ninguna transferencia llega al banco sin dos personas distintas: una la carga (rol Crear) y otra la aprueba (rol Aprobar). El sistema rechaza que un usuario apruebe lo que él mismo cargó, aunque tenga ambos roles. El administrador de seguridad no opera ni ve saldos.

| Función | Operador | Autorizante | Auditor | Administrador de seguridad |
| --- | --- | --- | --- | --- |
| Saldos, movimientos, débitos (empresas habilitadas) | Sí | Sí | Sí | No |
| Consulta de CBU / constancia | Sí | Sí | No | No |
| Crear transferencias y lotes (rol Crear) | Sí | No | No | No |
| Autorizar transferencias (rol Aprobar) | No | Sí | No | No |
| Pagos en proceso (estado del motor de pagos) | Sí | Sí | Sí | No |
| Cartera de oficiales | No | Sí | No | No |
| Envíos programados de correo | No | Sí | No | No |
| Auditoría general (solo lectura) | No | No | Sí | Sí |
| Empresas, usuarios, permisos, credenciales | No | No | No | Sí |
| Estado del sistema y mantenimiento (reinicios seguros) | No | No | No | Sí |
| Documentación de auditoría y técnica | No | No | Sí | Sí |

- Los roles y permisos los asigna el administrador; no puede asignárselos a sí mismo.
- Nadie aprueba lo que creó: el backend lo valida en cada aprobación.

## Control de acceso

1. **Autenticación:** usuario y clave propios del Home Banking. La clave se guarda como hash scrypt con sal (nunca en claro ni en la auditoría); la clave temporal se cambia obligatoriamente en el primer ingreso. OTP (app de autenticación) obligatorio por usuario cuando lo define el administrador. Tras varios intentos fallidos el usuario queda bloqueado; recupero con clave temporal o link por correo de un solo uso (24 h). Cada ingreso, rechazo y bloqueo queda en la auditoría (tipo **Accesos**).
2. **Autorización por rol:** el backend valida firma, emisor, audiencia y vencimiento del token en cada pedido, y relee el usuario de la base: perfil y roles vigentes; un usuario deshabilitado o con las sesiones cerradas queda afuera en el acto.
3. **Autorización por empresa:** permisos **Ver** / **Operar** por usuario y empresa. Sin permiso sobre la empresa, sus cuentas no existen para el usuario. Un oficial con cartera asignada ve solo esos clientes.
4. **Empresa desactivada:** suspende sus permisos al instante; **eliminada:** libera sus cuentas y borra los permisos.
5. **Modo solo consultas** (`BDV_SOLO_CONSULTAS=true`): ninguna aprobación envía transferencias al banco.

## Circuito de transferencias

Cada paso queda registrado con fecha, hora y usuario: carga → **Pendiente de aprobación** → **autorización** (o rechazo) → **En cola de pago** → **Enviando** (lo toma el motor de pagos) → **Debitada / Pendiente de autorización en el banco / Error API**. Lo rechazado nunca llega al banco. El estado se concilia con getTransfersStatus. La base rechaza cualquier salto fuera de este circuito (trigger de transiciones).

- **Autorización única:** el paso a *En cola* es un cambio de estado condicional bajo bloqueo de fila; dos autorizaciones simultáneas de la misma operación no pueden entrar las dos (al segundo le avisa "ya fue autorizada").
- **Motor de pagos:** las operaciones autorizadas se envían desde una cola **ordenada por hora de creación**, paralelizando solo entre endpoints distintos; el resto es en serie. Evita superposiciones y deja el avance visible en "Pagos en proceso".
- **Un solo envío por operación:** cada envío deja antes un registro único (`envio_banco`, clave primaria = id de la operación) y los envíos no se reintentan automáticamente.
- **ID de operación único:** una misma referencia no se puede volver a cargar nunca (`referencia_usada`).
- **Aviso a los autorizantes:** al cargarse una operación pendiente se crea, en la misma transacción, un mensaje en el buzón de cada persona asociada al cliente (salvo quien la cargó). Queda registrado cuándo lo leyó cada destinatario, o que se marcó solo porque la operación ya fue resuelta.

## Registro de auditoría

Toda acción queda registrada en el momento, en un registro **de solo inserción** (ni la aplicación ni nadie puede editarlo ni borrarlo). Lo consultan el auditor y el administrador de seguridad.

**Campos:** ID, fecha y hora, usuario, rol, tipo, acción, API invocada, detalle (antes → después) y resultado.

| Tipo | Eventos registrados |
| --- | --- |
| Accesos | Inicio y cierre de sesión, intentos rechazados |
| Transferencias | Carga individual y de lote, aprobación, rechazo, envío y cambios de estado |
| Administración | Empresas, emails (incluye "cambió X por Y"), cuentas, permisos, roles, usuarios, credenciales API (sin el valor de la clave), programaciones de envíos, feriados, cartera de oficiales y su alerta por chat; mantenimiento del sistema (reconectar banco, reprocesar cola, refrescar feriados, verificar integridad); acciones rechazadas |
| Consultas | Saldos, movimientos, CBU, constancias de CBU, exportaciones a Excel, consultas a la base histórica |
| Sistema | Pase mensual a la base histórica (por tabla y mes, con filas y hash) |

- **Integridad:** la auditoría se escribe en la misma transacción que la acción y cada registro lleva el **hash SHA-256 encadenado** con el anterior: modificar, borrar o intercalar un registro rompe la cadena. **Verificar integridad** (pantalla Auditoría) y la verificación diaria lo detectan y lo registran.
- **Id de pedido:** cada pedido lleva un id (`x-request-id`) que aparece en los logs de Nginx y del backend, para seguirlo de punta a punta.
- **Nunca se registra:** el valor de la clave API, la cookie de sesión del banco ni tokens.
- **Auditoría por operación (⚙):** historial completo de cada transferencia o débito.

## Credenciales y secretos

- **Dos credenciales API por ambiente:** la **principal** (Home Banking) y una **exclusiva de envíos programados** (usuario API distinto, su propia sesión en el banco). Solo las carga el administrador de seguridad; la clave es de solo escritura y se cifra con AES-256-GCM (llave maestra en un secreto de Docker).
- La URL del banco la fija el ambiente: producción nunca puede apuntar a homologación.
- Contraseñas de bases y del SMTP, llave maestra y clave inicial del administrador: secretos de Docker, fuera del repositorio.

## Envíos programados de correo

- Los programa el **autorizante**, solo sobre clientes que ve; al enviar se vuelve a validar con sus permisos.
- Un cliente puede tener **un solo extracto diario y una sola alerta** activos.
- Cada ejecución tiene un **id transaccional** (EJ-000123) que agrupa sus tareas y registra sus totales y las consultas hechas al banco.
- Cola de tareas sin superposición, con reintentos; cada tarea termina en un correo y queda registrada (ejecución, destinatarios, estado, detalle).
- Remitente **alyc@valo.ar**; los correos llevan saldos y movimientos, por eso el servidor SMTP debe usar TLS.
- **Alertas por chat de Teams:** solo las alertas de movimientos (no el extracto). Después del correo al cliente, el sistema llama a un flujo de Power Automate que publica el mismo contenido por chat a los oficiales de la cartera con el chat activado (`oficial_chat`). Activar o desactivar ese chat por oficial queda auditado (Administración). La URL del flujo es un secreto; si no está configurada, solo se manda el correo.

## Base operativa e histórica

- La base operativa conserva el **mes en curso y el mes anterior completo** (`HB_RETENCION_MESES=1`).
- El **día 1 de cada mes** el proceso de tareas pasa a la base histórica (solo lectura) las transferencias, su historial de estados y la auditoría (por mes), y las filas terminadas de la cola y log de envíos y los mensajes leídos.
- Cada pase se **verifica por cantidad de filas y hash** antes de borrar el origen y queda en `pase_historico`, `pase_recibido` y en la auditoría.
- Si un mes tiene transferencias sin estado final, se omite y se reintenta; mientras tanto las consultas lo siguen mostrando desde la operativa.

## Matriz de controles

| ID | Control | Riesgo que mitiga | Evidencia |
| --- | --- | --- | --- |
| C01 | Autenticación con usuario propio (clave scrypt, OTP opcional, bloqueo por intentos) | Acceso no autorizado | Auditoría tipo Accesos (ingresos, rechazos, bloqueos); ficha del usuario en Usuarios y permisos |
| C02 | Doble control: Crear y Aprobar en usuarios distintos | Transferencia de una sola persona | Registro de transferencias (cargó / aprobó) |
| C03 | Bloqueo de autoaprobación | Evadir el doble control | Prueba: usuario con ambos roles no aprueba lo propio |
| C04 | Permisos por empresa validados en el backend | Acceso a cuentas de otra empresa | Matriz de permisos; auditoría de cambios |
| C05 | Desactivar / eliminar empresa suspende o borra permisos | Accesos remanentes | Auditoría de altas y bajas |
| C06 | Administrador sin acceso a operaciones | Conflicto de funciones | Pestañas por rol |
| C07 | Auditoría de solo inserción, en la misma transacción | Acciones sin rastro | Permisos de la tabla; muestra de registros |
| C08 | Credenciales API de solo escritura, cifradas; credencial separada para envíos | Filtración de la credencial; cortes de sesión | Secreto de la llave maestra; auditoría de cambios |
| C09 | Detalle previo obligatorio en carga masiva | Envío de filas inválidas | Validación por fila |
| C10 | Validación de CBU destino en COELSA | Desvío por CBU inválido | Auditoría de consultas |
| C11 | Pase mensual verificado (filas + hash) | Pérdida o alteración al archivar | `pase_historico` y `pase_recibido` |
| C12 | Base histórica de solo lectura | Modificación de históricos | Permisos y triggers de la base histórica |
| C13 | Documentación de auditoría y técnica solo para auditor y administrador | Exposición de controles | Acceso validado en el backend |
| C14 | Seguridad del navegador: CSP estricta, HSTS | Robo de sesión o inyección | Encabezados de Nginx |
| C15 | Un solo envío al banco por operación; autorización única y motor de pagos ordenado | Doble débito; doble autorización; superposición de envíos | `envio_banco`; trigger de transiciones; `motor-pagos.js` |
| C16 | ID de operación único | Carga duplicada | `referencia_usada` |
| C17 | Envíos programados: solo clientes visibles, uno por tipo, cola sin superposición | Envío de datos a destinatarios no autorizados o duplicados | Programaciones auditadas; cola e historial por tarea |
| C18 | Buzón de avisos a los asociados del cliente, con lectura registrada | Operaciones pendientes sin atender | Tabla `mensaje` (destinatario, leído, motivo) |
| C19 | Cadena de hashes SHA-256 en la auditoría, verificada a diario | Alteración o borrado de registros por un usuario privilegiado | Verificación de integridad (pantalla y diaria) |
| C20 | Señales de riesgo de fraude; riesgo ALTO exige confirmación explícita | Aprobación de operaciones fraudulentas | Auditoría de la aprobación con el riesgo y la confirmación |
| C21 | Límites de pedidos por IP (Nginx) y por usuario (backend) | Abuso, fuerza bruta, scraping | Respuestas 429 con Retry-After; prueba automática `test/e2e/limites.mjs` |
| C22 | Contenedores endurecidos y redes segmentadas (las bases solo en una red interna) | Movimiento lateral, escalada de privilegios | `docker-compose.yml` |
| C23 | Resguardos cifrados con HMAC y prueba de restauración | Pérdida de datos, resguardo alterado | `scripts/resguardo.sh` y `restaurar-resguardo.sh --probar` |
| C24 | Pruebas de seguridad automatizadas como compuerta de publicación en el CI | Regresión de un control de acceso o de una protección | GitHub Actions: no se publica una imagen si fallan (ver abajo) |

**C24 — Qué verifica el CI en cada cambio, antes de publicar** (si algo falla, no se publica la imagen):

| Prueba | Qué comprueba |
| --- | --- |
| Separación de funciones (roles) | El operador, el auditor y el administrador no acceden a funciones de otro rol; el administrador nunca opera aunque el token traiga los roles |
| Acceso por empresa (BOLA) | Un usuario no ve ni opera cuentas de una empresa que no tiene habilitada, ni cambiando el número ni pivoteando por parámetros; Ver no habilita Operar |
| Operación por id (IDOR) | No se puede ver la auditoría, aprobar ni rechazar una operación de otra empresa por su id |
| Doble control y envío único | Nadie aprueba lo que cargó; una operación va al banco una sola vez aunque se apruebe varias veces o en paralelo; lo rechazado nunca se envía |
| Límites de pedidos | Al pasarse, responde 429 con Retry-After; el límite es por usuario |
| Navegador | Cabeceras de seguridad presentes y CSP estricta (sin `unsafe-inline` ni `unsafe-eval`) |
| Dependencias, secretos e imágenes | Sin vulnerabilidad crítica en producción, sin secretos en el repositorio, escaneo de imágenes y de configuración de contenedores |

## Pendientes

- Retención de la base histórica: a definir por Cumplimiento.
- Credencial API exclusiva del Home Banking y de envíos, y rotación de la actual: a gestionar con el banco.
- Servidor SMTP de producción, dominio y certificado: a definir con Infraestructura.
- Prueba integrada de punta a punta en producción con evidencia para auditoría. Las pruebas automáticas (C24) usan un banco simulado; la prueba de penetración contra el banco real queda pendiente.


## Evidencia operativa previa a producción

Además de los controles automáticos, conservar evidencia de la versión/commit desplegado, ejecución verde del CI, prueba integrada en modo solo consultas, prueba de resguardo/restauración y configuración de monitoreo. El simulacro de DR del CI valida el mecanismo sobre bases temporales; no reemplaza la política operativa de copias externas, retención ni los simulacros periódicos de producción.

La protección de la rama `ALYC` (PR, checks obligatorios, bloqueo de force-push y eliminación) es un control administrativo de GitHub y debe verificarse por separado: no puede inferirse del contenido del repositorio.
