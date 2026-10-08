# Envío NO COBIS a la API por Power Automate

La página (sitio propio o archivo local) arma el lote NO COBIS y lo manda a un **flujo de Power Automate**.
El flujo pide el token, llama a la API del Orquestador de Riesgos **a través del gateway de datos local** (la API está
en la red interna) y le devuelve a la página el resultado de cada banco.

```
Página ──POST (lote + clave)──▶ Flujo Power Automate ──gateway──▶ SSO (token) + API NOCOBIS (red de VALO)
       ◀──── resultados ────────
```

## Requisitos (sistemas)

1. Licencia **Power Automate Premium** para el dueño del flujo (el disparador HTTP y los conectores personalizados son premium).
2. **On-premises data gateway** instalado en un servidor de la red que llegue a
   `ssohomo.valo.ar` (443) y a `gateway-api-microservicios-core-test.apps.closdesa.bvsa.local` (80),
   registrado en el mismo entorno de Power Platform.
3. El **client_secret** de la API (no va en la página: queda solo dentro del flujo).

## 1. Conectores personalizados (dos)

Power Automate → **Datos → Conectores personalizados → Nuevo conector personalizado → Importar un archivo OpenAPI**:

| Conector | Archivo | Conexión |
|---|---|---|
| VALO SSO Token | `conector-sso-token.swagger.json` | Autenticación: *Sin autenticación*. Si `ssohomo.valo.ar` solo se ve desde la red, tildar **Conectar mediante gateway de datos local**. |
| VALO Riesgos NOCOBIS | `conector-nocobis.swagger.json` | Autenticación: *Sin autenticación* + **Conectar mediante gateway de datos local** (obligatorio). |

En cada uno: **Crear conector** → pestaña **Probar** → **Nueva conexión** (elegir el gateway) → probar:
- `ObtenerToken` con client_id `apiriesgos`, el client_secret y `client_credentials` → tiene que devolver `access_token`.
- `Catalogo` con Authorization `Bearer <access_token>` → tiene que devolver el catálogo.

> **Encabezado Authorization:** Power Automate no permite un parámetro llamado `Authorization`. El conector recibe el
> token en `X-Token` y una **directiva** lo copia: pestaña **Definición → Directivas → + Nueva directiva** →
> plantilla **Establecer encabezado HTTP**, nombre del encabezado `Authorization`, valor `@headers('X-Token')`,
> acción *override*, ejecutar en *Request*, todas las operaciones. En el flujo, `X-Token` = `Bearer <access_token>`.

> Si la API responde 401 aunque el token sea correcto, el gateway puede estar quitando el header Authorization:
> avisame y lo resolvemos con una política del conector.

## 2. El flujo

**Crear → Flujo de nube instantáneo → "Cuando se recibe una solicitud HTTP"** (When an HTTP request is received).

### 2.1 Disparador
- Método: **POST**. Quién puede desencadenar el flujo: **Cualquiera** (la seguridad la da la clave compartida).
- Sin esquema (la página manda el cuerpo como texto).
- Al guardar el flujo aparece la **HTTP POST URL**: copiarla en la página (Cartera → Envío directo a la API → Dirección del flujo).
  Tiene que terminar en `&sp=...&sv=1.0&sig=...`. Si termina en `?api-version=1` y la página muestra
  *"The OAuth authorization scheme is required"*, el disparador quedó en "Cualquier usuario del inquilino": cambiarlo a
  **Cualquiera**, guardar y copiar la URL nueva. Si la opción *Cualquiera* no está disponible, la bloqueó el administrador
  de Power Platform (política de disparadores HTTP anónimos).

### 2.2 Datos del pedido
1. **Redactar** (Compose) `Pedido`: expresión `json(triggerBody())`
   (si da error, usar `json(base64ToString(triggerBody()?['$content']))`).
2. **Analizar JSON** (Parse JSON) `Pedido JSON`: contenido = salida de `Pedido`; esquema = contenido de `esquema-pedido.json`.
3. **Inicializar variable** `ClaveCompartida` (String) = una clave larga que inventen (la misma que se carga en la página).
4. **Inicializar variable** `ClientSecret` (String) = el client_secret de la API.
   En estas dos acciones: **Configuración → Entradas y salidas seguras = Activado** (así no se ven en el historial).
5. **Inicializar variable** `Resultados` (Array) = `[]`.

### 2.3 Control de la clave
**Condición**: `body('Pedido_JSON')?['clave']` *es igual a* `variables('ClaveCompartida')`.
- **Si no**: **Respuesta** (Response) código `401`, encabezados `Access-Control-Allow-Origin: *` y `Content-Type: application/json`,
  cuerpo `{"ok": false, "mensaje": "Clave incorrecta"}` → **Finalizar** (Terminate) *Correcto*.

### 2.4 Según la acción
**Modificador** (Switch) sobre `body('Pedido_JSON')?['accion']`:

**Caso `probar`** (no envía datos):
1. `VALO SSO Token → ObtenerToken` (client_id `apiriesgos`, client_secret `variables('ClientSecret')`, grant_type `client_credentials`). Entradas/salidas seguras: Activado.
2. `VALO Riesgos NOCOBIS → Catalogo`, Authorization: `concat('Bearer ', body('ObtenerToken')?['access_token'])`.
3. **Respuesta** `200` (mismos encabezados) con cuerpo:
   `{"ok": true, "catalogo": @{body('Catalogo')}}`

**Caso `enviar`**:
1. **Aplicar a cada uno** sobre `body('Pedido_JSON')?['lote']?['operaciones']`.
   Configuración → Control de simultaneidad: **Activado, 1** (una operación por vez, en orden).
   Dentro del bucle:
   1. `ObtenerToken` (igual que arriba; se pide uno por operación para que nunca venza).
   2. **Condición** `body('Pedido_JSON')?['reemplazar']` es igual a `true`:
      - **Sí**: `Operaciones` (cliente `items('Aplicar_a_cada_uno')?['cliente']`) → **Filtrar matriz** (Filter array) donde
        `item()?['tipoCredito']` es igual a `items('Aplicar_a_cada_uno')?['tipoCredito']` → **Aplicar a cada uno** sobre el
        resultado: `Cancelar` con cuerpo `{"cliente": <cliente>, "numeroOp": @{items('Aplicar_a_cada_uno_2')?['numeroOperacion']}}`.
   3. **Condición** `items('Aplicar_a_cada_uno')?['saldoCapital']` *es mayor que* `0`:
      - **Sí**: `Ingreso` con cada campo del ítem (`cliente`, `tipoCredito`, `moneda`, `saldoCapital`, `saldoInteres`,
        `saldoOcif`, `fechaConcesion`, `fechaVencimiento`, `tasaInteres`).
        - **Anexar a variable de matriz** `Resultados` (se ejecuta si `Ingreso` fue correcto):
          ```
          {"cliente": @{items('Aplicar_a_cada_uno')?['cliente']}, "banco": "@{items('Aplicar_a_cada_uno')?['banco']}",
           "saldoCapital": @{items('Aplicar_a_cada_uno')?['saldoCapital']}, "operacion": @{body('Ingreso')?['operacion']},
           "resultado": "@{body('Ingreso')?['resultado']}", "avisos": @{coalesce(body('Ingreso')?['avisos'], json('[]'))}}
          ```
        - Otra **Anexar a variable de matriz** `Resultados` con **Configurar ejecución posterior (Run after) = "tiene errores"**
          sobre `Ingreso` (así un error no corta el lote):
          ```
          {"cliente": @{items('Aplicar_a_cada_uno')?['cliente']}, "banco": "@{items('Aplicar_a_cada_uno')?['banco']}",
           "saldoCapital": @{items('Aplicar_a_cada_uno')?['saldoCapital']},
           "error": "@{coalesce(string(body('Ingreso')), actions('Ingreso')?['error']?['message'])}"}
          ```
2. **Respuesta** `200` (mismos encabezados), cuerpo: `{"ok": true, "resultados": @{variables('Resultados')}}`.
   Esta Respuesta tiene que ejecutarse aunque falle algo en el bucle: **Run after = correcto, tiene errores**.

> **Encabezados de todas las Respuestas:** `Access-Control-Allow-Origin: *` y `Content-Type: application/json`
> (sin el primero, el navegador no deja leer la respuesta).

### 2.5 Respuesta ante errores (recomendado)
Para que la página muestre el error real (y no un *HTTP 502: The server did not receive a response*):
1. Poner todo lo que está después de **Analizar JSON** dentro de un **Ámbito** (Scope) llamado `Intentar`.
2. Debajo del ámbito, una **Respuesta** `500` con los mismos encabezados y cuerpo:
   ```
   {"ok": false, "mensaje": "@{coalesce(first(filter(result('Intentar'), x, equals(x?['status'], 'Failed')))?['error']?['message'], 'Falló una acción del flujo')}"}
   ```
   (si esa expresión no se acepta, usar solo `{"ok": false, "mensaje": "Falló una acción del flujo"}` y ver el detalle en el historial).
3. En esa Respuesta: **Configurar ejecución posterior** = *tiene errores* y *se agotó el tiempo de espera*.

**Si la página muestra HTTP 502**: el flujo se ejecutó pero no llegó a ninguna Respuesta. Abrir el flujo →
**Historial de ejecuciones** → la ejecución con *Error* → ver la primera acción en rojo:

| Acción en rojo | Causa probable | Qué hacer |
|---|---|---|
| Redactar `Pedido` | el cuerpo llega en otro formato | usar `json(base64ToString(triggerBody()?['$content']))` |
| Analizar JSON | el esquema no coincide | usar `esquema-pedido.json` |
| ObtenerToken / Catalogo | el gateway no llega o la conexión no tiene gateway | probar el conector (pestaña Probar) y que el gateway esté en línea |
| tiempo de espera agotado | gateway o API lentos (más de 2 minutos) | revisar gateway / API |

## 3. En la página

Cartera → Resultado → **Envío directo a la API (Power Automate)**:
1. Pegar la **HTTP POST URL** y la **clave compartida** → **Guardar conexión** (queda en la base compartida, solo para usuarios con sesión).
2. **Probar flujo (no envía datos)**: tiene que decir *Flujo OK* y mostrar el catálogo (y si incluye CCASR).
3. **Enviar a la API**: confirma cantidad, total y fechas; opcionalmente *cancelar las vigentes del mismo tipo*. Muestra el
   número de operación o el error de cada banco y guarda el envío en la base (colección `envios`).

## Límites y cuidados

- La respuesta del flujo tiene que volver en **menos de 2 minutos** (límite de Power Automate para respuestas HTTP).
  Con pocas decenas de operaciones alcanza; si crece mucho, se pasa a un esquema asíncrono.
- **No reintentar a ciegas**: si el envío dio error o se cortó, revisar el historial de ejecuciones del flujo
  (o consultar las operaciones del cliente) antes de volver a enviar, para no duplicar.
- La dirección del flujo más la clave permiten ingresar operaciones: no compartirlas fuera de VALO.
  Si se filtran, regenerar la clave en el flujo (variable `ClaveCompartida`) y en la página.
- El envío directo aparece en el **sitio propio** y en el archivo local; en la página de claude.ai no (claude.ai bloquea
  llamadas a otros servidores y su base la puede leer cualquiera con el link).
