// Buzón de mensajes de cada usuario: solo ve los suyos, de los últimos 7 días, y los marca como vistos al leerlos.
import { operativa } from '../db.js';
import { noEncontrado } from '../errores.js';

export const DIAS_BUZON = 7;

// Los no leídos cuya operación ya no espera autorización (aprobada, rechazada o enviada) pasan solos a leídos
const resolverPendientes = (usuario) => operativa.query(
  `UPDATE m SET visto_en = SYSDATETIMEOFFSET(), visto_motivo = N'operacion_resuelta'
     FROM mensaje m
    WHERE m.usuario = $1 AND m.visto_en IS NULL
      AND ((m.ref_tipo = N'transferencia' AND EXISTS (SELECT 1 FROM transferencia t WHERE t.id = m.ref_id AND t.estado <> N'PENDIENTE_APROBACION'))
        OR (m.ref_tipo = N'lote' AND EXISTS (SELECT 1 FROM lote l WHERE l.id = m.ref_id AND l.estado <> N'PENDIENTE_APROBACION')))`, [usuario]);

export default async function rutasMensajes(app) {
  // Últimos 7 días (lo anterior no se muestra), con el estado actual de la operación
  app.get('/mensajes', async (req) => {
    await resolverPendientes(req.user.usuario);
    return (await operativa.query(
      `SELECT TOP (200) m.*, COALESCE(t.estado, l.estado) AS estado_operacion
         FROM mensaje m
         LEFT JOIN transferencia t ON m.ref_tipo = N'transferencia' AND t.id = m.ref_id
         LEFT JOIN lote l ON m.ref_tipo = N'lote' AND l.id = m.ref_id
        WHERE m.usuario = $1 AND m.creado_en >= DATEADD(day, -$2, SYSDATETIMEOFFSET())
        ORDER BY m.creado_en DESC, m.id DESC`, [req.user.usuario, DIAS_BUZON])).rows;
  });

  app.get('/mensajes/no-vistos', async (req) => {
    await resolverPendientes(req.user.usuario);
    const { rows } = await operativa.query(
      `SELECT COUNT(*) AS n, CAST(MAX(id) AS varchar(20)) AS ultimo FROM mensaje
        WHERE usuario = $1 AND visto_en IS NULL AND creado_en >= DATEADD(day, -$2, SYSDATETIMEOFFSET())`, [req.user.usuario, DIAS_BUZON]);
    return { noVistos: rows[0].n, ultimo: rows[0].ultimo };
  });

  // Leído por el destinatario: solo ese mensaje (los demás siguen sin leer); queda la primera fecha de lectura
  app.post('/mensajes/:id/visto', async (req) => {
    const { rows } = await operativa.query(
      `UPDATE mensaje SET visto_en = COALESCE(visto_en, SYSDATETIMEOFFSET()), visto_motivo = COALESCE(visto_motivo, N'leido')
      OUTPUT inserted.id, inserted.visto_en, inserted.visto_motivo
        WHERE id = $1 AND usuario = $2`, [req.params.id, req.user.usuario]);
    if (!rows[0]) throw noEncontrado('Mensaje inexistente');
    return rows[0];
  });
}
