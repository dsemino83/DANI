// Operaciones: se cargan internamente y solo se envían al banco cuando OTRO usuario las aprueba.
import { exigirAprobar, exigirCrear, exigirRol, ROLES_OPERATIVOS } from '../auth.js';
import { auditar } from '../auditoria.js';
import { fechaCorte, historica, operativa } from '../db.js';
import { invalido } from '../errores.js';
import { cuentasHabilitadas } from '../permisos.js';
import * as transferencias from '../servicios/transferencias.js';
import { evaluarRiesgo } from '../servicios/riesgo.js';
import * as lotes from '../servicios/lotes.js';

const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f ?? '');
// Id numérico de la URL: uno mal armado es un pedido inválido (400), no un error de la base (500)
const idDe = (req) => { const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) throw invalido('Id inválido'); return id; };

// Cursor opaco de paginación del histórico: (creado_en con microsegundos en UTC, id)
const codificarCursor = (ts, id) => Buffer.from(JSON.stringify([ts, String(id)])).toString('base64url');
function cursorDe(valor) {
  if (!valor) return null;
  try {
    const [ts, id] = JSON.parse(Buffer.from(String(valor), 'base64url').toString('utf8'));
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/.test(ts) || !/^\d{1,18}$/.test(String(id))) throw new Error();
    return { ts, id: String(id) };
  } catch { throw invalido('Cursor inválido'); }
}

export default async function rutasTransferencias(app) {
  const operativos = { preHandler: exigirRol(...ROLES_OPERATIVOS) };

  // --- Crear (interno; no llama a ninguna API de transferencia) ---
  app.post('/transferencias', { preHandler: exigirCrear }, async (req, reply) => {
    reply.code(201);
    return transferencias.crear(req, req.body ?? {});
  });

  // --- Base operativa: desde el corte (mes en curso + meses de retención) ---
  app.get('/transferencias', operativos, async (req) => {
    const corte = await fechaCorte('transferencia');
    const desde = req.query.desde ?? new Date().toISOString().slice(0, 10), hasta = req.query.hasta ?? desde;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Rango de fechas inválido');
    if (desde < corte) throw invalido(`La base operativa guarda desde el ${corte}. Para fechas anteriores usá /historico/transferencias`);
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const { rows } = await operativa.query(
      `SELECT TOP (5000) id, referencia, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, aprobador, estado, transaction_id, lote_id, creado_en, aprobado_en
         FROM transferencia
        WHERE creado_en >= CAST($1 AS date) AND creado_en < DATEADD(day, 1, CAST($2 AS date)) AND cuenta_origen IN (SELECT value FROM OPENJSON($3))
          AND ($4 IS NULL OR estado = $4)
        ORDER BY creado_en DESC`,
      [desde, hasta, cuentas, req.query.estado ?? null]);
    return { base: 'operativa', desde, hasta, transferencias: rows };
  });

  // --- Base histórica: solo fechas anteriores al corte, paginado en el servidor ---
  app.get('/historico/transferencias', operativos, async (req) => {
    const corte = await fechaCorte('transferencia');
    const { desde, hasta } = req.query;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Indicá desde y hasta (AAAA-MM-DD)');
    if (hasta >= corte) throw invalido(`La base histórica tiene lo anterior al ${corte}. Para fechas posteriores usá /transferencias`);
    // Paginación por cursor (keyset sobre creado_en, id): estable y sin OFFSET aunque entren filas nuevas.
    const tam = 500;
    const cur = cursorDe(req.query.cursor);
    if (!cur && Number(req.query.pagina ?? 0) > 0) throw invalido('Paginá con "cursor" (el valor "siguiente" de la respuesta anterior)');
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const { rows } = await historica.query(
      `SELECT TOP ($6) id, referencia, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, aprobador, estado, transaction_id, lote_id, creado_en, aprobado_en,
              CONVERT(varchar(30), CAST(SWITCHOFFSET(creado_en, '+00:00') AS datetime2(3)), 126) + 'Z' AS cursor_ts
         FROM transferencia
        WHERE creado_en >= CAST($1 AS date) AND creado_en < DATEADD(day, 1, CAST($2 AS date)) AND cuenta_origen IN (SELECT value FROM OPENJSON($3))
          AND ($4 IS NULL OR creado_en < CAST($4 AS datetimeoffset(3)) OR (creado_en = CAST($4 AS datetimeoffset(3)) AND id < CAST($5 AS bigint)))
        ORDER BY creado_en DESC, id DESC`,
      [desde, hasta, cuentas, cur?.ts ?? null, cur?.id ?? null, tam + 1]);
    const hayMas = rows.length > tam;
    const pagina = rows.slice(0, tam);
    const ultima = pagina.at(-1);
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó base histórica de transferencias', detalle: `${desde} a ${hasta} · ${cur ? 'continuación' : 'primera página'}` });
    return { base: 'historica', desde, hasta, hayMas, siguiente: hayMas && ultima ? codificarCursor(ultima.cursor_ts, ultima.id) : null,
      transferencias: pagina.map(({ cursor_ts, ...t }) => t) };
  });

  // --- Motor de pagos: estado de la cola (operador, autorizante y auditor; no el administrador) ---
  app.get('/pagos/cola', operativos, async (req) => {
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const cols = `id, referencia, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, aprobador, estado, transaction_id, creado_en, aprobado_en, actualizado_en`;
    const [enCola, enviando, recientes] = await Promise.all([
      operativa.query(`SELECT ${cols} FROM transferencia WHERE estado = N'EN_COLA' AND cuenta_origen IN (SELECT value FROM OPENJSON($1)) ORDER BY creado_en, id`, [cuentas]),
      operativa.query(`SELECT ${cols} FROM transferencia WHERE estado = N'ENVIANDO' AND cuenta_origen IN (SELECT value FROM OPENJSON($1)) ORDER BY creado_en, id`, [cuentas]),
      operativa.query(`SELECT TOP (50) ${cols} FROM transferencia WHERE estado IN (N'DEBITADA', N'PEND_AUTORIZACION', N'RECHAZADA_BANCO', N'ERROR_API')
                         AND cuenta_origen IN (SELECT value FROM OPENJSON($1)) AND actualizado_en >= DATEADD(hour, -24, SYSDATETIMEOFFSET())
                       ORDER BY actualizado_en DESC`, [cuentas]),
    ]);
    // Resumen por endpoint: cuántas esperan y cuántas se están enviando.
    const porEndpoint = {};
    for (const t of enCola.rows) (porEndpoint[t.api] ??= { enCola: 0, enviando: 0 }).enCola++;
    for (const t of enviando.rows) (porEndpoint[t.api] ??= { enCola: 0, enviando: 0 }).enviando++;
    return { enCola: enCola.rows, enviando: enviando.rows, recientes: recientes.rows, porEndpoint };
  });

  // --- Auditoría de una operación (ruedita ⚙) ---
  app.get('/transferencias/:id/auditoria', operativos, async (req) => transferencias.auditoriaDeOperacion(req, idDe(req)));

  // Auditoría de un débito (⚙ en Débitos realizados): si lo originó una transferencia de la app, su historial
  app.get('/debitos/:movimiento/auditoria', operativos, async (req) => {
    const { rows } = await operativa.query('SELECT transferencia_id, cuenta FROM debito_transferencia WHERE movimiento_id = $1', [req.params.movimiento]);
    if (!rows[0]) {
      await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó auditoría de la operación', detalle: `débito ${req.params.movimiento} (sin transferencia de la app)` });
      return { origen: 'externo', movimiento: req.params.movimiento };
    }
    return { origen: 'home-banking', ...(await transferencias.auditoriaDeOperacion(req, Number(rows[0].transferencia_id))) };
  });

  // --- Bandeja de aprobación ---
  app.get('/aprobaciones', { preHandler: exigirAprobar }, async (req) => {
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const individuales = (await operativa.query(
      `SELECT id, referencia, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, creado_en, request
         FROM transferencia WHERE estado = N'PENDIENTE_APROBACION' AND lote_id IS NULL AND cuenta_origen IN (SELECT value FROM OPENJSON($1))
        ORDER BY creado_en`, [cuentas])).rows;
    const lotesPend = (await operativa.query(
      `SELECT id, archivo, formato, validas, importe, creador, creado_en FROM lote WHERE estado = N'PENDIENTE_APROBACION' ORDER BY creado_en`)).rows;
    const marca = (x) => ({ ...x, propia: x.creador === req.user.usuario }); // la UI muestra "La cargaste vos"
    // Señales de fraude: por transferencia; el lote toma el peor riesgo de sus transferencias
    const delLote = lotesPend.length ? (await operativa.query(`SELECT id, lote_id FROM transferencia WHERE estado = N'PENDIENTE_APROBACION' AND lote_id IN (SELECT CAST(value AS bigint) FROM OPENJSON($1))`,
      [lotesPend.map((l) => l.id)])).rows : [];
    const riesgos = await evaluarRiesgo([...individuales.map((t) => t.id), ...delLote.map((t) => t.id)]);
    const peor = (lista) => lista.reduce((a, r) => (!a || r.puntos > a.puntos ? r : a), null);
    return {
      transferencias: individuales.map((t) => ({ ...marca(t), riesgo: riesgos.get(Number(t.id)) ?? null })),
      lotes: lotesPend.map((l) => {
        const rs = delLote.filter((t) => String(t.lote_id) === String(l.id)).map((t) => ({ ...riesgos.get(Number(t.id)), op: Number(t.id) }));
        const p = peor(rs);
        return { ...marca(l), riesgo: p ? { ...p, altos: rs.filter((r) => r.nivel === 'alto').length } : null };
      }),
    };
  });

  app.post('/transferencias/:id/aprobar', { preHandler: exigirAprobar }, async (req) => transferencias.aprobar(req, idDe(req)));
  app.post('/transferencias/:id/rechazar', { preHandler: exigirAprobar }, async (req) => transferencias.rechazar(req, idDe(req)));

  // --- Carga masiva ---
  app.post('/lotes', { preHandler: exigirCrear }, async (req, reply) => {
    const archivo = await req.file();
    if (!archivo) throw invalido('Adjuntá el archivo (campo "archivo")');
    const buffer = await archivo.toBuffer();
    reply.code(201);
    return lotes.previa(req, { nombre: archivo.filename, buffer });
  });
  app.post('/lotes/:id/confirmar', { preHandler: exigirCrear }, async (req) => lotes.confirmar(req, idDe(req)));
  app.post('/lotes/:id/descartar', { preHandler: exigirCrear }, async (req) => lotes.descartar(req, idDe(req)));
  app.post('/lotes/:id/aprobar', { preHandler: exigirAprobar }, async (req) => lotes.decidir(req, idDe(req), true));
  app.post('/lotes/:id/rechazar', { preHandler: exigirAprobar }, async (req) => lotes.decidir(req, idDe(req), false));
}
