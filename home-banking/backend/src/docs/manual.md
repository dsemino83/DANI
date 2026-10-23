# Home Banking VALO — Manual de usuario

## Introducción

El Home Banking VALO permite consultar saldos y movimientos de las empresas clientes y operar sus transferencias con **doble control**: una persona las carga y otra las aprueba. Cada usuario ve solo las empresas que el administrador de seguridad le habilitó y solo las pestañas de su perfil.

| Perfil | Qué hace | Pestañas |
| --- | --- | --- |
| Operador | Consulta y carga transferencias (individuales o por lote) | Saldos, Movimientos, Débitos realizados, Consulta CBU, Transferir, Carga masiva, Transferencias, Ayuda |
| Autorizante | Consulta, aprueba o rechaza transferencias, arma la cartera de oficiales y programa envíos de correo a los clientes | Saldos, Movimientos, Débitos realizados, Consulta CBU, Transferencias, Aprobaciones, Cartera de oficiales, Envíos programados, Ayuda |
| Auditor | Consulta y revisa la auditoría | Saldos, Movimientos, Débitos realizados, Transferencias, Auditoría, Documentación, Ayuda |
| Administrador de seguridad | Gestiona empresas, usuarios, permisos y credenciales; ve el estado del sistema; no ve saldos ni opera | Empresas, Usuarios y permisos, Credenciales API, Estado del sistema, Auditoría, Documentación, Ayuda |

Transferir y Carga masiva aparecen solo con el rol **Crear transferencias**; Aprobaciones, solo con **Aprobar transferencias**.

## Ingreso, encabezado y buzón

1. Tocá **Ingresar con usuario de VALO**: se abre el inicio de sesión corporativo. La aplicación nunca ve tu contraseña; bloqueos y recupero de clave se gestionan ahí.
2. En el encabezado ves tu usuario y perfil, el ambiente del banco (Homologación o Producción) y la hora de los **datos del banco** que estás viendo.
3. Los saldos, movimientos y débitos se consultan al banco una vez y se reutilizan en todas las pantallas. **↻ Actualizar datos** los vuelve a pedir.
4. **✉ Mensajes** es tu buzón (ver más abajo). **Modo oscuro / claro** cambia los colores. **Cerrar sesión** termina la sesión en la app y en el inicio de sesión de VALO.

**Buzón de mensajes.** Cuando otro usuario carga una transferencia o un lote que necesita autorización en un cliente que tenés asociado, te llega un mensaje:

- Mientras tengas mensajes sin leer, el botón **✉ Mensajes** queda **rojo y latiendo**. Cuando llega uno nuevo, se sacude y el mensaje se abre solo con una franja roja.
- **Aceptar** te lleva a **Aprobaciones** (si no tenés el rol de aprobar, al registro de Transferencias).
- Un mensaje queda **leído** cuando lo abrís; si tenés varios, los demás siguen sin leer.
- Si la operación de un mensaje sin leer ya fue autorizada o resuelta por otra persona, el mensaje pasa solo a leído.
- El buzón muestra los **últimos 7 días**.

## Saldos

1. Al ingresar ves el total de todas tus empresas: disponible en pesos y en dólares, pendiente de aprobar y débitos de hoy.
2. **Buscar** filtra empresas y cuentas por nombre (contiene, sin distinguir acentos).
3. Tocá una empresa para ver solo esa; tocala de nuevo para volver al total.
4. En cada cuenta: disponible, contable, estado y **débitos de hoy**. El botón de débitos abre Débitos realizados filtrado por esa cuenta.
5. **Constancia** emite la constancia de CBU de la cuenta, con el logo de VALO, lista para imprimir o guardar en PDF.

## Movimientos

1. Elegí **Cliente** y **Cuenta** (con buscador). **Período:** Hoy o Histórico (Desde / Hasta). **↻ Consultar nuevamente** vuelve a pedir los movimientos al banco.
2. Tarjetas: créditos, débitos y cantidad del período.
3. **Créditos por causal** y **Créditos por beneficiario**, uno al lado del otro: ranking de ingresos con cantidad, importe, porcentaje y barra. Tocá una fila para filtrar el detalle.
4. **Detalle de movimientos**: ID, fecha, hora, descripción, beneficiario, CUIT, **Causal** y **CBU origen / Beneficiario** (en las causales 366 y 367 muestra el CBU originante; en las demás, el beneficiario), D/C, importe y saldo. 900 por página.
5. **Buscar movimiento** filtra por descripción, beneficiario, CUIT o ID (sin distinguir mayúsculas ni espacios de más).
6. **Exportar a Excel** descarga todos los movimientos del período con las mismas columnas; importes como números (débitos en negativo).

## Débitos realizados

1. Débitos de todas tus cuentas, de hoy o de un rango histórico, con filtro por cliente, por cuenta (chip) y buscador.
2. Tocá el total **en pesos** o **en dólares** para ver solo esa moneda; tocalo de nuevo (o la ✕ del chip) para ver ambas.
3. Tocá una fila para ir a los movimientos de esa cuenta. La ruedita **⚙** abre la auditoría del débito: si salió de una transferencia del Home Banking, quién la cargó, quién la aprobó y cada cambio de estado.
4. **Exportar a Excel** descarga los débitos con el logo del banco, el período y el cliente.

## Consulta de CBU

Ingresá un CBU/CVU de 22 dígitos o un alias para ver titular, CUIT, moneda y si la cuenta está activa en COELSA. Es una consulta: no requiere aprobación.

## Transferir y carga masiva (rol Crear)

Lo que cargues queda **Pendiente de aprobación**; no se envía al banco hasta que otro usuario lo apruebe.

1. **Transferir:** elegí el tipo (Inmediata, Entre cuentas propias, Terceros BdV o MEP) y la cuenta origen; solo aparecen las cuentas que podés operar.
2. Completá el **ID de la operación** (tu referencia, no se puede repetir nunca), destino, importe y concepto. En MEP elegí el código y el concepto.
3. **Validar destino en COELSA** (Inmediata y MEP) completa titular y CUIT y avisa si la cuenta no existe.
4. **Enviar a aprobación.** Los autorizantes del cliente reciben un mensaje en su buzón.
5. **Carga masiva:** subí un CSV, Excel o TXT (una fila por transferencia). Revisá el **detalle previo** con la validación de cada fila y confirmá solo las válidas, o descartá el lote.

## Aprobaciones y transferencias

1. **Aprobaciones** (rol Aprobar) muestra lo pendiente con su **Riesgo** (bajo, medio o ALTO; tocalo para ver las señales). **Aprobar** envía al banco; **Rechazar** lo descarta sin enviarlo. No podés aprobar lo que cargaste vos. Con riesgo ALTO tenés que confirmar que revisaste las señales.
2. **Estado de las transferencias aprobadas**: Debitada, Pendiente de autorización (en el banco) o Error API.
3. **Transferencias** es el registro completo: **Hoy**, **Base operativa** (mes en curso y el anterior) o **Base histórica** (lo anterior, solo lectura). La ruedita **⚙** abre el historial completo de la operación.

## Cartera de oficiales (autorizante)

El autorizante asigna a cada oficial (operador) los clientes de su cartera. Si un oficial tiene clientes asignados, solo ve las cuentas de esos clientes (dentro de sus permisos).

## Envíos programados de correo (autorizante)

Correos automáticos a los clientes, solo sobre los clientes que ves.

1. **Tipo y repetición:**
   - **1 vez al día · extracto diario:** a una hora. Asunto *Envío de extracto diario*. Saldos y/o movimientos del día por cuenta, con débitos y créditos separados. Se envía aunque no haya movimientos.
   - **1 vez cada hora** o **cada 30 minutos · alerta de movimientos:** entre una hora y otra. En cada ejecución toma los movimientos desde 29:59 minutos antes hasta la hora de ejecución (10:00 → 09:30:01 a 10:00:00). **Solo se envía si hubo movimientos.** Asunto *Alerta de movimientos*, con la franja horaria y, por cuenta, débitos y créditos (sin saldo).
2. **Formato:** solo en el cuerpo del correo, o cuerpo + **Excel adjunto** (un archivo con **una pestaña por cuenta**, con el logo del banco).
3. **Destino:** primero el cliente y después sus cuentas (todas o algunas), o *Todos mis clientes*.
4. **Días**, **inicio**, **fin** y **No enviar en feriados** (los feriados se traen de fuentes públicas; los bancarios se cargan a mano).
5. Un cliente puede tener **un solo extracto diario y una sola alerta** activos.
6. **Cola de envíos:** cada envío es una tarea; se procesan de a una, se reintentan a los 1, 5 y 15 minutos y quedan en **Error** con **Reintentar**. **Ejecutar ahora** encola un envío de prueba.
7. **Ejecuciones:** cada turno tiene un id transaccional (**EJ-000123**) que agrupa sus tareas; al elegir una programación ves sus ejecuciones con tareas, enviadas, omitidas, errores y consultas hechas al banco.

Los correos salen de **alyc@valo.ar**, con el logo de VALO.

## Administración de seguridad

**Empresas**

1. **Alta:** razón social, CUIT y emails (uno o más).
2. **Emails:** **✎** edita un email en el lugar, **✕** lo quita, y se agregan nuevos. Son los destinatarios de los envíos programados.
3. **Cuentas:** agregá cuentas sin asignar (con buscador, CBU y descripción), validadas en COELSA.
4. **Desactivar / Activar** suspende o restablece los permisos; **Eliminar** libera las cuentas y quita los permisos.

**Usuarios y permisos:** alta y edición de usuarios, perfil, roles **Crear / Aprobar** y permisos **Ver / Operar** por empresa.

**Credenciales API:** por ambiente, la **principal** (Home Banking) y la de **Envíos programados** (exclusiva de los correos, usuario API distinto, channel editable). La clave es de solo escritura; **Probar conexión** la verifica.

**Estado del sistema:** tablero del estado de cada parte del sistema —backend, base operativa e histórica, sesión con el banco (principal y de envíos), cola de envíos, feriados, cadena de auditoría y último pase histórico— con **↻ Actualizar estado**. Incluye reinicios seguros de cada subsistema, que **no** reinician los contenedores (eso se hace en la herramienta de operaciones) y quedan auditados:

- **Reconectar con el banco:** descarta la sesión actual; la próxima consulta vuelve a autenticarse.
- **Reprocesar la cola de envíos:** destraba tareas colgadas y procesa las pendientes.
- **Refrescar feriados:** vuelve a traerlos del año en curso desde las fuentes públicas.
- **Verificar integridad de la auditoría:** recalcula toda la cadena de hashes y avisa si algún registro fue alterado o borrado.

**Auditoría** (también el auditor): registro de solo lectura de cada acción, filtrable; **Base operativa** o **Base histórica**. **Verificar integridad** comprueba que ningún registro haya sido modificado o borrado.

## Preguntas frecuentes

| Situación o mensaje | Qué significa | Qué hacer |
| --- | --- | --- |
| No veo una empresa o cuenta | No tenés permiso, está inactiva o la cuenta no está asignada | Pedirlo al administrador de seguridad |
| No aparece Transferir o Aprobaciones | Te falta el rol Crear o Aprobar | Pedirlo al administrador de seguridad |
| "La cargaste vos: no podés aprobarla" | Doble control | La aprueba otro usuario con rol Aprobar |
| Los datos no cambian | Se usan los datos consultados al ingresar | **↻ Actualizar datos** |
| No encuentro una transferencia vieja | Ya pasó a la base histórica (el día 1 de cada mes) | Transferencias → **Base histórica** |
| Una alerta no llegó | No hubo movimientos en la franja, o la tarea quedó en Error | Envíos programados → **Cola de envíos** |
| El Excel no se descarga | El navegador bloqueó la descarga | Permitir descargas para el sitio |
