// Documentación incluida en la aplicación (viaja en la imagen del backend): el manual de usuario para todos;
// la de auditoría y la técnica solo para el auditor y el administrador de seguridad. Se registra la consulta.
import { readFileSync, statSync } from 'node:fs';
import { auditar } from '../auditoria.js';
import { noEncontrado, prohibido } from '../errores.js';

const DOCS = {
  manual: { archivo: 'manual.md', roles: null },
  auditoria: { archivo: 'auditoria.md', roles: ['auditor', 'administrador'] },
  tecnica: { archivo: 'tecnica.md', roles: ['auditor', 'administrador'] },
};
const ruta = (archivo) => new URL(`../docs/${archivo}`, import.meta.url);

export default async function rutasDocs(app) {
  app.get('/docs/:nombre', async (req) => {
    const d = DOCS[req.params.nombre];
    if (!d) throw noEncontrado('Documento inexistente');
    if (d.roles && !d.roles.includes(req.user.rol)) throw prohibido('Documento disponible solo para auditor y administrador');
    const texto = readFileSync(ruta(d.archivo), 'utf8');
    if (d.roles) await auditar(null, req, { tipo: 'Consultas', accion: 'Consultó documentación', detalle: req.params.nombre });
    return { nombre: req.params.nombre, titulo: texto.match(/^# (.+)$/m)?.[1] ?? req.params.nombre, actualizado: statSync(ruta(d.archivo)).mtime, markdown: texto };
  });
}
