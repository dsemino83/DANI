# Cartera desde Power BI (modelo ePortfolio_Mensual)

La página (Cartera → **Traer cartera de Power BI**) manda una consulta DAX a un flujo de Power Automate; el flujo la
ejecuta en el modelo semántico **ePortfolio_Mensual** (workspace **ePortfolio**) y devuelve las filas. **No necesita
gateway**: el modelo está en el servicio de Power BI.

```
Página ──POST (clave + consulta DAX)──▶ Flujo ──"Ejecutar una consulta en un conjunto de datos"──▶ ePortfolio_Mensual
       ◀────────── filas ──────────────
```

## Requisitos

1. El usuario dueño de la conexión de Power BI del flujo necesita permiso de **compilación (Build)** sobre el modelo
   ePortfolio_Mensual (o rol Colaborador/Miembro en el workspace). Lo da el dueño del modelo (Diego Apezteguia):
   modelo → **Administrar permisos** → agregar el usuario con *Permitir que los destinatarios compilen contenido*.
   **No tocar "Tomar control"** del modelo.
2. En el portal de administración de Power BI tiene que estar habilitado **"Dataset Execute Queries REST API"**
   (Configuración de inquilino → Configuración de integración). Si no, la acción responde *Unauthorized / not enabled*.
3. Licencia Power Automate Premium (disparador HTTP), igual que el flujo NO COBIS.

## El flujo (6 acciones)

**Crear → Flujo de nube instantáneo → "Cuando se recibe una solicitud HTTP"**. Nombre: `VALO Cartera Power BI`.

1. **Disparador**: método **POST**, *Quién puede desencadenar el flujo* = **Cualquiera**, sin esquema.
2. **Redactar** (Compose), nombre `Pedido`, expresión: `json(triggerBody())`
3. **Inicializar variable** `ClaveCompartida` (String) = una clave larga inventada (distinta de la del flujo NO COBIS).
   Configuración → **Entradas y salidas seguras = Activado**.
4. **Condición**: expresión `outputs('Pedido')?['clave']` *es igual a* `variables('ClaveCompartida')`
   - **Si no**: **Respuesta** `401` con encabezados `Access-Control-Allow-Origin` = `*` y `Content-Type` = `application/json`,
     cuerpo `{"ok": false, "mensaje": "Clave incorrecta"}`.
   - **Si es verdadero**:
     1. **Power BI → Ejecutar una consulta en un conjunto de datos** (*Run a query against a dataset*):
        - Área de trabajo: **ePortfolio**
        - Conjunto de datos: **ePortfolio_Mensual**
        - Texto de la consulta: expresión `outputs('Pedido')?['consulta']`
        - Renombrarla `Consulta` (los tres puntos → Cambiar nombre).
     2. **Respuesta** `200`, mismos encabezados, **Cuerpo** = contenido dinámico **First table rows** de `Consulta`
        (o la expresión `body('Consulta')?['firstTableRows']`).
     3. **Respuesta** `500`, mismos encabezados, cuerpo
        `{"ok": false, "mensaje": "Falló la consulta en Power BI: revisar el historial del flujo"}`,
        con **Configurar ejecución posterior** = *tiene errores* sobre `Consulta`.
5. **Guardar** y copiar la **HTTP URL** del disparador.

## En la página

Cartera → **Conexión con Power BI** → pegar la **HTTP URL** y la **clave** → **Guardar conexión** (queda en la base
compartida, para todos). Después, **Traer cartera de Power BI** (periodo vacío = el último).

La consulta (botón *Ver / copiar la consulta DAX*) agrupa `fctFideicomisoCuotaSaldo` del periodo por titular
(`CUITDeudor`), negocio (`FideicomisoId`), estado (`FideicomisoCreditoCuotaEstadoId` y `Situacion ePortfolio`) y fecha de
corte, y devuelve: Cuotas, Saldo Capital (`Saldo_Capital`), Saldo Int a Dto (`Saldo_Interes_a_dto_`), Int Dev a Cobrar
(`Int Dev Calculado VN`), Int Dev Calculado VD y Saldo de Deuda (`SaldoDeDeuda`). La página arma el resto igual que con
el export: excluye los estados pagos que se marquen, calcula el valor a descuento, cruza con Bancos MELI y genera el TXT /
envío NO COBIS. Se puede probar antes en Power BI Desktop o en **DAX query view** pegando la consulta.

## Errores comunes

| La página muestra | Causa | Qué hacer |
|---|---|---|
| *The OAuth authorization scheme is required* | disparador en "Cualquier usuario del inquilino" | cambiarlo a **Cualquiera** y copiar la URL nueva |
| HTTP 502 | falló una acción antes de la Respuesta | historial de ejecuciones → acción en rojo |
| *Falló la consulta en Power BI* | sin permiso Build, API de consultas deshabilitada o columna con otro nombre | ver el error de `Consulta` en el historial |
| *Power BI no devolvió filas* | el periodo no existe | dejar el periodo vacío o poner uno válido (como figura en la columna Periodo) |

Límites de la API de Power BI: hasta 100.000 filas y 1.000.000 de valores por consulta (la consulta ya llega agregada).
