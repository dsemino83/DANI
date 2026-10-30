// Ingreso y sesión con usuarios propios (sin SSO).
//  Públicas (sin token):  POST /api/auth/ingresar · POST /api/auth/restablecer
//  Con sesión:            POST /api/auth/renovar  · POST /api/auth/salir · POST /api/auth/clave
import { autenticar } from '../auth.js';
import { consumir } from '../limites.js';
import { cambiarMiClave, ingresar, renovar, restablecerConToken, salir } from '../usuarios.js';

// Además del límite por IP de Nginx y del bloqueo por usuario: pocos intentos por minuto desde una misma IP.
async function limitarIngreso(req, reply) {
  const c = consumir(`ingreso|${req.ip}`, 20);
  if (!c.ok) {
    reply.header('retry-after', String(c.reintentarEnSeg));
    return reply.code(429).send({ error: 'demasiados_pedidos', mensaje: `Demasiados intentos seguidos. Probá de nuevo en ${c.reintentarEnSeg} s.` });
  }
}

export default async function rutasSesion(app) {
  app.post('/auth/ingresar', { preHandler: limitarIngreso }, async (req) => ingresar(req.body ?? {}, req));
  app.post('/auth/restablecer', { preHandler: limitarIngreso }, async (req) => restablecerConToken(req.body ?? {}, req));

  app.post('/auth/renovar', { onRequest: autenticar }, async (req) => renovar(req));
  app.post('/auth/salir', { onRequest: autenticar }, async (req, reply) => { await salir(req); reply.code(204); });
  app.post('/auth/clave', { onRequest: autenticar }, async (req) => cambiarMiClave(req, req.body ?? {}));
}
