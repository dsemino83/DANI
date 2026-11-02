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

## Letras de grupo equivalentes

Dos fuentes pueden llamar distinto al mismo grupo (el resumen dice A donde el bastanteo dice B). La letra no es el dato: lo es *quiénes* están en el grupo. `contraExcel.js` deduce el renombre por las personas (`equivalenciaDeLetras`, `renombrarGrupos`):

- Si el renombre es consistente (cada letra apunta a un solo grupo y viceversa), se compara con las letras renombradas y se avisa (no es un error).
- Si una letra apunta a dos grupos o dos letras al mismo grupo, no hay equivalencia: se compara tal cual y las diferencias de grupo quedan como ERROR DE PERTENENCIA.

## Control contra el Excel (resumen de poder)

Por cada firmante del resumen, cinco puntos con el mismo criterio que `control-resumenes-review`:

| Punto | Qué compara |
|---|---|
| Pertenencia | ¿está en el bastanteo? ¿figura revocado en el resumen y el bastanteo lo incluye? |
| Grupo | letra del resumen (con equivalencia de letras) contra el grupo del bastanteo |
| Uso de firma | INDIVIDUAL / CONJUNTA del resumen contra las reglas en las que participa |
| Firmas conjuntas | combinaciones del resumen (A+A, A+B…) contra las combinaciones mínimas que habilitan sus reglas |
| Límite | solo individual: límite y moneda del resumen contra el tope de la regla |

- **OK**: coincide (o no aplica). **REV**: el bastanteo da *más* que el resumen, o el resumen no dice el dato; es un aviso, nunca un error. **DIF**: el resumen pide algo que el bastanteo no da, o se contradicen; es un error.
- Se encuentra al firmante por CUIT, luego DNI (posiciones 3 a 10 del CUIT) y luego nombre (en cualquier orden).
- Apoderado del bastanteo que no está en el resumen: aviso. Firmante del resumen que no está en el bastanteo, o revocado e incluido: ERROR DE PERTENENCIA.
- Las facultades marcadas con "X" en el resumen tienen que estar dadas por alguna regla (ERROR DE REGLA si no). Sin marcas no se controlan facultades. No se controla al revés.
- No se suaviza una diferencia: si el resumen dice "sin límite" y el bastanteo tiene tope, es DIF.
- CUIT o razón social de la empresa distintos entre resumen y bastanteo: aviso.

La lógica está en `valo/motor.js` (`compararConExcel`, `equivalenciaDeLetras`, `renombrarGrupos`) y la usan la página (Bastanteo → Vista agrupada → "Control contra la planilla del cliente") y este skill; `contraExcel.js` solo la expone para `revisar.js` y los tests. Una `ConjuntaIndistinta` de una sola firma cuenta como firma individual.

## Cómo correrlo

```
node .claude/skills/bastanteo-review/revisar.js generado.json                          # validar un JSON
node .claude/skills/bastanteo-review/revisar.js generado.json esperado.json            # comparar con otro (con equivalencia de letras)
node .claude/skills/bastanteo-review/revisar.js generado.json --excel resumen.xlsx     # controlar contra el resumen del cliente
```

Muestra los errores del modelo, la Vista agrupada, las diferencias y, con `--excel`, la tabla firmante por firmante (OK/REV/DIF) y los hallazgos agrupados por tipo con *dónde mirar primero*. Salida: 0 sin diferencias, 1 con errores, 2 si falta un archivo o es inválido.

Tests: `npm run test:bastanteo` (los del Excel están en `valo/tests/bastanteo-excel.test.js`, con datos inventados).

Para el control de un resumen de poder contra los poderes de Complif (Poder, Uso de firma, Grupo, Firmas conjuntas, Límite) usar el skill `control-resumenes-review`. Este skill controla el *resultado* del bastanteo contra el resumen; aquel controla el resumen contra los poderes.

## Cómo razonar un caso

1. Corré el script y leé los errores **en orden** (grupo → pertenencia → agrupamiento → regla).
2. Para cada diferencia, ubicá dónde está el problema:
   - **Datos:** Complif, planilla o OCR. Por ejemplo, un firmante que no está en el Excel ni en ningún poder, facultades que la categorización de Complif no trae, o un nombre distinto. Se corrige en el origen o con *Marcar corrección*, no en el motor.
   - **Agrupación:** pertenencia vs. participación. Por ejemplo, la planilla y el poder no coinciden en el grupo de una persona. Es un ERROR DE PARTICIPACIÓN y lo decide la persona que revisa.
   - **Combinación:** el agrupamiento no tiene los firmantes que pide la regla, o la combinación existe en un solo lado.
   - **Regla:** tipo, quorum, límites, monedas o facultades.
3. Si el problema es de la lógica del motor, la corrección tiene que ser **general**: nada de `if (empresa === …)`, `if (firmante === …)` ni `if (grupo === 'A')`. Cada bug corregido lleva su test en `valo/tests/bastanteo.test.js` (`node --test valo/tests/*.test.js`).
4. Las correcciones marcadas en la pantalla quedan en la colección `bastanteoCorrecciones` de la base (JSON generado, corregido y comentario). Sirven como casos de ejemplo: compará `generado` contra `corregido` con el script.

## Control de lectura del texto (anti-regresión)

Los errores más caros vienen de leer mal el texto de un uso de firma (por ejemplo "Tipo de Firma C … (indistinta, con Firma B)" leído como C+C en vez de B+C). Reglas fijas:

- **Todo grupo que el texto nombra tiene que aparecer en la lectura.** `jsonBastanteoV1` avisa ("El texto del uso de firma nombra el grupo B pero la lectura (C+C) no lo usa") cuando un uso conjunto no usa un grupo que su descripción o limitaciones nombran. Ese aviso se revisa a mano, no se ignora.
- "Indistinta" es *cuál* de los del grupo; no significa "dos del mismo grupo". "Con Firma X" agrega el grupo X a la combinación.
- Si descripción y limitaciones se contradicen ("Un Tipo de Firma B y un Tipo de Firma C conjuntamente"), manda la combinación explícita.
- Cada caso nuevo de lectura mal hecha se corrige de forma general en `valo/motor.js` (`gruposDelUso`, `conPersonasEnUsos`) y suma un test con datos inventados en `valo/tests/bastanteo-excel.test.js`. Nada de `if (empresa === …)`.
- Antes de publicar: `npm run test:bastanteo`, subir la versión en `valo/pagina.html`, `python3 construir.py` (desde `valo/`), `git add web/index.html`, y publicar en la rama **SO** (el sitio sale de ahí) y en DANI-V.

## Firmante de la planilla sin poder: datos de los documentos onboardeados

Si un firmante de la planilla no figura en ningún poder, nunca queda solo con "sin poder": se buscan sus datos en los documentos onboardeados (acta de designación y estatuto de Complif o del PDF; `datosOnboarding` / `textoOnboarding` en `valo/motor.js`).

- Se toma el acta más reciente donde aparece (por DNI o nombre, en cualquier orden). Trae cargo, DNI, tipo de documento y fecha.
- Se muestra en la tabla "sin poder" (columna *Documentos onboardeados*), en el control del resumen (punto Poder), en el chequeo masivo, y en el JSON único (`advertencia`, `rol_en_documentos`, `documento_onboarding`). Si la planilla no tiene DNI ni CUIT, se completa el DNI con el del acta.
- Que figure en el acta **no le da grupo ni reglas de firma**: es información para revisar. Solo el presidente / gerente validado por acta firma como grupo D (`poderesFirmantesD`).
- Si no figura ni en poderes ni en actas, se dice "no figura en actas ni estatuto".
