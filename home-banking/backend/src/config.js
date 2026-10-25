// Configuración por variables de entorno. Los secretos se leen de archivos
// (Docker secrets) indicados con la variable <NOMBRE>_FILE; nunca de la imagen.
import { readFileSync } from 'node:fs';

const leer = (nombre, porDefecto) => {
  const archivo = process.env[`${nombre}_FILE`];
  if (archivo) return readFileSync(archivo, 'utf8').trim();
  const valor = process.env[nombre];
  if (valor !== undefined && valor !== '') return valor;
  if (porDefecto !== undefined) return porDefecto;
  throw new Error(`Falta la variable de configuración ${nombre} (o ${nombre}_FILE)`);
};

export const config = {
  puerto: Number(leer('PORT', '8080')),
  ambiente: leer('BDV_AMBIENTE', 'homo'), // 'homo' | 'prod': qué credencial API usa este backend
  // Modo solo consultas: saldos, movimientos, débitos y CBU reales; ninguna transferencia llega al banco.
  // Pensado para la primera prueba con producción.
  soloConsultas: ['true', '1', 'si', 'sí'].includes(String(leer('BDV_SOLO_CONSULTAS', 'false')).toLowerCase()),

  oidc: {
    issuer: leer('OIDC_ISSUER'), // p. ej. https://ssohomo.valo.ar/valo/realms/staff (debe coincidir con el iss del token)
    // URL con la que el backend llega al realm (JWKS, tokens, Admin API). En desarrollo difiere del issuer público.
    urlInterna: leer('OIDC_INTERNAL_URL', process.env.OIDC_ISSUER ?? ''),
    audience: leer('OIDC_AUDIENCE', 'home-banking-api'),
    clienteRoles: leer('OIDC_ROLES_CLIENT', 'home-banking-api'), // client donde viven los roles de la app
    // Service account para asignar roles Crear/Aprobar desde la pestaña Permisos (Keycloak Admin API)
    adminClientId: leer('KEYCLOAK_ADMIN_CLIENT_ID', ''),
    adminClientSecret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET_FILE || process.env.KEYCLOAK_ADMIN_CLIENT_SECRET
      ? leer('KEYCLOAK_ADMIN_CLIENT_SECRET') : '',
  },

  db: {
    operativa: {
      host: leer('DB_HOST', 'postgres'),
      port: Number(leer('DB_PORT', '5432')),
      database: leer('DB_NAME', 'homebanking'),
      user: leer('DB_USER', 'hb_app'),
      password: leer('DB_PASSWORD'),
      max: Number(leer('DB_POOL_MAX', '20')),
      min: Number(leer('DB_POOL_MIN', '2')),
      idleTimeoutMillis: Number(leer('DB_POOL_IDLE_MS', '30000')),
      connectionTimeoutMillis: Number(leer('DB_POOL_CONNECT_MS', '3000')),
      maxUses: Number(leer('DB_POOL_MAX_USES', '7500')),
      application_name: 'home-banking-api-operativa',
      statement_timeout: Number(leer('DB_STATEMENT_TIMEOUT_MS', '5000')),
      query_timeout: Number(leer('DB_QUERY_TIMEOUT_MS', '6000')),
    },
    historica: {
      host: leer('DBH_HOST', 'postgres-historico'),
      port: Number(leer('DBH_PORT', '5432')),
      database: leer('DBH_NAME', 'homebanking_hist'),
      user: leer('DBH_USER', 'hb_hist_ro'),
      password: leer('DBH_PASSWORD'),
      max: Number(leer('DBH_POOL_MAX', '5')),
      min: Number(leer('DBH_POOL_MIN', '1')),
      idleTimeoutMillis: Number(leer('DBH_POOL_IDLE_MS', '30000')),
      connectionTimeoutMillis: Number(leer('DBH_POOL_CONNECT_MS', '3000')),
      maxUses: Number(leer('DBH_POOL_MAX_USES', '7500')),
      application_name: 'home-banking-api-historica',
      statement_timeout: Number(leer('DBH_STATEMENT_TIMEOUT_MS', '8000')),
      query_timeout: Number(leer('DBH_QUERY_TIMEOUT_MS', '9000')),
    },
  },

  // Llave maestra (32 bytes en base64) para cifrar la clave API en reposo.
  llaveMaestra: Buffer.from(leer('CREDENCIALES_MASTER_KEY'), 'base64'),

  bdv: {
    timeoutMs: Number(leer('BDV_TIMEOUT_MS', '30000')),
    sesionMinutos: Number(leer('BDV_SESION_MINUTOS', '20')), // minutos sin usar la sesión del banco antes de renovarla
    paginaMovimientos: 900, // getMovementsDetail: tamaño de página acordado
    maxPaginasMovimientos: Number(leer('BDV_MAX_PAGINAS', '200')),
    cacheCuentasMs: Number(leer('BDV_CACHE_CUENTAS_MS', '10000')),
    cacheSaldosMs: Number(leer('BDV_CACHE_SALDOS_MS', '3000')),
    concurrenciaConsultas: Number(leer('BDV_CONCURRENCIA_CONSULTAS', '4')),
  },

  // Monto (ARS) que el banco deja operar sin su propia autorización. Solo informativo:
  // el estado real lo devuelve el banco (nroControl / getTransfersStatus).
  limiteSinAutorizacion: Number(leer('BDV_LIMITE_SIN_AUTORIZACION', '0')),

  retencionMesesOperativa: 3,
};

if (!['homo', 'prod'].includes(config.ambiente)) {
  throw new Error('BDV_AMBIENTE debe ser homo o prod');
}
if (config.llaveMaestra.length !== 32) {
  throw new Error('CREDENCIALES_MASTER_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32)');
}
