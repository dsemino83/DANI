// Doble control y envío único al banco, con el motor de pagos (OWASP API5 + integridad del dinero).
// Autorizar NO envía: deja la transferencia EN_COLA; el motor la envía UNA sola vez, aunque se autorice
// varias veces o en paralelo; lo rechazado nunca se envía; nadie autoriza lo que cargó. Sale != 0 si falla.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const AQUI = dirname(fileURLToPath(import.meta.url));
const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = `http://127.0.0.1:${process.env.PORT ?? 18090}/api`;
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 18080}`;
const j = async (t, m, r, b) => {
  const x = await fetch(API + r, { method: m, headers: { authorization: `Bearer ${T[t]}`, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: x.status, b: await x.json().catch(() => null) };
};
const enviosAlBanco = async () => (await (await fetch(`${MOCK}/__llamadas`)).json()).filter((l) => l.ruta === '/bdv/transfers/immediates').length;
const motor = () => execSync(`node ${join(AQUI, 'motor.mjs')}`, { stdio: 'pipe', env: { ...process.env, DB_USER: 'hb_jobs', DB_PASSWORD: 'jobspass' } }); // una pasada del motor de pagos, con el rol del servicio jobs (mínimo privilegio)
const estadoDe = async (quien, id) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await j(quien, 'GET', `/transferencias?desde=${hoy}&hasta=${hoy}`);
  return (r.b?.transferencias ?? []).find((t) => t.id === id)?.estado;
};
let fallas = 0;
const ok = (c, m, x = '') => { if (!c) fallas++; console.log(c ? 'OK  ' : 'FAIL', m, c ? '' : JSON.stringify(x).slice(0, 220)); };
const CUENTA = '300100000000000';
const cargar = async (quien, ref) => (await j(quien, 'POST', '/transferencias', { referencia: ref, tipo: 'INMEDIATA', cuentaOrigen: CUENTA, destino: 'PAGOS.PROVEEDOR', importe: 10, concepto: 'VARIOS' })).b?.id;

// ---- Preparación: empresa, cuenta, cargador (mgomez), aprobador (lrodriguez) y cfunes (crea y aprueba).
await j('admin', 'PUT', '/admin/credenciales/homo', { usuario: 'valo_api', identification: '20000000001', terminal: 'SRV', clave: 'clave-api-valo', rsaPublicKey: T.llaveBanco });
const e = (await j('admin', 'POST', '/admin/empresas', { razonSocial: 'Operativa SA', cuit: '30700000050', emails: ['op@operativa.test'] })).b;
await j('admin', 'POST', `/admin/empresas/${e.id}/cuentas`, { cuentas: [CUENTA] });
await j('admin', 'PUT', '/admin/permisos/mgomez', { permisos: [{ empresaId: e.id, ver: true, operar: true }] });
await j('admin', 'PUT', '/admin/permisos/lrodriguez', { permisos: [{ empresaId: e.id, ver: true }] });
await j('admin', 'PUT', '/admin/permisos/cfunes', { permisos: [{ empresaId: e.id, ver: true, operar: true }] });

// ---- Doble control: el que carga no autoriza lo suyo, ni con el rol de aprobar.
let id = await cargar('ambos', 'DC-1'); // cfunes tiene crear Y aprobar
let r = await j('ambos', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 403 && /cargaste vos/i.test(r.b?.mensaje ?? ''), 'doble control: no se autoriza lo que uno cargó', r.b);

// ---- Autorizar encola; todavía no se envió al banco.
let antes = await enviosAlBanco();
r = await j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 200 && r.b.estado === 'EN_COLA', 'autorizar deja la transferencia EN_COLA', r.b);
ok((await enviosAlBanco()) === antes, 'al autorizar no se envía nada al banco todavía');
// ---- El motor la envía (una sola vez) y queda DEBITADA.
motor();
ok((await enviosAlBanco()) === antes + 1, 'el motor la envía al banco una vez');
ok((await estadoDe('lrodriguez', id)) === 'DEBITADA', 'queda DEBITADA tras el motor', await estadoDe('lrodriguez', id));

// ---- Reautorizar algo ya autorizado → 409 "ya fue autorizada".
r = await j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 409 && /ya fue autorizada/i.test(r.b?.mensaje ?? ''), 'reautorizar → 409 ya fue autorizada', r.b);

// ---- Concurrencia: 10 autorizaciones simultáneas de la misma → una sola entra; el banco la recibe una vez.
id = await cargar('mgomez', 'DC-2');
const rs = await Promise.all(Array.from({ length: 10 }, () => j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`)));
const enCola = rs.filter((x) => x.s === 200).length, rechazadas = rs.filter((x) => x.s === 409).length;
ok(enCola === 1 && rechazadas === 9, `10 autorizaciones simultáneas: 1 entra, 9 rechazadas (fueron ${enCola}/${rechazadas})`, rs.map((x) => x.s).sort());
ok(rs.some((x) => x.s === 409 && /ya fue autorizada/i.test(x.b?.mensaje ?? '')), 'las que llegan tarde ven "ya fue autorizada"');
// La cola de pagos la muestra antes de que el motor la envíe.
r = await j('lrodriguez', 'GET', '/pagos/cola');
ok(r.s === 200 && r.b.enCola.some((t) => t.id === id) && Object.values(r.b.porEndpoint).some((p) => p.enCola >= 1), 'la operación aparece en la cola de pagos por su endpoint', r.b?.porEndpoint);
antes = await enviosAlBanco();
motor();
ok((await enviosAlBanco()) === antes + 1, 'la operación llegó al banco una sola vez pese a las 10 autorizaciones');

// ---- Lo rechazado nunca se envía.
id = await cargar('mgomez', 'DC-3');
antes = await enviosAlBanco();
r = await j('lrodriguez', 'POST', `/transferencias/${id}/rechazar`);
ok(r.s === 200 && r.b.estado === 'RECHAZADA', 'rechazar: queda rechazada', r.b);
motor();
ok((await enviosAlBanco()) === antes, 'una operación rechazada no llega al banco ni pasa por el motor');
r = await j('lrodriguez', 'POST', `/transferencias/${id}/aprobar`);
ok(r.s === 409, 'no se puede autorizar algo ya rechazado → 409', r.b);

console.log(fallas ? `\n${fallas} FALLAS` : '\nTODO OK');
process.exit(fallas ? 1 : 0);
