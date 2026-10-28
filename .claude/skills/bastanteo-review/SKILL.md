---
name: bastanteo-review
description: Revisar el resultado de un bastanteo de VALO (JSON 1.0 con empresa, apoderados y reglasFirma) o compararlo con otro (por ejemplo, el que está en producción). Usar cuando haya que validar grupos, firmantes, agrupamientos y reglas de un bastanteo, explicar diferencias entre dos JSON, o decidir si un error está en los datos, en la agrupación, en la combinación o en la regla.
---

# Revisión de bastanteo

## Modelo (cerrado: no agregar niveles ni usar sinónimos)

Entidades: **GRUPO**, **FIRMANTE**, **AGRUPAMIENTO**, **REGLA**.
Relaciones (no son entidades):

- **PERTENENCIA** = GRUPO ↔ FIRMANTE
- **PARTICIPACIÓN** = FIRMANTE ↔ AGRUPAMIENTO
- **APLICACIÓN** = AGRUPAMIENTO ↔ REGLA

```
GRUPO
 ├── PERTENENCIAS → FIRMANTES
 └── AGRUPAMIENTOS
       └── PARTICIPACIONES → FIRMANTES
             └── APLICACIÓN → REGLAS
```

Condición crítica: `AGRUPAMIENTO.grupo_id` = grupo de la PERTENENCIA de cada FIRMANTE que participa en él.

- La pertenencia sale de `apoderados[].grupos`. Nunca se deduce de la participación.
- No suponer que un firmante participa en todos los agrupamientos de su grupo. Puede participar en varios del mismo grupo.
- Una regla entre grupos (A+B) se aplica a un agrupamiento de cada grupo (una APLICACIÓN por agrupamiento) y es una sola fila en la Vista agrupada.

En el código (`valo/motor.js`):

| Función | Qué hace |
|---|---|
| `jsonBastanteoV1` | arma el JSON; cada regla lleva, sin exportarlo, `_participantes` (según los poderes), `_vto` y `_gemelaDe` (la misma regla en la otra moneda) |
| `modeloBastanteo(json)` | `{ grupos, firmantes, pertenencias, agrupamientos, participaciones, reglas, aplicaciones, errores }` |
| `vistaAgrupada(modelo)` | filas AGRUPAMIENTO + REGLA |
| `compararBastanteos(generado, esperado)` | diferencias clasificadas, con equivalencia semántica |

Un JSON leído de un archivo no trae `_participantes`. En ese caso la participación es la que el JSON implica: todo el grupo, o los `firmantes` de la regla.

## Orden de revisión

Validar siempre en este orden y no pasar al siguiente nivel sin entender los errores del anterior:

1. **GRUPO**: ¿existen los grupos que usan las reglas? ¿Hay grupos sin firmantes?
2. **PERTENENCIA**: ¿el firmante pertenece al grupo correcto? ¿Tiene CUIT/CUIL? ¿Está repetido o falta?
3. **AGRUPAMIENTO / PARTICIPACIÓN**: ¿la participación en el agrupamiento es correcta? ¿El agrupamiento contiene exactamente la combinación esperada? ¿Alcanzan los firmantes para el quorum?
4. **REGLA / APLICACIÓN**: ¿la regla está aplicada al agrupamiento correcto? ¿Son correctos tipo, quorum, monedas, límites y facultades?

## Clasificación de errores

| Error | Cuándo |
|---|---|
| ERROR DE GRUPO | una regla usa un grupo sin firmantes; un agrupamiento de un grupo inexistente; el grupo está en un JSON y no en el otro |
| ERROR DE PERTENENCIA | firmante sin CUIT/CUIL, repetido, sin grupo, o en otro grupo que en el esperado |
| ERROR DE PARTICIPACIÓN | según los poderes participa de una regla de un grupo al que no pertenece (por ejemplo, la planilla lo pone en B y el poder lo da en A+A) |
| ERROR DE AGRUPAMIENTO | agrupamiento vacío; no alcanzan los firmantes para el quorum; combinación que está en un solo JSON. *Aviso:* el JSON aplica la regla a todo el grupo pero según los poderes solo participan algunos |
| ERROR DE REGLA | tipo o quorum inválido (Conjunta con un solo grupo; Individual sin un firmante), monto sin moneda, facultad desconocida, o misma combinación con distintos límites o facultades |
| ERROR DE APLICACIÓN | regla sin agrupamiento; firmante de la regla que no está entre los apoderados; misma combinación aplicada a distintos firmantes |

Una regla que no se puede cumplir con los firmantes que quedaron (ConjuntaIndistinta A+A con una sola persona en A, una Conjunta con un grupo vacío) **no se incluye en el JSON generado**: `jsonBastanteoV1` la saca y deja un aviso ("No va la regla …: pide 2 firmas y entre los grupos A hay 1 firmante"). Si el modelo la marca como ERROR DE AGRUPAMIENTO es porque viene de un JSON de afuera (por ejemplo, el de producción) o de una corrección a mano; ahí no se cambia el JSON, se informa.

Reglas del sistema de destino:
- **ConjuntaIndistinta:** quorum = total de firmas.
- **Conjunta:** quorum = firmas de cada grupo, y al menos 2 grupos.
- **Individual:** un firmante.

## Equivalencia semántica (no textual)

- Cada regla se compara por las combinaciones mínimas de firmas que habilita:
  - ConjuntaIndistinta [A, B] q2 = A+A, A+B, B+B;
  - Conjunta [A, B] q1 = A+B;
  - una Conjunta de un solo grupo es la ConjuntaIndistinta de ese grupo.
- Personas: el CUIT/CUIL y el DNI de la misma persona son el mismo firmante (el DNI son las posiciones 3 a 10 del CUIT).
- Facultades: los códigos gemelos son la misma facultad (`TRF_ENTRE_CUENTAS_EM` = `TRF_ENTRE_CTAS_EMP`). Se muestran con el nombre del catálogo (`BASTANTEO_CATALOGO`).
- Monedas: la regla en ARS que es equivalente a la de USD (`_gemelaDe`) es la misma regla.
- Tope y sin tope son reglas distintas. Distintas facultades también.
- No fusionar reglas con diferencias semánticas. No suponer significado legal que no esté en los datos.

## Cómo correrlo

```
node .claude/skills/bastanteo-review/revisar.js generado.json             # validar un JSON
node .claude/skills/bastanteo-review/revisar.js generado.json esperado.json  # comparar con otro
```

Muestra los errores del modelo de cada JSON, la Vista agrupada y, si hay dos, las diferencias clasificadas.

Para el control de un resumen de poder contra Complif (Poder, Uso de firma, Grupo, Firmas conjuntas, Límite) usar el skill `control-resumenes-review`.

## Cómo razonar un caso

1. Corré el script y leé los errores **en orden** (grupo → pertenencia → agrupamiento → regla).
2. Para cada diferencia, ubicá dónde está el problema:
   - **Datos:** Complif, planilla o OCR. Por ejemplo, un firmante que no está en el Excel ni en ningún poder, facultades que la categorización de Complif no trae, o un nombre distinto. Se corrige en el origen o con *Marcar corrección*, no en el motor.
   - **Agrupación:** pertenencia vs. participación. Por ejemplo, la planilla y el poder no coinciden en el grupo de una persona. Es un ERROR DE PARTICIPACIÓN y lo decide la persona que revisa.
   - **Combinación:** el agrupamiento no tiene los firmantes que pide la regla, o la combinación existe en un solo lado.
   - **Regla:** tipo, quorum, límites, monedas o facultades.
3. Si el problema es de la lógica del motor, la corrección tiene que ser **general**: nada de `if (empresa === …)`, `if (firmante === …)` ni `if (grupo === 'A')`. Cada bug corregido lleva su test en `valo/tests/bastanteo.test.js` (`node --test valo/tests/*.test.js`).
4. Las correcciones marcadas en la pantalla quedan en la colección `bastanteoCorrecciones` de la base (JSON generado, corregido y comentario). Sirven como casos de ejemplo: compará `generado` contra `corregido` con el script.
