// Interfaz del Conversor VALO GetNet: clientes, bancos, carga de lote e historial.
// Los datos se guardan a través de ValoAlmacen: base compartida (página publicada en claude.ai)
// o el navegador (archivo abierto localmente).
(function () {
  'use strict';
  const M = window.ValoMotor;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMonto = n => (n == null || n === '' ? '' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtEntero = n => Number(n).toLocaleString('es-AR');
  const soloDigitos = s => String(s == null ? '' : s).replace(/\D/g, '');
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clonar = x => JSON.parse(JSON.stringify(x));

  let almacen = null;
  let descargas = null; // capacidad "downloads" de claude.ai, si está disponible
  let nombresUsuarios = {};
  const datos = () => almacen.datos;

  // ------------------------------------------------------------- utilidades

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => t.classList.remove('visible'), 3600);
  }

  function aviso(tipo, html) {
    return `<div class="aviso ${tipo}">${html}</div>`;
  }

  // Confirmación dentro de la página (claude.ai no muestra confirm()/alert()).
  function confirmar(titulo, mensajeHtml, textoBoton, peligro) {
    return new Promise(resolve => {
      const dlg = $('dlgConfirmar');
      $('confTitulo').textContent = titulo;
      $('confMensaje').innerHTML = mensajeHtml;
      $('confAceptar').textContent = textoBoton || 'Confirmar';
      $('confAceptar').classList.toggle('peligro-lleno', !!peligro);
      $('confCancelar').classList.toggle('oculto', textoBoton === null);
      if (textoBoton === null) $('confAceptar').textContent = 'Entendido';
      const cerrar = v => { dlg.close(); resolve(v); };
      $('confAceptar').onclick = () => cerrar(true);
      $('confCancelar').onclick = () => cerrar(false);
      dlg.oncancel = e => { e.preventDefault(); cerrar(false); };
      dlg.showModal();
    });
  }
  const informar = (titulo, mensajeHtml) => confirmar(titulo, mensajeHtml, null);

  // alternativa: { texto, como } para copiar si claude.ai no deja descargar (texto plano o tabla para pegar en Excel).
  async function descargar(nombre, contenido, conservarNombre, alternativa) {
    if (!conservarNombre) nombre = nombre.replace(/\.txt$/i, '.csv');
    const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: (/\.csv$/i.test(nombre) ? 'text/csv' : 'text/plain') + ';charset=utf-8' });
    const alt = alternativa || (contenido instanceof Blob ? null : { texto: contenido, como: 'archivo' });
    if (descargas) {
      try {
        await descargas.save({ filename: nombre, data: blob });
        return;
      } catch (e) {
        if (e && (e.code === 'declined' || e.code === 'rate_limited')) return;
        // Descarga no permitida (p. ej. el usuario no es miembro de la organización dueña de la página).
        return descargaBloqueada(nombre, blob, alt, e && e.message);
      }
    }
    // En claude.ai sin la capacidad de descargas (invitados de otra organización): el navegador no baja nada.
    if (almacen && almacen.modo === 'compartido' && !almacen.descargaLibre) return descargaBloqueada(nombre, blob, alt, 'las descargas de esta página son solo para los miembros de su organización');
    descargaDirecta(nombre, blob);
  }

  function descargaDirecta(nombre, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function descargaBloqueada(nombre, blob, alt, motivo) {
    try { descargaDirecta(nombre, blob); } catch (err) { /* sin descarga del navegador */ }
    if (!alt) { toast('No se pudo descargar ' + nombre + '. Pedile al dueño de la página que te sume a su organización de claude.ai.'); return; }
    const texto = String(alt.texto).replace(/^\ufeff/, '');
    const excel = alt.como === 'excel';
    const caja = `<textarea readonly style="width:100%;height:180px;font-family:monospace;font-size:12px;white-space:pre">${esc(texto)}</textarea>`;
    const ok = await confirmar('Descarga bloqueada',
      `<p>claude.ai no permitió descargar <b>${esc(nombre)}</b>${motivo ? ' (' + esc(motivo) + ')' : ''}.</p>` +
      (excel ? `<p>Copiá la tabla y pegala en una hoja nueva de Excel (celda A1).</p>`
        : `<p>Copiá el contenido, pegalo en el Bloc de notas y guardalo como <b>${esc(nombre)}</b> (codificación UTF-8).</p>`) + caja,
      excel ? 'Copiar tabla' : 'Copiar contenido');
    if (!ok) return;
    try { await navigator.clipboard.writeText(texto); toast(excel ? 'Tabla copiada: pegala en Excel' : 'Contenido copiado'); }
    catch (err) {
      await informar('Copiá el contenido', `<p>Hacé clic en el recuadro, seleccioná todo (Ctrl+A) y copialo (Ctrl+C).</p>` + caja);
    }
  }

  function descargarLibro(nombre, wb) {
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    // Alternativa: la primera hoja separada por tabulaciones (se pega directo en Excel), con coma decimal.
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const celda = v => v instanceof Date ? v.toLocaleDateString('es-AR') : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/[\t\r\n]+/g, ' ');
    const tsv = filas.map(f => f.map(celda).join('\t')).join('\r\n');
    return descargar(nombre, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), true, { texto: tsv, como: 'excel' });
  }

  function leerLibro(file) {
    return file.arrayBuffer().then(buf => XLSX.read(buf, { type: 'array' }));
  }

  // Devuelve las hojas de un archivo como [{hoja, filas}]. Los CSV se leen como texto (fechas dd/mm/aaaa intactas).
  async function leerHojas(file) {
    if (/\.(csv|txt)$/i.test(file.name)) return [{ hoja: file.name.replace(/\.[^.]+$/, ''), filas: M.leerCsv(await file.text()) }];
    const wb = await leerLibro(file);
    return wb.SheetNames.map(n => ({ hoja: n, filas: filasHoja(wb.Sheets[n]) }));
  }

  function filasHoja(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  }

  // Ejecuta una escritura mostrando el error en pantalla si falla.
  async function intentar(fn, mensajeOk) {
    try {
      const r = await fn();
      if (mensajeOk) toast(mensajeOk);
      return r === undefined ? true : r;
    } catch (e) {
      await informar('No se pudo guardar', esc(e.message || e));
      return false;
    }
  }

  const quien = id => (id && nombresUsuarios[id]) || '';

  // ------------------------------------------------------------- pestañas

  function irA(vista) {
    document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
    document.querySelectorAll('section.vista').forEach(s => s.classList.toggle('activa', s.id === 'vista-' + vista));
    const mas = $('navMas');
    if (mas) { const enMas = [...mas.options].some(o => o.value && o.value === vista); mas.value = enMas ? vista : ''; mas.classList.toggle('activa', enMas); }
    if (vista === 'cartera') alAbrirCartera();
    if (vista === 'deuda') alAbrirDeuda();
  }
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));
  $('navMas').addEventListener('change', e => { if (e.target.value) irA(e.target.value); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ir]');
    if (b) irA(b.dataset.ir);
  });

  // ============================================================ INTERFAZ POR CLIENTE

  // Editor de la interfaz de un cliente: se sube un archivo de ejemplo del cliente (o un archivo de interfaz
  // con dos columnas Campo | Columna) y se elige qué columna corresponde a banco, fecha de vencimiento y monto.
  function crearEditorInterfaz(caja) {
    let interfaz = null;   // interfaz guardada o elegida
    let columnas = [];     // encabezados del archivo de ejemplo
    let ejemplo = null;    // primera fila de datos, para mostrar valores de muestra
    const uid = caja.id;

    function render() {
      const opciones = actual => '<option value="">—</option>' + columnas.map(c => `<option ${c === actual ? 'selected' : ''}>${esc(c)}</option>`).join('');
      let html = `<h3>Interfaz del archivo del cliente</h3>
        <p class="sub" style="margin:0">Subí un archivo de ejemplo del cliente (Excel o CSV) y elegí qué columna tiene cada dato.
        Sin interfaz se reconoce automáticamente el formato GetNet / Reporte.</p>
        <div class="acciones" style="margin-top:10px">
          <button class="btn" type="button" data-escribe id="${uid}Btn">${interfaz ? 'Cambiar archivo de interfaz' : 'Cargar archivo de interfaz'}</button>
          ${interfaz && interfaz.tipo === 'meli-txt' ? '' : `<button class="btn" type="button" data-escribe id="${uid}Meli">Usar esquema MELI (TXT por banco)</button>`}
          ${interfaz ? `<button class="btn peligro" type="button" data-escribe id="${uid}Quitar">Quitar interfaz</button>` : ''}
          <span class="sub" style="margin:0">${interfaz ? 'Interfaz: <b>' + esc(interfaz.nombre) + '</b>' : 'Interfaz: automática (GetNet / Reporte)'}</span>
          <input type="file" id="${uid}Archivo" accept=".xlsx,.xls,.xlsm,.csv,.txt" class="oculto">
        </div>`;
      if (interfaz && interfaz.tipo === 'meli-txt') {
        html += aviso('ok', 'Esquema <b>MELI</b>: en Carga de lote se suben los TXT de cuotas de cada banco (<code>CUOTA_&lt;BANCO&gt;_&lt;fecha&gt;.txt</code>), varios a la vez. ' +
          'El banco se detecta por el nombre del archivo o el CUIT de la cabecera, con la tabla <b>Bancos MELI</b>.');
      } else if (interfaz) {
        html += '<div class="grid">' + M.CAMPOS_INTERFAZ.map(c => {
          const valor = interfaz[c.id] || '';
          const idx = ejemplo ? columnas.indexOf(valor) : -1;
          const muestra = idx > -1 && ejemplo[idx] != null && ejemplo[idx] !== '' ? 'Ej.: ' + esc(ejemplo[idx]) : '';
          return `<label class="campo">${esc(c.nombre)}${c.requerido ? ' *' : ''}
            <select data-campo="${c.id}">${opciones(valor)}</select>
            <span class="ayuda ejemplo">${muestra || (c.requerido ? '' : 'Opcional')}</span></label>`;
        }).join('') + '</div>';
      }
      caja.innerHTML = html;
      caja.querySelector('#' + uid + 'Btn').onclick = () => caja.querySelector('#' + uid + 'Archivo').click();
      const botonMeli = caja.querySelector('#' + uid + 'Meli');
      if (botonMeli) botonMeli.onclick = () => { interfaz = { tipo: 'meli-txt', nombre: 'MELI (TXT por banco)' }; columnas = []; ejemplo = null; render(); };
      const quitar = caja.querySelector('#' + uid + 'Quitar');
      if (quitar) quitar.onclick = () => { interfaz = null; columnas = []; ejemplo = null; render(); };
      caja.querySelector('#' + uid + 'Archivo').onchange = async e => {
        const f = e.target.files[0];
        e.target.value = '';
        if (f) await cargar(f);
      };
      caja.querySelectorAll('select[data-campo]').forEach(sel => sel.onchange = () => {
        interfaz[sel.dataset.campo] = sel.value;
        render();
      });
    }

    async function cargar(file) {
      try {
        const hojas = await leerHojas(file);
        const def = hojas.map(h => M.leerDefinicionInterfaz(h.filas)).find(Boolean);
        if (def) {
          // Archivo de interfaz: Campo | Columna.
          columnas = [...new Set([def.banco, def.fecha, def.monto, def.nombreBanco, def.id].filter(Boolean))];
          ejemplo = null;
          interfaz = Object.assign({ nombre: file.name }, def);
        } else {
          const hoja = hojas.find(h => M.encabezadosEjemplo(h.filas).length >= 3);
          if (!hoja) throw new Error('No se encontraron encabezados de columnas en el archivo.');
          columnas = M.encabezadosEjemplo(hoja.filas);
          const fEnc = hoja.filas.findIndex(r => r && M.encabezadosEjemplo([r]).length >= 2);
          const enc = (hoja.filas[fEnc] || []).map(c => (c == null ? '' : String(c).trim()));
          const datosFila = hoja.filas.slice(fEnc + 1).find(r => r && r.some(c => c != null && c !== ''));
          ejemplo = datosFila ? columnas.map(c => datosFila[enc.indexOf(c)]) : null;
          interfaz = { nombre: file.name };
          M.CAMPOS_INTERFAZ.forEach(c => { interfaz[c.id] = M.sugerirColumna(c.id, columnas); });
        }
        render();
      } catch (err) {
        toast('No se pudo leer el archivo de interfaz: ' + (err.message || err));
      }
    }

    function fijar(valor) {
      interfaz = valor ? Object.assign({}, valor) : null;
      columnas = valor ? (valor.columnas || [valor.banco, valor.fecha, valor.monto, valor.nombreBanco, valor.id].filter(Boolean)) : [];
      ejemplo = null;
      render();
    }

    // Devuelve { interfaz } o { error }.
    function leer() {
      if (!interfaz) return { interfaz: null };
      if (interfaz.tipo === 'meli-txt') {
        const out = { tipo: 'meli-txt', nombre: 'MELI (TXT por banco)', columnas: [] };
        M.CAMPOS_INTERFAZ.forEach(c => { out[c.id] = null; });
        return { interfaz: out };
      }
      const faltan = M.CAMPOS_INTERFAZ.filter(c => c.requerido && !interfaz[c.id]).map(c => c.nombre);
      if (faltan.length) return { error: 'En la interfaz falta elegir: ' + faltan.join(', ') + '.' };
      const elegidas = M.CAMPOS_INTERFAZ.map(c => interfaz[c.id]).filter(Boolean);
      if (new Set(elegidas).size !== elegidas.length) return { error: 'En la interfaz, cada dato tiene que venir de una columna distinta.' };
      const out = { tipo: null, nombre: interfaz.nombre, columnas: columnas.slice() };
      M.CAMPOS_INTERFAZ.forEach(c => { out[c.id] = interfaz[c.id] || null; });
      return { interfaz: out };
    }

    render();
    return { fijar, leer };
  }

  const editorAlta = crearEditorInterfaz($('cInterfaz'));
  const editorEdicion = crearEditorInterfaz($('eInterfaz'));

  // ============================================================ CLIENTES

  const clientePorId = id => datos().clientes.find(c => c.id === id);
  const lotesDe = id => datos().lotes.filter(l => l.clienteId === id && !l.anulado);

  function validarCliente(d, idActual) {
    const errores = [];
    if (!d.negocio) errores.push('El Nº de negocio es obligatorio.');
    if (!/^\d{11}$/.test(d.cuit)) errores.push('El CUIT del cedente debe tener 11 dígitos.');
    if (!d.nombre) errores.push('El nombre es obligatorio.');
    if (!Number.isInteger(d.ultimaSecuencia) || d.ultimaSecuencia < 0) errores.push('La última secuencia debe ser un entero mayor o igual a 0.');
    const dup = datos().clientes.find(c => c.cuit === d.cuit && c.id !== idActual);
    if (dup) errores.push(`Ya existe un cliente con el CUIT ${d.cuit} (${esc(dup.nombre)}).`);
    return errores;
  }

  $('formCliente').addEventListener('submit', async e => {
    e.preventDefault();
    const d = {
      negocio: $('cNegocio').value.trim(),
      cuit: soloDigitos($('cCuit').value),
      nombre: $('cNombre').value.trim(),
      ultimaSecuencia: Number($('cSecuencia').value.trim() || 0),
    };
    const errores = validarCliente(d);
    const ri = editorAlta.leer();
    if (ri.error) errores.push(ri.error);
    if (errores.length) {
      $('errorCliente').innerHTML = aviso('bad', errores.join('<br>'));
      return;
    }
    d.interfaz = ri.interfaz;
    $('errorCliente').innerHTML = '';
    const boton = e.target.querySelector('button[type=submit]');
    boton.disabled = true;
    const cliente = await intentar(() => almacen.crearCliente(Object.assign({ creado: new Date().toISOString(), tasa: '' }, d)));
    boton.disabled = false;
    if (!cliente) return;
    e.target.reset();
    $('cSecuencia').value = '0';
    editorAlta.fijar(null);
    clientePendiente = cliente.id;
    refrescar();
    toast(`Cliente ${cliente.nombre} dado de alta. Próxima secuencia: ${cliente.ultimaSecuencia + 1}`);
  });

  function renderClientes() {
    const caja = $('tablaClientes');
    if (!datos().clientes.length) {
      caja.innerHTML = '<div class="vacio">Todavía no hay clientes. Dalos de alta con el formulario de arriba.</div>';
      return;
    }
    const compartido = almacen.modo === 'compartido';
    const filas = datos().clientes.map(c => {
      const n = lotesDe(c.id).length;
      return `<tr>
        <td>${esc(c.negocio)}</td><td>${esc(c.cuit)}</td><td>${esc(c.nombre)}</td>
        <td class="num">${c.ultimaSecuencia}</td><td class="num">${c.ultimaSecuencia + 1}</td><td class="num">${n}</td>
        <td>${!c.interfaz ? '<span class="chip gris">Automática</span>' : c.interfaz.tipo === 'meli-txt' ? '<span class="chip ok">MELI · TXT</span>'
          : `<span title="Banco: ${esc(c.interfaz.banco)} · Fecha: ${esc(c.interfaz.fecha)} · Monto: ${esc(c.interfaz.monto)}">${esc(c.interfaz.nombre)}</span>`}</td>
        ${compartido ? `<td>${esc(quien(c.creadoPor))}</td>` : ''}
        <td><button class="btn chico" data-escribe data-editar-cliente="${c.id}">Editar</button>
        ${n ? '' : `<button class="btn chico peligro" data-escribe data-borrar-cliente="${c.id}">Borrar</button>`}</td></tr>`;
    }).join('');
    caja.innerHTML = `<table><thead><tr><th>Nº negocio</th><th>CUIT cedente</th><th>Nombre</th>
      <th class="num">Última secuencia</th><th class="num">Próxima</th><th class="num">Lotes</th><th>Interfaz</th>${compartido ? '<th>Alta por</th>' : ''}<th></th></tr></thead><tbody>${filas}</tbody></table>`;
  }

  let clienteEditando = null;
  $('tablaClientes').addEventListener('click', async e => {
    const ed = e.target.closest('[data-editar-cliente]');
    const bo = e.target.closest('[data-borrar-cliente]');
    if (ed) {
      const c = clientePorId(ed.dataset.editarCliente);
      clienteEditando = c;
      $('eNegocio').value = c.negocio; $('eCuit').value = c.cuit; $('eNombre').value = c.nombre;
      $('eSecuencia').value = c.ultimaSecuencia; $('eError').innerHTML = '';
      editorEdicion.fijar(c.interfaz || null);
      $('dlgCliente').showModal();
    }
    if (bo) {
      const c = clientePorId(bo.dataset.borrarCliente);
      if (await confirmar('Borrar cliente', `¿Borrar el cliente <b>${esc(c.nombre)}</b>?`, 'Borrar', true)) {
        await intentar(() => almacen.borrarCliente(c.id), 'Cliente borrado');
      }
    }
  });

  $('formEditarCliente').addEventListener('submit', async e => {
    e.preventDefault();
    if (e.submitter && e.submitter.value !== 'guardar') { $('dlgCliente').close(); return; }
    const d = {
      negocio: $('eNegocio').value.trim(), cuit: soloDigitos($('eCuit').value),
      nombre: $('eNombre').value.trim(), ultimaSecuencia: Number($('eSecuencia').value.trim() || 0),
    };
    const errores = validarCliente(d, clienteEditando.id);
    const ri = editorEdicion.leer();
    if (ri.error) errores.push(ri.error);
    if (errores.length) {
      $('eError').innerHTML = aviso('bad', errores.join('<br>'));
      return;
    }
    d.interfaz = ri.interfaz;
    if (d.ultimaSecuencia !== clienteEditando.ultimaSecuencia) {
      $('eError').innerHTML = '';
      if (!await confirmar('Cambiar secuencia', `Vas a cambiar la última secuencia de <b>${clienteEditando.ultimaSecuencia}</b> a <b>${d.ultimaSecuencia}</b>. ¿Continuar?`, 'Cambiar')) return;
    }
    if (await intentar(() => almacen.actualizarCliente(clienteEditando.id, d), 'Cliente actualizado')) $('dlgCliente').close();
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
    const bancos = datos().bancos;
    const q = M.normalizar($('bBuscar').value);
    const soloInc = $('bSoloIncompletos').checked;
    const incompletos = bancos.filter(b => M.problemasBanco(b).length).length;
    $('bResumen').textContent = `${bancos.length} bancos · ${incompletos} incompletos (Prueba / #N/D)`;
    if (!bancos.length) {
      $('tablaBancos').innerHTML = '<div class="vacio">La tabla de bancos está vacía. Cargá el Excel de bancos para poder procesar lotes.</div>';
      return;
    }
    const lista = bancos.filter(b => {
      if (soloInc && !M.problemasBanco(b).length) return false;
      if (!q) return true;
      return M.normalizar([b.codigo, b.nombre, b.cuit].join(' ')).includes(q);
    });
    if (!lista.length) {
      $('tablaBancos').innerHTML = '<div class="vacio">Sin resultados.</div>';
      return;
    }
    $('tablaBancos').innerHTML = `<table><thead><tr><th class="num">Banco</th><th>Nombre</th><th>CUIT</th><th>Jurisdicción</th>
      <th class="num">Cód. sucursal</th><th class="num" title="3 dígitos del banco en el número de crédito">Prefijo crédito</th><th>Estado</th><th></th></tr></thead><tbody>${
      lista.map(b => {
        const p = M.problemasBanco(b);
        return `<tr><td class="num">${esc(b.codigo)}</td><td>${esc(b.nombre)}</td><td>${esc(b.cuit)}</td><td>${esc(b.jurisdiccion)}</td>
          <td class="num">${b.sucursal == null || b.sucursal === '' ? '#N/D' : esc(b.sucursal)}</td><td class="num">${M.prefijoBanco(b.codigo)}</td>
          <td>${p.length ? `<span class="chip warn" title="${esc(p.join(' · '))}">Incompleto</span>` : '<span class="chip ok">OK</span>'}</td>
          <td><button class="btn chico" data-escribe data-editar-banco="${esc(b.codigo)}">Editar</button></td></tr>`;
      }).join('')}</tbody></table>`;
  }
  $('bBuscar').addEventListener('input', renderBancos);
  $('bSoloIncompletos').addEventListener('change', renderBancos);

  // --- diálogo de banco
  let bancoEditando = null; // código del banco que se edita (null = nuevo)
  let alGuardarBanco = null;

  function abrirBanco(banco, sugerido, callback) {
    bancoEditando = banco ? Number(banco.codigo) : null;
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
    if (bancoEditando == null) $('dCodCredito').placeholder = M.codigoCreditoPorDefecto(soloDigitos($('dCodigo').value));
  });

  $('formBanco').addEventListener('submit', async e => {
    e.preventDefault();
    const accion = e.submitter ? e.submitter.value : 'guardar';
    if (accion === 'cancelar') { $('dlgBanco').close(); return; }
    const lista = clonar(datos().bancos);
    if (accion === 'borrar') {
      $('dlgBanco').close();
      if (!await confirmar('Borrar banco', `¿Borrar el banco <b>${bancoEditando}</b>?`, 'Borrar', true)) return;
      await intentar(() => almacen.guardarBancos(lista.filter(b => Number(b.codigo) !== bancoEditando)), 'Banco borrado');
      return;
    }
    const codigo = soloDigitos($('dCodigo').value);
    const d = {
      codigo: Number(codigo),
      nombre: $('dNombre').value.trim(),
      cuit: soloDigitos($('dCuit').value),
      jurisdiccion: $('dJurisdiccion').value,
      sucursal: $('dSucursal').value.trim() === '' ? null : Number($('dSucursal').value),
      codCredito: soloDigitos($('dCodCredito').value) || M.codigoCreditoPorDefecto(codigo),
    };
    const errores = [];
    if (!codigo) errores.push('El código de banco es obligatorio.');
    if (!d.nombre) errores.push('El nombre es obligatorio.');
    if (!/^\d{11}$/.test(d.cuit)) errores.push('El CUIT debe tener 11 dígitos.');
    if (d.sucursal != null && !Number.isInteger(d.sucursal)) errores.push('El código de sucursal debe ser un número entero.');
    const dup = lista.find(b => Number(b.codigo) === d.codigo && Number(b.codigo) !== bancoEditando);
    if (dup) errores.push(`El código ${d.codigo} ya existe (${esc(dup.nombre)}).`);
    if (errores.length) {
      $('dError').innerHTML = aviso('bad', errores.join('<br>'));
      return;
    }
    const idx = bancoEditando == null ? -1 : lista.findIndex(b => Number(b.codigo) === bancoEditando);
    if (idx > -1) lista[idx] = d; else lista.push(d);
    if (await intentar(() => almacen.guardarBancos(lista), `Banco ${d.codigo} guardado`)) {
      $('dlgBanco').close();
      if (alGuardarBanco) alGuardarBanco();
    }
  });

  $('tablaBancos').addEventListener('click', e => {
    const b = e.target.closest('[data-editar-banco]');
    if (b) abrirBanco(datos().bancos.find(x => String(x.codigo) === b.dataset.editarBanco));
  });
  $('btnNuevoBanco').addEventListener('click', () => abrirBanco(null));

  $('btnBancosOriginales').addEventListener('click', async () => {
    if (!await confirmar('Volver a la carga original', 'Se reemplaza la tabla de bancos por la carga original del conversor. Se pierden los cambios hechos a la tabla.', 'Reemplazar', true)) return;
    const originales = await almacen.bancosOriginales();
    if (!originales || !originales.length) { await informar('Sin carga original', 'No hay una carga original guardada. Usá "Cargar Excel de bancos".'); return; }
    if (await intentar(() => almacen.guardarBancos(originales))) $('resultadoBancos').innerHTML = aviso('ok', `Tabla restaurada: ${originales.length} bancos.`);
  });

  $('btnDescargarBancos').addEventListener('click', () => {
    const aoa = [['Banco', 'Nombre', 'CUIT', 'Jurisdiccion', 'Codigo Sucursal', 'Codigo Nº Credito']]
      .concat(datos().bancos.map(b => [Number(b.codigo), b.nombre, /^\d+$/.test(b.cuit) ? Number(b.cuit) : b.cuit,
        b.jurisdiccion, b.sucursal == null || b.sucursal === '' ? '#N/A' : Number(b.sucursal), String(b.codCredito)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 8 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 15 }, { wch: 17 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bancos');
    descargarLibro('Bancos.xlsx', wb);
  });

  $('btnCargarBancos').addEventListener('click', () => $('archivoBancos').click());
  $('archivoBancos').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = await leerLibro(file);
      const nombreHoja = wb.SheetNames.find(n => M.normalizar(n) === 'bancos') || wb.SheetNames[0];
      const res = importarBancos(filasHoja(wb.Sheets[nombreHoja]), $('bModo').value, datos().bancos);
      if (!await intentar(() => almacen.guardarBancos(res.lista))) return;
      const partes = [`Hoja <b>${esc(nombreHoja)}</b>: ${res.leidos} bancos leídos.`];
      if (res.modo === 'reemplazar') partes.push(`La tabla quedó con ${res.lista.length} bancos.`);
      else partes.push(`${res.actualizados} actualizados, ${res.nuevos} nuevos.`);
      if (res.ignorados.length) partes.push(`Se ignoraron ${res.ignorados.length} filas: ${esc(res.ignorados.slice(0, 5).join('; '))}${res.ignorados.length > 5 ? '…' : ''}`);
      $('resultadoBancos').innerHTML = aviso(res.ignorados.length ? 'warn' : 'ok', partes.join(' '));
    } catch (err) {
      $('resultadoBancos').innerHTML = aviso('bad', esc(err.message || err));
    }
  });

  function importarBancos(filas, modo, actuales) {
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
    let actualizados = 0, nuevos = 0, lista;
    if (modo === 'reemplazar') {
      const vistos = new Map();
      leidos.forEach(b => vistos.set(b.codigo, b)); // si un código se repite, queda el último
      lista = [...vistos.values()];
    } else {
      lista = clonar(actuales);
      leidos.forEach(b => {
        const ex = lista.find(x => Number(x.codigo) === b.codigo);
        if (ex) { Object.assign(ex, b); actualizados++; } else { lista.push(b); nuevos++; }
      });
    }
    return { modo, lista, leidos: leidos.length, actualizados, nuevos, ignorados };
  }

  // ============================================================ BANCOS MELI

  function renderBancosMeli() {
    const lista = datos().bancosMeli || [];
    const q = M.normalizar($('mBuscar').value);
    const vis = lista.filter(b => !q || M.normalizar([b.cobis, b.nombre, b.cuit, b.numero].join(' ')).includes(q));
    const incompletos = lista.filter(b => b.sucursal == null || b.sucursal === '' || !/^\d{11}$/.test(String(b.cuit))).length;
    $('mResumen').textContent = `${lista.length} bancos · ${incompletos} incompletos`;
    if (!lista.length) { $('tablaBancosMeli').innerHTML = '<div class="vacio">La tabla está vacía. Cargá el Excel Banco MELI.</div>'; return; }
    $('tablaBancosMeli').innerHTML = `<table><thead><tr><th>Banco COBIS</th><th>Nombre</th><th>Pcia</th><th>CUIT</th><th class="num">MIS</th>
      <th class="num">Nº banco</th><th class="num">Cód. sucursal</th><th class="num">Prefijo crédito</th><th>Estado</th></tr></thead><tbody>${vis.map(b => {
        const ok = b.sucursal != null && b.sucursal !== '' && /^\d{11}$/.test(String(b.cuit)) && b.numero != null;
        return `<tr><td>${esc(b.cobis) || '<span class="chip gris">sin nombre COBIS</span>'}</td><td>${esc(b.nombre)}</td><td>${esc(b.pcia)}</td><td>${esc(b.cuit)}</td>
          <td class="num">${esc(b.mis)}</td><td class="num">${esc(b.numero)}</td><td class="num">${b.sucursal == null || b.sucursal === '' ? '#N/D' : esc(b.sucursal)}</td>
          <td class="num">${b.numero != null ? M.prefijoBanco(b.numero) : ''}</td><td>${ok ? '<span class="chip ok">OK</span>' : '<span class="chip warn">Incompleto</span>'}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
  $('mBuscar').addEventListener('input', renderBancosMeli);

  function importarBancosMeli(filas, modo, actuales) {
    const alias = {
      cobis: ['banco cobis', 'nombre cobis', 'cobis'], nombre: ['banco impuestos', 'nombre', 'nombre banco'], pcia: ['pcia', 'provincia'],
      cuit: ['cuit'], mis: ['mis'], numero: ['banco numero', 'numero banco', 'nro banco', 'n banco', 'numero'], sucursal: ['codigo sucursal', 'cod sucursal', 'sucursal'],
      jurisdiccion: ['jurisdiccion'],
    };
    let fila = -1, cols = {};
    for (let i = 0; i < Math.min(filas.length, 10) && fila < 0; i++) {
      const enc = (filas[i] || []).map(M.normalizar);
      const c = {};
      Object.entries(alias).forEach(([k, l]) => { const idx = enc.findIndex(h => l.includes(h)); if (idx > -1) c[k] = idx; });
      if (c.numero != null && c.cuit != null) { fila = i; cols = c; }
    }
    if (fila < 0) throw new Error('No se encontraron los encabezados "BANCO numero" y "CUIT" (formato Banco MELI).');
    // Código de sucursal: columna propia, o la columna sin título a la derecha de "Jurisdiccion" (como en Banco MELI), o la provincia.
    const colSuc = cols.sucursal != null ? cols.sucursal : cols.jurisdiccion != null ? cols.jurisdiccion + 1 : null;
    const leidos = [];
    filas.slice(fila + 1).forEach(r => {
      if (!r) return;
      const numero = M.aCodigoBanco(r[cols.numero]);
      if (numero == null) return;
      const pcia = cols.pcia != null && r[cols.pcia] != null ? String(r[cols.pcia]).trim() : '';
      let suc = colSuc != null ? M.aNumero(r[colSuc]) : null;
      if (suc == null) { const p = M.provinciaPorNombre(pcia); suc = p ? p.codigo : null; }
      const cuitCrudo = r[cols.cuit];
      leidos.push({ cobis: cols.cobis != null && r[cols.cobis] != null ? String(r[cols.cobis]).trim() : '', nombre: cols.nombre != null && r[cols.nombre] != null ? String(r[cols.nombre]).trim() : '',
        pcia, cuit: typeof cuitCrudo === 'number' ? String(Math.round(cuitCrudo)) : soloDigitos(cuitCrudo), mis: cols.mis != null ? r[cols.mis] : null,
        numero, sucursal: suc == null ? null : Math.round(suc) });
    });
    if (!leidos.length) throw new Error('El archivo no tiene filas de bancos.');
    let lista = [], actualizados = 0, nuevos = 0;
    if (modo === 'reemplazar') lista = leidos;
    else {
      lista = clonar(actuales);
      leidos.forEach(b => { const ex = lista.find(x => Number(x.numero) === b.numero); if (ex) { Object.assign(ex, b); actualizados++; } else { lista.push(b); nuevos++; } });
    }
    return { modo, lista, leidos: leidos.length, actualizados, nuevos };
  }

  $('btnCargarBancosMeli').addEventListener('click', () => $('archivoBancosMeli').click());
  $('archivoBancosMeli').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const hojas = await leerHojas(file);
      const res = importarBancosMeli(hojas[0].filas, $('mModo').value, datos().bancosMeli || []);
      if (!await intentar(() => almacen.guardarBancosMeli(res.lista))) return;
      $('resultadoBancosMeli').innerHTML = aviso('ok', `${res.leidos} bancos leídos. ` + (res.modo === 'reemplazar' ? `La tabla quedó con ${res.lista.length} bancos.` : `${res.actualizados} actualizados, ${res.nuevos} nuevos.`));
    } catch (err) {
      $('resultadoBancosMeli').innerHTML = aviso('bad', esc(err.message || err));
    }
  });
  $('btnDescargarBancosMeli').addEventListener('click', () => {
    const aoa = [['Banco COBIS', 'Banco Impuestos', 'Pcia', 'CUIT', 'MIS', 'BANCO numero', 'Codigo Sucursal']]
      .concat((datos().bancosMeli || []).map(b => [b.cobis, b.nombre, b.pcia, /^\d+$/.test(b.cuit) ? Number(b.cuit) : b.cuit, b.mis, Number(b.numero), b.sucursal == null ? '' : Number(b.sucursal)]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 32 }, { wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 13 }, { wch: 15 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bancos MELI');
    descargarLibro('Bancos_MELI.xlsx', wb);
  });

  // ============================================================ CARTERA (BI)

  const CLAVE_CARTERA = 'valo-cartera-config';
  let cartera = null; // { fuente, encabezados, datos, numericas }
  let carteraResultado = null;
  let carteraCfg = {};
  try { carteraCfg = JSON.parse(localStorage.getItem(CLAVE_CARTERA) || '{}') || {}; } catch (e) { carteraCfg = {}; }
  // En la base compartida la configuración es una sola para todos (maestros/carteraConfig); el periodo elegido es de cada uno.
  const cfgCompartible = c => { const { periodo, ...resto } = c; return JSON.stringify(resto); };
  let cfgRemota = null; // última configuración compartida conocida (JSON)
  let timerCfg = null;
  function guardarCfgCartera() {
    try { localStorage.setItem(CLAVE_CARTERA, JSON.stringify(carteraCfg)); } catch (e) { /* opcional */ }
    if (!almacen || typeof almacen.guardarCfgCartera !== 'function' || almacen.puedeEscribir === false) return;
    const json = cfgCompartible(carteraCfg);
    if (json === cfgRemota) return;
    clearTimeout(timerCfg);
    timerCfg = setTimeout(() => {
      if (json !== cfgCompartible(carteraCfg) || json === cfgRemota) return;
      cfgRemota = json;
      almacen.guardarCfgCartera(JSON.parse(json)).catch(() => { cfgRemota = null; });
    }, 800);
  }
  // Aplica la configuración compartida cuando llega o cambia (otro usuario la modificó).
  function aplicarCfgCompartida() {
    const remota = datos().carteraCfg;
    // Todavía no hay configuración compartida: se sube la de este navegador, si ya estaba armada.
    if (!remota) { if (almacen.modo === 'compartido' && carteraCfg.colTitular) guardarCfgCartera(); return; }
    const json = JSON.stringify(remota);
    if (json === cfgRemota) return;
    cfgRemota = json;
    if (json === cfgCompartible(carteraCfg)) return;
    carteraCfg = Object.assign(JSON.parse(json), { periodo: carteraCfg.periodo || '' });
    if (cartera) renderCartera(); else renderExtraccion();
  }
  // Ente: nombre del banco por el CUIT del titular (Bancos MELI primero, después Bancos).
  function mapaEntes() {
    // CUIT → { nombre, mis }: Bancos MELI manda; Bancos solo aporta el nombre (no tiene MIS).
    const m = new Map();
    (datos().bancos || []).forEach(b => { const c = soloDigitos(b.cuit); if (c && b.nombre) m.set(c, { nombre: b.nombre, mis: '' }); });
    (datos().bancosMeli || []).forEach(b => { const c = soloDigitos(b.cuit); if (c && (b.nombre || b.cobis)) m.set(c, { nombre: b.nombre || b.cobis, mis: b.mis == null ? '' : b.mis }); });
    return m;
  }
  const negociosClientes = () => datos().clientes.map(c => String(c.negocio).trim()).filter(Boolean);

  const zonaC = $('zonaCartera');
  zonaC.addEventListener('click', () => $('archivoCartera').click());
  zonaC.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('archivoCartera').click(); } });
  zonaC.addEventListener('dragover', e => { e.preventDefault(); zonaC.classList.add('encima'); });
  zonaC.addEventListener('dragleave', () => zonaC.classList.remove('encima'));
  zonaC.addEventListener('drop', e => { e.preventDefault(); zonaC.classList.remove('encima'); if (e.dataTransfer.files[0]) cargarCartera(e.dataTransfer.files[0]); });
  $('archivoCartera').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) cargarCartera(f); });

  async function cargarCartera(file) {
    try {
      $('carteraEstado').innerHTML = aviso('ok', 'Leyendo ' + esc(file.name) + '…');
      const hojas = await leerHojas(file);
      const hoja = hojas.find(h => { try { M.leerCartera(h.filas); return true; } catch (e) { return false; } });
      if (!hoja) throw new Error('El archivo no tiene las columnas del reporte (por ejemplo "ficuo doc titular" y "Estado Cuota").');
      usarDatosCartera(file.name, M.leerCartera(hoja.filas));
    } catch (err) {
      $('carteraEstado').innerHTML = aviso('bad', esc(err.message || err));
    }
  }

  function usarDatosCartera(fuente, leido) {
    cartera = Object.assign({ fuente, colCantidad: '' }, leido, { numericas: M.columnasNumericasCartera(leido.encabezados, leido.datos).filter(c => c !== leido.colCantidad && !(leido.noSumar || []).includes(c)) });
    const enc = cartera.encabezados;
    const elegir = (clave, tipo) => (carteraCfg[clave] && enc.includes(carteraCfg[clave]) ? carteraCfg[clave] : M.sugerirColumnaCartera(tipo, enc));
    carteraCfg.colTitular = elegir('colTitular', 'titular');
    carteraCfg.colTipoDoc = elegir('colTipoDoc', 'tipoDoc');
    carteraCfg.colNegocio = elegir('colNegocio', 'negocio');
    carteraCfg.colCredito = elegir('colCredito', 'credito');
    carteraCfg.colEstado = elegir('colEstado', 'estado');
    carteraCfg.colPeriodo = elegir('colPeriodo', 'periodo');
    carteraCfg.colCapital = elegir('colCapital', 'capital');
    carteraCfg.colIntDto = elegir('colIntDto', 'intDto');
    carteraCfg.colIntDev = elegir('colIntDev', 'intDev');
    // Vista por defecto: titular, ente y el valor calculado; los demás importes son opcionales.
    // Desde la vista 3 el valor a descuento parte de FICUO SALDO CAPITAL (antes FICUO CAPITAL).
    if (!(carteraCfg.vista >= 3)) {
      if (carteraCfg.vista !== 2) carteraCfg.sumar = [];
      carteraCfg.colCapital = M.sugerirColumnaCartera('capital', enc);
      carteraCfg.vista = 3;
    }
    if (!Array.isArray(carteraCfg.sumar)) carteraCfg.sumar = [];
    carteraCfg.periodo = '';
    $('carteraEstado').innerHTML = aviso('ok', `${esc(fuente)}: ${fmtEntero(cartera.datos.length)} filas, ${enc.length} columnas.`);
    $('cardCarteraConfig').classList.remove('oculto');
    $('cardCarteraResultado').classList.remove('oculto');
    renderCartera();
  }

  function opcionesColumna(sel, valor, vacia) {
    sel.innerHTML = (vacia ? '<option value="">—</option>' : '') + cartera.encabezados.map(h => `<option ${h === valor ? 'selected' : ''}>${esc(h)}</option>`).join('');
  }

  function renderCartera() {
    if (!cartera) return;
    const cfg = carteraCfg;
    opcionesColumna($('kTitular'), cfg.colTitular);
    opcionesColumna($('kTipoDoc'), cfg.colTipoDoc, true);
    opcionesColumna($('kNegocio'), cfg.colNegocio, true);
    opcionesColumna($('kCredito'), cfg.colCredito, true);
    opcionesColumna($('kEstado'), cfg.colEstado, true);
    opcionesColumna($('kPeriodoCol'), cfg.colPeriodo, true);
    opcionesColumna($('kCapital'), cfg.colCapital, true);
    opcionesColumna($('kIntDto'), cfg.colIntDto, true);
    opcionesColumna($('kIntDev'), cfg.colIntDev, true);
    const negocios = negociosClientes();
    $('carteraFuente').textContent = `Fuente: ${cartera.fuente} · Negocios de Clientes: ${negocios.join(', ') || '(ninguno)'}`;
    // Negocio: cuántas filas coinciden con los negocios de Clientes.
    if (cfg.colNegocio) {
      const vals = M.valoresDistintos(cartera.datos, cfg.colNegocio);
      const coinciden = vals.filter(v => negocios.some(n => n === v.valor || (!isNaN(Number(n)) && Number(n) === Number(v.valor))));
      $('kNegocioAyuda').textContent = coinciden.length ? `Coinciden: ${coinciden.map(v => v.valor).join(', ')}` : `Ningún valor coincide con Clientes (hay: ${vals.slice(0, 6).map(v => v.valor).join(', ')}${vals.length > 6 ? '…' : ''})`;
    } else $('kNegocioAyuda').textContent = 'Sin columna de negocio no se filtra por Clientes.';
    // Periodo: por defecto el más reciente.
    const periodos = cfg.colPeriodo ? M.valoresDistintos(cartera.datos, cfg.colPeriodo).filter(v => v.valor !== '') : [];
    if (cfg.periodo === '' && periodos.length) cfg.periodo = periodos[periodos.length - 1].valor;
    $('kPeriodo').innerHTML = '<option value="">Todos</option>' + periodos.map(v => `<option value="${esc(v.valor)}" ${v.valor === String(cfg.periodo) ? 'selected' : ''}>${esc(v.valor)} (${fmtEntero(v.cantidad)})</option>`).join('');
    $('kPeriodo').disabled = !cfg.colPeriodo;
    // Estados: se marcan los pagos (por defecto, los que dicen PAG o CANCEL).
    const colDesc = M.sugerirColumnaCartera('estadoDesc', cartera.encabezados);
    const estados = cfg.colEstado ? M.valoresDistintos(cartera.datos, cfg.colEstado) : [];
    const desc = {};
    if (colDesc) cartera.datos.forEach(r => { const k = String(r[cfg.colEstado] ?? '').trim(); if (!(k in desc)) desc[k] = String(r[colDesc] ?? '').trim(); });
    if (!Array.isArray(cfg.estadosExcluidos)) cfg.estadosExcluidos = estados.filter(e => /pag|cancel/i.test(e.valor + ' ' + (desc[e.valor] || ''))).map(e => e.valor);
    $('kEstados').innerHTML = estados.length ? estados.map(e => `<label class="check"><input type="checkbox" data-estado="${esc(e.valor)}" ${cfg.estadosExcluidos.includes(e.valor) ? 'checked' : ''}>
      ${esc(e.valor || '(vacío)')}${desc[e.valor] ? ' · ' + esc(desc[e.valor]) : ''} <span class="sub" style="margin:0">(${fmtEntero(e.cantidad)})</span></label>`).join('') : '<span class="sub">Elegí la columna de estado.</span>';
    $('kSumar').innerHTML = cartera.numericas.map(c => `<label class="check"><input type="checkbox" data-sumar="${esc(c)}" ${cfg.sumar.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('') || '<span class="sub">No se encontraron columnas numéricas.</span>';
    calcularCartera();
  }

  function calcularCartera() {
    const cfg = carteraCfg;
    guardarCfgCartera();
    renderExtraccion();
    const negocios = negociosClientes();
    const sumar = cartera.numericas.filter(c => cfg.sumar.includes(c));
    const entes = mapaEntes();
    const res = M.agruparCartera(cartera.datos, Object.assign({}, cfg, { negocios, sumar,
      calc: { capital: cfg.colCapital, intDto: cfg.colIntDto, intDev: cfg.colIntDev }, colCantidad: cartera.colCantidad,
      ente: t => entes.get(soloDigitos(t)) || null }));
    carteraResultado = Object.assign(res, { sumar });
    let html = '';
    if (!cfg.estadosExcluidos.length) html += aviso('warn', 'No hay ningún estado marcado como pago: se están incluyendo todas las cuotas. Marcá qué códigos de "Estado de cuota" corresponden a cuota paga.');
    if (!cfg.colNegocio) html += aviso('warn', 'No elegiste la columna de Nº de negocio: no se filtra por los negocios de Clientes.');
    const faltanCalc = [[cfg.colCapital, 'Ficuo saldo capital'], [cfg.colIntDto, 'Ficuo saldo int. a dto.'], [cfg.colIntDev, 'Int. dev. a cobrar']].filter(x => !x[0]).map(x => x[1]);
    if (faltanCalc.length) html += aviso('warn', 'Para el Valor a descuento falta elegir la columna: ' + faltanCalc.join(', ') + ' (se toma como 0).');
    const sinEnte = res.grupos.filter(g => !g.ente).length;
    if (sinEnte) html += aviso('warn', `${sinEnte} titulares sin ente: su CUIT no está en Bancos MELI ni en Bancos.`);
    html += `<p class="sub">${fmtEntero(res.leidas)} filas leídas · ${fmtEntero(res.otrosPeriodos)} de otros periodos · ${fmtEntero(res.otrosNegocios)} de negocios que no están en Clientes · ${fmtEntero(res.pagas)} cuotas pagas excluidas · <b>${fmtEntero(res.usadas)} cuotas impagas</b></p>`;
    html += `<div class="kpis"><div class="kpi"><b>$ ${fmtMonto(res.calcTotales.valor)}</b><span>Valor a descuento</span></div>
      <div class="kpi"><b>${fmtEntero(res.grupos.length)}</b><span>titulares</span></div><div class="kpi"><b>${fmtEntero(res.usadas)}</b><span>cuotas impagas</span></div></div>`;
    $('carteraResumen').innerHTML = html;
    const LIMITE = 2000;
    const ct = res.calcTotales;
    $('tablaCartera').innerHTML = res.grupos.length ? `<table><thead><tr><th>Titular</th><th>Ente</th><th class="num">MIS</th>
      <th class="num">Cuotas impagas</th><th class="num">Ficuo saldo capital</th><th class="num">Saldo int. a dto.</th><th class="num">Int. dev. a cobrar</th>
      <th class="num">Valor a descuento</th>${sumar.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>
      <tr class="enc"><td>TOTAL (${fmtEntero(res.grupos.length)} titulares)</td><td></td><td></td><td class="num">${fmtEntero(res.usadas)}</td>
      <td class="num">${fmtMonto(ct.capital)}</td><td class="num">${fmtMonto(ct.intDto)}</td><td class="num">${fmtMonto(ct.intDev)}</td><td class="num"><b>${fmtMonto(ct.valor)}</b></td>
      ${sumar.map(c => `<td class="num">${fmtMonto(res.totales[c])}</td>`).join('')}</tr>
      ${res.grupos.slice(0, LIMITE).map(g => `<tr><td>${esc(g.titular)}</td><td>${g.ente ? esc(g.ente) : '<span class="chip warn">sin ente</span>'}</td><td class="num">${esc(g.mis)}</td>
        <td class="num">${fmtEntero(g.cuotas)}</td><td class="num">${fmtMonto(g.capital)}</td><td class="num">${fmtMonto(g.intDto)}</td><td class="num">${fmtMonto(g.intDev)}</td>
        <td class="num"><b>${fmtMonto(g.valor)}</b></td>${sumar.map(c => `<td class="num">${fmtMonto(g.sumas[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      + (res.grupos.length > LIMITE ? `<div class="vacio">Se muestran ${LIMITE} de ${fmtEntero(res.grupos.length)} titulares; el Excel trae todos.</div>` : '')
      : '<div class="vacio">No quedan cuotas con los filtros elegidos.</div>';
    try { infoNoCobis(); } catch (e) { $('noCobisInfo').innerHTML = aviso('bad', 'TXT NO COBIS: ' + esc(e.message || e)); $('btnNoCobis').disabled = true; }
  }

  [['kCapital', 'colCapital'], ['kIntDto', 'colIntDto'], ['kIntDev', 'colIntDev'], ['kTitular', 'colTitular'], ['kTipoDoc', 'colTipoDoc'], ['kNegocio', 'colNegocio'], ['kCredito', 'colCredito'], ['kEstado', 'colEstado'], ['kPeriodoCol', 'colPeriodo']]
    .forEach(([id, clave]) => $(id).addEventListener('change', () => {
      carteraCfg[clave] = $(id).value;
      if (clave === 'colEstado') carteraCfg.estadosExcluidos = null;
      if (clave === 'colPeriodo') carteraCfg.periodo = '';
      renderCartera();
    }));
  $('kPeriodo').addEventListener('change', () => { carteraCfg.periodo = $('kPeriodo').value; calcularCartera(); });
  $('kEstados').addEventListener('change', e => {
    const v = e.target.dataset.estado;
    if (v == null) return;
    const set = new Set(carteraCfg.estadosExcluidos || []);
    e.target.checked ? set.add(v) : set.delete(v);
    carteraCfg.estadosExcluidos = [...set];
    calcularCartera();
  });
  $('kSumar').addEventListener('change', e => {
    const v = e.target.dataset.sumar;
    if (v == null) return;
    const set = new Set(carteraCfg.sumar || []);
    e.target.checked ? set.add(v) : set.delete(v);
    carteraCfg.sumar = [...set];
    calcularCartera();
  });

  // --- extracción automática (favorito y tarea de Windows)
  const ENDPOINT_BI = 'https://bi-click-desa.apps.closdesa.bvsa.local/clickhouse/';
  function cfgExtraccion() {
    const c = carteraCfg;
    return {
      negocios: negociosClientes(),
      colNegocio: cartera && c.colNegocio ? c.colNegocio : '',
      estadosPagos: Array.isArray(c.estadosExcluidos) ? c.estadosExcluidos : [],
      importes: cartera && Array.isArray(c.sumar) ? c.sumar : [],
      calc: { capital: c.colCapital || 'ficuo saldo capital', intDto: c.colIntDto || '', intDev: c.colIntDev || '' },
      entes: [...mapaEntes().entries()].map(([cuit, e]) => [cuit, e.nombre, e.mis]),
      colTitular: c.colTitular, colTipoDoc: c.colTipoDoc, colCredito: c.colCredito, colEstado: c.colEstado,
    };
  }
  const rutaScript = () => $('extCarpeta').value.replace(/[\\/]+$/, '') + '\\cartera-bi.ps1';
  function renderExtraccion() {
    const cfg = cfgExtraccion();
    let html = `<p class="sub">Negocios: <b>${esc(cfg.negocios.join(', ') || '(ninguno)')}</b> · Columna de negocio: <b>${esc(cfg.colNegocio || 'Serie o Familia')}</b> · ` +
      `Estados pagos excluidos: <b>${esc(cfg.estadosPagos.join(', ') || 'ninguno')}</b> · Valor a descuento: <b>${cfg.calc.intDto && cfg.calc.intDev ? 'sí' : 'falta elegir columnas'}</b></p>`;
    if (!cfg.calc.intDto || !cfg.calc.intDev) html += aviso('warn', 'Para que el archivo automático traiga el Valor a descuento (saldo capital − int. a dto. + int. dev.), subí una vez un export y confirmá esas columnas en "Columnas y filtros".');
    if (!cfg.negocios.length) html += aviso('bad', 'No hay clientes con Nº de negocio: cargalos en Clientes.');
    if (!cfg.estadosPagos.length) html += aviso('warn', 'Todavía no se marcó qué estado de cuota es "paga": el archivo agrupado va a incluir todas las cuotas. Subí un export arriba, marcá el estado pago y volvé a descargar el favorito o el script.');
    $('extResumen').innerHTML = html;
    $('lnkBookmarklet').href = M.bookmarkletCartera(cfg);
    $('extComando').textContent = M.comandoTareaCartera(rutaScript(), $('extHora').value || '07:00');
  }
  async function copiar(texto, boton) {
    try { await navigator.clipboard.writeText(texto); toast('Copiado'); }
    catch (e) { await informar('Copiá el texto', `<textarea style="width:100%;height:160px" readonly>${esc(texto)}</textarea>`); }
  }
  $('lnkBookmarklet').addEventListener('click', e => { e.preventDefault(); toast('Arrastralo a la barra de favoritos; se usa desde la página del BI.'); });
  $('btnCopiarBookmarklet').addEventListener('click', () => copiar(M.bookmarkletCartera(cfgExtraccion())));
  $('btnCopiarComando').addEventListener('click', () => copiar($('extComando').textContent));
  $('btnCopiarScript').addEventListener('click', () => copiar(M.scriptPowerShellCartera(cfgExtraccion(), $('extCarpeta').value, ENDPOINT_BI)));
  $('btnDescargarScript').addEventListener('click', () => {
    const nombre = descargas ? 'cartera-bi.ps1.txt' : 'cartera-bi.ps1';
    $('extNotaScript').textContent = descargas ? 'Se descarga como .txt: renombralo a cartera-bi.ps1.' : '';
    descargar(nombre, '\ufeff' + M.scriptPowerShellCartera(cfgExtraccion(), $('extCarpeta').value, ENDPOINT_BI), true);
  });
  ['extCarpeta', 'extHora'].forEach(idc => $(idc).addEventListener('input', renderExtraccion));

  // Deja constancia en la base compartida (se ve en Historial) de lo generado en Cartera.
  function registrarCartera(accion, extra) {
    if (!carteraResultado || !almacen || typeof almacen.registrarCartera !== 'function' || almacen.puedeEscribir === false) return;
    const r = carteraResultado, ct = r.calcTotales || {};
    almacen.registrarCartera(Object.assign({ creado: new Date().toISOString(), accion, fuente: cartera ? cartera.fuente : '',
      periodo: carteraCfg.periodo || '', titulares: r.grupos.length, cuotas: r.usadas, valor: ct.valor || 0 }, extra || {})).catch(() => {});
  }
  $('btnCarteraExcel').addEventListener('click', () => {
    if (!carteraResultado) return;
    const r = carteraResultado;
    const enc = ['Titular', 'Ente', 'MIS', 'Cuotas impagas', 'Ficuo saldo capital', 'Saldo int a dto', 'Int dev a cobrar', 'Valor a descuento'].concat(r.sumar);
    const aoa = [enc].concat(r.grupos.map(g => [g.titular, g.ente, g.mis === '' || isNaN(Number(g.mis)) ? g.mis : Number(g.mis), g.cuotas, g.capital, g.intDto, g.intDev, g.valor].concat(r.sumar.map(c => g.sumas[c]))));
    const ct = r.calcTotales;
    aoa.push(['TOTAL', '', '', r.usadas, ct.capital, ct.intDto, ct.intDev, ct.valor].concat(r.sumar.map(c => r.totales[c])));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = enc.map(h => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cartera por titular');
    descargarLibro(`Cartera_por_titular_${carteraCfg.periodo || 'todos'}.xlsx`, wb);
    registrarCartera('Excel de cartera', { nombre: `Cartera_por_titular_${carteraCfg.periodo || 'todos'}.xlsx` });
  });

  // TXT NO COBIS: una línea por MIS con el valor a descuento; concesión hoy, vencimiento último día hábil del mes.
  function infoNoCobis() {
    if (!carteraResultado) return null;
    const t = M.txtNoCobis(carteraResultado.grupos, new Date(), [], datos().bancosMeli || []);
    const fd = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let html = `<p class="sub">TXT NO COBIS: <b>${fmtEntero(t.filas.length)} líneas</b> (todos los MIS de Bancos MELI; ${fmtEntero(t.conDatos)} con cartera, ${fmtEntero(t.filas.length - t.conDatos)} en 0) · total $ ${fmtMonto(t.total)} · ` +
      `concesión ${fd(t.fechas.concesion)} · vencimiento ${fd(t.fechas.vencimiento)} · archivo ${esc(t.nombre)}</p>`;
    if (t.sinMis.length) html += aviso('warn', `${t.sinMis.length} titulares sin MIS quedan fuera del TXT (cargá su CUIT en Bancos MELI): ${esc(t.sinMis.slice(0, 5).map(g => g.titular).join(', '))}${t.sinMis.length > 5 ? '…' : ''}`);
    if (t.negativos.length) html += aviso('warn', `MIS con valor a descuento negativo, van en 0: ${esc(t.negativos.join(', '))}`);
    if (t.bancosSinMis.length) html += aviso('warn', `${t.bancosSinMis.length} bancos de Bancos MELI no tienen MIS y no van al TXT: ${esc(t.bancosSinMis.slice(0, 5).map(b => b.nombre || b.cobis).join(', '))}${t.bancosSinMis.length > 5 ? '…' : ''}`);
    $('noCobisInfo').innerHTML = html;
    $('btnNoCobis').disabled = $('btnNoCobisApi').disabled = !t.filas.length;
    return t;
  }
  $('btnNoCobis').addEventListener('click', () => {
    try {
      const t = infoNoCobis();
      if (t && t.filas.length) { descargar(t.nombre, t.texto, true); registrarCartera('TXT NO COBIS', { nombre: t.nombre, txt: t.texto, lineas: t.filas.length, totalTxt: t.total }); }
    } catch (e) { informar('No se pudo generar el TXT NO COBIS', esc(e.message || e)); }
  });

  $('btnNoCobisApi').addEventListener('click', () => {
    try {
      const t = infoNoCobis();
      if (t && t.filas.length) { descargar(t.nombre.replace(/\.txt$/, '.json'), JSON.stringify(M.loteApiNoCobis(t), null, 1), true); registrarCartera('Lote para la API (JSON)', { nombre: t.nombre.replace(/\.txt$/, '.json'), lineas: t.filas.length, totalTxt: t.total }); }
    } catch (e) { informar('No se pudo generar el lote para la API', esc(e.message || e)); }
  });
  // Resultado por banco de un envío a la API (agente o Power Automate).
  function tablaResultadosApi(res) {
    if (!res || !res.length) return '';
    return `<div class="tabla-caja"><table><thead><tr><th>Cliente (MIS)</th><th>Banco</th><th class="num">Saldo capital</th><th>Canceladas</th><th>Operación</th><th>Resultado / avisos</th><th>Error</th></tr></thead><tbody>` +
      res.map(r => `<tr><td>${esc(r.cliente)}</td><td>${esc(r.banco || '')}</td><td class="num">${r.saldoCapital != null ? fmtMonto(Number(r.saldoCapital)) : ''}</td><td>${esc([].concat(r.canceladas || []).join(' '))}</td>` +
        `<td><b>${esc(r.operacion || '')}</b></td><td>${esc(r.resultado || '')}${r.avisos && [].concat(r.avisos).length ? ' · ' + esc([].concat(r.avisos).join(' | ')) : ''}</td>` +
        `<td>${r.error ? '<span class="chip bad">' + esc(typeof r.error === 'string' ? r.error : JSON.stringify(r.error)) + '</span>' : ''}</td></tr>`).join('') + '</tbody></table></div>';
  }
  function confirmarLoteApi(titulo, idCheck, boton) {
    let t;
    try { t = infoNoCobis(); } catch (e) { informar('No se pudo armar el lote', esc(e.message || e)); return null; }
    if (!t || !t.filas.length) { informar(titulo, 'No hay operaciones para enviar.'); return null; }
    const lote = M.loteApiNoCobis(t);
    const conSaldo = lote.operaciones.filter(o => o.saldoCapital > 0);
    return confirmar(titulo,
      `<p>Se envían <b>${lote.operaciones.length}</b> operaciones, igual que el TXT NO COBIS (${conSaldo.length} con cartera, ${lote.operaciones.length - conSaldo.length} en 0), por un total de <b>$ ${fmtMonto(lote.total)}</b>.<br>` +
      `Concesión ${esc(lote.fechaConcesion)} · vencimiento ${esc(lote.fechaVencimiento)} · tipo ${esc(M.NO_COBIS.tipoCredito)}.</p>` +
      `<label class="check"><input type="checkbox" id="${idCheck}"> Reemplazar: después de ingresar la nueva, cancelar las operaciones vigentes anteriores del mismo tipo de cada cliente (si el ingreso falla, no se cancela nada)</label>` +
      `<p class="sub">No se reintenta automáticamente: si algo falla, revisá el resultado antes de volver a enviar.</p>`, boton)
      .then(ok => ok ? { lote, conSaldo, reemplazar: !!(document.getElementById(idCheck) || {}).checked } : null);
  }

  // --- Cola de envíos: la página deja el lote pendiente y el agente de la red (nocobis-agente.ps1) lo ingresa.
  const ESTADOS_ENVIO = { pendiente: ['gris', 'Pendiente'], procesando: ['warn', 'Procesando'], terminado: ['ok', 'Terminado'], error: ['bad', 'Error'], cancelado: ['gris', 'Cancelado'] };
  const haceMin = iso => Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  function renderCola() {
    if (!almacen || almacen.proveedor !== 'supabase') return;
    const ag = datos().agenteNoCobis;
    const min = ag && ag.ultimaVez ? haceMin(ag.ultimaVez) : null;
    $('colaAgente').innerHTML = min == null ? ''
      : `<span class="chip ${min <= 15 ? 'ok' : 'warn'}">Agente ${min <= 15 ? 'activo' : 'sin señal'}</span> <span class="sub">última conexión hace ${min < 1 ? 'menos de 1' : fmtEntero(min)} min · PC ${esc(ag.agente || '')}</span>`;
    const lista = (datos().envios || []).filter(e => e.estado).slice(0, 10);
    $('colaLista').innerHTML = !lista.length ? '' : `<div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Usuario</th><th class="num">Operaciones</th><th class="num">Total</th><th>Estado</th><th>Resultado</th><th></th></tr></thead><tbody>` +
      lista.map(e => {
        const [cl, tx] = ESTADOS_ENVIO[e.estado] || ['gris', e.estado];
        const resu = e.estado === 'terminado' || e.estado === 'error'
          ? `${fmtEntero(e.ingresadas || 0)} ingresadas${e.conError ? `, <b>${fmtEntero(e.conError)} con error</b>` : ''}${e.error ? ' · ' + esc(e.error) : ''}`
          : e.estado === 'procesando' ? `en la PC ${esc(e.tomadoPor || '')}` : e.estado === 'pendiente' ? (e.error ? esc(e.error) : 'Esperando que se abra el archivo descargado') : '';
        return `<tr><td>${esc(new Date(e.creado).toLocaleString('es-AR'))}</td><td>${esc(quien(e.usuarioId) || '')}</td><td class="num">${fmtEntero(e.cantidad || 0)}</td>` +
          `<td class="num">${fmtMonto(Number(e.total || 0))}</td><td><span class="chip ${cl}">${tx}</span></td><td>${resu}</td>` +
          `<td>${(e.resultados || []).length ? `<button class="btn chico" type="button" data-envio-ver="${esc(e.id)}">Ver detalle</button>` : ''}` +
          `${e.estado === 'pendiente' && e.lote ? `<button class="btn chico" type="button" data-envio-bajar="${esc(e.id)}">Descargar de nuevo</button> ` : ''}` +
          `${e.estado === 'pendiente' ? `<button class="btn chico" type="button" data-envio-cancelar="${esc(e.id)}" data-escribe>Cancelar</button>` : ''}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }
  $('colaLista').addEventListener('click', async e => {
    const ver = e.target.dataset.envioVer, canc = e.target.dataset.envioCancelar, bajar = e.target.dataset.envioBajar;
    const env = (datos().envios || []).find(x => x.id === (ver || canc || bajar));
    if (!env) return;
    if (bajar) return bajarArchivoEnvio(env.id, env.lote, env.reemplazar).catch(err => informar('No se pudo descargar', esc(err.message || err)));
    if (ver) return informar(`Envío del ${new Date(env.creado).toLocaleString('es-AR')}`, tablaResultadosApi(env.resultados));
    if (canc && await confirmar('Cancelar envío', 'El envío pendiente no se va a ingresar. ¿Cancelarlo?', 'Cancelar envío', true)) {
      try { await almacen.actualizarEnvio(env.id, { estado: 'cancelado' }); } catch (err) { informar('No se pudo cancelar', esc(err.message || err)); }
    }
  });
  $('btnColaEnviar').addEventListener('click', async () => {
    const enCurso = (datos().envios || []).filter(e => e.estado === 'pendiente' || e.estado === 'procesando');
    if (enCurso.length && !await confirmar('Hay envíos en curso', `Ya hay ${enCurso.length} envío(s) pendiente(s) o en proceso. Si mandás otro con las mismas operaciones se van a ingresar dos veces. ¿Seguir igual?`, 'Seguir')) return;
    const r = await confirmarLoteApi('Enviar a la API NO COBIS', 'colaReemplazar', 'Enviar');
    if (!r) return;
    try {
      const id = await almacen.encolarEnvio({ destino: 'pc', reemplazar: r.reemplazar, lote: r.lote, total: r.lote.total, cantidad: r.lote.operaciones.length,
        fechaConcesion: r.lote.fechaConcesion, fechaVencimiento: r.lote.fechaVencimiento });
      await bajarArchivoEnvio(id, r.lote, r.reemplazar);
    } catch (e) { informar('No se pudo preparar el envío', esc(e.message || e)); }
  });
  // Archivo de un solo paso (.cmd): doble clic con la PC en la red de VALO / VPN. Informa el resultado en la página.
  async function bajarArchivoEnvio(id, lote, reemplazar) {
    const cfg = window.VALO_SUPABASE || {};
    const token = almacen.tokenSesion ? await almacen.tokenSesion() : '';
    const d = new Date(), dos = n => String(n).padStart(2, '0');
    const nombre = `Enviar-NOCOBIS-${dos(d.getDate())}${dos(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}-${dos(d.getHours())}${dos(d.getMinutes())}.cmd`;
    await descargar(nombre, M.cmdEnvioNoCobis({ lote: Object.assign({}, lote, { reemplazar: !!reemplazar }), envioPath: 'envios/' + id,
      supabaseUrl: cfg.url, supabaseKey: cfg.anonKey, token }), true);
    informar('Abrí el archivo descargado', `<p>Se descargó <b>${esc(nombre)}</b>. Con la PC conectada a la <b>red de VALO o a la VPN</b>, abrilo con doble clic (si Windows pregunta, elegí <i>Más información → Ejecutar de todas formas</i>).</p>` +
      '<p>Hace el login, ingresa las operaciones y deja el resultado en esta pantalla. Usalo dentro de la hora; si vence, tocá <b>Descargar de nuevo</b> en la lista.</p>');
  }
  const rutaAgente = () => $('agenteCarpeta').value.replace(/[\\/]+$/, '') + '\\nocobis-agente.ps1';
  const comandoAgente = () => `schtasks /Create /F /SC MINUTE /MO 5 /TN "VALO Agente NOCOBIS" /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"${rutaAgente()}\\""`;
  function renderAgente() { $('agenteComando').textContent = comandoAgente(); }
  $('agenteCarpeta').addEventListener('input', renderAgente);
  $('btnAgenteCopiar').addEventListener('click', () => copiar(comandoAgente()));
  $('btnAgenteDescargar').addEventListener('click', () => {
    const cfg = window.VALO_SUPABASE || {};
    descargar('nocobis-agente.ps1', '\ufeff' + M.scriptPowerShellAgenteNoCobis({ supabaseUrl: cfg.url, supabaseKey: cfg.anonKey }), true);
  });

  // --- Envío directo por Power Automate (flujo con gateway hacia la API NO COBIS)
  function flujoDisponible() { return almacen && (almacen.modo === 'local' || almacen.proveedor === 'supabase'); }
  let editandoFlujo = false;
  function cargarFlujo() {
    const f = datos().nocobisFlujo || {};
    if (document.activeElement !== $('flujoUrl')) $('flujoUrl').value = f.url || '';
    if (document.activeElement !== $('flujoClave')) $('flujoClave').value = f.clave || '';
    // Con la conexión ya guardada no se piden los datos: solo se muestran al tocar "Cambiar".
    const listo = !!(f.url && f.clave);
    $('flujoListo').classList.toggle('oculto', !listo || editandoFlujo);
    $('flujoCampos').classList.toggle('oculto', listo && !editandoFlujo);
  }
  $('lnkFlujoCambiar').addEventListener('click', e => { e.preventDefault(); editandoFlujo = true; cargarFlujo(); });
  async function llamarFlujo(cuerpo, conexion) {
    const url = conexion ? conexion.url : $('flujoUrl').value.trim();
    const clave = conexion ? conexion.clave : $('flujoClave').value;
    if (!/^https:\/\//i.test(url || '')) throw new Error('Falta la dirección del flujo (HTTP POST URL de Power Automate).');
    if (!clave) throw new Error('Falta la clave compartida con el flujo (la misma de la variable ClaveCompartida del flujo).');
    const ctl = new AbortController();
    const reloj = setTimeout(() => ctl.abort(), 180000);
    let r;
    try {
      // text/plain evita el pedido previo de CORS; el flujo lo interpreta con json(triggerBody()).
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(Object.assign({ clave }, cuerpo)), signal: ctl.signal });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'El flujo no respondió en 3 minutos: revisá el historial de ejecuciones en Power Automate antes de volver a enviar.'
        : 'No se pudo llamar al flujo (' + (e.message || e) + '). Revisá la dirección y que el flujo tenga la respuesta con Access-Control-Allow-Origin.');
    } finally { clearTimeout(reloj); }
    const texto = await r.text();
    let j = null;
    try { j = JSON.parse(texto); } catch (e) { /* respuesta no JSON */ }
    if (r.status === 401 && /OAuth authorization scheme|authentication scheme/i.test(texto))
      throw new Error('Power Automate rechazó el pedido: el disparador del flujo exige iniciar sesión con Microsoft. En el flujo, disparador "Cuando se recibe una solicitud HTTP" → "Quién puede desencadenar el flujo" = Cualquiera; guardá y copiá la HTTP URL nueva (termina en &sig=…).');
    if ((r.status === 502 || r.status === 504) && !(j && j.mensaje))
      throw new Error(`El flujo se ejecutó pero no devolvió respuesta (HTTP ${r.status}): falló una acción antes de la Respuesta o tardó más de 2 minutos. En Power Automate abrí el flujo → Historial de ejecuciones → la ejecución con error, y fijate qué acción quedó en rojo (ver powerautomate/INSTRUCCIONES.md, punto 2.5).`);
    if (!r.ok && !(j && j.resultados)) throw new Error(`El flujo respondió HTTP ${r.status}: ${(j && (j.mensaje || j.error && (j.error.message || j.error))) || texto.slice(0, 300)}`);
    if (!j) throw new Error('El flujo respondió algo que no es JSON: ' + texto.slice(0, 300));
    return j;
  }
  $('btnFlujoGuardar').addEventListener('click', async () => {
    try {
      await almacen.guardarNocobisFlujo(Object.assign({}, datos().nocobisFlujo, { url: $('flujoUrl').value.trim(), clave: $('flujoClave').value }));
      editandoFlujo = false;
      cargarFlujo();
      toast('Conexión guardada para todos los usuarios');
    } catch (e) { informar('No se pudo guardar', esc(e.message || e)); }
  });
  $('btnFlujoProbar').addEventListener('click', async () => {
    const b = $('btnFlujoProbar');
    b.disabled = true;
    $('flujoResultado').innerHTML = '<p class="sub">Probando el flujo…</p>';
    try {
      const j = await llamarFlujo({ accion: 'probar' });
      const cat = Array.isArray(j.catalogo) ? j.catalogo : [];
      const tipo = M.NO_COBIS.tipoCredito;
      const hay = cat.some(c => c.tipoCredito === tipo);
      $('flujoResultado').innerHTML = (j.ok === false ? aviso('bad', esc(j.mensaje || 'El flujo informó un error.'))
        : aviso(hay || !cat.length ? 'ok' : 'warn', cat.length ? `Flujo OK: token y API responden. Catálogo con ${cat.length} tipos; ${hay ? `incluye ${tipo}` : `<b>no incluye ${tipo}</b>`}. No se envió ningún dato.`
          : esc(j.mensaje || 'Flujo OK. No se envió ningún dato.')))
        + (cat.length ? '<p class="sub">' + cat.map(c => `${esc(c.tipoCredito)} (${esc(c.descripcion || '')})`).join(' · ') + '</p>' : '');
    } catch (e) { $('flujoResultado').innerHTML = aviso('bad', esc(e.message || e)); }
    b.disabled = false;
  });
  $('btnFlujoEnviar').addEventListener('click', async () => {
    const b = $('btnFlujoEnviar');
    const conf = await confirmarLoteApi('Enviar por Power Automate', 'flujoReemplazar', 'Enviar');
    if (!conf) return;
    const { lote, conSaldo, reemplazar } = conf;
    b.disabled = true;
    $('flujoResultado').innerHTML = '<p class="sub">Enviando al flujo… (puede tardar un par de minutos)</p>';
    let j = null, error = null;
    try { j = await llamarFlujo({ accion: 'enviar', reemplazar, lote }); } catch (e) { error = e.message || String(e); }
    const res = j && Array.isArray(j.resultados) ? j.resultados : [];
    const conError = res.filter(r => r.error).length, ingresadas = res.filter(r => r.operacion).length;
    try {
      await almacen.registrarEnvio({ fecha: new Date().toISOString(), destino: 'Power Automate', reemplazar, fechaConcesion: lote.fechaConcesion,
        fechaVencimiento: lote.fechaVencimiento, total: lote.total, cantidad: lote.operaciones.length, ingresadas, conError, error, resultados: res });
    } catch (e) { /* el registro es informativo */ }
    let html = error ? aviso('bad', esc(error))
      : aviso(conError ? 'warn' : 'ok', `${ingresadas} operaciones ingresadas${conError ? `, <b>${conError} con error</b>` : ''}.${j.mensaje ? ' ' + esc(j.mensaje) : ''}`);
    html += tablaResultadosApi(res);
    $('flujoResultado').innerHTML = html;
    b.disabled = false;
  });

  $('btnNoCobisProbar').addEventListener('click', () => {
    const nombre = descargas ? 'probar-api-nocobis.ps1.txt' : 'probar-api-nocobis.ps1';
    if (descargas) toast('Se descarga como .txt: renombralo a probar-api-nocobis.ps1');
    // Cliente de prueba: el primer MIS con cartera (o el primero de Bancos MELI).
    let cliente;
    try { const t = infoNoCobis(); const f = t && (t.filas.find(x => x.conDatos) || t.filas[0]); if (f) cliente = Number(f.mis); } catch (e) { /* se usa el de ejemplo */ }
    descargar(nombre, '\ufeff' + M.scriptPowerShellProbarNoCobis({ cliente }), true);
  });
  $('btnNoCobisScript').addEventListener('click', () => {
    // claude.ai no permite descargar .ps1: ahí baja como .txt y hay que renombrarlo.
    const nombre = descargas ? 'nocobis-api.ps1.txt' : 'nocobis-api.ps1';
    if (descargas) toast('Se descarga como .txt: renombralo a nocobis-api.ps1');
    descargar(nombre, '\ufeff' + M.scriptPowerShellNoCobis(), true);
  });

  // --- Cartera desde Power BI: flujo de Power Automate con "Ejecutar una consulta en un conjunto de datos"
  // (modelo ePortfolio_Mensual). La conexión (pbiUrl, pbiClave) se guarda junto con la del flujo NO COBIS.
  let editandoPbi = false;
  function cargarPbi() {
    const f = datos().nocobisFlujo || {};
    if (document.activeElement !== $('pbiUrl')) $('pbiUrl').value = f.pbiUrl || '';
    if (document.activeElement !== $('pbiClave')) $('pbiClave').value = f.pbiClave || '';
    const listo = !!(f.pbiUrl && f.pbiClave);
    $('pbiAuto').checked = f.pbiAuto !== false;
    $('pbiListo').classList.toggle('oculto', !listo || editandoPbi);
    $('pbiCampos').classList.toggle('oculto', listo && !editandoPbi);
    if (!listo && !editandoPbi) $('detPbi').open = true;
  }
  $('lnkPbiCambiar').addEventListener('click', e => { e.preventDefault(); editandoPbi = true; cargarPbi(); });
  $('btnPbiGuardar').addEventListener('click', async () => {
    try {
      await almacen.guardarNocobisFlujo(Object.assign({}, datos().nocobisFlujo, { pbiUrl: $('pbiUrl').value.trim(), pbiClave: $('pbiClave').value }));
      editandoPbi = false;
      cargarPbi();
      toast('Conexión con Power BI guardada para todos los usuarios');
    } catch (e) { informar('No se pudo guardar', esc(e.message || e)); }
  });
  $('btnPbiDax').addEventListener('click', () => {
    const dax = M.daxCarteraPowerBI({ periodo: $('pbiPeriodo').value, negocios: negociosClientes() });
    $('pbiDaxTexto').textContent = dax;
    $('pbiDaxTexto').classList.remove('oculto');
    if (navigator.clipboard) navigator.clipboard.writeText(dax).then(() => toast('Consulta DAX copiada'), () => {});
  });
  // Power BI por Supabase (pbi_consulta: API executeQueries con un service principal) si está configurado; si no, el flujo.
  let pbiSb = null;   // estado de la conexión por Supabase (pbi_estado)
  const hayPbiSb = () => !!(pbiSb && pbiSb.listo);
  async function estadoPbiSb() {
    if (!almacen || typeof almacen.rpc !== 'function') { pbiSb = null; $('pbiSbEstado').textContent = 'Disponible en la versión web (con la base compartida).'; return; }
    try { pbiSb = await almacen.rpc('pbi_estado', {}); } catch (e) { pbiSb = null; $('pbiSbEstado').innerHTML = aviso('warn', esc(e.message || e)); return; }
    const falta = ['tenant_id', 'client_id', 'group_id', 'dataset_id'].filter(k => !pbiSb[k]).concat(pbiSb.tiene_secret ? [] : ['client_secret']);
    $('pbiSbEstado').innerHTML = pbiSb.listo ? `<span class="chip ok">Configurada: se usa Supabase</span> client ${esc(pbiSb.client_id)}… · secret cargado`
      : `<span class="chip warn">Incompleta</span> falta: ${esc(falta.join(', '))}. Mientras tanto se usa el flujo de Power Automate.`;
    $('pbiModo').textContent = pbiSb.listo ? '· por Supabase' : '· por Power Automate';
  }
  async function consultarPbi(consulta) {
    if (pbiSb === null) await estadoPbiSb();
    if (hayPbiSb()) {
      const j = await almacen.rpc('pbi_consulta', { p_dax: consulta });
      if (!j || j.status !== 200) {
        const m = String((j && j.error) || '');
        throw new Error(`Power BI (por Supabase) respondió HTTP ${j ? j.status : '?'}: ` + (/PowerBINotAuthorizedException|Unauthorized|401|403/.test(m)
          ? 'la aplicación no tiene acceso al modelo (agregarla al área de trabajo y habilitar las API para service principals). ' : '') + m.slice(0, 300));
      }
      return j.rows;
    }
    const fl = datos().nocobisFlujo || {};
    const j = await llamarFlujo({ accion: 'consultar', consulta }, { url: $('pbiUrl').value.trim() || fl.pbiUrl || '', clave: $('pbiClave').value || fl.pbiClave || '' });
    if (j && j.ok === false) throw new Error(j.mensaje || 'El flujo informó un error.');
    return j;
  }
  $('detPbi').addEventListener('toggle', () => { if ($('detPbi').open) estadoPbiSb(); });
  $('btnPbiSbGuardar').addEventListener('click', async () => {
    try {
      pbiSb = await almacen.rpc('pbi_guardar', { p_tenant_id: $('pbiSbTenant').value, p_client_id: $('pbiSbId').value, p_client_secret: $('pbiSbSecret').value,
        p_group_id: $('pbiSbGroup').value, p_dataset_id: $('pbiSbDataset').value });
      ['pbiSbSecret', 'pbiSbId', 'pbiSbTenant', 'pbiSbGroup', 'pbiSbDataset'].forEach(id => { $(id).value = ''; });
      await estadoPbiSb();
      toast('Conexión con Power BI por Supabase guardada para todos los usuarios');
    } catch (e) { $('pbiSbEstado').innerHTML = aviso('bad', 'No se pudo guardar: ' + esc(e.message || e)); }
  });
  $('btnPbiSbProbar').addEventListener('click', async () => {
    $('pbiSbEstado').textContent = 'Probando…';
    try {
      await estadoPbiSb();
      if (!hayPbiSb()) return;
      const filas = M.leerFilasPowerBI(await consultarPbi('EVALUATE ROW("ok", 1)'));
      $('pbiSbEstado').innerHTML = aviso('ok', `Conexión OK: Power BI respondió por Supabase (${filas.datos.length} fila).`);
    } catch (e) { $('pbiSbEstado').innerHTML = aviso('bad', esc(e.message || e)); }
  });
  $('btnPbiDiag').addEventListener('click', async () => {
    const b = $('btnPbiDiag');
    b.disabled = true;
    $('pbiDiag').innerHTML = '<p class="sub">Consultando Power BI…</p>';
    const tabla = (titulo, filas) => {
      const enc = filas.encabezados;
      return `<h3>${esc(titulo)}</h3><div class="tabla-caja"><table><thead><tr>${enc.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
        filas.datos.map(r => `<tr>${enc.map(h => `<td>${esc(r[h] == null ? '' : r[h])}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
    };
    let html = '';
    const q = M.daxDiagnosticoPowerBI();
    for (const [titulo, consulta] of [['Tabla de cuotas: fideicomiso, periodo y fecha de corte', q.porTabla], ['Por la tabla Fideicomiso (relación del modelo)', q.porDimension]]) {
      try {
        html += tabla(titulo, M.leerFilasPowerBI(await consultarPbi(consulta)));
      } catch (e) { html += `<h3>${esc(titulo)}</h3>` + aviso('bad', esc(e.message || e)); }
      $('pbiDiag').innerHTML = html;
    }
    b.disabled = false;
  });
  // ------------------------------------------------------------ Saldo de deuda (Power BI, todos los negocios)
  let deuda = null, deudaAutoHecho = false;
  // Por defecto, vencidas hasta ayer: la cobranza de hoy todavía no está bajada en la cartera.
  const ayerIso = () => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const nombreMes = m => { const [a, n] = String(m).split('-'); return ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(n) - 1] + '-' + a; };
  async function alAbrirDeuda() {
    if (!$('deudaHasta').value) $('deudaHasta').value = ayerIso();
    if (deudaAutoHecho || deuda || !almacen) return;
    deudaAutoHecho = true;
    const f = datos().nocobisFlujo || {};
    if (pbiSb === null && typeof almacen.rpc === 'function') await estadoPbiSb();
    if (!(f.pbiUrl && f.pbiClave) && !hayPbiSb()) {
      $('deudaEstado').innerHTML = aviso('warn', 'Falta la conexión con Power BI: se configura en Cartera → Conexión con Power BI.');
      return;
    }
    traerDeuda();
  }
  async function traerDeuda() {
    const b = $('btnDeudaTraer');
    b.disabled = true;
    $('deudaEstado').innerHTML = '<p class="sub">Consultando Power BI…</p>';
    try {
      const hasta = $('deudaHasta').value || ayerIso();
      deuda = M.armarSaldoDeuda(await consultarPbi(M.daxSaldoDeuda({ hasta, periodo: $('deudaPeriodo').value })));
      renderDeuda();
      $('deudaEstado').innerHTML = deuda.filas.length ? '' : aviso('ok', $('deudaPeriodo').value && !deuda.periodo ? 'No hay foto de cartera para ese mes.' : 'No hay cuotas impagas vencidas hasta esa fecha.');
    } catch (e) {
      $('deudaEstado').innerHTML = aviso('bad', 'No se pudo traer el saldo de deuda: ' + esc(e.message || e) + ' (la conexión se configura en Cartera → Conexión con Power BI).');
    } finally { b.disabled = false; }
  }
  function renderDeuda() {
    const d = deuda;
    $('btnDeudaExcel').disabled = !(d && d.filas.length);
    if (!d || !d.filas.length) { $('deudaKpis').innerHTML = ''; $('deudaTabla').innerHTML = ''; return; }
    $('deudaKpis').innerHTML = [['Deuda total', '$ ' + fmtMonto(d.total)], ['Fiduciantes', fmtEntero(d.filas.length)], ['Cuotas', fmtEntero(d.cuotas)],
      ['Vencidas hasta', fechaAr(d.hasta)], ['Foto de cartera', fechaAr(d.periodo)]]
      .map(([t, v]) => `<div class="kpi"><div class="sub" style="margin:0">${esc(t)}</div><b>${esc(v)}</b></div>`).join('');
    $('deudaTabla').innerHTML = `<table><thead><tr><th>Fiduciante</th><th>CUIT</th>${d.meses.map(m => `<th class="num">${esc(nombreMes(m))}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>` +
      d.filas.map(f => `<tr><td>${esc(f.fiduciante)}</td><td>${esc(M.formatoCuit(f.cuit))}</td>${d.meses.map(m => `<td class="num">${f.porMes[m] ? fmtMonto(f.porMes[m]) : ''}</td>`).join('')}<td class="num"><b>${fmtMonto(f.total)}</b></td></tr>`).join('') +
      `</tbody><tfoot><tr><th colspan="2">Total</th>${d.meses.map(m => `<th class="num">${fmtMonto(d.totalesMes[m])}</th>`).join('')}<th class="num">${fmtMonto(d.total)}</th></tr></tfoot></table>`;
  }
  $('btnDeudaTraer').addEventListener('click', () => traerDeuda());
  $('btnDeudaExcel').addEventListener('click', async () => {
    try {
      const d = deuda;
      await cargarLibreria('exceljs');
      const wb = new window.ExcelJS.Workbook();
      wb.creator = 'VALO - EPORTFOLIO';
      const ws = wb.addWorksheet('Saldo de deuda');
      ws.addRow([`Saldo de deuda por fiduciante · cuotas impagas vencidas hasta ${fechaAr(d.hasta)} · foto de cartera ${fechaAr(d.periodo)}`]).font = { bold: true };
      ws.addRow([]);
      const enc = ws.addRow(['Fiduciante', 'CUIT', ...d.meses.map(nombreMes), 'Total']);
      enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      enc.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }; });
      d.filas.forEach(f => ws.addRow([f.fiduciante, M.formatoCuit(f.cuit), ...d.meses.map(m => f.porMes[m] || null), f.total]));
      const tot = ws.addRow(['Total', '', ...d.meses.map(m => d.totalesMes[m]), d.total]);
      tot.font = { bold: true };
      ws.getColumn(1).width = 48; ws.getColumn(2).width = 16;
      for (let k = 3; k <= d.meses.length + 3; k++) { ws.getColumn(k).width = 18; ws.getColumn(k).numFmt = '#,##0.00'; }
      // Apertura: cada mes en los días de vencimiento que tuvieron deuda, con su importe y el subtotal del mes.
      const wd = wb.addWorksheet('Apertura por día');
      wd.addRow(['Apertura por día de vencimiento']).font = { bold: true };
      wd.addRow([]);
      const e2 = wd.addRow(['Fiduciante', 'CUIT', 'Mes', 'Fecha de vencimiento', 'Importe']);
      e2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      e2.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } }; });
      d.filas.forEach(f => d.meses.forEach(m => {
        const dias = Object.keys(f.porDia).filter(x => x.slice(0, 7) === m).sort();
        if (!dias.length) return;
        dias.forEach(x => wd.addRow([f.fiduciante, M.formatoCuit(f.cuit), nombreMes(m), new Date(x + 'T00:00:00'), f.porDia[x]]));
        const st = wd.addRow([f.fiduciante, M.formatoCuit(f.cuit), nombreMes(m), 'Total del mes', f.porMes[m]]);
        st.font = { bold: true };
      }));
      wd.addRow(['Total', '', '', '', d.total]).font = { bold: true };
      wd.getColumn(1).width = 48; wd.getColumn(2).width = 16; wd.getColumn(3).width = 12; wd.getColumn(4).width = 20; wd.getColumn(5).width = 18;
      wd.getColumn(4).numFmt = 'dd/mm/yyyy'; wd.getColumn(5).numFmt = '#,##0.00';
      const buf = await wb.xlsx.writeBuffer();
      await descargar(`Saldo_de_deuda_${d.hasta}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), true);
    } catch (e) { informar('No se pudo exportar', esc(e.message || e)); }
  });

  // Al abrir Cartera se trae sola la cartera de Power BI (una vez por sesión), si la conexión está configurada.
  let pbiAutoHecho = false;
  async function alAbrirCartera() {
    if (pbiAutoHecho || cartera || !almacen || !flujoDisponible()) return;
    const f = datos().nocobisFlujo || {};
    if (f.pbiAuto === false) return;
    if (pbiSb === null && typeof almacen.rpc === 'function') await estadoPbiSb();
    if (!hayPbiSb() && (!f.pbiUrl || !f.pbiClave)) return;
    if (pbiAutoHecho) return;
    pbiAutoHecho = true;
    cargarPbi();
    $('btnPbiTraer').click();
  }
  $('pbiAuto').addEventListener('change', async e => {
    try {
      await almacen.guardarNocobisFlujo(Object.assign({}, datos().nocobisFlujo, { pbiAuto: e.target.checked }));
      toast(e.target.checked ? 'La cartera se va a traer sola al abrir Cartera' : 'La cartera se trae solo con el botón');
    } catch (err) { informar('No se pudo guardar', esc(err.message || err)); }
  });
  $('btnPbiTraer').addEventListener('click', async () => {
    const b = $('btnPbiTraer');
    b.disabled = true;
    $('carteraEstado').innerHTML = aviso('ok', 'Consultando Power BI (ePortfolio_Mensual)…');
    try {
      const periodo = $('pbiPeriodo').value.trim();
      const leido = M.leerFilasPowerBI(await consultarPbi(M.daxCarteraPowerBI({ periodo, negocios: negociosClientes() })));
      if (leido.datos.length >= 30000) toast('Power BI devolvió muchas filas: si falta algún negocio, la respuesta puede haber llegado cortada (límite de 15 MB).');
      if (!leido.datos.length) throw new Error('Power BI no devolvió filas' + (periodo ? ` para el periodo ${periodo}` : '') + '.');
      const per = [...new Set(leido.datos.map(r => r.Periodo))].join(', ');
      // Los códigos de estado de Power BI no son los del export del BI: los pagos se marcan por su descripción ("Paga").
      carteraCfg.colEstado = 'Estado Cuota';
      carteraCfg.estadosExcluidos = null;
      usarDatosCartera(`Power BI ePortfolio_Mensual (mes ${per})`, leido);
      // Negocio: la columna (Serie o FideicomisoId) que coincida con los negocios de Clientes.
      const negocios = negociosClientes();
      const coincide = col => col && M.valoresDistintos(cartera.datos, col)
        .some(v => negocios.some(n => n === v.valor || (!isNaN(Number(n)) && Number(n) === Number(v.valor))));
      if (!coincide(carteraCfg.colNegocio)) {
        const otra = ['FideicomisoId', 'Negocio'].find(col => cartera.encabezados.includes(col) && coincide(col));
        carteraCfg.colNegocio = otra || '';
        renderCartera();
      }
      if (!carteraCfg.colNegocio) {
        $('carteraEstado').innerHTML += aviso('warn', 'Ni la <b>Serie</b> ni el <b>FideicomisoId</b> de Power BI coinciden con ningún negocio de Clientes: se muestran todos los fideicomisos. Si corresponde filtrar, elegí la columna Negocio en la configuración.');
      }
    } catch (e) {
      $('carteraEstado').innerHTML = aviso('bad', 'No se pudo traer la cartera de Power BI: ' + esc(e.message || e));
    }
    b.disabled = false;
  });

  // Consulta directa al BI (ClickHouse). Funciona solo desde la red de VALO y si el BI acepta pedidos de esta página.
  $('btnConsultarBI').addEventListener('click', async () => {
    const negocios = negociosClientes();
    const endpoint = $('carteraEndpoint').value.trim();
    const colNegocio = carteraCfg.colNegocio || 'Serie';
    const datosBI = [];
    try {
      $('carteraEstado').innerHTML = aviso('ok', 'Consultando el BI…');
      for (let desde = 0; ; desde += 5000) {
        const u = new URL(endpoint);
        u.searchParams.set('database', 'BI_CLIC');
        const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: M.sqlCartera('CreditoCarteraEspejoDetalleHistorico', colNegocio, negocios, '', 5000, desde) });
        if (!r.ok) throw new Error(await r.text());
        const lote = (await r.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
        datosBI.push(...lote);
        $('carteraEstado').innerHTML = aviso('ok', `Consultando el BI… ${fmtEntero(datosBI.length)} filas`);
        if (lote.length < 5000) break;
      }
      const encabezados = datosBI.length ? Object.keys(datosBI[0]) : [];
      usarDatosCartera(`BI directo (negocios ${negocios.join(', ')} por columna ${colNegocio})`, { encabezados, datos: datosBI });
    } catch (err) {
      $('carteraEstado').innerHTML = aviso('bad', 'No se pudo consultar el BI desde esta página (' + esc(err.message || err) + '). ' +
        'El BI solo responde dentro de la red de VALO y puede no aceptar pedidos de otras páginas. Exportá el reporte a CSV o Excel desde el BI y cargalo acá.');
    }
  });

  // ============================================================ INVENTARIO DE GARANTÍAS
  // Reportes de garantías (.lis) unidos en una tabla, con filtro preferida / no preferida y exportación a Excel.
  // Los archivos quedan solo en esta sesión del navegador.
  const inventario = []; // { nombre, leido }
  const zonaI = $('zonaInventario');
  zonaI.addEventListener('click', () => $('archivoInventario').click());
  zonaI.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('archivoInventario').click(); } });
  zonaI.addEventListener('dragover', e => { e.preventDefault(); zonaI.classList.add('encima'); });
  zonaI.addEventListener('dragleave', () => zonaI.classList.remove('encima'));
  zonaI.addEventListener('drop', e => { e.preventDefault(); zonaI.classList.remove('encima'); cargarInventario([...e.dataTransfer.files]); });
  $('archivoInventario').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; cargarInventario(f); });

  async function cargarInventario(files) {
    const errores = [];
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        // Los reportes vienen en UTF-8; si no, en Windows-1252 (Ñ y acentos).
        let texto = new TextDecoder('utf-8').decode(buf);
        if (texto.includes('\ufffd')) texto = new TextDecoder('windows-1252').decode(buf);
        const leido = M.leerInventarioGarantias(texto, f.name);
        const i = inventario.findIndex(x => x.nombre === f.name);
        if (i > -1) inventario.splice(i, 1, { nombre: f.name, leido }); else inventario.push({ nombre: f.name, leido });
      } catch (e) { errores.push(esc(e.message || e)); }
    }
    renderInventario(errores);
  }

  const filasInventario = () => inventario.flatMap(x => x.leido.filas);
  function filasInventarioFiltradas() {
    const pref = $('invPref').value, mon = $('invMoneda').value, ori = $('invOrigen').value, q = M.normalizar($('invBuscar').value);
    return filasInventario().filter(f => (!pref || (pref === 'S') === f.preferida) && (!mon || f.monedaDesc === mon) && (!ori || f.origen === ori)
      && (!q || M.normalizar([f.descripcion, f.cliente, f.tipo, f.codigo].join(' ')).includes(q)));
  }

  function renderInventario(errores = []) {
    let html = errores.map(e => aviso('bad', e)).join('');
    html += inventario.map((x, i) => {
      const l = x.leido, malos = l.controles.filter(c => !c.ok);
      return `<p class="sub" style="margin:6px 0"><b>${esc(x.nombre)}</b> · ${esc(l.origen)} · al ${esc(l.fecha)} · ${fmtEntero(l.filas.length)} garantías · ` +
        (l.controles.length ? (malos.length ? `<span class="chip bad">${malos.length} subtotales no coinciden</span>` : `<span class="chip ok">subtotales del reporte OK</span>`) : '') +
        ` <a href="#" data-quitar-inv="${i}">Quitar</a></p>`;
    }).join('');
    $('inventarioArchivos').innerHTML = html;
    const todas = filasInventario();
    $('cardInventario').classList.toggle('oculto', !todas.length);
    if (!todas.length) { renderInvContable(); return; }
    const opciones = (sel, vals, todas) => { const v = sel.value; sel.innerHTML = `<option value="">${todas}</option>` + vals.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join(''); };
    opciones($('invMoneda'), [...new Set(todas.map(f => f.monedaDesc))], 'Todas');
    opciones($('invOrigen'), [...new Set(todas.map(f => f.origen))], 'Todos');
    renderTablaInventario();
    renderInvContable();
  }
  $('inventarioArchivos').addEventListener('click', e => {
    const a = e.target.closest('[data-quitar-inv]');
    if (!a) return;
    e.preventDefault();
    inventario.splice(Number(a.dataset.quitarInv), 1);
    renderInventario();
  });
  ['invPref', 'invMoneda', 'invOrigen'].forEach(id => $(id).addEventListener('change', renderTablaInventario));
  $('invBuscar').addEventListener('input', renderTablaInventario);

  // Resumen: preferida / no preferida por moneda (montos en pesos y en moneda de origen).
  function resumenInventario(filas) {
    const m = new Map();
    filas.forEach(f => {
      const k = (f.preferida ? 'Preferida' : 'No preferida') + '|' + f.monedaDesc;
      if (!m.has(k)) m.set(k, { pref: f.preferida ? 'Preferida' : 'No preferida', moneda: f.monedaDesc, cantidad: 0, pesos: 0, origen: 0 });
      const r = m.get(k); r.cantidad++; r.pesos += f.montoPesos; r.origen += f.montoOrigen;
    });
    return [...m.values()].sort((a, b) => (a.pref === b.pref ? a.moneda.localeCompare(b.moneda) : a.pref === 'Preferida' ? -1 : 1));
  }

  function renderTablaInventario() {
    const filas = filasInventarioFiltradas();
    const res = resumenInventario(filas);
    const tot = filas.reduce((a, f) => a + f.montoPesos, 0);
    $('inventarioResumen').innerHTML = `<div class="tabla-caja"><table><thead><tr><th>Preferida</th><th>Moneda</th><th class="num">Garantías</th><th class="num">Monto pesos</th><th class="num">Monto moneda orig.</th></tr></thead><tbody>` +
      res.map(r => `<tr><td>${r.pref === 'Preferida' ? '<span class="chip ok">Preferida</span>' : '<span class="chip gris">No preferida</span>'}</td><td>${esc(r.moneda)}</td><td class="num">${fmtEntero(r.cantidad)}</td><td class="num">${fmtMonto(r.pesos)}</td><td class="num">${fmtMonto(r.origen)}</td></tr>`).join('') +
      `<tr class="total"><td colspan="2"><b>TOTAL</b></td><td class="num"><b>${fmtEntero(filas.length)}</b></td><td class="num"><b>${fmtMonto(tot)}</b></td><td></td></tr></tbody></table></div>`;
    const max = 1000;
    $('tablaInventario').innerHTML = `<table><thead><tr><th>Preferida</th><th>Origen</th><th>Moneda</th><th>Tipo garantía</th><th>Código garantía</th><th>Cliente</th><th>Descripción cliente</th><th>Ab./Cerr.</th><th class="num">Monto pesos</th><th class="num">Monto moneda orig.</th></tr></thead><tbody>` +
      filas.slice(0, max).map(f => `<tr><td>${f.preferida ? 'Preferida' : 'No preferida'}</td><td>${esc(f.origen)}</td><td>${esc(f.monedaDesc)}</td><td>${esc(f.tipo)}</td><td>${esc(f.codigo)}</td><td>${esc(f.cliente)}</td><td>${esc(f.descripcion)}</td><td>${esc(f.abiertaCerrada)}</td><td class="num">${fmtMonto(f.montoPesos)}</td><td class="num">${fmtMonto(f.montoOrigen)}</td></tr>`).join('') +
      '</tbody></table>' + (filas.length > max ? `<p class="sub">Se muestran ${fmtEntero(max)} de ${fmtEntero(filas.length)} filas; el Excel trae todas.</p>` : '');
  }

  $('btnInvExcel').addEventListener('click', () => {
    const filas = filasInventarioFiltradas();
    if (!filas.length) return;
    const enc = ['Preferida', 'Origen', 'Fecha', 'Moneda', 'Cód. moneda', 'Tipo garantía', 'Código garantía', 'Cliente', 'Descripción cliente', 'Abierta/Cerrada', 'Monto pesos', 'Monto moneda orig.', 'Archivo'];
    const aoa = [enc].concat(filas.map(f => [f.preferida ? 'Preferida' : 'No preferida', f.origen, f.fecha, f.monedaDesc, f.moneda, f.tipo, f.codigo,
      /^\d+$/.test(f.cliente) ? Number(f.cliente) : f.cliente, f.descripcion, f.abiertaCerrada, f.montoPesos, f.montoOrigen, f.archivo]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [14, 22, 12, 14, 8, 24, 28, 10, 34, 10, 18, 18, 30].map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: enc.length - 1 } }) };
    const res = resumenInventario(filas);
    const ws2 = XLSX.utils.aoa_to_sheet([['Preferida', 'Moneda', 'Garantías', 'Monto pesos', 'Monto moneda orig.']]
      .concat(res.map(r => [r.pref, r.moneda, r.cantidad, M.round2(r.pesos), M.round2(r.origen)]))
      .concat([['TOTAL', '', filas.length, M.round2(filas.reduce((a, f) => a + f.montoPesos, 0)), '']]));
    ws2['!cols'] = [14, 14, 10, 20, 20].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');
    const fecha = (filas[0].fecha || '').replace(/\//g, '-');
    descargarLibro(`Inventario_garantias_${fecha || 'sin_fecha'}.xlsx`, wb);
  });

  // ------------------------------------------------------------ inventarios contables (Excel y PDF con el logo)
  const MARCA = { rojo: 'CE162E', gris: '727274', grisClaro: 'F2F2F3', rojoRgb: [206, 22, 46], grisRgb: [114, 114, 116] };
  // Librerías que se cargan recién al exportar: primero la copia del sitio, después los CDN.
  const LIBRERIAS = {
    exceljs: { listo: () => window.ExcelJS, urls: ['../vendor/exceljs.min.js', 'vendor/exceljs.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js', 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'] },
    jspdf: { listo: () => window.jspdf && window.jspdf.jsPDF, urls: ['../vendor/jspdf.umd.min.js', 'vendor/jspdf.umd.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js', 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'] },
    autotable: { listo: () => window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable, urls: ['../vendor/jspdf.plugin.autotable.min.js', 'vendor/jspdf.plugin.autotable.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js', 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'] },
  };
  async function cargarLibreria(nombre) {
    const lib = LIBRERIAS[nombre];
    if (lib.listo()) return;
    for (const url of lib.urls) {
      try {
        await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => { s.remove(); mal(); }; document.head.appendChild(s); });
        if (lib.listo()) return;
      } catch (e) { /* se prueba la siguiente */ }
    }
    throw new Error('No se pudo cargar la librería para exportar (' + nombre + '). Revisá la conexión a internet.');
  }

  let invTcLista = []; // com3500 leído
  const padronInv = () => datos().padronInventario || { entes: {}, nombres: {}, garantias: {} };
  const fechaAr = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const numeroTc = () => { const v = String($('invTc').value).trim(); if (!v) return null; const n = Number(/,/.test(v) ? v.replace(/\./g, '').replace(',', '.') : v); return n > 0 ? n : null; };
  const reportesInv = () => inventario.filter(x => /garhi(con|sin)/i.test(x.leido.reporte + ' ' + x.nombre));
  // Base de entes (CUIT por código de ente): se consultan solo los entes de los reportes cargados.
  const entesCache = {};
  const entesPedidos = new Set();
  let entesBuscando = false;
  const hayBaseEntes = () => almacen && typeof almacen.buscarEntes === 'function';
  async function completarEntes(lista) {
    if (!hayBaseEntes() || entesBuscando) return;
    const faltan = [...new Set(lista)].filter(e => !entesPedidos.has(e));
    if (!faltan.length) return;
    entesBuscando = true;
    try {
      Object.assign(entesCache, await almacen.buscarEntes(faltan));
      faltan.forEach(e => entesPedidos.add(e));
    } catch (e) { $('invBaseEstado').textContent = '· no se pudo consultar la base (' + (e.message || e) + ')'; }
    entesBuscando = false;
    renderInvContable();
  }
  async function renderBaseEstado() {
    if (!hayBaseEntes()) { $('invBaseEstado').textContent = '· en esta versión se guarda solo para los entes de los reportes cargados'; return; }
    try { const n = await almacen.contarEntes(); $('invBaseEstado').textContent = `· ${fmtEntero(n)} entes cargados`; }
    catch (e) { $('invBaseEstado').textContent = '· ' + (/entes/.test(e.message) ? 'falta crear la tabla: ejecutá la última versión de supabase/esquema.sql' : (e.message || e)); }
  }
  async function guardarEntesBase(filas, progreso) {
    if (hayBaseEntes()) {
      await almacen.guardarEntes(filas, progreso);
      filas.forEach(f => { entesCache[f.ente] = { cuit: f.cuit, nombre: f.nombre }; entesPedidos.add(f.ente); });
    } else {
      // Sin base (versión claude.ai): se guardan en el padrón solo los entes de los reportes cargados.
      const usados = new Set(reportesInv().flatMap(x => x.leido.filas.map(f => f.cliente)));
      await guardarPadron(p => filas.filter(f => usados.has(f.ente)).forEach(f => { const e = p.entes[f.ente] || (p.entes[f.ente] = { cuit: '', historial: [] }); e.cuit = f.cuit; if (f.nombre) e.nombre = f.nombre; }));
    }
  }
  function inventariosContables() {
    const filas = reportesInv().flatMap(x => x.leido.filas);
    if (filas.length) completarEntes(filas.map(f => f.cliente));
    return filas.length ? M.armarInventariosContables(filas, padronInv(), entesCache) : [];
  }
  $('btnInvBaseSubir').addEventListener('click', () => $('archivoBaseEntes').click());
  $('archivoBaseEntes').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const caja = $('invBaseProgreso');
    try {
      caja.innerHTML = '<p class="sub">Leyendo ' + esc(files.map(f => f.name).join(', ')) + '…</p>';
      const hojas = [];
      for (const f of files) hojas.push(...await leerHojas(f));
      const r = M.leerBaseEntes(hojas);
      if (!r.filas.length) throw new Error('No se encontraron columnas de ente (external_code / Ente) y CUIT (tax_id_number / CUIT).');
      await guardarEntesBase(r.filas, (n, t) => { caja.innerHTML = `<p class="sub">Guardando entes… ${fmtEntero(n)} de ${fmtEntero(t)}</p>`; });
      caja.innerHTML = aviso('ok', `Base actualizada: ${fmtEntero(r.filas.length)} entes con CUIT.` + (r.sinEnte ? ` ${fmtEntero(r.sinEnte)} filas sin código de ente quedaron afuera.` : '') + (r.sinCuit ? ` ${fmtEntero(r.sinCuit)} sin CUIT válido.` : ''));
      renderBaseEstado();
      renderInvContable();
    } catch (err) { caja.innerHTML = aviso('bad', esc(err.message || err)); }
  });
  $('btnInvNuevoEnte').addEventListener('click', async () => {
    const ente = $('invNuevoEnte').value.trim(), cuit = $('invNuevoCuit').value.replace(/\D/g, ''), nombre = $('invNuevoNombre').value.trim();
    if (!/^\d+$/.test(ente)) { toast('El ente es el código numérico de cliente'); return; }
    if (cuit.length !== 11) { toast('El CUIT tiene que tener 11 dígitos'); return; }
    try {
      await guardarEntesBase([{ ente, cuit, nombre }]);
      ['invNuevoEnte', 'invNuevoCuit', 'invNuevoNombre'].forEach(id => { $(id).value = ''; });
      toast(`Ente ${ente} guardado`);
      renderBaseEstado(); renderInvContable();
    } catch (err) { informar('No se pudo guardar', esc(err.message || err)); }
  });
  $('detInvPadron').addEventListener('toggle', () => { if ($('detInvPadron').open) renderBaseEstado(); });

  let tcAutoPara = '';
  function renderInvContable() {
    const reps = reportesInv();
    $('cardInvContable').classList.toggle('oculto', !reps.length);
    if (!reps.length) return;
    if (!$('invFecha').value) $('invFecha').value = M.fechaInventarioDesdeReporte(reps.map(x => M.fechaReporteIso(x.leido.fecha)).filter(Boolean).sort().pop() || '');
    const p = padronInv();
    // TC guardado: solo si es del mes del inventario; si no, se busca solo (una vez por fecha de inventario).
    const mesInv = $('invFecha').value.slice(0, 7);
    if (!$('invTc').value && p.tcUltimo && p.tcUltimo.tc && String(p.tcUltimo.fecha || '').slice(0, 7) === mesInv) {
      $('invTc').value = String(p.tcUltimo.tc).replace('.', ','); $('invTcFecha').value = p.tcUltimo.fecha || '';
    }
    if (mesInv && $('invTcFecha').value.slice(0, 7) !== mesInv && tcAutoPara !== $('invFecha').value) {
      tcAutoPara = $('invFecha').value;
      if (invTcLista.some(x => x.fecha.slice(0, 7) === mesInv)) elegirTcDelInventario(); else setTimeout(() => buscarTcAutomatico(false), 0);
    }
    const faltaGarhi = ['garhicon', 'garhisin'].filter(r => !reps.some(x => new RegExp(r, 'i').test(x.leido.reporte + ' ' + x.nombre)));
    const inv = inventariosContables();
    const tc = numeroTc();
    let html = faltaGarhi.length ? aviso('warn', `Falta el reporte <b>${faltaGarhi.join(' y ')}</b>: los inventarios quedan incompletos.`) : '';
    html += `<div class="tabla-caja"><table><thead><tr><th>Cuenta</th><th>Inventario</th><th class="num">Garantías</th><th class="num">Total moneda</th><th class="num">Total $</th><th>Faltan</th><th></th></tr></thead><tbody>` +
      inv.map((i, k) => {
        const usd = i.def.moneda === 'USD';
        const pesos = usd ? (tc ? M.round2(i.total * tc) : null) : i.total;
        const sinCuit = i.filas.filter(f => f.faltaCuit).length, sinFecha = i.def.columnas.includes('fecha') ? i.filas.filter(f => f.faltaFecha).length : 0;
        return `<tr><td><b>${esc(i.def.cuenta)}</b></td><td>${esc(i.def.titulo)}</td><td class="num">${fmtEntero(i.filas.length)}</td>` +
          `<td class="num">${usd ? 'U$S ' : '$ '}${fmtMonto(i.total)}</td><td class="num">${pesos == null ? '<span class="chip bad">falta TC</span>' : '$ ' + fmtMonto(pesos)}</td>` +
          `<td>${sinCuit ? `<span class="chip warn">${sinCuit} sin CUIT</span> ` : ''}${sinFecha ? `<span class="chip warn">${sinFecha} sin fecha</span>` : ''}${!sinCuit && !sinFecha ? '<span class="chip ok">completo</span>' : ''}</td>` +
          `<td style="white-space:nowrap"><button class="btn" type="button" data-inv-excel="${k}">Excel</button> <button class="btn" type="button" data-inv-pdf="${k}">PDF</button></td></tr>`;
      }).join('') + '</tbody></table></div>';
    $('invContableResumen').innerHTML = html;
    renderFaltantes(inv);
  }

  // Entes y fechas: por defecto solo los entes sin CUIT; el filtro permite ver las garantías sin fecha o todos los entes.
  function renderFaltantes(inv) {
    const entes = new Map(), sinFecha = [];
    inv.forEach(i => i.filas.forEach(f => {
      if (!entes.has(f.ente)) entes.set(f.ente, { ente: f.ente, nombre: (f.descripcion || f.concepto || '').trim(), cuit: f.cuit, faltaCuit: f.faltaCuit, cuentas: new Set() });
      entes.get(f.ente).cuentas.add(i.def.id);
      if (f.faltaFecha && i.def.columnas.includes('fecha')) sinFecha.push(Object.assign({ cuenta: i.def.id }, f));
    }));
    const sinCuit = [...entes.values()].filter(e => e.faltaCuit);
    const partes = [];
    if (sinCuit.length) partes.push(`${sinCuit.length} entes sin CUIT`);
    if (sinFecha.length) partes.push(`${sinFecha.length} garantías sin fecha`);
    $('invPadronEstado').textContent = partes.length ? '· ' + partes.join(' · ') : '· completo';
    const modo = $('invFiltroFalt').value, q = M.normalizar($('invFiltroTexto').value);
    const pasa = (...t) => !q || M.normalizar(t.join(' ')).includes(q);
    let html;
    if (modo === 'fecha') {
      const lista = sinFecha.filter(f => pasa(f.ente, f.concepto, f.codigo));
      html = lista.length ? `<table><thead><tr><th>Cuenta</th><th>Ente</th><th>Concepto</th><th>Código</th><th>Fecha</th></tr></thead><tbody>` +
        lista.map(f => `<tr><td>${esc(f.cuenta)}</td><td>${esc(f.ente)}</td><td>${esc(f.concepto)}</td><td>${esc(f.codigo)}</td>` +
          `<td><input type="date" data-padron-fecha="${esc(f.codigo)}" data-escribe></td></tr>`).join('') + '</tbody></table>'
        : '<p class="sub">No hay garantías sin fecha.</p>';
    } else {
      const lista = (modo === 'todos' ? [...entes.values()] : sinCuit).filter(e => pasa(e.ente, e.nombre, e.cuit))
        .sort((a, b) => (b.faltaCuit - a.faltaCuit) || Number(a.ente) - Number(b.ente));
      html = lista.length ? `<table><thead><tr><th>Ente</th><th>Nombre</th><th>CUIT</th><th>Cuentas</th></tr></thead><tbody>` +
        lista.map(e => `<tr><td>${esc(e.ente)}</td><td><input data-ente-nombre="${esc(e.ente)}" value="${esc(e.nombre)}" style="min-width:240px" data-escribe></td>` +
          `<td><input data-padron-cuit="${esc(e.ente)}" value="${esc(e.cuit || '')}" placeholder="11 dígitos" inputmode="numeric" style="max-width:130px" data-escribe></td><td class="sub">${esc([...e.cuentas].join(', '))}</td></tr>`).join('') + '</tbody></table>'
        : `<p class="sub">${modo === 'todos' ? 'Ningún ente coincide con la búsqueda.' : 'Todos los entes tienen CUIT.'}</p>`;
    }
    $('invFaltantes').innerHTML = html;
  }
  $('invFiltroFalt').addEventListener('change', () => renderInvContable());
  $('invFiltroTexto').addEventListener('input', () => renderInvContable());

  async function guardarPadron(cambio) {
    const p = JSON.parse(JSON.stringify(padronInv()));
    p.entes = p.entes || {}; p.garantias = p.garantias || {}; p.nombres = p.nombres || {};
    cambio(p);
    try { await almacen.guardarPadronInventario(p); } catch (e) { informar('No se pudo guardar', esc(e.message || e)); }
  }
  $('invFaltantes').addEventListener('change', e => {
    const c = e.target.closest('[data-padron-cuit]'), f = e.target.closest('[data-padron-fecha]'), k = e.target.closest('[data-padron-concepto]');
    if (k) guardarPadron(p => { p.garantias[k.dataset.padronConcepto] = Object.assign({}, p.garantias[k.dataset.padronConcepto], { concepto: k.value.trim() }); });
    if (c) {
      const cuit = c.value.replace(/\D/g, '');
      if (cuit && cuit.length !== 11) { toast('El CUIT tiene que tener 11 dígitos'); return; }
      const ente = c.dataset.padronCuit, fila = c.closest('tr');
      const nombre = fila ? ((fila.querySelector('[data-ente-nombre]') || {}).value || '').trim() : '';
      if (cuit) guardarEntesBase([{ ente, cuit, nombre }]).then(() => renderInvContable(), err => informar('No se pudo guardar', esc(err.message || err)));
    }
    if (f) guardarPadron(p => { p.garantias[f.dataset.padronFecha] = Object.assign({}, p.garantias[f.dataset.padronFecha], { fecha: f.value }); });
  });
  $('btnInvPadronImportar').addEventListener('click', () => $('archivoPadronInv').click());
  $('archivoPadronInv').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    try {
      let nuevo = { entes: {}, nombres: {}, garantias: {} };
      for (const f of files) nuevo = M.unirPadron(nuevo, M.leerPadronDesdeInventarios(await leerHojas(f)));
      const n = Object.keys(nuevo.entes).length, m = Object.keys(nuevo.nombres).length;
      if (!n && !m) throw new Error('No se encontraron columnas CUIT (y Ente/Fecha) en esos archivos.');
      await guardarPadron(p => { const u = M.unirPadron(p, nuevo); Object.assign(p, u); });
      toast(`Padrón actualizado: ${n} entes y ${m} nombres con CUIT`);
    } catch (err) { informar('No se pudo importar', esc(err.message || err)); }
  });

  // Tipo de cambio: Com. A 3500 del BCRA (último día hábil del mes del inventario).
  const URL_COM3500 = 'https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/com3500.xls';
  function usarCom3500(buf, fuente) {
    const wb = XLSX.read(buf, { type: 'array' });
    invTcLista = M.leerCom3500(wb.SheetNames.flatMap(n => filasHoja(wb.Sheets[n])));
    if (!invTcLista.length) throw new Error('El archivo no tiene fechas con tipo de cambio (¿es el com3500.xls del BCRA?).');
    invTcFuente = fuente;
    elegirTcDelInventario();
  }
  // TC del último día hábil del mes del inventario (ej. inventario al 30/09 → último día hábil de septiembre).
  let invTcFuente = '';
  function elegirTcDelInventario() {
    if (!invTcLista.length) return;
    const fi = $('invFecha').value;
    const ref = fi ? new Date(Number(fi.slice(0, 4)), Number(fi.slice(5, 7)) - 1, Number(fi.slice(8, 10))) : new Date();
    const t = M.elegirTipoCambio(invTcLista, ref);
    aplicarTc(t.fecha);
    $('invTcEstado').innerHTML = aviso(t.exacto ? 'ok' : 'warn', `${esc(invTcFuente)}: ${invTcLista.length} cotizaciones, la última del ${fechaAr(invTcLista[invTcLista.length - 1].fecha)}. ` +
      (t.exacto ? `Se usa el último día hábil del mes del inventario (${fechaAr(t.objetivo)}).` : `El último día hábil del mes del inventario (${fechaAr(t.objetivo)}) no está en el archivo: se usa el ${fechaAr(t.fecha)}. Podés cambiar la fecha.`));
  }
  function aplicarTc(fecha) {
    const r = invTcLista.find(x => x.fecha === fecha) || invTcLista.filter(x => x.fecha <= fecha).pop();
    if (!r) { toast('No hay cotización para esa fecha'); return; }
    $('invTcFecha').value = r.fecha;
    $('invTc').value = String(r.tc).replace('.', ',');
    guardarTc();
    renderInvContable();
  }
  function guardarTc() {
    const tc = numeroTc();
    if (!tc || almacen.puedeEscribir === false) return;
    const p0 = padronInv().tcUltimo || {};
    if (p0.tc === tc && p0.fecha === $('invTcFecha').value) return;
    guardarPadron(p => { p.tcUltimo = { tc, fecha: $('invTcFecha').value }; });
  }
  $('invTc').addEventListener('change', () => { guardarTc(); renderInvContable(); });
  $('invTcFecha').addEventListener('change', () => { if (invTcLista.length) aplicarTc($('invTcFecha').value); else guardarTc(); });
  $('invFecha').addEventListener('change', () => { elegirTcDelInventario(); renderInvContable(); });
  // Busca el TC solo: API del BCRA (variable 5) directo; si el BCRA lo bloquea, por la base (función tc_bcra);
  // por último el com3500.xls. Se piden las cotizaciones del mes del inventario y se toma su último día hábil.
  let tcBuscando = false;
  async function buscarTcAutomatico(manual) {
    if (tcBuscando) return;
    const fi = $('invFecha').value;
    if (!fi) return;
    tcBuscando = true;
    $('btnInvTcBcra').disabled = true;
    $('invTcEstado').innerHTML = '<p class="sub">Buscando el tipo de cambio Com. A 3500 en el BCRA…</p>';
    const desde = fi.slice(0, 8) + '01';
    const hasta = fi;
    const errores = [];
    let lista = [], fuente = '';
    for (const v of ['v4.0', 'v3.0']) {
      if (lista.length) break;
      try {
        const r = await fetch(`https://api.bcra.gob.ar/estadisticas/${v}/monetarias/5?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        lista = M.leerTcApiBcra(await r.json()); fuente = 'API del BCRA';
      } catch (e) { errores.push(`API ${v}: ${e.message || e}`); }
    }
    if (!lista.length && almacen && typeof almacen.rpc === 'function') {
      try {
        const j = await almacen.rpc('tc_bcra', { p_desde: desde, p_hasta: hasta });
        if (j && j.status === 200) { lista = M.leerTcApiBcra(j); fuente = 'API del BCRA (por la base)'; }
        else errores.push('base: ' + ((j && j.error) || 'sin respuesta'));
      } catch (e) { errores.push('base: ' + (e.message || e)); }
    }
    if (!lista.length) {
      try {
        const r = await fetch(URL_COM3500, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        usarCom3500(await r.arrayBuffer(), 'BCRA com3500.xls');
        lista = invTcLista;
      } catch (e) { errores.push('com3500.xls: ' + (e.message || e)); }
    } else {
      invTcLista = lista; invTcFuente = fuente;
      elegirTcDelInventario();
    }
    tcBuscando = false;
    $('btnInvTcBcra').disabled = false;
    if (!lista.length) {
      const sinFuncion = errores.some(e => /tc_bcra|function|schema cache/i.test(e));
      $('invTcEstado').innerHTML = aviso('warn', 'No se pudo traer el tipo de cambio automáticamente. ' +
        (sinFuncion ? 'Falta habilitar la consulta en la base: en Supabase → SQL Editor ejecutá la última versión de <code>supabase/esquema.sql</code> (agrega la función <code>tc_bcra</code>). ' : '') +
        `Mientras tanto bajá <a href="${URL_COM3500}" target="_blank" rel="noopener">com3500.xls</a> y subilo con <b>Subir com3500.xls</b>, o escribí el tipo de cambio.` +
        (manual ? `<br><span class="sub">${esc(errores.join(' · '))}</span>` : ''));
    }
  }
  $('btnInvTcBcra').addEventListener('click', () => buscarTcAutomatico(true));
  $('btnInvTcArchivo').addEventListener('click', () => $('archivoCom3500').click());
  $('archivoCom3500').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { usarCom3500(await f.arrayBuffer(), f.name); } catch (err) { $('invTcEstado').innerHTML = aviso('bad', esc(err.message || err)); }
  });

  // Datos de cada inventario listos para exportar (encabezados, filas y totales).
  function datosInventario(i) {
    const usd = i.def.moneda === 'USD', tc = numeroTc();
    if (usd && !tc) throw new Error(`Falta el tipo de cambio para ${i.def.cuenta}: traelo del BCRA, subí com3500.xls o escribilo.`);
    const etiquetas = { ente: 'Ente', fecha: 'Fecha', concepto: 'Concepto', cuit: 'CUIT', importe: usd ? 'Importe U$S' : 'Importe $' };
    const cols = i.def.columnas;
    const totalPesos = usd ? M.round2(i.total * tc) : i.total;
    return { i, usd, tc, tcFecha: $('invTcFecha').value, cols, encabezados: cols.map(c => etiquetas[c]),
      filas: i.filas.map(f => cols.map(c => c === 'ente' ? (/^\d+$/.test(f.ente) ? Number(f.ente) : f.ente) : c === 'cuit' ? (f.cuit ? Number(f.cuit) : '') : f[c])),
      totalPesos, letras: M.numeroEnLetras(totalPesos), fecha: $('invFecha').value };
  }

  const fechaExcel = iso => { const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
  async function hojaExcel(wb, d, logoId) {
    const { i, usd, cols } = d;
    const ws = wb.addWorksheet(i.def.id, { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
      views: [{ showGridLines: false }] });
    const anchos = { ente: 10, fecha: 12, concepto: 52, cuit: 15, importe: 20 };
    ws.columns = cols.map(c => ({ width: anchos[c] }));
    const n = cols.length, ultima = String.fromCharCode(64 + n);
    const rojo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + MARCA.rojo } };
    const gris = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + MARCA.grisClaro } };
    const fino = { style: 'thin', color: { argb: 'FFD0D0D2' } };
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 180, height: 60 } });
    ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 16;
    ws.mergeCells(`C1:${ultima}1`); ws.getCell('C1').value = 'Inventario de Garantías';
    ws.getCell('C1').font = { bold: true, size: 14, color: { argb: 'FF' + MARCA.rojo } }; ws.getCell('C1').alignment = { horizontal: 'right', vertical: 'middle' };
    ws.mergeCells(`C2:${ultima}2`); ws.getCell('C2').value = `${i.def.titulo} · Inventario contable al ${fechaAr(d.fecha)}`;
    ws.getCell('C2').font = { size: 10, color: { argb: 'FF' + MARCA.gris } }; ws.getCell('C2').alignment = { horizontal: 'right', vertical: 'middle' };
    const info = [['Número de Cuenta', 'Denominación'], [i.def.cuenta, M.INVENTARIO_DENOMINACION], [i.def.contra, ''], ['Sector', 'Activas'], ['Inventario contable al', d.fecha ? fechaExcel(d.fecha) : '']];
    info.forEach((r, k) => {
      const fila = 5 + k;
      ws.getCell(`A${fila}`).value = r[0];
      ws.mergeCells(`B${fila}:${ultima}${fila}`);
      ws.getCell(`B${fila}`).value = r[1];
      if (k === 0) [`A${fila}`, `B${fila}`].forEach(c => { ws.getCell(c).fill = rojo; ws.getCell(c).font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
      else { ws.getCell(`A${fila}`).font = { bold: true, color: { argb: 'FF' + MARCA.gris } }; }
      if (k === 4) { ws.getCell(`B${fila}`).numFmt = 'dd/mm/yyyy'; ws.getCell(`B${fila}`).alignment = { horizontal: 'left' }; }
    });
    ws.getColumn(1).width = Math.max(ws.getColumn(1).width, 22);
    const inicio = 11;
    const enc = ws.getRow(inicio);
    d.encabezados.forEach((h, k) => { const c = enc.getCell(k + 1); c.value = h; c.fill = rojo; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { horizontal: cols[k] === 'importe' ? 'right' : 'left', vertical: 'middle' }; });
    enc.height = 18;
    d.filas.forEach((f, k) => {
      const r = ws.getRow(inicio + 1 + k);
      f.forEach((v, j) => {
        const c = r.getCell(j + 1), col = cols[j];
        c.value = col === 'fecha' ? (v ? fechaExcel(v) : '') : v;
        if (col === 'fecha') c.numFmt = 'dd/mm/yyyy';
        if (col === 'importe') c.numFmt = '#,##0.00';
        if (col === 'cuit') c.numFmt = '0';
        if (col === 'ente') c.alignment = { horizontal: 'left' };
        c.border = { bottom: fino };
        if (k % 2) c.fill = gris;
      });
    });
    const fin = inicio + d.filas.length;
    const colImp = String.fromCharCode(65 + cols.indexOf('importe'));
    let r = fin + 1;
    const fila = (etiqueta, valor, fmt, negrita) => {
      ws.mergeCells(`A${r}:${String.fromCharCode(64 + cols.indexOf('importe'))}${r}`);
      ws.getCell(`A${r}`).value = etiqueta; ws.getCell(`A${r}`).font = { bold: true, color: { argb: 'FF' + (negrita ? MARCA.rojo : MARCA.gris) } };
      ws.getCell(`A${r}`).alignment = { horizontal: etiqueta === 'SALDO' ? 'left' : 'right' };
      const c = ws.getCell(`${colImp}${r}`); c.value = valor; c.numFmt = fmt; c.font = { bold: true, color: { argb: 'FF' + (negrita ? MARCA.rojo : '000000') } };
      c.border = { top: { style: 'thin', color: { argb: 'FF' + MARCA.gris } } };
      r++;
    };
    fila('SALDO', { formula: `SUM(${colImp}${inicio + 1}:${colImp}${Math.max(fin, inicio + 1)})`, result: i.total }, '#,##0.00', !usd);
    if (usd) {
      const filaSaldo = r - 1;
      fila('Total U$S', { formula: `${colImp}${filaSaldo}`, result: i.total }, '#,##0.00');
      fila(`TC Com. A 3500 (${fechaAr(d.tcFecha)})`, d.tc, '#,##0.0000');
      fila('Total $', { formula: `ROUND(${colImp}${filaSaldo}*${colImp}${r - 1},2)`, result: d.totalPesos }, '#,##0.00', true);
    }
    r++;
    ws.getCell(`A${r}`).value = 'SON PESOS'; ws.getCell(`A${r}`).font = { bold: true, color: { argb: 'FF' + MARCA.gris } };
    ws.mergeCells(`B${r}:${ultima}${r + 1}`); ws.getCell(`B${r}`).value = d.letras;
    ws.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' }; ws.getCell(`B${r}`).font = { italic: true };
    r += 5;
    const firmaCols = [1, Math.min(n, 3)];
    M.INVENTARIO_FIRMAS.forEach((f, k) => {
      const col = String.fromCharCode(64 + firmaCols[k] + (k && firmaCols[1] === firmaCols[0] ? 1 : 0));
      const a = ws.getCell(`${col}${r}`); a.value = f.nombre; a.font = { bold: true }; a.border = { top: { style: 'thin', color: { argb: 'FF' + MARCA.gris } } };
      const b = ws.getCell(`${col}${r + 1}`); b.value = f.cargo; b.font = { size: 8, color: { argb: 'FF' + MARCA.gris } }; b.alignment = { wrapText: true, vertical: 'top' };
    });
    ws.getRow(r + 1).height = 30;
    ws.headerFooter.oddFooter = `&L&8${i.def.cuenta} - ${i.def.titulo}&R&8Página &P de &N`;
  }

  async function descargarExcelInventarios(lista, nombre) {
    const ds = lista.map(datosInventario);
    await cargarLibreria('exceljs');
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'VALO - EPORTFOLIO';
    const logoId = wb.addImage({ base64: window.VALO_LOGO_PNG, extension: 'png' });
    for (const d of ds) await hojaExcel(wb, d, logoId);
    const buf = await wb.xlsx.writeBuffer();
    await descargar(nombre, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), true);
  }

  function paginaPdf(doc, d, primera) {
    const { i, usd, cols } = d;
    if (!primera) doc.addPage();
    const W = doc.internal.pageSize.getWidth(), M0 = 14;
    doc.addImage(window.VALO_LOGO_PNG, 'PNG', M0, 10, 48, 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...MARCA.rojoRgb);
    doc.text('Inventario de Garantías', W - M0, 16, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MARCA.grisRgb);
    doc.text(`${i.def.titulo} · Inventario contable al ${fechaAr(d.fecha)}`, W - M0, 22, { align: 'right' });
    doc.setDrawColor(...MARCA.rojoRgb); doc.setLineWidth(0.6); doc.line(M0, 30, W - M0, 30);
    doc.autoTable({
      startY: 34, theme: 'plain', margin: { left: M0, right: M0 },
      head: [['Número de Cuenta', 'Denominación', 'Sector', 'Inventario contable al']],
      body: [[`${i.def.cuenta}\n${i.def.contra}`, M.INVENTARIO_DENOMINACION, 'Activas', fechaAr(d.fecha)]],
      headStyles: { fillColor: MARCA.rojoRgb, textColor: 255, fontStyle: 'bold', fontSize: 9 }, bodyStyles: { fontSize: 9 },
    });
    const derecha = cols.map(c => c === 'importe');
    const fmtCelda = (v, c) => c === 'importe' ? fmtMonto(v) : c === 'fecha' ? fechaAr(v) : v == null ? '' : String(v);
    const pie = [['SALDO', fmtMonto(i.total)]];
    if (usd) pie.push(['Total U$S', fmtMonto(i.total)], [`TC Com. A 3500 (${fechaAr(d.tcFecha)})`, d.tc.toLocaleString('es-AR', { minimumFractionDigits: 4 })], ['Total $', fmtMonto(d.totalPesos)]);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 6, margin: { left: M0, right: M0, bottom: 20 },
      head: [d.encabezados],
      body: d.filas.map(f => f.map((v, j) => fmtCelda(v, cols[j]))),
      foot: pie.map(p => [{ content: p[0], colSpan: cols.length - 1, styles: { halign: p[0] === 'SALDO' ? 'left' : 'right' } }, { content: p[1], styles: { halign: 'right' } }]),
      theme: 'striped', showFoot: 'lastPage',
      headStyles: { fillColor: MARCA.rojoRgb, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      bodyStyles: { fontSize: 8, textColor: 30 }, alternateRowStyles: { fillColor: [242, 242, 243] },
      footStyles: { fillColor: 255, textColor: MARCA.rojoRgb, fontStyle: 'bold', fontSize: 8.5, lineWidth: { top: 0.3 }, lineColor: MARCA.grisRgb },
      columnStyles: Object.fromEntries(cols.map((c, j) => [j, { halign: derecha[j] ? 'right' : 'left', cellWidth: c === 'concepto' ? 'auto' : c === 'importe' ? 32 : c === 'cuit' ? 24 : c === 'fecha' ? 20 : 14 }])),
      didParseCell: h => { if (h.section === 'head' && derecha[h.column.index]) h.cell.styles.halign = 'right'; },
    });
    let y = doc.lastAutoTable.finalY + 8;
    const H = doc.internal.pageSize.getHeight();
    if (y > H - 55) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...MARCA.grisRgb); doc.text('SON PESOS:', M0, y);
    doc.setFont('helvetica', 'italic'); doc.setTextColor(30);
    const letras = doc.splitTextToSize(d.letras, W - 2 * M0 - 24); doc.text(letras, M0 + 24, y);
    y += letras.length * 4.5 + 22;
    const ancho = (W - 2 * M0 - 20) / 2;
    M.INVENTARIO_FIRMAS.forEach((f, k) => {
      const x = M0 + k * (ancho + 20);
      doc.setDrawColor(...MARCA.grisRgb); doc.setLineWidth(0.3); doc.line(x, y, x + ancho, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30); doc.text(f.nombre, x + ancho / 2, y + 5, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MARCA.grisRgb);
      doc.text(doc.splitTextToSize(f.cargo, ancho), x + ancho / 2, y + 9.5, { align: 'center' });
    });
  }

  async function descargarPdfInventarios(lista, nombre) {
    const ds = lista.map(datosInventario);
    await cargarLibreria('jspdf'); await cargarLibreria('autotable');
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    const paginas = [];
    ds.forEach((d, k) => { const desde = doc.getNumberOfPages() + (k ? 1 : 0); paginaPdf(doc, d, !k); paginas.push({ d, desde, hasta: doc.getNumberOfPages() }); });
    // Pie: cuenta y página dentro de cada inventario.
    paginas.forEach(({ d, desde, hasta }) => {
      for (let p = desde; p <= hasta; p++) {
        doc.setPage(p);
        const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MARCA.grisRgb);
        doc.text(`${d.i.def.cuenta} - ${d.i.def.titulo}`, 14, H - 8);
        doc.text(`Página ${p - desde + 1} de ${hasta - desde + 1}`, W - 14, H - 8, { align: 'right' });
        doc.setDrawColor(...MARCA.rojoRgb); doc.setLineWidth(0.4); doc.line(14, H - 12, W - 14, H - 12);
      }
    });
    await descargar(nombre, doc.output('blob'), true);
  }

  const sufijoFecha = () => ($('invFecha').value || '').split('-').reverse().join('');
  async function exportarInventarios(tipo, indices) {
    const inv = inventariosContables();
    const lista = indices.map(k => inv[k]);
    const nombre = lista.length === 1 ? `Inventario_${lista[0].def.id}_${sufijoFecha()}` : `Inventarios_garantias_${sufijoFecha()}`;
    try {
      if (tipo === 'excel') await descargarExcelInventarios(lista, nombre + '.xlsx');
      else await descargarPdfInventarios(lista, nombre + '.pdf');
    } catch (e) { informar('No se pudo generar el inventario', esc(e.message || e)); }
  }
  $('invContableResumen').addEventListener('click', e => {
    const x = e.target.closest('[data-inv-excel]'), p = e.target.closest('[data-inv-pdf]');
    if (x) exportarInventarios('excel', [Number(x.dataset.invExcel)]);
    if (p) exportarInventarios('pdf', [Number(p.dataset.invPdf)]);
  });
  $('btnInvTodosExcel').addEventListener('click', () => exportarInventarios('excel', M.INVENTARIOS_CONTABLES.map((d, k) => k)));
  $('btnInvTodosPdf').addEventListener('click', () => exportarInventarios('pdf', M.INVENTARIOS_CONTABLES.map((d, k) => k)));

  // ============================================================ BASTANTEO DE FIRMANTES
  // PDF (resumen OCR) + Excel del cliente → un JSON por poder. Todo en el navegador; nada se guarda.
  LIBRERIAS.pdfjs = { listo: () => window.pdfjsLib, urls: ['../vendor/pdf.min.js', 'vendor/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'] };
  LIBRERIAS.pdfworker = { listo: () => window.pdfjsWorker, urls: ['../vendor/pdf.worker.min.js', 'vendor/pdf.worker.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'] };
  // Texto del PDF por renglón: agrupa los textos a la misma altura y los ordena de izquierda a derecha.
  async function lineasPdf(buf) {
    await cargarLibreria('pdfjs');
    await cargarLibreria('pdfworker'); // con el worker en la página no hace falta otro archivo (funciona también sin servidor)
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const lineas = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      const filas = [];
      tc.items.forEach(it => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5], x = it.transform[4];
        let f = filas.find(f => Math.abs(f.y - y) < 2.5);
        if (!f) { f = { y, items: [] }; filas.push(f); }
        f.items.push({ x, t: it.str, w: it.width });
      });
      filas.sort((a, b) => b.y - a.y).forEach(f => {
        f.items.sort((a, b) => a.x - b.x);
        let s = '', fin = null;
        f.items.forEach(i => { if (fin != null && i.x - fin > 1.5 && !s.endsWith(' ')) s += ' '; s += i.t; fin = i.x + i.w; });
        lineas.push(s.replace(/\s+/g, ' ').trim());
      });
      lineas.push('<<PAGINA>>');
    }
    return lineas;
  }

  const bast = { pdf: null, xls: null, poderes: [], cliente: null, ediciones: [], cuitsBase: {} };
  const nombreCatalogo = Object.fromEntries(M.BASTANTEO_CATALOGO.map(c => [c[2], c])); // clave → [código, nombre, clave]
  function zonaArchivo(zona, input, alElegir) {
    const z = $(zona);
    z.addEventListener('click', () => $(input).click());
    z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(input).click(); } });
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('encima'); });
    z.addEventListener('dragleave', () => z.classList.remove('encima'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('encima'); if (e.dataTransfer.files[0]) alElegir(e.dataTransfer.files[0]); });
    $(input).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) alElegir(f); });
  }
  zonaArchivo('zonaBastPdf', 'archivoBastPdf', async f => {
    $('bastPdfNombre').textContent = 'Leyendo ' + f.name + '…';
    try {
      const lineas = await lineasPdf(await f.arrayBuffer());
      const poderes = M.leerPoderesOcr(lineas);
      // Sin "Acreditación de Poderes": el presidente del acta de designación, con todas las facultades (si está en la planilla).
      const pres = poderes.length ? null : M.poderDelPresidente(M.leerAutoridadesOcr(lineas));
      if (!poderes.length && !pres) throw new Error('El PDF no tiene secciones "Acreditación de Poderes" ni un presidente en el acta de designación de autoridades.');
      poderes.forEach((p, k) => { p._k = k; });
      if (pres) pres._k = 'presidente';
      bast.pdf = f.name; bast.poderesTodos = poderes; bast.poderPresidente = pres; bast.edPorPoder = {}; bast.actas = [];
      $('cmpEstado').innerHTML = '';
      $('bastPdfNombre').textContent = pres ? `${f.name} · sin acreditación de poderes · presidente: ${pres.presidente.nombre_completo}` : `${f.name} · ${poderes.length} poderes`;
      prepararBastanteo();
    } catch (e) { $('bastPdfNombre').textContent = f.name; $('bastEstado').innerHTML = aviso('bad', 'No se pudo leer el PDF: ' + esc(e.message || e)); }
  });
  zonaArchivo('zonaBastXls', 'archivoBastXls', async f => {
    try {
      bast.cliente = M.leerClienteBastanteo(await leerHojas(f));
      bast.xls = f.name;
      await completarCuitFirmantes(bast.cliente.firmantes);
      // Los firmantes que traen CUIT y número de ente alimentan la base de entes (para planillas que traen solo el DNI).
      const conCuit = bast.cliente.firmantes.filter(x => x.cuit && x.ente && !x.fuente);
      if (conCuit.length && almacen && typeof almacen.guardarEntes === 'function' && almacen.puedeEscribir !== false) {
        try { await almacen.guardarEntes(conCuit.map(x => ({ ente: x.ente, cuit: x.cuit, nombre: x.nombre }))); } catch (e) { /* la base es opcional */ }
      }
      const sinCuit = bast.cliente.firmantes.filter(x => !x.cuit).length;
      $('bastXlsNombre').textContent = `${f.name} · ${bast.cliente.firmantes.length} firmantes` + (sinCuit ? ` (${sinCuit} sin CUIT)` : '');
      // CUIT y razón social del Excel, listos para traer de Complif.
      if (bast.cliente.cuit) $('cmpCuit').value = M.formatoCuit(bast.cliente.cuit);
      if (bast.cliente.cliente) $('cmpNombre').value = bast.cliente.cliente;
      // Sin PDF cargado, los poderes se traen solos de Complif (versión web).
      const conPdf = bast.pdf && bast.pdf !== 'Complif';
      if (!conPdf && hayComplif() && (bast.cliente.cuit || bast.cliente.cliente)) {
        Object.assign(bast, { pdf: null, poderesTodos: [], poderPresidente: null, edPorPoder: {}, actas: [] });   // nada del cliente anterior
        $('bastPdfNombre').textContent = 'Trayendo de Complif…';
        prepararBastanteo(); traerComplif(); return;
      }
      prepararBastanteo();
    } catch (e) { $('bastEstado').innerHTML = aviso('bad', 'No se pudo leer el Excel: ' + esc(e.message || e)); }
  });

  // ------------------------------------------------------------ Complif
  // Los poderes se bajan todos (50 por página, ~25 s) y se buscan por CUIT o razón social: el OCR no siempre trae
  // el CUIT. La lista queda 15 minutos en memoria. Pasa por Supabase (complif_get): el secret no llega al navegador.
  const cmp = { docs: null, cuando: 0, crudo: null };
  const hayComplif = () => !!(almacen && typeof almacen.rpc === 'function');
  const errorComplif = e => {
    const m = String((e && e.message) || e);
    return /complif_(get|estado|guardar)/i.test(m) && /(could not find|does not exist|no existe|schema cache)/i.test(m)
      ? 'Faltan las funciones de Complif en Supabase: correr el bloque "Complif" de supabase/esquema.sql (INSTRUCCIONES.md, punto 9).' : m;
  };
  async function complifGet(ruta) {
    const j = await almacen.rpc('complif_get', { p_ruta: ruta });
    if (!j || j.status !== 200) throw new Error(`Complif respondió HTTP ${j ? j.status : '?'}${j && j.error ? ': ' + j.error : ''}`);
    return j.body;
  }
  const listaComplif = b => (Array.isArray(b) ? b : (b && (b.data || b.items || b.results || b.documents)) || []);
  async function complifDocumentos(progreso) {
    if (cmp.docs && Date.now() - cmp.cuando < 15 * 60e3) return cmp.docs;
    const filtro = 'type=in.(' + M.COMPLIF_TIPOS.map(encodeURIComponent).join(',') + ')';
    const docs = [];
    let pagina = 0, fin = false;
    while (!fin && pagina < 400) {
      const lote = await Promise.all([0, 1, 2, 3].map(k => complifGet(`/api/documents/v1/organization?${filtro}&page=${pagina + k}`)));
      lote.forEach(b => { if (fin) return; const l = listaComplif(b); docs.push(...l); if (l.length < 50) fin = true; });
      pagina += 4;
      progreso(docs.length);
    }
    cmp.docs = docs; cmp.cuando = Date.now();
    return docs;
  }
  async function estadoComplif() {
    if (!hayComplif()) { $('cmpConfig').innerHTML = 'Complif se usa desde la versión web (con la base compartida).'; return; }
    try {
      const e = await almacen.rpc('complif_estado', {});
      if (e && e.base_url) $('cmpBase').value = e.base_url;
      $('cmpConfig').innerHTML = e && e.client_id && e.tiene_secret
        ? `<span class="chip ok">Configurada</span> ${esc(e.base_url)} · client ${esc(e.client_id)}… · secret cargado · ${esc(String(e.actualizado || '').slice(0, 16).replace('T', ' '))}`
        : '<span class="chip warn">Sin configurar</span> cargá el client id y el secret.';
    } catch (err) { $('cmpConfig').innerHTML = aviso('bad', esc(errorComplif(err))); }
  }
  // El CUIT se escribe con guiones: 30708192445 → 30-70819244-5.
  // Se ponen los guiones mientras se escribe (o al pegarlo).
  const guionesCuit = v => { const d = String(v || '').replace(/\D/g, '').slice(0, 11); return d.length > 10 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d; };
  $('cmpCuit').addEventListener('input', () => { const v = guionesCuit($('cmpCuit').value); if (v !== $('cmpCuit').value) $('cmpCuit').value = v; });
  $('detCmp').addEventListener('toggle', () => { if ($('detCmp').open) estadoComplif(); });
  $('btnCmpGuardar').addEventListener('click', async () => {
    try {
      await almacen.rpc('complif_guardar', { p_base_url: $('cmpBase').value.trim(), p_client_id: $('cmpId').value.trim(), p_client_secret: $('cmpSecret').value.trim() });
      $('cmpSecret').value = '';
      cmp.docs = null;
      await estadoComplif();
      toast('Conexión con Complif guardada para todos los usuarios');
    } catch (e) { $('cmpConfig').innerHTML = aviso('bad', 'No se pudo guardar: ' + esc(errorComplif(e))); }
  });
  $('btnCmpProbar').addEventListener('click', async () => {
    $('cmpConfig').textContent = 'Probando…';
    try {
      const b = await complifGet('/api/documents/v1/organization?type=eq.' + encodeURIComponent('Poder Complejo') + '&page=0');
      $('cmpConfig').innerHTML = aviso('ok', `Conexión OK: la primera página trae ${listaComplif(b).length} poderes complejos.`);
    } catch (e) { $('cmpConfig').innerHTML = aviso('bad', esc(errorComplif(e))); }
  });
  $('btnCmpCrudo').addEventListener('click', () => {
    const muestra = cmp.crudo && cmp.crudo.length ? cmp.crudo : (cmp.docs || []).slice(0, 2);
    $('cmpCrudo').textContent = muestra.length ? JSON.stringify(muestra.slice(0, 3), null, 1).slice(0, 30000) : 'Todavía no se trajo nada de Complif.';
    $('cmpCrudo').classList.remove('oculto');
  });
  $('btnCmpTraer').addEventListener('click', () => traerComplif());
  async function traerComplif() {
    if (!hayComplif()) { $('cmpEstado').innerHTML = aviso('warn', 'Complif se usa desde la versión web (con la base compartida).'); return; }
    const cuit = $('cmpCuit').value.replace(/\D/g, '') || (bast.cliente && bast.cliente.cuit) || '';
    const nombre = $('cmpNombre').value.trim() || (bast.cliente && bast.cliente.cliente) || '';
    if (!cuit && !nombre) { $('cmpEstado').innerHTML = aviso('warn', 'Cargá primero la planilla del cliente (Excel) o escribí el CUIT o la razón social.'); return; }
    const btn = $('btnCmpTraer');
    btn.disabled = true;
    $('cmpEstado').innerHTML = '<p class="sub">Bajando los poderes de Complif…</p>';
    try {
      const docs = await complifDocumentos(n => { $('cmpEstado').innerHTML = `<p class="sub">Bajando los poderes de Complif… ${n} documentos</p>`; });
      if (cuit.length === 11) $('cmpCuit').value = M.formatoCuit(cuit);
      const r = M.complifDeEmpresa(docs, cuit, nombre);
      cmp.crudo = docs.filter(d => (r.poderes.concat(r.actas)).some(p => p.complif.id != null && p.complif.id === (d.id_document || d.id || d.uuid)));
      const quien = esc(nombre || M.formatoCuit(cuit));
      const pres = r.poderes.length ? null : M.poderDelPresidente(r.actas);
      if (!r.poderes.length && !pres) {
        const leidos = docs.filter(d => M.poderDesdeComplif(d) || M.actaDesdeComplif(d)).length;
        if (!bast.pdf || bast.pdf === 'Complif') {
          Object.assign(bast, { pdf: null, poderesTodos: [], poderPresidente: null, edPorPoder: {}, actas: [] });
          $('bastPdfNombre').textContent = 'Arrastrá el PDF o hacé clic';
          prepararBastanteo();
        }
        $('cmpEstado').innerHTML = aviso('warn', `Complif no tiene poderes de <b>${quien}</b>${cuit ? ' (CUIT ' + esc(M.formatoCuit(cuit)) + ')' : ''}${r.actas.length ? ' (hay ' + r.actas.length + ' acta/s, sin presidente reconocible)' : ''}. Se revisaron ${docs.length} documentos` +
          (leidos < docs.length ? `; ${docs.length - leidos} no se pudieron interpretar (ver <i>Conexión con Complif → Ver la respuesta</i>)` : '') + '. Puede que el OCR no haya extraído el CUIT: probá con la razón social.');
        return;
      }
      r.poderes.forEach((p, k) => { p._k = 'complif' + k; });
      if (pres) pres._k = 'presidente';
      Object.assign(bast, { pdf: 'Complif', poderesTodos: r.poderes, poderPresidente: pres, edPorPoder: {}, actas: r.actas });
      $('bastPdfNombre').textContent = `Complif · ${r.poderes.length} poder${r.poderes.length === 1 ? '' : 'es'}` + (r.actas.length ? ` · ${r.actas.length} acta${r.actas.length === 1 ? '' : 's'}` : '') + (pres ? ` · sin poderes: presidente ${pres.presidente.nombre_completo}` : '');
      $('cmpEstado').innerHTML = aviso('ok', `Complif: ${r.poderes.length} poder${r.poderes.length === 1 ? '' : 'es'} y ${r.actas.length} acta${r.actas.length === 1 ? '' : 's'} de designación de <b>${quien}</b> (de ${docs.length} documentos). ` +
        '<ul style="margin:6px 0 0 18px">' + r.poderes.map(p => `<li>${esc(p.complif.type || 'Poder')} del ${esc(p.fecha_emision || 's/f')}${p.deed_number ? ', esc. ' + esc(p.deed_number) : ''}: ` +
          `${esc(p.apoderados.map(a => a.nombre_completo).join(', ') || 'sin apoderados')}` +
          `${p.razon_social && M.formatoCuit(p.cuit_empresa) !== M.formatoCuit(cuit) && cuit && p.cuit_empresa ? ` <span class="chip">${esc(p.razon_social)} · vinculado a la empresa en Complif</span>` : ''}${p.duplicados ? ` <span class="chip warn">${p.duplicados + 1} veces en Complif, se toma uno</span>` : ''}</li>`).join('') + '</ul>' +
        (r.actas.length ? `<div class="sub" style="margin:4px 0 0">Actas: ${r.actas.map(a => esc(a.fecha || 's/f')).join(', ')}.</div>` : ''));
      prepararBastanteo();
    } catch (e) { $('cmpEstado').innerHTML = aviso('bad', 'No se pudo consultar Complif: ' + esc(errorComplif(e))); }
    finally { btn.disabled = false; }
  }

  // Firmantes de la planilla que traen el DNI en lugar del CUIT: el CUIT sale de la base de entes, por número de
  // ente o, si no, por el DNI.
  async function completarCuitFirmantes(firmantes) {
    const faltan = firmantes.filter(x => !x.cuit);
    if (!faltan.length || !almacen) return;
    try {
      if (typeof almacen.buscarEntes === 'function') {
        const porEnte = await almacen.buscarEntes(faltan.map(x => x.ente).filter(Boolean));
        faltan.forEach(x => {
          const e = porEnte[x.ente];
          const c = e && String(e.cuit || '').replace(/\D/g, '');
          if (c && c.length === 11 && (!x.dni || c.slice(2, 10) === String(x.dni).padStart(8, '0'))) { x.cuit = c; x.fuente = 'base de entes (ente ' + x.ente + ')'; }
        });
      }
      const resto = faltan.filter(x => !x.cuit && x.dni);
      if (resto.length && typeof almacen.buscarCuitPorDni === 'function') {
        const porDni = await almacen.buscarCuitPorDni(resto.map(x => x.dni));
        resto.forEach(x => { const c = porDni[x.dni] || porDni[String(x.dni).replace(/^0+/, '')]; if (c) { x.cuit = String(c).replace(/\D/g, ''); x.fuente = 'base de entes (DNI)'; } });
      }
    } catch (e) { /* sin base: queda el DNI */ }
  }

  // Ediciones por poder: escritura (por la fecha de emisión, entre las de la planilla), acta, tipo y CUIT de cada DNI.
  async function prepararBastanteo() {
    // Se toman todos los poderes del PDF (sin filtrar por la empresa de la planilla).
    let todos = bast.poderesTodos || [];
    bast.avisoPresidente = '';
    const pp = !todos.length && bast.poderPresidente;
    if (pp) {
      const firmantes = bast.cliente && bast.cliente.firmantes;
      const quien = `<b>${esc(pp.presidente.nombre_completo)}</b> (DNI ${esc(pp.presidente.dni)}, ${esc(pp.usos[0].descripcion.split(' según')[0])})`;
      if (!firmantes) bast.avisoPresidente = aviso('warn', `El PDF no tiene "Acreditación de Poderes". El presidente del acta, ${quien}, recibe todas las facultades si figura en la planilla del cliente: cargá el Excel.`);
      else if (M.firmanteDe(pp.presidente, firmantes)) {
        todos = [pp];
        bast.avisoPresidente = aviso('warn', `El PDF no tiene "Acreditación de Poderes": se toma al presidente del acta de designación (${esc(pp.fecha_emision || 's/f')}), ${quien}, que está en la planilla como apoderado, con <b>todas las facultades</b> y firma individual. Revisalo antes de usar el JSON.`);
      } else bast.avisoPresidente = aviso('bad', `El PDF no tiene "Acreditación de Poderes" y el presidente del acta, ${quien}, no figura en la planilla del cliente: no se arma el bastanteo.`);
    }
    bast.poderes = todos.slice();
    bast.otrosPoderes = [];
    bast.edPorPoder = bast.edPorPoder || {};
    if (!bast.poderes.length) { bast.ediciones = []; renderBastanteo(); return; }
    const esc_ = (bast.cliente && bast.cliente.escrituras) || [];
    bast.ediciones = bast.poderes.map(p => {
      const prev = bast.edPorPoder[p._k] || {};
      const candidatas = esc_.filter(e => e.fecha === p.fecha_emision);
      const ed = Object.assign({ deed_number: p.deed_number || '', board_resolution_power_attorney: p.board_resolution_power_attorney || '',
        power_attorney_type: p.power_attorney_type || 'Poder Especial para Operaciones Bancarias', cuits: {}, facultades: p.usos.map(() => ({})) }, prev, { candidatas });
      // Si con esa fecha hay varias escrituras se propone la última (en la planilla, la del poder va después del acta).
      if (!ed.deed_number && candidatas.length) ed.deed_number = candidatas[candidatas.length - 1].numero;
      bast.edPorPoder[p._k] = ed;
      return ed;
    });
    // CUIT de los DNI que no están en la planilla: base de entes.
    const dnis = bast.poderes.flatMap(p => [p.otorgante.dni].concat(p.apoderados.map(a => a.dni))).filter(Boolean)
      .filter(d => !M.cuitPorDni(d, bast.cliente && bast.cliente.firmantes) && !(d in bast.cuitsBase));
    if (dnis.length && almacen && typeof almacen.buscarCuitPorDni === 'function') {
      try { Object.assign(bast.cuitsBase, await almacen.buscarCuitPorDni(dnis)); } catch (e) { /* sin base: queda el DNI */ }
      dnis.forEach(d => { if (!(d in bast.cuitsBase)) bast.cuitsBase[d] = ''; });
    }
    renderBastanteo();
  }

  function cuitDe(i, dni) {
    const ed = bast.ediciones[i] || {};
    if (ed.cuits && ed.cuits[dni]) return { cuit: ed.cuits[dni], fuente: 'cargado' };
    const c = M.cuitPorDni(dni, bast.cliente && bast.cliente.firmantes);
    if (c) return { cuit: c, fuente: 'planilla' };
    if (bast.cuitsBase[dni]) return { cuit: bast.cuitsBase[dni], fuente: 'base de entes' };
    return { cuit: '', fuente: '' };
  }
  function jsonDe(i) {
    const ed = bast.ediciones[i];
    const cuits = {};
    const p = bast.poderes[i];
    const firmantes = bast.cliente && bast.cliente.firmantes;
    // CUIT cargado a mano; si no, el de la planilla (lo resuelve jsonPoder); si no, el de la base de entes.
    [p.otorgante].concat(p.apoderados).forEach(x => {
      const d = x.dni;
      if ((ed.cuits || {})[d]) cuits[d] = ed.cuits[d];
      else if (!(firmantes && M.firmanteDe(x, firmantes)) && bast.cuitsBase[d]) cuits[d] = bast.cuitsBase[d];
    });
    return M.jsonPoder(p, bast.cliente, Object.assign({}, ed, { cuits }));
  }

  function renderBastanteo() {
    const hay = bast.poderes.length > 0;
    $('bastAcciones').classList.toggle('oculto', !hay);
    let estado = '';
    estado += bast.avisoPresidente || '';
    if (hay && !bast.cliente) estado += aviso('warn', 'Falta la planilla del cliente: sin ella no se completan los CUIT de los firmantes ni la escritura, y se muestran todas las personas del PDF.');
    const otros = bast.otrosPoderes || [];
    if (otros.length) estado += aviso(hay ? 'ok' : 'warn', `${hay ? '' : '<b>Ningún poder del PDF es de la empresa de la planilla</b> (CUIT ' + esc(M.formatoCuit(bast.cliente.cuit)) + '). '}` +
      `Se ${otros.length === 1 ? 'deja afuera 1 poder' : 'dejan afuera ' + otros.length + ' poderes'} de otra empresa: ` +
      otros.map(p => `${esc(p.razon_social || '—')} (CUIT ${esc(M.formatoCuit(p.cuit_empresa) || 'sin dato')}, ${esc(p.fecha_emision || '')})`).join(' · '));
    const sp = hay ? sinPoder() : [];
    if (sp.length) estado += aviso('warn', `<b>${sp.length} firmante${sp.length > 1 ? 's' : ''} de la planilla sin poder en el PDF.</b> Quedan cargados en el JSON único, sin grupo y con una advertencia. Revisá si falta el poder.`) +
      `<div class="tabla-caja" style="margin-bottom:10px"><table><thead><tr><th>Nombre</th><th>CUIT</th><th>Situación</th></tr></thead><tbody>` +
      sp.map(f => `<tr><td>${esc(f.nombre)}</td><td>${f.cuit ? esc(M.formatoCuit(f.cuit)) : 'DNI ' + esc(f.dni) + ' (sin CUIT)'}</td><td><span class="chip warn">en la planilla, sin poder</span></td></tr>`).join('') + '</tbody></table></div>';
    $('bastEstado').innerHTML = estado;
    renderBastUnico();
    renderControlResumen();
    $('bastPoderes').innerHTML = bast.poderes.map((p, i) => {
      const ed = bast.ediciones[i] || {};
      const j = jsonDe(i);
      const firmantes = bast.cliente && bast.cliente.firmantes && bast.cliente.firmantes.length ? bast.cliente.firmantes : null;
      // Con planilla, los apoderados del PDF que no están en ella no se muestran ni van al JSON.
      const apod = firmantes ? p.apoderados.filter(a => M.firmanteDe(a, firmantes)) : p.apoderados;
      const fuera = firmantes ? p.apoderados.filter(a => !M.firmanteDe(a, firmantes)) : [];
      const personas = [['Otorgante', p.otorgante]].concat(apod.map(a => ['Apoderado', a]));
      const filaPersona = ([rol, x]) => {
        const f = rol === 'Apoderado' && firmantes ? M.firmanteDe(x, firmantes) : null;
        const c = f && !(bast.ediciones[i].cuits || {})[x.dni] ? { cuit: String(f.cuit || '').replace(/\D/g, ''), fuente: f.fuente || 'planilla' } : cuitDe(i, x.dni);
        return `<tr><td>${rol}</td><td>${esc(x.nombre_completo)}</td><td>${esc(x.dni)}</td>` +
          `<td><input data-bast-cuit="${i}" data-dni="${esc(x.dni)}" value="${esc(c.cuit)}" placeholder="CUIT (11 dígitos)" inputmode="numeric" style="max-width:150px"></td>` +
          `<td>${c.cuit ? `<span class="chip ok">${esc(c.fuente)}</span>` : '<span class="chip warn">sin CUIT: va el DNI</span>'}</td></tr>`;
      };
      const usos = p.usos.map((u, n) => {
        const fac = j.estructuras_de_firma[n].facultades;
        const celdas = M.BASTANTEO_CLAVES.map(k => {
          const cat = nombreCatalogo[k], nombre = cat ? cat[1] : M.BASTANTEO_EXTRA[k] || k;
          const fuente = (ed.facultades[n] || {})[k] !== undefined ? 'man' : k in u.facultades ? 'pdf' : bast.cliente && bast.cliente.marcas[k] ? 'xls' : 'nd';
          const tit = { man: 'cambiado a mano', pdf: 'del PDF', xls: 'de las marcas X de la planilla', nd: 'sin dato en el PDF ni en la planilla' }[fuente];
          return `<label class="check" title="${esc(tit)}" style="justify-content:flex-start;${fuente === 'nd' ? 'opacity:.7;' : ''}${fuente === 'xls' ? 'border-color:var(--warn);' : ''}${fuente === 'man' ? 'border-color:var(--accent);' : ''}">` +
            `<input type="checkbox" style="flex:none" data-bast-fac="${i}" data-uso="${n}" data-clave="${k}" ${fac[k] ? 'checked' : ''}> <span><b style="font-size:11px">${esc(cat ? cat[0] : '—')}</b> ${esc(nombre)}</span></label>`;
        }).join('');
        const si = Object.values(fac).filter(Boolean).length;
        return `<h3>Uso de firma ${n} · ${esc(u.tipo || '—')} · ${esc(u.descripcion || '')}</h3>` +
          (u.limitaciones ? `<p class="sub" style="margin:0 0 8px">Limitaciones: ${esc(u.limitaciones)}</p>` : '') +
          `<p class="sub" style="margin:0 0 6px">${si} de ${M.BASTANTEO_CLAVES.length} facultades habilitadas. Borde normal = del PDF · <span style="color:var(--warn)">ámbar</span> = de la planilla · tenue = sin dato (va "no") · <span style="color:var(--accent)">rojo</span> = cambiado a mano.</p>` +
          `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:6px">${celdas}</div>`;
      }).join('');
      const opcEsc = (ed.candidatas || []).map(e => e.numero);
      return `<div class="card">
        <h2>${esc(p.razon_social || 'Poder ' + (i + 1))}</h2>
        <p class="sub">CUIT ${esc(M.formatoCuit(p.cuit_empresa) || '—')} · emitido el ${esc(p.fecha_emision || '—')}</p>
        <div class="grid">
          <label class="campo">Escritura Nº <input data-bast-campo="deed_number" data-i="${i}" value="${esc(ed.deed_number || '')}" list="bastEsc${i}">
            <datalist id="bastEsc${i}">${opcEsc.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
            <span class="ayuda">${opcEsc.length > 1 ? `En la planilla hay ${opcEsc.length} escrituras con esa fecha: ${esc(opcEsc.join(', '))}` : opcEsc.length ? 'Tomada de la planilla (misma fecha)' : 'No está en la planilla: cargala'}</span></label>
          <label class="campo">Acta de directorio (poder) <input data-bast-campo="board_resolution_power_attorney" data-i="${i}" value="${esc(ed.board_resolution_power_attorney || '')}"></label>
          <label class="campo">Tipo de poder <input data-bast-campo="power_attorney_type" data-i="${i}" value="${esc(ed.power_attorney_type || '')}"></label>
        </div>
        <h3>Personas</h3>
        <div class="tabla-caja"><table><thead><tr><th>Rol</th><th>Nombre</th><th>DNI</th><th>CUIT (número de identificación)</th><th>Origen</th></tr></thead><tbody>${personas.map(filaPersona).join('')}</tbody></table></div>
        ${!apod.length && p.apoderados.length ? aviso('warn', 'Ningún apoderado de este poder está en la planilla del cliente.') : ''}
        ${fuera.length ? `<p class="sub" style="margin:6px 0 0">No se incluyen (están en el PDF pero no en la planilla): ${esc(fuera.map(a => a.nombre_completo).join(', '))}</p>` : ''}
        ${usos}
        <div class="acciones">
          <button class="btn primario" type="button" data-bast-bajar="${i}">Descargar JSON</button>
          <button class="btn" type="button" data-bast-ver="${i}">Ver JSON</button>
        </div>
        <pre class="codigo oculto" id="bastJson${i}"></pre>
      </div>`;
    }).join('');
  }
  $('bastPoderes').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.bastCuit != null) {
      const i = Number(t.dataset.bastCuit), d = t.value.replace(/\D/g, '');
      if (d && d.length !== 11) { toast('El CUIT tiene que tener 11 dígitos'); return; }
      bast.ediciones[i].cuits[t.dataset.dni] = d;
      renderBastanteo();
    } else if (t.dataset.bastCampo) {
      bast.ediciones[Number(t.dataset.i)][t.dataset.bastCampo] = t.value.trim();
    } else if (t.dataset.bastFac != null) {
      const ed = bast.ediciones[Number(t.dataset.bastFac)];
      ed.facultades[Number(t.dataset.uso)][t.dataset.clave] = t.checked;
      renderBastanteo();
    }
  });
  const nombreJsonPoder = (i, j) => `PODER_${String(j.razon_social || 'poder').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}${j.deed_number ? '_esc' + j.deed_number : ''}.json`;
  $('bastPoderes').addEventListener('click', e => {
    const b = e.target.closest('[data-bast-bajar]'), v = e.target.closest('[data-bast-ver]');
    if (b) { const i = Number(b.dataset.bastBajar), j = jsonDe(i); descargar(nombreJsonPoder(i, j), JSON.stringify(j, null, 2), true); }
    if (v) { const i = Number(v.dataset.bastVer), pre = $('bastJson' + i); pre.textContent = JSON.stringify(jsonDe(i), null, 2); pre.classList.toggle('oculto'); }
  });
  // Un solo JSON con todos los poderes, agrupando apoderados por tipo de firma y facultades.
  const sinPoder = () => (bast.cliente ? M.firmantesSinPoder(bast.poderes, bast.cliente.firmantes) : []);
  function jsonUnico() { return M.jsonBastanteoUnico(bast.poderes.map((p, i) => jsonDe(i)), bast.cliente && Object.assign({}, bast.cliente, { sinPoder: sinPoder() })); }
  // Control del resumen (Excel) contra los poderes, firmante por firmante: uso de firma, grupo, conjuntas y límite.
  function renderControlResumen() {
    if (!bast.poderes.length || !bast.cliente || !bast.cliente.firmantes.length) { $('bastControl').innerHTML = ''; return; }
    const filas = M.controlResumen(jsonUnico(), bast.cliente);
    const marca = ok => (ok === true ? '<b style="color:var(--ok)">✓</b>' : ok === false ? '<b style="color:var(--bad)">✗</b>' : '<span class="sub">—</span>');
    const conDif = filas.filter(f => f.puntos.some(p => p.ok === false));
    const orden = conDif.concat(filas.filter(f => !conDif.includes(f)));
    $('bastControl').innerHTML = `<h3>Control del resumen contra los poderes</h3>` +
      aviso(conDif.length ? 'warn' : 'ok', conDif.length ? `<b>${conDif.length} de ${filas.length} firmantes con diferencias.</b> ✓ = el resumen y el poder coinciden · ✗ = difieren.` : `Los ${filas.length} firmantes del resumen coinciden con los poderes.`) +
      `<div class="tabla-caja"><table><thead><tr><th>Firmante</th><th>Resumen (Excel)</th><th>Punto</th><th></th><th>Dice el resumen</th><th>Dice el poder</th></tr></thead><tbody>` +
      orden.map(f => f.puntos.map((p, i) => `<tr>${i ? '' : `<td rowspan="${f.puntos.length}"><b>${esc(f.nombre)}</b><div class="sub" style="margin:0">${esc(M.formatoCuit(f.ident) || '')}</div></td><td rowspan="${f.puntos.length}">${esc(f.resumen || '—')}</td>`}` +
        `<td>${esc(p.punto)}</td><td>${marca(p.ok)}</td><td>${esc(p.resumen)}</td><td style="white-space:normal;max-width:420px">${esc(p.poder)}${p.detalle ? `<div style="color:var(--bad);font-size:12px">${esc(p.detalle)}</div>` : ''}</td></tr>`).join('')).join('') +
      '</tbody></table></div>';
  }

  function renderBastUnico() {
    if (!bast.poderes.length) { $('bastUnico').innerHTML = ''; return; }
    const u = jsonUnico();
    // Diferencia de cada grupo con el primero: qué facultades tiene de más (+) y de menos (−).
    const base = u.estructuras_de_firma[0];
    const nombreFac = k => (nombreCatalogo[k] ? nombreCatalogo[k][1] : M.BASTANTEO_EXTRA[k] || k);
    const diferencia = e => {
      if (e === base) return '<span class="sub">referencia</span>';
      const mas = M.BASTANTEO_CLAVES.filter(k => e.facultades[k] && !base.facultades[k]).map(nombreFac);
      const menos = M.BASTANTEO_CLAVES.filter(k => !e.facultades[k] && base.facultades[k]).map(nombreFac);
      if (!mas.length && !menos.length) return `<span class="sub">mismas facultades (otro tipo de firma o grupo del poder)</span>`;
      return (mas.length ? `<div style="white-space:normal"><b style="color:var(--ok)">+</b> ${esc(mas.join(', '))}</div>` : '') +
        (menos.length ? `<div style="white-space:normal"><b style="color:var(--bad)">−</b> ${esc(menos.join(', '))}</div>` : '');
    };
    $('bastUnico').innerHTML = `<h3>JSON único: ${u.estructuras_de_firma.length} grupos de firma</h3><div class="tabla-caja"><table><thead><tr><th>Grupo</th><th>Tipo</th><th>Combinaciones</th><th>Apoderados</th><th class="num">Facultades</th><th>Escrituras</th><th>Diferencia con el grupo ${esc(base.grupo)}</th></tr></thead><tbody>` +
      u.estructuras_de_firma.map(e => `<tr><td><b>${esc(e.grupo)}</b></td><td>${esc(e.tipo_de_firma || '')}</td><td>${esc((e.combinaciones || []).join('; '))}${e.combinaciones_sin_firmantes ? `<div style="color:var(--muted);font-size:12px" title="El poder la permite, pero no hay firmantes suficientes en la planilla">sin firmantes: ${esc(e.combinaciones_sin_firmantes.join('; '))}</div>` : ''}</td><td>${esc(u.apoderados.filter(a => e.apoderados.includes(a.numero_de_identificacion)).map(a => a.nombre_completo).join(', '))}</td>` +
        `<td class="num">${Object.values(e.facultades).filter(Boolean).length}</td><td>${esc(e.escrituras.join(', '))}</td><td style="min-width:260px">${diferencia(e)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  $('btnBastUnico').addEventListener('click', () => {
    const u = jsonUnico();
    descargar(`BASTANTEO_${String(u.razon_social || 'cliente').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}.json`, JSON.stringify(u, null, 2), true);
  });
  $('btnBastUnicoVer').addEventListener('click', () => { const pre = $('bastUnicoJson'); pre.textContent = JSON.stringify(jsonUnico(), null, 2); pre.classList.toggle('oculto'); });
  $('btnBastLimpiar').addEventListener('click', () => {
    $('cmpEstado').innerHTML = ''; $('cmpCuit').value = ''; $('cmpNombre').value = ''; cmp.crudo = null;
    Object.assign(bast, { pdf: null, xls: null, poderes: [], poderesTodos: [], poderPresidente: null, avisoPresidente: '', actas: [], otrosPoderes: [], edPorPoder: {}, cliente: null, ediciones: [], cuitsBase: {} });
    $('bastPdfNombre').textContent = 'Arrastrá el PDF o hacé clic';
    $('bastXlsNombre').textContent = 'Arrastrá el Excel o hacé clic';
    $('bastUnicoJson').classList.add('oculto');
    renderBastanteo();
    toast('Bastanteo limpio: cargá los archivos del próximo cliente');
  });
  $('btnBastTodos').addEventListener('click', async () => {
    for (let i = 0; i < bast.poderes.length; i++) {
      const j = jsonDe(i);
      await descargar(nombreJsonPoder(i, j), JSON.stringify(j, null, 2), true);
      await new Promise(r => setTimeout(r, 400));
    }
  });

  // ============================================================ LOTE

  function periodoActual() {
    const d = new Date();
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0');
  }

  let clientePendiente = null; // cliente recién creado para dejarlo seleccionado

  function renderSelectClientes() {
    const sel = $('fCliente');
    const previo = clientePendiente || sel.value;
    clientePendiente = null;
    const clientes = datos().clientes;
    const hay = clientes.length > 0;
    $('sinClientes').classList.toggle('oculto', hay);
    $('cardFormulario').classList.toggle('oculto', !hay);
    $('cardArchivo').classList.toggle('oculto', !hay);
    sel.innerHTML = hay ? '<option value="">Elegí un cliente…</option>' + clientes.map(c =>
      `<option value="${c.id}">${esc(c.nombre)} · Negocio ${esc(c.negocio)} · ${esc(c.cuit)}</option>`).join('') : '';
    if (previo && clientePorId(previo)) sel.value = previo;
    else if (clientes.length === 1) sel.value = clientes[0].id;
    const hSel = $('hCliente');
    const hPrevio = hSel.value;
    hSel.innerHTML = '<option value="">Todos</option>' + clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    hSel.value = clientePorId(hPrevio) ? hPrevio : '';
    if (sel.value !== clienteFormulario) alCambiarCliente();
  }

  const tipoAccion = () => document.querySelector('input[name="fTipo"]:checked').value;
  let clienteFormulario = null;

  function alCambiarCliente() {
    clienteFormulario = $('fCliente').value;
    const c = clientePorId(clienteFormulario);
    $('fNegocio').value = c ? c.negocio : '';
    $('fCedente').value = c ? c.cuit : '';
    if (c && c.tasa !== '' && c.tasa != null) $('fTasa').value = c.tasa;
    $('fSecuenciaManual').checked = false;
    actualizarFormulario();
  }

  function actualizarFormulario() {
    const c = clientePorId($('fCliente').value);
    if (c) { $('fNegocio').value = c.negocio; $('fCedente').value = c.cuit; }
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

  function erroresSecuencia(clienteId, secuencia) {
    const usada = lotesDe(clienteId).find(l => l.secuencia === secuencia);
    return usada ? [`La secuencia ${secuencia} ya fue usada por este cliente (lote del ${new Date(usada.fecha).toLocaleDateString('es-AR')}).`] : [];
  }

  function estadoFormulario() {
    const c = clientePorId($('fCliente').value);
    const p = parametros();
    const faltantes = [
      [!c, 'fCliente', 'Cliente'], [!p.periodo, 'fPeriodo', 'Periodo'],
      [!p.tasa, 'fTasa', 'Tasa de descuento'], [!$('fSecuencia').value, 'fSecuencia', 'Secuencia'],
    ];
    faltantes.forEach(([falta, id]) => $(id).classList.toggle('falta', falta));
    const faltan = faltantes.some(([falta]) => falta);
    const errores = c ? M.validarFormulario(Object.assign({}, p, { tasa: p.tasa === '' ? null : Number(p.tasa) })) : [];
    if (c) errores.push(...erroresSecuencia(c.id, p.secuencia));
    return { cliente: c, p, estado: faltan ? 'INCOMPLETO' : errores.length ? 'REVISAR DATOS' : 'LISTO', errores,
      faltantes: faltantes.filter(([falta]) => falta).map(f => f[2]) };
  }

  function renderEstadoFormulario(ef) {
    const clase = ef.estado === 'LISTO' ? 'ok' : ef.estado === 'INCOMPLETO' ? 'gris' : 'bad';
    let html = `<div class="acciones">Estado del formulario: <span class="chip ${clase}">${ef.estado}</span></div>`;
    if (ef.estado === 'INCOMPLETO') html = html.replace('</div>', ` <span class="sub" style="margin:0">Falta completar: <b>${ef.faltantes.join(', ')}</b></span></div>`);
    if (ef.estado === 'REVISAR DATOS') html += aviso('bad', ef.errores.map(esc).join('<br>'));
    $('estadoFormulario').innerHTML = html;
  }

  ['fPeriodo', 'fTasa', 'fSecuencia'].forEach(id => $(id).addEventListener('input', actualizarFormulario));
  $('fCliente').addEventListener('change', alCambiarCliente);
  $('fSecuenciaManual').addEventListener('change', actualizarFormulario);
  document.querySelectorAll('input[name="fTipo"]').forEach(r => r.addEventListener('change', actualizarFormulario));

  // --- archivo del cliente
  let archivo = null;   // { nombre, hojas: [{hoja, formato, cantidad, filas}], conciliacion }
  let preparado = null; // { reporte, cb, errores, total, hoja }

  const zona = $('zonaLote');
  zona.addEventListener('click', () => $('archivoLote').click());
  zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('archivoLote').click(); } });
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('encima'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
  zona.addEventListener('drop', e => {
    e.preventDefault(); zona.classList.remove('encima');
    if (e.dataTransfer.files.length) cargarArchivoLote(e.dataTransfer.files);
  });
  $('archivoLote').addEventListener('change', e => {
    const fs = [...e.target.files];
    e.target.value = '';
    if (fs.length) cargarArchivoLote(fs);
  });

  async function cargarArchivoLote(lista) {
    const files = [...lista];
    const file = files[0];
    try {
      $('motivoBloqueo').textContent = 'Leyendo ' + (files.length > 1 ? files.length + ' archivos' : file.name) + '…';
      // TXT de cuotas por banco (esquema MELI): todos los archivos empiezan con la cabecera CUOTAS.
      const txts = files.every(f => /\.txt$/i.test(f.name))
        ? await Promise.all(files.map(async f => ({ nombre: f.name, texto: await f.text() }))) : null;
      if (txts && txts.every(t => /^\uFEFF?CUOTAS/i.test(t.texto))) {
        archivo = { nombre: files.length > 1 ? `${files.length} archivos TXT` : file.name, txtMeli: txts.map(t => M.leerTxtMeli(t.nombre, t.texto)),
          crudas: [], hojas: [], conciliacion: null, interfazDe: undefined };
      } else {
        if (files.length > 1) throw new Error('Para este formato se carga un solo archivo. Solo el esquema MELI admite varios TXT a la vez.');
        const crudas = await leerHojas(file);
        const conc = crudas.find(h => M.normalizar(h.hoja).startsWith('conciliacion'));
        archivo = { nombre: file.name, crudas, hojas: [], conciliacion: conc ? M.leerConciliacion(conc.filas) : null, interfazDe: undefined };
      }
      $('aNombre').value = archivo.nombre;
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

  // Detecta las hojas útiles según la interfaz del cliente elegido (o el formato automático).
  // Devuelve un mensaje de error si el archivo no coincide.
  function prepararHojas() {
    const c = clientePorId($('fCliente').value);
    const interfaz = (c && c.interfaz) || null;
    const claveInterfaz = JSON.stringify(interfaz);
    if (archivo.interfazDe === claveInterfaz) return archivo.errorHojas || null;
    archivo.interfazDe = claveInterfaz;
    const esMeli = !!(interfaz && interfaz.tipo === 'meli-txt');
    if (archivo.txtMeli || esMeli) {
      archivo.interfaz = interfaz;
      const cant = archivo.txtMeli ? archivo.txtMeli.reduce((s, t) => s + t.filas.length, 0) : 0;
      archivo.hojas = archivo.txtMeli && esMeli ? [{ hoja: 'TXT MELI', formato: 'meli', cantidad: cant, filas: [] }] : [];
      archivo.errorHojas = !esMeli
        ? `Estos TXT son del esquema MELI y ${c ? c.nombre : 'el cliente'} no usa esa interfaz. Elegí el cliente MELI o cambiale la interfaz en Clientes.`
        : !archivo.txtMeli ? `${c.nombre} usa el esquema MELI: cargá los TXT de cuotas por banco (CUOTA_<BANCO>_<fecha>.txt). Podés elegir varios a la vez.` : null;
      $('aHoja').innerHTML = archivo.hojas.map((h, i) => `<option value="${i}">TXT de cuotas MELI — ${archivo.txtMeli.length} archivos (${fmtEntero(h.cantidad)} filas)</option>`).join('');
      return archivo.errorHojas;
    }
    const hojas = archivo.crudas.map(h => Object.assign(
      interfaz ? M.detectarHojaInterfaz(h.hoja, h.filas, interfaz) : M.detectarHoja(h.hoja, h.filas), { filas: h.filas }));
    const utiles = hojas.filter(h => h.formato && M.normalizar(h.hoja) !== 'glosario');
    archivo.hojas = utiles;
    archivo.interfaz = interfaz;
    archivo.errorHojas = utiles.length ? null : interfaz
      ? `El archivo no tiene las columnas de la interfaz de ${c.nombre} (${interfaz.banco}, ${interfaz.fecha}, ${interfaz.monto}). Revisá el archivo o la interfaz del cliente.`
      : 'No se encontró una hoja con los datos esperados (columnas cod_entidad_bancaria / dat_reconciliation_estimated_date, o COD_BANCO / MONTO / FECHA_VENCIMIENTO). Si el cliente usa otro formato, cargale una interfaz en Clientes.';
    // Por defecto: la hoja con más filas (en automático, la de cupones GetNet).
    const porDefecto = (interfaz ? utiles : utiles.filter(h => h.formato === 'getnet' || h.formato === 'getnetCupones')).slice().sort((a, b) => b.cantidad - a.cantidad)[0] || utiles[0];
    $('aHoja').innerHTML = utiles.map((h, i) => `<option value="${i}" ${h === porDefecto ? 'selected' : ''}>${esc(h.hoja)} — ${interfaz ? 'Interfaz ' + esc(interfaz.nombre) : M.FORMATOS[h.formato].nombre} (${fmtEntero(h.cantidad)} filas)</option>`).join('');
    return archivo.errorHojas;
  }
  $('aHoja').addEventListener('change', reevaluarArchivo);
  $('aMonto').addEventListener('change', reevaluarArchivo);

  function reevaluarArchivo() {
    if (!almacen || !almacen.datos) return;
    const ef = estadoFormulario();
    renderEstadoFormulario(ef);
    const bloqueos = [];
    if (almacen.puedeEscribir === false) bloqueos.push('tu acceso es de solo lectura');
    if (!ef.cliente) bloqueos.push('elegí el cliente');
    else if (ef.estado !== 'LISTO') bloqueos.push('completá el formulario');
    if (!datos().bancos.length) bloqueos.push('cargá la tabla de bancos');
    if (!archivo) {
      preparado = null;
      bloqueos.push('cargá el archivo del cliente');
      mostrarBloqueo(bloqueos);
      return;
    }
    const errorHojas = prepararHojas();
    if (errorHojas) {
      preparado = null;
      $('resumenArchivo').innerHTML = aviso('bad', esc(errorHojas));
      $('controlBancos').innerHTML = '';
      $('aMontoCaja').classList.add('oculto');
      bloqueos.push('el archivo no coincide con el formato del cliente');
      mostrarBloqueo(bloqueos);
      return;
    }
    const hoja = archivo.hojas[Number($('aHoja').value) || 0];
    $('aMontoCaja').classList.toggle('oculto', hoja.formato !== 'getnet');
    let reporte, bancosUso = datos().bancos, meli = null;
    if (hoja.formato === 'meli') {
      meli = armarReporteMeli();
      reporte = meli.reporte;
      bancosUso = M.bancosParaMeli(datos().bancosMeli, datos().bancos);
    } else reporte = M.armarReporte(hoja.filas, hoja, { columnaMonto: $('aMonto').value, interfaz: archivo.interfaz,
      codigoPorNombre: M.crearBuscadorBancoPorNombre(datos().bancos, datos().bancosMeli) });
    const errores = M.controlarReporte(reporte);
    const cb = M.controlarBancos(reporte, bancosUso);
    const total = M.round2(reporte.reduce((s, r) => s + (r.MONTO || 0), 0));
    const fechas = reporte.map(r => r.FECHA_VENCIMIENTO).filter(f => f != null);
    preparado = { reporte, errores, cb, total, hoja, bancosUso,
      opcCuotas: meli ? { orden: 'nombre' } : null, opcCreditos: meli ? { nombre: 'sinComas' } : null };

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
    if (reporte.ignoradas) {
      const pie = (reporte.totalesPie || [])[0];
      html += pie != null && Math.abs(pie - total) >= 0.01
        ? aviso('warn', `Se ignoró ${reporte.ignoradas === 1 ? 'una fila' : reporte.ignoradas + ' filas'} sin banco ni fecha (total al pie). Atención: ese total ($ ${fmtMonto(pie)}) no coincide con la suma de los cupones ($ ${fmtMonto(total)}); revisá el archivo con el cliente.`)
        : aviso('ok', `Se ignoró ${reporte.ignoradas === 1 ? 'una fila' : reporte.ignoradas + ' filas'} sin banco ni fecha${pie != null ? ' (total al pie, coincide con la suma)' : ''}.`);
    }
    if (meli) html += meli.html;
    if (errores.length) html += aviso('bad', `<b>El archivo tiene ${errores.length} filas con datos inválidos:</b><ul>${errores.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join('')}${errores.length > 8 ? '<li>…</li>' : ''}</ul>`);
    $('resumenArchivo').innerHTML = html;

    if (cb.conProblemas.length) {
      $('controlBancos').innerHTML = aviso('bad', `<b>ACTUALIZAR BANCOS:</b> ${cb.conProblemas.length} bancos del archivo no están completos en la tabla Bancos. Corregilos para poder procesar.`) +
        `<div class="tabla-caja"><table><thead><tr><th class="num">Cód.</th><th>Nombre en el archivo</th><th class="num">Filas</th><th>Problema</th><th></th></tr></thead><tbody>${
          cb.conProblemas.map(d => `<tr><td class="num">${d.codigo}</td><td>${esc(d.nombreArchivo)}</td><td class="num">${d.filas}</td>
          <td>${esc(d.problemas.join(' · '))}</td><td>${meli ? '<button class="btn chico" data-ir="bancosmeli">Ir a Bancos MELI</button>' : `<button class="btn chico" data-escribe data-arreglar-banco="${d.codigo}">${d.banco ? 'Editar banco' : 'Agregar banco'}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      $('controlBancos').innerHTML = cb.detalle.length ? aviso('ok', `Mapeo de bancos OK: los ${cb.detalle.length} bancos del archivo tienen CUIT, provincia y sucursal.`) : '';
    }
    if (!reporte.length) bloqueos.push('el archivo no tiene filas');
    if (errores.length) bloqueos.push('corregí las filas inválidas del archivo');
    if (cb.conProblemas.length) bloqueos.push('completá los bancos marcados');
    if (meli && meli.sinBanco.length) bloqueos.push('hay TXT sin banco en la tabla Bancos MELI');
    if (meli && meli.conErrores.length) bloqueos.push('hay TXT con errores de formato');
    const choques = M.prefijosRepetidos(cb.detalle.map(d => d.codigo));
    if (choques.length) {
      $('controlBancos').innerHTML += aviso('bad', '<b>Números de crédito repetidos:</b> ' + choques.map(c =>
        `los bancos ${c.bancos.join(' y ')} comparten los 3 dígitos ${c.prefijo}`).join('; ') + '. Revisá los códigos de banco del archivo.');
      bloqueos.push('hay bancos con los mismos 3 dígitos');
    }
    mostrarBloqueo(bloqueos);
    aplicarPermisos();
  }

  // Reporte a partir de los TXT MELI: detecta el banco de cada archivo en la tabla Bancos MELI.
  function armarReporteMeli() {
    const reporte = [], sinBanco = [], conErrores = [], filasTabla = [];
    archivo.txtMeli.forEach(t => {
      const m = M.bancoMeliDeTxt(t, datos().bancosMeli);
      if (t.errores.length) conErrores.push(t);
      if (!m) sinBanco.push(t);
      else t.filas.forEach(f => reporte.push({ ID_LOTE: t.archivo, COD_BANCO: Number(m.banco.numero), NOMBRE_BANCO: t.cobis || m.banco.cobis,
        MONTO: f.monto, FECHA_VENCIMIENTO: f.fecha, PLAZO: null, TNA: null, TEA: null, CFT: null }));
      filasTabla.push(`<tr><td>${esc(t.archivo)}</td><td>${m ? `<b>${esc(m.banco.numero)}</b> · ${esc(m.banco.nombre || m.banco.cobis)}` : '<span class="chip bad">Sin banco</span>'}</td>
        <td>${m ? (m.por === 'nombre' ? 'Nombre del archivo' : 'CUIT de la cabecera') : ''}${m && m.cuitDistinto ? ' <span class="chip warn" title="El CUIT de la cabecera no coincide con el de la tabla">CUIT distinto</span>' : ''}</td>
        <td>${esc(t.cuit)}</td><td class="num">${fmtEntero(t.filas.length)}</td><td class="num">${fmtMonto(t.filas.reduce((s, f) => s + f.monto, 0))}</td>
        <td>${t.errores.length ? `<span class="chip bad" title="${esc(t.errores.join(' · '))}">${esc(t.errores[0])}</span>` : '<span class="chip ok">OK</span>'}</td></tr>`);
    });
    let html = `<h3>Archivos TXT (${archivo.txtMeli.length})</h3><div class="tabla-caja" style="max-height:320px"><table><thead><tr><th>Archivo</th><th>Banco detectado</th><th>Detectado por</th>
      <th>CUIT cabecera</th><th class="num">Registros</th><th class="num">Total</th><th>Control</th></tr></thead><tbody>${filasTabla.join('')}</tbody></table></div>`;
    if (sinBanco.length) html += aviso('bad', `<b>${sinBanco.length} TXT sin banco:</b> ${esc(sinBanco.map(t => t.archivo).join(', '))}. Agregalos en la solapa Bancos MELI (nombre COBIS o CUIT). <button class="btn chico" type="button" data-ir="bancosmeli">Ir a Bancos MELI</button>`);
    if (conErrores.length) html += aviso('bad', `<b>${conErrores.length} TXT con errores:</b><ul>${conErrores.map(t => `<li>${esc(t.archivo)}: ${esc(t.errores.join(' · '))}</li>`).join('')}</ul>`);
    return { reporte, sinBanco, conErrores, html };
  }

  function mostrarBloqueo(bloqueos) {
    $('btnProcesar').disabled = procesando || bloqueos.length > 0;
    $('motivoBloqueo').textContent = bloqueos.length ? 'Para procesar: ' + bloqueos.join(', ') + '.' : '';
  }

  $('controlBancos').addEventListener('click', e => {
    const b = e.target.closest('[data-arreglar-banco]');
    if (!b) return;
    const codigo = Number(b.dataset.arreglarBanco);
    const existente = datos().bancos.find(x => Number(x.codigo) === codigo);
    const det = preparado.cb.detalle.find(d => d.codigo === codigo);
    abrirBanco(existente, { codigo, nombre: String(det.nombreArchivo || '').slice(0, 30), codCredito: M.codigoCreditoPorDefecto(codigo) });
  });

  // --- procesar
  let procesando = false;

  $('btnProcesar').addEventListener('click', async () => {
    const ef = estadoFormulario();
    if (ef.estado !== 'LISTO' || !preparado || preparado.errores.length || preparado.cb.conProblemas.length) { reevaluarArchivo(); return; }
    const c = ef.cliente;
    const p = Object.assign({}, ef.p, { tasa: Number(ef.p.tasa) });
    const manual = $('fSecuenciaManual').checked;
    const firma = [archivo.nombre, preparado.hoja.hoja, preparado.reporte.length, preparado.total].join('|');
    const repetido = lotesDe(c.id).find(l => l.firma === firma);
    let mensaje = `<table style="width:auto"><tbody>
      <tr><td>Cliente</td><td><b>${esc(c.nombre)}</b></td></tr><tr><td>Tipo de acción</td><td><b>${p.tipoAccion}</b></td></tr>
      <tr><td>Secuencia</td><td><b>${p.secuencia}</b></td></tr><tr><td>Lote</td><td><b>${p.lote}</b></td></tr>
      <tr><td>Periodo</td><td>${esc(p.periodo)}</td></tr><tr><td>Tasa</td><td>${p.tasa}</td></tr>
      <tr><td>Total</td><td>$ ${fmtMonto(preparado.total)}</td></tr></tbody></table>`;
    if (repetido) mensaje = aviso('warn', `Este archivo ya se procesó para ${esc(c.nombre)} con la secuencia ${repetido.secuencia}.`) + mensaje;
    if (!await confirmar('Generar lote', mensaje, 'Generar CSV')) return;

    procesando = true;
    $('btnProcesar').disabled = true;
    $('btnProcesar').textContent = 'Procesando…';
    const archivoActual = archivo, prep = preparado, columnaMonto = $('aMonto').value;
    let resultado = null;
    const r = await intentar(() => almacen.registrarLote(c.id, fresco => {
      // Se recalcula con el cliente releído de la base: si otro usuario procesó un lote mientras tanto, se frena.
      const esperada = M.calcularSecuenciaLote(fresco.ultimaSecuencia, p.tipoAccion).secuencia;
      if (!manual && esperada !== p.secuencia) {
        throw new Error(`Otro usuario procesó un lote de ${fresco.nombre} recién: la próxima secuencia ahora es ${esperada}. El formulario ya se actualizó; revisalo y volvé a generar.`);
      }
      if (erroresSecuencia(c.id, p.secuencia).length) throw new Error(`La secuencia ${p.secuencia} ya fue usada por este cliente.`);
      const hoy = new Date();
      const cuotas = M.generarCuotas(prep.reporte, prep.bancosUso, p, hoy, prep.opcCuotas);
      const creditos = M.generarCreditos(cuotas, prep.bancosUso, p, prep.opcCreditos);
      const txtCuotas = M.txtCuotas(cuotas), txtCreditos = M.txtCreditos(creditos);
      resultado = { cuotas, creditos, txtCuotas, txtCreditos };
      return {
        txtCuotas, txtCreditos,
        cambiosCliente: { ultimaSecuencia: Math.max(fresco.ultimaSecuencia, p.secuencia), tasa: p.tasa },
        lote: {
          id: nuevoId(), clienteId: c.id, fecha: hoy.toISOString(), archivo: archivoActual.nombre, hoja: prep.hoja.hoja,
          columnaMonto: prep.hoja.formato === 'getnet' ? columnaMonto : prep.hoja.formato === 'getnetCupones' ? 'MOV_AMOUNT_INSTALL' : prep.hoja.formato === 'interfaz' ? archivoActual.interfaz.monto : prep.hoja.formato === 'meli' ? 'importe TXT' : 'MONTO', firma,
          interfaz: prep.hoja.formato === 'interfaz' ? archivoActual.interfaz.nombre : prep.hoja.formato === 'meli' ? 'MELI (TXT por banco)' : null,
          tipoAccion: p.tipoAccion, secuencia: p.secuencia, lote: p.lote, periodo: p.periodo, tasa: p.tasa,
          secuenciaAnterior: fresco.ultimaSecuencia, filas: prep.reporte.length,
          cantCuotas: cuotas.filas.length, cantCreditos: creditos.filas.length, total: cuotas.encabezado.totalCapital,
          nombreCuotas: M.nombreArchivo('cuotas', hoy, 'csv', c.nombre), nombreCreditos: M.nombreArchivo('creditos', hoy, 'csv', c.nombre),
        },
      };
    }));
    procesando = false;
    $('btnProcesar').textContent = 'Procesar lote y generar CSV';
    if (!r) { refrescar(); return; }
    if (r.aviso) toast(r.aviso);
    mostrarResultado(r.lote, resultado, prep.reporte, prep.total);
    // El archivo ya procesado se descarta para evitar cargarlo dos veces por error.
    archivo = null; preparado = null;
    $('detalleArchivo').classList.add('oculto');
    $('fSecuenciaManual').checked = false;
    refrescar();
    toast(`Lote generado: secuencia ${r.lote.secuencia}`);
  });

  let resultadoActual = null;

  function mostrarResultado(lote, res, reporte, totalMonto) {
    const { cuotas, creditos } = res;
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
      if (b.dataset.descarga === 'cuotas') descargar(lote.nombreCuotas, res.txtCuotas);
      else descargar(lote.nombreCreditos, res.txtCreditos);
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

  function lotesFiltrados() {
    const cli = $('hCliente').value, tipo = $('hTipo').value, anulados = $('hAnulados').checked;
    return datos().lotes.filter(l => (!cli || l.clienteId === cli) && (!tipo || l.tipoAccion === tipo) && (anulados || !l.anulado));
  }

  // Historial de Cartera: lo generado (TXT, JSON, Excel) y los envíos a la API, de todos los usuarios.
  function renderHistorialCartera() {
    const regs = (datos().carteraHist || []).map(r => Object.assign({ tipo: 'gen' }, r));
    const envs = (datos().envios || []).map(e => ({ tipo: 'envio', id: e.id, creado: e.creado || e.fecha, usuarioId: e.usuarioId, accion: 'Envío a la API' + (e.destino ? ` (${e.destino})` : ''),
      estado: e.estado || (e.error ? 'error' : 'terminado'), lineas: e.cantidad || (e.lote && e.lote.operaciones ? e.lote.operaciones.length : ''), valor: e.total != null ? e.total : (e.lote && e.lote.total),
      ingresadas: e.ingresadas, conError: e.conError }));
    const todos = regs.concat(envs).filter(r => r.creado).sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    const compartido = almacen && almacen.modo === 'compartido';
    $('tablaHistCartera').innerHTML = todos.length ? `<table><thead><tr><th>Fecha</th>${compartido ? '<th>Usuario</th>' : ''}<th>Acción</th><th>Fuente / periodo</th><th class="num">Titulares</th><th class="num">Líneas</th><th class="num">Valor a descuento</th><th>Estado</th><th></th></tr></thead><tbody>` +
      todos.slice(0, 200).map(r => `<tr><td>${esc(new Date(r.creado).toLocaleString('es-AR'))}</td>${compartido ? `<td>${esc(quien(r.usuarioId))}</td>` : ''}<td><b>${esc(r.accion)}</b>${r.nombre ? `<div class="sub" style="margin:0">${esc(r.nombre)}</div>` : ''}</td>` +
        `<td>${esc(r.fuente || '')}${r.periodo ? ' · ' + esc(r.periodo) : ''}</td><td class="num">${r.titulares != null ? fmtEntero(r.titulares) : ''}</td><td class="num">${r.lineas ? fmtEntero(r.lineas) : ''}</td>` +
        `<td class="num">${r.valor != null && r.valor !== '' ? '$ ' + fmtMonto(Number(r.valor)) : ''}</td>` +
        `<td>${r.tipo === 'envio' ? `<span class="chip ${r.estado === 'terminado' && !r.conError ? 'ok' : r.estado === 'error' || r.conError ? 'bad' : 'warn'}">${esc(r.estado)}${r.ingresadas != null ? ` · ${r.ingresadas} ingresadas` : ''}${r.conError ? ` · ${r.conError} con error` : ''}</span>` : ''}</td>` +
        `<td>${r.txt ? `<button class="btn" type="button" data-hist-txt="${esc(r.id)}">Descargar TXT</button>` : ''}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="sub">Todavía no se generó nada desde Cartera.</p>';
  }
  $('tablaHistCartera').addEventListener('click', e => {
    const b = e.target.closest('[data-hist-txt]');
    if (!b) return;
    const r = (datos().carteraHist || []).find(x => x.id === b.dataset.histTxt);
    if (r && r.txt) descargar(r.nombre || 'NoCobis.txt', r.txt, true);
  });

  function renderHistorial() {
    renderHistorialCartera();
    const lista = lotesFiltrados().slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const vigentes = lista.filter(l => !l.anulado);
    const porTipo = t => vigentes.filter(l => l.tipoAccion === t);
    const kpi = (t, arr) => `<div class="kpi"><b>${fmtEntero(arr.length)}</b><span>${t} · $ ${fmtMonto(arr.reduce((s, l) => s + (l.total || 0), 0))}</span></div>`;
    $('hResumen').innerHTML = kpi('lotes vigentes', vigentes) + kpi('Alta', porTipo('Alta')) + kpi('Revolving', porTipo('Revolving'));
    if (!lista.length) {
      $('tablaHistorial').innerHTML = '<div class="vacio">Todavía no se procesó ningún lote. Los lotes aparecen acá al generar sus CSV en "Carga de lote".</div>';
      return;
    }
    const compartido = almacen.modo === 'compartido';
    const ultimos = new Map();
    datos().clientes.forEach(c => {
      // Último lote VIGENTE del cliente (los anulados no cuentan).
      const ls = lotesDe(c.id).filter(l => !l.anulado).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      if (ls.length) ultimos.set(c.id, ls[ls.length - 1].id);
    });
    $('tablaHistorial').innerHTML = `<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Archivo</th><th>Tipo</th><th class="num">Secuencia</th><th class="num">Lote</th>
      <th class="num">Periodo</th><th class="num">Cuotas</th><th class="num">Créditos</th><th class="num">Total capital</th>${compartido ? '<th>Procesó</th>' : ''}<th>CSV</th><th></th></tr></thead><tbody>${
      lista.map(l => {
        const c = clientePorId(l.clienteId);
        const tieneTxt = compartido ? !!l.txtPartes : !!(l.txtCuotas && l.txtCreditos);
        return `<tr${l.anulado ? ' style="opacity:.55"' : ''}><td>${new Date(l.fecha).toLocaleString('es-AR')}</td><td>${esc(c ? c.nombre : '(borrado)')}</td>
          <td title="Hoja: ${esc(l.hoja)} · MONTO: ${esc(l.columnaMonto)}">${esc(l.archivo)}</td><td>${esc(l.tipoAccion)}</td><td class="num">${l.secuencia}</td><td class="num">${l.lote}</td>
          <td class="num">${esc(l.periodo)}</td><td class="num">${l.cantCuotas}</td><td class="num">${l.cantCreditos}</td><td class="num">${fmtMonto(l.total)}</td>
          ${compartido ? `<td>${esc(quien(l.usuarioId))}</td>` : ''}
          <td>${tieneTxt ? `<button class="btn chico" data-h-cuotas="${l.id}">Cuotas</button> <button class="btn chico" data-h-creditos="${l.id}">Créditos</button>` : '<span class="chip gris">no guardado</span>'}</td>
          <td>${l.anulado ? '<span class="chip gris">Anulado</span>' : ultimos.get(l.clienteId) === l.id ? `<button class="btn chico peligro" data-escribe data-h-anular="${l.id}">Anular</button>`
            : `<button class="btn chico" data-escribe data-h-forzar="${l.id}" title="No es el último lote vigente del cliente: se anula sin cambiar la secuencia">Anular (forzar)</button>`}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
  ['hCliente', 'hTipo', 'hAnulados'].forEach(id => $(id).addEventListener('change', renderHistorial));

  $('btnExportarHistorial').addEventListener('click', () => {
    const lista = lotesFiltrados();
    if (!lista.length) { toast('No hay lotes para exportar'); return; }
    const aoa = [['Fecha', 'Cliente', 'Nº negocio', 'CUIT cedente', 'Tipo de acción', 'Secuencia', 'Lote', 'Periodo', 'Tasa',
      'Archivo', 'Hoja', 'Columna MONTO', 'Filas reporte', 'Registros cuotas', 'Registros créditos', 'Total capital',
      'CSV cuotas', 'CSV créditos', 'Estado', 'Procesó']].concat(lista.map(l => {
      const c = clientePorId(l.clienteId) || {};
      return [new Date(l.fecha), c.nombre || '(borrado)', c.negocio || '', c.cuit || '', l.tipoAccion, l.secuencia, l.lote,
        Number(l.periodo), l.tasa, l.archivo, l.hoja, l.columnaMonto, l.filas, l.cantCuotas, l.cantCreditos, l.total,
        l.nombreCuotas, l.nombreCreditos, l.anulado ? 'Anulado' : 'Vigente', quien(l.usuarioId)];
    }));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' });
    ws['!cols'] = aoa[0].map((h, i) => ({ wch: i === 9 ? 40 : Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lotes');
    descargarLibro('Historial-lotes-VALO.xlsx', wb);
  });

  $('tablaHistorial').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.dataset.hCuotas || b.dataset.hCreditos || b.dataset.hAnular || b.dataset.hForzar;
    const l = datos().lotes.find(x => x.id === id);
    if (!l) return;
    if (b.dataset.hCuotas || b.dataset.hCreditos) {
      b.disabled = true;
      try {
        const t = await almacen.leerTxt(l);
        if (!t) toast('Los CSV de este lote no están guardados');
        else if (b.dataset.hCuotas) await descargar(l.nombreCuotas, t.cuotas);
        else await descargar(l.nombreCreditos, t.creditos);
      } catch (err) {
        toast('No se pudieron leer los CSV: ' + (err.message || err));
      }
      b.disabled = false;
    }
    if (b.dataset.hAnular) {
      const c = clientePorId(l.clienteId);
      if (!await confirmar('Anular lote', `¿Anular el lote con secuencia <b>${l.secuencia}</b>? La última secuencia de ${esc(c ? c.nombre : 'el cliente')} vuelve a <b>${l.secuenciaAnterior}</b>.`, 'Anular', true)) return;
      await intentar(() => almacen.anularLote(l.id, { anulado: true, anuladoEn: new Date().toISOString() }), 'Lote anulado');
    }
    if (b.dataset.hForzar) {
      const c = clientePorId(l.clienteId);
      if (!await confirmar('Anular lote (forzado)', `<p>El lote con secuencia <b>${l.secuencia}</b> (${esc(l.archivo || '')}) <b>no es el último lote vigente</b> de ${esc(c ? c.nombre : 'el cliente')}.</p>` +
        `<p>Se marca como <b>anulado</b> y deja de contar en el historial, pero <b>la última secuencia del cliente no cambia</b> (sigue en <b>${c ? c.ultimaSecuencia : '?'}</b>). ` +
        'Si necesitás corregirla, editá el cliente en la pestaña Clientes.</p>', 'Anular igual', true)) return;
      await intentar(() => almacen.anularLote(l.id, { anulado: true, anuladoEn: new Date().toISOString(), anuladoForzado: true }, { forzar: true }), 'Lote anulado');
    }
  });

  // ============================================================ RESPALDO (solo modo local)

  $('btnRespaldo').addEventListener('click', () => {
    const d = new Date();
    const f = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    descargar(`respaldo-valo-${f}.json`, JSON.stringify(almacen.exportar(), null, 1));
  });
  $('btnRestaurar').addEventListener('click', () => $('archivoRespaldo').click());
  $('archivoRespaldo').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const nuevo = JSON.parse(await file.text());
      if (!nuevo || !Array.isArray(nuevo.clientes) || !Array.isArray(nuevo.bancos) || !Array.isArray(nuevo.lotes)) throw new Error('formato inválido');
      if (!await confirmar('Restaurar respaldo', `El respaldo tiene ${nuevo.clientes.length} clientes, ${nuevo.bancos.length} bancos y ${nuevo.lotes.length} lotes. Reemplaza los datos actuales.`, 'Restaurar', true)) return;
      await almacen.importar(nuevo);
      toast('Respaldo restaurado');
    } catch (err) {
      informar('No se pudo restaurar', esc(err.message || err));
    }
  });

  // ============================================================ inicio

  function aplicarPermisos() {
    const soloLectura = almacen && almacen.puedeEscribir === false;
    document.querySelectorAll('[data-escribe]').forEach(el => { el.disabled = soloLectura; });
    $('avisoSoloLectura').classList.toggle('oculto', !soloLectura);
  }

  async function refrescar() {
    if (almacen.error) {
      $('estadoBase').innerHTML = '<span class="chip bad">Sin conexión</span>';
      $('errorBase').innerHTML = aviso('bad', 'Se perdió la conexión con la base compartida. Recargá la página.');
      return;
    }
    if (almacen.modo === 'compartido') {
      const ids = [...new Set(datos().lotes.map(l => l.usuarioId).concat(datos().clientes.map(c => c.creadoPor), (datos().envios || []).map(e => e.usuarioId), (datos().carteraHist || []).map(e => e.usuarioId)).filter(Boolean))];
      nombresUsuarios = await almacen.nombres(ids);
    }
    renderSelectClientes();
    renderClientes();
    renderBancos();
    renderBancosMeli();
    if (cartera) renderCartera(); else renderExtraccion();
    renderHistorial();
    actualizarFormulario();
    aplicarPermisos();
  }

  // Aviso de versión nueva: en el sitio publicado se relee la página (sin caché) cada 5 minutos y se compara la versión.
  function vigilarVersion() {
    if (!/^https?:/.test(location.protocol)) return;
    const actual = ($('versionPagina').textContent.match(/\d{4}-\d{2}-\d{2}\.\d+/) || [])[0];
    if (!actual) return;
    const revisar = async () => {
      try {
        const r = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' });
        const nueva = ((await r.text()).match(/id="versionPagina">versión (\d{4}-\d{2}-\d{2}\.\d+)/) || [])[1];
        if (nueva && nueva !== actual) { $('avisoVersionNum').textContent = nueva; $('avisoVersion').classList.remove('oculto'); }
      } catch (e) { /* sin conexión: se reintenta */ }
    };
    setTimeout(revisar, 20000);
    setInterval(revisar, 300000);
  }
  // Limpiar pantalla: recarga la página sin caché (como un inicio nuevo); la sesión y los datos guardados quedan.
  $('btnLimpiarPantalla').addEventListener('click', async () => {
    const ok = await confirmar('Limpiar pantalla', 'Se borran de la pantalla los archivos cargados, búsquedas, filtros y resultados (Carga de lote, Cartera, Inventario, Bastanteo). <b>No</b> se cierra la sesión ni se borra nada guardado en la base.', 'Limpiar');
    if (ok) location.replace(location.pathname + '?v=' + Date.now());
  });
  $('btnRecargarVersion').addEventListener('click', () => { location.replace(location.pathname + '?v=' + Date.now()); });
  vigilarVersion();

  async function iniciar() {
    $('fPeriodo').value = periodoActual();
    try {
      almacen = await window.ValoAlmacen.iniciar();
    } catch (e) {
      almacen = { modo: 'sin-conexion' };
    }
    $('errorCarga').classList.add('oculto');
    if (almacen.modo === 'sin-conexion') {
      $('estadoBase').innerHTML = '<span class="chip bad">Sin base</span>';
      $('errorBase').innerHTML = aviso('bad', window.VALO_WEB ? 'No se pudo conectar con la base compartida. Revisá la conexión y recargá la página.'
        : 'No se pudo abrir la base compartida. Iniciá sesión en claude.ai y volvé a abrir el link de la página.');
      $('cargandoBase').classList.add('oculto');
      return;
    }
    if (almacen.modo === 'sin-configurar') {
      $('estadoBase').innerHTML = '<span class="chip bad">Sin base</span>';
      $('errorBase').innerHTML = aviso('bad', 'Falta configurar la base de datos (Supabase) de este sitio.');
      $('cargandoBase').classList.add('oculto');
      return;
    }
    if (almacen.modo === 'login') {
      $('estadoBase').innerHTML = '<span class="chip gris">Sin sesión</span>';
      $('cargandoBase').classList.add('oculto');
      $('cardLogin').classList.remove('oculto');
      $('loginEmail').focus();
      $('formLogin').addEventListener('submit', async e => {
        e.preventDefault();
        $('btnLogin').disabled = true;
        $('loginError').innerHTML = '';
        try {
          await almacen.ingresar($('loginEmail').value, $('loginClave').value);
          location.reload();
        } catch (err) {
          $('loginError').innerHTML = aviso('bad', esc(err.message || err));
          $('btnLogin').disabled = false;
        }
      });
      return;
    }
    if (almacen.proveedor === 'supabase') iniciarWeb();
    if (window.claude && typeof window.claude.use === 'function') descargas = await window.claude.use('downloads');
    const compartido = almacen.modo === 'compartido';
    $('avisoViejo').classList.toggle('oculto', !(compartido && almacen.proveedor !== 'supabase'));
    $('estadoBase').innerHTML = compartido
      ? '<span class="chip ok" title="Clientes, secuencias, bancos e historial se comparten con todos los usuarios de esta página">Base compartida</span>'
      : '<span class="chip gris" title="Los datos quedan solo en este navegador">Datos en este navegador</span>';
    document.querySelectorAll('[data-solo-local]').forEach(el => el.classList.toggle('oculto', compartido));
    if (compartido && !descargas && !almacen.descargaLibre) $('errorBase').innerHTML = aviso('warn', 'Tu usuario no puede descargar archivos desde esta página (claude.ai las permite solo a los miembros de la organización dueña). Cuando descargues, se te va a ofrecer copiar el contenido para pegarlo en el Bloc de notas o en Excel.');
    let primera = true;
    $('cajaFlujo').classList.toggle('oculto', !flujoDisponible());
    $('cajaPbi').classList.toggle('oculto', !flujoDisponible());
    $('cajaCola').classList.toggle('oculto', almacen.proveedor !== 'supabase');
    $('detPA').open = almacen.modo === 'local';
    renderAgente();
    setInterval(renderCola, 60000); // "última conexión hace N min"
    almacen.alCambiar(() => {
      aplicarCfgCompartida();
      if (flujoDisponible()) { cargarFlujo(); cargarPbi(); }
      if (inventario.length) renderInvContable();
      renderCola();
      if (primera) { primera = false; $('cargandoBase').classList.add('oculto'); $('contenido').classList.remove('oculto'); }
      refrescar();
    });
    if (!compartido) {
      if (flujoDisponible()) { cargarFlujo(); cargarPbi(); }
      $('cargandoBase').classList.add('oculto');
      $('contenido').classList.remove('oculto');
      refrescar();
      if (!almacen.guardarDisponible()) toast('Este navegador no permite guardar datos: usá "Descargar respaldo" al terminar.');
    }
  }

  // Sitio propio (Supabase): usuario, contraseña, salir e importación de los datos de claude.ai.
  function iniciarWeb() {
    document.querySelectorAll('[data-solo-web]').forEach(el => el.classList.remove('oculto'));
    $('webUsuario').textContent = almacen.email;
    $('btnSalir').addEventListener('click', async () => { await almacen.salir(); location.reload(); });
    $('btnCambiarClave').addEventListener('click', async () => {
      const ok = await confirmar('Cambiar contraseña', '<label class="campo">Nueva contraseña (mínimo 8 caracteres) <input id="nuevaClave" type="password" autocomplete="new-password"></label>', 'Cambiar');
      const nueva = ok ? document.getElementById('nuevaClave').value : '';
      if (!ok) return;
      if (nueva.length < 8) return informar('Cambiar contraseña', 'La contraseña tiene que tener al menos 8 caracteres.');
      try { await almacen.cambiarClave(nueva); toast('Contraseña cambiada'); } catch (e) { informar('No se pudo cambiar la contraseña', esc(e.message || e)); }
    });
    $('btnImportarMigracion').addEventListener('click', () => $('archivoMigracion').click());
    $('archivoMigracion').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        const docs = (Array.isArray(j) ? j : j.docs || []).filter(d => d && typeof d.path === 'string' && d.data && typeof d.data === 'object');
        if (!docs.length) throw new Error('el archivo no tiene datos para importar');
        const cuenta = c => docs.filter(d => d.path.startsWith(c + '/')).length;
        if (!await confirmar('Importar datos', `El archivo trae <b>${cuenta('clientes')}</b> clientes, <b>${cuenta('lotes')}</b> lotes del historial y <b>${cuenta('maestros')}</b> tablas maestras (bancos, Bancos MELI, configuración de Cartera). ` +
          'Los registros con la misma clave se reemplazan.', 'Importar')) return;
        await almacen.importarDocs(docs, (n, total) => { $('estadoBase').innerHTML = `<span class="chip gris">Importando ${n} de ${total}…</span>`; });
        $('estadoBase').innerHTML = '<span class="chip ok">Base compartida</span>';
        toast('Datos importados');
      } catch (err) {
        informar('No se pudo importar', esc(err.message || err));
      }
    });
  }

  iniciar();
})();
