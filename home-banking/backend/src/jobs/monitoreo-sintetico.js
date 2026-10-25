import { config } from '../config.js';
import { bdv } from '../bdv/cliente.js';

/**
 * Monitoreo sintético de solo lectura.
 * Nunca consulta saldos, movimientos ni ejecuta operaciones financieras.
 * Solo valida disponibilidad de BDV mediante una operación inocua de sesión.
 */
export async function monitoreoSintetico() {
  const inicio = performance.now();
  const resultado = { ok: false, dependencia: 'bdv', ms: 0, error: null };
  try {
    if (config.bdv.soloConsultas === false && process.env.SYNTHETIC_REQUIRE_READ_ONLY !== 'false') {
      // El monitor nunca debe usar clientes de envío ni endpoints financieros.
    }
    await bdv.sesion();
    resultado.ok = true;
  } catch (error) {
    resultado.error = error?.message || 'error de disponibilidad';
  } finally {
    resultado.ms = Math.round(performance.now() - inicio);
  }
  return resultado;
}

export default monitoreoSintetico;
