# Descuento de cheques: flujo "Aceptar echeq desde VALO"

La pestaña **Descuento de cheques** usa dos flujos de Power Automate:

| Flujo | Para qué | Cómo lo llama la página |
|---|---|---|
| Consulta de eCheqs | Trae los eCheqs recibidos (es el mismo flujo de consulta de la gestión de eCheqs ALYC) | `POST` JSON `{}` |
| **Aceptar echeq desde VALO** | Acepta **un** cheque por llamada y avisa el resumen al final | `POST` texto con `{ clave, accion, ... }` |

Las dos direcciones y la clave se cargan en la pestaña, en *Conexión con los flujos de Power Automate*, y quedan en la
base compartida (`maestros/chequesConfig`, solo usuarios con sesión). **No se guardan en el repositorio.**

## Qué cambia respecto del flujo "Aceptar masivo echeq"

| Antes | Ahora |
|---|---|
| Lee los cheques del Excel "Listado para exportar" (copiado con una macro) | Recibe el cheque elegido en pantalla; no hace falta el Excel ni la macro |
| Acepta todos en un bucle en paralelo y responde al final | La página llama una vez por cheque y muestra cada resultado apenas responde el banco |
| Cualquiera con la dirección podía dispararlo | Exige la **clave compartida** (variable `ClaveCompartida`); si no coincide responde 401 |
| La contraseña del usuario de la API y la cookie de sesión quedaban visibles en el historial de ejecuciones | Login, cookie y llamada de entidad con **entradas y salidas seguras** |
| La aceptación usaba la política de reintentos por defecto (podía reenviar) | La llamada `AcceptApi` va **sin reintentos automáticos**: nunca se acepta dos veces |
| `Obtener tablas` del histórico se repetía en cada vuelta | Se pide una vez, **en paralelo** con el login |
| Fecha de aceptación en UTC (después de las 21 h quedaba el día siguiente) | Fecha en hora de Argentina |
| Si fallaba una acción el flujo no respondía | Siempre responde: resultado del cheque, o error 400 / 401 / 500 con mensaje |

Se mantienen todos los pasos: login, `getUserEntityInformation`, `AcceptApi`, fila en el histórico de SharePoint
(mismas columnas), mensaje de Teams a las mismas dos personas y correo a la misma casilla (ahora una sola vez al terminar,
con la tabla de todos los cheques de la tanda; Teams y correo salen en paralelo).

## Pedido y respuesta

Aceptar un cheque:

```json
{ "clave": "…", "accion": "aceptar",
  "cheque": { "chequeId": "…", "chequeNumero": "…", "beneficiarioDocumento": "…", "beneficiarioNombre": "…", "fechaPago": "dd/mm/aaaa", "monto": 1234.56 } }
```

```json
{ "ok": true, "chequeId": "…", "aceptado": true, "etapa": "aceptacion", "estadoHttp": 200, "detalle": { "success": true }, "historico": true, "fecha": "2026-10-16 15:02:11" }
```

`etapa = "login"` indica que no se pudo ingresar al banco (el cheque no se envió).

Aviso final (Teams + correo):

```json
{ "clave": "…", "accion": "notificar", "aceptados": 2, "rechazados": 1, "usuario": "…",
  "resultados": [ { "chequeId": "…", "chequeNumero": "…", "beneficiarioNombre": "…", "beneficiarioDocumento": "…", "fechaPago": "…", "monto": "…", "estado": "ACEPTADO", "detalle": "…" } ] }
```

Todas las respuestas llevan `Access-Control-Allow-Origin: *` y `Content-Type: application/json`.

## Instalación

1. Power Automate → **Mis flujos → Importar → Importar paquete (heredado)** → el `.zip` del flujo nuevo.
   Elegir **Crear como nuevo** (el flujo actual sigue funcionando) y asignar las conexiones de Excel, Teams y Outlook.
2. Abrir el flujo y revisar el disparador: *Quién puede desencadenar el flujo* = **Cualquiera** (la seguridad la da la clave).
3. Guardar y copiar la **HTTP POST URL** del disparador.
4. En la página → **Descuento de cheques → Conexión**: pegar la dirección del flujo de consulta, la del flujo nuevo
   y la clave (la misma de la variable `ClaveCompartida` del flujo). **Guardar conexión.**
5. Cargar los **Clientes COBIS** (CUIT → código): *Importar Excel* con el archivo de eCheqs (toma la Hoja2) o a mano.

## Límites de escritura

| Dónde | Límite | Cómo se maneja |
|---|---|---|
| Histórico de SharePoint (Excel) | El conector de Excel trabaja con archivos de hasta 25 MB y se vuelve lento con tablas muy grandes; dos escrituras a la vez sobre la misma tabla pueden chocar | Una fila por llamada y de a un cheque a la vez (nunca escrituras simultáneas). El flujo no lee la tabla, así que no lo afecta el tope de filas de "Enumerar filas". Si el archivo crece mucho, empezar uno nuevo por año (la acción toma la primera tabla del archivo configurado). Si una fila no se pudo escribir, la pantalla lo avisa en el detalle del cheque. |
| Mensaje de Teams | ~28 KB por mensaje | Tabla corta: hasta 25 cheques y 4 columnas, con la aclaración de que el detalle completo está en el correo. |
| Correo | — | Tabla completa, hasta 500 cheques por tanda. |
| Respuesta HTTP del flujo | 2 minutos | Un cheque por llamada (cada llamada tarda segundos). |

## Seguridad

- La dirección del flujo más la clave permiten aceptar cheques: no compartirlas fuera de VALO. Si se filtran, cambiar la
  variable `ClaveCompartida` en el flujo y en la página, y regenerar la dirección del disparador.
- Recomendado: mover la contraseña del usuario de la API del banco a Azure Key Vault (o a una variable de entorno secreta)
  en lugar de dejarla en la acción de login.
- Un cheque que queda **"Sin respuesta"** (corte o demora del flujo) no se reenvía solo: verificarlo en el banco antes de
  volver a enviarlo.

## Interfaz COBIS

La pestaña arma el TXT con una línea por cheque, igual a la columna AD de la hoja MENU del Excel de eCheqs:

```
cod|beneficiario|CUIT|cod|beneficiario|CUIT|hoy|fecha pago|N° cheque|banco|sucursal|1041|monto|fecha pago|CUIT emisor|emisor||||1|chequeId|
```

`cod` es el código COBIS del CUIT beneficiario (Clientes COBIS); los cheques de un CUIT sin código no van (como el
`IFERROR` del Excel). Si el cheque fue endosado a VALO, el beneficiario es quien hizo el último endoso a VALO.
