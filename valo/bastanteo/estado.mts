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

export type Grouping = string;

export interface BastanteoContext {
  readonly grouping: Grouping;
  readonly contextVersion: number;
  readonly data: unknown;
}

export interface BastanteoAnalysis {
  readonly status: 'OK' | 'ERROR';
  readonly summary: string;
  readonly findings: readonly string[];
}

export interface TechnicalError {
  readonly message: string;
}

export interface IdleState {
  readonly status: 'IDLE';
}
export interface LoadingContextState {
  readonly status: 'LOADING_CONTEXT';
  readonly grouping: Grouping;
  readonly contextVersion: number;
}
export interface ReadyState {
  readonly status: 'READY';
  readonly grouping: Grouping;
  readonly contextVersion: number;
  readonly context: BastanteoContext;
  readonly analysis: BastanteoAnalysis | null;
}
export interface SendingState {
  readonly status: 'SENDING';
  readonly grouping: Grouping;
  readonly contextVersion: number;
  readonly context: BastanteoContext;
  readonly requestId: string;
  readonly analysis: BastanteoAnalysis | null;
}
export interface ContextErrorState {
  readonly status: 'ERROR';
  readonly stage: 'CONTEXT';
  readonly grouping: Grouping;
  readonly contextVersion: number;
  readonly error: TechnicalError;
}
export interface RequestErrorState {
  readonly status: 'ERROR';
  readonly stage: 'REQUEST';
  readonly grouping: Grouping;
  readonly contextVersion: number;
  readonly context: BastanteoContext;
  readonly requestId: string;
  readonly error: TechnicalError;
  readonly analysis: BastanteoAnalysis | null;
}
export type ErrorState = ContextErrorState | RequestErrorState;
export type BastanteoState = IdleState | LoadingContextState | ReadyState | SendingState | ErrorState;

// Eventos del usuario.
export interface LoadContextEvent { readonly type: 'LOAD_CONTEXT'; readonly grouping: Grouping }
export interface SelectGroupingEvent { readonly type: 'SELECT_GROUPING'; readonly grouping: Grouping }
export interface SendEvent { readonly type: 'SEND'; readonly requestId: string }
export interface RetryEvent { readonly type: 'RETRY'; readonly requestId: string }
export interface RetryContextEvent { readonly type: 'RETRY_CONTEXT' }
// Mensajes asincrónicos (llegan de la carga del contexto o del análisis).
export interface ContextLoadedEvent { readonly type: 'CONTEXT_LOADED'; readonly contextVersion: number; readonly data: unknown }
export interface ContextFailedEvent { readonly type: 'CONTEXT_FAILED'; readonly contextVersion: number; readonly error: TechnicalError }
export interface ResponseEvent { readonly type: 'RESPONSE'; readonly requestId: string; readonly contextVersion: number; readonly analysis: BastanteoAnalysis }
export interface FailureEvent { readonly type: 'FAILURE'; readonly requestId: string; readonly contextVersion: number; readonly error: TechnicalError }

export type IdleEvent = LoadContextEvent;
export type LoadingContextEvent = ContextLoadedEvent | ContextFailedEvent | SelectGroupingEvent;
export type ReadyEvent = SendEvent | SelectGroupingEvent;
export type SendingEvent = ResponseEvent | FailureEvent | SelectGroupingEvent;
export type ErrorEvent = RetryEvent | RetryContextEvent | SelectGroupingEvent;
export type AsyncMessage = ContextLoadedEvent | ContextFailedEvent | ResponseEvent | FailureEvent;
export type BastanteoEvent = IdleEvent | LoadingContextEvent | ReadyEvent | SendingEvent | ErrorEvent;

export type IgnoredReason = 'STALE_CONTEXT' | 'STALE_REQUEST' | 'NOT_EXPECTED' | 'NO_CONTEXT' | 'EVENT_NOT_ALLOWED';
export type TransitionResult =
  | { readonly outcome: 'APPLIED'; readonly state: BastanteoState }
  | { readonly outcome: 'IGNORED'; readonly state: BastanteoState; readonly reason: IgnoredReason };

export function assertNever(value: never): never {
  throw new Error(`Caso no contemplado: ${JSON.stringify(value)}`);
}

export const initialState: IdleState = { status: 'IDLE' };

const applied = (state: BastanteoState): TransitionResult => ({ outcome: 'APPLIED', state });
const ignored = (state: BastanteoState, reason: IgnoredReason): TransitionResult => ({ outcome: 'IGNORED', state, reason });

// Cambiar de agrupamiento (o pedir el contexto de nuevo) siempre arranca una carga con una versión nueva: lo anterior
// (contexto, pedido en curso, análisis) deja de valer.
const loadContext = (grouping: Grouping, previousVersion: number): LoadingContextState =>
  ({ status: 'LOADING_CONTEXT', grouping, contextVersion: previousVersion + 1 });

// Una respuesta o un error del análisis solo vale para el pedido en curso y el contexto vigente.
const matchesRequest = (state: SendingState, message: ResponseEvent | FailureEvent): IgnoredReason | null =>
  message.contextVersion !== state.contextVersion ? 'STALE_CONTEXT' : message.requestId !== state.requestId ? 'STALE_REQUEST' : null;

function fromIdle(state: IdleState, event: BastanteoEvent): TransitionResult {
  if (event.type === 'LOAD_CONTEXT') return applied(loadContext(event.grouping, 0));
  return ignored(state, 'EVENT_NOT_ALLOWED');
}

function fromLoadingContext(state: LoadingContextState, event: BastanteoEvent): TransitionResult {
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

function fromReady(state: ReadyState, event: BastanteoEvent): TransitionResult {
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

function fromSending(state: SendingState, event: BastanteoEvent): TransitionResult {
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

function fromError(state: ErrorState, event: BastanteoEvent): TransitionResult {
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
function reduce(state: BastanteoState, event: BastanteoEvent): TransitionResult {
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
export function transition(state: IdleState, event: IdleEvent): TransitionResult;
export function transition(state: LoadingContextState, event: LoadingContextEvent): TransitionResult;
export function transition(state: ReadyState, event: ReadyEvent): TransitionResult;
export function transition(state: SendingState, event: SendingEvent): TransitionResult;
export function transition(state: ErrorState, event: ErrorEvent): TransitionResult;
export function transition(state: BastanteoState, event: BastanteoEvent): TransitionResult {
  return reduce(state, event);
}

// Mensajes asincrónicos en cualquier estado: si no corresponden al contexto o pedido vigente, IGNORED sin cambios.
export function receive(state: BastanteoState, message: AsyncMessage): TransitionResult {
  if (state.status === 'IDLE') return ignored(state, message.type === 'CONTEXT_LOADED' || message.type === 'CONTEXT_FAILED' ? 'STALE_CONTEXT' : 'STALE_REQUEST');
  return reduce(state, message);
}
