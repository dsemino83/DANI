// Monitoreo sintético de DISPONIBILIDAD del Banco de Valores. Estrictamente de solo lectura:
//  - solo llama a las rutas de la lista blanca RUTAS_LECTURA (hoy una sola, la misma que usa el login para
//    cargar la entidad); nunca saldos, movimientos ni transferencias, y jamás en modo envío;
//  - la respuesta se descarta: no se loguea ni se guarda nada del banco;
//  - el log lleva solo resultado, duración y un error genérico (sin datos sensibles).
// Se agenda en jobs/programador.js solo si SYNTHETIC_MONITOR_ENABLED=true (apagado por defecto).
import { config } from '../config.js';
import { bdv } from '../bdv/cliente.js';

export const RUTAS_LECTURA = Object.freeze(['enrollment/getUserEntityInformation']);

// Garantía de solo lectura: cualquier otra ruta se rechaza antes de salir al banco.
export function exigirLectura(ruta) {
  if (!RUTAS_LECTURA.includes(ruta)) throw new Error('El monitoreo sintético solo puede usar rutas de lectura autorizadas');
  return ruta;
}

// Mensaje corto y sin datos: sin números largos (cuentas/CBU/CUIT), sin URLs.
export const errorSeguro = (e) => String(e?.message ?? 'error de disponibilidad').replace(/https?:\/\/\S+/g, '[url]').replace(/\d{6,}/g, '[n]').slice(0, 120);

export async function monitoreoSintetico() {
  const inicio = performance.now();
  const resultado = { ok: false, dependencia: 'bdv', ms: 0, error: null };
  let timer;
  try {
    const ruta = exigirLectura('enrollment/getUserEntityInformation');
    // Timeout propio (más corto que el del cliente): el monitor no debe colgarse esperando al banco.
    await Promise.race([
      bdv.llamar(ruta, {}, { reintentar: true, envio: false }),
      new Promise((_, rechazar) => { timer = setTimeout(() => rechazar(new Error('timeout del monitoreo')), config.sintetico.timeoutMs); }),
    ]);
    resultado.ok = true;
  } catch (error) {
    resultado.error = errorSeguro(error);
  } finally {
    clearTimeout(timer);
    resultado.ms = Math.round(performance.now() - inicio);
  }
  return resultado;
}

export default monitoreoSintetico;
