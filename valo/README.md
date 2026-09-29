# Conversor VALO · GetNet

Página web que reemplaza el flujo manual del libro **Conversor GetNet.xlsx** + los scripts
`GenerarCuotas.py` y `GenerarCreditos.py`.

Abrir `valo/index.html` en el navegador (funciona sin servidor ni internet: SheetJS está en `vendor/`).

## Flujo

1. **Clientes** – apertura del cliente: Nº de negocio, CUIT del cedente (11 dígitos) y nombre.
   Opcionalmente, la última secuencia ya usada (0 = el primer lote sale con secuencia 1).
   Sin cliente abierto no se puede cargar ningún archivo.
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
     `CuotasGetNet<ddmmyy>.txt` y `CreditosGetNet<ddmmyy>.txt`, con el mismo contenido que los scripts Python.
4. **Historial** – re-descarga de TXT y anulación del último lote de cada cliente (devuelve la secuencia).

## Datos

Clientes, secuencias, bancos e historial quedan guardados en el navegador (localStorage).
Usar **Descargar respaldo** / **Restaurar respaldo** para guardarlos o pasarlos a otra PC.

## Archivos

- `index.html` – interfaz.
- `app.js` – pantallas, almacenamiento y carga de archivos.
- `motor.js` – cálculo de Cuotas/Créditos y formato de los TXT (sin dependencias del navegador).
- `bancos-iniciales.js` – carga masiva inicial de Bancos.
