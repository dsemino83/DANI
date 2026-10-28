---
name: control-resumenes-review
description: Revisar el control de un resumen de poder (Excel del cliente) contra los poderes de Complif, tanto el control de un cliente como el chequeo masivo de VALO. Usar cuando haya que explicar por qué un firmante da diferencia (Poder, Uso de firma, Grupo, Firmas conjuntas, Límite), decidir si el problema está en el Excel, en Complif o en la lógica del control, o validar que un cambio del control no mueva los resultados de las demás empresas.
---

# Revisión del control de resúmenes

El control compara, por cada firmante del Excel del cliente ("resumen de poder"), lo que dice el resumen contra lo que dan los poderes vigentes de Complif. Es distinto del bastanteo (JSON 1.0, skill `bastanteo-review`): acá no se genera nada, se **controla**.

## Recorrido (`controlarResumen0` en `valo/app.js`)

1. `leerClienteBastanteo(hojas)` lee el Excel: razón social, CUIT, firmantes (nombre, CUIT/DNI, grupo, tipo, combinaciones, límite) y las observaciones.
2. `complifDeEmpresa(docs, cuit, nombre)` busca poderes y actas de la empresa en Complif: por CUIT, por razón social y por los vínculos (`relations`) del documento.
3. `aplicarRevocatorias(poderes)` saca los poderes **revocados y vencidos**. Si no queda ninguno, el estado es *Sin poderes* (salvo presidente o gerente por acta o estatuto: `poderDelPresidente`, `poderesFirmantesD`).
4. `jsonPoder` + `jsonBastanteoUnico` arman el JSON único de poderes (apoderados, grupos, combinaciones, facultades, límites).
5. `controlResumen(unico, cliente, actas, revocados)` devuelve una fila por firmante del Excel con sus **puntos**.

## Puntos de cada firmante

| Punto | Qué compara |
|---|---|
| **Poder** | ¿el firmante figura como apoderado en un poder vigente? Si no, indica si está revocado o no figura. |
| **Uso de firma** | tipo del resumen (INDIVIDUAL / CONJUNTA) contra los tipos del poder. Si el poder da individual, un resumen conjunto es más restrictivo (REV, no error). |
| **Grupo** | letra del resumen contra los grupos del poder, con equivalencias (números o romanos, letras traducidas por mayoría, grupos de una sola persona, presidente "D"). Con grupos puestos por la página (el poder no asigna) no aplica. |
| **Firmas conjuntas** | combinaciones del resumen contra las del poder (A+A, A+B…). Que el poder dé más que el resumen es REV; que el resumen incluya una que el poder no da es DIF. |
| **Límite** | solo para firma individual: con o sin límite en el resumen contra las frases de límite del poder. En conjunta no aplica. |

Cada punto tiene `ok`: **true** (OK), **false** (DIF: diferencia, estado de la empresa `dif`) o **null** (REV: no es un error, hay que mirarlo). Estados por empresa: `ok`, `dif`, `sinpod`, `err`.

## Cómo correrlo

```
node .claude/skills/control-resumenes-review/controlar.js poderes_complif.json resumen.xlsx
```

`poderes_complif.json` es la lista de documentos de Complif (los que baja la página). **No se versiona**: tiene datos de clientes, igual que los Excel. Muestra los poderes vigentes y anulados, cada firmante con sus puntos (OK / REV / DIF), los firmantes sin poder y los apoderados que no están en el resumen.

## Cómo razonar una diferencia

1. Mirá primero los poderes: ¿hay revocatorias o vencimientos que sacan un poder? ¿Falta un poder en Complif o vinculado a otra empresa? Un resumen cuyos firmantes casi no figuran en los poderes suele ser un poder faltante, no un resumen mal.
2. Ubicá el problema:
   - **Excel:** letra, tipo o combinación mal escrita; un firmante sin CUIT/DNI; CLIENTE de otra empresa. Se corrige en el Excel.
   - **Complif:** poder mal leído por el OCR (facultades, combinaciones, límite, vencimiento, grupos). Se corrige en Complif, o se ignora una revocatoria con la excepción de la página.
   - **Equivalencia de grupos:** el resumen nombra con otra letra el mismo grupo. Revisá `equiv` y los grupos de una sola persona en `controlResumen` antes de dar el punto por mal.
   - **Lógica del control:** si dos casos iguales dan distinto, o el control dice DIF por algo que el poder sí da, es un bug del motor.
3. Si es del motor, la corrección tiene que ser **general**: nada de `if (empresa === …)`, `if (firmante === …)` ni letras fijas. Cada bug corregido lleva su test en `valo/tests/` y se corre `npm run test:bastanteo`.
4. **No suavices el control para que dé OK**: un REV (null) solo corresponde cuando el poder y el resumen no se contradicen pero tampoco coinciden (más restrictivo, sin grupos). Una contradicción es DIF.

## Antes de cambiar el control: medir en todas las empresas

El control se usa en el chequeo masivo, así que un cambio puede mover resultados de otras empresas. Corré el chequeo con todas las empresas antes y después (mismos Excel y mismos documentos de Complif) y compará el total de diferencias por punto. La última medición estable: 141 empresas con diferencias, 292 que coinciden, 19 sin poderes y 497 diferencias (Poder 256, Firmas conjuntas 141, Grupo 78, Uso de firma 17, Límite 5). Cualquier cambio de ese total tiene que poder explicarse con un caso concreto.

## Relación con el bastanteo

El JSON del bastanteo y el control usan el mismo JSON único de poderes, así que un error de datos (grupos, combinaciones, vencimientos) se ve en los dos. Si el modelo del bastanteo marca un error de AGRUPAMIENTO, buscá el mismo problema en el punto "Firmas conjuntas" del control.
