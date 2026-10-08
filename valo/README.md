# VALO - EPORTFOLIO (Conversor GetNet)

Página web que reemplaza el flujo manual del libro **Conversor GetNet.xlsx** + los scripts
`GenerarCuotas.py` y `GenerarCreditos.py`.

**En internet:** https://dsemino83.github.io/DANI/valo/ redirige al sitio con la base compartida en Supabase (`web/`). La versión de claude.ai quedó en desuso (muestra un aviso).

**Sitio propio (en preparación):** https://dsemino83.github.io/DANI/valo/web/ — misma página con la base compartida en
Supabase (usuario y contraseña, descargas directas para todos). Configuración: `supabase/INSTRUCCIONES.md` y
`supabase/esquema.sql`; conexión en `supabase-config.js`; se genera con `construir.py` (`web/index.html`).

**Para usarla: abrir `Conversor-VALO.html`** (un solo archivo con todo adentro; se puede descargar suelto y abrir con doble clic, sin internet).

`pagina.html` es la versión de desarrollo (fuente de las otras dos) y solo funciona dentro de la carpeta `valo` completa.
Después de modificar el código, regenerar el archivo único con `python3 construir.py`.

## Flujo

1. **Clientes** – apertura del cliente: Nº de negocio, CUIT del cedente (11 dígitos) y nombre.
   Opcionalmente, la última secuencia ya usada (0 = el primer lote sale con secuencia 1).
   Sin cliente abierto no se puede cargar ningún archivo.
   **Interfaz por cliente:** en el alta (o en Editar) se puede subir un archivo de ejemplo del cliente
   (Excel o CSV) y elegir qué columna trae el código de banco, la fecha de vencimiento y el monto
   (por ejemplo `userBank`, `acceleratedPaymentDate`, `yieldAmount`). También se acepta un archivo de interfaz
   de dos columnas `Campo | Columna` (Banco, Fecha, Monto). Sin interfaz se reconoce automáticamente el formato
   GetNet / Reporte. Las filas sin banco ni fecha (totales al pie) se ignoran y se avisa si el total no coincide.
   **Esquema MELI (TXT por banco):** en la interfaz del cliente se elige "Usar esquema MELI". En Carga de lote se suben
   varios TXT de cuotas a la vez (`CUOTA_<BANCO COBIS>_<aaaammdd>.txt`, ancho fijo: cabecera CUOTAS con cantidad, fecha,
   CUIT del banco y total; detalle con vencimiento en [13,21) e importe en centavos en [21,41), que se divide por 100). El banco de cada TXT se detecta con la
   tabla **Bancos MELI** (nombre COBIS del archivo o CUIT de la cabecera). Cuotas ordenadas por nombre de banco y nombre
   del titular sin comas, como el conversor MELI. Se controla que cantidad y total de la cabecera coincidan con el detalle.
2. **Bancos** – tabla maestra precargada con la solapa Bancos del conversor (107 bancos).
   Se actualiza subiendo un Excel con `Banco, Nombre, CUIT, Jurisdiccion, Codigo Sucursal, Codigo Nº Credito`
   (modo *actualizar/agregar* o *reemplazar todo*), o editando banco por banco.
   Si falta la sucursal se toma de la provincia.
3. **Carga de lote** – elegir cliente y tipo de acción, completar periodo y tasa, y adjuntar el Excel del cliente.
   - Secuencia: se guarda por cliente; cada lote procesado toma la siguiente (última + 1).
   - **Alta**: lote = secuencia. **Revolving**: lote = 0.
   - Se lee la hoja de cupones GetNet (`cod_entidad_bancaria`, `entidad_bancaria`,
     `dat_reconciliation_estimated_date`, monto) o una hoja en formato Reporte
     (`ID_LOTE, COD_BANCO, NOMBRE_BANCO, MONTO, FECHA_VENCIMIENTO, …`).
   - **Cesión de cupones GetNet** (`Valo_Cesion_Cupones_<fecha>.xlsx`, hoja `result`): banco por nombre
     (`ENTIDAD_EMISORA`, se busca el código en Bancos MELI y Bancos), vencimiento `FECHA_ESPERADA_PAGO`, monto de la cuota
     `MOV_AMOUNT_INSTALL`. Se reconoce solo, sin interfaz.
   - Controles previos: formulario LISTO, filas válidas, y todos los bancos usados completos
     (sin *Prueba* ni *#N/D*). Si algo falla no deja procesar.
   - Número de crédito: código de banco (si tiene más de 3 dígitos, los 3 últimos) + fecha de generación ddmmyy +
     secuencia del lote, **sin ceros adelante**. Ej.: banco 11, 29/09/2026, secuencia 158 → `11290926158`.
   - Nombre del banco en Créditos: máximo 30 caracteres (en MELI, además, sin comas).
   - Genera Cuotas y Créditos con las mismas reglas del conversor y descarga
     `Cuotas<Cliente><ddmmaa>.csv` y `Creditos<Cliente><ddmmaa>.csv` (CSV UTF-8), con el mismo contenido que los scripts Python.
4. **Historial** – registro de todos los CSV generados, filtrable por cliente y por tipo de acción (Alta / Revolving),
   con totales por tipo, re-descarga de los CSV, exportación a Excel y anulación del último lote de cada cliente
   (devuelve la secuencia).

5. **Cartera** – agrupa por titular el reporte *CreditoCarteraEspejoDetalle* del BI (tabla ClickHouse
   `BI_CLIC.CreditoCarteraEspejoDetalleHistorico`): se sube el export CSV/Excel del BI (o, desde la versión local dentro de
   la red de VALO, se consulta directo si el BI lo permite). Filtra periodo (por defecto el último), negocios de Clientes
   (columna elegible, por defecto `Serie`) y excluye los estados de cuota marcados como pagos. Agrupa solo por titular;
   vista por defecto, sin fechas:
   **Titular | Ente | MIS | Cuotas impagas | Ficuo saldo capital | Saldo int. a dto. | Int. dev. a cobrar | Valor a descuento**,
   donde *Ente* y *MIS* salen de cruzar el CUIT del titular con la tabla Bancos MELI (el ente, si no está, con Bancos) y
   *Valor a descuento = FICUO SALDO CAPITAL − FICUO SALDO INT A DTO + INT DEV A COBRAR*.

   **TXT NO COBIS** (diseño de la hoja "NO COBIS" del inventario Payway): una línea de 156 caracteres por MIS con el
   valor a descuento — MIS (10) · `CCASR` (10) · tasa `0100000000` · importe × 100 (14) · saldo interés y OCIF en ceros
   (12 + 12) · moneda `080` · `NO COBIS` (64) · fecha de concesión (hoy) · fecha de vencimiento · `1`. El vencimiento es
   el último día hábil del mes (lunes a viernes); si hoy ya es ese día (o es posterior), el último día hábil del mes
   siguiente. Archivo `NoCobis<ddmmaa>.txt`, fin de línea CRLF. La configuración de la pestaña (columnas, estados pagos, importes) se guarda en la base compartida
   (`maestros/carteraConfig`) y es la misma para todos; el periodo elegido es de cada usuario.
   **NO COBIS por API** (Orquestador de Riesgos, `POST /v1/nocobis/ingreso`): el botón *Lote para la API (JSON)* baja
   las mismas operaciones del TXT (cliente = MIS, CCASR, moneda 80, saldo capital = valor a descuento, interés y OCIF 0,
   tasa 1, fechas de concesión y vencimiento) y *Script de envío a la API* baja `nocobis-api.ps1`, que se ejecuta en una
   PC de la red: obtiene el token OAuth2, valida el tipo de crédito contra el catálogo, simula por defecto y con `-Enviar`
   ingresa las operaciones con saldo > 0 (con `-Reemplazar` antes cancela las vigentes del mismo tipo). El client_secret
   se pide la primera vez y queda cifrado en esa PC (nunca en la página). Deja `NoCobis_resultado_<fecha>.csv`.
   *Probar conexión con la API* baja `probar-api-nocobis.ps1`: solo consulta (red, token, catálogo con el tipo CCASR y
   operaciones vigentes de un MIS) y no envía datos.
   **Envío automático a la API (cola + agente)** (sitio propio): *Enviar a la API* deja el lote pendiente en la base
   (`envios/<id>`); `nocobis-agente.ps1`, programado cada 5 minutos en una PC de la red de VALO, lo toma (función
   `tomar_envio`, un solo agente por envío), se loguea, ingresa y guarda el resultado, que la página muestra en vivo
   junto con el estado del agente. Instalación en `supabase/INSTRUCCIONES.md` (punto 5).
   **Envío directo por Power Automate** (sitio propio y archivo local): la página manda el lote a un flujo de Power
   Automate que, por el gateway de datos local, pide el token y llama a la API; muestra el número de operación o el
   error de cada banco y registra el envío (colección `envios`). Configuración del flujo y conectores en `powerautomate/`.
   Van todos los bancos de Bancos MELI (uno por MIS): con el valor a descuento si hay cartera
   para ese banco y en 0 si no hay equivalencia. Los titulares sin MIS en Bancos MELI quedan afuera (con aviso). Se pueden sumar importes adicionales. Descarga Excel.

   **Desde Power BI:** *Traer cartera de Power BI* manda una consulta DAX al modelo **ePortfolio_Mensual** (workspace
   ePortfolio) por un flujo de Power Automate (sin gateway) y carga la cartera ya agregada por titular, negocio
   (FideicomisoSerie), estado (con su descripción) y periodo. Armado del flujo: `powerautomate/POWERBI.md`. Con *Traer sola al abrir Cartera* (por defecto) la consulta se hace sola la primera vez que se abre la pestaña en la sesión.

   **Extracción automática:** la pestaña genera (con los negocios de Clientes y el estado "pago" elegido) un botón de
   favoritos que, tocado estando en el BI, consulta `/clickhouse/` y descarga `Cartera_por_titular` y `Cartera_detalle`
   del último periodo; y un script `cartera-bi.ps1` + comando `schtasks` para correrlo todos los días en una PC de la red.
   Consultas validadas con ClickHouse (chdb) y script probado con PowerShell 7.

6. **Inventario** (menú *Más ▾*) – se suben uno o varios reportes **HISTORICO DE GARANTIAS VIGENTES** del sistema de
   cartera (`garhicon` asociadas a deuda, `garhisin` no asociadas a producto, `.lis` de ancho fijo) y se unen en una tabla:
   preferida / no preferida, origen, moneda, tipo y código de garantía, cliente, descripción, monto en pesos y en moneda de
   origen. Controla los subtotales *TOTAL PREFERIDA / NO PREFERIDA* de cada reporte, filtra por preferida, moneda, origen o
   texto y exporta a Excel (hojas Inventario y Resumen). Los archivos quedan solo en la sesión del navegador.

   **Inventarios contables** (con garhicon + garhisin): 715.023.007.02 (preferidas USD EFECTU$S), 715.025.091.02 (no
   preferidas USD), 715.023.091.02 (preferidas USD sin EFECTU$S), 711.023.090.3 (preferidas en pesos) y 711.025.090.8 (no
   preferidas en pesos), con el formato de `Inventarios_ejemplos.xlsx`. Los de dólares van en U$S (monto moneda orig.) ×
   tipo de cambio Com. A 3500 del último día hábil del mes del inventario, tomado de `com3500.xls`
   del BCRA (botón *Traer del BCRA*; si el BCRA no lo permite, se sube el archivo o se escribe el TC). Se descargan en
   Excel (ExcelJS, con logo y colores VALO: rojo Pantone 186 C #CE162E y gris Cool Gray 10 #727274) y en PDF (jsPDF),
   uno por cuenta o todos juntos, con el saldo en letras y las firmas. El CUIT y la fecha de cada garantía (el reporte
   no los trae) salen de inventarios anteriores importados en Excel y de lo que se carga a mano; quedan en la base
   compartida (`maestros/inventarioPadron`). El CUIT sale además de la **base de entes** (tabla `entes`: ente → CUIT y
   nombre), que se carga masivamente desde las planillas de personas jurídicas y humanas (`external_code`,
   `tax_id_number`) o una planilla Ente · CUIT · Nombre, o de a uno desde el inventario; la base no se muestra, solo se
   consultan los entes de los reportes cargados. Las planillas de personas no se suben al repositorio. Las librerías de exportación se cargan al usarlas (`vendor/`, o CDN).

7. **Bastanteo** (menú *Más ▾*) – se sube el **resumen OCR** de los documentos del cliente (PDF con las secciones
   "Acreditación de Poderes") y la **planilla del cliente** (Excel con los firmantes y sus CUIT, las escrituras y las marcas
   X). Se arma un JSON por poder con el formato `PODER_COMPLEJO_AR` (escritura, tipo, empresa, otorgante, apoderados,
   estructuras de firma con las 64 facultades del catálogo de circuitos operativos y sus códigos). El número de
   identificación de cada persona es el **CUIT que contiene su DNI** (planilla o base de entes); si no se encuentra, el
   DNI. Las facultades salen del PDF; las que el PDF no trae, de las marcas X de la planilla, y si no, "no". Se pueden
   corregir a mano antes de descargar. También se descarga un **JSON único** del cliente: junta todos los poderes, agrupa
   a los apoderados por tipo de firma y facultades (grupos A, B, C…) y arma una estructura de firma por grupo, con sus
   apoderados y escrituras; al final lista los poderes de origen. Con planilla, los apoderados del PDF que no están en ella no se
   incluyen (se reconocen por el DNI dentro del CUIT o, si no, por el nombre); los firmantes de la planilla que no figuran
   en ningún poder quedan en el JSON único con una advertencia. Si la columna CUIT de la planilla trae un DNI, el CUIT se busca en la base de
   entes (por número de ente o por DNI); las planillas que traen CUIT y ente alimentan esa base. El PDF se lee en el navegador con pdf.js (`vendor/`, o CDN); no se guarda nada.

## Datos

- **Versión compartida (recomendada):** página publicada en claude.ai (`compartido/conversor-valo-compartido.html`).
  Clientes, secuencias, bancos e historial (con los CSV) viven en una base compartida: todos los que abren el link
  ven y usan los mismos datos, en vivo. Al generar un lote se bloquea el cliente y se relee su secuencia en la base,
  así dos personas no pueden tomar el mismo número. El historial registra quién procesó cada lote.
  Base: `clientes/*`, `lotes/*`, `lotesTxt/*` (CSV en partes), `maestros/bancos`, `maestros/bancosOriginales`.
- **Versión local:** `Conversor-VALO.html` guarda todo en el navegador (localStorage).
  Usar **Descargar respaldo** / **Restaurar respaldo** para guardarlos o pasarlos a otra PC.

## Archivos

- `Conversor-VALO.html` – archivo único para usar (generado por `construir.py`).
- `pagina.html` – interfaz (desarrollo).
- `app.js` – pantallas, almacenamiento y carga de archivos.
- `almacen.js` – guardado de datos: base compartida de claude.ai o navegador.
- `compartido/conversor-valo-compartido.html` – página publicada en claude.ai (generada por `construir.py`).
- `motor.js` – cálculo de Cuotas/Créditos y formato de los CSV (sin dependencias del navegador).
- `bancos-iniciales.js` – carga masiva inicial de Bancos.
- `bancos-meli-iniciales.js` – carga inicial de Bancos MELI (Banco_meli.xlsx).
