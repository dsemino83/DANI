# Conversor VALO · GetNet

Página web que reemplaza el flujo manual del libro **Conversor GetNet.xlsx** + los scripts
`GenerarCuotas.py` y `GenerarCreditos.py`.

**En internet:** https://dsemino83.github.io/DANI/valo/ (GitHub Pages publicando la rama `VALO`).

**Para usarla: abrir `Conversor-VALO.html`** (un solo archivo con todo adentro; se puede descargar suelto y abrir con doble clic, sin internet).

`index.html` es la versión de desarrollo y solo funciona dentro de la carpeta `valo` completa.
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
2. **Bancos** – tabla maestra precargada con la solapa Bancos del conversor (107 bancos).
   Se actualiza subiendo un Excel con `Banco, Nombre, CUIT, Jurisdiccion, Codigo Sucursal, Codigo Nº Credito`
   (modo *actualizar/agregar* o *reemplazar todo*), o editando banco por banco.
   Si falta el código de crédito se usa `RIGHT(Banco,4)`; si falta la sucursal se toma de la provincia.
3. **Carga de lote** – elegir cliente y tipo de acción, completar periodo y tasa, y adjuntar el Excel del cliente.
   - Secuencia: se guarda por cliente; cada lote procesado toma la siguiente (última + 1).
   - **Alta**: lote = secuencia. **Revolving**: lote = 0.
   - Se lee la hoja de cupones GetNet (`cod_entidad_bancaria`, `entidad_bancaria`,
     `dat_reconciliation_estimated_date`, monto) o una hoja en formato Reporte
     (`ID_LOTE, COD_BANCO, NOMBRE_BANCO, MONTO, FECHA_VENCIMIENTO, …`).
   - Controles previos: formulario LISTO, filas válidas, y todos los bancos usados completos
     (sin *Prueba* ni *#N/D*). Si algo falla no deja procesar.
   - Genera Cuotas y Créditos con las mismas reglas del conversor y descarga
     `CuotasGetNet<ddmmyy>.csv` y `CreditosGetNet<ddmmyy>.csv` (CSV UTF-8), con el mismo contenido que los scripts Python.
4. **Historial** – registro de todos los CSV generados, filtrable por cliente y por tipo de acción (Alta / Revolving),
   con totales por tipo, re-descarga de los CSV, exportación a Excel y anulación del último lote de cada cliente
   (devuelve la secuencia).

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
- `index.html` – interfaz (desarrollo).
- `app.js` – pantallas, almacenamiento y carga de archivos.
- `almacen.js` – guardado de datos: base compartida de claude.ai o navegador.
- `compartido/conversor-valo-compartido.html` – página publicada en claude.ai (generada por `construir.py`).
- `motor.js` – cálculo de Cuotas/Créditos y formato de los CSV (sin dependencias del navegador).
- `bancos-iniciales.js` – carga masiva inicial de Bancos.
