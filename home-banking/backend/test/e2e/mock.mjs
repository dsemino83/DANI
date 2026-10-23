// Simulador del SSO (emite JWT y publica el JWKS) y del Banco de Valores, para la prueba de
// autorización de punta a punta en CI. No reemplaza a Keycloak ni al banco reales: solo permite
// ejercitar el control de acceso del backend con tokens y cuentas controladas.
import http from 'node:http';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { exportJWK, SignJWT, importJWK } from 'jose';

const PUERTO = Number(process.env.MOCK_PORT ?? 18080);
const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const banco = generateKeyPairSync('rsa', { modulusLength: 2048 });
const llaveBanco = banco.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const ISS = `http://127.0.0.1:${PUERTO}/realms/staff`;
const firma = await importJWK({ ...(await exportJWK(kp.privateKey)), alg: 'RS256' }, 'RS256');
const token = (u, roles) => new SignJWT({ preferred_username: u, resource_access: { 'home-banking-api': { roles } } })
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISS).setAudience('home-banking-api').setSubject(u).setExpirationTime('1h').sign(firma);

// Tokens de cada perfil, escritos en el archivo que pase el runner.
writeFileSync(process.argv[2], JSON.stringify({
  llaveBanco,
  admin: await token('admin.ti', ['administrador']),
  mgomez: await token('mgomez', ['operador', 'transferencias:crear']),
  operadorB: await token('operadorb', ['operador', 'transferencias:crear']),
  lrodriguez: await token('lrodriguez', ['autorizante', 'transferencias:aprobar']),
  ambos: await token('cfunes', ['autorizante', 'transferencias:crear', 'transferencias:aprobar']),
  auditor: await token('svillalba', ['auditor']),
}));

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
  if (ruta === '/realms/staff/protocol/openid-connect/certs') return env({ keys: [jwk] });
  if (ruta.startsWith('/realms/')) { res.writeHead(404); return res.end(); }
  if (ruta === '/bdv/security/login') {
    const clave = privateDecrypt({ key: banco.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(json.password, 'base64')).toString();
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
