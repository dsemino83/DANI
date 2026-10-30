// Límite de pedidos por usuario (ventana de 1 minuto, en memoria de esta instancia). Es la segunda barrera: Nginx
// ya limita por IP. Protege contra abuso o un cliente descontrolado (y, en particular, las operaciones sensibles).
const ventanas = new Map(); // `${regla}|${usuario}` → { desde, n }
export const REGLAS = [
  { nombre: 'credenciales', max: 10, coincide: (m, u) => m === 'POST' && /\/admin\/credenciales\/[^/]+\/probar/.test(u) },
  { nombre: 'operaciones', max: 60, coincide: (m, u) => m === 'POST' && /^\/api\/(transferencias|lotes)(\/|$|\?)/.test(u) },
  { nombre: 'consultas-sensibles', max: 60, coincide: (m, u) => /^\/api\/(cbu|cuentas\/[^/]+\/constancia)/.test(u) },
  { nombre: 'general', max: 600, coincide: () => true },
];

export function consumir(clave, max, ahora = Date.now(), ventanaMs = 60_000) {
  let v = ventanas.get(clave);
  if (!v || ahora - v.desde >= ventanaMs) { v = { desde: ahora, n: 0 }; ventanas.set(clave, v); }
  v.n++;
  if (ventanas.size > 50_000) for (const [k, x] of ventanas) if (ahora - x.desde >= ventanaMs) ventanas.delete(k); // limpieza
  return { ok: v.n <= max, restante: Math.max(0, max - v.n), reintentarEnSeg: Math.ceil((v.desde + ventanaMs - ahora) / 1000) };
}

// Hook de Fastify, después de autenticar: aplica la primera regla específica que coincide y siempre la general
export async function limitarPedidos(req, reply) {
  const usuario = req.user?.usuario ?? `ip:${req.ip}`;
  for (const r of [REGLAS.find((x) => x.nombre !== 'general' && x.coincide(req.method, req.url)), REGLAS.at(-1)].filter(Boolean)) {
    const c = consumir(`${r.nombre}|${usuario}`, r.max);
    if (!c.ok) {
      req.log.warn({ usuario, regla: r.nombre }, 'Límite de pedidos superado');
      reply.header('retry-after', String(c.reintentarEnSeg));
      return reply.code(429).send({ error: 'demasiados_pedidos', mensaje: `Demasiados pedidos seguidos (${r.nombre}). Probá de nuevo en ${c.reintentarEnSeg} s.` });
    }
  }
}

// Logs: enmascara números largos (CBU, CUIT, cuentas) y alias en las URLs
export const mascarar = (texto) => String(texto ?? '').replace(/(\d{4})\d{5,}(\d{2})/g, '$1…$2').replace(/((?:^|[?&])alias=)[^&]+/gi, '$1***');
