// Panel de estado y mantenimiento (administrador de seguridad). Muestra el estado de cada parte del sistema
// y permite reiniciar subsistemas de forma segura. No reinicia contenedores: eso queda en la herramienta de
// operaciones (Portainer / docker compose), para no exponer el socket de Docker.
import { api } from '../api.js';
import { h, poner, card, pill, fechaHora, confirmar, toast, error, cargando } from '../ui.js';

const si = (ok) => pill(ok ? 'OK' : 'Falla', ok ? 'ok' : 'bad');
const fila = (etiqueta, estado, ...detalle) => h('div', { class: 'estado-fila' },
  h('span', { class: 'estado-nombre' }, etiqueta), estado, h('span', { class: 'estado-detalle' }, ...detalle));

export async function render(main) {
  const cuerpo = h('div', {}, cargando());

  const dibujar = async () => {
    poner(cuerpo, cargando());
    let s;
    try { s = await api('/sistema/estado'); } catch (e) { return poner(cuerpo, h('p', { class: 'vacio' }, `No se pudo leer el estado: ${e.message}`)); }
    const seg = (n) => (n == null ? '—' : n < 60 ? `${n} s` : n < 3600 ? `${Math.round(n / 60)} min` : `${Math.round(n / 3600)} h`);
    const banco = (b) => `${b.ambiente} · ${b.conectado ? `sesión activa${b.venceEn ? ` (vence ${fechaHora(b.venceEn)})` : ''}` : 'sin sesión (se conecta al usarse)'}`;

    poner(cuerpo,
      card('Estado del sistema', `Al ${fechaHora(s.generadoEn)} · ambiente ${s.ambiente}${s.soloConsultas ? ' · modo solo consultas' : ''}`,
        fila('Backend (API)', si(s.backend.ok), `en línea desde hace ${seg(s.backend.desdeHaceSeg)}`),
        fila('Base operativa', si(s.operativaDb.ok), s.operativaDb.ok ? `responde en ${s.operativaDb.ms} ms` : s.operativaDb.error),
        fila('Base histórica', si(s.historicaDb.ok), s.historicaDb.ok ? `responde en ${s.historicaDb.ms} ms` : s.historicaDb.error),
        fila('Banco · principal', si(s.banco.principal.conectado), banco(s.banco.principal)),
        fila('Banco · envíos', si(s.banco.envios.conectado), banco(s.banco.envios)),
        fila('Cola de envíos', si(s.cola.ok && (s.cola.errores ?? 0) === 0),
          s.cola.ok ? `${s.cola.pendientes} pendientes · ${s.cola.procesando} en curso · ${s.cola.errores} en error` : s.cola.error),
        fila('Feriados', si(s.feriados.ok && s.feriados.cargados > 0),
          s.feriados.ok ? `${s.feriados.cargados} en ${s.feriados.anio}${s.feriados.actualizadoEn ? ` · actualizado ${fechaHora(s.feriados.actualizadoEn)}` : ''}` : s.feriados.error),
        fila('Auditoría (cadena)', si(s.integridad.ok),
          s.integridad.ok ? `${s.integridad.registros} registros · cabeza ${s.integridad.cabeza ?? '—'}` : s.integridad.error),
        fila('Último pase histórico', si(s.pase.ok),
          s.pase.ok ? (s.pase.ultimo ? `${s.pase.ultimo.tabla} ${String(s.pase.ultimo.periodo).slice(0, 7)} · ${s.pase.ultimo.estado} · ${fechaHora(s.pase.ultimo.ejecutado_en)}` : 'todavía no se ejecutó') : s.pase.error),
        h('div', { class: 'fila' }, h('button', { class: 'btn chico', onclick: () => dibujar().catch(error) }, '↻ Actualizar estado'))),

      card('Mantenimiento', 'Reinicios seguros de cada subsistema. No reinician los contenedores (eso se hace en la herramienta de operaciones); quedan registrados en la auditoría.',
        accion('Reconectar con el banco', 'Descarta la sesión actual con el banco; la próxima consulta vuelve a autenticarse. No envía nada.', '/sistema/reconectar-banco', (r) => r.mensaje),
        accion('Reprocesar la cola de envíos', 'Destraba tareas colgadas y procesa las pendientes.', '/sistema/reprocesar-cola', (r) => (r.enCurso ? 'Ya había un proceso en curso.' : `Procesadas ${r.procesadas ?? 0} tarea(s).`)),
        accion('Refrescar feriados', 'Vuelve a traer los feriados del año en curso desde las fuentes públicas.', '/sistema/refrescar-feriados', (r) => `${r.anio}: ${r.feriados} feriado(s) desde ${r.fuente}.`),
        accion('Verificar integridad de la auditoría', 'Recalcula la cadena de hashes completa y avisa si algún registro fue alterado o borrado.', '/sistema/verificar-integridad',
          (r) => (r.ok ? `Íntegra: ${r.filas} registros sin alteraciones.` : `¡ATENCIÓN! ${r.problemas.length} problema(s) de integridad.`), (r) => !r.ok)));
  };

  // Un botón de acción: confirma, llama al backend, avisa el resultado y refresca el estado.
  function accion(titulo, texto, ruta, resumen, esMalo = () => false) {
    const btn = h('button', { class: 'btn', onclick: async () => {
      if (!(await confirmar(titulo, texto, titulo))) return;
      btn.disabled = true;
      try { const r = await api(ruta, { method: 'POST' }); toast(resumen(r), esMalo(r)); await dibujar(); }
      catch (e) { error(e); btn.disabled = false; }
    } }, titulo);
    return h('div', { class: 'estado-accion' }, btn, h('span', { class: 'estado-detalle' }, texto));
  }

  poner(main, h('div', { class: 'seccion' }, cuerpo));
  await dibujar();
}
