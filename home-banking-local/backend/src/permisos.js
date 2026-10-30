// Permisos por empresa. El banco devuelve TODAS las cuentas de VALO (credencial única),
// por eso el backend filtra y valida en cada llamada; la pantalla no alcanza.
import { operativa } from './db.js';
import { prohibido } from './errores.js';

// Cuentas que el usuario puede ver/operar: cuenta activa de una empresa activa + permiso explícito del
// administrador. Si un aprobador le asignó una cartera de clientes, además solo las de esos clientes.
// Sin empresas ni cuentas cargadas por el administrador, nadie ve ninguna cuenta.
export async function cuentasHabilitadas(usuario, { operar = false, cuenta = null } = {}) {
  const { rows } = await operativa.query(
    `SELECT ce.product_number, e.id AS empresa_id, e.razon_social, e.cuit, p.ver, p.operar
       FROM empresa_cbu ce
       JOIN empresa e         ON e.id = ce.empresa_id AND e.activa = 1 AND ce.estado = N'activa'
       JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1
      WHERE p.ver = 1 AND ($2 = 0 OR p.operar = 1)
        AND ($3 IS NULL OR ce.product_number = $3)
        AND (NOT EXISTS (SELECT 1 FROM cartera_oficial co WHERE co.oficial = $1)
             OR EXISTS (SELECT 1 FROM cartera_oficial co WHERE co.oficial = $1 AND co.empresa_id = e.id))`,
    [usuario, operar, cuenta],
  );
  return new Map(rows.map((r) => [r.product_number, r]));
}

// Mismas reglas que cuentasHabilitadas, pero la consulta ya filtra por la cuenta pedida: no carga todas las del usuario.
export async function exigirCuenta(usuario, productNumber, { operar = false } = {}) {
  const habilitadas = await cuentasHabilitadas(usuario, { operar, cuenta: String(productNumber) });
  const c = habilitadas.get(String(productNumber));
  if (!c) throw prohibido(operar ? 'No podés operar con esa cuenta' : 'No tenés acceso a esa cuenta');
  return c;
}
