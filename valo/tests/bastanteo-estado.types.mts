// Type-tests de la máquina de estados del análisis de Bastanteo. No se ejecutan: los verifica `npm run typecheck`
// (tsc --noEmit). Cada @ts-expect-error tiene que fallar en compilación; si un evento incompatible pasara a compilar,
// el @ts-expect-error queda sin uso y tsc da error.
import { initialState, transition } from '../bastanteo/estado.mts';
import type { BastanteoAnalysis, ErrorState, ReadyState, SendingState } from '../bastanteo/estado.mts';

declare const ready: ReadyState;
declare const sending: SendingState;
declare const error: ErrorState;
const analysis: BastanteoAnalysis = { status: 'OK', summary: '', findings: [] };

// IDLE no acepta SEND.
// @ts-expect-error SEND no es un evento de IDLE
transition(initialState, { type: 'SEND', requestId: 'r1' });

// READY no acepta RESPONSE (las respuestas solo se aceptan en SENDING; si llegan tarde van por receive()).
// @ts-expect-error RESPONSE no es un evento de READY
transition(ready, { type: 'RESPONSE', requestId: 'r1', contextVersion: 1, analysis });

// SENDING no acepta RETRY.
// @ts-expect-error RETRY no es un evento de SENDING
transition(sending, { type: 'RETRY', requestId: 'r2' });

// ERROR no acepta SEND.
// @ts-expect-error SEND no es un evento de ERROR
transition(error, { type: 'SEND', requestId: 'r2' });

// Los eventos válidos sí compilan.
transition(initialState, { type: 'LOAD_CONTEXT', grouping: 'G1' });
transition(ready, { type: 'SEND', requestId: 'r1' });
transition(ready, { type: 'SELECT_GROUPING', grouping: 'G2' });
transition(sending, { type: 'RESPONSE', requestId: 'r1', contextVersion: 1, analysis });
transition(sending, { type: 'SELECT_GROUPING', grouping: 'G2' });
transition(error, { type: 'RETRY', requestId: 'r2' });
transition(error, { type: 'RETRY_CONTEXT' });
