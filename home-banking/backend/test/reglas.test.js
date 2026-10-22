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
const { normalizarId } = await import('../src/servicios/transferencias.js');
const { particionesAPasar, mesCorte } = await import('../src/jobs/pase-historico.js');
const { urlBase, urlDelAmbiente, esAmbiente } = await import('../src/bdv/ambientes.js');

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
  const linea = 'INMEDIATA ' + '300100000000000' + 'PAGOS.PROVEEDOR'.padEnd(22) + '30712340001' + '000000042000050' + 'FACTURA'.padEnd(30) + '   ' + 'PAGO-2026-000123'.padEnd(40);
  const [f] = leerTxt(linea);
  assert.equal(f.id, 'PAGO-2026-000123');
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

test('URL del banco según el ambiente: producción en api.bancodevalores.com', () => {
  assert.equal(urlBase('prod'), 'https://api.bancodevalores.com/CTSProxy/services/resources/channels/mobilebanking');
  assert.equal(urlBase('homo'), 'https://apihomo.bancodevalores.com/CTSProxy/services/resources/channels/mobilebanking');
  assert.ok(urlDelAmbiente('prod', urlBase('prod')));
  assert.ok(!urlDelAmbiente('prod', urlBase('homo')), 'producción nunca usa homologación');
  assert.ok(!urlDelAmbiente('homo', urlBase('prod')), 'homologación nunca usa producción');
  assert.ok(!urlDelAmbiente('prod', 'https://api.bancodevalores.com.otro.com/x'));
  assert.ok(!urlDelAmbiente('prod', 'http://api.bancodevalores.com/x'));
  assert.ok(!esAmbiente('dev') && !esAmbiente('__proto__'));
  process.env.BDV_URL_HOMO = 'http://simulador:8080/bdv/';
  assert.equal(urlBase('homo'), 'http://simulador:8080/bdv', 'homologación se puede apuntar a un simulador');
  assert.ok(urlBase('prod').startsWith('https://api.bancodevalores.com/'), 'producción no se puede cambiar');
  delete process.env.BDV_URL_HOMO;
  assert.throws(() => urlBase('dev'));
});

test('un solo camino al banco: enviar() solo se usa dentro de enviarUnaVez', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const archivos = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? archivos(join(d, f)) : f.endsWith('.js') ? [join(d, f)] : []));
  const usos = archivos(new URL('../src', import.meta.url).pathname)
    .filter((f) => !f.endsWith('bdv/transferencias.js'))
    .filter((f) => /\benviar\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(usos.map((f) => f.split('/src/')[1]), ['servicios/transferencias.js']);
  const fuente = readFileSync(new URL('../src/servicios/transferencias.js', import.meta.url), 'utf8');
  assert.equal(fuente.match(/\benviar\s*\(/g).length, 1, 'una sola llamada');
  const cuerpo = fuente.slice(fuente.indexOf('export async function enviarUnaVez'), fuente.indexOf('export async function registrarResultado'));
  assert.match(cuerpo, /INSERT INTO envio_banco[\s\S]*return enviar\(/, 'primero registra el envío, después llama al banco');
});

test('ID de operación: obligatorio, normalizado y con formato acotado', () => {
  assert.equal(normalizarId('  pago-2026/001 '), 'PAGO-2026/001', 'sin espacios y sin distinguir mayúsculas');
  assert.equal(normalizarId(12345), '12345');
  for (const malo of ['', '   ', null, undefined, '-ABC', 'A B', 'A'.repeat(41), "X';DROP"]) assert.throws(() => normalizarId(malo), String(malo));
});

test('alta de usuario: validaciones y clave temporal', async () => {
  const { validarAlta, validarClaveTemporal, PERFILES } = await import('../src/keycloak-admin.js');
  const ok = { usuario: ' JPerez ', email: 'jperez@valo.ar', nombre: 'Juan', apellido: 'Pérez', perfil: 'operador', claveTemporal: 'Temporal-2026x' };
  assert.equal(validarAlta(ok).usuario, 'jperez', 'en minúsculas y sin espacios');
  assert.deepEqual(PERFILES, ['operador', 'autorizante', 'auditor', 'administrador']);
  assert.throws(() => validarAlta({ ...ok, usuario: 'a' }));
  assert.throws(() => validarAlta({ ...ok, usuario: 'juan perez' }));
  assert.throws(() => validarAlta({ ...ok, email: 'sin-arroba' }));
  assert.throws(() => validarAlta({ ...ok, apellido: '' }));
  assert.throws(() => validarAlta({ ...ok, perfil: 'superusuario' }));
  for (const mala of ['corta1', 'sinnumerosenlaclave', '123456789012', '']) assert.throws(() => validarClaveTemporal(mala), mala);
});

test('emails de empresa: separadores, minúsculas, repetidos y límite', async () => {
  const { normalizarEmails, MAX_EMAILS } = await import('../src/servicios/empresas.js');
  assert.deepEqual(normalizarEmails(' Tesoreria@Acme.com.ar; pagos@acme.com.ar,\ntesoreria@acme.com.ar '), ['tesoreria@acme.com.ar', 'pagos@acme.com.ar']);
  assert.deepEqual(normalizarEmails(['a@b.co', 'A@B.CO']), ['a@b.co']);
  assert.deepEqual(normalizarEmails(''), []);
  assert.throws(() => normalizarEmails('bien@acme.com, mal-email'), /mal-email/);
  assert.throws(() => normalizarEmails(Array.from({ length: MAX_EMAILS + 1 }, (_, i) => `u${i}@acme.com`)));
});

test('buscador de cuentas: contiene, sin mayúsculas ni acentos', async () => {
  const { coincide } = await import('../src/servicios/empresas.js');
  const c = { cuenta: '000123456', nombre: 'FIDEICOMISO ÁGUILA CC $', alias: 'aguila.pagos' };
  for (const t of ['', 'aguila', 'ÁGUI', 'comiso', '23456', 'PAGOS']) assert.ok(coincide(c, t), t);
  for (const t of ['condor', '999']) assert.ok(!coincide(c, t), t);
});

test('edición de datos de usuario', async () => {
  const { validarDatos } = await import('../src/keycloak-admin.js');
  assert.deepEqual(validarDatos({ nombre: ' Ana ', apellido: 'Gómez', email: 'ana@valo.ar' }), { nombre: 'Ana', apellido: 'Gómez', email: 'ana@valo.ar' });
  assert.throws(() => validarDatos({ nombre: 'Ana', apellido: '', email: 'ana@valo.ar' }));
  assert.throws(() => validarDatos({ nombre: 'Ana', apellido: 'Gómez', email: 'ana' }));
});

test('CBU de la cuenta y datos de COELSA', async () => {
  const { cbuDeCuenta, filaCoelsa } = await import('../src/servicios/empresas.js');
  const cbu = '0650001000000000000100';
  assert.equal(cbuDeCuenta({ cbu }), cbu);
  assert.equal(cbuDeCuenta({ cbuNumber: '065-0001-000000000000100' }), cbu);
  assert.equal(cbuDeCuenta({ productNumber: '300100000057020', accountCBU: cbu }), cbu, 'cualquier nombre con cbu');
  assert.equal(cbuDeCuenta({ productNumber: '300100000057020', clave: cbu }), cbu, 'valor de 22 dígitos');
  assert.equal(cbuDeCuenta({ cbu: '123' }), null);
  assert.equal(cbuDeCuenta({}), null);
  assert.deepEqual(filaCoelsa({ cbu }, { cbu, alias: 'acme.pagos', headline: 'ACME SA', cuit: 30712345678 }), { cbu, alias: 'acme.pagos', titular: 'ACME SA', cuitTitular: '30712345678' });
  assert.throws(() => filaCoelsa({ cbu }, { cbu: '0650001000000000000999' }), /otro CBU/);
  assert.throws(() => filaCoelsa({}, { alias: 'x' }), /CBU válido/);
});
