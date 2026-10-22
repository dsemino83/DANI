// Carga masiva: archivo -> detalle previo (sin llamar APIs de transferencia) -> confirmar ->
// aprobación del lote por otro usuario -> una llamada al banco por fila válida.
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { operativa, tx } from '../db.js';
import { auditar } from '../auditoria.js';
import { conflicto, invalido, noEncontrado, prohibido, riesgoAlto } from '../errores.js';
import { evaluarRiesgo } from './riesgo.js';
import { cuentasHabilitadas, exigirCuenta } from '../permisos.js';
import { consultarCbu, cuentasPropias } from '../bdv/cliente.js';
import { armarRequest } from '../bdv/transferencias.js';
import { avisarPendiente, textoLote } from './mensajes.js';
import { crearPendiente, enviarUnaVez, exigirEnviosHabilitados, idsUsados, normalizarId, registrarResultado } from './transferencias.js';

const COLUMNAS = ['id', 'tipo', 'cuenta_origen', 'destino', 'cuit', 'importe', 'concepto', 'titular', 'codigo_mep'];
const TIPOS = { INMEDIATA: 'INMEDIATA', INTERNA: 'PROPIAS', PROPIAS: 'PROPIAS', TERCEROS: 'TERCEROS', MEP: 'MEP' };

// TXT de ancho fijo (PROPUESTA, a confirmar con Operaciones):
// tipo 1-10 · cuenta_origen 11-25 · destino 26-47 · cuit 48-58 · importe 59-73 (centavos, sin separador)
// · concepto 74-103 · codigo_mep 104-106 · id de la operación 107-146
export const LAYOUT_TXT = [['tipo', 0, 10], ['cuenta_origen', 10, 25], ['destino', 25, 47], ['cuit', 47, 58],
  ['importe', 58, 73], ['concepto', 73, 103], ['codigo_mep', 103, 106], ['id', 106, 146]];

export function leerTxt(texto) {
  return texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const f = Object.fromEntries(LAYOUT_TXT.map(([k, a, b]) => [k, l.slice(a, b).trim()]));
    f.importe = (Number(f.importe) / 100).toFixed(2);
    return f;
  });
}

export function leerCsv(texto) {
  return parseCsv(texto, { columns: (h) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, delimiter: [',', ';'] });
}

export async function leerXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const cab = ws.getRow(1).values.slice(1).map((v) => String(v ?? '').trim().toLowerCase());
  const filas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const vals = row.values.slice(1);
    filas.push(Object.fromEntries(cab.map((k, i) => [k, vals[i] == null ? '' : String(vals[i].text ?? vals[i]).trim()])));
  });
  return filas;
}

export function formatoDe(nombre) {
  const ext = nombre.toLowerCase().split('.').pop();
  if (ext === 'csv') return 'CSV';
  if (ext === 'xlsx') return 'XLSX';
  if (ext === 'txt') return 'TXT';
  throw invalido('Formato no admitido: subí CSV, XLSX o TXT');
}

// Valida cada fila sin tocar las APIs de transferencia. Sí consulta COELSA (getCustomerInformationCbu).
async function validarFila(f, ctx) {
  let referencia;
  try { referencia = normalizarId(f.id); } catch (e) { return e.message; }
  if (ctx.repetidos.get(referencia) > 1) return `ID ${referencia} repetido en el archivo`;
  if (ctx.usados.has(referencia)) return `ID ${referencia} ya cargado (OP-${ctx.usados.get(referencia)})`;
  const tipo = TIPOS[String(f.tipo ?? '').toUpperCase().replace(/^MEP-.*/, 'MEP')];
  if (!tipo) return 'Tipo inválido';
  const codigoMep = String(f.codigo_mep || String(f.tipo).toUpperCase().replace(/^MEP-?/, '') || '').toUpperCase();
  if (!ctx.operables.has(String(f.cuenta_origen))) return 'Sin permiso Operar sobre la cuenta origen';
  const origen = ctx.cuentasBanco.get(String(f.cuenta_origen));
  if (!origen) return 'Cuenta origen inexistente en el banco';
  const datos = { referencia, destino: f.destino, cuitDestino: f.cuit, importe: f.importe, concepto: f.concepto, conceptoLibre: f.concepto, titular: f.titular, codigoMep, conceptoFijo: 'VAR' };
  if (tipo === 'MEP' && /^D[LR]/.test(codigoMep)) datos.conceptoLibre = '';
  try {
    if (tipo === 'INMEDIATA' || (tipo === 'MEP' && /^\d{22}$/.test(String(f.destino)))) {
      const esCbu = /^\d{22}$/.test(String(f.destino));
      const r = await consultarCbu(esCbu ? { cbu: f.destino } : { alias: f.destino }).catch(() => null);
      if (!r) return 'CBU/alias inexistente en COELSA';
      if (r.activeAccount && r.activeAccount !== 'T') return 'Cuenta destino inactiva';
      datos.titular = datos.titular || r.headline;
      if (tipo === 'MEP') datos.cuitDestino = datos.cuitDestino || r.cuit;
    }
    armarRequest(tipo, origen, datos);
  } catch (e) {
    return e.message;
  }
  return { ok: true, tipo, datos };
}

export async function previa(req, { nombre, buffer }) {
  const formato = formatoDe(nombre);
  const filas = formato === 'CSV' ? leerCsv(buffer.toString('utf8')) : formato === 'TXT' ? leerTxt(buffer.toString('utf8')) : await leerXlsx(buffer);
  if (!filas.length) throw invalido('El archivo no tiene filas');
  if (filas.length > 5000) throw invalido('Máximo 5000 filas por lote');
  const faltan = formato !== 'TXT' ? ['id', 'tipo', 'cuenta_origen', 'destino', 'importe'].filter((k) => !(k in filas[0])) : [];
  if (faltan.length) throw invalido(`Faltan columnas: ${faltan.join(', ')}. Esperadas: ${COLUMNAS.join(', ')}`);
  const ctx = {
    operables: await cuentasHabilitadas(req.user.usuario, { operar: true }),
    cuentasBanco: new Map((await cuentasPropias()).map((c) => [String(c.productNumber), c])),
    repetidos: new Map(),
  };
  const ids = filas.map((f) => { try { return normalizarId(f.id); } catch { return null; } }).filter(Boolean);
  for (const id of ids) ctx.repetidos.set(id, (ctx.repetidos.get(id) ?? 0) + 1);
  ctx.usados = await idsUsados(operativa, [...new Set(ids)]);
  const resultado = [];
  for (const [i, f] of filas.entries()) {
    const v = await validarFila(f, ctx);
    resultado.push({ fila: i + 1, datos: v.ok ? { ...v.datos, tipo: v.tipo, cuenta_origen: String(f.cuenta_origen) } : f, validacion: v.ok ? 'OK' : v });
  }
  const validas = resultado.filter((r) => r.validacion === 'OK');
  const importe = validas.reduce((s, r) => s + Number(r.datos.importe), 0);
  return tx(operativa, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO lote (archivo, formato, filas, validas, con_error, importe, estado, creador)
       VALUES ($1, $2, $3, $4, $5, $6, 'PREVIA', $7) RETURNING id`,
      [nombre, formato, resultado.length, validas.length, resultado.length - validas.length, importe, req.user.usuario]);
    const loteId = rows[0].id;
    for (const r of resultado) {
      await c.query('INSERT INTO lote_fila (lote_id, fila, datos, validacion) VALUES ($1, $2, $3, $4)', [loteId, r.fila, r.datos, r.validacion]);
    }
    await auditar(c, req, {
      tipo: 'Transferencias', accion: 'Subió archivo masivo', ref: { tipo: 'lote', id: loteId },
      detalle: `${nombre} · ${resultado.length} filas, ${resultado.length - validas.length} con error`,
    });
    return { loteId, formato, filas: resultado.length, validas: validas.length, conError: resultado.length - validas.length, importe, detalle: resultado };
  });
}

// Confirmar: crea una transferencia PENDIENTE_APROBACION por fila válida (nada va al banco todavía).
export async function confirmar(req, loteId) {
  const cuentasBanco = new Map((await cuentasPropias()).map((c) => [String(c.productNumber), c]));
  return tx(operativa, async (c) => {
    const { rows } = await c.query('SELECT * FROM lote WHERE id = $1 FOR UPDATE', [loteId]);
    const lote = rows[0];
    if (!lote) throw noEncontrado('Lote inexistente');
    if (lote.creador !== req.user.usuario) throw prohibido('Solo quien subió el lote puede confirmarlo');
    if (lote.estado !== 'PREVIA') throw conflicto(`El lote está en estado ${lote.estado}`);
    const filas = (await c.query(`SELECT * FROM lote_fila WHERE lote_id = $1 AND validacion = 'OK' ORDER BY fila`, [loteId])).rows;
    if (!filas.length) throw invalido('El lote no tiene filas válidas');
    for (const f of filas) {
      await exigirCuenta(req.user.usuario, f.datos.cuenta_origen, { operar: true });
      await crearPendiente(c, req, { tipo: f.datos.tipo, origen: cuentasBanco.get(f.datos.cuenta_origen), datos: f.datos, loteId });
    }
    await c.query(`UPDATE lote SET estado = 'PENDIENTE_APROBACION' WHERE id = $1`, [loteId]);
    await auditar(c, req, {
      tipo: 'Transferencias', accion: 'Cargó lote masivo de transferencias', ref: { tipo: 'lote', id: loteId },
      detalle: `Lote ${loteId} · ${lote.archivo} · ${filas.length} transferencias · ${lote.importe} · queda pendiente de aprobación`,
    });
    await avisarPendiente(c, req, { refTipo: 'lote', refId: loteId, cuentas: filas.map((f) => f.datos.cuenta_origen), ...textoLote(req, lote, filas.length) });
    return { loteId, estado: 'PENDIENTE_APROBACION', transferencias: filas.length };
  });
}

export async function decidir(req, loteId, aprobarLote) {
  if (aprobarLote) exigirEnviosHabilitados();
  const items = await tx(operativa, async (c) => {
    const { rows } = await c.query('SELECT * FROM lote WHERE id = $1 FOR UPDATE', [loteId]);
    const lote = rows[0];
    if (!lote) throw noEncontrado('Lote inexistente');
    if (lote.estado !== 'PENDIENTE_APROBACION') throw conflicto(`El lote está en estado ${lote.estado}`);
    if (lote.creador === req.user.usuario) throw prohibido('No podés aprobar ni rechazar un lote que cargaste vos');
    const ts = (await c.query(`SELECT * FROM transferencia WHERE lote_id = $1 AND estado = 'PENDIENTE_APROBACION' FOR UPDATE`, [loteId])).rows;
    for (const t of ts) await exigirCuenta(req.user.usuario, t.cuenta_origen);
    // Señales de fraude por transferencia del lote: con alguna de riesgo ALTO, aprobar exige confirmación explícita
    const riesgos = await evaluarRiesgo(ts.map((t) => t.id), c);
    const altos = ts.filter((t) => riesgos.get(Number(t.id))?.nivel === 'alto');
    if (aprobarLote && altos.length && req.body?.confirmoRiesgo !== true) {
      throw riesgoAlto(`Riesgo ALTO en ${altos.length} transferencia(s) del lote (${altos.map((t) => `OP-${t.id}`).join(', ')}). Revisá y confirmá para aprobar.`);
    }
    const estado = aprobarLote ? 'ENVIANDO' : 'RECHAZADA';
    for (const t of ts) {
      const u = await c.query(`UPDATE transferencia SET estado = $2, aprobador = $3, aprobado_en = now(), actualizado_en = now()
                                WHERE id = $1 AND estado = 'PENDIENTE_APROBACION'`, [t.id, estado, req.user.usuario]);
      if (u.rowCount !== 1) throw conflicto(`La transferencia OP-${t.id} del lote ya fue procesada`);
      await c.query('INSERT INTO transferencia_estado (transferencia_id, estado, usuario, detalle) VALUES ($1, $2, $3, $4)',
        [t.id, estado, req.user.usuario, `${aprobarLote ? 'Aprobada' : 'Rechazada'} con el lote ${loteId}`]);
    }
    await c.query('UPDATE lote SET estado = $2, aprobador = $3, aprobado_en = now() WHERE id = $1',
      [loteId, aprobarLote ? 'PROCESADO' : 'RECHAZADO', req.user.usuario]);
    await auditar(c, req, {
      tipo: 'Transferencias', accion: aprobarLote ? 'Aprobó lote masivo' : 'Rechazó lote masivo', ref: { tipo: 'lote', id: loteId },
      detalle: `Lote ${loteId} · ${ts.length} transferencias · ${lote.importe} · cargado por ${lote.creador} · riesgo alto en ${altos.length}${altos.length && aprobarLote ? ' (confirmado por el aprobador)' : ''}`,
    });
    return ts;
  });
  if (!aprobarLote) return { loteId, estado: 'RECHAZADO' };
  // Una llamada individual al banco por fila, secuencial para no saturar la sesión compartida.
  const resultados = [];
  for (const t of items) {
    let r;
    try { r = await enviarUnaVez(req, t); } catch (e) {
      if (e.status !== 409) throw e;
      resultados.push({ id: t.id, estado: 'YA_ENVIADA', detalle: e.message }); // nunca se reenvía
      continue;
    }
    await registrarResultado(req, t, r);
    resultados.push({ id: t.id, estado: r.estado, transactionId: r.transactionId });
  }
  return { loteId, estado: 'PROCESADO', resultados };
}

export async function descartar(req, loteId) {
  return tx(operativa, async (c) => {
    const lote = (await c.query('SELECT * FROM lote WHERE id = $1 FOR UPDATE', [loteId])).rows[0];
    if (!lote) throw noEncontrado('Lote inexistente');
    if (lote.creador !== req.user.usuario) throw prohibido('Solo quien subió el lote puede descartarlo');
    if (lote.estado !== 'PREVIA') throw conflicto(`El lote está en estado ${lote.estado}`);
    await c.query(`UPDATE lote SET estado = 'DESCARTADO' WHERE id = $1`, [loteId]);
    await auditar(c, req, { tipo: 'Transferencias', accion: 'Descartó archivo masivo', ref: { tipo: 'lote', id: loteId }, detalle: `Lote ${loteId} · ${lote.archivo}` });
    return { loteId, estado: 'DESCARTADO' };
  });
}
