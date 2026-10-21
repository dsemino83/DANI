# Prueba de la API Banking con Power Automate (solo lectura)

Flujo para ver cómo responde la API del Banco de Valores (homologación o producción) antes de desplegar el Home Banking en la infraestructura de VALO. Hace solo consultas, en este orden:

1. `security/login` (con la clave ya cifrada con la llave RSA del banco)
2. `enrollment/getUserEntityInformation`
3. `accounts/getOwnAccounts` → tabla de cuentas con saldo (número enmascarado)
4. Opcional: `accounts/getMovementsDetail` del día para una cuenta (primera página de 900)

**No llama a ninguna API de transferencia** y la credencial no queda guardada en el flujo: se ingresa en cada ejecución.

## Requisitos

- Licencia **Power Automate Premium**: la acción HTTP es un conector premium.
- Que la política de datos (DLP) del entorno permita el conector HTTP.
- Que el banco acepte llamadas desde las IP de salida de Power Automate de tu región. Si el banco trabaja con una lista de IP permitidas, el login va a fallar por conexión o con HTTP 403.

## Importar

1. Power Automate → **Mis flujos** → **Importar** → **Importar paquete (heredado)**.
2. Subí `Prueba-API-BancoValores.zip`.
3. En **Configurar importación** dejá **Crear como nuevo** → **Importar**.
4. Abrí el flujo y guardalo una vez (Power Automate valida las expresiones al guardar).

No usa conexiones: el disparador es manual y las demás acciones son HTTP y operaciones de datos.

Si el importador heredado no está disponible en tu entorno, creá el flujo a mano copiando las acciones de `definicion-flujo.json` (es la definición completa: disparador manual con 6 entradas, 3 a 4 acciones HTTP, Seleccionar y Crear tabla HTML).

## Ejecutar

**Ejecutar** y completar:

| Entrada | Valor |
|---|---|
| Ambiente | `prod` o `homo` (define la URL: `api.bancodevalores.com` o `apihomo.bancodevalores.com`) |
| Usuario API (login) | el `login` de la credencial |
| Clave cifrada | el `password` en base64 que entrega el banco |
| Terminal | por ejemplo `SERVERNAME` |
| DNI (identification) | el DNI del usuario API |
| Cuenta para movimientos | opcional: número completo de una cuenta propia |

El resultado se ve en el historial de la ejecución:
- **Tabla_de_cuentas**: cuentas, moneda y saldos.
- **Tabla_de_movimientos**: movimientos del día, si se indicó cuenta.
- **Resumen**: ambiente, entidad y cantidad de cuentas.

Si el banco rechaza el login, la ejecución termina en error con el código y el mensaje del banco.

## Seguridad

- El disparador, el login y la cookie de sesión tienen **entradas y salidas seguras**: la clave y la cookie no se ven en el historial.
- Los saldos y movimientos sí quedan visibles en el historial de ejecuciones (Power Automate los conserva unos 28 días). Ejecutalo en un entorno al que solo acceda quien tenga que ver esos datos y, al terminar la prueba, borrá el flujo o su historial.
- El `password` cifrado funciona como la clave: quien lo tenga puede iniciar sesión. No lo guardes en el flujo, en variables de entorno compartidas ni en documentos, y pedí al banco que lo cambie después de la prueba si circuló por canales no seguros.
