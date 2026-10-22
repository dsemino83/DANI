// Administración de seguridad: empresas, cuentas, permisos por empresa, roles Crear/Aprobar y credencial API.
// El administrador NO accede a saldos ni opera; todo cambio queda auditado en la misma transacción.
import { exigirRol, ROL_APROBAR, ROL_CREAR } from '../auth.js';
import { auditar } from '../auditoria.js';
import { operativa, tx } from '../db.js';
import { conflicto, ErrorHttp, invalido, noEncontrado } from '../errores.js';
import { esAmbiente, urlBase } from '../bdv/ambientes.js';
import { cifrar, estadoCredencial, leerCredencial } from '../secretos.js';
import { bdv, consultarCbu, cuentasPropias, pemDesdeBase64 } from '../bdv/cliente.js';
import { cambiarPerfil, cambiarRol, crearUsuario, desbloquearUsuario, editarDatosUsuario, eliminarUsuario, enviarCorreoClave, estadoUsuario, forzarCambioClave, habilitarUsuario, listarUsuarios, restablecerClave, rolesDeTransferencias } from '../keycloak-admin.js';
import { cbuDeCuenta, filaCoelsa, normalizarEmails } from '../servicios/empresas.js';
import { cbusPowerBI, claveCuenta, modoPowerBI } from '../powerbi.js';
import { createPublicKey } from 'node:crypto';

const nivel = (p) => (!p ? 'sin acceso' : p.operar ? 'ver+operar' : p.ver ? 'ver' : 'sin acceso');

export default async function rutasAdmin(app) {
  app.addHook('preHandler', exigirRol('administrador'));

  // Log de acciones rechazadas: las que salen bien se auditan dentro de su transacción; las que fallan
  // (validación, permisos, conflicto, error del SSO o del banco) se registran acá con el motivo.
  app.addHook('onError', async (req, reply, error) => {
    if (req.method === 'GET') return;
    await auditar(null, req, { tipo: 'Administración', accion: `Acción rechazada: ${req.method} ${req.routeOptions?.url ?? req.url}`,
      detalle: error.message, resultado: 'Error' }).catch(() => {});
  });

  // ---------------- Empresas ----------------
  app.get('/empresas', async () => (await operativa.query(
    `SELECT e.*, count(ce.id)::int AS cuentas
       FROM empresa e LEFT JOIN empresa_cbu ce ON ce.empresa_id = e.id AND ce.estado = 'activa'
      GROUP BY e.id ORDER BY e.razon_social`)).rows);

  app.post('/empresas', async (req, reply) => {
    const razon = String(req.body?.razonSocial ?? '').trim().toUpperCase();
    const cuit = String(req.body?.cuit ?? '').replace(/\D/g, '');
    if (!razon) throw invalido('Falta la razón social');
    if (cuit.length !== 11) throw invalido('El CUIT debe tener 11 dígitos');
    const emails = normalizarEmails(req.body?.emails);
    if (!emails.length) throw invalido('Cargá al menos un email de la empresa');
    reply.code(201);
    return tx(operativa, async (c) => {
      const dup = await c.query('SELECT 1 FROM empresa WHERE cuit = $1', [cuit]);
      if (dup.rowCount) throw conflicto('Ya existe una empresa con ese CUIT');
      const { rows } = await c.query('INSERT INTO empresa (razon_social, cuit, creada_por, emails) VALUES ($1, $2, $3, $4) RETURNING *', [razon, cuit, req.user.usuario, emails]);
      await auditar(c, req, { tipo: 'Administración', accion: 'Alta de empresa', detalle: `${razon} · CUIT ${cuit} · emails: ${emails.join(', ')}`, ref: { tipo: 'empresa', id: rows[0].id } });
      return rows[0];
    });
  });

  // Activar / desactivar: suspende o restablece todos los permisos de la empresa (los permisos se conservan).
  app.patch('/empresas/:id', async (req) => tx(operativa, async (c) => {
    const activa = Boolean(req.body?.activa);
    const { rows } = await c.query('UPDATE empresa SET activa = $2 WHERE id = $1 RETURNING *', [req.params.id, activa]);
    if (!rows[0]) throw noEncontrado('Empresa inexistente');
    const us = (await c.query('SELECT usuario FROM permiso_empresa WHERE empresa_id = $1 AND ver', [req.params.id])).rows.map((r) => r.usuario);
    await auditar(c, req, {
      tipo: 'Administración', accion: activa ? 'Activó empresa' : 'Desactivó empresa', ref: { tipo: 'empresa', id: req.params.id },
      detalle: `${rows[0].razon_social} · permisos ${activa ? 'restablecidos' : 'suspendidos'} para ${us.join(', ') || 'ningún usuario'}`,
    });
    return rows[0];
  }));

  // Eliminar: da de baja sus cuentas (quedan en el historial con el CUIT) y borra los permisos sobre ella.
  app.delete('/empresas/:id', async (req) => tx(operativa, async (c) => {
    const { rows } = await c.query('SELECT * FROM empresa WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw noEncontrado('Empresa inexistente');
    const cuentas = (await c.query(`UPDATE empresa_cbu SET estado = 'baja', baja_por = $2, baja_en = now() WHERE empresa_id = $1 AND estado = 'activa' RETURNING product_number`, [req.params.id, req.user.usuario])).rows.map((r) => r.product_number);
    const us = (await c.query('DELETE FROM permiso_empresa WHERE empresa_id = $1 RETURNING usuario', [req.params.id])).rows.map((r) => r.usuario);
    await c.query('DELETE FROM empresa WHERE id = $1', [req.params.id]);
    await auditar(c, req, {
      tipo: 'Administración', accion: 'Eliminó empresa', ref: { tipo: 'empresa', id: req.params.id },
      detalle: `${rows[0].razon_social} (CUIT ${rows[0].cuit}) · cuentas liberadas: ${cuentas.join(', ') || 'ninguna'} · permisos quitados a ${us.join(', ') || 'ningún usuario'}`,
    });
    return { eliminada: true, cuentasLiberadas: cuentas, permisosQuitados: us };
  }));

  // Emails de la empresa (uno o más): reemplaza la lista completa.
  app.put('/empresas/:id/emails', async (req) => {
    const emails = normalizarEmails(req.body?.emails);
    if (!emails.length) throw invalido('La empresa tiene que tener al menos un email');
    return tx(operativa, async (c) => {
      const antes = (await c.query('SELECT * FROM empresa WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!antes) throw noEncontrado('Empresa inexistente');
      const { rows } = await c.query('UPDATE empresa SET emails = $2 WHERE id = $1 RETURNING *', [req.params.id, emails]);
      const altas = emails.filter((e) => !antes.emails.includes(e)), bajas = antes.emails.filter((e) => !emails.includes(e));
      await auditar(c, req, { tipo: 'Administración', accion: 'Modificó emails de empresa', ref: { tipo: 'empresa', id: req.params.id },
        detalle: `${antes.razon_social} · agregados: ${altas.join(', ') || 'ninguno'} · quitados: ${bajas.join(', ') || 'ninguno'}` });
      return rows[0];
    });
  });

  // Cuentas del banco que no tienen relación activa con ninguna empresa (para "Agregar cuentas")
  const vista = (c) => ({ cuenta: String(c.productNumber), nombre: c.productName ?? '', alias: c.aliasName ?? c.productAlias ?? '', moneda: Number(c.currencyId) === 80 ? 'ARS' : 'USD' });
  app.get('/cuentas-disponibles', async () => {
    const activas = new Set((await operativa.query(`SELECT product_number FROM empresa_cbu WHERE estado = 'activa'`)).rows.map((r) => r.product_number));
    return (await cuentasPropias()).map(vista).filter((c) => !activas.has(c.cuenta));
  });

  // Cuentas de la empresa (activas y dadas de baja), con el CBU y alias de COELSA guardados.
  // El nombre de la cuenta sale del banco; si el banco no responde se muestran igual los datos guardados.
  app.get('/empresas/:id/cuentas', async (req) => {
    const filas = (await operativa.query('SELECT * FROM empresa_cbu WHERE empresa_id = $1 ORDER BY estado, asignada_en DESC', [req.params.id])).rows;
    const banco = new Map((await cuentasPropias().catch(() => [])).map((c) => [String(c.productNumber), vista(c)]));
    return filas.map((f) => ({
      id: f.id, cuenta: f.product_number, nombre: banco.get(f.product_number)?.nombre ?? '', moneda: f.moneda ?? banco.get(f.product_number)?.moneda ?? '',
      cbu: f.cbu, alias: f.alias, titular: f.titular, cuitTitular: f.cuit_titular, estado: f.estado,
      asignadaPor: f.asignada_por, asignadaEn: f.asignada_en, bajaPor: f.baja_por, bajaEn: f.baja_en, coelsaEn: f.coelsa_en,
    }));
  });

  // CBU del modelo de Power BI para las cuentas que el banco informa sin CBU. Si Power BI falla, el motivo
  // acompaña al rechazo de esas cuentas (las que tienen CBU del banco no dependen de Power BI).
  const cbusFaltantes = async (cuentas) => {
    if (!cuentas.some((c) => !cbuDeCuenta(c))) return { mapa: null, error: null };
    try { return { mapa: await cbusPowerBI(), error: null }; } catch (e) { return { mapa: null, error: e.message }; }
  };

  // Consulta COELSA por el CBU de la cuenta: el del banco, si no el de Power BI, y si no por su alias
  const consultarCoelsa = async (cuenta, pbi = { mapa: null, error: null }) => {
    const cbuPbi = cbuDeCuenta(cuenta) ? null : pbi.mapa?.get(claveCuenta(cuenta.productNumber)) ?? null;
    const cbu = cbuDeCuenta(cuenta) ?? cbuPbi, alias = cuenta.aliasName ?? cuenta.productAlias ?? '';
    if (!cbu && !alias) {
      throw new Error(`el banco no informa CBU ni alias de la cuenta y ${pbi.error ? `Power BI falló: ${pbi.error}`
        : pbi.mapa ? 'no está en el modelo de Power BI' : 'Power BI no está configurado'}`);
    }
    return filaCoelsa(cuenta, await consultarCbu(cbu ? { cbu } : { alias }), cbuPbi);
  };

  // Prueba de la conexión con Power BI (no devuelve CBU, solo cuántas cuentas trae el modelo)
  app.get('/powerbi', async () => {
    const modo = modoPowerBI();
    if (!modo) return { modo: null, mensaje: 'Power BI no está configurado' };
    try { return { modo, cuentas: (await cbusPowerBI()).size }; } catch (e) { return { modo, error: e.message }; }
  });

  // Agregar cuentas: por cada una consulta COELSA y guarda CBU, alias y titular. Las que COELSA no resuelve
  // no se agregan y vuelven con el motivo. La base rechaza un CBU o cuenta con otra relación activa.
  app.post('/empresas/:id/cuentas', async (req) => {
    const pedidas = [...new Set((req.body?.cuentas ?? []).map(String))];
    if (!pedidas.length) throw invalido('Elegí al menos una cuenta');
    const emp0 = (await operativa.query('SELECT * FROM empresa WHERE id = $1', [req.params.id])).rows[0];
    if (!emp0) throw noEncontrado('Empresa inexistente');
    const delBanco = new Map((await cuentasPropias()).map((c) => [String(c.productNumber), c]));
    const ajenas = pedidas.filter((n) => !delBanco.has(n));
    if (ajenas.length) throw invalido(`Cuentas que el banco no informa para VALO: ${ajenas.join(', ')}`);
    const resueltas = [], rechazadas = [];
    const pbi = await cbusFaltantes(pedidas.map((n) => delBanco.get(n)));
    for (const n of pedidas) {
      try { resueltas.push({ n, moneda: vista(delBanco.get(n)).moneda, ...(await consultarCoelsa(delBanco.get(n), pbi)) }); }
      catch (e) { rechazadas.push({ cuenta: n, motivo: `COELSA: ${e.message}` }); }
    }
    if (!resueltas.length) {
      await auditar(null, req, { tipo: 'Administración', accion: 'Agregar cuentas a empresa: sin cambios', api: 'getCustomerInformationCbu', ref: { tipo: 'empresa', id: req.params.id },
        detalle: `${emp0.razon_social} · ${rechazadas.map((r) => `${r.cuenta}: ${r.motivo}`).join(' | ')}`, resultado: 'Error' });
      return { agregadas: [], rechazadas };
    }
    return tx(operativa, async (c) => {
      const emp = (await c.query('SELECT * FROM empresa WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!emp) throw noEncontrado('Empresa inexistente');
      const ocupadas = (await c.query(`SELECT product_number, cbu FROM empresa_cbu WHERE estado = 'activa' AND (product_number = ANY($1) OR cbu = ANY($2))`,
        [resueltas.map((r) => r.n), resueltas.map((r) => r.cbu)])).rows;
      if (ocupadas.length) throw conflicto(`Ya tienen una relación activa con una empresa: ${ocupadas.map((r) => `${r.product_number} (CBU ${r.cbu ?? 'pendiente'})`).join(', ')}`);
      for (const r of resueltas) {
        await c.query(`INSERT INTO empresa_cbu (empresa_id, empresa_cuit, product_number, cbu, alias, titular, cuit_titular, moneda, coelsa_en, asignada_por)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)`,
          [emp.id, emp.cuit, r.n, r.cbu, r.alias, r.titular, r.cuitTitular, r.moneda, req.user.usuario]);
      }
      await auditar(c, req, { tipo: 'Administración', accion: 'Agregó cuentas a empresa', api: 'getCustomerInformationCbu', ref: { tipo: 'empresa', id: req.params.id },
        detalle: `${emp.razon_social} (CUIT ${emp.cuit}) · ${resueltas.map((r) => `${r.n} CBU ${r.cbu} alias ${r.alias ?? '—'}`).join(' | ')}`
          + (rechazadas.length ? ` · no agregadas: ${rechazadas.map((r) => `${r.cuenta} (${r.motivo})`).join(', ')}` : '') });
      return { agregadas: resueltas.map((r) => ({ cuenta: r.n, cbu: r.cbu, alias: r.alias })), rechazadas };
    }).catch((e) => { if (e.code === '23505') throw conflicto('El CBU o la cuenta ya tiene una relación activa con una empresa'); throw e; });
  });

  // Volver a consultar COELSA para una cuenta activa (completa el CBU de asignaciones anteriores o actualiza el alias)
  app.post('/empresas/:id/cuentas/:cuenta/coelsa', async (req) => {
    const cuenta = (await cuentasPropias()).find((c) => String(c.productNumber) === req.params.cuenta);
    if (!cuenta) throw invalido('El banco no informa esa cuenta para VALO');
    let d;
    try { d = await consultarCoelsa(cuenta, await cbusFaltantes([cuenta])); } catch (e) { throw new ErrorHttp(502, 'coelsa', `COELSA: ${e.message}`); }
    return tx(operativa, async (c) => {
      const f = (await c.query(`SELECT * FROM empresa_cbu WHERE empresa_id = $1 AND product_number = $2 AND estado = 'activa' FOR UPDATE`, [req.params.id, req.params.cuenta])).rows[0];
      if (!f) throw noEncontrado('La cuenta no tiene una relación activa con esta empresa');
      await c.query('UPDATE empresa_cbu SET cbu = $2, alias = $3, titular = $4, cuit_titular = $5, coelsa_en = now() WHERE id = $1', [f.id, d.cbu, d.alias, d.titular, d.cuitTitular]);
      await auditar(c, req, { tipo: 'Administración', accion: 'Actualizó datos COELSA de cuenta', api: 'getCustomerInformationCbu', ref: { tipo: 'empresa', id: req.params.id },
        detalle: `cuenta ${f.product_number} · CBU ${f.cbu ?? 'pendiente'} → ${d.cbu} · alias ${f.alias ?? '—'} → ${d.alias ?? '—'}` });
      return { cuenta: f.product_number, ...d };
    }).catch((e) => { if (e.code === '23505') throw conflicto('Ese CBU ya tiene una relación activa con otra empresa'); throw e; });
  });

  // Quitar una cuenta: no se borra, pasa a estado "baja" (queda en el historial) y la cuenta vuelve a estar disponible
  app.delete('/empresas/:id/cuentas/:cuenta', async (req) => tx(operativa, async (c) => {
    const emp = (await c.query('SELECT * FROM empresa WHERE id = $1', [req.params.id])).rows[0];
    if (!emp) throw noEncontrado('Empresa inexistente');
    const r = await c.query(`UPDATE empresa_cbu SET estado = 'baja', baja_por = $3, baja_en = now()
                              WHERE product_number = $1 AND empresa_id = $2 AND estado = 'activa' RETURNING cbu, alias`, [req.params.cuenta, req.params.id, req.user.usuario]);
    if (!r.rowCount) throw noEncontrado('La cuenta no tiene una relación activa con esta empresa');
    await auditar(c, req, { tipo: 'Administración', accion: 'Dio de baja cuenta de empresa', ref: { tipo: 'empresa', id: req.params.id },
      detalle: `${emp.razon_social} (CUIT ${emp.cuit}) · cuenta ${req.params.cuenta} · CBU ${r.rows[0].cbu ?? 'pendiente'} · alias ${r.rows[0].alias ?? '—'} · estado activa → baja` });
    return { cuenta: req.params.cuenta, estado: 'baja' };
  }));

  // ---------------- Permisos por empresa ----------------
  app.get('/permisos/:usuario', async (req) => (await operativa.query(
    `SELECT e.id AS empresa_id, e.razon_social, e.cuit, e.activa, coalesce(p.ver, false) AS ver, coalesce(p.operar, false) AS operar
       FROM empresa e LEFT JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1 ORDER BY e.razon_social`, [req.params.usuario])).rows);

  app.put('/permisos/:usuario', async (req) => {
    const usuario = req.params.usuario;
    if (usuario === req.user.usuario) throw invalido('El administrador no puede asignarse permisos a sí mismo');
    // Operar solo tiene efecto si además tiene el rol Crear en el SSO (se valida al cargar).
    const roles = await rolesDeTransferencias(usuario).catch(() => ({ administrador: false }));
    if (roles.administrador) throw invalido('El administrador de seguridad no recibe permisos sobre empresas');
    const pedidos = req.body?.permisos ?? []; // [{empresaId, ver, operar}]
    return tx(operativa, async (c) => {
      const antes = new Map((await c.query('SELECT * FROM permiso_empresa WHERE usuario = $1', [usuario])).rows.map((r) => [String(r.empresa_id), r]));
      const cambios = [];
      for (const p of pedidos) {
        const ver = Boolean(p.ver), operar = Boolean(p.operar) && ver;
        const a = antes.get(String(p.empresaId));
        if (nivel(a) === nivel({ ver, operar })) continue;
        const e = (await c.query('SELECT razon_social FROM empresa WHERE id = $1', [p.empresaId])).rows[0];
        if (!e) throw invalido(`Empresa inexistente: ${p.empresaId}`);
        if (!ver) await c.query('DELETE FROM permiso_empresa WHERE usuario = $1 AND empresa_id = $2', [usuario, p.empresaId]);
        else await c.query(`INSERT INTO permiso_empresa (usuario, empresa_id, ver, operar) VALUES ($1, $2, $3, $4)
                            ON CONFLICT (usuario, empresa_id) DO UPDATE SET ver = $3, operar = $4`, [usuario, p.empresaId, ver, operar]);
        cambios.push(`${e.razon_social}: ${nivel(a)} → ${nivel({ ver, operar })}`);
      }
      if (cambios.length) await auditar(c, req, { tipo: 'Administración', accion: 'Modificó permisos por empresa', api: 'Permisos por empresa', detalle: `${usuario} · ${cambios.join(' | ')}` });
      return { usuario, cambios };
    });
  });

  // ---------------- Roles Crear / Aprobar (en el SSO) ----------------
  app.get('/usuarios', async () => listarUsuarios());

  app.get('/usuarios/:usuario/roles', async (req) => rolesDeTransferencias(req.params.usuario));

  // ---------------- Usuarios del SSO: alta, perfil, habilitación y clave temporal ----------------
  const noASiMismo = (req, usuario) => { if (usuario === req.user.usuario) throw invalido('No podés modificar tu propio usuario'); };

  app.post('/usuarios', async (req, reply) => {
    const r = await crearUsuario(req.body ?? {});
    await auditar(null, req, { tipo: 'Administración', accion: 'Alta de usuario', api: 'Keycloak Admin',
      detalle: `${r.usuario} · perfil ${r.perfil} · clave temporal (se cambia en el primer ingreso)` });
    reply.code(201);
    return r;
  });

  app.put('/usuarios/:usuario/perfil', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    const r = await cambiarPerfil(usuario, req.body?.perfil);
    let permisosQuitados = 0;
    if (r.despues === 'administrador') { // el administrador de seguridad no opera ni ve empresas
      permisosQuitados = (await operativa.query('DELETE FROM permiso_empresa WHERE usuario = $1', [usuario])).rowCount;
    }
    await auditar(null, req, { tipo: 'Administración', accion: 'Cambió perfil de usuario', api: 'Keycloak Admin',
      detalle: `${usuario} · ${r.antes.join('+') || 'sin perfil'} → ${r.despues}${r.quitados.length ? ` · quitó ${r.quitados.join(', ')}` : ''}${permisosQuitados ? ` · ${permisosQuitados} permisos por empresa quitados` : ''}` });
    return { usuario, ...r, permisosQuitados };
  });

  app.patch('/usuarios/:usuario', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    if (typeof req.body?.habilitado !== 'boolean') throw invalido('Indicá habilitado: true o false');
    const r = await habilitarUsuario(usuario, req.body.habilitado);
    await auditar(null, req, { tipo: 'Administración', accion: r.habilitado ? 'Habilitó usuario' : 'Deshabilitó usuario', api: 'Keycloak Admin',
      detalle: `${usuario}${r.habilitado ? ' · sin bloqueo por intentos fallidos' : ' · sesiones abiertas cerradas'}` });
    return r;
  });

  app.post('/usuarios/:usuario/clave', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    const r = await restablecerClave(usuario, req.body?.claveTemporal);
    await auditar(null, req, { tipo: 'Administración', accion: 'Restableció clave de usuario', api: 'Keycloak Admin',
      detalle: `${usuario} · clave temporal (se cambia en el primer ingreso)` }); // nunca el valor
    return r;
  });

  app.put('/usuarios/:usuario/datos', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    const r = await editarDatosUsuario(usuario, req.body ?? {});
    await auditar(null, req, { tipo: 'Administración', accion: 'Modificó datos de usuario', api: 'Keycloak Admin', detalle: `${usuario} · ${r.cambios.join(' · ') || 'sin cambios'}` });
    return r;
  });

  // Eliminar: borra el usuario del SSO y sus permisos por empresa. Su historial de auditoría se conserva.
  app.delete('/usuarios/:usuario', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    await eliminarUsuario(usuario);
    const permisos = (await operativa.query('DELETE FROM permiso_empresa WHERE usuario = $1', [usuario])).rowCount;
    await auditar(null, req, { tipo: 'Administración', accion: 'Eliminó usuario', api: 'Keycloak Admin', detalle: `${usuario} · ${permisos} permisos por empresa quitados · la auditoría de sus acciones se conserva` });
    return { usuario, eliminado: true, permisosQuitados: permisos };
  });

  app.get('/usuarios/:usuario/estado', async (req) => estadoUsuario(req.params.usuario));

  app.post('/usuarios/:usuario/desbloquear', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    const r = await desbloquearUsuario(usuario);
    await auditar(null, req, { tipo: 'Administración', accion: 'Desbloqueó usuario', api: 'Keycloak Admin', detalle: `${usuario} · bloqueo por intentos fallidos quitado` });
    return r;
  });

  app.post('/usuarios/:usuario/forzar-cambio-clave', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    const r = await forzarCambioClave(usuario);
    await auditar(null, req, { tipo: 'Administración', accion: 'Forzó cambio de clave', api: 'Keycloak Admin', detalle: `${usuario} · elige clave nueva en el próximo ingreso · sesiones abiertas cerradas` });
    return r;
  });

  app.post('/usuarios/:usuario/correo-clave', async (req) => {
    const usuario = req.params.usuario;
    noASiMismo(req, usuario);
    const r = await enviarCorreoClave(usuario);
    await auditar(null, req, { tipo: 'Administración', accion: 'Envió correo para cambiar la clave', api: 'Keycloak Admin', detalle: `${usuario} · ${r.email} · link válido 24 h` });
    return r;
  });

  app.put('/usuarios/:usuario/roles', async (req) => {
    const usuario = req.params.usuario;
    const actuales = await rolesDeTransferencias(usuario);
    if (actuales.administrador) throw invalido('El administrador de seguridad no puede tener roles de operación');
    const cambios = [];
    for (const [clave, rol] of [['crear', ROL_CREAR], ['aprobar', ROL_APROBAR]]) {
      if (typeof req.body?.[clave] !== 'boolean' || req.body[clave] === actuales[clave]) continue;
      await cambiarRol(usuario, rol, req.body[clave]);
      cambios.push(`${req.body[clave] ? 'asignó' : 'quitó'} ${rol}`);
      await auditar(null, req, { tipo: 'Administración', accion: `${req.body[clave] ? 'Asignó' : 'Quitó'} rol ${rol}`, api: 'Keycloak Admin', detalle: `${usuario} · ${actuales[clave] ? 'con rol' : 'sin rol'} → ${req.body[clave] ? 'con rol' : 'sin rol'}` });
    }
    return { usuario, cambios };
  });

  // ---------------- Credencial API Banking (clave de solo escritura) ----------------
  app.get('/credenciales/:ambiente', async (req) => {
    if (!esAmbiente(req.params.ambiente)) throw invalido('Ambiente inválido');
    return estadoCredencial(req.params.ambiente);
  });

  app.put('/credenciales/:ambiente', async (req) => {
    const amb = req.params.ambiente;
    if (!esAmbiente(amb)) throw invalido('Ambiente inválido');
    const b = req.body ?? {};
    const url = urlBase(amb); // la URL la define el ambiente; si llega una en el pedido se ignora
    if (!b.usuario || !b.terminal) throw invalido('Faltan usuario o terminal');
    if (b.identification && !/^\d{7,11}$/.test(String(b.identification))) throw invalido('identification debe tener entre 7 y 11 dígitos');
    const yaCifrada = b.claveYaCifrada === true;
    if (b.clave && yaCifrada && !/^[A-Za-z0-9+/]{100,}={0,2}$/.test(String(b.clave).replace(/\s+/g, ''))) throw invalido('La clave cifrada tiene que ser el texto base64 que entrega el banco');
    if (b.rsaPublicKey) { try { createPublicKey(pemDesdeBase64(b.rsaPublicKey)); } catch { throw invalido('La llave pública RSA no es válida'); } }
    await tx(operativa, async (c) => {
      const prev = (await c.query('SELECT * FROM credencial_api WHERE ambiente = $1 FOR UPDATE', [amb])).rows[0];
      if (!prev && !b.clave) throw invalido('En la primera carga se requiere la clave');
      // Clave en texto plano: el backend la cifra con la llave RSA del banco en cada login, así que la llave es obligatoria.
      // Clave ya cifrada por el banco: se envía tal cual y la llave no hace falta.
      const modo = b.clave ? yaCifrada : prev.clave_ya_cifrada;
      if (!modo && !b.rsaPublicKey && !prev?.rsa_public_key) throw invalido('Con la clave en texto plano se requiere la llave pública RSA del banco. Si la clave es el texto cifrado que entregó el banco, tildá "La clave ya viene cifrada por el banco"');
      if (!b.identification && !prev) throw invalido('identification debe tener entre 7 y 11 dígitos');
      b.identification = String(b.identification || prev.identification); // vacío = se conserva (la pantalla la muestra enmascarada)
      const clave = b.clave ? cifrar(yaCifrada ? String(b.clave).replace(/\s+/g, '') : String(b.clave)) : { cifrado: prev.clave_cifrada, iv: prev.clave_iv, tag: prev.clave_tag };
      await c.query(
        `INSERT INTO credencial_api (ambiente, url, usuario, identification, terminal, channel, rsa_public_key, clave_cifrada, clave_iv, clave_tag,
                                     clave_cargada_por, clave_cargada_en, actualizado_por, actualizado_en, clave_ya_cifrada)
         VALUES ($1, $2, $3, $4, $5, '3', $6, $7, $8, $9, $10, $11, $12, now(), $13)
         ON CONFLICT (ambiente) DO UPDATE SET url = $2, usuario = $3, identification = $4, terminal = $5, rsa_public_key = $6,
           clave_cifrada = $7, clave_iv = $8, clave_tag = $9, clave_cargada_por = $10, clave_cargada_en = $11, actualizado_por = $12, actualizado_en = now(), clave_ya_cifrada = $13`,
        [amb, url, b.usuario, String(b.identification), b.terminal, b.rsaPublicKey || prev?.rsa_public_key || '', clave.cifrado, clave.iv, clave.tag,
          b.clave ? req.user.usuario : prev.clave_cargada_por, b.clave ? new Date() : prev.clave_cargada_en, req.user.usuario, modo]);
      const cambios = [
        prev && prev.url !== url && `URL: ${prev.url} → ${url}`, prev?.usuario !== b.usuario && `usuario: ${prev?.usuario ?? '—'} → ${b.usuario}`,
        prev?.identification !== String(b.identification) && 'identification', prev?.terminal !== b.terminal && `terminal: ${prev?.terminal ?? '—'} → ${b.terminal}`,
        b.clave && `${prev ? 'clave reemplazada' : 'clave cargada'} (${yaCifrada ? 'ya cifrada por el banco' : 'texto plano'})`, b.rsaPublicKey && (prev ? 'llave RSA reemplazada' : 'llave RSA cargada'),
      ].filter(Boolean);
      await auditar(c, req, { tipo: 'Administración', accion: 'Actualizó credencial API Banking', api: 'Gestor de secretos', detalle: `${amb} · ${cambios.join(' · ') || 'sin cambios'}` }); // nunca el valor de la clave
    });
    bdv.invalidar(); // la próxima llamada al banco hace login con la credencial nueva
    return estadoCredencial(amb);
  });

  app.post('/credenciales/:ambiente/probar', async (req) => {
    if (!esAmbiente(req.params.ambiente)) throw invalido('Ambiente inválido');
    const cred = await leerCredencial(req.params.ambiente);
    if (!cred) throw invalido('No hay credencial cargada para ese ambiente');
    try {
      const r = await bdv.login(cred); // no reemplaza la sesión vigente
      await auditar(null, req, { tipo: 'Administración', accion: 'Probó conexión con API Banking', api: 'login · getUserEntityInformation', detalle: `${req.params.ambiente} · conexión OK` });
      return { ok: true, cliente: r.entidad?.completeName ?? null };
    } catch (e) {
      await auditar(null, req, { tipo: 'Administración', accion: 'Probó conexión con API Banking', api: 'login · getUserEntityInformation', detalle: `${req.params.ambiente} · ${e.message}`, resultado: 'Error' });
      return { ok: false, error: e.message };
    }
  });
}
