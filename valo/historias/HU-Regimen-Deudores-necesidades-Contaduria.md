# HU – Régimen de Deudores (ESD): interfaces y datos correctos de origen, sin ajustes manuales

**Origen:** mail de Alejandro E. Orona (Jefe de Control Operativo Contable – Contaduría), "Régimen de Deudores – Agosto 2026", con adjunto *Udcrpro previo 31082026.xlsx*.
**Fuera de alcance:** **previsiones** (cálculo e incorporación al UDCRPRO / archivo 4305), que se resuelven en otro desarrollo.

---

## Historia de usuario

**Como** Jefe de Control Operativo Contable (Contaduría),
**quiero** que todas las fuentes del Régimen de Deudores generen datos correctos, conciliados con la contabilidad y en término. Las fuentes son COBIS (Udincli, Udcrpro, inventarios), la base de clientes, los datos de Riesgos y los productos no COBIS. Para los productos no COBIS, quiero que se informe la última versión del dato al último día del mes, aunque después se haya pisado.
**para** procesar el ESD en UNIDATO de forma automática, sin corregir a mano interfaces ni archivos finales, en término y cumpliendo la normativa del BCRA y lo que exigen Auditoría Interna y Externa.

## Contexto

- Armar el régimen de agosto 2026 llevó **una semana de trabajo manual**, con riesgo de errores y de no llegar al vencimiento.
- Ya se informan unos **165.000 clientes** al BCRA.
- Muchos de estos problemas **ya se habían reportado antes** y siguen sin solución.
- Los ajustes manuales en las interfaces de entrada y en los archivos finales **no los aceptan Auditoría Interna/Externa ni la normativa del BCRA**.

## Necesidades y criterios de aceptación

### N1 – Base de clientes: codificador de tipo de documento erróneo (SAC / COBIS)
**Problema:** en Udincli hay clientes con el **código de tipo de documento 98**, que es incorrecto. UNIDATO no levanta esos registros y Contaduría tiene que corregir la interfaz a mano.
- Ejemplo: `A 98 30708240873 VR GLOBAL PARTNERS L.P.`
- El número 30708240873 es correcto. Lo que está mal es el tipo de documento 98, que debería ser el código de CUIT.
- **CA1.1** – Se corrige en la base de clientes / MIS el tipo de documento de los casos detectados.
- **CA1.2** – Se hace un relevamiento directo en el MIS de **todos** los clientes con tipo de documento 98 o con cualquier otro código que no esté en la tabla de tipos de documento que acepta UNIDATO/BCRA, y se regularizan.
- **CA1.3** – La base de clientes no permite dar de alta ni modificar un cliente con un código de tipo de documento inválido, ni con un tipo que no corresponda al número informado. Por ejemplo, un número de CUIT tiene que llevar el código de CUIT.
- **CA1.4** – Udincli sale sin tipos de documento inválidos y Contaduría no corrige la interfaz a mano.

### N2 – Situación y tipo de cartera de clientes depurados (Riesgos Económicos / SAC)
**Problema:** Riesgos no puede actualizar la situación de clientes que figuran **depurados**, y Contaduría termina corrigiendo a mano el archivo de salida al BCRA.
- **CA2.1** – Se revisa el procedimiento de carga y modificación de la **situación** y el **tipo de cartera** de clientes, y Riesgos puede actualizarlos en el sistema.
- **CA2.2** – El procedimiento de **depuración de clientes** queda formalizado, a cargo de responsables o procesos específicos.
- **CA2.3** – Hay un **punto de control** que impide depurar un cliente con deuda vigente, o lo alerta si ya está depurado.
- **CA2.4** – El archivo de salida al BCRA refleja la situación de Riesgos sin correcciones manuales de Contaduría.

### N3 – UDCRPRO: capital e intereses de descubiertos (Sistemas / COBIS)
**Problema:** Contaduría ajustó a mano capital e intereses de descubiertos, punteando contra el inventario manual de Activas.
- En el adjunto hay unos **15.350 registros**.
- Cerca de **490 filas están marcadas en naranja/marrón**, sobre todo en la partida 1614 y en 1601/1600.
- Otras **~220 filas están en amarillo**.
- **CA3.1** – El capital y los intereses de descubiertos en UDCRPRO coinciden con el saldo contable por partida.
- **CA3.2** – Se genera un reporte de conciliación UDCRPRO vs. contabilidad por partida, con el detalle de las diferencias.

### N4 – UDCRPRO: intereses congelados (Celulosa)
**Problema:** no se informan los intereses de Celulosa porque están congelados.
- **CA4.1** – Las operaciones con intereses congelados informan el interés contabilizado en UDCRPRO.
- **CA4.2** – La deuda de Celulosa en UDCRPRO coincide con la contabilidad.

### N5 – Inventarios que cierren con la contabilidad (COBIS / Activas)
**Problema:** los inventarios de COBIS no cierran con los saldos contables, y Activas hace un inventario manual en Excel (doble tarea y pérdida de tiempo).
- **CA5.1** – Los inventarios de COBIS cierran con los saldos contables al cierre del mes.
- **CA5.2** – Se arma una mesa de trabajo conjunta entre el sector que administra los inventarios (Activas) y el equipo COBIS de Sistemas, con responsables y plan.
- **CA5.3** – Se da de baja el inventario manual en Excel y el inventario de COBIS pasa a ser la única fuente.
- **CA5.4** – Si aparecen diferencias, se avisa automáticamente antes de generar las interfaces.

### N6 – Plazos de entrega
- **CA6.1** – Las interfaces Udincli y Udcrpro, validadas y conciliadas, llegan a Contaduría **dentro de los primeros 5 días hábiles** del cierre.
- **CA6.2** – Hay un cronograma de cierre con hitos y responsables por área.

### N7 – Todos los sistemas conciliados con contabilidad
- **CA7.1** – Los inventarios y saldos de **todos** los sistemas que participan del proceso, COBIS y no COBIS, cierran con la contabilidad.
- **CA7.2** – Antes de entregar, corre un validador automático sobre cada interfaz que controla:
  - formato y caracteres;
  - tipo de documento válido y coherente con el número;
  - situación válida;
  - cruce Udincli ↔ Udcrpro;
  - totales vs. contabilidad.
- **CA7.3** – Si hay errores bloqueantes, el archivo vuelve al área de origen con el log de errores.

### N8 – Cero ajustes manuales
- **CA8.1** – En el cierre siguiente a la puesta en producción, Contaduría procesa el ESD en UNIDATO **sin modificar a mano** las interfaces de entrada ni los archivos finales al BCRA, sin contar previsiones.

### N9 – Productos no COBIS: tomar la última versión al último día del mes
**Problema:** hoy, cualquier novedad de un producto no COBIS **da de baja la versión anterior y deja vigente la nueva**. Si la novedad llega después del cierre, el dato al cierre se pisa y la interfaz informa un dato que no corresponde al período.
- **CA9.1 – Historial de versiones:** una novedad no borra ni pisa el registro anterior. La versión anterior queda guardada como histórica, con fecha de novedad, fecha y hora de carga y estado (vigente/histórica).
- **CA9.2 – Regla de corte:** al generar Udincli y Udcrpro de un período, para cada cliente u operación no COBIS se toma la **última versión con fecha de novedad menor o igual al último día del mes**. Si hay varias versiones ese mismo día, se toma la última por fecha y hora de carga o por secuencia.
- **CA9.3 – Datos pisados:** el dato al cierre se informa aunque una novedad posterior al cierre lo haya pisado o dado de baja en la base.
- **CA9.4 – Bajas:** una operación dada de baja **después** del cierre pero vigente el último día del mes **se informa**. Una dada de baja **antes o el mismo día** del cierre **no se informa**.
- **CA9.5 – Altas posteriores:** las operaciones o clientes dados de alta después del último día del mes no se incluyen en el período.
- **CA9.6 – Reproceso:** regenerar las interfaces de un mes ya cerrado, en cualquier fecha posterior, da exactamente el mismo resultado.
- **CA9.7 – Trazabilidad:** el log de generación indica, por operación, qué versión se tomó (identificador y fechas). Además se emite un reporte de las operaciones con novedades posteriores al cierre.
- **CA9.8 – Conciliación:** los totales de productos no COBIS, armados con esta regla, concilian con la contabilidad del mes (N7).

**Ejemplo (Gherkin):**
```gherkin
Escenario: novedad posterior al cierre no pisa el dato del período
  Dado un préstamo no COBIS con saldo $100.000 y situación 1 cargado el 20/08/2026
  Y una novedad del mismo préstamo con saldo $80.000 y situación 2 cargada el 05/09/2026
  Cuando se genera el Udcrpro del período 31/08/2026
  Entonces el préstamo se informa con saldo $100.000 y situación 1
  Y el log indica la versión del 20/08/2026 como versión tomada

Escenario: varias novedades dentro del mes
  Dado un préstamo no COBIS con versiones cargadas el 10/08/2026 y el 31/08/2026 a las 18:00
  Cuando se genera el Udcrpro del período 31/08/2026
  Entonces se toma la versión del 31/08/2026 18:00

Escenario: baja posterior al cierre
  Dado un préstamo no COBIS vigente al 31/08/2026 y dado de baja el 03/09/2026
  Cuando se genera el Udcrpro del período 31/08/2026
  Entonces el préstamo se informa con su último dato al 31/08/2026
```

**A confirmar con Contaduría y Sistemas:**
- Qué fecha se usa para el corte: la fecha de novedad/vigencia que informa el producto o la fecha de carga en la base. Se propone la fecha de novedad y, si no viene, la de carga.
- Hasta cuándo se aceptan novedades con fecha dentro del mes que llegan después del cierre (por ejemplo, una novedad con fecha 31/08 que llega el 02/09). Se propone aceptarlas hasta la generación del archivo, dentro del 5.º día hábil.

## Tareas sugeridas

1. Clasificar los ~710 ajustes del *Udcrpro previo 31082026.xlsx* por causa raíz.
2. Relevar y corregir en el MIS los tipos de documento inválidos (98 u otros fuera de tabla) y agregar la validación en el alta y la modificación de clientes.
3. Revisar con Riesgos y SAC el circuito de situación, tipo de cartera y depuración, y definir el punto de control.
4. COBIS: corregir la extracción de descubiertos y de intereses congelados en UDCRPRO.
5. COBIS y Activas: hacer que los inventarios cierren con la contabilidad y dar de baja el Excel manual.
6. Desarrollar el validador automático pre-UNIDATO con reporte de conciliación.
7. Definir el cronograma de cierre (hito: 5.º día hábil).
8. Productos no COBIS: pasar de "pisar" el dato a guardar historial de versiones, e implementar en la generación de interfaces la regla de corte al último día del mes, con log de versión tomada.
9. QA: correr en paralelo con el cierre siguiente y conseguir la conformidad de Contaduría y Auditoría Interna. Incluir casos de novedades posteriores al cierre y el reproceso de un mes cerrado.

## Definición de Hecho

- Las necesidades N1 a N9 están verificadas con un cierre real.
- La conciliación por partida da diferencia 0 (o la tolerancia aprobada).
- El validador está en producción y documentado.
- Contaduría y Auditoría Interna dan su conformidad con un ESD presentado sin ajustes manuales.

## Interesados

Contaduría (Alejandro Orona, Daniel Real) · Sistemas – COBIS · SAC · Riesgos Económicos · Activas · Auditoría Interna · Riesgo Operacional.
