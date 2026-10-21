// Carga masiva (rol Crear): archivo -> detalle previo -> confirmar -> aprobación de otro usuario.
import { api } from '../api.js';
import { h, poner, card, kpi, tabla, dinero, pill, toast, error, cargando } from '../ui.js';

export async function render(main) {
  let previa = null, paso = 1;
  const pasos = () => h('ol', { class: 'chips' }, ['1 · Subir archivo', '2 · Detalle previo', '3 · Aprobación', '4 · Invocación individual por API']
    .map((t, i) => h('li', { class: 'chip', 'aria-pressed': String(i < paso) }, t)));
  const archivo = h('input', { type: 'file', accept: '.csv,.xlsx,.txt' });
  const cuerpo = h('div', {});

  const subir = async () => {
    const f = archivo.files?.[0];
    if (!f) return toast('Elegí un archivo CSV, XLSX o TXT.', true);
    const form = new FormData();
    form.append('archivo', f, f.name);
    poner(cuerpo, cargando());
    try { previa = await api('/lotes', { method: 'POST', form }); paso = 2; } catch (e) { error(e); previa = null; }
    dibujar();
  };
  const confirmarLote = async () => {
    try {
      const r = await api(`/lotes/${previa.loteId}/confirmar`, { method: 'POST' });
      paso = 3; toast(`Lote ${r.loteId}: ${r.transferencias} transferencias pendientes de aprobación. Al aprobarse se envía cada fila por separado.`);
      previa = null; archivo.value = ''; dibujar();
    } catch (e) { error(e); }
  };
  const descartar = async () => {
    try { await api(`/lotes/${previa.loteId}/descartar`, { method: 'POST' }); } catch (e) { error(e); }
    previa = null; paso = 1; archivo.value = ''; dibujar();
  };

  const dibujar = () => {
    poner(main, 
      card('Carga masiva de transferencias', 'CSV o Excel (una fila por transferencia, con encabezado: tipo, cuenta_origen, destino, cuit, importe, concepto, titular, codigo_mep) o TXT de ancho fijo. Antes de invocar cualquier API se muestra el detalle previo.',
        pasos(),
        h('div', { class: 'fila' }, archivo, h('button', { class: 'btn primario', onclick: subir }, 'Subir y ver detalle previo')),
        h('p', { class: 'nota' }, 'Tipos: INMEDIATA · INTERNA (entre cuentas propias) · TERCEROS · MEP-xxx. Cada tipo llama a su API al aprobarse: immediates, transferBetweenOwnAccount, transferThirdPartyAccount o transferMep.')),
      previa && [
        h('div', { class: 'kpis' }, kpi('Filas leídas', previa.filas), kpi('Válidas', previa.validas, 'pos'), kpi('Con error (no se envían)', previa.conError, 'neg'), kpi('Importe a enviar', dinero(previa.importe))),
        card(`Detalle previo · ${previa.formato}`, 'Validación de formato, permiso Operar sobre la cuenta origen y CBU/alias contra COELSA. Nada se envía al banco hasta confirmar y aprobar.',
          tabla([
            { t: 'Fila', v: (r) => r.fila }, { t: 'Tipo', v: (r) => r.datos.tipo }, { t: 'Cuenta origen', v: (r) => r.datos.cuenta_origen, cls: 'mono' },
            { t: 'Destino', v: (r) => r.datos.destino, cls: 'mono' }, { t: 'CUIT', v: (r) => r.datos.cuit ?? r.datos.cuitDestino ?? '', cls: 'mono' },
            { t: 'Titular', v: (r) => r.datos.titular ?? '' }, { t: 'Importe', v: (r) => dinero(r.datos.importe), cls: 'num' },
            { t: 'Validación', v: (r) => pill(r.validacion, r.validacion === 'OK' ? 'ok' : 'bad') },
          ], previa.detalle),
          h('div', { class: 'fila' },
            h('button', { class: 'btn primario', disabled: !previa.validas, onclick: confirmarLote }, 'Confirmar filas válidas y enviar a aprobación'),
            h('button', { class: 'btn', onclick: descartar }, 'Descartar'))),
      ],
      cuerpo);
  };
  dibujar();
}
