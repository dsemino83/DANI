// Operaciones: se cargan internamente y solo se envían al banco cuando OTRO usuario las aprueba.
import { exigirAprobar, exigirCrear, exigirRol, ROLES_OPERATIVOS } from '../auth.js';
import { auditar } from '../auditoria.js';
import { fechaCorte, historica, operativa } from '../db.js';
import { invalido } from '../errores.js';
import { cuentasHabilitadas } from '../permisos.js';
import * as transferencias from '../servicios/transferencias.js';
import * as lotes from '../servicios/lotes.js';

const fechaOk = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f ?? '');

export default async function rutasTransferencias(app) {
  const operativos = { preHandler: exigirRol(...ROLES_OPERATIVOS) };

  // --- Crear (interno; no llama a ninguna API de transferencia) ---
  app.post('/transferencias', { preHandler: exigirCrear }, async (req, reply) => {
    reply.code(201);
    return transferencias.crear(req, req.body ?? {});
  });

  // --- Base operativa: hoy o hasta 3 meses ---
  app.get('/transferencias', operativos, async (req) => {
    const corte = fechaCorte();
    const desde = req.query.desde ?? new Date().toISOString().slice(0, 10), hasta = req.query.hasta ?? desde;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Rango de fechas inválido');
    if (desde < corte) throw invalido(`La base operativa guarda desde el ${corte}. Para fechas anteriores usá /historico/transferencias`);
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const { rows } = await operativa.query(
      `SELECT id, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, aprobador, estado, transaction_id, lote_id, creado_en, aprobado_en
         FROM transferencia
        WHERE creado_en >= $1::date AND creado_en < $2::date + 1 AND cuenta_origen = ANY($3)
          AND ($4::text IS NULL OR estado = $4)
        ORDER BY creado_en DESC LIMIT 5000`,
      [desde, hasta, cuentas, req.query.estado ?? null]);
    return { base: 'operativa', desde, hasta, transferencias: rows };
  });

  // --- Base histórica: solo fechas anteriores al corte, paginado en el servidor ---
  app.get('/historico/transferencias', operativos, async (req) => {
    const corte = fechaCorte();
    const { desde, hasta } = req.query;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) throw invalido('Indicá desde y hasta (AAAA-MM-DD)');
    if (hasta >= corte) throw invalido(`La base histórica tiene lo anterior al ${corte}. Para fechas posteriores usá /transferencias`);
    const pagina = Math.max(0, Number(req.query.pagina ?? 0)), tam = 500;
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const { rows } = await historica.query(
      `SELECT id, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, aprobador, estado, transaction_id, lote_id, creado_en, aprobado_en
         FROM transferencia
        WHERE creado_en >= $1::date AND creado_en < $2::date + 1 AND cuenta_origen = ANY($3)
        ORDER BY creado_en DESC OFFSET $4 LIMIT $5`,
      [desde, hasta, cuentas, pagina * tam, tam + 1]);
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó base histórica de transferencias', detalle: `${desde} a ${hasta} · página ${pagina}` });
    return { base: 'historica', desde, hasta, pagina, hayMas: rows.length > tam, transferencias: rows.slice(0, tam) };
  });

  // --- Auditoría de una operación (ruedita ⚙) ---
  app.get('/transferencias/:id/auditoria', operativos, async (req) => transferencias.auditoriaDeOperacion(req, Number(req.params.id)));

  // --- Bandeja de aprobación ---
  app.get('/aprobaciones', { preHandler: exigirAprobar }, async (req) => {
    const cuentas = [...(await cuentasHabilitadas(req.user.usuario)).keys()];
    const individuales = (await operativa.query(
      `SELECT id, tipo, api, cuenta_origen, moneda, destino, titular, importe, creador, creado_en, request
         FROM transferencia WHERE estado = 'PENDIENTE_APROBACION' AND lote_id IS NULL AND cuenta_origen = ANY($1)
        ORDER BY creado_en`, [cuentas])).rows;
    const lotesPend = (await operativa.query(
      `SELECT id, archivo, formato, validas, importe, creador, creado_en FROM lote WHERE estado = 'PENDIENTE_APROBACION' ORDER BY creado_en`)).rows;
    const marca = (x) => ({ ...x, propia: x.creador === req.user.usuario }); // la UI muestra "La cargaste vos"
    return { transferencias: individuales.map(marca), lotes: lotesPend.map(marca) };
  });

  app.post('/transferencias/:id/aprobar', { preHandler: exigirAprobar }, async (req) => transferencias.aprobar(req, Number(req.params.id)));
  app.post('/transferencias/:id/rechazar', { preHandler: exigirAprobar }, async (req) => transferencias.rechazar(req, Number(req.params.id)));

  // --- Carga masiva ---
  app.post('/lotes', { preHandler: exigirCrear }, async (req, reply) => {
    const archivo = await req.file();
    if (!archivo) throw invalido('Adjuntá el archivo (campo "archivo")');
    const buffer = await archivo.toBuffer();
    reply.code(201);
    return lotes.previa(req, { nombre: archivo.filename, buffer });
  });
  app.post('/lotes/:id/confirmar', { preHandler: exigirCrear }, async (req) => lotes.confirmar(req, Number(req.params.id)));
  app.post('/lotes/:id/aprobar', { preHandler: exigirAprobar }, async (req) => lotes.decidir(req, Number(req.params.id), true));
  app.post('/lotes/:id/rechazar', { preHandler: exigirAprobar }, async (req) => lotes.decidir(req, Number(req.params.id), false));
}
