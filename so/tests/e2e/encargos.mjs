// Recorrido de Encargos a Claude en Chromium contra el Supabase simulado: sin vínculo propone vincular; vincular (la
// clave no vuelve a la página); un pedido con Drive se deriva por detrás, "Claude" (window.__claude) lee el encargo con
// la clave de un solo uso y entrega; el resultado aparece solo en la conversación. También: falla informada y
// aislamiento entre usuarios. La lógica del servidor se prueba aparte (tests/encargos.test.mjs). Uso: npm run test:so:encargos
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { crearServidor } from './servidor.mjs';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(dir, '../../..');
const { srv, BASE } = crearServidor({ puerto: 8797, root, dir });
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errores = []; pg.on('pageerror', (e) => errores.push(e.message)); pg.on('dialog', (d) => d.accept());
await pg.route('https://cdn.openart.ai/**', (r) => r.fulfill({ status: 404 }));
const fallos = []; const ok = (c, m) => { if (!c) fallos.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const listo = () => pg.waitForFunction(() => !document.getElementById('enviar').disabled, null, { timeout: 30000 }).then(() => pg.waitForTimeout(400));
const ultimo = () => pg.$eval('#mensajes .msg.assistant:last-of-type', (n) => n.textContent.replace(/\s+/g, ' ').trim());
const decir = async (t) => { if (!(await pg.isVisible('#texto'))) { await pg.click('#orb'); await pg.waitForSelector('#texto', { state: 'visible' }); } await pg.fill('#texto', t); await pg.press('#texto', 'Enter'); await listo(); return ultimo(); };
const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire';
const TOKEN = 'sk-ant-oat01-' + 'k'.repeat(40);

await pg.goto(BASE + '/404.html'); await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('fake.db', JSON.stringify({ __seq: 1, perfiles: [{ id: '00000000-0000-0000-0000-00000000000a', owner_id: '00000000-0000-0000-0000-00000000000a', nombre: 'Ana Prueba' }] })); });
await pg.goto(BASE + '/so/'); await pg.waitForSelector('#app:not([hidden])');

let r = await decir('Traé la planilla de Drive de ventas de octubre');
ok(/Vincular Claude/.test(r) && !(await pg.evaluate(() => window.__claude.disparos.length)), 'Sin vínculo: propone vincular y no dispara nada');

await pg.click('#vincularClaude'); await pg.waitForSelector('#formClaude input[name="url"]');
const prompt = await pg.inputValue('#promptClaude');
ok(/\/functions\/v1\/so-encargos\?encargo=/.test(prompt) && /Solo LEÉ/.test(prompt), 'Vincular: muestra la instrucción para la tarea con la URL de Francisco');
await pg.fill('#formClaude input[name="url"]', 'https://otro.com/fire'); await pg.fill('#formClaude input[name="token"]', TOKEN); await pg.click('#formClaude button[type="submit"]');
await pg.waitForSelector('#errorClaude:not([hidden])'); ok(/disparador de Claude/.test(await pg.textContent('#errorClaude')), 'Vincular: rechaza una URL que no es de Claude');
await pg.fill('#formClaude input[name="url"]', URL_OK); await pg.click('#formClaude button[type="submit"]');
await pg.waitForFunction(() => !document.getElementById('hoja').open, null, { timeout: 5000 });
const html = await pg.content();
ok(/ya puede usar tus conectores/.test(await pg.textContent('#toast')) && !html.includes(TOKEN), 'Vincular: queda vinculada y la clave no vuelve a la página');

r = await decir('Traé la planilla de Drive de ventas de octubre');
const d = await pg.evaluate(() => window.__claude.disparos);
ok(d.length === 1 && d[0].url === URL_OK && Object.keys(d[0].payload).sort().join() === 'encargo,token', 'Pedido con Drive: dispara la tarea solo con número y clave');
ok(/se lo pasé con el contexto/.test(r) && /Trabajando con Claude/.test(r), 'Chat: avisa que está trabajando con Claude, sin abrir nada');
const leido = await pg.evaluate(([e, t]) => window.__claude.leer(e, t), [d[0].payload.encargo, d[0].payload.token]);
ok(leido.status === 200 && /planilla de Drive/.test(leido.body.pedido) && leido.body.contexto.usuario.nombre === 'Ana Prueba' && leido.body.contexto.conversacion.length >= 2, 'Claude lee el encargo con el contexto preparado (nombre y conversación)');
const ent = await pg.evaluate(([e, t]) => window.__claude.entregar({ accion: 'entregar', encargo: e, token: t, resultado: { texto: 'En octubre vendiste 1.250 unidades según la planilla "Ventas 2026" de Drive.', ui: [{ type: 'Metric', props: { label: 'Unidades octubre', valor: 1250 } }, { type: 'Script', props: {} }], fuentes: ['Drive: Ventas 2026'] } }), [d[0].payload.encargo, d[0].payload.token]);
ok(ent.status === 200, 'Claude entrega el resultado');
await pg.waitForFunction(() => /1\.250 unidades/.test(document.getElementById('mensajes').textContent), null, { timeout: 20000 });
ok(await pg.isVisible('#mensajes .gu') && !/Script/.test(await pg.textContent('#mensajes')), 'El resultado aparece solo en la conversación, con la UI validada');
ok(!/Trabajando con Claude/.test(await pg.textContent('#mensajes')), 'El aviso "Trabajando con Claude" pasa a Hecho');
const dos = await pg.evaluate(([e, t]) => window.__claude.entregar({ accion: 'entregar', encargo: e, token: t, resultado: { texto: 'otra' } }), [d[0].payload.encargo, d[0].payload.token]);
ok(dos.status === 404, 'La clave del encargo no sirve dos veces');

await decir('Qué reuniones tengo esta semana en el calendario');
const d2 = (await pg.evaluate(() => window.__claude.disparos))[1];
await pg.evaluate(([e, t]) => window.__claude.entregar({ accion: 'fallar', encargo: e, token: t, motivo: 'No tengo el conector de Google Calendar en la tarea' }), [d2.payload.encargo, d2.payload.token]);
await pg.waitForFunction(() => /no pudo completar el encargo/.test(document.getElementById('mensajes').textContent), null, { timeout: 20000 });
ok(true, 'Falla informada: aparece en la conversación con el motivo');

const otro = await pg.evaluate(async () => { localStorage.setItem('fake.user', 'b'); const c = window.supabase.createClient(); const [e, v] = await Promise.all([c.from('so_encargos').select('*'), c.from('so_claude_vinculos').select('*')]); localStorage.setItem('fake.user', 'a'); return [e.data.length, v.data.length]; });
ok(otro[0] === 0 && otro[1] === 0, 'Seguridad: otro usuario no ve los encargos ni el vínculo');
console.log('ERRORES', JSON.stringify(errores)); console.log(`FALLOS ${fallos.length}`); fallos.forEach((f) => console.log('  - ' + f));
await b.close(); srv.close(); process.exitCode = fallos.length || errores.length ? 1 : 0;
