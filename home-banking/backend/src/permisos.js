// Permisos por empresa. El banco devuelve TODAS las cuentas de VALO (credencial única),
// por eso el backend filtra y valida en cada llamada; la pantalla no alcanza.
import { operativa } from './db.js';
import { prohibido } from './errores.js';

// Cuentas que el usuario puede ver/operar: cuenta activa de una empresa activa + permiso explícito del
// administrador. Si un aprobador le asignó una cartera de clientes, además solo las de esos clientes.
// Sin empresas ni cuentas cargadas por el administrador, nadie ve ninguna cuenta.
export async function cuentasHabilitadas(usuario, { operar = false } = {}) {
  const { rows } = await operativa.query(
    `SELECT ce.product_number, e.id AS empresa_id, e.razon_social, e.cuit, p.ver, p.operar
       FROM empresa_cbu ce
       JOIN empresa e         ON e.id = ce.empresa_id AND e.activa AND ce.estado = 'activa'
       JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1
      WHERE p.ver AND ($2::boolean = false OR p.operar)
        AND (NOT EXISTS (SELECT 1 FROM cartera_oficial co WHERE co.oficial = $1)
             OR EXISTS (SELECT 1 FROM cartera_oficial co WHERE co.oficial = $1 AND co.empresa_id = e.id))`,
    [usuario, operar],
  );
  return new Map(rows.map((r) => [r.product_number, r]));
}

export async function exigirCuenta(usuario, productNumber, { operar = false } = {}) {
  const { rows } = await operativa.query(
    `SELECT ce.product_number, e.id AS empresa_id, e.razon_social, e.cuit, p.ver, p.operar
       FROM empresa_cbu ce
       JOIN empresa e         ON e.id = ce.empresa_id AND e.activa AND ce.estado = 'activa'
       JOIN permiso_empresa p ON p.empresa_id = e.id AND p.usuario = $1
      WHERE ce.product_number = $2
        AND p.ver AND ($3::boolean = false OR p.operar)
        AND (NOT EXISTS (SELECT 1 FROM cartera_oficial co WHERE co.oficial = $1)
             OR EXISTS (SELECT 1 FROM cartera_oficial co WHERE co.oficial = $1 AND co.empresa_id = e.id))
      LIMIT 1`,
    [usuario, String(productNumber), operar],
  );
  const c = rows[0];
  if (!c) throw prohibido(operar ? 'No podés operar con esa cuenta' : 'No tenés acceso a esa cuenta');
  return c;
}
