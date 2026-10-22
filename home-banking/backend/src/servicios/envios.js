// Ejecución de los envíos programados: arma por empresa un correo con saldos y/o movimientos del día
// y lo manda a sus emails. Lo corre el servicio jobs cada minuto (y el administrador con "Ejecutar ahora").
import { operativa } from '../db.js';
import { bdvEnvios, cuentasPropias, movimientos } from '../bdv/cliente.js';
import { enviarCorreo } from '../correo.js';
import { xlsxEnvio } from '../excel.js';
import { feriadosCargados } from './feriados.js';
import { enArgentina, turnoVencido } from './programacion.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (v, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(v ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monedaDe = (c) => (Number(c.currencyId) === 80 ? 'ARS' : 'USD');
const MAX_MOVS = 100;

// formato 'cuerpo': todo en el cuerpo del correo; 'cuerpo_excel': el mismo cuerpo y además un Excel adjunto
export function armarCorreo(empresa, cuentas, contenido, fecha, formato = 'cuerpo') {
  const conSaldos = contenido !== 'movimientos', conMovs = contenido !== 'saldos';
  const [a, m, d] = fecha.split('-'), dia = `${d}/${m}/${a}`;
  const tabla = (cab, filas) => `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;width:100%">
    <tr>${cab.map((c) => `<th align="left" style="border-bottom:1px solid #ccc">${c}</th>`).join('')}</tr>${filas.join('')}</table>`;
  const td = (v, num) => `<td${num ? ' align="right"' : ''} style="border-bottom:1px solid #eee">${v}</td>`;
  let html = `<div style="font-family:Arial,sans-serif;color:#2a2a2d"><h2 style="color:#CE162E;margin:0 0 4px">Banco de Valores · VALO</h2>
    <p style="margin:0 0 16px">${esc(empresa.razon_social)} · CUIT ${esc(empresa.cuit)} · ${dia}</p>`;
  let texto = `VALO · ${empresa.razon_social} (CUIT ${empresa.cuit}) · ${dia}\n`;
  if (conSaldos) {
    html += `<h3>Saldos</h3>${tabla(['Cuenta', 'Nombre', 'Disponible', 'Contable'], cuentas.map((c) => `<tr>${td(esc(c.productNumber))}${td(esc(c.productName))}${td(dinero(c.availableBalance, monedaDe(c)), 1)}${td(dinero(c.accountingBalance, monedaDe(c)), 1)}</tr>`))}`;
    texto += `\nSALDOS\n${cuentas.map((c) => `${c.productNumber} ${c.productName ?? ''}: disponible ${dinero(c.availableBalance, monedaDe(c))}`).join('\n')}\n`;
  }
  if (conMovs) {
    for (const c of cuentas) {
      const movs = c.movimientos ?? [];
      html += `<h3>Movimientos del día · cuenta ${esc(c.productNumber)}</h3>`;
      if (c.errorMovimientos) { html += `<p>No se pudieron consultar: ${esc(c.errorMovimientos)}</p>`; continue; }
      if (!movs.length) { html += '<p>Sin movimientos.</p>'; continue; }
      html += tabla(['Hora', 'Descripción', 'D/C', 'Importe'], movs.slice(0, MAX_MOVS).map((x) => `<tr>${td(esc(x.hour))}${td(esc(x.description))}${td(esc(x.signDC))}${td(dinero(x.amount, monedaDe(c)), 1)}</tr>`));
      if (movs.length > MAX_MOVS) html += `<p>… y ${movs.length - MAX_MOVS} movimientos más (${formato === 'cuerpo_excel' ? 'todos están en el Excel adjunto' : 'ver el Home Banking'}).</p>`;
      texto += `\nMOVIMIENTOS ${c.productNumber}: ${movs.length}\n`;
    }
  }
  const archivo = `VALO_${contenido === 'movimientos' ? 'Movimientos' : contenido === 'saldos' ? 'Saldos' : 'Saldos_y_movimientos'}_${empresa.cuit}_${fecha}.xlsx`;
  if (formato === 'cuerpo_excel') {
    html += `<p style="margin-top:16px">Se adjunta el detalle en Excel: <b>${esc(archivo)}</b>.</p>`;
    texto += `\nSe adjunta el detalle en Excel: ${archivo}\n`;
  }
  html += '<p style="font-size:11px;color:#727274;margin-top:20px">Correo automático del Home Banking VALO. No responder.</p></div>';
  const asunto = `VALO · ${contenido === 'movimientos' ? 'Movimientos' : contenido === 'saldos' ? 'Saldos' : 'Saldos y movimientos'} · ${empresa.razon_social} · ${dia}`;
  return { asunto, html, texto, archivo: formato === 'cuerpo_excel' ? archivo : null };
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

export async function encolarTurno(p, turno, { manual = false } = {}) {
  const responsable = p.actualizada_por ?? p.creada_por;
  const visibles = await clientesVisibles(responsable);
  const destinos = p.todas_empresas ? visibles.map((e) => ({ empresaId: Number(e.id), cuentas: [] })) : (p.destinos ?? []);
  let encoladas = 0;
  for (const d of destinos) {
    const e = visibles.find((x) => Number(x.id) === Number(d.empresaId));
    const r = await operativa.query(`INSERT INTO cola_envio (programacion_id, programacion, turno, empresa_id, empresa, cuentas, contenido, responsable, manual, formato)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (programacion_id, turno, empresa_id) DO NOTHING`,
    [p.id, p.nombre, turno, d.empresaId, e?.razon_social ?? `Empresa ${d.empresaId}`, d.cuentas ?? [], p.contenido, responsable, manual, p.formato ?? 'cuerpo']);
    encoladas += r.rowCount;
  }
  return encoladas;
}

// Toma la próxima tarea disponible (SKIP LOCKED: si hubiera otro proceso, nunca toman la misma)
async function tomarTarea() {
  const { rows } = await operativa.query(`UPDATE cola_envio SET estado = 'procesando', tomada_en = now(), intentos = intentos + 1
    WHERE id = (SELECT id FROM cola_envio WHERE estado = 'pendiente' AND disponible_en <= now() ORDER BY disponible_en, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`);
  return rows[0] ?? null;
}

const terminar = (t, estado, detalle, destinatarios = []) => operativa.query(
  `UPDATE cola_envio SET estado = $2, detalle = $3, destinatarios = $4, terminada_en = now() WHERE id = $1`, [t.id, estado, String(detalle ?? '').slice(0, 1000), destinatarios]);

let banco = { cuando: 0, cuentas: null };
const cuentasDelBanco = async () => { // una consulta al banco por minuto como mucho, para toda la cola
  if (!banco.cuentas || Date.now() - banco.cuando > 60_000) banco = { cuando: Date.now(), cuentas: await cuentasPropias(bdvEnvios) };
  return banco.cuentas;
};

export async function procesarTarea(t) {
  const e = (await clientesVisibles(t.responsable)).find((x) => Number(x.id) === Number(t.empresa_id));
  if (!e) return terminar(t, 'omitido', `El aprobador ${t.responsable} ya no ve este cliente (o está inactivo)`);
  if (!e.emails?.length) return terminar(t, 'omitido', 'El cliente no tiene emails');
  const activas = (await operativa.query(`SELECT product_number FROM empresa_cbu WHERE empresa_id = $1 AND estado = 'activa'`, [e.id])).rows.map((r) => r.product_number);
  const nums = new Set(t.cuentas?.length ? t.cuentas.filter((c) => activas.includes(c)) : activas);
  if (!nums.size) return terminar(t, 'omitido', 'El cliente no tiene (o ya no tiene) las cuentas elegidas');
  try {
    const fecha = enArgentina().fecha;
    const cuentas = (await cuentasDelBanco()).filter((c) => nums.has(String(c.productNumber))).map((c) => ({ ...c }));
    if (t.contenido !== 'saldos') {
      for (const c of cuentas) {
        try { c.movimientos = (await movimientos(c, fecha, fecha, bdvEnvios)).movimientos; } catch (x) { c.errorMovimientos = x.message; }
      }
    }
    const correo = armarCorreo(e, cuentas, t.contenido, fecha, t.formato);
    const adjuntos = correo.archivo ? [{ filename: correo.archivo, content: await xlsxEnvio(e, cuentas, t.contenido),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] : [];
    await enviarCorreo({ para: e.emails, asunto: correo.asunto, html: correo.html, texto: correo.texto, adjuntos });
    return terminar(t, 'enviado', `${correo.asunto}${correo.archivo ? ` · adjunto ${correo.archivo}` : ''}`, e.emails);
  } catch (x) {
    if (t.intentos < t.max_intentos) { // vuelve a la cola con espera creciente
      const espera = ESPERAS_MIN[Math.min(t.intentos - 1, ESPERAS_MIN.length - 1)];
      return operativa.query(`UPDATE cola_envio SET estado = 'pendiente', detalle = $2, disponible_en = now() + make_interval(mins => $3) WHERE id = $1`,
        [t.id, `Intento ${t.intentos} falló: ${x.message}. Se reintenta en ${espera} min`, espera]);
    }
    return terminar(t, 'error', `Falló ${t.intentos} veces: ${x.message}`, e.emails);
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
    hechos.push({ programacion: p.nombre, turno, encoladas: await encolarTurno(p, turno) });
  }
  return hechos;
}
