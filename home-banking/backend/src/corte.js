// Corte entre base operativa e histórica: la operativa conserva el mes en curso y los N meses anteriores
// completos (HB_RETENCION_MESES, 1 por defecto); lo anterior pasa a la histórica el día 1 de cada mes.
// Sin dependencias de config.js: lo usan el backend y el job del pase.
export function retencionMeses(valor = process.env.HB_RETENCION_MESES) {
  if (valor === undefined || valor === '') return 1;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error('HB_RETENCION_MESES debe ser un número entero de meses entre 1 y 120');
  return n;
}

// Primer día del mes más antiguo que se conserva en la operativa (mes actual - N)
export function mesCorte(hoy = new Date(), meses = retencionMeses()) {
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - meses, 1)).toISOString().slice(0, 10);
}
