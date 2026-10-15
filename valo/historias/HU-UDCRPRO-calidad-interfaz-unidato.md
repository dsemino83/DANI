# HU – UDCRPRO: interfaz automática, conciliada y válida para el Régimen de Deudores (ESD)

**Origen:** mail de Alejandro E. Orona (Jefe de Control Operativo Contable – Contaduría), "Régimen de Deudores – Agosto 2026", con adjunto *Udcrpro previo 31082026.xlsx*.
**Fuera de alcance:** el cálculo y la incorporación de **previsiones** en el UDCRPRO / archivo 4305, que ya se resuelve en otro desarrollo.

---

## Historia de usuario

**Como** Jefe de Control Operativo Contable (Contaduría),
**quiero** recibir el archivo UDCRPRO (interfaz de UNIDATO) completo, conciliado con la contabilidad y sin errores de formato, dentro de los primeros 5 días hábiles del cierre,
**para** procesar el Régimen Informativo de Deudores (ESD) en UNIDATO sin ajustes manuales en Excel, en término y cumpliendo la normativa del BCRA y los requisitos de Auditoría Interna y Externa.

## Contexto / problema

En el cierre de agosto 2026 armar el régimen llevó **una semana de trabajo manual**, con riesgo de errores y de no llegar al vencimiento:

| # | Problema detectado en UDCRPRO | Evidencia |
|---|---|---|
| 1 | **Capital e intereses de descubiertos** no coinciden con contabilidad. Contaduría corrige la interfaz a mano, punteando contra el inventario manual que envía Activas. | El adjunto tiene ~15.350 registros; **~490 filas marcadas en naranja/marrón** (ajustes, concentradas en la partida 1614 y en 1601/1600) y **~220 en amarillo**, sobre todo en columnas de capital e intereses. |
| 2 | **Intereses de Celulosa** no se informan por estar **congelados**. Toda deuda debe coincidir con contabilidad, así que el dato tiene que venir en el archivo. | Mail. |
| 3 | **Inventarios de COBIS no cierran con los saldos contables**. Como las interfaces se generan desde esos inventarios, el error se arrastra; Activas termina haciendo un inventario paralelo en Excel (doble tarea). | Mail. Es uno de los principales problemas del ESD. |
| 4 | **Cartera MELI (ePortfolio/Activas)**: unos **24.000 errores** entre Udincli y Udcrpro por **símbolos en nombres** y **código de situación 10** (inexistente). Se corrigieron a mano con Diego Apezteguia. | Mail. Es el primer mes con MELI en este volumen. |
| 5 | **Plazos**: el archivo balanceado por Activas llegó recién el **11/09**. | Se necesita dentro de los primeros 5 días hábiles del cierre. |
| 6 | Muchos de estos problemas **ya se habían reportado** en meses anteriores y siguen sin solución. | Mail. |

## Criterios de aceptación

**CA1 – Conciliación de descubiertos (capital e intereses)**
- *Dado* el cierre mensual, *cuando* COBIS genera el UDCRPRO, *entonces* la suma de capital e intereses de descubiertos por partida contable coincide con el saldo contable (diferencia 0 o dentro de la tolerancia que defina Contaduría).
- Se genera un **reporte de conciliación** UDCRPRO vs. contabilidad por partida (por ejemplo 1600, 1601, 1614), con las diferencias a nivel operación si las hubiera.

**CA2 – Intereses congelados (Celulosa y casos similares)**
- Las operaciones con intereses congelados informan su interés devengado/contabilizado en UDCRPRO y no quedan en cero.
- La deuda de Celulosa en UDCRPRO coincide con su saldo contable.

**CA3 – Inventarios COBIS = contabilidad**
- Los inventarios de COBIS que alimentan las interfaces cierran con los saldos contables al cierre del mes.
- Activas deja de armar el inventario manual en Excel: el inventario de COBIS es la única fuente.
- Si hay diferencias, se informan automáticamente a Activas y a Sistemas-COBIS **antes** de generar la interfaz.

**CA4 – Calidad de datos de la cartera MELI / ePortfolio**
- Nombres y razones sociales sin caracteres que UNIDATO o el BCRA no admiten: se normalizan (acentos, ñ, símbolos) según el set permitido.
- El código de situación siempre es un valor válido de la tabla BCRA. **Situación 10 no se acepta**: se rechaza o se mapea según la regla que acuerden Riesgos y Activas.
- Los clientes de MELI en Udcrpro existen en Udincli con los mismos datos de identificación, y viceversa.

**CA5 – Validación previa automática**
- Antes de enviar a Contaduría corre un **validador** de UDCRPRO (y de su cruce con Udincli) que controla:
  - formato y longitud de campos y caracteres válidos;
  - situación dentro de la tabla;
  - CUIT/CUIL con dígito verificador válido;
  - existencia del cliente en Udincli;
  - totales por partida vs. contabilidad.
- El validador emite un log de errores. Si hay errores bloqueantes, el archivo no se entrega y vuelve al área responsable.

**CA6 – Plazo de entrega**
- El UDCRPRO validado y conciliado se entrega a Contaduría **a más tardar el 5.º día hábil** posterior al cierre de mes.

**CA7 – Sin ajustes manuales**
- En el cierre siguiente a la puesta en producción, Contaduría levanta el UDCRPRO en UNIDATO **sin modificar a mano** ningún registro de capital, intereses ni datos de cliente. Objetivo: 0 filas ajustadas, contra ~700 en agosto 2026.

## Tareas sugeridas

1. **Análisis:** clasificar los ~710 ajustes del *Udcrpro previo 31082026.xlsx* por causa raíz (partida, campo, tipo de operación).
2. **COBIS – descubiertos:** corregir la extracción de capital e intereses de descubiertos para que cuadre con contabilidad.
3. **COBIS – intereses congelados:** incluir los intereses congelados (Celulosa) en la generación del UDCRPRO.
4. **COBIS / Activas – inventarios:** revisar en conjunto la generación de inventarios y su cierre contable, y dar de baja el inventario manual en Excel.
5. **ePortfolio / MELI:** limpiar caracteres de nombres y validar el código de situación en origen. Revisar el mapeo de "situación 10".
6. **Validador:** desarrollar el validador automático pre-UNIDATO (UDCRPRO + Udincli) con reporte de conciliación por partida.
7. **Proceso:** definir el cronograma de cierre (hito: día hábil 5) y responsables por área.
8. **QA:** prueba en paralelo con el cierre siguiente, comparando contra contabilidad y UNIDATO.

## Definición de Hecho (DoD)

- Los criterios CA1 a CA7 están verificados con datos de un cierre real.
- El reporte de conciliación muestra diferencia 0 (o tolerancia aprobada) por partida.
- El validador está documentado y en producción, y su log se entrega junto al archivo.
- Contaduría y Auditoría Interna dan su conformidad con un cierre procesado sin ajustes manuales.

## Interesados

Contaduría (Alejandro Orona, Daniel Real) · Sistemas – COBIS · Activas · ePortfolio (Diego Apezteguia) · Riesgos Económicos · Auditoría Interna · Riesgo Operacional.

## Relacionado, fuera de esta historia

- **Previsiones** (archivo 4305): se resuelve en otro desarrollo.
- **Udincli – CUIT que empiezan con 98** (por ejemplo "A9830708240873 VR GLOBAL PARTNERS L.P.", CUIT real 30708240873): hay que corregirlo en la base de clientes / MIS. Se sugiere una historia aparte, aunque CA5 lo detecta en el cruce.
- **Riesgos Económicos – clientes depurados con deuda:** revisar el procedimiento de alta, modificación y depuración de situación, y agregar un punto de control. Se sugiere una historia aparte con SAC y Riesgos.
