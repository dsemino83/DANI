// Buzón de mensajes de cada usuario: solo ve los suyos, de los últimos 7 días, y los marca como vistos al leerlos.
import { operativa } from '../db.js';
import { noEncontrado } from '../errores.js';

export const DIAS_BUZON = 7;

// Los no leídos cuya operación ya no espera autorización (aprobada, rechazada o enviada) pasan solos a leídos
const resolverPendientes = (usuario) => operativa.query(
  `UPDATE mensaje m SET visto_en = now(), visto_motivo = 'operacion_resuelta'
    WHERE m.usuario = $1 AND m.visto_en IS NULL
      AND ((m.ref_tipo = 'transferencia' AND EXISTS (SELECT 1 FROM transferencia t WHERE t.id = m.ref_id AND t.estado <> 'PENDIENTE_APROBACION'))
        OR (m.ref_tipo = 'lote' AND EXISTS (SELECT 1 FROM lote l WHERE l.id = m.ref_id AND l.estado <> 'PENDIENTE_APROBACION')))`, [usuario]);

export default async function rutasMensajes(app) {
  // Últimos 7 días (lo anterior no se muestra), con el estado actual de la operación
  app.get('/mensajes', async (req) => {
    await resolverPendientes(req.user.usuario);
    return (await operativa.query(
      `SELECT m.*, coalesce(t.estado, l.estado) AS estado_operacion
         FROM mensaje m
         LEFT JOIN transferencia t ON m.ref_tipo = 'transferencia' AND t.id = m.ref_id
         LEFT JOIN lote l ON m.ref_tipo = 'lote' AND l.id = m.ref_id
        WHERE m.usuario = $1 AND m.creado_en >= now() - make_interval(days => $2)
        ORDER BY m.creado_en DESC, m.id DESC LIMIT 200`, [req.user.usuario, DIAS_BUZON])).rows;
  });

  app.get('/mensajes/no-vistos', async (req) => {
    await resolverPendientes(req.user.usuario);
    const { rows } = await operativa.query(
      `SELECT count(*)::int AS n, max(id)::text AS ultimo FROM mensaje
        WHERE usuario = $1 AND visto_en IS NULL AND creado_en >= now() - make_interval(days => $2)`, [req.user.usuario, DIAS_BUZON]);
    return { noVistos: rows[0].n, ultimo: rows[0].ultimo };
  });

  // Leído por el destinatario: solo ese mensaje (los demás siguen sin leer); queda la primera fecha de lectura
  app.post('/mensajes/:id/visto', async (req) => {
    const { rows } = await operativa.query(
      `UPDATE mensaje SET visto_en = coalesce(visto_en, now()), visto_motivo = coalesce(visto_motivo, 'leido')
        WHERE id = $1 AND usuario = $2 RETURNING id, visto_en, visto_motivo`, [req.params.id, req.user.usuario]);
    if (!rows[0]) throw noEncontrado('Mensaje inexistente');
    return rows[0];
  });
}
