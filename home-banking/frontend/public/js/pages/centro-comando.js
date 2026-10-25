// Centro de Comando de Seguridad y Resiliencia.
// Solo lectura en esta primera fase: el navegador nunca ejecuta acciones de infraestructura.
import { api } from '../api.js';
import { h, poner, card, kpi, pill, tabla, cargando, error } from '../ui.js';

const estadoBase = (ok) => pill(ok ? 'Operativa' : 'Degradada', ok ? 'ok' : 'bad');

function indicador(nombre, ok, detalle) {
  return h('div', { class: 'card' },
    h('div', { class: 'kpi-label' }, nombre),
    h('div', { style: 'margin:6px 0 4px' }, estadoBase(ok)),
    h('div', { class: 'nota' }, detalle ?? '')
  );
}

function numero(v) {
  return new Intl.NumberFormat('es-AR').format(Number(v) || 0);
}

export async function render(main) {
  let datos = null;
  let timer = null;

  const cargar = async () => {
    try {
      datos = await api('/admin/centro-comando/estado');
      dibujar();
    } catch (e) {
      error(e);
      datos = null;
      dibujar();
    }
  };

  const dibujar = () => {
    if (!datos) {
      poner(main, card('Centro de Comando', 'Estado de seguridad y resiliencia del Home Banking.', cargando()));
      return;
    }

    const dbOk = datos.bases?.operativa && datos.bases?.historica;
    const op = datos.pools?.operativa ?? {};
    const hist = datos.pools?.historica ?? {};
    const negocio = datos.negocio ?? {};
    const solo = datos.soloConsultas;

    const kpis = h('div', { class: 'kpis' },
      kpi('Estado general', datos.ok && dbOk ? 'OPERATIVO' : 'DEGRADADO', datos.ok && dbOk ? 'pos' : 'neg'),
      kpi('Uptime', `${numero(Math.floor(datos.uptimeSec / 3600))} h`),
      kpi('DB · latencia', `${datos.latenciaDbMs} ms`),
      kpi('Pendientes aprobación', numero(negocio.pendientesAprobacion)),
      kpi('Transferencias enviadas', numero(negocio.enviadas ?? 0)),
      kpi('Errores API', numero(negocio.erroresApi))
    );

    const salud = h('div', { class: 'grid' },
      indicador('Base operativa', datos.bases?.operativa, `pool ${op.idle ?? 0} libres · ${op.esperando ?? 0} esperando`),
      indicador('Base histórica', datos.bases?.historica, `pool ${hist.idle ?? 0} libres · ${hist.esperando ?? 0} esperando`),
      indicador('Modo operativo', !solo, solo ? 'SOLO CONSULTAS: las operaciones de envío están bloqueadas.' : 'Operación normal habilitada según roles.'),
      indicador('ZAP baseline', datos.zap?.enabled && datos.zap?.targetConfigured, datos.zap?.enabled ? 'Baseline configurado.' : 'No habilitado en este ambiente.')
    );

    poner(main,
      card('Centro de Comando', 'Vista administrativa de seguridad, resiliencia y operaciones críticas. Actualización automática cada 15 segundos.',
        h('div', { class: 'fila' },
          h('button', { class: 'btn primario', onclick: cargar }, '↻ Actualizar ahora'),
          h('span', { class: 'nota' }, `Última lectura: ${new Date(datos.timestamp).toLocaleString('es-AR')}`),
          h('span', { class: 'nota' }, `Ambiente: ${datos.ambiente ?? 'no informado'}`)
        )
      ),
      kpis,
      card('Salud de infraestructura', 'Chequeos no disruptivos. Las acciones de infraestructura quedan fuera del navegador.',
        salud
      ),
      card('Riesgo operativo',
        'Estos indicadores ayudan a detectar situaciones que requieren revisión; no se ejecutan reintentos automáticos de transferencias.',
        tabla([
          { t: 'Indicador', v: r => r.nombre },
          { t: 'Valor', v: r => r.valor, cls: 'num' },
          { t: 'Severidad', v: r => pill(r.severidad, r.severidad === 'OK' ? 'ok' : 'warn') }
        ], [
          { nombre: 'Pendientes de aprobación', valor: numero(negocio.pendientesAprobacion), severidad: negocio.pendientesAprobacion ? 'REVISAR' : 'OK' },
          { nombre: 'Transferencias enviadas', valor: numero(negocio.enviadas ?? 0), severidad: negocio.enviadas ? 'REVISAR' : 'OK' },
          { nombre: 'Errores API', valor: numero(negocio.erroresApi), severidad: negocio.erroresApi ? 'REVISAR' : 'OK' }
        ])
      ),
      card('Remediación controlada',
        datos.remediacion?.motivo ?? 'Las acciones disruptivas no están habilitadas.',
        h('div', { class: 'aviso rojo' },
          h('b', {}, 'Política de seguridad: '),
          'el administrador puede detectar y solicitar atención, pero no ejecutar kubectl, reinicios, failover ni acciones SOAR desde el navegador.'
        )
      )
    );
  };

  await cargar();
  timer = setInterval(cargar, 15000);
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
}
