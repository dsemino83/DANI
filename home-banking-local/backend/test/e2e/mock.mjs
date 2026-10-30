// Simulador del Banco de Valores para las pruebas de punta a punta. Escribe en el archivo que pase el runner la
// llave pública del banco; los tokens de cada perfil los agrega después usuarios.mjs (ingreso real con usuario y clave).
import http from 'node:http';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PUERTO = Number(process.env.MOCK_PORT ?? 18080);
const banco = generateKeyPairSync('rsa', { modulusLength: 2048 });
const llaveBanco = banco.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(process.argv[2], JSON.stringify({ llaveBanco }));

const llamadas = [];
const cbus = new Map();
const cuentas = [
  { availableBalance: 18450320.55, accountingBalance: 18512000, currencyId: 80, productId: 3, productNumber: '300100000000000', productName: 'CUENTA CORRIENTE', aliasName: 'VALORES.OPERATIVA', productAlias: 'VALORES.OPERATIVA' },
  { availableBalance: 125430, accountingBalance: 125430, currencyId: 2, productId: 4, productNumber: '400200000000000', productName: 'CAJA DE AHORROS', aliasName: 'TESORERIA.DOLARES', productAlias: 'TESORERIA.DOLARES' },
];
const mov = (i) => ({ sequential: 1000000 - i, uniqueSequential: 1000000 - i, transactionId: 5000000 - i, amount: 100 + i, availableBalance: 1000, signDC: i % 3 ? 'C' : 'D', description: `MOV ${i}`, hour: '10:00:00', processDate: '20/10/2026', documentNumber: '', beneficiary: '' });

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  let json = {}; try { json = body ? JSON.parse(body) : {}; } catch { /* form-urlencoded */ }
  const ruta = req.url;
  llamadas.push({ ruta, json, cookie: req.headers.cookie ?? null });
  const env = (o, extra = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(o)); };
  if (ruta === '/__llamadas') return env(llamadas);
  if (ruta === '/salud') return env({ ok: true });
  if (ruta === '/bdv/security/login') {
    // Node 22 no descifra PKCS#1 v1.5 directo: sin relleno y se quita a mano (00 02 <relleno> 00 <clave>)
    const b = privateDecrypt({ key: banco.privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(json.password, 'base64'));
    const clave = b.subarray(b.indexOf(0, 2) + 1).toString();
    if (clave !== 'clave-api-valo') return env({ success: false, message: { code: '1', message: 'Credenciales inválidas' } });
    return env({ success: true, sessionId: 'ID:1' }, { 'set-cookie': 'JSESSIONID=abc123; Path=/; HttpOnly' });
  }
  if (req.headers.cookie !== 'JSESSIONID=abc123') { res.writeHead(401); return res.end(); }
  if (ruta === '/bdv/enrollment/getUserEntityInformation') return env({ success: true, completeName: 'VALO SA' });
  if (ruta === '/bdv/accounts/getOwnAccounts') return env({ success: true, accountsArray: cuentas });
  if (ruta === '/bdv/accounts/getMovementsDetail') {
    const n = json.mode === '0' ? 900 : 5, off = json.mode === '0' ? 0 : 900;
    return env({ success: true, accountStatementArray: Array.from({ length: n }, (_, i) => mov(off + i)) });
  }
  if (ruta === '/bdv/cbuInformation/getCustomerInformationCbu') {
    // Un CBU distinto y estable por alias/cuenta (COELSA real nunca repite CBU entre cuentas).
    const k = json.cbu || json.alias || '';
    if (!cbus.has(k)) cbus.set(k, '01100000000000' + String(10000001 + cbus.size).padStart(8, '0'));
    return env({ success: true, cbu: cbus.get(k), alias: json.alias, headline: 'SERVICIOS DEL ESTE SA', cuit: '30712340001', currency: '80', activeAccount: 'T' });
  }
  if (ruta === '/bdv/transfers/immediates') return env({ success: true, transactionId: 752162663, nroControl: 2204 });
  res.writeHead(404); res.end();
}).listen(PUERTO, () => console.log('mock listo en', PUERTO));
