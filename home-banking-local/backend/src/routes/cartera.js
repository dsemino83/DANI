// Cartera de oficiales: el aprobador define qué clientes (empresas) ve cada oficial (perfil operador).
// Por defecto un oficial ve todas las cuentas de las empresas que le habilitó el administrador; con
// cartera asignada, solo las de esos clientes. El aprobador solo asigna clientes que él mismo ve.
import { auditar } from '../auditoria.js';
import { operativa, tx } from '../db.js';
import { invalido, prohibido } from '../errores.js';
import { listarUsuarios } from '../usuarios.js';

const esAprobador = async (req) => {
  if (req.user.rol !== 'autorizante') throw prohibido('Solo un aprobador define la cartera de los oficiales');
};

const empresasDelAprobador = async (usuario) => (await operativa.query(
  `SELECT e.id, e.razon_social, e.cuit,
          (SELECT COUNT(*) FROM empresa_cbu ce WHERE ce.empresa_id = e.id AND ce.estado = N'activa') AS cuentas
     FROM empresa e JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1 AND p.ver = 1
    WHERE e.activa = 1 ORDER BY e.razon_social`, [usuario])).rows;

const oficiales = async () => (await listarUsuarios()).filter((u) => u.rol === 'operador' && u.habilitado !== false);

export default async function rutasCartera(app) {
  app.addHook('preHandler', esAprobador);

  app.get('/oficiales', async () => {
    const asignadas = new Map((await operativa.query('SELECT oficial, COUNT(*) AS n FROM cartera_oficial GROUP BY oficial')).rows.map((r) => [r.oficial, r.n]));
    return (await oficiales()).map((u) => ({ usuario: u.usuario, nombre: u.nombre, clientes: asignadas.get(u.usuario) ?? 0 }));
  });

  app.get('/oficiales/:oficial', async (req) => {
    const propias = await empresasDelAprobador(req.user.usuario);
    const asignadas = (await operativa.query(
      'SELECT CAST(co.empresa_id AS varchar(30)) AS empresa_id, e.razon_social FROM cartera_oficial co JOIN empresa e ON e.id = co.empresa_id WHERE co.oficial = $1', [req.params.oficial])).rows;
    const ids = new Set(asignadas.map((a) => a.empresa_id));
    const visibles = new Set(propias.map((e) => String(e.id)));
    const chat = (await operativa.query('SELECT notificar FROM oficial_chat WHERE oficial = $1', [req.params.oficial])).rows[0];
    return {
      oficial: req.params.oficial,
      clientes: propias.map((e) => ({ ...e, asignada: ids.has(String(e.id)) })),
      fueraDeTuVista: asignadas.filter((a) => !visibles.has(a.empresa_id)).map((a) => a.razon_social), // asignadas por otro aprobador
      notificarChat: chat?.notificar ?? false, // recibe las alertas de movimientos por chat de Teams
    };
  });

  // Reemplaza la cartera del oficial dentro de los clientes que ve el aprobador (no toca los demás).
  app.put('/oficiales/:oficial', async (req) => {
    const oficial = req.params.oficial;
    if (oficial === req.user.usuario) throw invalido('No podés definir tu propia cartera');
    if (!(await oficiales()).some((u) => u.usuario === oficial)) throw invalido(`${oficial} no es un oficial (perfil operador) habilitado`);
    const propias = await empresasDelAprobador(req.user.usuario);
    const visibles = new Map(propias.map((e) => [String(e.id), e]));
    const pedidas = new Set((req.body?.empresas ?? []).map(String));
    const ajenas = [...pedidas].filter((id) => !visibles.has(id));
    if (ajenas.length) throw prohibido('Solo podés asignar clientes que vos ves');
    return tx(operativa, async (c) => {
      const antes = new Set((await c.query('SELECT CAST(empresa_id AS varchar(30)) AS empresa_id FROM cartera_oficial WITH (UPDLOCK, ROWLOCK) WHERE oficial = $1 AND empresa_id IN (SELECT CAST(value AS bigint) FROM OPENJSON($2))',
        [oficial, [...visibles.keys()]])).rows.map((r) => r.empresa_id));
      const altas = [...pedidas].filter((id) => !antes.has(id)), bajas = [...antes].filter((id) => !pedidas.has(id));
      for (const id of altas) await c.query('INSERT INTO cartera_oficial (oficial, empresa_id, asignado_por) VALUES ($1, $2, $3)', [oficial, id, req.user.usuario]);
      if (bajas.length) await c.query('DELETE FROM cartera_oficial WHERE oficial = $1 AND empresa_id IN (SELECT CAST(value AS bigint) FROM OPENJSON($2))', [oficial, bajas]);
      const total = (await c.query('SELECT COUNT(*) AS n FROM cartera_oficial WHERE oficial = $1', [oficial])).rows[0].n;
      const nombres = (ids) => ids.map((id) => visibles.get(id).razon_social).join(', ') || 'ninguno';
      if (altas.length || bajas.length) {
        await auditar(c, req, { tipo: 'Administración', accion: 'Modificó cartera de oficial', api: 'Cartera de oficiales',
          detalle: `${oficial} · asignó: ${nombres(altas)} · quitó: ${nombres(bajas)} · ${total ? `ve solo ${total} cliente(s)` : 'sin cartera: ve todas sus empresas'}` });
      }
      // Recepción de las alertas de movimientos por chat de Teams (flag por oficial).
      let notificarChat;
      if (req.body?.notificarChat !== undefined) {
        notificarChat = Boolean(req.body.notificarChat);
        const antesChat = (await c.query('SELECT notificar FROM oficial_chat WHERE oficial = $1', [oficial])).rows[0]?.notificar ?? false;
        if (antesChat !== notificarChat) {
          await c.query(`UPDATE oficial_chat WITH (UPDLOCK, SERIALIZABLE) SET notificar = $2, actualizado_por = $3, actualizado_en = SYSDATETIMEOFFSET() WHERE oficial = $1;
                          IF @@ROWCOUNT = 0 INSERT INTO oficial_chat (oficial, notificar, actualizado_por) VALUES ($1, $2, $3);`, [oficial, notificarChat, req.user.usuario]);
          await auditar(c, req, { tipo: 'Administración', accion: 'Configuró alertas por chat de un oficial', api: 'Cartera de oficiales',
            detalle: `${oficial} · alertas de movimientos por chat de Teams: ${notificarChat ? 'activadas' : 'desactivadas'}` });
        }
      }
      return { oficial, altas: altas.length, bajas: bajas.length, total, notificarChat };
    });
  });
}
