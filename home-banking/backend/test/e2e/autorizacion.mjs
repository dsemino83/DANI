// Autorización de punta a punta contra el servidor real (OWASP API1 BOLA + API5 función).
// El banco entrega TODAS las cuentas de VALO con una sola credencial, así que el backend tiene que
// filtrar y validar en CADA endpoint: la pantalla no alcanza. Sale con código 1 si algo falla.
import { readFileSync } from 'node:fs';
const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = `http://127.0.0.1:${process.env.PORT ?? 18090}/api`;
const j = async (t, m, r, b) => {
  const x = await fetch(API + r, { method: m, headers: { authorization: `Bearer ${T[t]}`, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: x.status, b: await x.json().catch(() => null) };
};
let fallas = 0;
const ok = (c, m, x = '') => { if (!c) fallas++; console.log(c ? 'OK  ' : 'FAIL', m, c ? '' : JSON.stringify(x).slice(0, 220)); };

const PROPIA = '300100000000000'; // cuenta de la empresa del operador
const AJENA = '400200000000000';  // cuenta de OTRA empresa (existe en el banco, sin permiso)

// ---- Preparación (como administrador de seguridad): credencial, dos empresas, permiso solo sobre la propia.
await j('admin', 'PUT', '/admin/credenciales/homo', { usuario: 'valo_api', identification: '20000000001', terminal: 'SRV', clave: 'clave-api-valo', rsaPublicKey: T.llaveBanco });
const a = (await j('admin', 'POST', '/admin/empresas', { razonSocial: 'Propia SA', cuit: '30700000001', emails: ['a@propia.test'] })).b;
const b = (await j('admin', 'POST', '/admin/empresas', { razonSocial: 'Ajena SA', cuit: '30700000002', emails: ['b@ajena.test'] })).b;
await j('admin', 'POST', `/admin/empresas/${a.id}/cuentas`, { cuentas: [PROPIA] });
await j('admin', 'POST', `/admin/empresas/${b.id}/cuentas`, { cuentas: [AJENA] });
await j('admin', 'PUT', '/admin/permisos/mgomez', { permisos: [{ empresaId: a.id, ver: true, operar: true }] });

// ---- API5: función. El operador no llega a ninguna función de administración ni de autorización.
let r = await j('mgomez', 'GET', '/admin/empresas');
ok(r.s === 403, 'operador: 403 al listar empresas (admin)', r);
r = await j('mgomez', 'POST', '/admin/empresas', { razonSocial: 'X', cuit: '30700000009', emails: ['x@x.test'] });
ok(r.s === 403, 'operador: 403 al crear empresa (admin)', r);
r = await j('mgomez', 'PUT', '/admin/permisos/mgomez', { permisos: [{ empresaId: b.id, ver: true, operar: true }] });
ok(r.s === 403, 'operador: 403 al cambiar permisos (no puede auto-habilitarse sobre la ajena)', r);
r = await j('mgomez', 'GET', '/envios');
ok(r.s === 403, 'operador: 403 en envíos programados (función del autorizante)', r);
r = await j('mgomez', 'GET', '/sistema/estado');
ok(r.s === 403, 'operador: 403 en el panel de estado del sistema (solo administrador)', r);
r = await j('admin', 'GET', '/sistema/estado');
ok(r.s === 200 && r.b?.backend?.ok === true, 'administrador: ve el panel de estado del sistema', r.b);
r = await j('admin', 'GET', '/pagos/cola');
ok(r.s === 403, 'administrador: 403 en la cola de pagos (es de perfiles operativos)', r);
r = await j('mgomez', 'GET', '/pagos/cola');
ok(r.s === 200 && Array.isArray(r.b?.enCola), 'operador: ve la cola de pagos', r.b);
r = await j('auditor', 'POST', '/transferencias', { referencia: 'AUD-1', tipo: 'INMEDIATA', cuentaOrigen: PROPIA, destino: 'A.B', importe: 1, concepto: 'VARIOS' });
ok(r.s === 403, 'auditor: 403 al cargar transferencia (es de solo lectura)', r);

// ---- API1: BOLA. El operador con permiso solo sobre la propia no toca la ajena por su número.
r = await j('mgomez', 'GET', '/cuentas');
ok(r.s === 200 && r.b.length === 1 && r.b[0].cuenta === PROPIA, 'listado: solo la cuenta propia, no la ajena', r.b?.map?.((c) => c.cuenta));
r = await j('mgomez', 'GET', `/cuentas?empresa=${b.id}`);
ok(r.s === 200 && !(r.b ?? []).some((c) => c.cuenta === AJENA), 'no se puede pivotar por ?empresa al id ajeno', r.b);
r = await j('mgomez', 'GET', `/cuentas/${AJENA}/movimientos`);            ok(r.s === 403, 'movimientos de cuenta ajena → 403', r);
r = await j('mgomez', 'GET', `/cuentas/${AJENA}/detalle`);                ok(r.s === 403, 'detalle de cuenta ajena → 403', r);
r = await j('mgomez', 'GET', `/cuentas/${AJENA}/constancia`);             ok(r.s === 403, 'constancia de cuenta ajena → 403', r);
r = await j('mgomez', 'GET', `/cuentas/${AJENA}/movimientos?formato=xlsx`); ok(r.s === 403, 'export Excel de cuenta ajena → 403', r);
r = await j('mgomez', 'POST', '/transferencias', { referencia: 'BOLA-1', tipo: 'INMEDIATA', cuentaOrigen: AJENA, destino: 'PAGOS.PROVEEDOR', importe: 1, concepto: 'VARIOS' });
ok(r.s === 403, 'transferir DESDE una cuenta ajena → 403', r);
r = await j('mgomez', 'GET', `/cuentas/${PROPIA}/movimientos`);
ok(r.s === 200, 'control positivo: la cuenta propia sí responde', r.s);

// ---- IDOR a nivel de operación: una transferencia de la empresa ajena, por su id, no se ve ni se aprueba
//      desde otra empresa (OWASP API1). La crea un operador de la empresa B; el atacante solo tiene la A.
await j('admin', 'PUT', '/admin/permisos/operadorb', { permisos: [{ empresaId: b.id, ver: true, operar: true }] });
await j('admin', 'PUT', '/admin/permisos/lrodriguez', { permisos: [{ empresaId: a.id, ver: true }] }); // aprobador solo en la propia
r = await j('operadorB', 'POST', '/transferencias', { referencia: 'IDOR-1', tipo: 'INMEDIATA', cuentaOrigen: AJENA, destino: 'PAGOS.PROVEEDOR', importe: 7, concepto: 'VARIOS' });
ok(r.s === 201, 'preparación: el operador de B carga una transferencia en B', r.b);
const opB = r.b?.id;
// mgomez (solo empresa A) intenta alcanzar la operación de B por su id.
r = await j('mgomez', 'GET', `/transferencias/${opB}/auditoria`);
ok(r.s === 403, 'IDOR: auditoría de una operación ajena por id → 403', r);
const hoy = new Date().toISOString().slice(0, 10);
r = await j('mgomez', 'GET', `/transferencias?desde=${hoy}&hasta=${hoy}`);
ok(r.s === 200 && !(r.b?.transferencias ?? []).some((t) => t.id === opB), 'el listado no incluye la operación ajena', r.b);
// El aprobador sin permiso sobre B no puede aprobar ni rechazar la operación de B.
r = await j('lrodriguez', 'POST', `/transferencias/${opB}/aprobar`);
ok(r.s === 403, 'IDOR: aprobar una operación ajena por id → 403', r);
r = await j('lrodriguez', 'POST', `/transferencias/${opB}/rechazar`);
ok(r.s === 403, 'IDOR: rechazar una operación ajena por id → 403', r);
// Control positivo: el operador de B sí ve la auditoría de su propia operación.
r = await j('operadorB', 'GET', `/transferencias/${opB}/auditoria`);
ok(r.s === 200 && r.b?.transferencia?.referencia === 'IDOR-1', 'control: el dueño sí ve su operación', r.s);

// ---- Ver ≠ Operar: con permiso de solo lectura puede consultar pero no operar.
await j('admin', 'PUT', '/admin/permisos/mgomez', { permisos: [{ empresaId: a.id, ver: true, operar: false }] });
r = await j('mgomez', 'GET', `/cuentas/${PROPIA}/movimientos`);
ok(r.s === 200, 'solo-ver: consultar sigue permitido', r.s);
r = await j('mgomez', 'POST', '/transferencias', { referencia: 'BOLA-2', tipo: 'INMEDIATA', cuentaOrigen: PROPIA, destino: 'PAGOS.PROVEEDOR', importe: 1, concepto: 'VARIOS' });
ok(r.s === 403 && /operar/i.test(r.b?.mensaje ?? ''), 'solo-ver: transferir → 403 (no podés operar)', r.b);

// ---- Interruptor de la credencial API: solo el administrador; desactivada corta el acceso al banco; reactivada vuelve.
r = await j('mgomez', 'PUT', '/admin/credenciales/homo/estado', { activa: false });
ok(r.s === 403, 'operador: 403 al desactivar la credencial (admin)', r);
r = await j('admin', 'PUT', '/admin/credenciales/homo/estado', { activa: 'no' });
ok(r.s === 400, 'admin: estado inválido → 400', r);
r = await j('admin', 'PUT', '/admin/credenciales/homo/estado?uso=envios', { activa: false });
ok(r.s === 404, 'admin: desactivar una credencial no cargada → 404', r);
r = await j('admin', 'PUT', '/admin/credenciales/homo/estado', { activa: false });
ok(r.s === 200 && r.b?.activa === false, 'admin: desactiva la credencial', r.b);
r = await j('admin', 'GET', '/admin/credenciales/homo');
ok(r.b?.activa === false && r.b?.configurada === true && !JSON.stringify(r.b).includes('clave-api-valo'), 'la credencial figura desactivada y no devuelve la clave', r.b);
r = await j('admin', 'POST', '/admin/credenciales/homo/probar');
ok(r.b?.ok === false && /desactivada/i.test(r.b?.error ?? ''), 'desactivada: probar conexión falla sin llamar al banco', r.b);
r = await j('mgomez', 'GET', `/cuentas/${PROPIA}/detalle`);
ok(r.s === 502 && r.b?.codigo === 'CREDENCIAL_DESACTIVADA', 'desactivada: el Home Banking no accede al banco (502 CREDENCIAL_DESACTIVADA)', r);
r = await j('admin', 'PUT', '/admin/credenciales/homo/estado', { activa: true });
ok(r.s === 200 && r.b?.activa === true, 'admin: reactiva la credencial (sin volver a cargar la clave)', r.b);
r = await j('admin', 'POST', '/admin/credenciales/homo/probar');
ok(r.b?.ok === true, 'reactivada: el acceso al banco vuelve (probar conexión OK)', r.b);
r = await j('mgomez', 'GET', `/cuentas/${PROPIA}/movimientos`);
ok(r.s === 200, 'reactivada: el Home Banking vuelve a consultar al banco', r);

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
