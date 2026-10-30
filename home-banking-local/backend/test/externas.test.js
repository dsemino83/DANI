// Llamadas externas: telemetría sin datos sensibles, clasificación de fallos, single-flight/paralelismo del banco y
// feriados con fallback. Sin base ni banco reales. node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { clasificarError, medirLlamada, contextoPedido } = await import('../src/telemetria.js');
const { cuentasPropias, cuentaDelBanco, enParalelo } = await import('../src/bdv/cliente.js');
const { operativa } = await import('../src/db.js');
const { sincronizarFeriados } = await import('../src/servicios/feriados.js');

// Captura las líneas JSON que escribe la telemetría
async function capturando(fn) {
  const lineas = [], original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c, ...r) => { try { lineas.push(JSON.parse(String(c))); return true; } catch { return original(c, ...r); } };
  try { await fn(); } finally { process.stdout.write = original; }
  return lineas;
}

test('clasificarError distingue timeout, dns, red y tls', () => {
  assert.equal(clasificarError(Object.assign(new Error('x'), { name: 'TimeoutError' })).tipo, 'timeout');
  assert.deepEqual(clasificarError(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })), { tipo: 'dns', codigo: 'ENOTFOUND' });
  assert.equal(clasificarError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })).tipo, 'red');
  assert.equal(clasificarError(Object.assign(new Error('fetch failed'), { cause: { errors: [{ code: 'ETIMEDOUT' }] } })).tipo, 'red');
  assert.equal(clasificarError(Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })).tipo, 'timeout');
  assert.equal(clasificarError(Object.assign(new Error('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } })).tipo, 'tls');
});

test('medirLlamada registra operación, duración, status, intento y reqId, sin datos sensibles', async () => {
  const lineas = await capturando(() => contextoPedido.run({ reqId: 'req-123' }, () =>
    medirLlamada({ op: 'accounts/getOwnAccounts', destino: 'bdv', intento: 2, timeoutMs: 30000, circuito: 'cerrado' }, async () => ({ status: 200 }), { estado: (r) => r.status })));
  assert.equal(lineas.length, 1);
  const l = lineas[0];
  assert.equal(l.msg, 'llamada_externa'); assert.equal(l.op, 'accounts/getOwnAccounts'); assert.equal(l.destino, 'bdv');
  assert.equal(l.status, 200); assert.equal(l.resultado, 'ok'); assert.equal(l.intento, 2); assert.equal(l.timeout_ms, 30000);
  assert.equal(l.circuito, 'cerrado'); assert.equal(l.reqId, 'req-123'); assert.equal(typeof l.duracion_ms, 'number');
});

test('medirLlamada ante error: tipo y código, nunca el mensaje (puede traer datos)', async () => {
  const e = Object.assign(new Error('fetch failed https://banco.test/x cuenta 1234567890123 token SECRETO'), { cause: { code: 'ENOTFOUND' } });
  const lineas = await capturando(async () => { await assert.rejects(medirLlamada({ op: 'x/y', destino: 'bdv' }, async () => { throw e; })); });
  const l = lineas[0];
  assert.equal(l.resultado, 'dns'); assert.equal(l.error_codigo, 'ENOTFOUND'); assert.equal(l.timeout, false);
  assert.ok(!JSON.stringify(l).includes('SECRETO') && !JSON.stringify(l).includes('1234567890123') && !JSON.stringify(l).includes('banco.test'));
});

test('cuentasPropias: pedidos concurrentes comparten UNA consulta al banco (sin caché de saldos)', async () => {
  let llamadas = 0;
  const cliente = { uso: 'test1', llamar: async () => { llamadas++; await new Promise((r) => setTimeout(r, 30)); return { success: true, accountsArray: [{ productNumber: '1', productId: 5, currencyId: 80, availableBalance: 100 }] }; } };
  const [a, b, c] = await Promise.all([cuentasPropias(cliente), cuentasPropias(cliente), cuentasPropias(cliente)]);
  assert.equal(llamadas, 1); assert.equal(a, b); assert.equal(b, c);
  await cuentasPropias(cliente); // un pedido posterior vuelve a consultar (los saldos no se cachean)
  assert.equal(llamadas, 2);
});

test('cuentaDelBanco: guarda solo identificadores (no saldos) y no repite getOwnAccounts', async () => {
  let llamadas = 0;
  const cliente = { uso: 'test2', llamar: async () => { llamadas++; return { success: true, accountsArray: [{ productNumber: '9', productId: 7, currencyId: 2, productAlias: 'a', availableBalance: 999 }] }; } };
  const c1 = await cuentaDelBanco('9', cliente), c2 = await cuentaDelBanco('9', cliente);
  assert.equal(llamadas, 1);
  assert.deepEqual(c1, { productId: 7, currencyId: 2, productNumber: '9', productAlias: 'a' });
  assert.equal(c1.availableBalance, undefined); assert.equal(c2, c1);
  assert.equal(await cuentaDelBanco('no-existe', cliente), undefined);
});

test('enParalelo: respeta el límite y conserva el orden', async () => {
  let activos = 0, maximo = 0;
  const r = await enParalelo([1, 2, 3, 4, 5, 6], 2, async (x) => { activos++; maximo = Math.max(maximo, activos); await new Promise((ok) => setTimeout(ok, 10 * (7 - x))); activos--; return x * 10; });
  assert.deepEqual(r, [10, 20, 30, 40, 50, 60]);
  assert.ok(maximo <= 2 && maximo >= 2);
});

// --- Feriados ---
const consultas = [];
function simular({ fetchImpl, count = 0, falloDb = false }) {
  globalThis.fetch = fetchImpl;
  consultas.length = 0;
  operativa.query = async (sql, params) => {
    consultas.push({ sql, params });
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ n: count }] };
    if (/INSERT INTO feriado/.test(sql) && falloDb) throw Object.assign(new Error('permission denied'), { code: '42501' });
    return { rows: [] };
  };
}
const redCaida = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
const anio = new Date().getFullYear();

test('feriados: todas las fuentes caídas pero hay datos cargados => sigue con la base, sin error', async () => {
  simular({ fetchImpl: redCaida, count: 12 });
  const r = await sincronizarFeriados(anio);
  assert.equal(r.fuente, 'base'); assert.equal(r.feriados, 12);
  assert.match(r.aviso, /argentinadatos: dns \(ENOTFOUND\)/); assert.match(r.aviso, /nolaborables: dns \(ENOTFOUND\)/);
});

test('feriados: sin fuentes y sin datos => respaldo de fecha fija (año en curso)', async () => {
  simular({ fetchImpl: redCaida, count: 0 });
  const r = await sincronizarFeriados(anio);
  assert.equal(r.fuente, 'respaldo'); assert.equal(r.feriados, 9);
  assert.ok(consultas.filter((c) => /INSERT INTO feriado/.test(c.sql)).every((c) => c.params[3] === 'respaldo'));
});

test('feriados: año futuro sin publicar y sin datos => error (no se inventa)', async () => {
  simular({ fetchImpl: redCaida, count: 0 });
  await assert.rejects(sincronizarFeriados(anio + 1), /No se pudieron traer los feriados/);
});

test('feriados: distingue proveedor (HTTP 503) de red y de timeout', async () => {
  const respuestas = [async () => ({ ok: false, status: 503 }), async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }];
  simular({ fetchImpl: () => respuestas.shift()(), count: 3 });
  const r = await sincronizarFeriados(anio);
  assert.match(r.aviso, /argentinadatos: proveedor: HTTP 503/); assert.match(r.aviso, /nolaborables: timeout/);
});

test('feriados: una fuente responde pero falla la base => error de base de datos, no de proveedor', async () => {
  simular({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{ fecha: `${anio}-01-01`, nombre: 'Año Nuevo', tipo: 'inamovible' }] }), falloDb: true });
  await assert.rejects(sincronizarFeriados(anio), /error de base de datos al guardar \(42501\)/);
});

test('credencial desactivada: el login no llama al banco y no cae a la principal', async () => {
  const { ClienteBdv, ErrorBanco } = await import('../src/bdv/cliente.js');
  const c = new ClienteBdv('envios');
  let llamadas = 0;
  c.fetch = async () => { llamadas++; throw new Error('no debería llamarse'); };
  await assert.rejects(() => c.login({ ambiente: 'homo', uso: 'envios', activa: false, url: 'https://apihomo.bancodevalores.com/x' }),
    (e) => e instanceof ErrorBanco && e.codigo === 'CREDENCIAL_DESACTIVADA');
  assert.equal(llamadas, 0);
});
