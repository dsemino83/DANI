// Ejecución de los envíos programados: por cliente, un extracto diario o una alerta de movimientos de la
// última media hora, a sus emails. Lo corre el servicio jobs cada minuto (y el administrador con "Ejecutar ahora").
import { operativa, tx } from '../db.js';
import { bdvEnvios, cuentasPropias, movimientos } from '../bdv/cliente.js';
import { enviarCorreo } from '../correo.js';
import { readFileSync } from 'node:fs';
import { cbuOrigen, xlsxEnvio } from '../excel.js';
import { feriadosCargados } from './feriados.js';
import { notificarChatAlerta } from './notificaciones-chat.js';
import { enArgentina, enFranja, franjaDeTurno, turnoVencido } from './programacion.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (v, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(v ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monedaDe = (c) => (Number(c.currencyId) === 80 ? 'ARS' : 'USD');
const MAX_MOVS = 100;

// Dos tipos de envío:
// - diaria: EXTRACTO DIARIO (saldos y/o movimientos del día); con formato 'cuerpo_excel' además va el Excel con el logo.
// - horaria: ALERTA DE MOVIMIENTOS de la franja (29:59 antes de la ejecución); si no hubo movimientos no se envía.
// En los dos el cuerpo del correo va completo: por cuenta (como título), débitos y créditos en tablas separadas.
export const LOGO_CID = 'logo-valo@homebanking';
const dmy = (fecha) => { const [a, m, d] = fecha.split('-'); return `${d}/${m}/${a}`; };
const nombreArchivo = (tipo, empresa, fecha) => `VALO_${tipo}_${empresa.cuit}_${fecha}.xlsx`;

function tabla(cab, filas, pie = null) {
  const th = cab.map(([t, num]) => `<th align="${num ? 'right' : 'left'}" style="background:#CE162E;color:#fff;padding:6px 8px;font-weight:bold">${t}</th>`).join('');
  const tds = (fila) => fila.map(([v, num]) => `<td align="${num ? 'right' : 'left'}" style="padding:6px 8px;border-bottom:1px solid #eee${num ? ';white-space:nowrap' : ''}">${v}</td>`).join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;margin:4px 0 12px">
    <tr>${th}</tr>${filas.map((f) => `<tr>${tds(f)}</tr>`).join('')}${pie ? `<tr>${pie.map(([v, num]) => `<td align="${num ? 'right' : 'left'}" style="padding:6px 8px;font-weight:bold;border-top:2px solid #ccc;white-space:nowrap">${v}</td>`).join('')}</tr>` : ''}</table>`;
}

// Movimientos de una cuenta: débitos y créditos por separado, con todo el detalle que da el banco
// conSaldo: el extracto muestra el saldo de cada movimiento; la alerta no
function movimientosHtml(c, movs, max, { conSaldo = true } = {}) {
  const mon = monedaDe(c);
  let html = '', texto = '';
  for (const [dc, titulo] of [['D', 'Débitos'], ['C', 'Créditos']]) {
    const lista = movs.filter((m) => m.signDC === dc);
    const total = lista.reduce((a, m) => a + Number(m.amount ?? 0), 0);
    html += `<h4 style="margin:10px 0 2px;color:${dc === 'D' ? '#9b1022' : '#1b6e3a'}">${titulo} (${lista.length})</h4>`;
    texto += `  ${titulo}: ${lista.length} · total ${dinero(total, mon)}\n`;
    if (!lista.length) { html += `<p style="margin:0 0 8px;color:#727274">Sin ${titulo.toLowerCase()}.</p>`; continue; }
    const saldo = (m) => (conSaldo ? [[m.availableBalance == null ? '' : dinero(m.availableBalance, mon), 1]] : []);
    html += tabla([['Fecha'], ['Hora'], ['Descripción'], ['Beneficiario'], ['CUIT'], ['CBU origen'], ['ID'], ['Importe', 1], ...(conSaldo ? [['Saldo', 1]] : [])],
      lista.slice(0, max).map((m) => [[esc(m.processDate)], [esc(m.hour)], [esc(m.description)], [esc(m.beneficiary)], [esc(m.documentNumber)], [esc(cbuOrigen(m))],
        [esc(m.transactionId ?? m.sequential)], [dinero(m.amount, mon), 1], ...saldo(m)]),
      [['Total'], [''], [''], [''], [''], [''], [''], [dinero(total, mon), 1], ...(conSaldo ? [['']] : [])]);
    for (const m of lista.slice(0, max)) texto += `    ${m.hour ?? ''} ${m.description ?? ''} ${m.beneficiary ?? ''} ${dinero(m.amount, mon)}\n`;
    if (lista.length > max) html += `<p style="margin:0 0 8px">… y ${lista.length - max} ${titulo.toLowerCase()} más.</p>`;
  }
  return { html, texto };
}

const encabezado = (titulo) => `<div style="font-family:Arial,Helvetica,sans-serif;color:#2a2a2d;max-width:900px">
  <table cellpadding="0" cellspacing="0" style="width:100%;border-bottom:3px solid #CE162E;margin-bottom:16px"><tr>
    <td style="padding:0 0 10px"><img src="cid:${LOGO_CID}" alt="VALO · Banco de Valores" width="145" height="48" style="display:block"></td>
    <td align="right" style="padding:0 0 10px;font-size:14px;color:#727274">${titulo}</td></tr></table>`;
const pie = `<p style="font-size:11px;color:#727274;margin-top:24px;border-top:1px solid #eee;padding-top:8px">Correo automático del Home Banking VALO · Banco de Valores. No responder este mensaje. Ante cualquier duda comuníquese con su oficial de cuenta.</p></div>`;
const tituloCuenta = (c) => `<h3 style="margin:18px 0 4px;padding:6px 10px;background:#f4f4f5;border-left:4px solid #CE162E">Cuenta ${esc(c.productNumber)} · ${esc(c.productName ?? '')} · ${monedaDe(c)}</h3>`;

// Alerta de movimientos de la franja. Devuelve null si no hubo movimientos (no se envía nada).
export function armarAlerta(empresa, cuentas, franja, formato = 'cuerpo') {
  const conMovs = cuentas.filter((c) => c.errorMovimientos || c.movimientos?.length);
  if (!cuentas.some((c) => c.movimientos?.length)) return null;
  const f = `de las ${franja.desdeTxt.horaSeg} a las ${franja.hastaTxt.horaSeg} del ${dmy(franja.hastaTxt.fecha)}`
    + (franja.desdeTxt.fecha !== franja.hastaTxt.fecha ? ` (desde el ${dmy(franja.desdeTxt.fecha)})` : '');
  const n = cuentas.reduce((a, c) => a + (c.movimientos?.length ?? 0), 0);
  let html = `${encabezado('Alerta de movimientos')}
    <p>Estimado cliente <b>${esc(empresa.razon_social)}</b>:</p>
    <p>Queremos informarle los movimientos registrados en sus cuentas en la franja horaria <b>${f}</b> (hora de Argentina).
    Se registraron <b>${n}</b> movimiento(s).</p>`;
  let texto = `Estimado cliente ${empresa.razon_social}:\nQueremos informarle los movimientos registrados en sus cuentas en la franja horaria ${f} (hora de Argentina).\n`;
  for (const c of conMovs) {
    html += tituloCuenta(c); texto += `\nCUENTA ${c.productNumber} (${monedaDe(c)})\n`;
    if (c.errorMovimientos) { html += `<p>No se pudieron consultar: ${esc(c.errorMovimientos)}</p>`; continue; }
    const m = movimientosHtml(c, c.movimientos, 500, { conSaldo: false }); html += m.html; texto += m.texto;
  }
  const archivo = formato === 'cuerpo_excel' ? nombreArchivo('Alerta_de_movimientos', empresa, `${franja.hastaTxt.fecha}_${franja.hastaTxt.hora.replace(':', '')}`) : null;
  if (archivo) { html += `<p>Se adjunta el detalle en Excel: <b>${esc(archivo)}</b>.</p>`; texto += `\nSe adjunta el detalle en Excel: ${archivo}\n`; }
  html += pie;
  const asunto = `Alerta de movimientos · ${empresa.razon_social} · ${dmy(franja.hastaTxt.fecha)} ${franja.desdeTxt.hora} a ${franja.hastaTxt.hora}`;
  return { asunto, html, texto, archivo, titulo: `Alerta de movimientos · franja ${f}` };
}

// Extracto diario: saldos y/o movimientos del día de las cuentas elegidas (se envía aunque no haya movimientos)
export function armarExtracto(empresa, cuentas, contenido, fecha, formato = 'cuerpo') {
  const conSaldos = contenido !== 'movimientos', conMovs = contenido !== 'saldos';
  let html = `${encabezado('Extracto diario')}
    <p>Estimado cliente <b>${esc(empresa.razon_social)}</b>:</p>
    <p>Le enviamos el extracto diario de sus cuentas en Banco de Valores correspondiente al <b>${dmy(fecha)}</b>${conSaldos && conMovs ? ', con los saldos y los movimientos del día' : conSaldos ? ', con los saldos' : ', con los movimientos del día'}.</p>`;
  let texto = `Estimado cliente ${empresa.razon_social}:\nLe enviamos el extracto diario de sus cuentas en Banco de Valores correspondiente al ${dmy(fecha)}.\n`;
  if (conSaldos) {
    html += `<h3 style="margin:18px 0 4px">Saldos</h3>${tabla([['Cuenta'], ['Nombre'], ['Moneda'], ['Disponible', 1], ['Contable', 1]],
      cuentas.map((c) => [[esc(c.productNumber)], [esc(c.productName)], [monedaDe(c)], [dinero(c.availableBalance, monedaDe(c)), 1], [dinero(c.accountingBalance, monedaDe(c)), 1]]))}`;
    texto += `\nSALDOS\n${cuentas.map((c) => `${c.productNumber} ${c.productName ?? ''}: disponible ${dinero(c.availableBalance, monedaDe(c))}`).join('\n')}\n`;
  }
  if (conMovs) {
    for (const c of cuentas) {
      html += tituloCuenta(c); texto += `\nCUENTA ${c.productNumber} (${monedaDe(c)})\n`;
      if (c.errorMovimientos) { html += `<p>No se pudieron consultar: ${esc(c.errorMovimientos)}</p>`; continue; }
      if (!c.movimientos?.length) { html += '<p style="color:#727274">Sin movimientos en el día.</p>'; texto += '  Sin movimientos.\n'; continue; }
      const m = movimientosHtml(c, c.movimientos, MAX_MOVS); html += m.html; texto += m.texto;
    }
  }
  const archivo = formato === 'cuerpo_excel' ? nombreArchivo('Extracto_diario', empresa, fecha) : null;
  if (archivo) { html += `<p>Se adjunta el extracto en Excel con todos los movimientos: <b>${esc(archivo)}</b>.</p>`; texto += `\nSe adjunta el extracto en Excel: ${archivo}\n`; }
  else if (conMovs && cuentas.some((c) => (c.movimientos?.length ?? 0) > MAX_MOVS)) html += '<p>Para ver todos los movimientos, ingrese al Home Banking.</p>';
  html += pie;
  const asunto = `Envío de extracto diario · ${empresa.razon_social} · ${dmy(fecha)}`;
  return { asunto, html, texto, archivo, titulo: `Extracto diario al ${dmy(fecha)}` };
}

// ---------------- Cola de envíos ----------------
// El programador ENCOLA una tarea por cliente y turno; un único trabajador las PROCESA de a una, así los
// procesos no se superponen (ni dentro de una ejecución ni entre ejecuciones). Cada tarea termina en un correo.
const ESPERAS_MIN = [1, 5, 15]; // reintentos: 1, 5 y 15 minutos después de cada falla
const COLGADA_MIN = 10;         // una tarea "procesando" hace más de esto (proceso caído) vuelve a la cola

// Clientes que el aprobador responsable ve hoy (permiso Ver del administrador, empresa activa)
async function clientesVisibles(usuario) {
  return (await operativa.query(`SELECT e.* FROM empresa e JOIN permiso_empresa pe ON pe.empresa_id = e.id AND pe.usuario = $1 AND pe.ver
    WHERE e.activa ORDER BY e.razon_social`, [usuario])).rows;
}

// Id transaccional de cada ejecución (un turno de una programación o un "Ejecutar ahora"): agrupa sus tareas de la cola
export const codigoEjecucion = (id) => (id == null ? null : `EJ-${String(id).padStart(6, '0')}`);

// Encola un turno: en UNA transacción crea (o retoma) la ejecución y una tarea por cliente con su ejecucion_id.
// Un turno se encola una sola vez por cliente (UNIQUE de la cola) y una sola ejecución por turno (UNIQUE).
export async function encolarTurno(p, turno, { manual = false } = {}) {
  const responsable = p.actualizada_por ?? p.creada_por;
  const visibles = await clientesVisibles(responsable);
  const destinos = p.todas_empresas ? visibles.map((e) => ({ empresaId: Number(e.id), cuentas: [] })) : (p.destinos ?? []);
  return tx(operativa, async (c) => {
    const { rows: [ej] } = await c.query(`INSERT INTO ejecucion_envio (programacion_id, programacion, turno, frecuencia, manual, responsable)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (programacion_id, turno) DO UPDATE SET programacion = EXCLUDED.programacion RETURNING id`,
    [p.id, p.nombre, turno, p.frecuencia, manual, responsable]);
    let encoladas = 0;
    for (const d of destinos) {
      const e = visibles.find((x) => Number(x.id) === Number(d.empresaId));
      const q = await c.query(`INSERT INTO cola_envio (programacion_id, programacion, turno, empresa_id, empresa, cuentas, contenido, responsable, manual, formato, frecuencia, ejecucion_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (programacion_id, turno, empresa_id) DO NOTHING`,
      [p.id, p.nombre, turno, d.empresaId, e?.razon_social ?? `Empresa ${d.empresaId}`, d.cuentas ?? [], p.contenido, responsable, manual, p.formato ?? 'cuerpo', p.frecuencia, ej.id]);
      encoladas += q.rowCount;
    }
    await actualizarEjecucion(c, ej.id);
    return { encoladas, ejecucionId: Number(ej.id), ejecucion: codigoEjecucion(ej.id) };
  });
}

// Totales de la ejecución a partir de sus tareas; queda terminada cuando no le queda nada en cola ni en proceso
async function actualizarEjecucion(c, id) {
  if (id == null) return;
  await c.query(`UPDATE ejecucion_envio e SET tareas = x.tareas, enviadas = x.enviadas, omitidas = x.omitidas, errores = x.errores,
      estado = CASE WHEN x.abiertas = 0 THEN 'terminada' ELSE 'en_curso' END,
      terminada_en = CASE WHEN x.abiertas = 0 THEN coalesce(e.terminada_en, now()) ELSE NULL END
    FROM (SELECT count(*)::int AS tareas, count(*) FILTER (WHERE estado = 'enviado')::int AS enviadas,
                 count(*) FILTER (WHERE estado = 'omitido')::int AS omitidas, count(*) FILTER (WHERE estado = 'error')::int AS errores,
                 count(*) FILTER (WHERE estado IN ('pendiente', 'procesando'))::int AS abiertas
            FROM cola_envio WHERE ejecucion_id = $1) x
   WHERE e.id = $1`, [id]);
}

// Toma la próxima tarea disponible (SKIP LOCKED: si hubiera otro proceso, nunca toman la misma)
async function tomarTarea() {
  const { rows } = await operativa.query(`UPDATE cola_envio SET estado = 'procesando', tomada_en = now(), intentos = intentos + 1
    WHERE id = (SELECT id FROM cola_envio WHERE estado = 'pendiente' AND disponible_en <= now() ORDER BY disponible_en, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`);
  return rows[0] ?? null;
}

// Cierra la tarea, suma sus consultas al banco a la tarea y a su ejecución, y actualiza los totales de la ejecución
async function terminar(t, estado, detalle, destinatarios = [], banco = { consultas: 0 }) {
  await tx(operativa, async (c) => {
    await c.query(`UPDATE cola_envio SET estado = $2, detalle = $3, destinatarios = $4, terminada_en = now(), consultas_banco = consultas_banco + $5 WHERE id = $1`,
      [t.id, estado, String(detalle ?? '').slice(0, 1000), destinatarios, banco.consultas]);
    if (t.ejecucion_id != null) await c.query('UPDATE ejecucion_envio SET consultas_banco = consultas_banco + $2 WHERE id = $1', [t.ejecucion_id, banco.consultas]);
    await actualizarEjecucion(c, t.ejecucion_id);
  });
}

const LOGO = readFileSync(new URL('../assets/logo-valo.png', import.meta.url));

// ---------------- Consultas al banco, optimizadas para toda la cola ----------------
// Caché compartida por todas las tareas (un solo trabajador, de a una): cada clave se consulta una vez y, mientras está
// vigente, las demás tareas la reutilizan (también una consulta en vuelo). Solo cuentan como consultas las reales.
//  - Cuentas y saldos (getOwnAccounts): 60 s, para toda la cola.
//  - Movimientos de una cuenta y un día (getMovementsDetail): el día en curso 60 s (extracto y alerta del mismo cliente
//    en el mismo turno usan una sola consulta); días cerrados 30 min (no cambian).
// Solo se pide lo necesario: saldos sin movimientos no consultan movimientos; solo las cuentas elegidas del cliente; la
// alerta solo el día de la franja (y el anterior solo si cruza la medianoche); tareas omitidas no consultan nada.
const cacheBanco = new Map();
export const TTL_BANCO = { cuentas: 60_000, hoy: 60_000, cerrado: 30 * 60_000 };
function alBanco(clave, ttl, consultar, banco) {
  const hit = cacheBanco.get(clave);
  if (hit && Date.now() - hit.cuando < ttl) return hit.promesa;
  banco.consultas++;
  const promesa = consultar();
  cacheBanco.set(clave, { cuando: Date.now(), promesa });
  promesa.catch(() => cacheBanco.delete(clave)); // un error no queda guardado: la próxima tarea vuelve a consultar
  for (const [k, v] of cacheBanco) if (Date.now() - v.cuando > TTL_BANCO.cerrado) cacheBanco.delete(k);
  return promesa;
}
export const limpiarCacheBanco = () => cacheBanco.clear();
const cuentasDelBanco = (banco) => alBanco('cuentas', TTL_BANCO.cuentas, () => cuentasPropias(bdvEnvios), banco);
const movimientosDelDia = (c, dia, banco) => alBanco(`movs|${c.productNumber}|${dia}`, dia < enArgentina().fecha ? TTL_BANCO.cerrado : TTL_BANCO.hoy,
  async () => (await movimientos(c, dia, dia, bdvEnvios)).movimientos, banco);

export async function procesarTarea(t) {
  const e = (await clientesVisibles(t.responsable)).find((x) => Number(x.id) === Number(t.empresa_id));
  if (!e) return terminar(t, 'omitido', `El aprobador ${t.responsable} ya no ve este cliente (o está inactivo)`);
  if (!e.emails?.length) return terminar(t, 'omitido', 'El cliente no tiene emails');
  const activas = (await operativa.query(`SELECT product_number FROM empresa_cbu WHERE empresa_id = $1 AND estado = 'activa'`, [e.id])).rows.map((r) => r.product_number);
  const nums = new Set(t.cuentas?.length ? t.cuentas.filter((c) => activas.includes(c)) : activas);
  if (!nums.size) return terminar(t, 'omitido', 'El cliente no tiene (o ya no tiene) las cuentas elegidas');
  const banco = { consultas: 0 }; // consultas reales al banco de esta tarea
  try {
    const alerta = t.frecuencia !== 'diaria'; // cada hora o cada 30 minutos
    const cuentas = (await cuentasDelBanco(banco)).filter((c) => nums.has(String(c.productNumber))).map((c) => ({ ...c }));
    let correo, fecha = enArgentina().fecha;
    if (alerta) {
      // Movimientos del día (y del anterior si la franja cruza la medianoche) filtrados por la franja
      const franja = franjaDeTurno(t.turno); // turno programado, o 'manual <instante>' de "Ejecutar ahora"
      for (const c of cuentas) {
        try {
          c.movimientos = [];
          for (const dia of franja.fechas) c.movimientos.push(...(await movimientosDelDia(c, dia, banco)).filter((m) => enFranja(m, dia, franja)));
        } catch (x) { c.errorMovimientos = x.message; }
      }
      if (cuentas.length && cuentas.every((c) => c.errorMovimientos)) throw new Error(`No se pudieron consultar los movimientos: ${cuentas[0].errorMovimientos}`);
      correo = armarAlerta(e, cuentas, franja, t.formato);
      if (!correo) return terminar(t, 'omitido', `Sin movimientos de ${franja.desdeTxt.horaSeg} a ${franja.hastaTxt.horaSeg}: no se envía alerta`, [], banco);
      fecha = franja.hastaTxt.fecha;
    } else {
      if (t.contenido !== 'saldos') {
        for (const c of cuentas) {
          try { c.movimientos = [...(await movimientosDelDia(c, fecha, banco))]; } catch (x) { c.errorMovimientos = x.message; }
        }
      }
      correo = armarExtracto(e, cuentas, t.contenido, fecha, t.formato);
    }
    const adjuntos = [{ filename: 'logo-valo.png', content: LOGO, cid: LOGO_CID }];
    if (correo.archivo) adjuntos.push({ filename: correo.archivo, content: await xlsxEnvio(e, alerta ? cuentas.filter((c) => c.movimientos?.length) : cuentas, alerta ? 'movimientos' : t.contenido, { titulo: correo.titulo, logo: LOGO, conSaldo: !alerta }),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await enviarCorreo({ para: e.emails, asunto: correo.asunto, html: correo.html, texto: correo.texto, adjuntos });
    // Solo las alertas de movimientos: después del correo al cliente, se notifica por chat de Teams a los
    // oficiales de la cartera que lo tengan activado (Power Automate). Es best-effort: el correo ya salió.
    let extraChat = '';
    if (alerta) {
      const chat = await notificarChatAlerta(e, correo);
      if (chat.estado === 'enviado') extraChat = ` · chat a ${chat.destinatarios.length} oficial(es)`;
      else if (chat.estado === 'error') extraChat = ` · chat con error: ${chat.detalle ?? ''}`;
    }
    return terminar(t, 'enviado', `${correo.asunto}${correo.archivo ? ` · adjunto ${correo.archivo}` : ''}${extraChat}`, e.emails, banco);
  } catch (x) {
    if (t.intentos < t.max_intentos) { // vuelve a la cola con espera creciente
      const espera = ESPERAS_MIN[Math.min(t.intentos - 1, ESPERAS_MIN.length - 1)];
      await operativa.query(`UPDATE cola_envio SET estado = 'pendiente', detalle = $2, disponible_en = now() + make_interval(mins => $3), consultas_banco = consultas_banco + $4 WHERE id = $1`,
        [t.id, `Intento ${t.intentos} falló: ${x.message}. Se reintenta en ${espera} min`, espera, banco.consultas]);
      if (t.ejecucion_id != null) await operativa.query('UPDATE ejecucion_envio SET consultas_banco = consultas_banco + $2 WHERE id = $1', [t.ejecucion_id, banco.consultas]);
      return;
    }
    return terminar(t, 'error', `Falló ${t.intentos} veces: ${x.message}`, e.emails, banco);
  }
}

// Trabajador: procesa la cola de a una tarea hasta vaciarla. Si ya está corriendo, no arranca otro.
let trabajando = false;
export async function procesarCola({ maximo = 200 } = {}) {
  if (trabajando) return { enCurso: true };
  trabajando = true;
  try {
    await operativa.query(`UPDATE cola_envio SET estado = 'pendiente', detalle = 'Retomada: el proceso anterior se interrumpió'
      WHERE estado = 'procesando' AND tomada_en < now() - make_interval(mins => $1)`, [COLGADA_MIN]);
    let hechas = 0;
    for (let t = await tomarTarea(); t && hechas < maximo; t = await tomarTarea()) { await procesarTarea(t); hechas++; }
    return { procesadas: hechas };
  } finally { trabajando = false; }
}

// Lo llama el servicio jobs cada minuto: encola los turnos vencidos. El UPDATE condicional "reserva" el turno
// antes de encolar, así un turno nunca se encola dos veces aunque haya dos procesos.
export async function ejecutarEnviosPendientes(ahora = new Date()) {
  const esFeriado = await feriadosCargados();
  const { rows } = await operativa.query('SELECT * FROM programacion_envio WHERE activa');
  const hechos = [];
  for (const p of rows) {
    const turno = turnoVencido(p, ahora, esFeriado);
    if (!turno) continue;
    const r = await operativa.query('UPDATE programacion_envio SET ultimo_turno = $2 WHERE id = $1 AND (ultimo_turno IS NULL OR ultimo_turno < $2) RETURNING id', [p.id, turno]);
    if (!r.rowCount) continue;
    hechos.push({ programacion: p.nombre, turno, ...(await encolarTurno(p, turno)) });
  }
  return hechos;
}
