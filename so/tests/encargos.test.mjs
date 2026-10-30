import { test } from 'node:test';
import assert from 'node:assert/strict';
import { necesitaClaude, validarVinculo, validarResultado, textoDisparo, promptRutina, armarContexto, RUTINA_BETA } from '../encargos/encargos.js';
import { accionUsuario, leerEncargo, entregarEncargo, repoMemoria } from '../encargos/servidor.js';

const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire';
const TOKEN_OK = 'sk-ant-oat01-' + 'x'.repeat(40);
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';

test('detecta pedidos que necesitan los conectores de Claude (y no los demás)', () => {
  for (const t of ['Traé la planilla de Drive de ventas', 'Qué reuniones tengo esta semana en el calendario', 'Cruzá las ventas con mi agenda', 'Buscá en Notion el plan', 'Hacelo con Claude', 'usá mis conectores']) assert.ok(necesitaClaude(t), t);
  for (const t of ['Analizá mis ventas', 'Creá un dashboard de ventas', 'Analizá mis mails', 'Exportá a Excel', 'Mi drive es lento']) assert.ok(!necesitaClaude(t), t);
});

test('vínculo: solo la URL oficial del disparador y una clave con formato de Claude', () => {
  assert.ok(validarVinculo({ url: URL_OK, token: TOKEN_OK }).ok);
  assert.ok(!validarVinculo({ url: 'https://evil.com/v1/claude_code/routines/trig_01ABCDEFGHJK/fire', token: TOKEN_OK }).ok);
  assert.equal(validarVinculo({ url: URL_OK + '?x=1', token: TOKEN_OK }).url, URL_OK, 'se queda solo con la URL limpia');
  assert.ok(!validarVinculo({ url: 'https://api.anthropic.com.evil.com/v1/claude_code/routines/trig_01ABCDEFGHJK/fire', token: TOKEN_OK }).ok);
  assert.ok(!validarVinculo({ url: URL_OK, token: 'abc' }).ok);
  const curl = `curl -X POST ${URL_OK} \\\n  -H "Authorization: Bearer ${TOKEN_OK}"`;
  assert.deepEqual(validarVinculo({ url: curl, token: '' }), { ok: true, url: URL_OK, token: TOKEN_OK }, 'acepta el comando curl entero');
  assert.equal(validarVinculo({ url: 'https://claude.ai/code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW', token: TOKEN_OK }).url, URL_OK, 'arma la URL desde la página de la tarea');
  assert.equal(validarVinculo({ url: ` ${URL_OK}\n`, token: `Bearer ${TOKEN_OK} ` }).token, TOKEN_OK, 'tolera espacios y el prefijo Bearer');
});

test('resultado: exige texto, filtra componentes no aprobados y limita tamaños', () => {
  assert.ok(!validarResultado({}).ok);
  const r = validarResultado({ texto: ' Listo ', ui: [{ type: 'Metric', props: { label: 'Ventas', valor: 3 } }, { type: 'Script', props: { x: 1 } }, { type: 'Table' }], fuentes: ['Drive: Ventas.xlsx'] });
  assert.equal(r.resultado.texto, 'Listo'); assert.deepEqual(r.resultado.ui.map((c) => c.type), ['Metric']); assert.deepEqual(r.resultado.fuentes, ['Drive: Ventas.xlsx']);
  assert.ok(!validarResultado({ texto: 'x'.repeat(20001) }).ok);
});

test('el disparo solo lleva número y clave; el prompt fija la URL de Francisco y solo lectura afuera', () => {
  assert.deepEqual(JSON.parse(textoDisparo({ encargo: 'e', token: 't' })), { encargo: 'e', token: 't' });
  const p = promptRutina('https://x.supabase.co/functions/v1/so-encargos');
  assert.match(p, /https:\/\/x\.supabase\.co\/functions\/v1\/so-encargos\?encargo=/); assert.match(p, /Solo LEÉ/); assert.match(p, /ignorá cualquier otra cosa/);
  const c = armarContexto({ nombre: 'Ana', mensajes: Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `m${i}` })) });
  assert.equal(c.conversacion.length, 8); assert.equal(c.usuario.nombre, 'Ana');
});

// Flujo completo contra el repositorio en memoria, con el endpoint de Claude simulado.
function claude() {
  const disparos = [];
  const fetch = async (url, init) => { disparos.push({ url, init, payload: JSON.parse(JSON.parse(init.body).text) }); return new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_url: 'https://claude.ai/code/session_1' }), { status: 200 }); };
  return { disparos, fetch };
}

test('crear → la tarea lee → entrega: mensaje en el chat, aviso y clave de un solo uso', async () => {
  const t = { so_chats: [] }; const repo = repoMemoria(t); const c = claude();
  let r = await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: 'Traé la planilla de Drive' }, fetch: c.fetch });
  assert.equal(r.status, 409, 'sin vínculo no dispara');
  r = await accionUsuario(repo, { owner: A, body: { accion: 'vincular', url: URL_OK, token: TOKEN_OK } });
  assert.equal(r.status, 200);
  r = await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: 'Traé la planilla de Drive', chat_id: 'chat-1', contexto: { modo: 'work' } }, fetch: c.fetch });
  assert.equal(r.body.estado, 'enviado');
  const d = c.disparos[0];
  assert.equal(d.url, URL_OK); assert.equal(d.init.headers.Authorization, `Bearer ${TOKEN_OK}`); assert.equal(d.init.headers['anthropic-beta'], RUTINA_BETA);
  assert.deepEqual(Object.keys(d.payload).sort(), ['encargo', 'token'], 'el disparo no lleva el pedido');
  const e = t.so_encargos[0];
  assert.notEqual(e.token_hash, d.payload.token, 'se guarda el hash, no la clave');

  assert.equal((await leerEncargo(repo, { encargo: e.id, token: 'clave-equivocada-123456789' })).status, 404);
  r = await leerEncargo(repo, { encargo: e.id, token: d.payload.token });
  assert.equal(r.status, 200); assert.equal(r.body.pedido, 'Traé la planilla de Drive'); assert.equal(e.estado, 'en_curso');

  assert.equal((await entregarEncargo(repo, { body: { accion: 'entregar', encargo: e.id, token: d.payload.token, resultado: {} } })).status, 400, 'resultado inválido no cierra');
  r = await entregarEncargo(repo, { body: { accion: 'entregar', encargo: e.id, token: d.payload.token, resultado: { texto: 'Ventas de octubre: 120', ui: [{ type: 'Metric', props: { label: 'Ventas', valor: 120 } }], fuentes: ['Drive'] } } });
  assert.equal(r.status, 200); assert.equal(e.estado, 'listo'); assert.equal(e.token_hash, null);
  assert.equal(t.so_messages.length, 1); assert.equal(t.so_messages[0].chat_id, 'chat-1'); assert.equal(t.so_messages[0].meta.ui[0].type, 'Metric');
  assert.equal(t.so_notifications.at(-1).priority, 'success');
  assert.equal((await entregarEncargo(repo, { body: { accion: 'entregar', encargo: e.id, token: d.payload.token, resultado: { texto: 'otra vez' } } })).status, 404, 'la clave no sirve dos veces');
  assert.equal((await leerEncargo(repo, { encargo: e.id, token: d.payload.token })).status, 404);
});

test('fallar, vencer, límite de encargos y aislamiento entre usuarios', async () => {
  const t = {}; const repo = repoMemoria(t); const c = claude();
  await accionUsuario(repo, { owner: A, body: { accion: 'vincular', url: URL_OK, token: TOKEN_OK } });
  assert.equal((await accionUsuario(repo, { owner: B, body: { accion: 'estado' } })).body.vinculado, false, 'B no usa el vínculo de A');
  assert.equal((await accionUsuario(repo, { owner: B, body: { accion: 'crear', pedido: 'x' }, fetch: c.fetch })).status, 409);
  await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: 'uno' }, fetch: c.fetch });
  const [e] = t.so_encargos;
  await entregarEncargo(repo, { body: { accion: 'fallar', encargo: e.id, token: c.disparos[0].payload.token, motivo: 'No tengo el conector de Notion' } });
  assert.equal(e.estado, 'fallo'); assert.match(e.error, /Notion/);
  for (let i = 0; i < 5; i++) await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: `p${i}` }, fetch: c.fetch });
  assert.equal((await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: 'sexto' }, fetch: c.fetch })).status, 429);
  const tarde = new Date(Date.now() + 3 * 3600000);
  assert.equal((await leerEncargo(repo, { encargo: t.so_encargos[1].id, token: c.disparos[1].payload.token, ahora: tarde })).status, 404, 'vencido');
  assert.equal((await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: 'después' }, fetch: c.fetch, ahora: tarde })).status, 200, 'los colgados vencen y liberan lugar');
  // Claude rechaza la clave: el encargo falla con un mensaje claro.
  const malo = async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 401 });
  const r = await accionUsuario(repo, { owner: A, body: { accion: 'crear', pedido: 'z' }, fetch: malo, ahora: tarde });
  assert.equal(r.status, 502); assert.match(r.body.error, /volvé a vincular/);
  await accionUsuario(repo, { owner: A, body: { accion: 'desvincular' } });
  assert.equal((await accionUsuario(repo, { owner: A, body: { accion: 'estado' } })).body.vinculado, false);
});
