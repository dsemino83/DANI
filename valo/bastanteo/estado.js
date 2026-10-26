// GENERADO desde estado.mts con `npm run build:estado`: no editar a mano.
(function (root) {
"use strict";
// Máquina de estados del análisis de Bastanteo (pedido de análisis sobre el contexto del agrupamiento elegido).
//
// Estados: IDLE → LOADING_CONTEXT → READY → SENDING → READY, y ERROR (técnico) desde LOADING_CONTEXT o SENDING.
// - Cada carga de contexto (al pedirlo, al cambiar de agrupamiento o al reintentar) usa un contextVersion nuevo: lo que
//   llegue de una versión anterior queda obsoleto.
// - Una respuesta solo vale si coincide el requestId Y el contextVersion del pedido en curso. Una respuesta o un error
//   obsoleto devuelve IGNORED con el mismo objeto de estado (no lo modifica).
// - Un análisis con estado "ERROR" (el bastanteo encontró problemas) no es un error técnico: el estado vuelve a READY
//   con ese análisis. ERROR es solo para fallas técnicas (red, servidor, contexto que no se pudo cargar).
// - El último análisis se conserva mientras se envía un pedido nuevo o si ese pedido falla; cambiar de agrupamiento
//   invalida el contexto anterior y su análisis.
//
// transition(state, event) solo acepta, en compilación, los eventos de cada estado. receive(state, message) recibe lo
// que llega en forma asincrónica (contexto cargado, respuesta, error) en cualquier estado y lo ignora si es obsoleto.

// Eventos del usuario.

// Mensajes asincrónicos (llegan de la carga del contexto o del análisis).

function assertNever(value       )        {
  throw new Error(`Caso no contemplado: ${JSON.stringify(value)}`);
}

const initialState            = { status: 'IDLE' };

const applied = (state                )                   => ({ outcome: 'APPLIED', state });
const ignored = (state                , reason               )                   => ({ outcome: 'IGNORED', state, reason });

// Cambiar de agrupamiento (o pedir el contexto de nuevo) siempre arranca una carga con una versión nueva: lo anterior
// (contexto, pedido en curso, análisis) deja de valer.
const loadContext = (grouping          , previousVersion        )                      =>
  ({ status: 'LOADING_CONTEXT', grouping, contextVersion: previousVersion + 1 });

// Una respuesta o un error del análisis solo vale para el pedido en curso y el contexto vigente.
const matchesRequest = (state              , message                              )                       =>
  message.contextVersion !== state.contextVersion ? 'STALE_CONTEXT' : message.requestId !== state.requestId ? 'STALE_REQUEST' : null;

function fromIdle(state           , event                )                   {
  if (event.type === 'LOAD_CONTEXT') return applied(loadContext(event.grouping, 0));
  return ignored(state, 'EVENT_NOT_ALLOWED');
}

function fromLoadingContext(state                     , event                )                   {
  switch (event.type) {
    case 'SELECT_GROUPING':
      return applied(loadContext(event.grouping, state.contextVersion));
    case 'CONTEXT_LOADED':
      if (event.contextVersion !== state.contextVersion) return ignored(state, 'STALE_CONTEXT');
      return applied({ status: 'READY', grouping: state.grouping, contextVersion: state.contextVersion,
        context: { grouping: state.grouping, contextVersion: state.contextVersion, data: event.data }, analysis: null });
    case 'CONTEXT_FAILED':
      if (event.contextVersion !== state.contextVersion) return ignored(state, 'STALE_CONTEXT');
      return applied({ status: 'ERROR', stage: 'CONTEXT', grouping: state.grouping, contextVersion: state.contextVersion, error: event.error });
    case 'RESPONSE':
    case 'FAILURE':
      return ignored(state, 'STALE_REQUEST');
    case 'LOAD_CONTEXT':
    case 'SEND':
    case 'RETRY':
    case 'RETRY_CONTEXT':
      return ignored(state, 'EVENT_NOT_ALLOWED');
    default:
      return assertNever(event);
  }
}

function fromReady(state            , event                )                   {
  switch (event.type) {
    case 'SEND':
      return applied({ status: 'SENDING', grouping: state.grouping, contextVersion: state.contextVersion, context: state.context,
        requestId: event.requestId, analysis: state.analysis });
    case 'SELECT_GROUPING':
      return applied(loadContext(event.grouping, state.contextVersion));
    case 'RESPONSE':
    case 'FAILURE':
      return ignored(state, 'STALE_REQUEST');
    case 'CONTEXT_LOADED':
    case 'CONTEXT_FAILED':
      return ignored(state, 'STALE_CONTEXT');
    case 'LOAD_CONTEXT':
    case 'RETRY':
    case 'RETRY_CONTEXT':
      return ignored(state, 'EVENT_NOT_ALLOWED');
    default:
      return assertNever(event);
  }
}

function fromSending(state              , event                )                   {
  switch (event.type) {
    case 'RESPONSE': {
      const stale = matchesRequest(state, event);
      if (stale) return ignored(state, stale);
      // Un análisis "ERROR" es un resultado del bastanteo, no una falla técnica: vuelve a READY con ese análisis.
      return applied({ status: 'READY', grouping: state.grouping, contextVersion: state.contextVersion, context: state.context, analysis: event.analysis });
    }
    case 'FAILURE': {
      const stale = matchesRequest(state, event);
      if (stale) return ignored(state, stale);
      return applied({ status: 'ERROR', stage: 'REQUEST', grouping: state.grouping, contextVersion: state.contextVersion, context: state.context,
        requestId: state.requestId, error: event.error, analysis: state.analysis });
    }
    case 'SELECT_GROUPING':
      return applied(loadContext(event.grouping, state.contextVersion));
    case 'CONTEXT_LOADED':
    case 'CONTEXT_FAILED':
      return ignored(state, 'STALE_CONTEXT');
    case 'LOAD_CONTEXT':
    case 'SEND':
    case 'RETRY':
    case 'RETRY_CONTEXT':
      return ignored(state, 'EVENT_NOT_ALLOWED');
    default:
      return assertNever(event);
  }
}

function fromError(state            , event                )                   {
  switch (event.type) {
    case 'RETRY':
      // Reintentar el análisis necesita el contexto; si lo que falló fue la carga del contexto, se reintenta esa carga.
      if (state.stage !== 'REQUEST') return ignored(state, 'NO_CONTEXT');
      if (event.requestId === state.requestId) return ignored(state, 'STALE_REQUEST');
      return applied({ status: 'SENDING', grouping: state.grouping, contextVersion: state.contextVersion, context: state.context,
        requestId: event.requestId, analysis: state.analysis });
    case 'RETRY_CONTEXT':
      return applied(loadContext(state.grouping, state.contextVersion));
    case 'SELECT_GROUPING':
      return applied(loadContext(event.grouping, state.contextVersion));
    case 'RESPONSE':
    case 'FAILURE':
      return ignored(state, 'STALE_REQUEST');
    case 'CONTEXT_LOADED':
    case 'CONTEXT_FAILED':
      return ignored(state, 'STALE_CONTEXT');
    case 'LOAD_CONTEXT':
    case 'SEND':
      return ignored(state, 'EVENT_NOT_ALLOWED');
    default:
      return assertNever(event);
  }
}

// Núcleo sin restricciones de tipos (también lo usa receive). Un evento que el estado no admite se ignora.
function reduce(state                , event                )                   {
  switch (state.status) {
    case 'IDLE': return fromIdle(state, event);
    case 'LOADING_CONTEXT': return fromLoadingContext(state, event);
    case 'READY': return fromReady(state, event);
    case 'SENDING': return fromSending(state, event);
    case 'ERROR': return fromError(state, event);
    default: return assertNever(state);
  }
}

// Eventos permitidos por estado: un evento incompatible no compila.

function transition(state                , event                )                   {
  return reduce(state, event);
}

// Mensajes asincrónicos en cualquier estado: si no corresponden al contexto o pedido vigente, IGNORED sin cambios.
function receive(state                , message              )                   {
  if (state.status === 'IDLE') return ignored(state, message.type === 'CONTEXT_LOADED' || message.type === 'CONTEXT_FAILED' ? 'STALE_CONTEXT' : 'STALE_REQUEST');
  return reduce(state, message);
}

const api = { initialState, transition, receive, assertNever };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.VALO_BASTANTEO_ESTADO = api;
})(typeof window !== "undefined" ? window : globalThis);
