// Transferir (rol Crear): la carga es interna; queda pendiente hasta que OTRO usuario la apruebe.
import { api } from '../api.js';
import { h, poner, card, campo, seg, tabla, dinero, iso, fechaHora, estadoPill, toast, error } from '../ui.js';
import { consultarDestino, fichaCbu } from './cbu.js';

const TIPOS = [['INMEDIATA', 'Inmediata'], ['PROPIAS', 'Entre cuentas propias'], ['TERCEROS', 'Terceros BdV'], ['MEP', 'MEP']];
const CONCEPTOS = ['VARIOS', 'ALQUILERES', 'CUOTAS', 'EXPENSAS', 'FACTURA', 'HABERES', 'HONORARIOS', 'PRESTAMO', 'SEGUROS', 'APORTES DE CAPITAL'];
const MEP = ['DL0', 'DL1', 'DL2', 'DR0', 'DR1', 'DR2', 'D20', 'GC0', 'GC1', 'GC2'];
const FIJOS = [['VAR', 'Varios'], ['FAC', 'Facturas'], ['HAB', 'Haberes'], ['HON', 'Honorarios'], ['ALQ', 'Alquileres'], ['CUO', 'Cuotas'], ['PRE', 'Préstamos'], ['APC', 'Aportes de capital']];
const largoMep = (c) => (/^D[LR]/.test(c) ? 30 : c === 'GC0' || c === 'D20' ? 100 : 50);

export async function render(main, ctx) {
  const cuentas = await api('/cuentas');
  const operables = cuentas.filter((c) => c.empresa.operar);
  let tipo = 'INMEDIATA';
  const f = {
    referencia: h('input', { maxlength: 40, autocomplete: 'off', placeholder: 'Ej.: PAGO-2026-000123', title: 'Único: no se puede cargar dos veces el mismo ID' }),
    origen: h('select', {}, operables.map((c) => h('option', { value: c.cuenta }, `${c.alias} · ${c.cuenta} (${c.moneda}) · ${c.empresa.razonSocial}`))),
    destino: h('input', { placeholder: 'CBU/CVU de 22 dígitos o alias' }),
    propia: h('select', {}), tercero: h('input', { placeholder: '300000000000001' }),
    cuit: h('input', { placeholder: '30712399991', inputmode: 'numeric', maxlength: 11 }), titular: h('input', { placeholder: 'Se completa al validar' }),
    importe: h('input', { type: 'number', min: '0.01', step: '0.01', placeholder: '0,00' }),
    concepto: h('select', {}, CONCEPTOS.map((c) => h('option', {}, c))),
    conceptoId: h('select', {}, [['NOR', 'Normal'], ['RFCI', 'Rescate FCI'], ['SFCI', 'Suscripción FCI']].map(([v, t]) => h('option', { value: v }, t))),
    mep: h('select', {}, MEP.map((c) => h('option', { selected: c === 'DL1' }, c))), fijo: h('select', {}, FIJOS.map(([v, t]) => h('option', { value: v }, `${v} · ${t}`))),
    texto: h('input', { maxlength: 30, placeholder: 'Concepto / referencia libre' }),
    ddjjTit: h('input', { type: 'checkbox' }), ddjjCC: h('input', { type: 'checkbox' }),
  };
  const val = h('div', {});
  const actualizarPropias = () => poner(f.propia, ...cuentas.filter((c) => c.cuenta !== f.origen.value && c.empresa.id === operables.find((o) => o.cuenta === f.origen.value)?.empresa.id)
    .map((c) => h('option', { value: c.cuenta }, `${c.alias} · ${c.cuenta}`)));
  f.origen.addEventListener('change', actualizarPropias);
  f.mep.addEventListener('change', () => { f.texto.maxLength = largoMep(f.mep.value); });

  const validar = async () => {
    try {
      const r = await consultarDestino(f.destino.value);
      poner(val, fichaCbu(r));
      if (!r.activa) return toast('La cuenta destino está inactiva en COELSA.', true);
      f.titular.value = r.titular; if (!f.cuit.value) f.cuit.value = r.cuit;
    } catch (e) { val.replaceChildren(); error(e); }
  };

  const enviar = async () => {
    if (!f.referencia.value.trim()) return toast('Ingresá el ID de la operación: identifica la transferencia y no se puede repetir.', true);
    const datos = { tipo, cuentaOrigen: f.origen.value, importe: Number(f.importe.value), referencia: f.referencia.value.trim() };
    if (tipo === 'INMEDIATA') Object.assign(datos, { destino: f.destino.value.trim(), concepto: f.concepto.value, titular: f.titular.value || undefined, ddjjTitular: f.ddjjTit.checked, ddjjCtaCte: f.ddjjCC.checked });
    if (tipo === 'PROPIAS') Object.assign(datos, { destino: f.propia.value, concepto: f.texto.value });
    if (tipo === 'TERCEROS') Object.assign(datos, { destino: f.tercero.value.trim(), concepto: f.texto.value, conceptoId: f.conceptoId.value });
    if (tipo === 'MEP') Object.assign(datos, { codigoMep: f.mep.value, destino: f.destino.value.trim(), cuitDestino: f.cuit.value.trim(), titular: f.titular.value, conceptoFijo: f.fijo.value, conceptoLibre: f.texto.value, ddjjTitular: f.ddjjTit.checked, ddjjCtaCte: f.ddjjCC.checked });
    try {
      const r = await api('/transferencias', { method: 'POST', body: datos });
      toast(`OP-${r.id} (ID ${r.referencia}) cargada y pendiente de aprobación. Se enviará al banco cuando la apruebe otro usuario con rol Aprobar.`);
      pre.textContent = JSON.stringify(r.request, null, 2);
      f.importe.value = ''; f.referencia.value = ''; val.replaceChildren();
      await cargarMias();
    } catch (e) { error(e); }
  };

  const pre = h('pre', {}, 'El request exacto aparece al cargar la transferencia.');
  const mias = h('div', {});
  const cargarMias = async () => {
    const hoy = iso();
    const r = await api(`/transferencias?desde=${hoy}&hasta=${hoy}`);
    poner(mias, tabla([
      { t: 'OP', v: (t) => `OP-${t.id}`, cls: 'mono' }, { t: 'ID', v: (t) => t.referencia, cls: 'mono' }, { t: 'Hora', v: (t) => fechaHora(t.creado_en).slice(11), cls: 'mono' }, { t: 'Tipo', v: (t) => t.tipo },
      { t: 'Destino', v: (t) => [t.titular, t.destino].filter(Boolean).join(' · ') }, { t: 'Importe', v: (t) => dinero(t.importe, t.moneda), cls: 'num' },
      { t: 'Estado', v: (t) => estadoPill(t.estado) }, { t: 'Aprobó', v: (t) => t.aprobador ?? '' }, { t: 'transactionId', v: (t) => t.transaction_id ?? '', cls: 'mono' },
    ], r.transferencias.filter((t) => t.creador === ctx.me.usuario), { vacio: 'No cargaste transferencias hoy.' }));
  };

  const formulario = h('div', {});
  const dibujar = () => {
    const en = (...ts) => ts.includes(tipo);
    f.texto.maxLength = tipo === 'MEP' ? largoMep(f.mep.value) : 30;
    poner(formulario, 
      seg(TIPOS, tipo, (v) => { tipo = v; val.replaceChildren(); dibujar(); }),
      h('div', { class: 'campos' },
        campo('ID de la operación (único)', f.referencia), en('MEP') && campo('Código MEP', f.mep), campo('Cuenta origen', f.origen),
        en('INMEDIATA', 'MEP') && campo('CBU/CVU o alias destino', f.destino), en('PROPIAS') && campo('Cuenta propia destino', f.propia),
        en('TERCEROS') && campo('Cuenta destino Banco de Valores', f.tercero), en('MEP') && [campo('CUIT/CUIL destinatario', f.cuit), campo('Titular del CBU destino', f.titular)],
        campo('Importe', f.importe), en('INMEDIATA') && campo('Concepto (catálogo)', f.concepto), en('TERCEROS') && campo('Tipo de concepto', f.conceptoId),
        en('MEP') && campo('Concepto fijo', f.fijo), en('PROPIAS', 'TERCEROS', 'MEP') && campo('Concepto / referencia libre', f.texto),
        en('INMEDIATA', 'MEP') && [campo('DDJJ: soy titular de la cuenta destino', f.ddjjTit, 'check'), campo('DDJJ: la cuenta destino es cuenta corriente', f.ddjjCC, 'check')]),
      h('div', { class: 'fila' },
        en('INMEDIATA', 'MEP') && h('button', { class: 'btn', onclick: validar }, 'Validar destino en COELSA'),
        h('button', { class: 'btn primario', disabled: !operables.length, onclick: enviar }, 'Enviar a aprobación'),
        !operables.length && h('span', { class: 'bloqueado' }, 'No tenés cuentas habilitadas para operar.')),
      val);
  };
  actualizarPropias();
  dibujar();
  poner(main, 
    h('div', { class: 'grid' },
      card('Nueva transferencia', 'Al enviar queda en la bandeja de aprobación interna: no se envía al banco. Recién cuando la aprueba otro usuario con rol Aprobar, el backend llama a la API del banco.', formulario),
      card('Request que enviará el backend', 'Con la sesión compartida de VALO ante el banco (channel 3).', pre)),
    card('Mis transferencias de hoy', 'Pendiente de aprobación → Aprobada y enviada por API (o Rechazada). El histórico completo está en Transferencias.', mias));
  await cargarMias();
}
