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
  }
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));
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
    cartera = Object.assign({ fuente }, leido, { numericas: M.columnasNumericasCartera(leido.encabezados, leido.datos) });
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
      calc: { capital: cfg.colCapital, intDto: cfg.colIntDto, intDev: cfg.colIntDev },
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
      if (t && t.filas.length) descargar(t.nombre, t.texto, true);
    } catch (e) { informar('No se pudo generar el TXT NO COBIS', esc(e.message || e)); }
  });

  $('btnNoCobisApi').addEventListener('click', () => {
    try {
      const t = infoNoCobis();
      if (t && t.filas.length) descargar(t.nombre.replace(/\.txt$/, '.json'), JSON.stringify(M.loteApiNoCobis(t), null, 1), true);
    } catch (e) { informar('No se pudo generar el lote para la API', esc(e.message || e)); }
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
    const porDefecto = (interfaz ? utiles : utiles.filter(h => h.formato === 'getnet')).slice().sort((a, b) => b.cantidad - a.cantidad)[0] || utiles[0];
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
    } else reporte = M.armarReporte(hoja.filas, hoja, { columnaMonto: $('aMonto').value, interfaz: archivo.interfaz });
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
          columnaMonto: prep.hoja.formato === 'getnet' ? columnaMonto : prep.hoja.formato === 'interfaz' ? archivoActual.interfaz.monto : prep.hoja.formato === 'meli' ? 'importe TXT' : 'MONTO', firma,
          interfaz: prep.hoja.formato === 'interfaz' ? archivoActual.interfaz.nombre : prep.hoja.formato === 'meli' ? 'MELI (TXT por banco)' : null,
          tipoAccion: p.tipoAccion, secuencia: p.secuencia, lote: p.lote, periodo: p.periodo, tasa: p.tasa,
          secuenciaAnterior: fresco.ultimaSecuencia, filas: prep.reporte.length,
          cantCuotas: cuotas.filas.length, cantCreditos: creditos.filas.length, total: cuotas.encabezado.totalCapital,
          nombreCuotas: M.nombreArchivo('cuotas', hoy), nombreCreditos: M.nombreArchivo('creditos', hoy),
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

  function renderHistorial() {
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
      const ls = lotesDe(c.id).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
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
          <td>${l.anulado ? '<span class="chip gris">Anulado</span>' : ultimos.get(l.clienteId) === l.id ? `<button class="btn chico peligro" data-escribe data-h-anular="${l.id}">Anular</button>` : ''}</td></tr>`;
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
    const id = b.dataset.hCuotas || b.dataset.hCreditos || b.dataset.hAnular;
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
      const ids = [...new Set(datos().lotes.map(l => l.usuarioId).concat(datos().clientes.map(c => c.creadoPor)).filter(Boolean))];
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
    $('estadoBase').innerHTML = compartido
      ? '<span class="chip ok" title="Clientes, secuencias, bancos e historial se comparten con todos los usuarios de esta página">Base compartida</span>'
      : '<span class="chip gris" title="Los datos quedan solo en este navegador">Datos en este navegador</span>';
    document.querySelectorAll('[data-solo-local]').forEach(el => el.classList.toggle('oculto', compartido));
    if (compartido && !descargas && !almacen.descargaLibre) $('errorBase').innerHTML = aviso('warn', 'Tu usuario no puede descargar archivos desde esta página (claude.ai las permite solo a los miembros de la organización dueña). Cuando descargues, se te va a ofrecer copiar el contenido para pegarlo en el Bloc de notas o en Excel.');
    let primera = true;
    almacen.alCambiar(() => {
      aplicarCfgCompartida();
      if (primera) { primera = false; $('cargandoBase').classList.add('oculto'); $('contenido').classList.remove('oculto'); }
      refrescar();
    });
    if (!compartido) {
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
