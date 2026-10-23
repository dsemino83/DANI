// Dispara una pasada del motor de pagos y sale. Lo usan las pruebas e2e para enviar lo que quedó EN_COLA
// de forma determinística (en producción corre en bucle dentro del proceso jobs). Usa el mismo entorno
// del backend (DB_*, BDV_*, CREDENCIALES_MASTER_KEY) que exporta el runner.
import { procesarPagos } from '../../src/servicios/motor-pagos.js';
import { operativa, historica } from '../../src/db.js';

await procesarPagos();
await operativa.end();
await historica.end();
process.exit(0);
