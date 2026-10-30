// SO · Encargos: lógica del servidor (la Edge Function so-encargos la usa con un repositorio sobre Supabase; las pruebas y
// el simulador, con uno en memoria). Sin DOM ni Supabase acá: el repositorio fija el dueño en cada consulta.
//
// repo: {
//   vinculo(owner) → { url, token } | null          guardarVinculo(owner, url, token)       borrarVinculo(owner)
//   marcarVinculo(owner, { last_fire_at?, last_error? })
//   enCurso(owner) → número de encargos pendientes/enviados/en curso
//   vencer(owner, antesDe) → marca como fallo los que quedaron colgados
//   crear(fila) → encargo        encargo(id) → encargo con token_hash
//   actualizar(id, patch, { estados }) → encargo | null (solo si el estado actual está en "estados")
//   mensaje({ owner_id, chat_id, content, meta })    aviso({ owner_id, priority, title, body })
// }
import { validarVinculo, textoDisparo, hashClave, claveNueva, validarResultado, RUTINA_BETA, VENCE_MIN, MAX_EN_CURSO } from './encargos.js';

const FORMATO = 'Respondé con {"texto": "...", "ui": [...], "fuentes": [...]}. "texto" es lo que lee el usuario en el chat de Francisco (claro, breve, con los números importantes). "ui" (opcional) son componentes Metric, Chart, Table, Timeline o Insight. "fuentes" lista los documentos o servicios que usaste.';

// Acciones del usuario (con sesión): vincular, desvincular, estado, crear.
export async function accionUsuario(repo, { owner, body, fetch, ahora = new Date() }) {
  const b = body || {};
  if (b.accion === 'estado') { const v = await repo.vinculo(owner); return { status: 200, body: { vinculado: !!v } }; }
  if (b.accion === 'vincular') {
    const v = validarVinculo(b);
    if (!v.ok) return { status: 400, body: { error: v.error } };
    await repo.guardarVinculo(owner, v.url, v.token);
    return { status: 200, body: { vinculado: true } };
  }
  if (b.accion === 'desvincular') { await repo.borrarVinculo(owner); return { status: 200, body: { vinculado: false } }; }
  if (b.accion !== 'crear') return { status: 400, body: { error: 'acción desconocida' } };

  const pedido = String(b.pedido || '').trim();
  if (!pedido || pedido.length > 4000) return { status: 400, body: { error: 'pedido inválido' } };
  const contexto = b.contexto && typeof b.contexto === 'object' ? b.contexto : {};
  if (JSON.stringify(contexto).length > 200000) return { status: 400, body: { error: 'el contexto es demasiado grande' } };
  const v = await repo.vinculo(owner);
  if (!v) return { status: 409, body: { error: 'sin_vinculo', mensaje: 'Primero vinculá tu cuenta de Claude.' } };
  await repo.vencer(owner, new Date(ahora.getTime() - VENCE_MIN * 60000).toISOString());
  if ((await repo.enCurso(owner)) >= MAX_EN_CURSO) return { status: 429, body: { error: 'demasiados', mensaje: `Ya hay ${MAX_EN_CURSO} encargos en curso con Claude: esperá a que termine alguno.` } };

  const clave = claveNueva();
  const e = await repo.crear({ owner_id: owner, chat_id: b.chat_id || null, pedido, contexto, estado: 'pendiente', token_hash: await hashClave(clave), created_at: ahora.toISOString() });
  try {
    const r = await fetch(v.url, { method: 'POST', headers: { Authorization: `Bearer ${v.token}`, 'anthropic-beta': RUTINA_BETA, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textoDisparo({ encargo: e.id, token: clave }) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 401 ? 'Claude rechazó la clave del disparador: volvé a vincular tu cuenta' : r.status === 429 ? 'Claude alcanzó el límite de encargos por hora: probá más tarde' : `Claude respondió ${r.status}${j?.error?.message ? `: ${String(j.error.message).slice(0, 160)}` : ''}`);
    await repo.actualizar(e.id, { estado: 'enviado', session_url: j.claude_code_session_url || null }, { estados: ['pendiente'] });
    await repo.marcarVinculo(owner, { last_fire_at: ahora.toISOString(), last_error: null });
    return { status: 200, body: { encargo: e.id, estado: 'enviado' } };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await repo.actualizar(e.id, { estado: 'fallo', error: msg, token_hash: null, finished_at: ahora.toISOString() }, { estados: ['pendiente'] });
    await repo.marcarVinculo(owner, { last_error: msg });
    return { status: 502, body: { encargo: e.id, estado: 'fallo', error: msg } };
  }
}

// Valida la clave de un solo uso de un encargo vigente. Devuelve el encargo o null (sin distinguir el motivo).
async function vigente(repo, encargo, token, ahora) {
  if (!/^[0-9a-f-]{36}$/.test(String(encargo || '')) || typeof token !== 'string' || token.length < 20) return null;
  const e = await repo.encargo(encargo);
  if (!e || !e.token_hash || !['enviado', 'en_curso'].includes(e.estado)) return null;
  if (ahora - Date.parse(e.created_at) > VENCE_MIN * 60000) return null;
  return e.token_hash === await hashClave(token) ? e : null;
}

// La tarea de Claude lee el encargo (GET).
export async function leerEncargo(repo, { encargo, token, ahora = new Date() }) {
  const e = await vigente(repo, encargo, token, ahora);
  if (!e) return { status: 404, body: { error: 'encargo inexistente, vencido o clave inválida' } };
  if (e.estado === 'enviado') await repo.actualizar(e.id, { estado: 'en_curso', started_at: ahora.toISOString() }, { estados: ['enviado'] });
  return { status: 200, body: { encargo: e.id, pedido: e.pedido, contexto: e.contexto, formato: FORMATO } };
}

// La tarea de Claude entrega (o informa que no pudo). Una sola vez: después la clave deja de servir.
export async function entregarEncargo(repo, { body, ahora = new Date() }) {
  const b = body || {};
  const e = await vigente(repo, b.encargo, b.token, ahora);
  if (!e) return { status: 404, body: { error: 'encargo inexistente, vencido o clave inválida' } };
  const fin = { token_hash: null, finished_at: ahora.toISOString() };
  if (b.accion === 'fallar') {
    const motivo = String(b.motivo || 'Claude no pudo completar el encargo.').slice(0, 1000);
    const act = await repo.actualizar(e.id, { ...fin, estado: 'fallo', error: motivo }, { estados: ['enviado', 'en_curso'] });
    if (!act) return { status: 409, body: { error: 'el encargo ya se cerró' } };
    if (e.chat_id) await repo.mensaje({ owner_id: e.owner_id, chat_id: e.chat_id, content: `Claude no pudo completar el encargo: ${motivo}`, meta: { estado: 'fallo', encargo: e.id } });
    await repo.aviso({ owner_id: e.owner_id, priority: 'action', title: 'Claude no pudo completar un encargo', body: motivo.slice(0, 300) });
    return { status: 200, body: { ok: true } };
  }
  if (b.accion !== 'entregar') return { status: 400, body: { error: 'acción desconocida' } };
  const v = validarResultado(b.resultado);
  if (!v.ok) return { status: 400, body: { error: v.error } };   // la clave sigue sirviendo para corregir y reintentar
  const act = await repo.actualizar(e.id, { ...fin, estado: 'listo', resultado: v.resultado }, { estados: ['enviado', 'en_curso'] });
  if (!act) return { status: 409, body: { error: 'el encargo ya se cerró' } };
  if (e.chat_id) await repo.mensaje({ owner_id: e.owner_id, chat_id: e.chat_id, content: v.resultado.texto,
    meta: { estado: 'verificado', encargo: e.id, ui: v.resultado.ui, fuente: { origen: 'Claude (tus conectores)', operacion: 'encargo', registros: v.resultado.fuentes.length || null, at: ahora.toISOString() }, fuentes: v.resultado.fuentes } });
  await repo.aviso({ owner_id: e.owner_id, priority: 'success', title: 'Claude terminó tu encargo', body: e.pedido.slice(0, 300) });
  return { status: 200, body: { ok: true } };
}

// Repositorio en memoria (pruebas y simulador). tablas: { so_claude_vinculos, so_encargos, so_messages, so_notifications }.
export function repoMemoria(t, { id = () => crypto.randomUUID() } = {}) {
  for (const k of ['so_claude_vinculos', 'so_encargos', 'so_messages', 'so_notifications']) t[k] ||= [];
  t.__secretos ||= {};
  return {
    async vinculo(o) { const v = t.so_claude_vinculos.find((x) => x.owner_id === o); return v ? { url: v.routine_url, token: t.__secretos[o] } : null; },
    async guardarVinculo(o, url, token) { const v = t.so_claude_vinculos.find((x) => x.owner_id === o); if (v) Object.assign(v, { routine_url: url, last_error: null }); else t.so_claude_vinculos.push({ owner_id: o, routine_url: url, last_fire_at: null, last_error: null, created_at: new Date().toISOString() }); t.__secretos[o] = token; },
    async borrarVinculo(o) { t.so_claude_vinculos = t.so_claude_vinculos.filter((x) => x.owner_id !== o); delete t.__secretos[o]; },
    async marcarVinculo(o, p) { const v = t.so_claude_vinculos.find((x) => x.owner_id === o); if (v) Object.assign(v, p); },
    async enCurso(o) { return t.so_encargos.filter((e) => e.owner_id === o && ['pendiente', 'enviado', 'en_curso'].includes(e.estado)).length; },
    async vencer(o, antes) { for (const e of t.so_encargos) if (e.owner_id === o && ['pendiente', 'enviado', 'en_curso'].includes(e.estado) && e.created_at < antes) Object.assign(e, { estado: 'fallo', error: 'venció sin respuesta de Claude', token_hash: null }); },
    async crear(f) { const e = { id: id(), resultado: null, error: null, session_url: null, started_at: null, finished_at: null, ...f }; t.so_encargos.push(e); return e; },
    async encargo(i) { return t.so_encargos.find((e) => e.id === i) || null; },
    async actualizar(i, p, { estados }) { const e = t.so_encargos.find((x) => x.id === i); if (!e || !estados.includes(e.estado)) return null; Object.assign(e, p); return e; },
    async mensaje(m) { const n = { id: (t.__seq = (t.__seq || 1) + 1), role: 'assistant', created_at: new Date().toISOString(), ...m }; t.so_messages.push(n); return n; },
    async aviso(a) { t.so_notifications.push({ id: (t.__seq = (t.__seq || 1) + 1), read_at: null, created_at: new Date().toISOString(), group_key: null, artifact_id: null, task_id: null, ...a }); },
  };
}
