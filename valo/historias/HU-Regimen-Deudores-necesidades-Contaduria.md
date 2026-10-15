# HU – Régimen de Deudores (ESD): interfaces y datos correctos de origen, sin ajustes manuales

**Origen:** mail de Alejandro E. Orona (Jefe de Control Operativo Contable – Contaduría), "Régimen de Deudores – Agosto 2026", con adjunto *Udcrpro previo 31082026.xlsx*.
**Fuera de alcance:** **previsiones** (cálculo e incorporación al UDCRPRO / archivo 4305), que se resuelven en otro desarrollo.

---

## Historia de usuario

**Como** Jefe de Control Operativo Contable (Contaduría),
**quiero** que todas las fuentes del Régimen de Deudores generen datos correctos y conciliados con la contabilidad, y que lleguen en término. Las fuentes son COBIS (Udincli, Udcrpro, inventarios), la base de clientes, los datos de Riesgos, ePortfolio/MELI y Etrust/Cubo.
**para** procesar el ESD en UNIDATO de forma automática, sin corregir a mano interfaces ni archivos finales, en término y cumpliendo la normativa del BCRA y lo que exigen Auditoría Interna y Externa.

## Contexto

- Armar el régimen de agosto 2026 llevó **una semana de trabajo manual**, con riesgo de errores y de no llegar al vencimiento.
- Ya se informan unos **165.000 clientes** al BCRA, y Etrust/Cubo aportó cerca de **170.000 registros**.
- Muchos de estos problemas **ya se habían reportado antes** y siguen sin solución.
- Los ajustes manuales en las interfaces de entrada y en los archivos finales **no los aceptan Auditoría Interna/Externa ni la normativa del BCRA**.

## Necesidades y criterios de aceptación

### N1 – Base de clientes: CUIT erróneos (SAC / COBIS)
**Problema:** en Udincli hay clientes con CUIT que empieza en **98**, y UNIDATO los rechaza. Ejemplo: `A9830708240873 VR GLOBAL PARTNERS L.P.`, cuyo CUIT real es 30708240873.
- **CA1.1** – Se corrigen en la base de clientes / MIS los CUIT de los casos detectados.
- **CA1.2** – Se hace un relevamiento en el MIS de **todos** los clientes con CUIT inválido (prefijo 98, dígito verificador incorrecto) y se regularizan.
- **CA1.3** – La base de clientes no permite dar de alta ni modificar un cliente con CUIT/CUIL inválido.
- **CA1.4** – Udincli sale sin CUIT inválidos y Contaduría no corrige la interfaz a mano.

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

### N6 – Cartera MELI / ePortfolio (Activas)
**Problema:** los préstamos de MELI trajeron unos **24.000 errores**: símbolos en los nombres y **situación 10** (inexistente). Esto rompió Udincli y Udcrpro.
- **CA6.1** – Los nombres y razones sociales se normalizan al set de caracteres que admiten UNIDATO y el BCRA.
- **CA6.2** – La situación siempre es un valor válido de la tabla BCRA. La situación 10 se rechaza o se mapea según la regla que acuerden Riesgos y Activas.
- **CA6.3** – Los clientes de MELI en Udcrpro existen en Udincli con la misma identificación.

### N7 – Plazos de entrega
**Problema:** el archivo balanceado por Activas llegó recién el **11/09**.
- **CA7.1** – Las interfaces Udincli y Udcrpro, validadas y conciliadas, llegan a Contaduría **dentro de los primeros 5 días hábiles** del cierre.
- **CA7.2** – Hay un cronograma de cierre con hitos y responsables por área.

### N8 – Todos los sistemas conciliados con contabilidad
- **CA8.1** – Los inventarios y saldos de **todos** los sistemas del proceso cierran con la contabilidad. Esto incluye COBIS, ePortfolio/MELI, Etrust/Cubo y cualquier otro sistema que participe.
- **CA8.2** – Antes de entregar, corre un validador automático sobre cada interfaz que controla:
  - formato y caracteres;
  - CUIT válido;
  - situación válida;
  - cruce Udincli ↔ Udcrpro;
  - totales vs. contabilidad.
- **CA8.3** – Si hay errores bloqueantes, el archivo vuelve al área de origen con el log de errores.

### N9 – Cero ajustes manuales
- **CA9.1** – En el cierre siguiente a la puesta en producción, Contaduría procesa el ESD en UNIDATO **sin modificar a mano** las interfaces de entrada ni los archivos finales al BCRA, sin contar previsiones.

## Tareas sugeridas

1. Clasificar los ~710 ajustes del *Udcrpro previo 31082026.xlsx* por causa raíz.
2. Relevar y corregir los CUIT inválidos en el MIS y agregar la validación en el alta y la modificación de clientes.
3. Revisar con Riesgos y SAC el circuito de situación, tipo de cartera y depuración, y definir el punto de control.
4. COBIS: corregir la extracción de descubiertos y de intereses congelados en UDCRPRO.
5. COBIS y Activas: hacer que los inventarios cierren con la contabilidad y dar de baja el Excel manual.
6. ePortfolio/MELI: limpiar caracteres y validar la situación en origen.
7. Desarrollar el validador automático pre-UNIDATO con reporte de conciliación.
8. Definir el cronograma de cierre (hito: 5.º día hábil).
9. QA: correr en paralelo con el cierre siguiente y conseguir la conformidad de Contaduría y Auditoría Interna.

## Definición de Hecho

- Las necesidades N1 a N9 están verificadas con un cierre real.
- La conciliación por partida da diferencia 0 (o la tolerancia aprobada).
- El validador está en producción y documentado.
- Contaduría y Auditoría Interna dan su conformidad con un ESD presentado sin ajustes manuales.

## Interesados

Contaduría (Alejandro Orona, Daniel Real) · Sistemas – COBIS · SAC · Riesgos Económicos · Activas · ePortfolio (Diego Apezteguia) · Auditoría Interna · Riesgo Operacional.
