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
node .claude/skills/control-resumenes-review/controlar.js poderes_complif.json resumen.xlsx [--ignorar-revocatorias]
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

## Criterios aceptados desde la pantalla (cómo entrenar el skill sin pasar los casos)

Cuando una diferencia del control "en realidad está bien", la persona la acepta **en la misma pantalla**: en cada ✗ aparece el enlace *Aceptar este criterio* (con un comentario opcional de por qué está bien, abajo de la tabla). Eso guarda un registro en la colección `controlCriterios` de la base (punto, texto del resumen, texto del poder, detalle, comentario, empresa, firmante, `estado: 'pendiente'`) y esa diferencia, y las que tengan exactamente los mismos textos, pasan a **"a revisar" (—)** con el criterio a la vista (*Quitar el criterio* lo deshace). Funciona en el control de un cliente y en el chequeo masivo.

Un criterio aceptado **no cambia la lógica del control**: es un caso de entrenamiento. Para generalizarlo, al empezar a trabajar en el control:

1. Leé los pendientes (Supabase, tabla `docs`):

```sql
select path, data->>'creado' creado, data->>'razonSocial' empresa, data->>'firmante' firmante, data->>'punto' punto,
       data->>'resumen' resumen, data->>'poder' poder, data->>'detalle' detalle, data->>'comentario' comentario
from docs where coleccion = 'controlCriterios' and data->>'estado' = 'pendiente' order by 2;
```

2. Agrupá por punto y por el patrón (por ejemplo "el resumen da INDIVIDUAL y CONJUNTA, el poder solo CONJUNTA"), no por empresa. Si hay varios con el mismo patrón y comentario, es una regla; si es uno solo, preguntá antes de generalizar.
3. Reproducí un caso con `controlar.js` (documentos de Complif frescos; ver "Datos de Complif desactualizados").
4. Decidí con la persona si el patrón pasa a **OK** (el resumen y el poder dicen lo mismo, mal comparado) o a **a revisar** (no se contradicen pero tampoco coinciden). Una contradicción real sigue siendo diferencia.
5. Implementá la regla general en `controlResumen`, con su test, y medí todas las empresas con `medir.js` (sección siguiente) antes de publicar.
6. Marcá los criterios resueltos (`estado: 'resuelto'`, con el commit) y quitá los que la regla ya cubre:

```sql
update docs set data = jsonb_set(data, '{estado}', '"resuelto"') where path in ('controlCriterios/<id>', …);
```

## Inconsistencias conocidas (ya resueltas: no volver a romperlas)

Cada una salió de un caso real. Si aparece otra parecida, sumá acá el patrón (sin nombres de clientes) y su test.

1. **Grupos armados por la página.** Si el poder no asigna grupos con letra, la página arma los grupos por las facultades y les pone una letra arbitraria (A, B, C…). Esa letra no se compara con la del resumen. Si todos los integrantes del grupo que están en el resumen tienen la misma letra, esa es la del grupo (`autoLetra` en `controlResumen`; el bastanteo hace lo mismo con el renombre de letras de la planilla).
2. **Grupo de una sola persona con "dos cualesquiera apoderados".** Esa persona no puede firmar "con ella misma": su segunda firma es la de otro apoderado. Su "L+L" vale también para L con cada otro grupo (A+B, A+C), y los demás firmantes firman con ella. El bastanteo (`jsonBastanteoV1`) ya la saca como A+B; el control tiene que dar el mismo resultado ("lo que el agrupamiento toma bien, el control no lo marca como diferencia"). **Se mantiene también la forma "dos del mismo grupo"**: reemplazar L+L por L+otros hizo aparecer diferencias falsas en resúmenes que escriben "B+B" para esas personas. Se detectó recién al medir todas las empresas.
3. **Datos de Complif desactualizados.** El OCR de los poderes se vuelve a correr (`ocr_created_at`): un resultado distinto al de la pantalla casi siempre es una copia vieja de los documentos. Antes de buscar un bug, traé los documentos de la empresa de Complif de nuevo y compará `ocr_created_at` con los que usás. Un mismo poder puede estar dos veces (documentos distintos con la misma escritura): el control los ve a los dos.
4. **Excepción de revocatoria.** Si la pantalla "ignora" la revocatoria de un poder, reproducilo con `controlar.js … --ignorar-revocatorias`; sin eso, los firmantes de poderes anulados dan "Poder" como diferencia.
5. **Un cambio que arregla un caso suele romper otros.** Los puntos anteriores aparecieron así. Nunca se publica un cambio del control sin la medición de todas las empresas (próxima sección).

## Antes de cambiar el control: medir en todas las empresas

El control se usa en el chequeo masivo, así que un cambio puede mover resultados de otras empresas. Con `medir.js` (todos los Excel de una carpeta contra los documentos de Complif, como el chequeo masivo):

```
git show HEAD:valo/motor.js > motor_anterior.js
MOTOR=motor_anterior.js node .claude/skills/control-resumenes-review/medir.js poderes_complif.json carpeta_excels antes.txt
node .claude/skills/control-resumenes-review/medir.js poderes_complif.json carpeta_excels despues.txt
diff <(sort antes.txt) <(sort despues.txt)
```

Las filas que desaparecen son diferencias resueltas. Las que **aparecen** (o la misma fila que pasa de REV a DIF) son regresiones: investigalas una por una antes de seguir. Compará también el total por punto. Última medición estable: 141 empresas con diferencias, 292 que coinciden, 19 sin poderes y 497 diferencias (Poder 256, Firmas conjuntas 141, Grupo 78, Uso de firma 17, Límite 5). Cualquier cambio de ese total tiene que poder explicarse con un caso concreto.

## Relación con el bastanteo

El JSON del bastanteo y el control usan el mismo JSON único de poderes, así que un error de datos (grupos, combinaciones, vencimientos) se ve en los dos. Si el modelo del bastanteo marca un error de AGRUPAMIENTO, buscá el mismo problema en el punto "Firmas conjuntas" del control.
