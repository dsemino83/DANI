// Proceso de tareas programadas (servicio "jobs" del docker-compose).
import cron from 'node-cron';
import { writeFileSync } from 'node:fs';
import { conciliarDebitos, recuperarEnviando, sincronizarEstados } from './estado-banco.js';
import { ejecutarPase } from './pase-historico.js';
import { ejecutarZapBaseline } from './zap-baseline.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const seguro = (nombre, fn) => async () => {
  try { log(nombre, JSON.stringify(await fn())); } catch (e) { console.error(new Date().toISOString(), nombre, 'ERROR', e.message); }
};

// Estado de transferencias enviadas y vínculo de débitos: cada 5 minutos en horario bancario
cron.schedule('*/5 8-19 * * 1-5', seguro('estado-banco', async () => ({ ...(await sincronizarEstados()), debitos: await conciliarDebitos() })), { timezone: 'America/Argentina/Buenos_Aires' });

// Transferencias interrumpidas en ENVIANDO: cada 5 minutos, todos los días (nunca reenvía)
cron.schedule('*/5 * * * *', seguro('recuperar-enviando', async () => ({ recuperadas: await recuperarEnviando() })), { timezone: 'America/Argentina/Buenos_Aires' });

// ZAP baseline nocturno contra staging: pasivo/informativo, nunca compuerta
cron.schedule('30 2 * * *', seguro('zap-baseline', ejecutarZapBaseline), { timezone: 'America/Argentina/Buenos_Aires' });

// Pase a la base histórica: día 1 de cada mes a las 02:10
cron.schedule('10 2 1 * *', seguro('pase-historico', ejecutarPase), { timezone: 'America/Argentina/Buenos_Aires' });

// Latido para el healthcheck del contenedor: si el proceso se cuelga, deja de actualizarse.
const latir = () => { try { writeFileSync('/tmp/latido', new Date().toISOString()); } catch { /* sin disco: el healthcheck lo marca */ } };
latir();
cron.schedule('* * * * *', latir);

log('Programador de tareas iniciado');
