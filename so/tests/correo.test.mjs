import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desafioPkce, urlAutorizacion, aFila, listarIds, analizarCorreos, direccion, canjearCodigo, SCOPES } from '../correo/gmail.js';

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');

test('PKCE S256 (contra node:crypto) y URL de autorización con state, offline y solo lectura', async () => {
  const { createHash } = await import('node:crypto');
  for (const v of ['dBjftJeZ4CVP-mJ92K9KyePCtSJ2hdlyCKZxN_0iyNw', 'x'.repeat(64)]) assert.equal(await desafioPkce(v), createHash('sha256').update(v).digest('base64url'));
  const u = new URL(urlAutorizacion({ clientId: 'cid', redirectUri: 'https://x/functions/v1/so-correo', state: 's'.repeat(40), desafio: 'abc' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('state'), 's'.repeat(40));
  assert.deepEqual(u.searchParams.get('scope').split(' '), SCOPES);
  assert.deepEqual(SCOPES, ['https://www.googleapis.com/auth/gmail.readonly'], 'solo lectura: ni borradores ni envío');
});

test('mensaje de Gmail → fila: remitente, asunto, texto plano decodificado (acentos), etiquetas', () => {
  const m = { id: 'g1', threadId: 't1', snippet: 'Hola…', internalDate: String(Date.parse('2026-10-01T12:00:00Z')), labelIds: ['INBOX', 'UNREAD'],
    payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: '"Ana Pérez" <Ana@Cliente.com>' }, { name: 'To', value: 'yo@valo.ar, otro@x.com' }, { name: 'Subject', value: 'Pedido de cotización' }, { name: 'Message-ID', value: '<abc@mail>' }],
      parts: [{ mimeType: 'text/plain', body: { data: b64u('Necesito precio del ítem Nº 3') } }, { mimeType: 'text/html', body: { data: b64u('<p>otro</p>') } }] } };
  const f = aFila(m, 'yo@valo.ar');
  assert.equal(f.from_addr, 'ana@cliente.com'); assert.equal(f.from_name, 'Ana Pérez');
  assert.deepEqual(f.to_addrs, ['yo@valo.ar', 'otro@x.com']);
  assert.equal(f.body, 'Necesito precio del ítem Nº 3');
  assert.equal(f.unread, true); assert.equal(f.outbound, false); assert.equal(f.message_id, '<abc@mail>');
  const soloHtml = aFila({ ...m, payload: { ...m.payload, parts: [{ mimeType: 'text/html', body: { data: b64u('<style>x{}</style><p>Hola&nbsp;<b>mundo</b></p>') } }] } }, 'yo@valo.ar');
  assert.equal(soloHtml.body, 'Hola mundo');
  assert.equal(aFila({ ...m, labelIds: ['SENT'] }, 'yo@valo.ar').outbound, true);
  assert.deepEqual(direccion('sin-nombre@x.com'), { nombre: null, email: 'sin-nombre@x.com' });
});

test('listado paginado con tope y errores de Google legibles', async () => {
  const pedidos = [];
  const fetch = async (url) => { pedidos.push(url); const pag = new URL(url).searchParams.get('pageToken');
    return new Response(JSON.stringify(pag ? { messages: [{ id: '3' }] } : { messages: [{ id: '1' }, { id: '2' }], nextPageToken: 'p2' }), { status: 200 }); };
  assert.deepEqual(await listarIds(fetch, 'tok', { dias: 7, max: 10 }), ['1', '2', '3']);
  assert.match(new URL(pedidos[0]).searchParams.get('q'), /newer_than:7d/);
  const malo = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  await assert.rejects(canjearCodigo(malo, { code: 'x', verificador: 'v', clientId: 'c', clientSecret: 's', redirectUri: 'r' }), /volvé a conectar/);
});

test('análisis de la casilla: volumen, sin responder (sin automáticos), tiempo de respuesta', () => {
  const m = (id, hilo, de, cuando, extra = {}) => ({ gmail_id: id, thread_id: hilo, from_addr: de, received_at: cuando, outbound: de === 'yo@valo.ar', unread: false, labels: [], ...extra });
  const mails = [
    m('1', 'a', 'ana@cliente.com', '2026-10-01T10:00:00Z'), m('2', 'a', 'yo@valo.ar', '2026-10-01T12:00:00Z'),   // respondido en 2 h
    m('3', 'b', 'luis@cliente.com', '2026-10-02T09:00:00Z', { unread: true }),                                   // sin responder
    m('4', 'c', 'no-reply@banco.com', '2026-10-02T10:00:00Z'),                                                   // automático: no cuenta
    m('5', 'd', 'ana@cliente.com', '2026-10-03T09:00:00Z'), m('6', 'd', 'yo@valo.ar', '2026-10-03T13:00:00Z'),   // 4 h
  ];
  const r = analizarCorreos(mails);
  assert.equal(r.entrantes, 4); assert.equal(r.salientes, 2); assert.equal(r.sinLeer, 1);
  assert.deepEqual(r.sinResponder.map((x) => x.gmail_id), ['3']);
  assert.equal(r.horasMedianaRespuesta, 4);
  assert.equal(r.remitentes[0].email, 'ana@cliente.com'); assert.equal(r.remitentes[0].n, 2);
  assert.equal(r.automaticos, 1);
  assert.deepEqual(r.porDia.map((x) => x.n), [1, 2, 1]);
});
