# Resúmenes de poder desde SharePoint (chequeo masivo del Bastanteo)

Bastanteo → **Chequeo masivo de resúmenes** → **Traer de SharePoint** lee los Excel de la carpeta
*SACSharepoint › Documentos compartidos › Legajos Digitales › RESUMENES FIRMAS Y FACULTADES › Resúmenes de Poder*
(solo esa carpeta, **sin subcarpetas**) y controla cada uno contra Complif. La página habla con SharePoint a través de un
flujo de Power Automate (con la conexión de SharePoint de quien lo crea; no hace falta registrar nada en Azure).

```
Página ──{clave, accion:"listar"}──────────▶ Flujo ──"Obtener archivos (solo propiedades)"──▶ carpeta
       ◀── [{nombre, ruta, carpeta}] ───────
Página ──{clave, accion:"archivo", ruta}───▶ Flujo ──"Obtener contenido de archivo mediante la ruta de acceso"
       ◀── {nombre, contenido (base64)} ────
```

> Sin flujo también se puede: en SharePoint, **Sincronizar** la biblioteca con OneDrive y en la página usar
> **Elegir carpeta** apuntando a "Resúmenes de Poder" (toma solo los Excel del primer nivel).

## El flujo

**Crear → Flujo de nube instantáneo → "Cuando se recibe una solicitud HTTP"**. Nombre: `VALO SharePoint Resúmenes`.

1. **Disparador**: método **POST**, *Quién puede desencadenar el flujo* = **Cualquiera**.
2. **Redactar** (Compose), nombre `Pedido`, expresión `json(triggerBody())`.
3. **Inicializar variable** `ClaveCompartida` (String) = una clave larga inventada. Configuración → **Entradas y salidas seguras**.
4. **Condición**: `outputs('Pedido')?['clave']` *es igual a* `variables('ClaveCompartida')`.
   - **Si no**: **Respuesta** `401`, encabezados `Access-Control-Allow-Origin` = `*` y `Content-Type` = `application/json`,
     cuerpo `{"ok": false, "mensaje": "Clave incorrecta"}`.
   - **Si es verdadero**: **Modificador (Switch)** sobre `outputs('Pedido')?['accion']`:
     - **Caso `listar`**
       1. **SharePoint → Obtener archivos (solo propiedades)**, renombrarla `Archivos`:
          Dirección del sitio `https://bancodevalores.sharepoint.com/sites/SACSharepoint`, Biblioteca `Documentos compartidos`,
          **Limitar entradas a la carpeta** = `/Legajos Digitales/RESUMENES FIRMAS Y FACULTADES/Resúmenes de Poder` (elegirla con el
          ícono de carpeta), **Incluir elementos anidados = No**, *Recuento superior* `5000`
          (y en Configuración de la acción, **Paginación** activada con umbral 5000).
       2. **Seleccionar** (Select), De: `body('Archivos')?['value']`, Asignar:
          `nombre` = `item()?['{FilenameWithExtension}']`, `ruta` = `item()?['{FullPath}']`, `carpeta` = `item()?['{IsFolder}']`.
       3. **Respuesta** `200`, mismos encabezados, Cuerpo = salida de **Seleccionar**.
     - **Caso `archivo`**
       1. **SharePoint → Obtener contenido de archivo mediante la ruta de acceso**, renombrarla `Contenido`:
          misma dirección del sitio, Ruta de acceso del archivo = expresión `concat('/', outputs('Pedido')?['ruta'])`.
       2. **Respuesta** `200`, mismos encabezados, Cuerpo:
          `{"nombre": "@{outputs('Pedido')?['ruta']}", "contenido": "@{body('Contenido')?['$content']}"}`
     - **Predeterminado**: **Respuesta** `400`, cuerpo `{"ok": false, "mensaje": "Acción desconocida"}`.
5. **Guardar**, copiar la **HTTP URL** del disparador.

En la página: Bastanteo → Chequeo masivo → **Conexión con SharePoint** → URL y clave → **Guardar conexión** (queda en la
base compartida). Después, **Traer de SharePoint**. Los archivos se piden de a 4; con ~400 resúmenes tarda unos minutos.

## El reporte

- **Pantalla**: contadores (empresas, con diferencias, coinciden, sin poderes en Complif, error de lectura) y una fila por
  empresa con las diferencias (firmante, punto, qué dice el resumen y qué dice el poder). Filtro por estado y buscador.
- **Exportar reporte a Excel**: hoja **Empresas** (listado global de todas las empresas), **Diferencias** (una fila por
  punto que difiere) y **Firmantes** (todos los firmantes con su resultado).

Los puntos son los mismos del control de un cliente: uso de firma, grupo (solo si el poder asigna grupos), firmas
conjuntas y límite (no se controla en firmas conjuntas). "En Complif y no en el resumen" lista los apoderados de los
poderes que no figuran en el Excel.
