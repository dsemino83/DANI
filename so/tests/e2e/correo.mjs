// Recorrido de Correo (Gmail) en Chromium contra el Supabase simulado: conectar (OAuth simulado), sincronizar, análisis,
// solo lectura (sin respuestas ni borradores), pedidos por chat, aislamiento entre usuarios y desconexión. La lógica de Gmail se
// prueba aparte (tests/correo.test.mjs) y la función real se verifica desplegada. Uso: npm run test:so:correo
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { crearServidor } from './servidor.mjs';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const dir = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(dir, '../../..');
const { srv, BASE } = crearServidor({ puerto: 8798, root, dir });
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1360, height: 900 } });
const errores = []; pg.on('pageerror', (e) => errores.push(e.message)); pg.on('dialog', (d) => d.accept());
await pg.route('https://cdn.openart.ai/**', (r) => r.fulfill({ status: 404 }));
const fallos = []; const ok = (c, m) => { if (!c) fallos.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const listo = () => pg.waitForFunction(() => !document.getElementById('enviar').disabled, null, { timeout: 30000 }).then(() => pg.waitForTimeout(400));
const ultimo = () => pg.$eval('#mensajes .msg.assistant:last-of-type', (n) => n.textContent.replace(/\s+/g, ' ').trim());
const decir = async (t) => { if (!(await pg.isVisible('#texto'))) { await pg.click('#orb'); await pg.waitForSelector('#texto', { state: 'visible' }); } await pg.fill('#texto', t); await pg.press('#texto', 'Enter'); await listo(); return ultimo(); };
const db = () => pg.evaluate(() => window.__db());

await pg.goto(BASE + '/404.html'); await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('fake.db', JSON.stringify({ __seq: 1, perfiles: [{ id: '00000000-0000-0000-0000-00000000000a', owner_id: '00000000-0000-0000-0000-00000000000a', nombre: 'Ana Prueba' }] })); });
await pg.goto(BASE + '/so/'); await pg.waitForSelector('#app:not([hidden])');
await pg.waitForSelector('#vistaHome h2'); ok(/¿Qué querés crear, Ana\?/.test(await pg.textContent('#vistaHome')), 'Nombre del perfil: saluda por el nombre de pila');
await pg.click('#linkCorreo'); await pg.waitForSelector('[data-co="conectar"]');
ok(/nunca escribe, responde ni envía/.test(await pg.textContent('#vistaArchivo')) && !/borrador/i.test(await pg.textContent('#vistaArchivo')), 'Correo: pantalla inicial explica que es solo lectura');
await pg.click('[data-co="conectar"]');
await pg.waitForSelector('.correo-lista, .correo .vacio', { timeout: 20000 }); await pg.waitForTimeout(400);
const t = await pg.textContent('#vistaArchivo');
ok(/Recibidos\s*4/.test(t) && /Sin responder\s*2/.test(t) && /Sin leer\s*3/.test(t), 'Análisis: recibidos, sin leer y sin responder (sin contar automáticos)');
ok(/Reclamo de entrega/.test(t) && /Nuevo pedido/.test(t) && !/Resumen de cuenta[\s\S]*Responder/.test(t.split('Sin responder (')[1] || ''), 'Sin responder: incluye clientes, excluye notificaciones del banco');
ok(/Respondés en \(mediana\)\s*2/.test(t), 'Tiempo de respuesta mediano (2 h)');
ok(!(await pg.$('.correo-lista textarea, .correo-lista details, .correo-lista form')) && !/borrador/i.test(t), 'Sin responder: solo lista, sin opción de responder');
let d;
let r = await decir('Analizá mis mails');
ok(/recibiste 4 mails/.test(r) && /2 esperando respuesta/.test(r) && await pg.isVisible('#mensajes .msg:last-child .gu-chart'), 'Chat: "analizá mis mails" responde con resumen y gráfico');
r = await decir('Respondé el mail de Luis diciendo que mañana lo resolvemos');
d = await db();
ok(/Solo analizo tu correo/.test(r) && !('so_mail_drafts' in d), 'Chat: "respondé el mail de Luis…" no prepara respuestas (solo lectura)');
// Aislamiento: otro usuario no ve la casilla ni los mails.
const otro = await pg.evaluate(async () => { localStorage.setItem('fake.user', 'b'); const c = window.supabase.createClient(); const [m, a] = await Promise.all([c.from('so_mails').select('*'), c.from('so_mail_accounts').select('*')]); localStorage.setItem('fake.user', 'a'); return [m.data.length, a.data.length]; });
ok(otro[0] === 0 && otro[1] === 0, 'Seguridad: otro usuario no ve la casilla ni los mails');
r = await decir('Desconectá mi Gmail');
d = await db();
ok(/revoqué el permiso/.test(r) && !d.so_mails.length && d.so_mail_accounts[0].status === 'desconectada', 'Desconectar: revoca y borra los mails guardados');
console.log('ERRORES', JSON.stringify(errores)); console.log(`FALLOS ${fallos.length}`); fallos.forEach((f) => console.log('  - ' + f));
await b.close(); srv.close(); process.exitCode = fallos.length || errores.length ? 1 : 0;
