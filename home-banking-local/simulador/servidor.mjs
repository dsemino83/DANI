// Simulador del Banco de Valores (API Banking) para usar el Home Banking SIN INTERNET: pruebas, capacitación y demos.
// Responde las mismas operaciones que usa la aplicación con cuentas y movimientos ficticios. Las transferencias
// "se debitan" en memoria (se pierden al reiniciar). NUNCA usar con datos reales: no hay ningún banco detrás.
//
//  GET  /llave-publica   llave pública RSA para cargar en "Credenciales API" (la clave viaja cifrada, como con el banco)
//  GET  /salud           control de vida
//  POST /bdv/...         operaciones de la API Banking (security/login, accounts/*, cbuInformation/*, transfers/*, echeq/*)
import http from 'node:http';
import { createHash, generateKeyPairSync, privateDecrypt, constants, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PUERTO = Number(process.env.PUERTO ?? 8080);
const CLAVE = process.env.SIM_CLAVE ?? 'clave-simulador';        // clave de la credencial API (en texto plano en Credenciales API)
const DATOS = process.env.SIM_DATOS ?? '/datos';                 // la llave RSA se conserva entre reinicios

// ---- Llave RSA del "banco": se crea una vez y queda en el volumen (si cambiara, habría que recargar la credencial)
mkdirSync(DATOS, { recursive: true });
const archivoLlave = `${DATOS}/llave-privada.pem`;
if (!existsSync(archivoLlave)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(archivoLlave, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const privada = createPrivateKey(readFileSync(archivoLlave));
const llavePublica = createPublicKey(privada).export({ type: 'spki', format: 'der' }).toString('base64');

// ---- Datos ficticios
function cbuDe(nro) { return `0650001${nro.padStart(15, '0')}`; }
const cuentas = [
  { productId: 3, currencyId: 80, productNumber: '300100000000001', productName: 'CUENTA CORRIENTE', productAlias: 'VALO.OPERATIVA.PESOS', availableBalance: 18_450_320.55, accountingBalance: 18_512_000 },
  { productId: 4, currencyId: 2, productNumber: '400200000000002', productName: 'CAJA DE AHORROS', productAlias: 'VALO.TESORERIA.USD', availableBalance: 125_430, accountingBalance: 125_430 },
  { productId: 3, currencyId: 80, productNumber: '300100000000003', productName: 'CUENTA CORRIENTE', productAlias: 'FIDEICOMISO.AGUILA', availableBalance: 3_250_000, accountingBalance: 3_250_000 },
  { productId: 3, currencyId: 80, productNumber: '300100000000004', productName: 'CUENTA CORRIENTE', productAlias: 'FONDO.COMUN.RENTA', availableBalance: 52_870_115.1, accountingBalance: 52_900_000 },
].map((c) => ({ ...c, aliasName: c.productAlias, accountCbu: cbuDe(c.productNumber) }));

// Movimientos estables por cuenta y día hábil (los mismos en cada consulta) + los generados por transferencias.
const extra = new Map(cuentas.map((c) => [c.productNumber, []]));
let secuencia = 9_000_000;
const DESCRIPCIONES = [['C', 'TRANSFERENCIA RECIBIDA'], ['D', 'PAGO A PROVEEDORES'], ['C', 'COBRANZA CLIENTES'], ['D', 'IMPUESTO LEY 25413'], ['C', 'ACREDITACION FCI'], ['D', 'COMISION MANTENIMIENTO']];
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const desdeMDY = (s) => { const [m, d, a] = String(s ?? '').split('/').map(Number); return a ? new Date(Date.UTC(a, m - 1, d)) : null; };
const azar = (texto) => createHash('sha256').update(texto).digest().readUInt32BE(0);

function movimientosDelDia(c, dia) {
  const sem = dia.getUTCDay();
  if (sem === 0 || sem === 6) return [];
  const clave = `${c.productNumber}|${dia.toISOString().slice(0, 10)}`;
  return Array.from({ length: 1 + (azar(clave) % 4) }, (_, i) => {
    const r = azar(`${clave}|${i}`);
    const [signo, descripcion] = DESCRIPCIONES[r % DESCRIPCIONES.length];
    const id = Number(BigInt(`0x${createHash('sha256').update(`${clave}|${i}`).digest('hex').slice(0, 10)}`) % 900_000_000n);
    return {
      sequential: id, uniqueSequential: id, transactionId: id, amount: Math.round((r % 2_500_000) + 1_000) / (c.currencyId === 2 ? 100 : 1),
      availableBalance: c.availableBalance, signDC: signo, description: descripcion, hour: `${String(9 + (r % 8)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}:00`,
      processDate: dmy(dia), documentNumber: String(r % 100000), beneficiary: '',
    };
  });
}

function movimientos(c, desde, hasta) {
  const lista = [];
  const fin = hasta ?? new Date(), ini = desde ?? new Date(fin.getTime() - 30 * 864e5);
  for (let d = new Date(fin); d >= ini && lista.length < 5000; d = new Date(d.getTime() - 864e5)) lista.push(...movimientosDelDia(c, d));
  const propios = extra.get(c.productNumber).filter((m) => { const f = desdeMDY(m._mdy); return f >= ini && f <= fin; });
  return [...propios.toReversed(), ...lista].map(({ _mdy, ...m }) => m);
}

const transferencias = [];
function transferir(cuerpo, ruta) {
  const origen = cuerpo.origin?.productNumber ?? cuerpo.originAccountNumber ?? cuerpo.productNumber ?? cuerpo.debitAccount;
  const c = cuentas.find((x) => x.productNumber === String(origen));
  const monto = Number(cuerpo.amount ?? cuerpo.importe ?? 0);
  if (!c) return { success: false, message: { code: '404', message: 'Cuenta origen inexistente en el simulador' } };
  if (!(monto > 0)) return { success: false, message: { code: '400', message: 'Importe inválido' } };
  if (monto > c.availableBalance) return { success: false, message: { code: '51', message: 'Saldo insuficiente' } };
  c.availableBalance = Math.round((c.availableBalance - monto) * 100) / 100;
  c.accountingBalance = Math.round((c.accountingBalance - monto) * 100) / 100;
  const id = ++secuencia, hoy = new Date();
  extra.get(c.productNumber).push({ sequential: id, uniqueSequential: id, transactionId: id, amount: monto, availableBalance: c.availableBalance, signDC: 'D',
    description: `TRANSFERENCIA ${ruta.split('/').pop().toUpperCase()}`, hour: hoy.toTimeString().slice(0, 8), processDate: dmy(hoy), documentNumber: String(id), beneficiary: '',
    _mdy: `${String(hoy.getUTCMonth() + 1).padStart(2, '0')}/${String(hoy.getUTCDate()).padStart(2, '0')}/${hoy.getUTCFullYear()}` });
  transferencias.push({ code: id, idTrn: id, status: 'F', finalized: 'S', executionMessage: 'Simulador: ejecutada', amount: monto, date: dmy(hoy) });
  return { success: true, transactionId: id, ...(ruta.endsWith('immediates') ? { nroControl: id % 100000 } : {}) };
}

// La aplicación cifra la clave con RSA PKCS#1 v1.5 (como pide el banco). Node 22 ya no descifra ese relleno
// directamente: se descifra sin relleno y se quita a mano (00 02 <relleno no nulo> 00 <clave>).
function descifrarPkcs1(cifrado) {
  const b = privateDecrypt({ key: privada, padding: constants.RSA_NO_PADDING }, cifrado);
  const fin = b.indexOf(0, 2);
  if (b[0] !== 0 || b[1] !== 2 || fin < 10) throw new Error('relleno inválido');
  return b.subarray(fin + 1).toString('utf8');
}

// ---- Sesiones
const sesiones = new Set();
const cbus = new Map();

const OPERACIONES = {
  'security/login': (j, res) => {
    let clave = '';
    try { clave = descifrarPkcs1(Buffer.from(String(j.password ?? ''), 'base64')); } catch { /* no estaba cifrada con nuestra llave */ }
    if (clave !== CLAVE) return { success: false, message: { code: '1', message: 'Credenciales inválidas (simulador)' } };
    const sid = randomBytes(16).toString('hex');
    sesiones.add(sid);
    res.setHeader('set-cookie', `JSESSIONID=${sid}; Path=/; HttpOnly`);
    return { success: true, sessionId: sid };
  },
  'enrollment/getUserEntityInformation': () => ({ success: true, completeName: 'VALO SA (SIMULADOR)' }),
  'accounts/getOwnAccounts': () => ({ success: true, accountsArray: cuentas }),
  'accounts/getBalancesDetail': (j) => {
    const c = cuentas.find((x) => x.productNumber === String(j.productNumber));
    return c ? { success: true, ...c, agreedOverdraft: 0, blockedAmount: 0, cbu: cbuDe(c.productNumber) } : { success: false, message: { code: '404', message: 'Cuenta inexistente' } };
  },
  'accounts/getMovementsDetail': (j) => {
    const c = cuentas.find((x) => x.productNumber === String(j.productNumber));
    if (!c) return { success: false, message: { code: '404', message: 'Cuenta inexistente' } };
    const todos = movimientos(c, desdeMDY(j.initialDate), desdeMDY(j.finalDate));
    const n = Number(j.numberOfMovements ?? 900);
    const desde = j.mode === '1' ? todos.findIndex((m) => String(m.sequential) === String(j.sequential)) + 1 : 0;
    return { success: true, accountStatementArray: todos.slice(desde, desde + n) };
  },
  'cbuInformation/getCustomerInformationCbu': (j) => {
    const propia = cuentas.find((c) => c.productAlias === j.alias || cbuDe(c.productNumber) === j.cbu);
    if (propia) return { success: true, cbu: cbuDe(propia.productNumber), alias: propia.productAlias, headline: 'VALO SA', cuit: '30500000018', currency: String(propia.currencyId), activeAccount: 'T', accountCbu: cbuDe(propia.productNumber) };
    const k = j.cbu || j.alias || '';
    if (!cbus.has(k)) cbus.set(k, /^\d{22}$/.test(j.cbu ?? '') ? j.cbu : `01100000000000${String(10000001 + cbus.size).padStart(8, '0')}`);
    return { success: true, cbu: cbus.get(k), alias: j.alias || 'ALIAS.SIMULADO', headline: 'SERVICIOS DEL ESTE SA', cuit: '30712340001', currency: '80', activeAccount: 'T' };
  },
  'transfers/immediates': (j, _, r) => transferir(j, r),
  'transfers/transferBetweenOwnAccount': (j, _, r) => transferir(j, r),
  'transfers/transferThirdPartyAccount': (j, _, r) => transferir(j, r),
  'transfers/transferMep': (j, _, r) => transferir(j, r),
  'echeq/getTransfersStatus': () => ({ success: true, transferStatusResponseArray: transferencias }),
};

http.createServer(async (req, res) => {
  const enviar = (codigo, cuerpo, tipo = 'application/json') => { res.writeHead(codigo, { 'content-type': tipo }); res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)); };
  if (req.method === 'GET' && req.url === '/salud') return enviar(200, { ok: true });
  if (req.method === 'GET' && req.url === '/llave-publica') return enviar(200, `${llavePublica}\n`, 'text/plain');
  let cuerpo = '';
  for await (const c of req) cuerpo += c;
  let json = {};
  try { json = cuerpo ? JSON.parse(cuerpo) : {}; } catch { return enviar(400, { success: false }); }
  const ruta = (req.url ?? '').split('?')[0].replace(/^\/bdv\//, '');
  const op = OPERACIONES[ruta];
  if (!op || req.method !== 'POST') return enviar(404, { success: false, message: { code: '404', message: `Operación no simulada: ${ruta}` } });
  if (ruta !== 'security/login') {
    const sid = (req.headers.cookie ?? '').match(/JSESSIONID=([0-9a-f]+)/)?.[1];
    if (!sid || !sesiones.has(sid)) return enviar(401, { success: false, message: { code: '401', message: 'Sesión inválida' } });
  }
  console.log(new Date().toISOString(), ruta);
  enviar(200, op(json, res, ruta));
}).listen(PUERTO, () => console.log(`Simulador del Banco de Valores escuchando en ${PUERTO} · clave de la credencial API: ${CLAVE === 'clave-simulador' ? CLAVE : '(personalizada)'}`));
