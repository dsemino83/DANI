// Proceso de tareas programadas (servicio "jobs" del docker-compose).
import cron from 'node-cron';
import { writeFileSync } from 'node:fs';
import { conciliarDebitos, recuperarEnviando, sincronizarEstados } from './estado-banco.js';
import { ejecutarPase } from './pase-historico.js';
import { ejecutarEnviosPendientes, procesarCola } from '../servicios/envios.js';
import { sincronizarFeriados } from '../servicios/feriados.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const seguro = (nombre, fn) => async () => {
  try { log(nombre, JSON.stringify(await fn())); } catch (e) { console.error(new Date().toISOString(), nombre, 'ERROR', e.message); }
};

// Estado de transferencias enviadas y vínculo de débitos: cada 5 minutos en horario bancario
cron.schedule('*/5 8-19 * * 1-5', seguro('estado-banco', async () => ({ ...(await sincronizarEstados()), debitos: await conciliarDebitos() })), { timezone: 'America/Argentina/Buenos_Aires' });

// Transferencias interrumpidas en ENVIANDO: cada 5 minutos, todos los días (nunca reenvía)
cron.schedule('*/5 * * * *', seguro('recuperar-enviando', async () => ({ recuperadas: await recuperarEnviando() })), { timezone: 'America/Argentina/Buenos_Aires' });

// Pase a la base histórica: día 1 de cada mes a las 02:10
cron.schedule('10 2 1 * *', seguro('pase-historico', ejecutarPase), { timezone: 'America/Argentina/Buenos_Aires' });

// Envíos programados: cada minuto se ENCOLAN los turnos vencidos (una tarea por cliente)…
cron.schedule('* * * * *', async () => {
  try { const r = await ejecutarEnviosPendientes(); if (r.length) log('envios-encolados', JSON.stringify(r)); } // sin ruido si no hay turnos
  catch (e) { console.error(new Date().toISOString(), 'envios-encolados', 'ERROR', e.message); }
}, { timezone: 'America/Argentina/Buenos_Aires' });
// …y un único trabajador procesa la cola de a una tarea cada 15 segundos (si sigue ocupado, no arranca otro)
cron.schedule('*/15 * * * * *', async () => {
  try { const r = await procesarCola(); if (r.procesadas) log('cola-envios', JSON.stringify(r)); }
  catch (e) { console.error(new Date().toISOString(), 'cola-envios', 'ERROR', e.message); }
});

// Feriados de fuentes públicas: todos los días a las 03:20 (año en curso y el siguiente) y al arrancar
const feriados = seguro('feriados', async () => {
  const anio = new Date().getFullYear();
  const r = [await sincronizarFeriados(anio)];
  try { r.push(await sincronizarFeriados(anio + 1)); } catch { /* el año siguiente puede no estar publicado aún */ }
  return r;
});
cron.schedule('20 3 * * *', feriados, { timezone: 'America/Argentina/Buenos_Aires' });
feriados();

// Latido para el healthcheck del contenedor: si el proceso se cuelga, deja de actualizarse.
const latir = () => { try { writeFileSync('/tmp/latido', new Date().toISOString()); } catch { /* sin disco: el healthcheck lo marca */ } };
latir();
cron.schedule('* * * * *', latir);

log('Programador de tareas iniciado');
