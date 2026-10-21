// Auditoría nativa: se escribe con el MISMO cliente de la transacción de la acción,
// así si la inserción falla la acción se revierte (y viceversa).
import { operativa } from './db.js';

export async function auditar(cliente, req, { tipo, accion, api = null, detalle = '', resultado = 'OK', ref = null }) {
  const u = req?.user;
  await (cliente ?? operativa).query(
    `INSERT INTO auditoria (usuario, rol, tipo, accion, api, detalle, resultado, ip, ref_tipo, ref_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [u?.usuario ?? 'sistema', u?.rol ?? 'sistema', tipo, accion, api, String(detalle).slice(0, 2000), resultado,
      req?.ip ?? null, ref?.tipo ?? null, ref?.id != null ? String(ref.id) : null],
  );
}

// Para tareas programadas (sin request)
export const auditarSistema = (cliente, datos) => auditar(cliente, { user: { usuario: 'sistema', rol: 'sistema' } }, datos);
