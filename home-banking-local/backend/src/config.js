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

const esVerdadero = (v) => ['true', '1', 'si', 'sí'].includes(String(v).toLowerCase());

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

  // Usuarios propios (sin SSO). Cada token dura HB_SESION_MINUTOS y el navegador lo renueva mientras se usa;
  // pasadas HB_SESION_HORAS_MAX desde el ingreso hay que volver a ingresar. Tras HB_INTENTOS_MAX claves erróneas
  // seguidas el usuario queda bloqueado HB_BLOQUEO_MINUTOS (o hasta que el administrador lo desbloquee).
  sesion: {
    minutos: Math.max(5, Number(leer('HB_SESION_MINUTOS', '15'))),
    horasMaximas: Math.max(1, Number(leer('HB_SESION_HORAS_MAX', '10'))),
    intentosMaximos: Math.max(3, Number(leer('HB_INTENTOS_MAX', '5'))),
    bloqueoMinutos: Math.max(1, Number(leer('HB_BLOQUEO_MINUTOS', '15'))),
  },
  // Dirección con la que entran los usuarios: arma el link de los correos para elegir clave.
  urlPublica: leer('HB_URL_PUBLICA', 'https://localhost').replace(/\/+$/, ''),
  // Primer administrador: se crea solo si la tabla de usuarios está vacía, con la clave del secreto
  // admin_inicial_password (temporal: la cambia en su primer ingreso).
  adminInicial: {
    usuario: leer('HB_ADMIN_USUARIO', 'admin'),
    email: leer('HB_ADMIN_EMAIL', 'admin@homebanking.local'),
    clave: process.env.HB_ADMIN_CLAVE_FILE || process.env.HB_ADMIN_CLAVE ? leer('HB_ADMIN_CLAVE') : '',
  },

  // SQL Server 2025: una instancia con dos bases (operativa e histórica) y un login de mínimo privilegio por función.
  // La conexión va cifrada (TLS). Con el certificado autofirmado del contenedor hace falta DB_TRUST_SERVER_CERT=true (red interna
  // de Docker); con un servidor de VALO y certificado de una CA propia, ponerlo en false.
  db: {
    operativa: {
      host: leer('DB_HOST', 'sqlserver'),
      port: Number(leer('DB_PORT', '1433')),
      database: leer('DB_NAME', 'homebanking'),
      user: leer('DB_USER', 'hb_app'),
      password: leer('DB_PASSWORD'),
      max: Number(leer('DB_POOL_MAX', '20')),
      encrypt: esVerdadero(leer('DB_ENCRYPT', 'true')),
      trustServerCertificate: esVerdadero(leer('DB_TRUST_SERVER_CERT', 'true')),
      requestTimeoutMs: Number(leer('DB_REQUEST_TIMEOUT_MS', '60000')),
    },
    historica: {
      host: leer('DBH_HOST', leer('DB_HOST', 'sqlserver')),
      port: Number(leer('DBH_PORT', leer('DB_PORT', '1433'))),
      database: leer('DBH_NAME', 'homebanking_hist'),
      user: leer('DBH_USER', 'hb_hist_ro'),
      password: leer('DBH_PASSWORD'),
      max: Number(leer('DBH_POOL_MAX', '5')),
      encrypt: esVerdadero(leer('DB_ENCRYPT', 'true')),
      trustServerCertificate: esVerdadero(leer('DB_TRUST_SERVER_CERT', 'true')),
      requestTimeoutMs: Number(leer('DB_REQUEST_TIMEOUT_MS', '60000')),
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
