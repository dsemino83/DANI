// Configuración por variables de entorno. Los secretos se leen de archivos
// (Docker secrets) indicados con la variable <NOMBRE>_FILE; nunca de la imagen.
import { readFileSync } from 'node:fs';
import { retencionMeses } from './corte.js';

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

  // Power Automate: URL del flujo HTTP que publica las alertas de movimientos por chat de Teams.
  // Vacío = no se envían notificaciones por chat (solo el correo al cliente). Es un secreto: puede ir por
  // HB_POWERAUTOMATE_URL_FILE. El dominio por defecto para armar el destinatario de Teams es HB_CHAT_DOMINIO.
  powerAutomateUrl: leer('HB_POWERAUTOMATE_URL', ''),
  chatDominio: leer('HB_CHAT_DOMINIO', '@valo.ar'),

  // Observabilidad: endpoint /api/metrics para Prometheus. Apagado por defecto. El token protege el scrape
  // (Prometheus manda Authorization: Bearer <token>); puede ir por METRICS_TOKEN o METRICS_TOKEN_FILE. Vacío
  // y habilitado = sin token (aceptable solo en red interna; nginx igual no expone /api/metrics al público).
  metricas: {
    habilitado: ['true', '1', 'si', 'sí'].includes(String(leer('METRICS_ENABLED', 'false')).toLowerCase()),
    token: leer('METRICS_TOKEN', ''),
  },

  // Monitoreo sintético de disponibilidad del banco (solo lectura). Apagado por defecto.
  sintetico: {
    habilitado: ['true', '1', 'si', 'sí'].includes(String(leer('SYNTHETIC_MONITOR_ENABLED', 'false')).toLowerCase()),
    cron: leer('SYNTHETIC_MONITOR_CRON', '*/5 * * * *'),
    timeoutMs: Math.max(1000, Number(leer('SYNTHETIC_TIMEOUT_MS', '10000'))),
  },

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
    },
    historica: {
      host: leer('DBH_HOST', 'postgres-historico'),
      port: Number(leer('DBH_PORT', '5432')),
      database: leer('DBH_NAME', 'homebanking_hist'),
      user: leer('DBH_USER', 'hb_hist_ro'),
      password: leer('DBH_PASSWORD'),
      max: Number(leer('DBH_POOL_MAX', '5')),
    },
  },

  // Llave maestra (32 bytes en base64) para cifrar la clave API en reposo.
  llaveMaestra: Buffer.from(leer('CREDENCIALES_MASTER_KEY'), 'base64'),

  bdv: {
    timeoutMs: Number(leer('BDV_TIMEOUT_MS', '30000')),
    sesionMinutos: Number(leer('BDV_SESION_MINUTOS', '20')), // minutos sin usar la sesión del banco antes de renovarla
    paginaMovimientos: 900, // getMovementsDetail: tamaño de página acordado
    maxPaginasMovimientos: Number(leer('BDV_MAX_PAGINAS', '200')),
    // Cuentas distintas que se consultan a la vez (solo lectura, p. ej. débitos de varias cuentas). La paginación de una cuenta es secuencial.
    concurrencia: Math.max(1, Math.min(8, Number(leer('BDV_CONCURRENCIA', '3')))),
    // Circuit breaker de consultas: evita insistir contra BDV cuando hay una degradación sostenida.
    // Los envíos de dinero nunca se usan como prueba de recuperación (half-open).
    circuitBreaker: {
      habilitado: ['true', '1', 'si', 'sí'].includes(String(leer('BDV_CIRCUIT_BREAKER_ENABLED', 'true')).toLowerCase()),
      umbralFallos: Math.max(1, Number(leer('BDV_CIRCUIT_BREAKER_FAILURES', '5'))),
      esperaMs: Math.max(1000, Number(leer('BDV_CIRCUIT_BREAKER_RESET_MS', '30000'))),
    },
  },

  // Monto (ARS) que el banco deja operar sin su propia autorización. Solo informativo:
  // el estado real lo devuelve el banco (nroControl / getTransfersStatus).
  limiteSinAutorizacion: Number(leer('BDV_LIMITE_SIN_AUTORIZACION', '0')),

  // Meses completos que conserva la base operativa además del mes en curso; lo anterior pasa a la histórica
  retencionMesesOperativa: retencionMeses(),
};

if (!['homo', 'prod'].includes(config.ambiente)) {
  throw new Error('BDV_AMBIENTE debe ser homo o prod');
}
if (config.llaveMaestra.length !== 32) {
  throw new Error('CREDENCIALES_MASTER_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32)');
}
