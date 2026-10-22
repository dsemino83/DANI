// Buzón de mensajes de cada usuario: solo ve los suyos y los marca como vistos al leerlos.
import { operativa } from '../db.js';
import { noEncontrado } from '../errores.js';

export default async function rutasMensajes(app) {
  // Últimos 100, con el estado actual de la operación (para saber si todavía espera autorización)
  app.get('/mensajes', async (req) => (await operativa.query(
    `SELECT m.*, coalesce(t.estado, l.estado) AS estado_operacion
       FROM mensaje m
       LEFT JOIN transferencia t ON m.ref_tipo = 'transferencia' AND t.id = m.ref_id
       LEFT JOIN lote l ON m.ref_tipo = 'lote' AND l.id = m.ref_id
      WHERE m.usuario = $1 ORDER BY m.creado_en DESC, m.id DESC LIMIT 100`, [req.user.usuario])).rows);

  app.get('/mensajes/no-vistos', async (req) => {
    const { rows } = await operativa.query('SELECT count(*)::int AS n, max(id)::text AS ultimo FROM mensaje WHERE usuario = $1 AND visto_en IS NULL', [req.user.usuario]);
    return { noVistos: rows[0].n, ultimo: rows[0].ultimo };
  });

  // Leído por el destinatario: queda la primera fecha de lectura
  app.post('/mensajes/:id/visto', async (req) => {
    const { rows } = await operativa.query(
      'UPDATE mensaje SET visto_en = coalesce(visto_en, now()) WHERE id = $1 AND usuario = $2 RETURNING id, visto_en', [req.params.id, req.user.usuario]);
    if (!rows[0]) throw noEncontrado('Mensaje inexistente');
    return rows[0];
  });
}
