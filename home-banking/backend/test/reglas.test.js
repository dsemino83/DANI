// Pruebas de las reglas que no requieren base ni banco: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants, randomBytes } from 'node:crypto';

process.env.OIDC_ISSUER = 'https://sso.test/realms/staff';
process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { armarRequest, estadoTrasEnvio, estadoDesdeBanco, largoConceptoMep } = await import('../src/bdv/transferencias.js');
const { cifrarClave, fechaMDY, fechaDMY } = await import('../src/bdv/cliente.js');
const { cifrar, descifrar } = await import('../src/secretos.js');
const { usuarioDesdeToken } = await import('../src/auth.js');
const { leerTxt, formatoDe } = await import('../src/servicios/lotes.js');
const { particionesAPasar, mesCorte } = await import('../src/jobs/pase-historico.js');

const origenARS = { productId: 3, currencyId: 80, productNumber: '300100000000000', productAlias: 'X' };

test('inmediata: alias vs CBU y concepto del catálogo', () => {
  const r = armarRequest('INMEDIATA', origenARS, { destino: 'PAGOS.PROVEEDOR', importe: '600', concepto: 'varios' });
  assert.deepEqual(r.destination, { cbu: '', alias: 'PAGOS.PROVEEDOR' });
  assert.equal(r.origin.productNumber, '300100000000000');
  assert.equal(r.concept, 'VARIOS');
  const r2 = armarRequest('INMEDIATA', origenARS, { destino: '0720000000000000000055', importe: 1 });
  assert.equal(r2.destination.cbu, '0720000000000000000055');
  assert.throws(() => armarRequest('INMEDIATA', origenARS, { destino: 'X', importe: 1, concepto: 'INEXISTENTE' }));
});

test('importe debe ser mayor a cero', () => {
  assert.throws(() => armarRequest('PROPIAS', origenARS, { destino: '400100000000000', importe: 0 }), /mayor a cero/);
});

test('MEP: largo del concepto libre y CBU obligatorio en DL/DR', () => {
  assert.equal(largoConceptoMep('DL1'), 30);
  assert.equal(largoConceptoMep('GC0'), 100);
  assert.equal(largoConceptoMep('GC2'), 50);
  assert.throws(() => armarRequest('MEP', origenARS, { codigoMep: 'DL1', destino: '123', cuitDestino: '30712399991', importe: 10 }), /CBU/);
  assert.throws(() => armarRequest('MEP', origenARS, { codigoMep: 'DL1', destino: '0720000000000000000055', cuitDestino: '30712399991', importe: 10, conceptoLibre: 'x'.repeat(31) }), /30/);
  const r = armarRequest('MEP', origenARS, { codigoMep: 'DL1', destino: '0720000000000000000055', cuitDestino: '30712399991', importe: 10, conceptoFijo: 'FAC', titular: 'ACEROS' });
  assert.equal(r.transfType, 'DL1');
  assert.equal(r.conceptF, 'FAC');
  assert.equal(r.currencyIdOri, '80');
});

test('respuesta del banco: immediates con y sin nroControl, error y otras APIs', () => {
  assert.equal(estadoTrasEnvio('INMEDIATA', { success: true, transactionId: 752162663, nroControl: 2204 }).estado, 'DEBITADA');
  assert.equal(estadoTrasEnvio('INMEDIATA', { success: true, transactionId: 4976362, nroControl: null }).estado, 'PEND_AUTORIZACION');
  assert.equal(estadoTrasEnvio('MEP', { success: true, transactionId: 4974201 }).estado, 'ENVIADA');
  const e = estadoTrasEnvio('PROPIAS', { success: false, message: { code: '1875127', message: 'NO SE ENCONTRO INFORMACION DE LA CUENTA DESTINO.' } });
  assert.equal(e.estado, 'ERROR_API');
  assert.equal(e.codigo, '1875127');
});

test('getTransfersStatus: F, P, E, R', () => {
  assert.equal(estadoDesdeBanco({ status: 'F', finalized: 'S' }), 'DEBITADA');
  assert.equal(estadoDesdeBanco({ status: 'P' }), 'PEND_AUTORIZACION');
  assert.equal(estadoDesdeBanco({ status: 'R' }), 'RECHAZADA_BANCO');
  assert.equal(estadoDesdeBanco({ status: 'E' }), 'RECHAZADA_BANCO');
  assert.equal(estadoDesdeBanco({ status: 'X' }), null);
});

test('la clave API se cifra con RSA PKCS#1 v1.5 y el banco la puede descifrar', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64'); // formato MIIB... del PDF
  const c = cifrarClave('clave-secreta', der);
  assert.equal(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(c, 'base64')).toString(), 'clave-secreta');
});

test('la credencial en reposo se cifra con AES-256-GCM y detecta alteraciones', () => {
  const s = cifrar('mi clave');
  assert.equal(descifrar(s), 'mi clave');
  s.cifrado[0] ^= 1;
  assert.throws(() => descifrar(s));
});

test('roles: el administrador de seguridad nunca opera aunque el token traiga roles de operación', () => {
  const u = usuarioDesdeToken({ sub: '1', preferred_username: 'admin.ti', resource_access: { 'home-banking-api': { roles: ['administrador', 'transferencias:crear', 'transferencias:aprobar'] } } });
  assert.equal(u.rol, 'administrador');
  assert.equal(u.puedeCrear, false);
  assert.equal(u.puedeAprobar, false);
  const o = usuarioDesdeToken({ sub: '2', preferred_username: 'mgomez', resource_access: { 'home-banking-api': { roles: ['operador', 'transferencias:crear'] } } });
  assert.equal(o.rol, 'operador');
  assert.equal(o.puedeCrear, true);
  assert.equal(o.puedeAprobar, false);
});

test('fechas para el banco', () => {
  assert.equal(fechaMDY('2026-10-20'), '10/20/2026');
  assert.equal(fechaDMY('2026-10-20'), '20/10/2026');
});

test('carga masiva: formatos y TXT de ancho fijo', () => {
  assert.equal(formatoDe('pagos.CSV'), 'CSV');
  assert.equal(formatoDe('pagos.xlsx'), 'XLSX');
  assert.throws(() => formatoDe('pagos.pdf'));
  const linea = 'INMEDIATA ' + '300100000000000' + 'PAGOS.PROVEEDOR'.padEnd(22) + '30712340001' + '000000042000050' + 'FACTURA'.padEnd(30) + '   ';
  const [f] = leerTxt(linea);
  assert.equal(f.tipo, 'INMEDIATA');
  assert.equal(f.cuenta_origen, '300100000000000');
  assert.equal(f.destino, 'PAGOS.PROVEEDOR');
  assert.equal(f.importe, '420000.50');
});

test('pase histórico: solo particiones anteriores al corte de 3 meses', () => {
  assert.equal(mesCorte(new Date('2026-10-21T12:00:00Z')), '2026-07-01');
  const p = particionesAPasar(['auditoria_2026_05', 'auditoria_2026_06', 'auditoria_2026_07', 'auditoria_2026_10', 'auditoria_default'], 'auditoria', '2026-07-01');
  assert.deepEqual(p.map((x) => x.particion), ['auditoria_2026_05', 'auditoria_2026_06']);
});
