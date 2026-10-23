// Doble control y envío único al banco (OWASP API5 + integridad del dinero). Contra el servidor real
// con el mock del banco: nadie aprueba lo que cargó, una operación va al banco UNA sola vez aunque se
// apruebe varias veces o en paralelo, y lo rechazado nunca se envía. Sale != 0 si algo falla.
import { readFileSync } from 'node:fs';
const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = `http://127.0.0.1:${process.env.PORT ?? 18090}/api`;
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 18080}`;
const j = async (t, m, r, b) => {
  const x = await fetch(API + r, { method: m, headers: { authorization: `Bearer ${T[t]}`, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: x.status, b: await x.json().catch(() => null) };
};
// Cuántas veces el backend llamó a la API de transferencia inmediata del banco.
const enviosAlBanco = async () => (await (await fetch(`${MOCK}/__llamadas`)).json()).filter((l) => l.ruta === '/bdv/transfers/immediates').length;
let fallas = 0;
const ok = (c, m, x = '') => { if (!c) fallas++; console.log(c ? 'OK  ' : 'FAIL', m, c ? '' : JSON.stringify(x).slice(0, 220)); };
const CUENTA = '300100000000000';
const cargar = async (quien, ref) => (await j(quien, 'POST', '/transferencias', { referencia: ref, tipo: 'INMEDIATA', cuentaOrigen: CUENTA, destino: 'PAGOS.PROVEEDOR', importe: 10, concepto: 'VARIOS' })).b?.id;

// ---- Preparación: una empresa, una cuenta, un cargador (mgomez) y un aprobador (lrodriguez).
await j('admin', 'PUT', '/admin/credenciales/homo', { usuario: 'valo_api', identification: '20000000001', terminal: 'SRV', clave: 'clave-api-valo', rsaPublicKey: T.llaveBanco });
const e = (await j('admin', 'POST', '/admin/empresas', { razonSocial: 'Operativa SA', cuit: '30700000050', emails: ['op@operativa.test'] })).b;
await j('admin', 'POST', `/admin/empresas/${e.id}/cuentas`, { cuentas: [CUENTA] });
await j('admin', 'PUT', '/admin/permisos/mgomez', { permisos: [{ empresaId: e.id, ver: true, operar: true }] });
await j('admin', 'PUT', '/admin/permisos/lrodriguez', { permisos: [{ empresaId: e.id, ver: true }] });
await j('admin', 'PUT', '/admin/permisos/cfunes', { permisos: [{ empresaId: e.id, ver: true, operar: true }] });

// ---- Doble control: el que carga no puede aprobar lo suyo, ni siquiera con el rol de aprobar.
let id = await cargar('ambos', 'DC-1'); // cfunes tiene crear Y aprobar
let r = await j('ambos', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 403 && /cargaste vos/i.test(r.b?.mensaje ?? ''), 'doble control: no se aprueba lo que uno cargó', r.b);
r = await j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 200 && r.b.estado === 'DEBITADA', 'otro usuario sí la aprueba y se envía al banco', r.b);

// ---- Envío único: reaprobar una operación ya enviada no la manda de nuevo.
let antes = await enviosAlBanco();
r = await j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 409, 'reaprobar una operación ya procesada → 409', r.b);
ok((await enviosAlBanco()) === antes, 'reaprobar no genera un segundo envío al banco');

// ---- Concurrencia: 10 aprobaciones simultáneas → un solo envío al banco.
id = await cargar('mgomez', 'DC-2');
antes = await enviosAlBanco();
const rs = await Promise.all(Array.from({ length: 10 }, () => j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`)));
const exitos = rs.filter((x) => x.s === 200).length;
ok(exitos === 1, `10 aprobaciones simultáneas: exactamente una aprobó (fueron ${exitos})`, rs.map((x) => x.s).sort());
ok((await enviosAlBanco()) === antes + 1, 'la operación llegó al banco una sola vez');

// ---- Lo rechazado nunca se envía.
id = await cargar('mgomez', 'DC-3');
antes = await enviosAlBanco();
r = await j('lrodriguez', 'POST', `/transferencias/${id}/rechazar`);
ok(r.s === 200 && r.b.estado === 'RECHAZADA', 'rechazar: queda rechazada', r.b);
ok((await enviosAlBanco()) === antes, 'una operación rechazada no llega al banco');
r = await j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 409, 'no se puede aprobar algo ya rechazado → 409', r.b);

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
