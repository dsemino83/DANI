// Límite de pedidos por usuario (anti-abuso / fuerza bruta, OWASP API4). Contra el servidor real:
// al pasarse, responde 429 con Retry-After; el límite es por usuario (uno saturado no frena a otro).
// Sale != 0 si algo falla.
import { readFileSync } from 'node:fs';
const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = `http://127.0.0.1:${process.env.PORT ?? 18090}/api`;
const raw = async (t, m, r, b) => fetch(API + r, { method: m, headers: { authorization: `Bearer ${T[t]}`, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
const j = async (t, m, r, b) => { const x = await raw(t, m, r, b); return { s: x.status, b: await x.json().catch(() => null) }; };
let fallas = 0;
const ok = (c, m, x = '') => { if (!c) fallas++; console.log(c ? 'OK  ' : 'FAIL', m, c ? '' : JSON.stringify(x).slice(0, 220)); };

// ---- Preparación mínima (el límite se aplica aunque haya o no permisos).
await j('admin', 'PUT', '/admin/credenciales/homo', { usuario: 'valo_api', identification: '20000000001', terminal: 'SRV', clave: 'clave-api-valo', rsaPublicKey: T.llaveBanco });

// ---- Regla "credenciales": 10 por minuto sobre probar conexión. El pedido 11 es 429 con Retry-After.
let r200 = 0, r429 = 0, retryAfter = null;
for (let i = 0; i < 11; i++) {
  const x = await raw('admin', 'POST', '/admin/credenciales/homo/probar');
  if (x.status === 200) r200++;
  else if (x.status === 429) { r429++; retryAfter = retryAfter ?? x.headers.get('retry-after'); }
}
ok(r200 === 10 && r429 === 1, `probar credencial: 10 pasan y el 11 es 429 (fueron ${r200}×200, ${r429}×429)`);
ok(retryAfter && Number(retryAfter) > 0, 'el 429 trae Retry-After con segundos', retryAfter);

// ---- Regla "consultas-sensibles": 60 por minuto sobre /cbu. El 61 es 429 y el cuerpo lo explica.
let ult;
for (let i = 0; i < 61; i++) ult = await j('mgomez', 'POST', '/cbu', { alias: 'PAGOS.PROVEEDOR' });
ok(ult.s === 429 && ult.b?.error === 'demasiados_pedidos', 'consulta de CBU: el pedido 61 es 429 demasiados_pedidos', ult);

// ---- Es por usuario: mgomez saturado no bloquea a otro usuario.
const otro = await j('operadorB', 'POST', '/cbu', { alias: 'PAGOS.PROVEEDOR' });
ok(otro.s === 200, 'el límite es por usuario: otro usuario sigue respondiendo 200', otro);

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
