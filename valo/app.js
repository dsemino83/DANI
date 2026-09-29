// Interfaz del Conversor VALO GetNet: clientes, bancos, carga de lote e historial.
// Los datos quedan guardados en este navegador (localStorage); usar "Descargar respaldo" para resguardarlos.
(function () {
  'use strict';
  const M = window.ValoMotor;
  const CLAVE = 'valo-conversor-v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMonto = n => (n == null || n === '' ? '' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtEntero = n => Number(n).toLocaleString('es-AR');
  const soloDigitos = s => String(s == null ? '' : s).replace(/\D/g, '');
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ------------------------------------------------------------- estado

  function estadoInicial() {
    return { version: 1, clientes: [], bancos: clonar(window.VALO_BANCOS_INICIALES), lotes: [] };
  }
  function clonar(x) { return JSON.parse(JSON.stringify(x)); }

  function cargarEstado() {
    try {
      const txt = localStorage.getItem(CLAVE);
      if (txt) {
        const e = JSON.parse(txt);
        if (e && Array.isArray(e.clientes) && Array.isArray(e.bancos) && Array.isArray(e.lotes)) return e;
      }
    } catch (err) { /* sin almacenamiento disponible: se trabaja en memoria */ }
    return estadoInicial();
  }

  let estado = cargarEstado();

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
      return true;
    } catch (err) {
      return false;
    }
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('visible'), 3200);
  }

  function aviso(tipo, html) {
    return `<div class="aviso ${tipo}">${html}</div>`;
  }

  function descargar(nombre, contenido, tipo) {
    const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function leerLibro(file) {
    return file.arrayBuffer().then(buf => XLSX.read(buf, { type: 'array' }));
  }

  function filasHoja(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  }

  // ------------------------------------------------------------- pestañas

  function irA(vista) {
    document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
    document.querySelectorAll('section.vista').forEach(s => s.classList.toggle('activa', s.id === 'vista-' + vista));
    if (vista === 'historial') renderHistorial();
    if (vista === 'bancos') renderBancos();
    if (vista === 'clientes') renderClientes();
  }
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ir]');
    if (b) irA(b.dataset.ir);
  });

  // ============================================================ CLIENTES

  const clientePorId = id => estado.clientes.find(c => c.id === id);
  const lotesDe = id => estado.lotes.filter(l => l.clienteId === id && !l.anulado);

  function validarCliente(datos, idActual) {
    const errores = [];
    if (!datos.negocio) errores.push('El Nº de negocio es obligatorio.');
    if (!/^\d{11}$/.test(datos.cuit)) errores.push('El CUIT del cedente debe tener 11 dígitos.');
    if (!datos.nombre) errores.push('El nombre es obligatorio.');
    if (!Number.isInteger(datos.ultimaSecuencia) || datos.ultimaSecuencia < 0) errores.push('La última secuencia debe ser un entero mayor o igual a 0.');
    const dup = estado.clientes.find(c => c.cuit === datos.cuit && c.id !== idActual);
    if (dup) errores.push(`Ya existe un cliente con el CUIT ${datos.cuit} (${esc(dup.nombre)}).`);
    return errores;
  }

  $('formCliente').addEventListener('submit', e => {
    e.preventDefault();
    const datos = {
      negocio: $('cNegocio').value.trim(),
      cuit: soloDigitos($('cCuit').value),
      nombre: $('cNombre').value.trim(),
      ultimaSecuencia: Number($('cSecuencia').value.trim() || 0),
    };
    const errores = validarCliente(datos);
    if (errores.length) {
      $('errorCliente').innerHTML = aviso('bad', errores.join('<br>'));
      return;
    }
    const cliente = Object.assign({ id: nuevoId(), creado: new Date().toISOString(), tasa: '' }, datos);
    estado.clientes.push(cliente);
    guardar();
    $('errorCliente').innerHTML = '';
    e.target.reset();
    $('cSecuencia').value = '0';
    renderClientes();
    renderSelectClientes(cliente.id);
    toast(`Cliente ${cliente.nombre} dado de alta. Próxima secuencia: ${cliente.ultimaSecuencia + 1}`);
  });

  function renderClientes() {
    const caja = $('tablaClientes');
    if (!estado.clientes.length) {
      caja.innerHTML = '<div class="vacio">Todavía no hay clientes.</div>';
      return;
    }
    const filas = estado.clientes.map(c => {
      const n = lotesDe(c.id).length;
      return `<tr>
        <td>${esc(c.negocio)}</td><td>${esc(c.cuit)}</td><td>${esc(c.nombre)}</td>
        <td class="num">${c.ultimaSecuencia}</td><td class="num">${c.ultimaSecuencia + 1}</td><td class="num">${n}</td>
        <td><button class="btn chico" data-editar-cliente="${c.id}">Editar</button>
        ${n ? '' : `<button class="btn chico peligro" data-borrar-cliente="${c.id}">Borrar</button>`}</td></tr>`;
    }).join('');
    caja.innerHTML = `<table><thead><tr><th>Nº negocio</th><th>CUIT cedente</th><th>Nombre</th>
      <th class="num">Última secuencia</th><th class="num">Próxima</th><th class="num">Lotes</th><th></th></tr></thead><tbody>${filas}</tbody></table>`;
  }

  let clienteEditando = null;
  $('tablaClientes').addEventListener('click', e => {
    const ed = e.target.closest('[data-editar-cliente]');
    const bo = e.target.closest('[data-borrar-cliente]');
    if (ed) {
      const c = clientePorId(ed.dataset.editarCliente);
      clienteEditando = c;
      $('eNegocio').value = c.negocio; $('eCuit').value = c.cuit; $('eNombre').value = c.nombre;
      $('eSecuencia').value = c.ultimaSecuencia; $('eError').innerHTML = '';
      $('dlgCliente').showModal();
    }
    if (bo) {
      const c = clientePorId(bo.dataset.borrarCliente);
      if (confirm(`¿Borrar el cliente ${c.nombre}?`)) {
        estado.clientes = estado.clientes.filter(x => x.id !== c.id);
        guardar(); renderClientes(); renderSelectClientes();
      }
    }
  });

  $('formEditarCliente').addEventListener('submit', e => {
    if (e.submitter && e.submitter.value !== 'guardar') return;
    const datos = {
      negocio: $('eNegocio').value.trim(), cuit: soloDigitos($('eCuit').value),
      nombre: $('eNombre').value.trim(), ultimaSecuencia: Number($('eSecuencia').value.trim() || 0),
    };
    const errores = validarCliente(datos, clienteEditando.id);
    if (errores.length) {
      e.preventDefault();
      $('eError').innerHTML = aviso('bad', errores.join('<br>'));
      return;
    }
    if (datos.ultimaSecuencia !== clienteEditando.ultimaSecuencia &&
      !confirm(`Vas a cambiar la última secuencia de ${clienteEditando.ultimaSecuencia} a ${datos.ultimaSecuencia}. ¿Continuar?`)) {
      e.preventDefault();
      return;
    }
    Object.assign(clienteEditando, datos);
    guardar(); renderClientes(); renderSelectClientes(clienteEditando.id);
    toast('Cliente actualizado');
  });

  // ============================================================ BANCOS

  function opcionesJurisdiccion(actual) {
    const nombres = ['Prueba'].concat(M.PROVINCIAS.map(p => p.nombre));
    const prov = M.provinciaPorNombre(actual);
    const elegido = prov ? prov.nombre : (actual || 'Prueba');
    if (!nombres.includes(elegido)) nombres.push(elegido);
    return nombres.map(n => `<option ${n === elegido ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }

  function renderBancos() {
    const q = M.normalizar($('bBuscar').value);
    const soloInc = $('bSoloIncompletos').checked;
    const incompletos = estado.bancos.filter(b => M.problemasBanco(b).length).length;
    $('bResumen').textContent = `${estado.bancos.length} bancos · ${incompletos} incompletos (Prueba / #N/D)`;
    const lista = estado.bancos.filter(b => {
      if (soloInc && !M.problemasBanco(b).length) return false;
      if (!q) return true;
      return M.normalizar([b.codigo, b.nombre, b.cuit].join(' ')).includes(q);
    });
    if (!lista.length) {
      $('tablaBancos').innerHTML = '<div class="vacio">Sin resultados.</div>';
      return;
    }
    $('tablaBancos').innerHTML = `<table><thead><tr><th class="num">Banco</th><th>Nombre</th><th>CUIT</th><th>Jurisdicción</th>
      <th class="num">Cód. sucursal</th><th class="num">Cód. Nº crédito</th><th>Estado</th><th></th></tr></thead><tbody>${
      lista.map(b => {
        const p = M.problemasBanco(b);
        return `<tr><td class="num">${esc(b.codigo)}</td><td>${esc(b.nombre)}</td><td>${esc(b.cuit)}</td><td>${esc(b.jurisdiccion)}</td>
          <td class="num">${b.sucursal == null || b.sucursal === '' ? '#N/D' : esc(b.sucursal)}</td><td class="num">${esc(b.codCredito)}</td>
          <td>${p.length ? `<span class="chip warn" title="${esc(p.join(' · '))}">Incompleto</span>` : '<span class="chip ok">OK</span>'}</td>
          <td><button class="btn chico" data-editar-banco="${esc(b.codigo)}">Editar</button></td></tr>`;
      }).join('')}</tbody></table>`;
  }
  $('bBuscar').addEventListener('input', renderBancos);
  $('bSoloIncompletos').addEventListener('change', renderBancos);

  // --- diálogo de banco
  let bancoEditando = null;
  let alGuardarBanco = null;

  function abrirBanco(banco, sugerido, callback) {
    bancoEditando = banco || null;
    alGuardarBanco = callback || null;
    const b = banco || Object.assign({ codigo: '', nombre: '', cuit: '', jurisdiccion: 'Prueba', sucursal: null, codCredito: '' }, sugerido || {});
    $('dlgBancoTitulo').textContent = banco ? `Editar banco ${banco.codigo}` : 'Agregar banco';
    $('dCodigo').value = b.codigo; $('dNombre').value = b.nombre || ''; $('dCuit').value = b.cuit || '';
    $('dJurisdiccion').innerHTML = opcionesJurisdiccion(b.jurisdiccion);
    $('dSucursal').value = b.sucursal == null ? '' : b.sucursal;
    $('dCodCredito').value = b.codCredito || '';
    $('dBorrar').classList.toggle('oculto', !banco);
    $('dError').innerHTML = '';
    $('dlgBanco').showModal();
  }

  $('dJurisdiccion').addEventListener('change', () => {
    const p = M.provinciaPorNombre($('dJurisdiccion').value);
    $('dSucursal').value = p ? p.codigo : '';
  });
  $('dCodigo').addEventListener('input', () => {
    if (!bancoEditando) $('dCodCredito').placeholder = M.codigoCreditoPorDefecto(soloDigitos($('dCodigo').value));
  });

  $('formBanco').addEventListener('submit', e => {
    const accion = e.submitter ? e.submitter.value : 'guardar';
    if (accion === 'cancelar') return;
    if (accion === 'borrar') {
      if (!confirm(`¿Borrar el banco ${bancoEditando.codigo}?`)) { e.preventDefault(); return; }
      estado.bancos = estado.bancos.filter(b => b !== bancoEditando);
      guardar(); renderBancos(); reevaluarArchivo();
      return;
    }
    const codigo = soloDigitos($('dCodigo').value);
    const datos = {
      codigo: Number(codigo),
      nombre: $('dNombre').value.trim(),
      cuit: soloDigitos($('dCuit').value),
      jurisdiccion: $('dJurisdiccion').value,
      sucursal: $('dSucursal').value.trim() === '' ? null : Number($('dSucursal').value),
      codCredito: soloDigitos($('dCodCredito').value) || M.codigoCreditoPorDefecto(codigo),
    };
    const errores = [];
    if (!codigo) errores.push('El código de banco es obligatorio.');
    if (!datos.nombre) errores.push('El nombre es obligatorio.');
    if (!/^\d{11}$/.test(datos.cuit)) errores.push('El CUIT debe tener 11 dígitos.');
    if (datos.sucursal != null && !Number.isInteger(datos.sucursal)) errores.push('El código de sucursal debe ser un número entero.');
    const dup = estado.bancos.find(b => Number(b.codigo) === datos.codigo && b !== bancoEditando);
    if (dup) errores.push(`El código ${datos.codigo} ya existe (${esc(dup.nombre)}).`);
    if (errores.length) {
      e.preventDefault();
      $('dError').innerHTML = aviso('bad', errores.join('<br>'));
      return;
    }
    if (bancoEditando) Object.assign(bancoEditando, datos);
    else estado.bancos.push(datos);
    guardar(); renderBancos();
    toast(`Banco ${datos.codigo} guardado`);
    if (alGuardarBanco) alGuardarBanco();
  });

  $('tablaBancos').addEventListener('click', e => {
    const b = e.target.closest('[data-editar-banco]');
    if (b) abrirBanco(estado.bancos.find(x => String(x.codigo) === b.dataset.editarBanco));
  });
  $('btnNuevoBanco').addEventListener('click', () => abrirBanco(null));

  $('btnBancosOriginales').addEventListener('click', () => {
    if (!confirm('Se reemplaza la tabla de bancos por la carga original del conversor. Se pierden los cambios hechos. ¿Continuar?')) return;
    estado.bancos = clonar(window.VALO_BANCOS_INICIALES);
    guardar(); renderBancos(); reevaluarArchivo();
    $('resultadoBancos').innerHTML = aviso('ok', `Tabla restaurada: ${estado.bancos.length} bancos.`);
  });

  $('btnDescargarBancos').addEventListener('click', () => {
    const aoa = [['Banco', 'Nombre', 'CUIT', 'Jurisdiccion', 'Codigo Sucursal', 'Codigo Nº Credito']]
      .concat(estado.bancos.map(b => [Number(b.codigo), b.nombre, /^\d+$/.test(b.cuit) ? Number(b.cuit) : b.cuit,
        b.jurisdiccion, b.sucursal == null || b.sucursal === '' ? '#N/A' : Number(b.sucursal), String(b.codCredito)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 8 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 15 }, { wch: 17 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bancos');
    XLSX.writeFile(wb, 'Bancos.xlsx');
  });

  $('btnCargarBancos').addEventListener('click', () => $('archivoBancos').click());
  $('archivoBancos').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = await leerLibro(file);
      const nombreHoja = wb.SheetNames.find(n => M.normalizar(n) === 'bancos') || wb.SheetNames[0];
      const res = importarBancos(filasHoja(wb.Sheets[nombreHoja]), $('bModo').value);
      guardar(); renderBancos(); reevaluarArchivo();
      const partes = [`Hoja <b>${esc(nombreHoja)}</b>: ${res.leidos} bancos leídos.`];
      if (res.modo === 'reemplazar') partes.push(`La tabla quedó con ${estado.bancos.length} bancos.`);
      else partes.push(`${res.actualizados} actualizados, ${res.nuevos} nuevos.`);
      if (res.ignorados.length) partes.push(`Se ignoraron ${res.ignorados.length} filas: ${esc(res.ignorados.slice(0, 5).join('; '))}${res.ignorados.length > 5 ? '…' : ''}`);
      $('resultadoBancos').innerHTML = aviso(res.ignorados.length ? 'warn' : 'ok', partes.join(' '));
    } catch (err) {
      $('resultadoBancos').innerHTML = aviso('bad', esc(err.message || err));
    }
  });

  function importarBancos(filas, modo) {
    const alias = {
      codigo: ['banco', 'cod banco', 'codigo banco', 'codigo de banco', 'codigo', 'cod'],
      nombre: ['nombre', 'nombre banco', 'denominacion'],
      cuit: ['cuit'],
      jurisdiccion: ['jurisdiccion', 'provincia'],
      sucursal: ['codigo sucursal', 'cod sucursal', 'sucursal', 'codigo de sucursal'],
      codCredito: ['codigo n credito', 'codigo no credito', 'codigo nro credito', 'codigo credito', 'cod credito', 'codigo de credito'],
    };
    let filaEnc = -1, cols = {};
    for (let i = 0; i < Math.min(filas.length, 10) && filaEnc < 0; i++) {
      const enc = (filas[i] || []).map(M.normalizar);
      const c = {};
      Object.entries(alias).forEach(([k, lista]) => {
        const idx = enc.findIndex(h => lista.includes(h));
        if (idx > -1) c[k] = idx;
      });
      if (c.codigo != null && c.cuit != null && c.nombre != null) { filaEnc = i; cols = c; }
    }
    if (filaEnc < 0) throw new Error('No se encontraron los encabezados Banco, Nombre y CUIT en el archivo.');
    const leidos = [], ignorados = [];
    filas.slice(filaEnc + 1).forEach((r, i) => {
      if (!r || !r.some(v => v != null && v !== '')) return;
      const codigo = M.aCodigoBanco(r[cols.codigo]);
      if (codigo == null) { ignorados.push(`fila ${filaEnc + i + 2} sin código`); return; }
      const jur = cols.jurisdiccion != null && r[cols.jurisdiccion] != null ? String(r[cols.jurisdiccion]).trim() : 'Prueba';
      let suc = cols.sucursal != null ? M.aNumero(r[cols.sucursal]) : null;
      if (suc == null) { const p = M.provinciaPorNombre(jur); suc = p ? p.codigo : null; }
      const cc = cols.codCredito != null && r[cols.codCredito] != null && String(r[cols.codCredito]).trim() !== ''
        ? soloDigitos(String(r[cols.codCredito]).trim().replace(/\.0+$/, '')) : M.codigoCreditoPorDefecto(codigo);
      const cuitCrudo = r[cols.cuit];
      const cuit = typeof cuitCrudo === 'number' ? String(Math.round(cuitCrudo)) : soloDigitos(cuitCrudo);
      leidos.push({ codigo, nombre: String(r[cols.nombre] == null ? '' : r[cols.nombre]).trim(), cuit, jurisdiccion: jur || 'Prueba',
        sucursal: suc == null ? null : Math.round(suc), codCredito: cc || M.codigoCreditoPorDefecto(codigo) });
    });
    if (!leidos.length) throw new Error('El archivo no tiene filas de bancos.');
    let actualizados = 0, nuevos = 0;
    if (modo === 'reemplazar') {
      const vistos = new Map();
      leidos.forEach(b => vistos.set(b.codigo, b)); // si un código se repite, queda el último
      estado.bancos = [...vistos.values()];
    } else {
      leidos.forEach(b => {
        const ex = estado.bancos.find(x => Number(x.codigo) === b.codigo);
        if (ex) { Object.assign(ex, b); actualizados++; } else { estado.bancos.push(b); nuevos++; }
      });
    }
    return { modo, leidos: leidos.length, actualizados, nuevos, ignorados };
  }

  // ============================================================ LOTE

  function periodoActual() {
    const d = new Date();
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
  }

  function renderSelectClientes(seleccion) {
    const sel = $('fCliente');
    const previo = seleccion || sel.value;
    const hay = estado.clientes.length > 0;
    $('sinClientes').classList.toggle('oculto', hay);
    $('cardFormulario').classList.toggle('oculto', !hay);
    $('cardArchivo').classList.toggle('oculto', !hay);
    sel.innerHTML = hay ? '<option value="">Elegí un cliente…</option>' + estado.clientes.map(c =>
      `<option value="${c.id}">${esc(c.nombre)} · Negocio ${esc(c.negocio)} · ${esc(c.cuit)}</option>`).join('') : '';
    if (previo && clientePorId(previo)) sel.value = previo;
    else if (estado.clientes.length === 1) sel.value = estado.clientes[0].id;
    const hSel = $('hCliente');
    const hPrevio = hSel.value;
    hSel.innerHTML = '<option value="">Todos</option>' + estado.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    hSel.value = clientePorId(hPrevio) ? hPrevio : '';
    alCambiarCliente();
  }

  const tipoAccion = () => document.querySelector('input[name="fTipo"]:checked').value;

  function alCambiarCliente() {
    const c = clientePorId($('fCliente').value);
    $('fNegocio').value = c ? c.negocio : '';
    $('fCedente').value = c ? c.cuit : '';
    if (c && c.tasa !== '' && c.tasa != null) $('fTasa').value = c.tasa;
    $('fSecuenciaManual').checked = false;
    actualizarFormulario();
  }

  function actualizarFormulario() {
    const c = clientePorId($('fCliente').value);
    const manual = $('fSecuenciaManual').checked;
    $('fSecuencia').readOnly = !manual;
    if (!manual) $('fSecuencia').value = c ? M.calcularSecuenciaLote(c.ultimaSecuencia, tipoAccion()).secuencia : '';
    const sec = Number($('fSecuencia').value);
    $('fLote').value = !c ? '' : tipoAccion() === 'Alta' ? (Number.isInteger(sec) && sec > 0 ? sec : '') : 0;
    $('fLoteAyuda').textContent = tipoAccion() === 'Alta' ? 'Alta: lote = secuencia' : 'Revolving: lote = 0';
    reevaluarArchivo();
  }

  function parametros() {
    return {
      tipoAccion: tipoAccion(),
      periodo: $('fPeriodo').value.trim(),
      secuencia: Number($('fSecuencia').value),
      lote: Number($('fLote').value),
      tasa: $('fTasa').value.trim().replace(',', '.'),
      negocio: $('fNegocio').value,
      cedente: $('fCedente').value,
    };
  }

  function estadoFormulario() {
    const c = clientePorId($('fCliente').value);
    const p = parametros();
    const faltan = !c || !p.periodo || !p.tasa || !$('fSecuencia').value;
    const errores = c ? M.validarFormulario(Object.assign({}, p, { tasa: p.tasa === '' ? null : Number(p.tasa) })) : [];
    if (c) {
      const usada = lotesDe(c.id).find(l => l.secuencia === p.secuencia);
      if (usada) errores.push(`La secuencia ${p.secuencia} ya fue usada por este cliente (lote del ${new Date(usada.fecha).toLocaleDateString('es-AR')}).`);
    }
    return { cliente: c, p, estado: faltan ? 'INCOMPLETO' : errores.length ? 'REVISAR DATOS' : 'LISTO', errores };
  }

  function renderEstadoFormulario(ef) {
    const clase = ef.estado === 'LISTO' ? 'ok' : ef.estado === 'INCOMPLETO' ? 'gris' : 'bad';
    let html = `<div class="acciones">Estado del formulario: <span class="chip ${clase}">${ef.estado}</span></div>`;
    if (ef.estado === 'REVISAR DATOS') html += aviso('bad', ef.errores.map(esc).join('<br>'));
    $('estadoFormulario').innerHTML = html;
  }

  ['fPeriodo', 'fTasa', 'fSecuencia'].forEach(id => $(id).addEventListener('input', actualizarFormulario));
  $('fCliente').addEventListener('change', alCambiarCliente);
  $('fSecuenciaManual').addEventListener('change', actualizarFormulario);
  document.querySelectorAll('input[name="fTipo"]').forEach(r => r.addEventListener('change', actualizarFormulario));

  // --- archivo del cliente
  let archivo = null;   // { nombre, hojas: [{hoja, formato, cantidad, filas}], conciliacion }
  let preparado = null; // { reporte, controlBancos, errores, total }

  const zona = $('zonaLote');
  zona.addEventListener('click', () => $('archivoLote').click());
  zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('archivoLote').click(); } });
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('encima'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.classList.remove('encima');
    if (e.dataTransfer.files[0]) cargarArchivoLote(e.dataTransfer.files[0]);
  });
  $('archivoLote').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) cargarArchivoLote(f);
  });

  async function cargarArchivoLote(file) {
    try {
      const wb = await leerLibro(file);
      const hojas = wb.SheetNames.map(n => {
        const filas = filasHoja(wb.Sheets[n]);
        return Object.assign(M.detectarHoja(n, filas), { filas });
      });
      const utiles = hojas.filter(h => h.formato && M.normalizar(h.hoja) !== 'glosario');
      if (!utiles.length) throw new Error('No se encontró una hoja con los datos esperados (columnas cod_entidad_bancaria / dat_reconciliation_estimated_date, o COD_BANCO / MONTO / FECHA_VENCIMIENTO).');
      const conc = hojas.find(h => M.normalizar(h.hoja).startsWith('conciliacion'));
      archivo = { nombre: file.name, hojas: utiles, conciliacion: conc ? M.leerConciliacion(conc.filas) : null };
      // Por defecto: la hoja de cupones GetNet con más filas; si no hay, la hoja Reporte.
      const porDefecto = utiles.filter(h => h.formato === 'getnet').sort((a, b) => b.cantidad - a.cantidad)[0] || utiles[0];
      $('aNombre').value = file.name;
      $('aHoja').innerHTML = utiles.map((h, i) => `<option value="${i}" ${h === porDefecto ? 'selected' : ''}>${esc(h.hoja)} — ${M.FORMATOS[h.formato].nombre} (${fmtEntero(h.cantidad)} filas)</option>`).join('');
      $('aMonto').innerHTML = Object.entries(M.COLUMNAS_MONTO).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
      // Tipo de acción: si el nombre del archivo lo indica, se toma de ahí.
      const n = M.normalizar(file.name);
      if (/\brevolving\b/.test(n)) document.querySelector('input[name="fTipo"][value="Revolving"]').checked = true;
      else if (/\balta\b/.test(n)) document.querySelector('input[name="fTipo"][value="Alta"]').checked = true;
      $('detalleArchivo').classList.remove('oculto');
      actualizarFormulario();
    } catch (err) {
      archivo = null; preparado = null;
      $('detalleArchivo').classList.add('oculto');
      toast('No se pudo leer el archivo');
      $('motivoBloqueo').innerHTML = `<span style="color:var(--bad)">${esc(err.message || err)}</span>`;
      $('btnProcesar').disabled = true;
    }
  }
  $('aHoja').addEventListener('change', reevaluarArchivo);
  $('aMonto').addEventListener('change', reevaluarArchivo);

  function reevaluarArchivo() {
    const ef = estadoFormulario();
    renderEstadoFormulario(ef);
    const bloqueos = [];
    if (!ef.cliente) bloqueos.push('elegí el cliente');
    else if (ef.estado !== 'LISTO') bloqueos.push('completá el formulario');
    if (!archivo) {
      preparado = null;
      bloqueos.push('cargá el archivo del cliente');
      mostrarBloqueo(bloqueos);
      return;
    }
    const hoja = archivo.hojas[Number($('aHoja').value) || 0];
    $('aMontoCaja').classList.toggle('oculto', hoja.formato !== 'getnet');
    const reporte = M.armarReporte(hoja.filas, hoja, { columnaMonto: $('aMonto').value });
    const errores = M.controlarReporte(reporte);
    const cb = M.controlarBancos(reporte, estado.bancos);
    const total = M.round2(reporte.reduce((s, r) => s + (r.MONTO || 0), 0));
    const fechas = reporte.map(r => r.FECHA_VENCIMIENTO).filter(f => f != null);
    preparado = { reporte, errores, cb, total, hoja };

    let html = `<div class="kpis">
      <div class="kpi"><b>${fmtEntero(reporte.length)}</b><span>filas del reporte</span></div>
      <div class="kpi"><b>${fmtEntero(cb.detalle.length)}</b><span>bancos distintos</span></div>
      <div class="kpi"><b>${fechas.length ? M.fechaLegible(Math.min(...fechas)) + ' – ' + M.fechaLegible(Math.max(...fechas)) : '—'}</b><span>vencimientos</span></div>
      <div class="kpi"><b>$ ${fmtMonto(total)}</b><span>total MONTO</span></div></div>`;
    if (archivo.conciliacion && archivo.conciliacion.bruto != null && hoja.formato === 'getnet') {
      const bruto = archivo.conciliacion.bruto;
      const cuotas = M.round2(M.armarReporte(hoja.filas, hoja, { columnaMonto: 'vlu_installment_amount' }).reduce((s, r) => s + (r.MONTO || 0), 0));
      html += Math.abs(bruto - total) < 0.01
        ? aviso('ok', `El total coincide con el Bruto de la hoja Conciliación ($ ${fmtMonto(bruto)}).`)
        : aviso('warn', `Atención: el total MONTO ($ ${fmtMonto(total)}) no coincide con el Bruto de la hoja Conciliación ($ ${fmtMonto(bruto)}).` +
          (Math.abs(bruto - cuotas) < 0.01 && $('aMonto').value !== 'vlu_installment_amount' ? ' El Bruto coincide con la suma de <b>vlu_installment_amount</b>; revisá la columna elegida para MONTO.' : ''));
    }
    if (errores.length) html += aviso('bad', `<b>El archivo tiene ${errores.length} filas con datos inválidos:</b><ul>${errores.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join('')}${errores.length > 8 ? '<li>…</li>' : ''}</ul>`);
    $('resumenArchivo').innerHTML = html;

    if (cb.conProblemas.length) {
      $('controlBancos').innerHTML = aviso('bad', `<b>ACTUALIZAR BANCOS:</b> ${cb.conProblemas.length} bancos del archivo no están completos en la tabla Bancos. Corregilos para poder procesar.`) +
        `<div class="tabla-caja"><table><thead><tr><th class="num">Cód.</th><th>Nombre en el archivo</th><th class="num">Filas</th><th>Problema</th><th></th></tr></thead><tbody>${
          cb.conProblemas.map(d => `<tr><td class="num">${d.codigo}</td><td>${esc(d.nombreArchivo)}</td><td class="num">${d.filas}</td>
          <td>${esc(d.problemas.join(' · '))}</td><td><button class="btn chico" data-arreglar-banco="${d.codigo}">${d.banco ? 'Editar banco' : 'Agregar banco'}</button></td></tr>`).join('')}</tbody></table></div>`;
    } else {
      $('controlBancos').innerHTML = cb.detalle.length ? aviso('ok', `Mapeo de bancos OK: los ${cb.detalle.length} bancos del archivo tienen CUIT, provincia, sucursal y código de crédito.`) : '';
    }
    if (!reporte.length) bloqueos.push('el archivo no tiene filas');
    if (errores.length) bloqueos.push('corregí las filas inválidas del archivo');
    if (cb.conProblemas.length) bloqueos.push('completá los bancos marcados');
    mostrarBloqueo(bloqueos);
  }

  function mostrarBloqueo(bloqueos) {
    $('btnProcesar').disabled = bloqueos.length > 0;
    $('motivoBloqueo').textContent = bloqueos.length ? 'Para procesar: ' + bloqueos.join(', ') + '.' : '';
  }

  $('controlBancos').addEventListener('click', e => {
    const b = e.target.closest('[data-arreglar-banco]');
    if (!b) return;
    const codigo = Number(b.dataset.arreglarBanco);
    const existente = estado.bancos.find(x => Number(x.codigo) === codigo);
    const det = preparado.cb.detalle.find(d => d.codigo === codigo);
    abrirBanco(existente, { codigo, nombre: String(det.nombreArchivo || '').slice(0, 30), codCredito: M.codigoCreditoPorDefecto(codigo) }, reevaluarArchivo);
  });

  // --- procesar
  $('btnProcesar').addEventListener('click', () => {
    const ef = estadoFormulario();
    if (ef.estado !== 'LISTO' || !preparado || preparado.errores.length || preparado.cb.conProblemas.length) { reevaluarArchivo(); return; }
    const c = ef.cliente;
    const p = Object.assign({}, ef.p, { tasa: Number(ef.p.tasa) });
    const firma = [archivo.nombre, preparado.hoja.hoja, preparado.reporte.length, preparado.total].join('|');
    const repetido = lotesDe(c.id).find(l => l.firma === firma);
    if (repetido && !confirm(`Este archivo ya se procesó para ${c.nombre} con la secuencia ${repetido.secuencia}. ¿Procesarlo igual con la secuencia ${p.secuencia}?`)) return;
    if (!confirm(`Se va a generar el lote de ${c.nombre}:\n\nTipo: ${p.tipoAccion}\nSecuencia: ${p.secuencia}\nLote: ${p.lote}\nPeriodo: ${p.periodo}\nTasa: ${p.tasa}\n\n¿Confirmar?`)) return;

    const hoy = new Date();
    const cuotas = M.generarCuotas(preparado.reporte, estado.bancos, p, hoy);
    const creditos = M.generarCreditos(cuotas, estado.bancos, p);
    const lote = {
      id: nuevoId(), clienteId: c.id, fecha: hoy.toISOString(), archivo: archivo.nombre, hoja: preparado.hoja.hoja,
      columnaMonto: preparado.hoja.formato === 'getnet' ? $('aMonto').value : 'MONTO', firma,
      tipoAccion: p.tipoAccion, secuencia: p.secuencia, lote: p.lote, periodo: p.periodo, tasa: p.tasa,
      secuenciaAnterior: c.ultimaSecuencia, filas: preparado.reporte.length,
      cantCuotas: cuotas.filas.length, cantCreditos: creditos.filas.length, total: cuotas.encabezado.totalCapital,
      nombreCuotas: M.nombreArchivo('cuotas', hoy), nombreCreditos: M.nombreArchivo('creditos', hoy),
      txtCuotas: M.txtCuotas(cuotas), txtCreditos: M.txtCreditos(creditos),
    };
    estado.lotes.push(lote);
    c.ultimaSecuencia = Math.max(c.ultimaSecuencia, p.secuencia);
    c.tasa = p.tasa;
    if (!guardar()) {
      // Sin espacio: se conserva el registro del lote sin el contenido de los TXT.
      delete lote.txtCuotas; delete lote.txtCreditos;
      if (!guardar()) alert('No se pudo guardar en este navegador. Descargá los TXT ahora y hacé un respaldo.');
      else toast('Sin espacio para guardar los TXT en el historial: descargalos ahora.');
    }
    mostrarResultado(lote, cuotas, creditos, preparado.reporte, preparado.total, { txtCuotas: M.txtCuotas(cuotas), txtCreditos: M.txtCreditos(creditos) });
    // El archivo ya procesado se descarta para evitar cargarlo dos veces por error.
    archivo = null; preparado = null;
    $('detalleArchivo').classList.add('oculto');
    $('fSecuenciaManual').checked = false;
    actualizarFormulario();
    renderClientes();
    toast(`Lote generado: secuencia ${lote.secuencia}`);
  });

  let resultadoActual = null;

  function mostrarResultado(lote, cuotas, creditos, reporte, totalMonto, textos) {
    resultadoActual = { cuotas, creditos, reporte };
    const c = clientePorId(lote.clienteId);
    $('cardResultado').classList.remove('oculto');
    $('resultadoSub').textContent = `${c ? c.nombre : ''} · ${lote.tipoAccion.toUpperCase()} · Secuencia ${lote.secuencia} · Lote ${lote.lote} · Periodo ${lote.periodo} · Archivo ${lote.archivo}`;
    $('descargasResultado').innerHTML = `
      <button class="btn primario" data-descarga="cuotas">Descargar ${esc(lote.nombreCuotas)}</button>
      <button class="btn primario" data-descarga="creditos">Descargar ${esc(lote.nombreCreditos)}</button>`;
    $('descargasResultado').onclick = e => {
      const b = e.target.closest('[data-descarga]');
      if (!b) return;
      if (b.dataset.descarga === 'cuotas') descargar(lote.nombreCuotas, textos.txtCuotas);
      else descargar(lote.nombreCreditos, textos.txtCreditos);
    };
    const ce = cuotas.encabezado, re = creditos.encabezado;
    const combinaciones = new Set(reporte.filter(r => r.COD_BANCO != null && r.FECHA_VENCIMIENTO != null).map(r => r.COD_BANCO + '|' + r.FECHA_VENCIMIENTO)).size;
    const controles = [
      ['Cantidad de Cuotas = combinaciones únicas banco–fecha', ce.cantidad === combinaciones, `${ce.cantidad} / ${combinaciones}`],
      ['Cantidad de Créditos = números de crédito únicos', re.cantidad === new Set(cuotas.filas.map(f => f.credito)).size, String(re.cantidad)],
      ['Cuotas: total capital = total valor actual = suma MONTO', Math.abs(ce.totalCapital - totalMonto) < 0.005 && Math.abs(ce.totalValor - totalMonto) < 0.005, `$ ${fmtMonto(ce.totalCapital)}`],
      ['Cuotas: total interés a descuento = 0', ce.totalInteres === 0, fmtMonto(ce.totalInteres)],
      ['Créditos: totales iguales a Cuotas', Math.abs(re.totalCapital - ce.totalCapital) < 0.005 && Math.abs(re.totalValor - ce.totalValor) < 0.005 && re.totalInteres === ce.totalInteres, `$ ${fmtMonto(re.totalCapital)}`],
      ['Sin campos obligatorios vacíos', cuotas.filas.every(f => f.sucursal !== '' && f.cuit !== '' && f.credito !== '') && creditos.filas.every(f => f.nombre !== ''), ''],
    ];
    $('controlesResultado').innerHTML = `<h3>Controles antes de usar el archivo</h3><div class="tabla-caja" style="max-height:none"><table><tbody>${
      controles.map(([t, ok, v]) => `<tr><td>${esc(t)}</td><td class="num">${esc(v)}</td><td>${ok ? '<span class="chip ok">OK</span>' : '<span class="chip bad">REVISAR</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    renderTablaResultado('cuotas');
    $('cardResultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('pestanasResultado').addEventListener('click', e => {
    const b = e.target.closest('[data-tabla]');
    if (b) renderTablaResultado(b.dataset.tabla);
  });

  function renderTablaResultado(cual) {
    document.querySelectorAll('#pestanasResultado button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tabla === cual)));
    if (!resultadoActual) return;
    const { cuotas, creditos, reporte } = resultadoActual;
    const LIMITE = 1000;
    let html;
    if (cual === 'cuotas') {
      const e = cuotas.encabezado;
      html = `<table><thead><tr><th>Cód. sucursal</th><th>Tipo id.</th><th>Nº identificación</th><th>Nº crédito</th><th class="num">Nº cuota</th><th>Vencimiento</th>
        <th class="num">Importe cuota</th><th class="num">Factor</th><th class="num">Capital</th><th class="num">Valor actual</th><th class="num">Interés a desc.</th></tr></thead><tbody>
        <tr class="enc"><td>${e.tipoArchivo}</td><td>${e.tipoAccion}</td><td>${e.cantidad} registros</td><td>Sec. ${e.secuencia}</td><td class="num">Ces. ${e.cesionario}</td><td>Neg. ${esc(e.negocio)}</td>
        <td class="num" colspan="3">Ced. ${esc(e.cedente)} · $ ${fmtMonto(e.totalCapital)}</td><td class="num">${fmtMonto(e.totalValor)}</td><td class="num">${fmtMonto(e.totalInteres)}</td></tr>
        ${cuotas.filas.slice(0, LIMITE).map(f => `<tr><td>${f.sucursal}</td><td>${f.tipo}</td><td>${esc(f.cuit)}</td><td>${esc(f.credito)}</td><td class="num">${f.cuota}</td>
        <td>${M.fechaYYYYMMDD(f.fecha)}</td><td class="num">${fmtMonto(f.importe)}</td><td class="num">${f.factor}</td><td class="num">${fmtMonto(f.capital)}</td>
        <td class="num">${fmtMonto(f.valor)}</td><td class="num">${fmtMonto(f.interes)}</td></tr>`).join('')}</tbody></table>`;
    } else if (cual === 'creditos') {
      const e = creditos.encabezado;
      html = `<table><thead><tr><th>Nº crédito</th><th>Tipo id.</th><th>Nº identificación</th><th>Apellido y nombres</th><th class="num">Capital</th><th class="num">Plan</th>
        <th class="num">TNA</th><th class="num">TNA pun.</th><th class="num">Importe cuota</th><th>Alta</th><th>1er vto.</th><th>1er vto. impago</th><th class="num">Cuotas rest.</th>
        <th class="num">Monto cedido</th><th class="num">Sucursal</th><th class="num">Saldo capital</th><th class="num">Valor actual</th><th class="num">Interés desc.</th></tr></thead><tbody>
        <tr class="enc"><td>${e.tipoArchivo}</td><td>${e.tipoAccion}</td><td>Motivo ${e.motivo}</td><td>${e.cantidad} registros · Periodo ${e.periodo}</td><td>Sec. ${e.secuencia}</td><td>Lote ${e.lote}</td>
        <td>${e.cesionario}</td><td>Neg. ${esc(e.negocio)}</td><td colspan="2">Ced. ${esc(e.cedente)}</td><td class="num" colspan="2">$ ${fmtMonto(e.totalCapital)}</td><td class="num">Tasa ${e.tasa}</td>
        <td class="num" colspan="2">${fmtMonto(e.totalValor)}</td><td class="num" colspan="3">${fmtMonto(e.totalInteres)}</td></tr>
        ${creditos.filas.slice(0, LIMITE).map(f => `<tr><td>${esc(f.credito)}</td><td>${f.tipo}</td><td>${esc(f.cuit)}</td><td>${esc(f.nombre)}</td><td class="num">${fmtMonto(f.capital)}</td>
        <td class="num">${f.plan}</td><td class="num">${f.tna}</td><td class="num">${f.tnaPunitorio}</td><td class="num">${fmtMonto(f.importe)}</td><td>${M.fechaDDMMYY(f.fechaAlta)}</td>
        <td>${M.fechaDDMMYY(f.fechaPrimerVto)}</td><td>${M.fechaDDMMYY(f.fechaPrimerImpago)}</td><td class="num">${f.cuotasRestantes}</td><td class="num">${fmtMonto(f.montoCedido)}</td>
        <td class="num">${f.sucursal}</td><td class="num">${fmtMonto(f.saldoCapital)}</td><td class="num">${fmtMonto(f.valorActual)}</td><td class="num">${fmtMonto(f.interes)}</td></tr>`).join('')}</tbody></table>`;
    } else {
      html = `<table><thead><tr>${M.COLS_REPORTE.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
        reporte.slice(0, LIMITE).map(r => `<tr><td>${esc(r.ID_LOTE)}</td><td>${r.COD_BANCO}</td><td>${esc(r.NOMBRE_BANCO)}</td><td class="num">${fmtMonto(r.MONTO)}</td>
        <td>${r.FECHA_VENCIMIENTO == null ? '' : M.fechaLegible(r.FECHA_VENCIMIENTO)}</td><td>${r.PLAZO == null ? '' : r.PLAZO}</td><td>${r.TNA == null ? '' : r.TNA}</td>
        <td>${r.TEA == null ? '' : r.TEA}</td><td>${r.CFT == null ? '' : r.CFT}</td></tr>`).join('')}</tbody></table>`;
      if (reporte.length > LIMITE) html += `<div class="vacio">Se muestran ${LIMITE} de ${fmtEntero(reporte.length)} filas.</div>`;
    }
    $('tablaResultado').innerHTML = html;
  }

  // ============================================================ HISTORIAL

  function renderHistorial() {
    const filtro = $('hCliente').value;
    const lista = estado.lotes.filter(l => !filtro || l.clienteId === filtro).slice().reverse();
    if (!lista.length) {
      $('tablaHistorial').innerHTML = '<div class="vacio">Todavía no se procesó ningún lote.</div>';
      return;
    }
    const ultimos = new Map();
    estado.clientes.forEach(c => {
      const ls = lotesDe(c.id);
      if (ls.length) ultimos.set(c.id, ls[ls.length - 1].id);
    });
    $('tablaHistorial').innerHTML = `<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Archivo</th><th>Tipo</th><th class="num">Secuencia</th><th class="num">Lote</th>
      <th class="num">Periodo</th><th class="num">Cuotas</th><th class="num">Créditos</th><th class="num">Total capital</th><th>TXT</th><th></th></tr></thead><tbody>${
      lista.map(l => {
        const c = clientePorId(l.clienteId);
        const tieneTxt = l.txtCuotas && l.txtCreditos;
        return `<tr${l.anulado ? ' style="opacity:.55"' : ''}><td>${new Date(l.fecha).toLocaleString('es-AR')}</td><td>${esc(c ? c.nombre : '(borrado)')}</td>
          <td title="Hoja: ${esc(l.hoja)} · MONTO: ${esc(l.columnaMonto)}">${esc(l.archivo)}</td><td>${esc(l.tipoAccion)}</td><td class="num">${l.secuencia}</td><td class="num">${l.lote}</td>
          <td class="num">${esc(l.periodo)}</td><td class="num">${l.cantCuotas}</td><td class="num">${l.cantCreditos}</td><td class="num">${fmtMonto(l.total)}</td>
          <td>${tieneTxt ? `<button class="btn chico" data-h-cuotas="${l.id}">Cuotas</button> <button class="btn chico" data-h-creditos="${l.id}">Créditos</button>` : '<span class="chip gris">no guardado</span>'}</td>
          <td>${l.anulado ? '<span class="chip gris">Anulado</span>' : ultimos.get(l.clienteId) === l.id ? `<button class="btn chico peligro" data-h-anular="${l.id}">Anular</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
  $('hCliente').addEventListener('change', renderHistorial);
  $('tablaHistorial').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.dataset.hCuotas || b.dataset.hCreditos || b.dataset.hAnular;
    const l = estado.lotes.find(x => x.id === id);
    if (!l) return;
    if (b.dataset.hCuotas) descargar(l.nombreCuotas, l.txtCuotas);
    if (b.dataset.hCreditos) descargar(l.nombreCreditos, l.txtCreditos);
    if (b.dataset.hAnular) {
      const c = clientePorId(l.clienteId);
      if (!confirm(`¿Anular el lote con secuencia ${l.secuencia}? La última secuencia de ${c ? c.nombre : 'el cliente'} vuelve a ${l.secuenciaAnterior}.`)) return;
      l.anulado = true;
      if (c) c.ultimaSecuencia = l.secuenciaAnterior;
      guardar(); renderHistorial(); renderClientes(); actualizarFormulario();
      toast('Lote anulado');
    }
  });

  // ============================================================ RESPALDO

  $('btnRespaldo').addEventListener('click', () => {
    const d = new Date();
    const f = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    descargar(`respaldo-valo-${f}.json`, JSON.stringify(estado, null, 1), 'application/json');
  });
  $('btnRestaurar').addEventListener('click', () => $('archivoRespaldo').click());
  $('archivoRespaldo').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const nuevo = JSON.parse(await file.text());
      if (!nuevo || !Array.isArray(nuevo.clientes) || !Array.isArray(nuevo.bancos) || !Array.isArray(nuevo.lotes)) throw new Error('formato inválido');
      if (!confirm(`El respaldo tiene ${nuevo.clientes.length} clientes, ${nuevo.bancos.length} bancos y ${nuevo.lotes.length} lotes. Reemplaza los datos actuales. ¿Continuar?`)) return;
      estado = nuevo;
      guardar();
      renderSelectClientes(); renderClientes(); renderBancos(); renderHistorial();
      toast('Respaldo restaurado');
    } catch (err) {
      alert('No se pudo restaurar el respaldo: ' + (err.message || err));
    }
  });

  // ============================================================ inicio

  $('fPeriodo').value = periodoActual();
  renderSelectClientes();
  renderClientes();
  renderBancos();
  if (!guardar()) toast('Este navegador no permite guardar datos: usá "Descargar respaldo" al terminar.');
})();
