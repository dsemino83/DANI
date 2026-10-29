import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identificar, sanearNombre, validar, pareceSecreto, LIMITES } from '../ingesta/tipos.js';
import { perfilar, aFecha } from '../ingesta/perfil.js';
import { mapear, inferirEstrategia, convertir, camposDesdeColumnas } from '../ingesta/mapeo.js';
import { fragmentar, recuperar, resumir, refTexto } from '../ingesta/documentos.js';
import { validarUrl, ipPrivada, detectarTabla, aMatriz } from '../supabase/functions/so-api/seguridad.js';

const bytes = (...xs) => new Uint8Array(xs.flat());
const txt = (s) => new TextEncoder().encode(s);

test('tipo real por firma de bytes, no por extensión', () => {
  assert.equal(identificar(txt('%PDF-1.7\n...'), 'informe.pdf').tipo, 'pdf');
  assert.equal(identificar(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'foto.png').kind, 'image');
  assert.equal(identificar(bytes([0xff, 0xd8, 0xff, 0xe0]), 'foto.jpg').tipo, 'jpeg');
  assert.equal(identificar(txt('RIFF\0\0\0\0WEBPVP8 '), 'a.webp').tipo, 'webp');
  assert.equal(identificar(bytes([0, 0, 0, 0x18], [...txt('ftypheic')]), 'IMG_1.HEIC').tipo, 'heic');
  assert.equal(identificar(bytes([0x50, 0x4b, 0x03, 0x04]), 'ventas.xlsx').tipo, 'xlsx');
  assert.equal(identificar(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'viejo.xls').tipo, 'xls');
  assert.equal(identificar(txt('fecha;monto\n01/10/2026;100\n02/10/2026;200'), 'datos.txt').tipo, 'csv');
  assert.equal(identificar(txt('a\tb\n1\t2\n3\t4'), 'x.tsv').tipo, 'tsv');
  assert.equal(identificar(txt('{"a": 1}'), 'x.json').tipo, 'json');
  assert.equal(identificar(txt('<?xml version="1.0"?><r/>'), 'x.xml').tipo, 'xml');
  assert.equal(identificar(txt('{\\rtf1\\ansi hola}'), 'x.rtf').tipo, 'rtf');
  assert.equal(identificar(txt('# Título\n\ntexto'), 'notas.md').tipo, 'md');
});

test('MIME spoofing: el contenido manda y se avisa', () => {
  const r = identificar(txt('%PDF-1.4'), 'foto.png', 'image/png');
  assert.equal(r.tipo, 'pdf');
  assert.equal(r.inconsistente, true);
  assert.match(r.avisos[0], /el contenido es PDF/);
});

test('ejecutables y scripts bloqueados aunque se disfracen', () => {
  assert.equal(identificar(bytes([0x4d, 0x5a, 0x90, 0]), 'factura.pdf').bloqueado, true);
  assert.equal(identificar(bytes([0x7f, 0x45, 0x4c, 0x46]), 'datos.csv').bloqueado, true);
  assert.equal(identificar(txt('#!/bin/sh\nrm -rf /'), 'notas.txt').bloqueado, true);
  assert.equal(identificar(txt('alert(1)'), 'x.js').bloqueado, true);
  assert.match(validar(identificar(txt('x'), 'run.bat'), 10), /No acepto/);
  assert.match(identificar(bytes([0x50, 0x4b, 0x03, 0x04]), 'macro.xlsm').avisos[0], /macros/);
  assert.equal(identificar(txt('<svg onload="alert(1)"></svg>'), 'x.svg').kind, 'document');   // nunca se muestra como imagen
});

test('límites de tamaño y archivos vacíos', () => {
  const ok = identificar(txt('hola'), 'a.txt');
  assert.equal(validar(ok, 4), null);
  assert.match(validar(ok, LIMITES.tamanoMax + 1), /demasiado grande/);
  assert.match(validar(ok, 0), /vacío/);
});

test('nombres peligrosos saneados (path traversal, control, unicode)', () => {
  assert.equal(sanearNombre('../../etc/passwd'), 'passwd');
  assert.equal(sanearNombre('C:\\Users\\x\\Ventas Octubre.xlsx'), 'Ventas Octubre.xlsx');
  assert.equal(sanearNombre('..\u0000evil..csv'), 'evil.csv');
  assert.equal(sanearNombre('Presupuesto año 2026 (final).xlsx'), 'Presupuesto ano 2026 _final.xlsx');
  assert.equal(sanearNombre('.htaccess'), 'htaccess');
  assert.match(sanearNombre('x'.repeat(400) + '.pdf'), /^x{170}\.pdf$/);
  for (const n of ['../../etc/passwd', '.htaccess', '...', 'ñ.csv']) assert.match(sanearNombre(n), /^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$/);
});

test('credenciales pegadas en el chat se detectan', () => {
  assert.equal(pareceSecreto('mi token: abcd1234efgh5678ijkl'), true);
  assert.equal(pareceSecreto('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmn'), true);
  assert.equal(pareceSecreto('sk-ant-api03abcdefghijklmnop'), true);
  assert.equal(pareceSecreto('conectá la API de cotizaciones https://api.bluelytics.com.ar/v2/latest'), false);
});

const filas = [
  ['Reporte de ventas', null, null],
  ['Fecha', 'Cliente', 'Importe'],
  ['01/10/2026', 'ACME', '1.500,50'],
  ['2026-10-02', 'Beta', 200],
  ['03/10/2026', 'Gamma', ''],
  ['fecha mal', 'Delta', 10],
  ['03/10/2026', 'Gamma', ''],
];

test('perfil: encabezado, tipos, formatos, nulos, duplicados y fecha', () => {
  const p = perfilar(filas);
  assert.equal(p.encabezado, 1);
  assert.deepEqual(p.columnas.map((c) => [c.nombre, c.tipo]), [['Fecha', 'date'], ['Cliente', 'text'], ['Importe', 'number']]);
  assert.equal(p.columnas[2].formato, 'es-AR (1.234,56)');
  assert.equal(p.duplicadas, 1);
  assert.equal(p.columnaFecha, 'fecha');
  assert.equal(aFecha(46000), '2025-12-09');
  assert.equal(aFecha('31/02/2026'), null);
});

test('mapeo inteligente: Fecha|Cliente|Importe → transaction_date|customer|amount', () => {
  const p = perfilar(filas);
  const m = mapear(p.columnas, [{ key: 'transaction_date', label: 'transaction_date', type: 'date' }, { key: 'customer', label: 'customer', type: 'text' }, { key: 'amount', label: 'amount', type: 'number' }]);
  assert.deepEqual(m.asignaciones.map((a) => [a.columna, a.campo]), [['Fecha', 'transaction_date'], ['Cliente', 'customer'], ['Importe', 'amount']]);
  assert.equal(m.inequivoco, true);
});

test('mapeo ambiguo: pregunta solo la decisión necesaria', () => {
  const cols = [{ nombre: 'Total', key: 'total', tipo: 'number' }, { nombre: 'Importe', key: 'importe', tipo: 'number' }];
  const m = mapear(cols, [{ key: 'monto', label: 'Monto', type: 'number' }]);
  assert.equal(m.inequivoco, false);
  assert.match(m.pregunta, /¿Qué columna uso para "Monto": "Total" o "Importe"\?/);
});

test('conversión fila por fila: válidas se importan, inválidas a revisión con motivo', () => {
  const p = perfilar(filas);
  const campos = [{ key: 'cliente', label: 'Cliente', type: 'text' }, { key: 'importe', label: 'Importe', type: 'number' }];
  const m = mapear(p.columnas, campos);
  const r = convertir(p, m.asignaciones, campos, { hoy: '2026-10-29' });
  assert.deepEqual(r.validas.map((v) => [v.fila, v.period, v.data.importe]), [[3, '2026-10-01', 1500.5], [4, '2026-10-02', 200]]);
  assert.deepEqual(r.rechazadas, [{ fila: 5, motivo: 'Importe vacío' }, { fila: 6, motivo: 'fecha inválida ("fecha mal")' }, { fila: 7, motivo: 'Importe vacío' }]);
  assert.deepEqual(camposDesdeColumnas(p.columnas, ['fecha']).map((c) => c.type), ['text', 'number']);
});

test('estrategia según intención; REPLACE nunca por inferencia débil', () => {
  assert.equal(inferirEstrategia('Sumá las ventas de octubre').estrategia, 'APPEND');
  assert.deepEqual(inferirEstrategia('Actualizá estos clientes', { claves: ['cuit'] }), { estrategia: 'UPSERT', clave: 'cuit', motivo: 'actualizo por "cuit" sin duplicar' });
  assert.equal(inferirEstrategia('Actualizá estos clientes').estrategia, 'APPEND');
  assert.equal(inferirEstrategia('Reemplazá el presupuesto').estrategia, 'REPLACE');
  assert.equal(inferirEstrategia('usá este nuevo presupuesto').estrategia, 'APPEND');
  assert.equal(inferirEstrategia('probá con esta planilla').estrategia, 'TEMPORARY');
});

test('documentos: fragmentos con referencia y recuperación de lo relevante', () => {
  const frag = fragmentar([{ texto: 'Introducción general del informe anual. '.repeat(20), ref: { pagina: 1 } },
    { texto: 'Las ventas mayoristas crecieron 14% en octubre gracias a nuevos distribuidores.', ref: { pagina: 7 } }], 300);
  assert.ok(frag.length > 2);
  const r = recuperar(frag, '¿Cuánto crecieron las ventas mayoristas?', 2);
  assert.equal(r[0].ref.pagina, 7);
  assert.equal(refTexto(r[0].ref), 'página 7');
  assert.ok(resumir(frag).temas.length);
});

test('anti-SSRF: solo HTTPS público', () => {
  assert.equal(validarUrl('https://api.bluelytics.com.ar/v2/latest').ok, true);
  for (const u of ['http://api.x.com', 'https://localhost/a', 'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://10.0.0.5/',
    'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://user:pass@api.x.com/', 'https://api.x.com:8443/',
    'https://metadata.google.internal/', 'https://intranet/', 'https://srv.corp/', 'file:///etc/passwd', 'ftp://x.com']) {
    assert.equal(validarUrl(u).ok, false, u);
  }
  assert.equal(ipPrivada('8.8.8.8'), false);
  assert.equal(ipPrivada('2001:4860:4860::8888'), false);
  assert.equal(ipPrivada('fd00::1'), true);
  assert.equal(ipPrivada('100.64.0.1'), true);
});

test('detección de la tabla en respuestas de API', () => {
  assert.deepEqual(detectarTabla({ data: { items: [{ fecha: '2026-10-01', valor: { compra: 1 } }, { fecha: '2026-10-02', valor: { compra: 2 } }] } }).filas[1],
    { fecha: '2026-10-02', 'valor.compra': 2 });
  assert.deepEqual(detectarTabla({ base: 'USD', rates: { ARS: 1450.5, EUR: 0.92, BRL: 5.4 } }).filas[0], { clave: 'ARS', valor: 1450.5 });
  assert.deepEqual(aMatriz([{ a: 1, b: 2 }, { a: 3 }]), [['a', 'b'], [1, 2], [3, null]]);
});
