// Auditoría general (auditor y administrador de seguridad): solo lectura, base operativa e histórica por separado.
import { api } from '../api.js';
import { h, poner, card, tabla, campo, seg, iso, fecha, fechaHora, pill, toast, error, cargando, modal } from '../ui.js';

const TIPOS = ['', 'Transferencias', 'Administración', 'Consultas'];
const diaAntes = (d) => iso(new Date(new Date(`${d}T12:00:00`).getTime() - 864e5));

// Verificación de la cadena de hashes: muestra si la auditoría está íntegra o qué registros fueron alterados
async function verificarIntegridad(boton) {
  boton.disabled = true; boton.textContent = 'Verificando…';
  try {
    const r = await api('/auditoria/integridad');
    modal(r.ok ? '✔ Auditoría íntegra' : '✖ La auditoría fue alterada',
      h('p', { class: r.ok ? 'aviso' : 'aviso rojo' }, r.ok
        ? `Se verificaron ${r.filas} registros (orden ${r.desdeOrden ?? '—'} a ${r.hastaOrden ?? '—'}): ningún registro fue modificado, borrado ni intercalado.`
        : `Se encontraron ${r.problemas.length} problema(s) en ${r.filas} registros. Avisar a Seguridad Informática.`),
      !r.ok && h('ul', {}, r.problemas.map((p) => h('li', {}, `Orden ${p.orden}: ${p.problema}`))),
      h('p', { class: 'nota' }, `Cabeza de la cadena (SHA-256): `, h('code', {}, r.cabeza)),
      r.empalmeHistorica != null && h('p', { class: 'nota' }, r.empalmeHistorica ? 'Continúa correctamente la cadena de la base histórica.' : 'No continúa la cadena de la base histórica.'),
      h('p', { class: 'nota' }, 'Cada registro guarda el hash de su contenido encadenado con el del anterior; la verificación también corre todos los días a las 03:40 y queda registrada.'));
  } catch (x) { error(x); }
  boton.disabled = false; boton.textContent = 'Verificar integridad';
}

export async function render(main, ctx) {
  const corte = ctx.me.corteAuditoria ?? ctx.me.corte;
  const f = { base: 'operativa', desde: corte, hasta: iso(), hDesde: iso(new Date(new Date(`${corte}T12:00:00`).getTime() - 90 * 864e5)), hHasta: diaAntes(corte), usuario: '', tipo: '', q: '' };
  let pagina = 0, datos = null;

  const ruta = () => {
    const hist = f.base === 'historica';
    const p = new URLSearchParams({ desde: hist ? f.hDesde : f.desde, hasta: hist ? f.hHasta : f.hasta, pagina: String(pagina) });
    if (f.usuario) p.set('usuario', f.usuario);
    if (f.tipo) p.set('tipo', f.tipo);
    if (f.q) p.set('q', f.q);
    return `${hist ? '/historico/auditoria' : '/auditoria'}?${p}`;
  };

  const dibujar = () => {
    const hist = f.base === 'historica';
    const d1 = h('input', { type: 'date', value: hist ? f.hDesde : f.desde, min: hist ? null : corte, max: hist ? diaAntes(corte) : iso() });
    const d2 = h('input', { type: 'date', value: hist ? f.hHasta : f.hasta, min: hist ? null : corte, max: hist ? diaAntes(corte) : iso() });
    const usuario = h('input', { value: f.usuario, placeholder: 'usuario exacto' });
    const tipo = h('select', {}, TIPOS.map((t) => h('option', { value: t, selected: t === f.tipo }, t || 'Todos')));
    const q = h('input', { type: 'search', value: f.q, placeholder: 'acción, detalle, API…' });
    const consultar = () => {
      if (!d1.value || !d2.value || d1.value > d2.value) return toast('Ingresá un rango de fechas válido.', true);
      if (!hist && d1.value < corte) return toast(`La base operativa guarda desde el ${fecha(corte)}. Para fechas anteriores usá “Base histórica”.`, true);
      if (hist && d2.value >= corte) return toast(`La base histórica tiene lo anterior al ${fecha(corte)}.`, true);
      if (hist) { f.hDesde = d1.value; f.hHasta = d2.value; } else { f.desde = d1.value; f.hasta = d2.value; }
      Object.assign(f, { usuario: usuario.value.trim(), tipo: tipo.value, q: q.value.trim() });
      pagina = 0; cargar();
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') consultar(); });

    poner(main, card('Auditoría', 'Registro inalterable (solo inserción, encadenado con hashes SHA-256) de cada acción: quién, cuándo, con qué rol, qué API se invocó y con qué resultado. Esta pantalla es de solo lectura.',
      h('div', { class: 'fila' },
        campo('Base', seg([['operativa', 'Base operativa'], ['historica', 'Base histórica']], f.base, (v) => { f.base = v; pagina = 0; cargar(); })),
        campo('Desde', d1), campo('Hasta', d2), campo('Usuario', usuario), campo('Tipo', tipo), campo('Buscar', q),
        h('button', { class: 'btn primario', onclick: consultar }, 'Consultar'),
        h('button', { class: 'btn', title: 'Recalcula la cadena de hashes de la auditoría operativa', onclick: (e) => verificarIntegridad(e.currentTarget) }, 'Verificar integridad')),
      h('p', { class: `aviso ${hist ? '' : 'rojo'}` }, h('b', {}, hist ? 'Base histórica · solo lectura. ' : 'Base operativa. '),
        hist ? `Registros anteriores al ${fecha(corte)}. La consulta también queda auditada.` : `Desde el ${fecha(corte)}.`),
      datos ? [
        tabla([
          { t: 'Fecha y hora', v: (r) => fechaHora(r.en), cls: 'mono' }, { t: 'Usuario', v: (r) => r.usuario }, { t: 'Rol', v: (r) => r.rol ?? '' },
          { t: 'Tipo', v: (r) => r.tipo }, { t: 'Acción', v: (r) => r.accion }, { t: 'API', v: (r) => r.api ?? '', cls: 'mono' },
          { t: 'Detalle', v: (r) => r.detalle ?? '' }, { t: 'Resultado', v: (r) => pill(r.resultado ?? 'OK', (r.resultado ?? 'OK') === 'OK' ? 'ok' : 'bad') },
        ], datos.registros, { vacio: 'No hay registros para este filtro.' }),
        h('div', { class: 'fila' },
          h('button', { class: 'btn chico', disabled: pagina === 0, onclick: () => { pagina--; cargar(); } }, '← Anterior'),
          h('span', { class: 'nota' }, `Página ${pagina + 1} · ${datos.registros.length} registros`),
          h('button', { class: 'btn chico', disabled: !datos.hayMas, onclick: () => { pagina++; cargar(); } }, 'Siguiente →')),
      ] : cargando()));
  };

  const cargar = async () => {
    datos = null; dibujar();
    try { datos = await api(ruta()); } catch (e) { error(e); datos = { registros: [], hayMas: false }; }
    dibujar();
  };
  await cargar();
}
