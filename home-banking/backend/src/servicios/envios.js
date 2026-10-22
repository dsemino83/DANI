// Ejecución de los envíos programados: arma por empresa un correo con saldos y/o movimientos del día
// y lo manda a sus emails. Lo corre el servicio jobs cada minuto (y el administrador con "Ejecutar ahora").
import { operativa } from '../db.js';
import { cuentasPropias, movimientos } from '../bdv/cliente.js';
import { enviarCorreo } from '../correo.js';
import { feriadosCargados } from './feriados.js';
import { enArgentina, turnoVencido } from './programacion.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (v, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(v ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monedaDe = (c) => (Number(c.currencyId) === 80 ? 'ARS' : 'USD');
const MAX_MOVS = 100;

export function armarCorreo(empresa, cuentas, contenido, fecha) {
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
      if (movs.length > MAX_MOVS) html += `<p>… y ${movs.length - MAX_MOVS} movimientos más (ver el Home Banking).</p>`;
      texto += `\nMOVIMIENTOS ${c.productNumber}: ${movs.length}\n`;
    }
  }
  html += '<p style="font-size:11px;color:#727274;margin-top:20px">Correo automático del Home Banking VALO. No responder.</p></div>';
  const asunto = `VALO · ${contenido === 'movimientos' ? 'Movimientos' : contenido === 'saldos' ? 'Saldos' : 'Saldos y movimientos'} · ${empresa.razon_social} · ${dia}`;
  return { asunto, html, texto };
}

// Ejecuta una programación para un turno: un correo por empresa (activa, con cuentas y emails)
export async function ejecutarProgramacion(p, turno, { manual = false } = {}) {
  const { rows: empresas } = await operativa.query(
    `SELECT * FROM empresa WHERE activa AND ($1::boolean OR id = ANY($2::bigint[])) ORDER BY razon_social`, [p.todas_empresas, p.empresas ?? []]);
  const vinculos = (await operativa.query(`SELECT empresa_id::text, product_number FROM empresa_cbu WHERE estado = 'activa'`)).rows;
  const fecha = enArgentina().fecha, resultado = { enviados: 0, errores: 0, omitidos: 0 };
  let banco = null;
  const registrar = (e, estado, detalle, para = []) => {
    resultado[{ enviado: 'enviados', error: 'errores', omitido: 'omitidos' }[estado]]++;
    return operativa.query(`INSERT INTO envio_mail_log (programacion_id, turno, empresa_id, empresa, destinatarios, estado, detalle, manual) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.id, turno, e.id, e.razon_social, para, estado, String(detalle ?? '').slice(0, 1000), manual]);
  };
  for (const e of empresas) {
    if (!e.emails?.length) { await registrar(e, 'omitido', 'La empresa no tiene emails'); continue; }
    const nums = new Set(vinculos.filter((v) => v.empresa_id === String(e.id)).map((v) => v.product_number));
    if (!nums.size) { await registrar(e, 'omitido', 'La empresa no tiene cuentas activas'); continue; }
    try {
      banco ??= await cuentasPropias(); // una sola consulta al banco por ejecución
      const cuentas = banco.filter((c) => nums.has(String(c.productNumber))).map((c) => ({ ...c }));
      if (p.contenido !== 'saldos') {
        for (const c of cuentas) {
          try { c.movimientos = (await movimientos(c, fecha, fecha)).movimientos; } catch (x) { c.errorMovimientos = x.message; }
        }
      }
      const correo = armarCorreo(e, cuentas, p.contenido, fecha);
      await enviarCorreo({ para: e.emails, asunto: correo.asunto, html: correo.html, texto: correo.texto });
      await registrar(e, 'enviado', correo.asunto, e.emails);
    } catch (x) { await registrar(e, 'error', x.message, e.emails); }
  }
  return resultado;
}

// Lo llama el servicio jobs cada minuto: ejecuta los turnos vencidos. El UPDATE condicional "reserva" el
// turno antes de enviar, así un turno nunca sale dos veces aunque haya dos procesos.
export async function ejecutarEnviosPendientes(ahora = new Date()) {
  const esFeriado = await feriadosCargados();
  const { rows } = await operativa.query('SELECT * FROM programacion_envio WHERE activa');
  const hechos = [];
  for (const p of rows) {
    const turno = turnoVencido(p, ahora, esFeriado);
    if (!turno) continue;
    const r = await operativa.query('UPDATE programacion_envio SET ultimo_turno = $2 WHERE id = $1 AND (ultimo_turno IS NULL OR ultimo_turno < $2) RETURNING id', [p.id, turno]);
    if (!r.rowCount) continue;
    hechos.push({ programacion: p.nombre, turno, ...(await ejecutarProgramacion(p, turno)) });
  }
  return hechos;
}
