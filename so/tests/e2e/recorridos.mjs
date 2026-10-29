// Recorridos críticos A–G de /so en Chromium real, contra un Supabase simulado (supabase-simulado.js): persistente entre
// recargas, multiusuario y con fallas inyectables. No toca la base real. Uso: npm run test:so:e2e
// (requiere Playwright; SO_E2E_OUT=<carpeta> guarda capturas).
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
import { crearServidor } from './servidor.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../../..');
const out = process.env.SO_E2E_OUT || null;
const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'so-e2e-')), 'ventas.csv');
{ // 3000 filas de agosto/septiembre + 1 inválida
  let seed = 1; const rnd = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const filas = ['fecha;Monto;Unidades;Canal'];
  for (let i = 0; i < 3000; i++) {
    const m = i < 1500 ? 8 : 9, canal = ['web', 'local', 'mayorista'][rnd(3)];
    const monto = m === 9 && canal === 'web' ? 50 + rnd(250) : 100 + rnd(800);
    filas.push(`${String(1 + rnd(28)).padStart(2, '0')}/0${m}/2026;${monto};${1 + rnd(5)};${canal}`);
  }
  filas.push('mal;xx;1;web');
  fs.writeFileSync(csv, filas.join('\n'));
}
const { srv, BASE } = crearServidor({ puerto: 8767, root, dir });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
const pg = await ctx.newPage();
const errores = []; pg.on('pageerror', (e) => errores.push(e.message)); pg.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
pg.on('dialog', (d) => d.accept());
const fallos = []; let pasos = 0; const medidas = {};
const ok = (c, msg) => { if (!c) fallos.push(msg); console.log(`${c ? '✔' : '✘'} ${msg}`); };
const listo = () => pg.waitForFunction(() => !document.getElementById('enviar').disabled && !document.querySelector('.actividad[data-tipo="entendiendo"]'), null, { timeout: 15000 });
const decir = async (t) => { pasos++; await pg.fill('#texto', t); await pg.press('#texto', 'Enter'); await pg.waitForTimeout(80); await listo(); await pg.waitForTimeout(250); };
const ultimo = () => pg.$eval('#mensajes .msg.assistant:last-of-type', (n) => n.textContent.replace(/\s+/g, ' ').trim());
const clic = async (sel) => { pasos++; await pg.click(sel); await pg.waitForTimeout(300); };
const journey = (n) => { medidas[n] = pasos; pasos = 0; };

await pg.goto(BASE + '/so/'); await pg.evaluate(() => localStorage.clear()); await pg.goto(BASE + '/so/');
await pg.waitForSelector('#app:not([hidden])'); await pg.waitForTimeout(400);
// ---------- A
ok(await pg.isVisible('text=Soy Francisco'), 'A: primera vez explica qué es Francisco');
ok((await pg.$$eval('#sugerencias button', (n) => n.map((x) => x.textContent))).includes('Creá un dashboard de ventas con histórico'), 'A: ejemplos accionables de Trabajo');
if (out) await pg.screenshot({ path: path.join(out, 'u1-onboarding.png') });
await decir('Creá un dashboard de ventas con histórico');
let t = await ultimo();
ok(/✓ Verificado/.test(t) && /Creé "Dashboard de ventas"/.test(t), 'A: creación verificada antes de informar éxito');
ok(await pg.isVisible('#mensajes .tarjeta-art >> text=Abrir'), 'A: ArtifactCard con acción primaria');
ok(await pg.isVisible('#mensajes .msg:last-child >> text=Deshacer'), 'A: acción de riesgo medio ofrece Deshacer');
ok(await pg.isVisible('#mensajes .msg:last-child >> text=Ver detalles'), 'A: explicación disponible (Ver detalles)');
ok((await pg.$$eval('#sugerencias button', (n) => n.length)) === 0, 'A: las sugerencias desaparecen cuando la conversación ya empezó');
await clic('#mensajes .tarjeta-art a.primario');
await pg.waitForSelector('.kpis');
ok(await pg.isVisible('#panelFrancisco') && await pg.isVisible('#vistaArtefacto'), 'A: desktop muestra tablero + Francisco juntos');
ok(/Trabajando sobre: Dashboard de ventas/.test(await pg.textContent('#contexto')), 'A: contexto visible');
await clic('[data-aa="editar"]');
await decir('Agregale vendedor');
t = await ultimo();
ok(/Agregué "Vendedor"/.test(t) && /Verificado/.test(t), 'A: modificar con Francisco sin repetir de qué tablero');
ok(await pg.isVisible('form.carga >> text=Vendedor'), 'A: el cambio se ve en el tablero');
await clic('#mensajes .msg:last-child [data-undo]');
await pg.waitForTimeout(400);
ok(!(await pg.isVisible('form.carga >> text=Vendedor')) && /Deshecho/.test(await ultimo()), 'A: Deshacer revierte el cambio');
journey('A');
// ---------- B
await decir('Guardá este histórico');
ok(/historial/.test(await ultimo()), 'B: "guardá el histórico" confirma persistencia');
pasos++;
// Importación desde el tablero: vista previa con mapeo → importar (las tareas largas en segundo plano se cubren en ingesta.mjs, K).
await pg.setInputFiles('input[data-r="csv"]', csv);
await pg.waitForSelector('#dlgImportar[open] .resumen-import', { timeout: 20000 }); await pg.waitForTimeout(300);
ok(/Se incorporarán 3\.000 registros; 1 necesitan revisión/.test(await pg.textContent('#formImportar .resumen-import')), 'E: vista previa antes de importar');
await clic('#formImportar [value="importar"]');
await pg.waitForFunction(() => !document.getElementById('dlgImportar').open, null, { timeout: 30000 }); await pg.waitForTimeout(600);
await decir('¿qué dashboards tengo?');
ok(/Tenés 1/.test(await ultimo()), 'E: el usuario sigue trabajando después de importar');
ok(await pg.isVisible('#badgeCentro'), 'E: el centro de actividad indica novedades');
await clic('#btnCentro');
await clic('[data-tab="avisos"]');
ok(/ventas\.csv: 3\.000 registros incorporados, 1 necesitan revisión/.test(await pg.textContent('#centroCuerpo')), 'E: aviso operativo en el centro de notificaciones (no en el chat)');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
journey('E');
await pg.waitForSelector('.kpis');
await pg.selectOption('select[data-r="desde"]', '2026-09'); await pg.selectOption('select[data-r="hasta"]', '2026-09'); pasos += 2;
await pg.waitForTimeout(300);
ok(/Período: Septiembre 2026/.test(await pg.textContent('#contexto')), 'B: el período elegido en la UI aparece como contexto');
await decir('Comparalo con agosto.');
t = await ultimo();
ok(/Septiembre 2026 respecto de Agosto 2026/.test(t) && !/¿Sobre cuál/.test(t), 'B: "Comparalo con agosto" usa el contexto sin preguntar');
ok(await pg.isVisible('.comparacion'), 'B: la comparación se ve en el tablero');
ok(/Ver fuentes/.test(t), 'B: trazabilidad disponible');
journey('B');
// ---------- C
await pg.click('[data-kpi="total"]'); pasos++; await pg.waitForTimeout(300);
ok(/Selección: Total Monto/.test(await pg.textContent('#contexto')), 'C: selección de KPI visible como contexto');
ok(await pg.isVisible('[data-aa="preguntar"]'), 'C: "Preguntar a Francisco" sobre la selección');
await decir('¿Por qué bajó esto?');
t = await ultimo();
ok(/(bajó|subió).*El mayor cambio vino de Canal/.test(t), 'C: explicación basada en evidencia');
await decir('Mostrame sólo web');
ok(/Solo Canal: web/.test(await pg.textContent('#contexto')), 'C: filtro por conversación');
ok((await pg.$eval('select[data-r="filtro"]', (s) => s.value)) === 'canal|web', 'C: UI y Francisco comparten el mismo estado (select refleja el filtro)');
await pg.click('#contexto [data-quitar="filtro"]'); pasos++; await pg.waitForTimeout(300);
ok((await pg.$eval('select[data-r="filtro"]', (s) => s.value)) === '', 'C: quitar el chip limpia el filtro en la UI');
await pg.selectOption('select[data-r="filtro"]', 'canal|local'); pasos++; await pg.waitForTimeout(300);
ok(/Solo Canal: local/.test(await pg.textContent('#contexto')), 'C: filtro manual visible para Francisco');
journey('C');
if (out) await pg.screenshot({ path: path.join(out, 'u2-tablero.png') });
// ---------- D
await decir('compartilo con ana@empresa.com');
t = await ultimo();
ok(/ana@empresa.com puede usar "Dashboard de ventas" \(ver y cargar datos\), pero no modificarlo/.test(t) && /Verificado/.test(t), 'D: permiso explicado en lenguaje claro y verificado');
await decir('compartilo con jefe@empresa.com para editar');
t = await ultimo();
ok(/Propuesta/.test(t) && /Antes de compartir/.test(t), 'D: alto impacto muestra vista previa antes de ejecutar');
ok(!(await pg.evaluate(() => window.__db().so_shares.some((s) => s.grantee_email === 'jefe@empresa.com'))), 'D: nada se ejecuta antes de confirmar');
await clic('#mensajes .msg:last-child [data-confirmar]');
await pg.waitForTimeout(400);
ok(await pg.evaluate(() => window.__db().so_shares.some((s) => s.grantee_email === 'jefe@empresa.com' && s.permission === 'EDIT')), 'D: confirmación ejecuta');
const artId = await pg.evaluate(() => window.__db().so_artifacts[0].id);
// Con USE, cargar datos requiere que el dueño lo habilite (Datos y fuentes).
if (!(await pg.$eval('#panelDatos', (n) => n.open))) await pg.click('#panelDatos summary');
await pg.waitForSelector('#datosCuerpo [data-shared-input]'); await pg.check('#datosCuerpo [data-shared-input]'); await pg.waitForTimeout(500); pasos++;
const pg2 = await ctx.newPage(); pg2.on('pageerror', (e) => errores.push('shared: ' + e.message));
await pg2.evaluate(() => 0);
await pg2.goto(BASE + '/so/'); await pg2.evaluate(() => localStorage.setItem('fake.user', 'b'));
await pg2.goto(`${BASE}/so/shared/${artId}`);
await pg2.waitForSelector('.kpis', { timeout: 10000 });
ok(pg2.url().includes(`/so/shared/#${artId}`), 'D: /so/shared/:id resuelve la ruta');
ok(/Podés verlo y cargar datos, sin modificarlo/.test(await pg2.textContent('#meta')), 'D: receptor ve su permiso en lenguaje claro');
ok(await pg2.isVisible('form.carga'), 'D: con permiso USE puede cargar datos');
ok(!(await pg2.isVisible('text=Francisco')) && !(await pg2.$('#mensajes')), 'D: el receptor no ve chat ni Francisco');
await pg2.fill('form.carga input[name="monto"]', '777'); await pg2.click('form.carga button[type="submit"]'); await pg2.waitForTimeout(500);
ok(await pg.evaluate(() => window.__db().so_records.some((r) => r.data.monto === 777)), 'D: carga del receptor persistida');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'a'));
await decir('compartilo con ana@empresa.com solo lectura');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'b')); await pg2.reload(); await pg2.waitForSelector('.kpis');
ok(!(await pg2.isVisible('form.carga')), 'D: con VIEW no puede cargar datos');
await pg2.evaluate(() => localStorage.setItem('fake.user', 'a'));
await pg2.close();
journey('D');
// ---------- F
await pg.evaluate(() => localStorage.setItem('fake.fallar', JSON.stringify(['so_records.select'])));
await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(300);
await pg.evaluate(() => {}); 
await clic('#menuWorkspace a');
await pg.waitForTimeout(300);
const tieneError = await pg.isVisible('#errorArtefacto >> text=No pude actualizar');
ok(tieneError || await pg.isVisible('.kpis'), 'F: error de carga detectado o datos en memoria');
if (!tieneError) { await pg.click('[data-r="actualizar"]'); await pg.waitForTimeout(500); }
ok(await pg.isVisible('#errorArtefacto >> text=Reintentar') && await pg.isVisible('#errorArtefacto >> text=Seguir usando los últimos datos'), 'F: recuperación con Reintentar y últimos datos');
await clic('#errorArtefacto >> text=Seguir usando los últimos datos');
ok(await pg.isVisible('text=Mostrando los últimos datos guardados'), 'F: no confunde datos en caché con actuales');
await pg.evaluate(() => localStorage.setItem('fake.fallar', JSON.stringify(['so_shares.select'])));
await decir('compartilo con ana@empresa.com');
t = await ultimo();
ok(/No se pudo completar/.test(t) && /Reintentar/.test(t), 'F: fallo en chat con Reintentar (sin falso éxito)');
await pg.evaluate(() => localStorage.setItem('fake.fallar', '[]'));
await clic('#mensajes .msg:last-child [data-reintentar]'); await listo(); await pg.waitForTimeout(300);
ok(/Verificado/.test(await ultimo()), 'F: reintento exitoso continúa el trabajo');
journey('F');
// ---------- búsqueda / paleta
await pg.keyboard.press('Control+k'); pasos++;
ok(await pg.isVisible('#paleta'), 'Búsqueda: Ctrl+K abre la paleta');
await pg.keyboard.type('vtas'); await pg.waitForTimeout(200);
ok(/Dashboard de ventas/.test(await pg.textContent('#paletaLista li[aria-selected="true"]')), 'Búsqueda: difusa encuentra "vtas"');
await pg.fill('#paletaInput', 'mayorista'); await pg.waitForTimeout(600);
ok(/🧾/.test(await pg.textContent('#paletaLista')), 'Búsqueda: encuentra registros (servidor, con permisos)');
// ---------- G
await pg.fill('#paletaInput', 'vtas'); await pg.waitForTimeout(150); await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
ok(/#\/a\//.test(pg.url()), 'Búsqueda: Enter abre el resultado');
await pg.waitForSelector('.kpis');
await pg.selectOption('select[data-r="filtro"]', 'canal|local'); await pg.waitForTimeout(2000);   // estado que debería sobrevivir
await pg.evaluate(() => { const db = window.__db(); const ayer = new Date(Date.now() - 864e5).toISOString(); db.so_menu.forEach((m) => { m.last_opened_at = ayer; }); localStorage.setItem('fake.db', JSON.stringify(db)); });
await pg.evaluate(() => { location.hash = '#/'; });
await pg.waitForTimeout(1800);
await pg.reload(); await pg.waitForSelector('#app:not([hidden])'); await pg.waitForTimeout(800);
ok(await pg.isVisible('text=Continuar Dashboard de ventas · solo local'), 'G: al volver ofrece continuar el último trabajo (con su filtro)');
ok(await pg.isVisible('text=Recientes'), 'G: home con recientes');
await clic('[data-continuar]'); await pg.waitForSelector('.kpis'); await pg.waitForTimeout(400);
ok(/Solo Canal: local/.test(await pg.textContent('#contexto')), 'G: continuar restaura filtros (continuidad)');
await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(400);
await decir('Abrí el dashboard que usamos ayer');
ok(/Abrí "Dashboard de ventas"/.test(await ultimo()), 'G: "el dashboard que usamos ayer" se resuelve');
await pg.waitForSelector('.kpis');
journey('G');
// ---------- teclado y móvil
await pg.focus('[data-kpi="registros"]'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
ok(/Selección: Registros/.test(await pg.textContent('#contexto')), 'Teclado: KPI seleccionable con Enter');
if (out) await pg.screenshot({ path: path.join(out, 'u3-continuar.png') });
await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(400);
ok(!(await pg.isVisible('#panelFrancisco')) && await pg.isVisible('#fab'), 'Móvil: tablero primero, Francisco en botón');
if (out) await pg.screenshot({ path: path.join(out, 'u4-movil-tablero.png') });
await clic('#fab');
ok(await pg.isVisible('#panelFrancisco') && /Trabajando sobre/.test(await pg.textContent('#contexto')), 'Móvil: Francisco abre a pantalla completa conservando contexto');
if (out) await pg.screenshot({ path: path.join(out, 'u5-movil-francisco.png') });
await clic('#cerrarPanel');
ok(await pg.isVisible('.kpis'), 'Móvil: volver al tablero');
ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Móvil: sin scroll horizontal');
await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(400);
ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'Móvil: home sin scroll horizontal');
if (out) await pg.screenshot({ path: path.join(out, 'u6-movil-home.png'), fullPage: true });
// Personal y tema oscuro
await pg.setViewportSize({ width: 1360, height: 900 });
await pg.emulateMedia({ colorScheme: 'dark' });
await clic('.modos [data-modo="personal"]'); await pg.waitForTimeout(500);
ok((await pg.$$eval('#sugerencias button', (n) => n.map((x) => x.textContent))).includes('Ayudame a organizar…'), 'Personal: ejemplos de Personal');
ok(await pg.isHidden('#bloqueWorkspace'), 'Personal: sin workspace');
await decir('Creá un dashboard de gastos');
ok(/solo charlamos/.test(await ultimo()), 'Personal: no publica tableros');
if (out) await pg.screenshot({ path: path.join(out, 'u7-personal-oscuro.png') });
await clic('.modos [data-modo="work"]'); await pg.waitForTimeout(500);
// métricas
const ev = await pg.evaluate(() => [...new Set(window.__db().so_events.map((e) => e.name))].sort());
console.log('EVENTOS', ev.join(', '));
ok(['time_to_first_value', 'undo', 'share_success', 'task_completed', 'recovery_success', 'search_success', 'preview_confirmed', 'artifact_reuse', 'time_to_result'].every((n) => ev.includes(n) ), 'Métricas: eventos de trabajo resuelto registrados');
console.log('PASOS', JSON.stringify(medidas));
console.log('ERRORES', JSON.stringify(errores));
console.log(`FALLOS ${fallos.length}`); fallos.forEach((f) => console.log('  - ' + f));
await b.close(); srv.close();
process.exitCode = fallos.length || errores.length ? 1 : 0;
