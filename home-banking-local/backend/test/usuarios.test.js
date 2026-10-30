// Usuarios propios: hash de claves, OTP (TOTP) y tokens de sesión. No necesita base ni banco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.DB_PASSWORD = 'x';
process.env.DBH_PASSWORD = 'x';
process.env.CREDENCIALES_MASTER_KEY = randomBytes(32).toString('base64');

const { hashClave, verificarClave, validarClaveTemporal, validarAlta, base32, codigoTotp, verificarTotp } = await import('../src/usuarios.js');
const { emitirToken, leerToken } = await import('../src/auth.js');

test('clave: el hash verifica la clave correcta y rechaza las demás', async () => {
  const h = await hashClave('ClaveSegura2026');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verificarClave('ClaveSegura2026', h), true);
  assert.equal(await verificarClave('ClaveSegura2027', h), false);
  assert.equal(await verificarClave('', h), false);
  assert.notEqual(await hashClave('ClaveSegura2026'), h, 'cada hash lleva su propia sal');
  assert.equal(await verificarClave('x', 'no-es-un-hash'), false);
});

test('clave: política mínima (12+, letras y números)', () => {
  assert.throws(() => validarClaveTemporal('corta1'));
  assert.throws(() => validarClaveTemporal('sinnumerosnunca'));
  assert.throws(() => validarClaveTemporal('123456789012345'));
  assert.equal(validarClaveTemporal('Valida1234567'), 'Valida1234567');
});

test('alta: valida usuario, email, nombre y perfil', () => {
  const ok = { usuario: 'MGomez', email: 'mgomez@valo.ar', nombre: 'María', apellido: 'Gómez', perfil: 'operador', claveTemporal: 'Temporal12345' };
  assert.equal(validarAlta(ok).usuario, 'mgomez');
  assert.throws(() => validarAlta({ ...ok, usuario: 'a' }));
  assert.throws(() => validarAlta({ ...ok, email: 'sin-arroba' }));
  assert.throws(() => validarAlta({ ...ok, perfil: 'superusuario' }));
  assert.throws(() => validarAlta({ ...ok, apellido: '' }));
});

test('OTP: vectores del RFC 6238 (SHA-1) y base32 del RFC 4648', () => {
  const secreto = Buffer.from('12345678901234567890');
  assert.equal(codigoTotp(secreto, Math.floor(59 / 30)), '287082');
  assert.equal(codigoTotp(secreto, Math.floor(1111111109 / 30)), '081804');
  assert.equal(codigoTotp(secreto, Math.floor(2000000000 / 30)), '279037');
  assert.equal(base32(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(base32(secreto), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('OTP: acepta ±30 s y no acepta el mismo código dos veces', () => {
  const secreto = randomBytes(20);
  const ahora = 1_800_000_000_000;
  const paso = Math.floor(ahora / 30_000);
  assert.equal(verificarTotp(secreto, codigoTotp(secreto, paso), null, ahora), paso);
  assert.equal(verificarTotp(secreto, codigoTotp(secreto, paso - 1), null, ahora), paso - 1);
  assert.equal(verificarTotp(secreto, codigoTotp(secreto, paso - 3), null, ahora), null, 'código viejo');
  assert.equal(verificarTotp(secreto, codigoTotp(secreto, paso), paso, ahora), null, 'código ya usado');
  assert.equal(verificarTotp(secreto, 'abc123', null, ahora), null);
});

test('sesión: el token lleva usuario y versión, y no se acepta alterado', async () => {
  const t = await emitirToken('mgomez', 7);
  const p = await leerToken(t);
  assert.equal(p.sub, 'mgomez');
  assert.equal(p.ver, 7);
  const [cab, cuerpo, firma] = t.split('.');
  const otro = Buffer.from(JSON.stringify({ ...p, sub: 'admin' })).toString('base64url');
  await assert.rejects(() => leerToken(`${cab}.${otro}.${firma}`));
  await assert.rejects(() => leerToken(`${cab}.${cuerpo}.${firma.slice(0, -2)}xx`));
});
