// Consultas: no requieren aprobación (solo permiso Ver sobre la empresa). Igual se auditan.
import { auditar } from '../auditoria.js';
import { exigirRol, ROLES_OPERATIVOS } from '../auth.js';
import { invalido, noEncontrado } from '../errores.js';
import { cuentasHabilitadas, exigirCuenta } from '../permisos.js';
import { consultarCbu, cuentasPropias, detalleSaldos, movimientos } from '../bdv/cliente.js';
import { filaMovimiento, xlsxMovimientos } from '../excel.js';
import { fechaCorte, operativa } from '../db.js';
import { config } from '../config.js';

const hoyIso = () => new Date().toISOString().slice(0, 10);
const rango = (q) => {
  const desde = q.desde ?? hoyIso(), hasta = q.hasta ?? desde;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) throw invalido('Rango de fechas inválido (AAAA-MM-DD)');
  return { desde, hasta };
};
const monedaDe = (c) => (Number(c.currencyId) === 80 ? 'ARS' : 'USD');

// Cuentas del banco filtradas por las empresas habilitadas del usuario
async function cuentasVisibles(usuario, empresaId = null) {
  const habilitadas = await cuentasHabilitadas(usuario);
  return (await cuentasPropias())
    .filter((c) => habilitadas.has(String(c.productNumber)))
    .map((c) => ({ ...c, empresa: habilitadas.get(String(c.productNumber)) }))
    .filter((c) => !empresaId || String(c.empresa.empresa_id) === String(empresaId));
}

export default async function rutasConsultas(app) {
  const soloOperativos = { preHandler: exigirRol(...ROLES_OPERATIVOS) };

  app.get('/me', async (req) => {
    const { usuario, nombre, rol, puedeCrear, puedeAprobar } = req.user;
    return { usuario, nombre, rol, puedeCrear, puedeAprobar, corte: fechaCorte(), ambiente: config.ambiente, soloConsultas: config.soloConsultas };
  });

  // Saldos: sin empresa = total de todas; con ?empresa= = solo esa
  app.get('/cuentas', soloOperativos, async (req) => {
    const cuentas = await cuentasVisibles(req.user.usuario, req.query.empresa);
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó saldos', api: 'getOwnAccounts', detalle: req.query.empresa ? `Empresa ${req.query.empresa}` : 'Todas las empresas' });
    return cuentas.map((c) => ({
      cuenta: c.productNumber, producto: c.productName, alias: c.aliasName ?? c.productAlias, moneda: monedaDe(c),
      disponible: c.availableBalance, contable: c.accountingBalance,
      empresa: { id: c.empresa.empresa_id, razonSocial: c.empresa.razon_social, cuit: c.empresa.cuit, operar: c.empresa.operar },
    }));
  });

  // Constancia de CBU: los datos guardados al vincular la cuenta a la empresa (COELSA). No consulta al banco.
  app.get('/cuentas/:numero/constancia', soloOperativos, async (req) => {
    const hab = await exigirCuenta(req.user.usuario, req.params.numero);
    const f = (await operativa.query(`SELECT * FROM empresa_cbu WHERE product_number = $1 AND estado = 'activa'`, [req.params.numero])).rows[0];
    if (!f) throw noEncontrado('La cuenta no tiene una vinculación activa');
    if (!f.cbu) throw invalido('La cuenta todavía no tiene CBU guardado: el administrador tiene que usar "Consultar COELSA" en Empresas');
    await auditar(null, req, { tipo: 'Consultas', accion: 'Emitió constancia de CBU', detalle: `${req.params.numero} · ${hab.razon_social}` });
    return { cuenta: f.product_number, cbu: f.cbu, alias: f.alias, titular: f.titular ?? hab.razon_social, cuit: f.cuit_titular ?? hab.cuit, moneda: f.moneda, vinculadaEn: f.asignada_en, coelsaEn: f.coelsa_en };
  });

  app.get('/cuentas/:numero/detalle', soloOperativos, async (req) => {
    await exigirCuenta(req.user.usuario, req.params.numero);
    const c = (await cuentasPropias()).find((x) => String(x.productNumber) === req.params.numero);
    const d = await detalleSaldos(c);
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó detalle de cuenta', api: 'getBalancesDetail', detalle: req.params.numero });
    return d;
  });

  // Movimientos de una cuenta (paginando de a 900 contra el banco). ?formato=xlsx exporta.
  app.get('/cuentas/:numero/movimientos', soloOperativos, async (req, reply) => {
    const { desde, hasta } = rango(req.query);
    const hab = await exigirCuenta(req.user.usuario, req.params.numero);
    const c = (await cuentasPropias()).find((x) => String(x.productNumber) === req.params.numero);
    const r = await movimientos(c, desde, hasta);
    if (req.query.formato === 'xlsx') {
      const filas = r.movimientos.map((m) => filaMovimiento(m, { cuenta: c.productNumber, cliente: hab.razon_social, moneda: monedaDe(c) }));
      await auditar(null, req, { tipo: 'Consultas', accion: 'Exportó a Excel', api: 'getMovementsDetail', detalle: `Movimientos ${c.productNumber} · ${desde} a ${hasta} · ${filas.length} filas` });
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="movimientos_${c.productNumber}_${desde}_${hasta}.xlsx"`)
        .send(Buffer.from(await xlsxMovimientos(filas)));
    }
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó movimientos', api: 'getMovementsDetail', detalle: `${c.productNumber} · ${desde} a ${hasta}` });
    return { cuenta: c.productNumber, desde, hasta, completo: r.completo, movimientos: r.movimientos };
  });

  // Débitos realizados de todas las cuentas visibles (o de una empresa). ?formato=xlsx exporta.
  app.get('/debitos', soloOperativos, async (req, reply) => {
    const { desde, hasta } = rango(req.query);
    const cuentas = await cuentasVisibles(req.user.usuario, req.query.empresa);
    const filas = [];
    for (const c of cuentas) {
      const r = await movimientos(c, desde, hasta);
      for (const m of r.movimientos) {
        if (m.signDC === 'D') filas.push(filaMovimiento(m, { cuenta: c.productNumber, cliente: c.empresa.razon_social, moneda: monedaDe(c) }));
      }
    }
    if (req.query.formato === 'xlsx') {
      await auditar(null, req, { tipo: 'Consultas', accion: 'Exportó a Excel', api: 'getMovementsDetail', detalle: `Débitos ${desde} a ${hasta} · ${filas.length} filas` });
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="debitos_realizados_${desde}_${hasta}.xlsx"`)
        .send(Buffer.from(await xlsxMovimientos(filas, { hoja: 'Débitos' })));
    }
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó débitos realizados', api: 'getMovementsDetail', detalle: `${desde} a ${hasta}` });
    return { desde, hasta, debitos: filas };
  });

  app.post('/cbu', { preHandler: exigirRol('operador', 'autorizante') }, async (req) => {
    const { cbu = '', alias = '' } = req.body ?? {};
    if (!cbu && !alias) throw invalido('Indicá CBU o alias');
    if (cbu && !/^\d{22}$/.test(cbu)) throw invalido('El CBU/CVU debe tener 22 dígitos');
    const r = await consultarCbu({ cbu, alias }).catch((e) => ({ error: e.message }));
    await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó CBU/alias', api: 'getCustomerInformationCbu', detalle: cbu || alias, resultado: r.error ? 'Sin resultado' : 'OK' });
    if (r.error) throw invalido(`No registrado en COELSA: ${r.error}`);
    return { cbu: r.cbu || cbu, alias: r.alias, titular: r.headline, cuit: r.cuit, moneda: r.currency, activa: r.activeAccount === 'T', titulares: r.holders ?? [] };
  });
}
