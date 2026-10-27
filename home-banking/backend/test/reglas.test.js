// Pruebas de las reglas que no requieren base ni banco: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants, randomBytes } from 'node:crypto';

process.env.OIDC_ISSUER = 'https://sso.test/realms/staff';
process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { armarRequest, estadoTrasEnvio, estadoDesdeBanco, largoConceptoMep } = await import('../src/bdv/transferencias.js');
const { cifrarClave, fechaMDY, fechaDMY, ClienteBdv, ErrorBanco } = await import('../src/bdv/cliente.js');
const { cifrar, descifrar } = await import('../src/secretos.js');
const { usuarioDesdeToken } = await import('../src/auth.js');
const { leerTxt, formatoDe } = await import('../src/servicios/lotes.js');
const { normalizarId } = await import('../src/servicios/transferencias.js');
const { TABLAS, mesCorte } = await import('../src/jobs/pase-historico.js');
const { retencionMeses } = await import('../src/corte.js');
const { destinatarioChat } = await import('../src/servicios/notificaciones-chat.js');
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

test('pase histórico: corte por meses de retención (1 por defecto)', () => {
  assert.equal(retencionMeses(undefined), 1);
  assert.equal(retencionMeses('3'), 3);
  assert.throws(() => retencionMeses('0'));
  assert.throws(() => retencionMeses('tres'));
  assert.equal(mesCorte(new Date('2026-10-21T12:00:00Z'), 1), '2026-09-01', 'octubre: queda septiembre y octubre');
  assert.equal(mesCorte(new Date('2026-11-01T05:10:00Z'), 1), '2026-10-01', 'el 1/11 pasa septiembre');
  assert.equal(mesCorte(new Date('2026-01-15T12:00:00Z'), 1), '2025-12-01', 'cambio de año');
  assert.equal(mesCorte(new Date('2026-10-21T12:00:00Z'), 3), '2026-07-01');
});

test('pase histórico: tablas que pasan, con su fecha y la condición de "terminada"', () => {
  const por = Object.fromEntries(TABLAS.map((t) => [t.tabla, t]));
  assert.deepEqual(Object.keys(por).sort(), ['auditoria', 'cola_envio', 'ejecucion_envio', 'envio_mail_log', 'mensaje', 'transferencia', 'transferencia_estado']);
  assert.ok(TABLAS.every((t) => /^[a-z_]+$/.test(t.tabla) && /^[a-z_]+$/.test(t.columna) && t.terminadas), 'nombres seguros para armar el SQL');
  assert.equal(por.transferencia.columna, 'creado_en');
  assert.match(por.transferencia_estado.terminadas, /NOT EXISTS/, 'el historial de estados de una transferencia abierta no pasa');
  assert.match(por.cola_envio.terminadas, /enviado/, 'lo pendiente de la cola no pasa');
  assert.match(por.mensaje.terminadas, /visto_en IS NOT NULL/, 'un mensaje no leído no pasa');
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
  assert.equal(cbuDeCuenta({ accountCbu: cbu, otroNumero: '9'.repeat(22) }), cbu, 'accountCbu (campo del banco) primero');
  assert.equal(cbuDeCuenta({ cbu }), cbu);
  assert.equal(cbuDeCuenta({ cbuNumber: '065-0001-000000000000100' }), cbu);
  assert.equal(cbuDeCuenta({ productNumber: '300100000057020', accountCBU: cbu }), cbu, 'cualquier nombre con cbu');
  assert.equal(cbuDeCuenta({ productNumber: '300100000057020', clave: cbu }), cbu, 'valor de 22 dígitos');
  assert.equal(cbuDeCuenta({ cbu: '123' }), null);
  assert.equal(cbuDeCuenta({}), null);
  assert.deepEqual(filaCoelsa({ cbu }, { cbu, alias: 'acme.pagos', headline: 'ACME SA', cuit: 30712345678 }), { cbu, alias: 'acme.pagos', titular: 'ACME SA', cuitTitular: '30712345678' });
  assert.throws(() => filaCoelsa({ cbu }, { cbu: '0650001000000000000999' }), /otro CBU/);
  assert.throws(() => filaCoelsa({}, { alias: 'x' }), /CBU válido/);
  assert.deepEqual(filaCoelsa({ accountCbu: cbu }, { aliasCbu: 'acme.pagos', headline: 'ACME SA' }), { cbu, alias: 'acme.pagos', titular: 'ACME SA', cuitTitular: null }, 'respuesta sin cbu: vale el de la cuenta');
  // Respuesta real de producción: cbu vacío, alias y titular informados
  const real = { success: true, message: null, cbu: '', alias: 'TITULOS.VALO', headline: 'BANCO DE VALORES SA', cuit: '30576124275', currency: '80', activeAccount: 'T', holders: [] };
  assert.deepEqual(filaCoelsa({ accountCbu: cbu }, real), { cbu, alias: 'TITULOS.VALO', titular: 'BANCO DE VALORES SA', cuitTitular: '30576124275' });
});

test('envíos programados: turnos, días, feriados, inicio y fin', async () => {
  const { turnosDelDia, diaHabilitado, turnoVencido, proximoTurno, enArgentina, validarProgramacion } = await import('../src/servicios/programacion.js');
  const base = { activa: true, frecuencia: 'diaria', hora: '09:00', dias_semana: [1, 2, 3, 4, 5], saltar_feriados: true, fecha_inicio: '2026-10-01', fecha_fin: null, ultimo_turno: null };
  assert.deepEqual(turnosDelDia(base), ['09:00']);
  assert.deepEqual(turnosDelDia({ ...base, frecuencia: 'horaria', hora: '09:30', hora_hasta: '12:30' }), ['09:30', '10:30', '11:30', '12:30']);
  assert.deepEqual(turnosDelDia({ ...base, frecuencia: 'horaria', hora: '09:00', hora_hasta: '11:59' }), ['09:00', '10:00', '11:00']);
  assert.deepEqual(turnosDelDia({ ...base, frecuencia: 'media_hora', hora: '09:00', hora_hasta: '11:00' }), ['09:00', '09:30', '10:00', '10:30', '11:00']);
  assert.deepEqual(turnosDelDia({ ...base, frecuencia: 'media_hora', hora: '09:15', hora_hasta: '10:30' }), ['09:15', '09:45', '10:15']);
  assert.deepEqual(turnosDelDia({ ...base, frecuencia: 'media_hora', hora: '23:00', hora_hasta: '23:59' }), ['23:00', '23:30'], 'no pasa de medianoche');
  // 2026-10-22 es jueves; 2026-10-24 sábado
  assert.equal(enArgentina(new Date('2026-10-22T12:00:00Z')).hora, '09:00', 'UTC-3');
  assert.ok(diaHabilitado(base, '2026-10-22'));
  assert.ok(!diaHabilitado(base, '2026-10-24'), 'sábado no elegido');
  assert.ok(!diaHabilitado(base, '2026-09-30'), 'antes del inicio');
  assert.ok(!diaHabilitado({ ...base, fecha_fin: '2026-10-21' }, '2026-10-22'), 'después del fin');
  const feriado = (f) => f === '2026-10-22';
  assert.ok(!diaHabilitado(base, '2026-10-22', feriado), 'feriado salteado');
  assert.ok(diaHabilitado({ ...base, saltar_feriados: false }, '2026-10-22', feriado), 'feriado no salteado si se pide');
  // turno vencido: a las 09:05 sí; a las 08:59 no; si ya se ejecutó, no; a las 10:30 ya pasó más de una hora
  assert.equal(turnoVencido(base, new Date('2026-10-22T12:05:00Z')), '2026-10-22T09:00');
  assert.equal(turnoVencido(base, new Date('2026-10-22T11:59:00Z')), null);
  assert.equal(turnoVencido({ ...base, ultimo_turno: '2026-10-22T09:00' }, new Date('2026-10-22T12:05:00Z')), null);
  assert.equal(turnoVencido(base, new Date('2026-10-22T13:30:00Z')), null, 'atrasado más de una hora: no se manda');
  assert.equal(turnoVencido(base, new Date('2026-10-22T12:05:00Z'), feriado), null);
  const hor = { ...base, frecuencia: 'horaria', hora: '09:00', hora_hasta: '18:00', ultimo_turno: '2026-10-22T09:00' };
  assert.equal(turnoVencido(hor, new Date('2026-10-22T13:10:00Z')), '2026-10-22T10:00');
  const media = { ...hor, frecuencia: 'media_hora' };
  assert.equal(turnoVencido(media, new Date('2026-10-22T12:35:00Z')), '2026-10-22T09:30');
  assert.equal(turnoVencido({ ...media, ultimo_turno: '2026-10-22T09:30' }, new Date('2026-10-22T12:50:00Z')), null, 'ya enviado; el próximo es 10:00');
  assert.equal(proximoTurno(media, new Date('2026-10-22T12:35:00Z')).toISOString(), '2026-10-22T13:00:00.000Z');
  // próximo: jueves 22 a las 10:00 → viernes 23 09:00; viernes 18:00 → lunes 26 09:00 (con feriado el lunes → martes)
  assert.equal(proximoTurno(base, new Date('2026-10-22T13:00:00Z')).toISOString(), '2026-10-23T12:00:00.000Z');
  assert.equal(proximoTurno(base, new Date('2026-10-23T21:00:00Z')).toISOString(), '2026-10-26T12:00:00.000Z');
  assert.equal(proximoTurno(base, new Date('2026-10-23T21:00:00Z'), (f) => f === '2026-10-26').toISOString(), '2026-10-27T12:00:00.000Z');
  assert.equal(proximoTurno({ ...base, fecha_fin: '2026-10-23' }, new Date('2026-10-23T21:00:00Z')), null, 'terminó');
  // validación
  const ok = { nombre: 'Resumen diario', contenido: 'saldos', frecuencia: 'horaria', hora: '09:00', horaHasta: '18:00', diasSemana: [5, 1, 1], fechaInicio: '2026-10-22' };
  assert.deepEqual(validarProgramacion(ok).dias, [1, 5]);
  assert.throws(() => validarProgramacion({ ...ok, horaHasta: '08:00' }));
  assert.equal(validarProgramacion({ ...ok, frecuencia: 'media_hora' }).horaHasta, '18:00');
  assert.throws(() => validarProgramacion({ ...ok, frecuencia: 'media_hora', horaHasta: '' }));
  assert.throws(() => validarProgramacion({ ...ok, frecuencia: 'cada_minuto' }));
  assert.throws(() => validarProgramacion({ ...ok, diasSemana: [] }));
  assert.throws(() => validarProgramacion({ ...ok, fechaFin: '2026-10-01' }));
  assert.throws(() => validarProgramacion({ ...ok, todasEmpresas: false, destinos: [] }));
  assert.deepEqual(validarProgramacion({ ...ok, todasEmpresas: false, destinos: [{ empresaId: '3', cuentas: ['200', '100', '100'] }, { empresaId: 4 }] }).destinos,
    [{ empresaId: 3, cuentas: ['100', '200'] }, { empresaId: 4, cuentas: [] }], 'cliente y luego sus cuentas (vacío = todas)');
  assert.equal(validarProgramacion(ok).formato, 'cuerpo', 'por defecto, solo el cuerpo del correo');
  assert.equal(validarProgramacion({ ...ok, formato: 'cuerpo_excel' }).formato, 'cuerpo_excel');
  assert.throws(() => validarProgramacion({ ...ok, formato: 'pdf' }));
});

test('envíos programados: Excel adjunto con saldos y todos los movimientos', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { xlsxEnvio } = await import('../src/excel.js');
  const movs = Array.from({ length: 150 }, (_, i) => ({ transactionId: i + 1, processDate: '22/10/2026', hour: '10:00', description: `MOV ${i}`, signDC: i % 2 ? 'D' : 'C', amount: 10, availableBalance: 5 }));
  const cuentas = [{ productNumber: '100', productName: 'CC', currencyId: 80, availableBalance: 1234.5, accountingBalance: 1300, movimientos: movs },
    { productNumber: '101', productName: 'CA', currencyId: 2, availableBalance: 7, accountingBalance: 7, movimientos: [] }];
  const leer = async (buf) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; };
  const logo = (await import('node:fs')).readFileSync(new URL('../src/assets/logo-valo.png', import.meta.url));
  let wb = await leer(await xlsxEnvio({ razon_social: 'ALFA SA', cuit: '30712345671' }, cuentas, 'saldos_movimientos', { titulo: 'Extracto diario al 22/10/2026', logo }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['100 ARS', '101 USD'], 'un solo Excel, una pestaña por cuenta');
  const cc = wb.getWorksheet('100 ARS'), ca = wb.getWorksheet('101 USD');
  assert.equal(cc.getCell('C1').value, 'Extracto diario al 22/10/2026');
  assert.match(cc.getCell('C2').value, /ALFA SA · CUIT 30712345671/);
  assert.match(cc.getCell('C3').value, /Cuenta 100 · CC · ARS · Disponible \$ 1\.234,50 · Contable \$ 1\.300,00/);
  assert.equal(cc.getImages().length, 1, 'logo del banco'); assert.equal(ca.getImages().length, 1);
  const cab = cc.getRow(5).values;
  assert.ok(cab.includes('Saldo') && cab.includes('Importe') && !cab.includes('Cliente'));
  assert.equal(cc.rowCount, 155, 'todos los movimientos de la cuenta, sin el tope del cuerpo');
  assert.equal(cc.getRow(7).getCell(cab.indexOf('Importe')).value, -10, 'débito en negativo');
  assert.equal(ca.getRow(6).getCell(1).value, 'Sin movimientos');
  // Alerta: sin la columna Saldo
  wb = await leer(await xlsxEnvio({ razon_social: 'ALFA SA', cuit: '30712345671' }, [cuentas[0]], 'movimientos', { titulo: 'Alerta', logo, conSaldo: false }));
  assert.ok(!wb.getWorksheet('100 ARS').getRow(5).values.includes('Saldo'));
  // Solo saldos: una pestaña por cuenta con su saldo
  wb = await leer(await xlsxEnvio({ razon_social: 'ALFA SA', cuit: '30712345671' }, cuentas, 'saldos', { titulo: 'Extracto', logo }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['100 ARS', '101 USD']);
  assert.equal(wb.getWorksheet('100 ARS').getRow(6).getCell(4).value, 1234.5);
});

test('alerta de movimientos: franja de 29:59 antes de la ejecución', async () => {
  const { franjaDeTurno, segundosDeHora, enFranja } = await import('../src/servicios/programacion.js');
  const f = franjaDeTurno('2026-10-22T10:00');
  assert.equal(f.desdeTxt.horaSeg, '09:30:01'); assert.equal(f.hastaTxt.horaSeg, '10:00:00'); assert.deepEqual(f.fechas, ['2026-10-22']);
  assert.deepEqual(['09:30:00', '09:30:01', '09:45', '10:00:00', '10:00:01'].map((hour) => enFranja({ hour }, '2026-10-22', f)), [false, true, true, true, false]);
  assert.deepEqual(franjaDeTurno('2026-10-22T00:00').fechas, ['2026-10-21', '2026-10-22'], 'cruza la medianoche: consulta los dos días');
  assert.equal(franjaDeTurno('manual 2026-10-22T13:15:42.900Z').hastaTxt.horaSeg, '10:15:42', 'Ejecutar ahora: hasta el momento en que se pidió');
  assert.deepEqual(['10:21', '10:21:33', '10:21:33 PM', '12:05 AM', '102133', '', 'x'].map(segundosDeHora), [37260, 37293, 80493, 300, 37293, null, null]);
});

test('movimientos: CBU origen solo en las causales 366 y 367 (campo reference)', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { causalDe, cbuOrigen, cbuOBeneficiario, filaMovimiento, xlsxMovimientos } = await import('../src/excel.js');
  const cbu = '0720000720000001234567';
  assert.equal(causalDe({ reference: '741' }), '741');
  assert.equal(causalDe({ reference: '0366' }), '366');
  assert.equal(causalDe({ reference: null, causeId: 367 }), '367');
  assert.equal(causalDe({}), null);
  assert.equal(cbuOrigen({ reference: '366', cbuOri: cbu }), cbu);
  assert.equal(cbuOrigen({ reference: '367', cbuOri: ` ${cbu} ` }), cbu);
  assert.equal(cbuOrigen({ reference: '741', cbuOri: cbu }), '', 'otras causales en blanco');
  assert.equal(cbuOrigen({ reference: '366', cbuOri: null }), '');
  assert.equal(cbuOBeneficiario({ reference: '366', cbuOri: cbu, beneficiary: 'X SA' }), cbu);
  assert.equal(cbuOBeneficiario({ reference: '741', cbuOri: cbu, beneficiary: ' PROVEEDOR SA ' }), 'PROVEEDOR SA', 'otras causales: beneficiario');
  const filas = [{ reference: '366', cbuOri: cbu }, { reference: '741', cbuOri: cbu, beneficiary: 'PROVEEDOR SA' }].map((m) => filaMovimiento({ ...m, signDC: 'D', amount: 1, availableBalance: 1, transactionId: 1 }, { cuenta: '100', cliente: 'ALFA', moneda: 'ARS' }));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await xlsxMovimientos(filas, { hoja: 'Débitos', titulo: 'Débitos realizados · 22/10/2026', subtitulo: 'ALFA' }));
  const ws = wb.getWorksheet('Débitos');
  assert.equal(ws.getImages().length, 1, 'logo del banco'); assert.equal(ws.getCell('C1').value, 'Débitos realizados · 22/10/2026'); assert.equal(ws.getCell('C2').value, 'ALFA');
  const cab = ws.getRow(5).values; const col = cab.indexOf('CBU origen (366/367) / Beneficiario');
  assert.ok(col > 0 && cab.includes('Causal'));
  assert.equal(ws.getRow(6).getCell(col).value, cbu); assert.equal(ws.getRow(7).getCell(col).value, 'PROVEEDOR SA', 'causal 741: beneficiario');
});

test('riesgo de fraude: señales explicables y niveles', async () => {
  const { senales, nivelDe } = await import('../src/servicios/riesgo.js');
  const u = { montoAltoARS: 10_000_000, montoAltoUSD: 10_000, veces: 3, minimoHistoria: 3, rafaga: 3 };
  const base = { previasDestino: 2, historia: 10, promedio: 100_000, maximo: 300_000, importe: 120_000, moneda: 'ARS', rafaga: 1, hora: 11, dow: 3 };
  assert.deepEqual(senales(base, u), { puntos: 0, nivel: 'bajo', senales: [] }, 'operación habitual');
  let r = senales({ ...base, previasDestino: 0 }, u); assert.equal(r.nivel, 'medio'); assert.equal(r.senales[0].codigo, 'destino_nuevo');
  r = senales({ ...base, previasDestino: 0, importe: 500_000 }, u);
  assert.equal(r.nivel, 'alto'); assert.deepEqual(r.senales.map((x) => x.codigo), ['destino_nuevo', 'monto_atipico']);
  r = senales({ ...base, importe: 700_000, promedio: 300_000 }, u); assert.deepEqual(r.senales.map((x) => x.codigo), ['monto_maximo'], 'más del doble del máximo');
  assert.ok(senales({ ...base, historia: 1, importe: 900_000 }, u).senales.every((x) => x.codigo !== 'monto_atipico'), 'sin historia no compara');
  assert.equal(senales({ ...base, importe: 12_000, moneda: 'USD', promedio: 10_000, maximo: 12_000 }, u).senales[0].codigo, 'monto_alto');
  assert.equal(senales({ ...base, rafaga: 4 }, u).senales[0].codigo, 'rafaga');
  assert.equal(senales({ ...base, hora: 22 }, u).senales[0].codigo, 'fuera_de_horario');
  assert.equal(senales({ ...base, dow: 7 }, u).senales[0].codigo, 'fuera_de_horario', 'domingo');
  assert.equal(nivelDe(24), 'bajo'); assert.equal(nivelDe(25), 'medio'); assert.equal(nivelDe(50), 'alto');
});

test('límites de pedidos y enmascarado de logs', async () => {
  const { consumir, mascarar, REGLAS } = await import('../src/limites.js');
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(consumir('x|u', 3, t0 + i).ok, true);
  const c = consumir('x|u', 3, t0 + 10_000); assert.equal(c.ok, false); assert.equal(c.reintentarEnSeg, 50);
  assert.equal(consumir('x|u', 3, t0 + 60_000).ok, true, 'ventana nueva');
  assert.equal(consumir('x|otro', 3, t0 + 10_000).ok, true, 'por usuario');
  const regla = (m, u) => REGLAS.find((r) => r.nombre !== 'general' && r.coincide(m, u))?.nombre;
  assert.equal(regla('POST', '/api/transferencias/5/aprobar'), 'operaciones');
  assert.equal(regla('GET', '/api/transferencias?desde=2026-10-01'), undefined, 'consultar el registro no es operar');
  assert.equal(regla('GET', '/api/cbu?cbu=0720000720000001234567'), 'consultas-sensibles');
  assert.equal(regla('POST', '/api/admin/credenciales/prod/probar?uso=envios'), 'credenciales');
  assert.equal(mascarar('/api/cbu?cbu=0720000720000001234567'), '/api/cbu?cbu=0720…67');
  assert.equal(mascarar('/api/cbu?alias=mi.alias.secreto&x=1'), '/api/cbu?alias=***&x=1');
  assert.equal(mascarar('/api/cuentas/300100000143178/movimientos?desde=2026-10-01'), '/api/cuentas/3001…78/movimientos?desde=2026-10-01', 'fechas intactas');
});

test('alerta por chat: destinatario de Teams (agrega el dominio si no tiene @valo)', () => {
  assert.equal(destinatarioChat('jperez'), 'jperez@valo.ar');           // sin @valo → se agrega el dominio
  assert.equal(destinatarioChat('maria.lopez'), 'maria.lopez@valo.ar');
  assert.equal(destinatarioChat('jperez@valo.ar'), 'jperez@valo.ar');   // ya tiene @valo → tal cual
  assert.equal(destinatarioChat('jperez@valo.com.ar'), 'jperez@valo.com.ar');
});


test('circuit breaker BDV: abre por disponibilidad y bloquea transferencias antes de enviarlas', () => {
  const c = new ClienteBdv('prueba');
  const n = configBdv().umbralFallos;
  for (let i = 0; i < n; i++) c.registrarFalloCircuito(new ErrorBanco('Sin respuesta', { sinRespuesta: true }));
  assert.equal(c.estadoCircuito().estado, 'abierto');
  assert.throws(() => c.permitirPorCircuito({ envio: true }), /no fue enviada|circuito|recuperación/i);
});

test('circuit breaker BDV: 4xx no abre y recuperación half-open solo usa consultas', () => {
  const c = new ClienteBdv('prueba');
  c.registrarFalloCircuito(new ErrorBanco('HTTP 400', { http: 400 }));
  assert.equal(c.estadoCircuito().estado, 'cerrado');
  c.circuito.estado = 'abierto'; c.circuito.abiertoHasta = Date.now() - 1;
  assert.throws(() => c.permitirPorCircuito({ envio: true }), /no fue enviada/i);
  const permiso = c.permitirPorCircuito({ envio: false });
  assert.equal(permiso.prueba, true);
  assert.equal(c.estadoCircuito().estado, 'semiabierto');
  c.registrarExitoCircuito();
  assert.equal(c.estadoCircuito().estado, 'cerrado');
});

function configBdv() {
  return { umbralFallos: Math.max(1, Number(process.env.BDV_CIRCUIT_BREAKER_FAILURES ?? 5)) };
}

// Conciliación débito ↔ transferencia: nunca asigna si hay candidatos equivalentes
const { elegirMovimiento } = await import('../src/jobs/estado-banco.js');
test('conciliación: un solo débito equivalente se vincula', () => {
  const t = { id: 1, importe: '1000.00', aprobado_en: '2026-10-20T13:00:00Z', transaction_id: 'T-1' };
  const r = elegirMovimiento(t, [{ signDC: 'D', amount: 1000, transactionId: 'M-1', processDate: '2026-10-20', hour: '10:15:00' }], new Set(), 0);
  assert.equal(r.movimiento.transactionId, 'M-1');
});
test('conciliación: dos débitos idénticos => ambigua, sin asignación', () => {
  const t = { id: 1, importe: '1000.00', aprobado_en: '2026-10-20T13:00:00Z', transaction_id: 'T-1' };
  const ms = [{ signDC: 'D', amount: 1000, transactionId: 'M-1', processDate: '2026-10-20', hour: '10:15:00' },
    { signDC: 'D', amount: 1000, transactionId: 'M-2', processDate: '2026-10-20', hour: '10:16:00' }];
  const r = elegirMovimiento(t, ms, new Set(), 0);
  assert.equal(r.ambigua, true);
  assert.equal(r.movimiento, undefined);
});
test('conciliación: dos transferencias idénticas y un solo débito => ambigua', () => {
  const t = { id: 1, importe: '1000.00', aprobado_en: '2026-10-20T13:00:00Z' };
  const r = elegirMovimiento(t, [{ signDC: 'D', amount: 1000, transactionId: 'M-1', processDate: '2026-10-20', hour: '10:15:00' }], new Set(), 1);
  assert.equal(r.ambigua, true);
  assert.equal(r.movimiento, undefined);
});
test('conciliación: el ID/referencia desempata aunque haya importes iguales', () => {
  const t = { id: 1, importe: '1000.00', aprobado_en: '2026-10-20T13:00:00Z', referencia: 'OP-77' };
  const ms = [{ signDC: 'D', amount: 1000, transactionId: 'M-1', processDate: '2026-10-20', hour: '10:15:00' },
    { signDC: 'D', amount: 1000, transactionId: 'OP-77', processDate: '2026-10-20', hour: '10:16:00' }];
  assert.equal(elegirMovimiento(t, ms, new Set(), 1).movimiento.transactionId, 'OP-77');
});
test('conciliación: un movimiento ya vinculado no se reutiliza', () => {
  const t = { id: 1, importe: '1000.00', aprobado_en: '2026-10-20T13:00:00Z' };
  const ms = [{ signDC: 'D', amount: 1000, transactionId: 'M-1', processDate: '2026-10-20', hour: '10:15:00' }];
  assert.deepEqual(elegirMovimiento(t, ms, new Set(['M-1']), 0), {});
});
