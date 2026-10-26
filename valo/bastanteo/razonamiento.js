// GENERADO desde razonamiento.mts con `npm run build:estado`: no editar a mano.
(function (root) {
"use strict";
// Contexto del chat de Bastanteo (ChatContext) y verificación de los ítems de razonamiento (ReasoningItem).
// El ChatContext es un recorte cerrado del modelo de Bastanteo (un grupo, un agrupamiento y, opcionalmente, una regla):
// se valida antes de usarlo y un contexto inválido nunca inicializa ni reverifica ítems. El razonamiento (humano, Skill o
// del modelo) nunca modifica el ChatContext.

// Una QUESTION no usa VerificationStatus: su verification es null.

// ------------------------------------------------------------------ validación

const CAMPOS_RAIZ                    = ['bastanteoId', 'grupoId', 'agrupamientoId', 'version', 'grupo', 'firmantes', 'pertenencias', 'agrupamiento', 'participaciones'];
const OPCIONALES_RAIZ                    = ['regla'];
const CAMPOS_GRUPO                    = ['id', 'nombre'];
const CAMPOS_FIRMANTE                    = ['id', 'nombre'];
const CAMPOS_PERTENENCIA                    = ['id', 'grupoId', 'firmanteId'];
const CAMPOS_AGRUPAMIENTO                    = ['id', 'grupoId', 'nombre'];
const CAMPOS_PARTICIPACION                    = ['agrupamientoId', 'firmanteId'];
const CAMPOS_REGLA                    = ['id', 'agrupamientoId', 'descripcion'];

const esRegistro = (v         )                => typeof v === 'object' && v !== null && !Array.isArray(v);
const tiene = (r          , k        )          => Object.hasOwn(r, k);

// Objeto con campos exactos: faltantes (en el orden del contrato) y desconocidos (en orden alfabético).
function forma(v         , path        , requeridos                   , opcionales                   , errores         )                  {
  if (!esRegistro(v)) { errores.push({ code: 'INVALID_VALUE', path, message: 'Debe ser un objeto' }); return null; }
  requeridos.forEach(k => { if (!tiene(v, k)) errores.push({ code: 'MISSING_FIELD', path: `${path}.${k}`, message: `Falta el campo ${k}` }); });
  Object.keys(v).sort().forEach(k => {
    if (!requeridos.includes(k) && !opcionales.includes(k)) errores.push({ code: 'UNKNOWN_FIELD', path: `${path}.${k}`, message: `Campo desconocido ${k}` });
  });
  return v;
}
// ID y versión: texto no vacío. Nombre y descripción: texto. Un campo ausente ya se informó como MISSING_FIELD.
function id(r          , k        , path        , errores         )                {
  if (!tiene(r, k)) return null;
  const v = r[k];
  if (typeof v !== 'string' || v === '') { errores.push({ code: 'INVALID_VALUE', path: `${path}.${k}`, message: `${k} debe ser un texto no vacío` }); return null; }
  return v;
}
function texto(r          , k        , path        , errores         )                {
  if (!tiene(r, k)) return null;
  const v = r[k];
  if (typeof v !== 'string') { errores.push({ code: 'INVALID_VALUE', path: `${path}.${k}`, message: `${k} debe ser un texto` }); return null; }
  return v;
}
function lista   (r          , k        , path        , errores         , item                                     )                      {
  if (!tiene(r, k)) return null;
  const v          = r[k];
  if (!Array.isArray(v)) { errores.push({ code: 'INVALID_VALUE', path: `${path}.${k}`, message: `${k} debe ser una lista` }); return null; }
  const items                     = v;
  return items.map((x, i) => item(x, `${path}.${k}[${i}]`));
}

const leerGrupo = (errores         ) => (v         , p        )               => {
  const r = forma(v, p, CAMPOS_GRUPO, [], errores);
  if (!r) return null;
  const i = id(r, 'id', p, errores), nombre = texto(r, 'nombre', p, errores);
  return i !== null && nombre !== null ? { id: i, nombre } : null;
};
const leerFirmante = (errores         ) => (v         , p        )                  => {
  const r = forma(v, p, CAMPOS_FIRMANTE, [], errores);
  if (!r) return null;
  const i = id(r, 'id', p, errores), nombre = texto(r, 'nombre', p, errores);
  return i !== null && nombre !== null ? { id: i, nombre } : null;
};
const leerPertenencia = (errores         ) => (v         , p        )                     => {
  const r = forma(v, p, CAMPOS_PERTENENCIA, [], errores);
  if (!r) return null;
  const i = id(r, 'id', p, errores), grupoId = id(r, 'grupoId', p, errores), firmanteId = id(r, 'firmanteId', p, errores);
  return i !== null && grupoId !== null && firmanteId !== null ? { id: i, grupoId, firmanteId } : null;
};
const leerAgrupamiento = (errores         ) => (v         , p        )                      => {
  const r = forma(v, p, CAMPOS_AGRUPAMIENTO, [], errores);
  if (!r) return null;
  const i = id(r, 'id', p, errores), grupoId = id(r, 'grupoId', p, errores), nombre = texto(r, 'nombre', p, errores);
  return i !== null && grupoId !== null && nombre !== null ? { id: i, grupoId, nombre } : null;
};
const leerParticipacion = (errores         ) => (v         , p        )                       => {
  const r = forma(v, p, CAMPOS_PARTICIPACION, [], errores);
  if (!r) return null;
  const agrupamientoId = id(r, 'agrupamientoId', p, errores), firmanteId = id(r, 'firmanteId', p, errores);
  return agrupamientoId !== null && firmanteId !== null ? { agrupamientoId, firmanteId } : null;
};
const leerRegla = (errores         ) => (v         , p        )               => {
  const r = forma(v, p, CAMPOS_REGLA, [], errores);
  if (!r) return null;
  const i = id(r, 'id', p, errores), agrupamientoId = id(r, 'agrupamientoId', p, errores), descripcion = texto(r, 'descripcion', p, errores);
  return i !== null && agrupamientoId !== null && descripcion !== null ? { id: i, agrupamientoId, descripcion } : null;
};

const presentes =     (l                       )      => l.filter((x)         => x !== null);

function duplicados(l                                       , path        , errores         )       {
  if (!l) return;
  const vistos = new Set    ();
  l.forEach((x, i) => {
    if (!x) return;
    if (vistos.has(x.id)) errores.push({ code: 'DUPLICATE_ID', path: `${path}[${i}].id`, message: `ID duplicado ${x.id}` });
    vistos.add(x.id);
  });
}

// Único validador: estructura (recursiva) y después identidad, referencias y relaciones. Devuelve el ChatContext tipado
// solo si no hay ningún error.
function parseChatContext(value         )                   {
  const errores          = [];
  if (!esRegistro(value)) return { ok: false, errors: [{ code: 'INVALID_VALUE', path: '$', message: 'ChatContext debe ser un objeto' }] };
  const r = value;
  forma(r, '$', CAMPOS_RAIZ, OPCIONALES_RAIZ, errores);
  const bastanteoId = id(r, 'bastanteoId', '$', errores);
  const grupoId = id(r, 'grupoId', '$', errores);
  const agrupamientoId = id(r, 'agrupamientoId', '$', errores);
  const version = id(r, 'version', '$', errores);
  const grupo = tiene(r, 'grupo') ? leerGrupo(errores)(r['grupo'], '$.grupo') : null;
  const firmantes = lista(r, 'firmantes', '$', errores, leerFirmante(errores));
  const pertenencias = lista(r, 'pertenencias', '$', errores, leerPertenencia(errores));
  const agrupamiento = tiene(r, 'agrupamiento') ? leerAgrupamiento(errores)(r['agrupamiento'], '$.agrupamiento') : null;
  const participaciones = lista(r, 'participaciones', '$', errores, leerParticipacion(errores));
  const conRegla = tiene(r, 'regla');
  const regla = conRegla ? leerRegla(errores)(r['regla'], '$.regla') : null;

  // Relaciones, en el orden del contrato. Solo se controla lo que tiene estructura válida.
  if (grupo && grupoId !== null && grupo.id !== grupoId)
    errores.push({ code: 'INVALID_RELATION', path: '$.grupo.id', message: 'grupo.id debe ser grupoId' });
  duplicados(firmantes, '$.firmantes', errores);
  const idsFirmantes = new Set(presentes(firmantes || []).map(f => f.id));
  duplicados(pertenencias, '$.pertenencias', errores);
  (pertenencias || []).forEach((p, i) => {
    if (!p) return;
    if (grupoId !== null && p.grupoId !== grupoId)
      errores.push({ code: 'INVALID_RELATION', path: `$.pertenencias[${i}].grupoId`, message: 'La pertenencia debe ser al grupo del contexto' });
    if (firmantes && !idsFirmantes.has(p.firmanteId))
      errores.push({ code: 'INVALID_REFERENCE', path: `$.pertenencias[${i}].firmanteId`, message: `No existe el firmante ${p.firmanteId}` });
  });
  if (agrupamiento && agrupamientoId !== null && agrupamiento.id !== agrupamientoId)
    errores.push({ code: 'INVALID_RELATION', path: '$.agrupamiento.id', message: 'agrupamiento.id debe ser agrupamientoId' });
  if (agrupamiento && grupoId !== null && agrupamiento.grupoId !== grupoId)
    errores.push({ code: 'INVALID_RELATION', path: '$.agrupamiento.grupoId', message: 'El agrupamiento debe ser del grupo del contexto' });
  (participaciones || []).forEach((x, i) => {
    if (!x) return;
    if (agrupamientoId !== null && x.agrupamientoId !== agrupamientoId)
      errores.push({ code: 'INVALID_RELATION', path: `$.participaciones[${i}].agrupamientoId`, message: 'La participación debe ser en el agrupamiento del contexto' });
    if (firmantes && !idsFirmantes.has(x.firmanteId))
      errores.push({ code: 'INVALID_REFERENCE', path: `$.participaciones[${i}].firmanteId`, message: `No existe el firmante ${x.firmanteId}` });
    else if (pertenencias && grupoId !== null && !presentes(pertenencias).some(p => p.grupoId === grupoId && p.firmanteId === x.firmanteId))
      errores.push({ code: 'INVALID_RELATION', path: `$.participaciones[${i}]`, message: `El firmante ${x.firmanteId} participa sin pertenecer al grupo` });
  });
  if (regla && agrupamientoId !== null && regla.agrupamientoId !== agrupamientoId)
    errores.push({ code: 'INVALID_RELATION', path: '$.regla.agrupamientoId', message: 'La regla debe ser del agrupamiento del contexto' });

  if (errores.length) return { ok: false, errors: errores };
  if (bastanteoId === null || grupoId === null || agrupamientoId === null || version === null || !grupo || !firmantes || !pertenencias || !agrupamiento || !participaciones || (conRegla && !regla))
    throw new Error('ChatContext sin errores e incompleto');
  const context              = { bastanteoId, grupoId, agrupamientoId, version, grupo, firmantes: presentes(firmantes), pertenencias: presentes(pertenencias),
    agrupamiento, participaciones: presentes(participaciones) };
  if (regla) context.regla = regla;
  return { ok: true, context };
}

function validateChatContext(value         )                        {
  const r = parseChatContext(value);
  return r.ok ? { valid: true } : { valid: false, errors: r.errors };
}

// ------------------------------------------------------------------ respaldo directo e inicialización

const normalizar = (s        )         => s.trim().replace(/\s+/g, ' ');

// Hechos que el ChatContext contiene explícitamente, en forma canónica. Un FACT está respaldado solo si su texto es
// exactamente uno de ellos (sin inferir ni interpretar); si coincide con más de uno, es ambiguo.
function contextFacts(c             )           {
  return [
    `Grupo ${c.grupo.id}: ${c.grupo.nombre}`,
    ...c.firmantes.map(f => `Firmante ${f.id}: ${f.nombre}`),
    ...c.pertenencias.map(p => `Firmante ${p.firmanteId} pertenece al grupo ${p.grupoId}`),
    `Agrupamiento ${c.agrupamiento.id} del grupo ${c.agrupamiento.grupoId}: ${c.agrupamiento.nombre}`,
    ...c.participaciones.map(x => `Firmante ${x.firmanteId} participa en el agrupamiento ${x.agrupamientoId}`),
    ...(c.regla ? [`Regla ${c.regla.id} del agrupamiento ${c.regla.agrupamientoId}: ${c.regla.descripcion}`] : []),
  ].map(normalizar);
}

function isDirectlyBackedByContext(text        , context             )          {
  const r = parseChatContext(context);
  if (!r.ok) return false;
  const t = normalizar(text);
  return t !== '' && contextFacts(r.context).filter(h => h === t).length === 1;
}

function estadoInicial(type                        , source                 , text        , context             )                     {
  if (type === 'FACT' && source === 'BASTANTEO') return isDirectlyBackedByContext(text, context) ? 'VERIFIED' : 'UNVERIFIED';
  return 'UNVERIFIED';
}

function initialVerification(item                                                 , context             )                            {
  if (item.type === 'QUESTION') return null;
  return estadoInicial(item.type, item.source, item.text, context);
}

// Un ítem solo se crea contra un ChatContext válido.
function createReasoningItem(input                    , context         )                        {
  const r = parseChatContext(context);
  if (!r.ok) return r;
  const base = { id: input.id, contextVersion: r.context.version, source: input.source, text: input.text };
  if (input.type === 'QUESTION') return { ok: true, item: { ...base, type: 'QUESTION', verification: null } };
  return { ok: true, item: { ...base, type: input.type, verification: estadoInicial(input.type, input.source, input.text, r.context) } };
}

// ------------------------------------------------------------------ transiciones por evidencia

// Evidencia respecto del texto del ítem: SUPPORTS = a favor suficiente; CONTRADICTS = contradictoria suficiente;
// COMPATIBLE = compatible con el estado actual; INCONCLUSIVE = insuficiente, inconclusa o conflictiva.
// Su origen es BASTANTEO, HUMAN o SKILL: una respuesta del modelo no es evidencia.

const TRANSICIONES                                                                                               = {
  UNVERIFIED: { SUPPORTS: 'VERIFIED', CONTRADICTS: 'REFUTED', INCONCLUSIVE: 'INDETERMINATE', COMPATIBLE: 'UNVERIFIED' },
  VERIFIED: { SUPPORTS: 'VERIFIED', COMPATIBLE: 'VERIFIED', CONTRADICTS: 'REFUTED', INCONCLUSIVE: 'INDETERMINATE' },
  REFUTED: { SUPPORTS: 'VERIFIED', COMPATIBLE: 'REFUTED', CONTRADICTS: 'REFUTED', INCONCLUSIVE: 'INDETERMINATE' },
  INDETERMINATE: { SUPPORTS: 'VERIFIED', CONTRADICTS: 'REFUTED', INCONCLUSIVE: 'INDETERMINATE', COMPATIBLE: 'INDETERMINATE' },
};

function startVerification(item                )                     {
  return { item, evidenceIds: [], history: [{ from: null, to: item.verification, cause: { type: 'INITIAL', contextVersion: item.contextVersion } }] };
}

// Sin evidencia nueva (ninguna, ya aplicada o de otro contexto) el registro no cambia.
function applyEvidence(record                    , evidence                 )                     {
  if (!evidence || evidence.contextVersion !== record.item.contextVersion || record.evidenceIds.includes(evidence.id)) return record;
  const from = record.item.verification, to = TRANSICIONES[from][evidence.kind];
  return { item: { ...record.item, verification: to }, evidenceIds: [...record.evidenceIds, evidence.id],
    history: [...record.history, { from, to, cause: { type: 'EVIDENCE', evidenceId: evidence.id, kind: evidence.kind } }] };
}

// Otra versión de contexto invalida la verificación anterior: se reinicializa contra el contexto nuevo (validado),
// la evidencia previa deja de contar y el historial se conserva.
function changeContext(record                    , context         )                {
  const r = parseChatContext(context);
  if (!r.ok) return r;
  const c = r.context;
  if (c.version === record.item.contextVersion) return { ok: true, record };
  const { item } = record, to = estadoInicial(item.type, item.source, item.text, c);
  return { ok: true, record: { item: { ...item, contextVersion: c.version, verification: to }, evidenceIds: [],
    history: [...record.history, { from: item.verification, to, cause: { type: 'CONTEXT_CHANGE', contextVersion: c.version } }] } };
}

const api = { parseChatContext, validateChatContext, isDirectlyBackedByContext, contextFacts, initialVerification, createReasoningItem, startVerification, applyEvidence, changeContext };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.VALO_BASTANTEO_RAZONAMIENTO = api;
})(typeof window !== "undefined" ? window : globalThis);
