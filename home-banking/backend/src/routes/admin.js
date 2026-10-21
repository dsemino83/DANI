// Administración de seguridad: empresas, cuentas, permisos por empresa, roles Crear/Aprobar y credencial API.
// El administrador NO accede a saldos ni opera; todo cambio queda auditado en la misma transacción.
import { exigirRol, ROL_APROBAR, ROL_CREAR } from '../auth.js';
import { auditar } from '../auditoria.js';
import { operativa, tx } from '../db.js';
import { conflicto, invalido, noEncontrado } from '../errores.js';
import { cifrar, estadoCredencial, leerCredencial } from '../secretos.js';
import { bdv, cuentasPropias, pemDesdeBase64 } from '../bdv/cliente.js';
import { cambiarRol, rolesDeTransferencias } from '../keycloak-admin.js';
import { createPublicKey } from 'node:crypto';

const nivel = (p) => (!p ? 'sin acceso' : p.operar ? 'ver+operar' : p.ver ? 'ver' : 'sin acceso');

export default async function rutasAdmin(app) {
  app.addHook('preHandler', exigirRol('administrador'));

  // ---------------- Empresas ----------------
  app.get('/empresas', async () => (await operativa.query(
    `SELECT e.*, count(ce.product_number)::int AS cuentas
       FROM empresa e LEFT JOIN cuenta_empresa ce ON ce.empresa_id = e.id
      GROUP BY e.id ORDER BY e.razon_social`)).rows);

  app.post('/empresas', async (req, reply) => {
    const razon = String(req.body?.razonSocial ?? '').trim().toUpperCase();
    const cuit = String(req.body?.cuit ?? '').replace(/\D/g, '');
    if (!razon) throw invalido('Falta la razón social');
    if (cuit.length !== 11) throw invalido('El CUIT debe tener 11 dígitos');
    reply.code(201);
    return tx(operativa, async (c) => {
      const dup = await c.query('SELECT 1 FROM empresa WHERE cuit = $1', [cuit]);
      if (dup.rowCount) throw conflicto('Ya existe una empresa con ese CUIT');
      const { rows } = await c.query('INSERT INTO empresa (razon_social, cuit, creada_por) VALUES ($1, $2, $3) RETURNING *', [razon, cuit, req.user.usuario]);
      await auditar(c, req, { tipo: 'Administración', accion: 'Alta de empresa', detalle: `${razon} · CUIT ${cuit}`, ref: { tipo: 'empresa', id: rows[0].id } });
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

  // Eliminar: libera sus cuentas y borra los permisos de todos los usuarios sobre ella.
  app.delete('/empresas/:id', async (req) => tx(operativa, async (c) => {
    const { rows } = await c.query('SELECT * FROM empresa WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw noEncontrado('Empresa inexistente');
    const cuentas = (await c.query('UPDATE cuenta_empresa SET empresa_id = NULL, asignada_por = $2, asignada_en = now() WHERE empresa_id = $1 RETURNING product_number', [req.params.id, req.user.usuario])).rows.map((r) => r.product_number);
    const us = (await c.query('DELETE FROM permiso_empresa WHERE empresa_id = $1 RETURNING usuario', [req.params.id])).rows.map((r) => r.usuario);
    await c.query('DELETE FROM empresa WHERE id = $1', [req.params.id]);
    await auditar(c, req, {
      tipo: 'Administración', accion: 'Eliminó empresa', ref: { tipo: 'empresa', id: req.params.id },
      detalle: `${rows[0].razon_social} (CUIT ${rows[0].cuit}) · cuentas liberadas: ${cuentas.join(', ') || 'ninguna'} · permisos quitados a ${us.join(', ') || 'ningún usuario'}`,
    });
    return { eliminada: true, cuentasLiberadas: cuentas, permisosQuitados: us };
  }));

  // Cuentas para asignar: las sin empresa + las de la empresa elegida (solo número, alias y moneda; sin saldos)
  app.get('/empresas/:id/cuentas', async (req) => {
    const asignadas = new Map((await operativa.query('SELECT product_number, empresa_id FROM cuenta_empresa')).rows.map((r) => [r.product_number, r.empresa_id]));
    return (await cuentasPropias())
      .filter((c) => { const e = asignadas.get(String(c.productNumber)); return e == null || String(e) === String(req.params.id); })
      .map((c) => ({ cuenta: c.productNumber, alias: c.aliasName ?? c.productAlias, moneda: Number(c.currencyId) === 80 ? 'ARS' : 'USD', asignada: asignadas.get(String(c.productNumber)) != null }));
  });

  app.put('/empresas/:id/cuentas', async (req) => {
    const nuevas = new Set((req.body?.cuentas ?? []).map(String));
    return tx(operativa, async (c) => {
      const emp = (await c.query('SELECT * FROM empresa WHERE id = $1', [req.params.id])).rows[0];
      if (!emp) throw noEncontrado('Empresa inexistente');
      const actuales = (await c.query('SELECT product_number FROM cuenta_empresa WHERE empresa_id = $1', [req.params.id])).rows.map((r) => r.product_number);
      const ocupadas = (await c.query('SELECT product_number FROM cuenta_empresa WHERE empresa_id IS NOT NULL AND empresa_id <> $1 AND product_number = ANY($2)', [req.params.id, [...nuevas]])).rows;
      if (ocupadas.length) throw conflicto(`Cuentas asignadas a otra empresa: ${ocupadas.map((r) => r.product_number).join(', ')} (liberalas primero)`);
      const altas = [...nuevas].filter((n) => !actuales.includes(n)), bajas = actuales.filter((n) => !nuevas.has(n));
      for (const n of altas) {
        await c.query(`INSERT INTO cuenta_empresa (product_number, empresa_id, asignada_por, asignada_en) VALUES ($1, $2, $3, now())
                       ON CONFLICT (product_number) DO UPDATE SET empresa_id = $2, asignada_por = $3, asignada_en = now()`, [n, req.params.id, req.user.usuario]);
      }
      for (const n of bajas) await c.query('UPDATE cuenta_empresa SET empresa_id = NULL, asignada_por = $2, asignada_en = now() WHERE product_number = $1', [n, req.user.usuario]);
      await auditar(c, req, { tipo: 'Administración', accion: 'Modificó cuentas de empresa', ref: { tipo: 'empresa', id: req.params.id },
        detalle: `${emp.razon_social} · asignadas: ${altas.join(', ') || 'ninguna'} · liberadas: ${bajas.join(', ') || 'ninguna'}` });
      return { altas, bajas };
    });
  });

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
  app.get('/usuarios/:usuario/roles', async (req) => rolesDeTransferencias(req.params.usuario));

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
  app.get('/credenciales/:ambiente', async (req) => estadoCredencial(req.params.ambiente));

  app.put('/credenciales/:ambiente', async (req) => {
    const amb = req.params.ambiente;
    if (!['homo', 'prod'].includes(amb)) throw invalido('Ambiente inválido');
    const b = req.body ?? {};
    if (!/^https:\/\/\S+$/.test(b.url ?? '')) throw invalido('La URL base tiene que empezar con https://');
    if (!b.usuario || !b.terminal) throw invalido('Faltan usuario o terminal');
    if (!/^\d{7,11}$/.test(String(b.identification ?? ''))) throw invalido('identification debe tener entre 7 y 11 dígitos');
    if (b.rsaPublicKey) { try { createPublicKey(pemDesdeBase64(b.rsaPublicKey)); } catch { throw invalido('La llave pública RSA no es válida'); } }
    await tx(operativa, async (c) => {
      const prev = (await c.query('SELECT * FROM credencial_api WHERE ambiente = $1 FOR UPDATE', [amb])).rows[0];
      if (!prev && (!b.clave || !b.rsaPublicKey)) throw invalido('En la primera carga se requieren clave y llave RSA');
      const clave = b.clave ? cifrar(String(b.clave)) : { cifrado: prev.clave_cifrada, iv: prev.clave_iv, tag: prev.clave_tag };
      await c.query(
        `INSERT INTO credencial_api (ambiente, url, usuario, identification, terminal, channel, rsa_public_key, clave_cifrada, clave_iv, clave_tag,
                                     clave_cargada_por, clave_cargada_en, actualizado_por, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, '3', $6, $7, $8, $9, $10, $11, $12, now())
         ON CONFLICT (ambiente) DO UPDATE SET url = $2, usuario = $3, identification = $4, terminal = $5, rsa_public_key = $6,
           clave_cifrada = $7, clave_iv = $8, clave_tag = $9, clave_cargada_por = $10, clave_cargada_en = $11, actualizado_por = $12, actualizado_en = now()`,
        [amb, b.url, b.usuario, String(b.identification), b.terminal, b.rsaPublicKey || prev.rsa_public_key, clave.cifrado, clave.iv, clave.tag,
          b.clave ? req.user.usuario : prev.clave_cargada_por, b.clave ? new Date() : prev.clave_cargada_en, req.user.usuario]);
      const cambios = [
        prev?.url !== b.url && 'URL', prev?.usuario !== b.usuario && `usuario: ${prev?.usuario ?? '—'} → ${b.usuario}`,
        prev?.identification !== String(b.identification) && 'identification', prev?.terminal !== b.terminal && `terminal: ${prev?.terminal ?? '—'} → ${b.terminal}`,
        b.clave && (prev ? 'clave reemplazada' : 'clave cargada'), b.rsaPublicKey && (prev ? 'llave RSA reemplazada' : 'llave RSA cargada'),
      ].filter(Boolean);
      await auditar(c, req, { tipo: 'Administración', accion: 'Actualizó credencial API Banking', api: 'Gestor de secretos', detalle: `${amb} · ${cambios.join(' · ') || 'sin cambios'}` }); // nunca el valor de la clave
    });
    bdv.invalidar(); // la próxima llamada al banco hace login con la credencial nueva
    return estadoCredencial(amb);
  });

  app.post('/credenciales/:ambiente/probar', async (req) => {
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
