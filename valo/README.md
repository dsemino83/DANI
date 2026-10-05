# VALO - EPORTFOLIO (Conversor GetNet)

Página web que reemplaza el flujo manual del libro **Conversor GetNet.xlsx** + los scripts
`GenerarCuotas.py` y `GenerarCreditos.py`.

**En internet:** https://dsemino83.github.io/DANI/valo/ redirige a la base compartida en claude.ai (https://claude.ai/artifact/62SNb4MoRSHQr9ke5kfqYa).

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
