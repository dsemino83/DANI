// Motor de cálculo del Conversor GetNet (VALO).
// Replica las fórmulas de las solapas Reporte → Cuotas → Creditos del libro
// "Conversor GetNet.xlsx" y el formato de salida de GenerarCuotas.py y
// GenerarCreditos.py. No depende del navegador: se puede probar con Node.
(function (root) {
  'use strict';

  // Tabla de provincias (Bancos!N:Q): Jurisdicción → Código Sucursal.
  const PROVINCIAS = [
    ['Capital Federal', 1], ['Buenos Aires', 2], ['Catamarca', 3], ['Córdoba', 4],
    ['Corrientes', 5], ['Chaco', 6], ['Chubut', 7], ['Entre Ríos', 8], ['Formosa', 9],
    ['Jujuy', 10], ['La Pampa', 11], ['La Rioja', 12], ['Mendoza', 13], ['Misiones', 14],
    ['Neuquén', 15], ['Río Negro', 16], ['Salta', 17], ['San Juan', 18], ['San Luis', 19],
    ['Santa Cruz', 20], ['Santa Fé', 21], ['Santiago del Estero', 22], ['TDF', 23], ['Tucumán', 24],
  ].map(([nombre, codigo]) => ({ nombre, codigo }));

  // Valores fijos del conversor.
  const FIJOS = { cesionario: 198, motivo: 1, tipoIdentificacion: 8 };

  const COLS_REPORTE = ['ID_LOTE', 'COD_BANCO', 'NOMBRE_BANCO', 'MONTO', 'FECHA_VENCIMIENTO', 'PLAZO', 'TNA', 'TEA', 'CFT'];

  // ---------------------------------------------------------------- utilidades

  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function provinciaPorNombre(nombre) {
    const n = normalizar(nombre);
    if (!n) return null;
    return PROVINCIAS.find(p => normalizar(p.nombre) === n) ||
      (n === 'caba' || n === 'ciudad autonoma de buenos aires' ? PROVINCIAS[0] : null) ||
      (n === 'tierra del fuego' ? PROVINCIAS[22] : null);
  }

  // ROUND(x, 2) de Excel: redondeo decimal "mitad lejos de cero".
  function round2(x) {
    if (!isFinite(x)) return x;
    const s = Math.sign(x);
    return s * Math.round(parseFloat((Math.abs(x) * 100).toPrecision(15))) / 100;
  }

  // str() de Python para los valores que leen los scripts (int / float / str).
  function pyStr(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    return String(v);
  }

  // Número float de pandas (float64): los enteros se escriben con ".0".
  function pyFloat(v) {
    return Number.isInteger(v) ? v.toFixed(1) : String(v);
  }

  // Comillas mínimas, como csv.writer / DataFrame.to_csv.
  function celdaCsv(texto) {
    return /[",\r\n]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
  }

  function lineaCsv(celdas) {
    return celdas.map(celdaCsv).join(',');
  }

  // Fechas como número de serie de Excel (entero de días).
  const EPOCA = Date.UTC(1899, 11, 30);

  function serialAPartes(serial) {
    const d = new Date(EPOCA + Math.floor(serial) * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  function partesASerial(y, m, d) {
    return Math.round((Date.UTC(y, m - 1, d) - EPOCA) / 86400000);
  }

  const dos = n => String(n).padStart(2, '0');

  function fechaDDMMYY(serial) {
    const p = serialAPartes(serial);
    return dos(p.d) + dos(p.m) + dos(p.y % 100);
  }

  function fechaYYYYMMDD(serial) {
    const p = serialAPartes(serial);
    return p.y + '/' + dos(p.m) + '/' + dos(p.d);
  }

  function fechaLegible(serial) {
    const p = serialAPartes(serial);
    return dos(p.d) + '/' + dos(p.m) + '/' + p.y;
  }

  function hoyDDMMYY(fecha) {
    const f = fecha || new Date();
    return dos(f.getDate()) + dos(f.getMonth() + 1) + dos(f.getFullYear() % 100);
  }

  // Convierte lo que venga en la celda (serie, Date, texto) a serie entera.
  function aFechaSerial(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return Math.floor(v);
    if (v instanceof Date && !isNaN(v)) return partesASerial(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return partesASerial(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return partesASerial(y, +m[2], +m[1]);
    }
    if (/^\d+(\.\d+)?$/.test(s)) return Math.floor(parseFloat(s));
    return null;
  }

  // Convierte montos: número, "779880.0", "1.234.567,89", "1,234,567.89".
  function aNumero(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/\s|\$/g, '');
    if (!s) return null;
    const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
    if (coma > -1 && punto > -1) {
      s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (coma > -1) {
      s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  function aCodigoBanco(v) {
    const n = aNumero(v);
    return n == null ? null : Math.round(n);
  }

  // ------------------------------------------------------ lectura del archivo

  // Formatos reconocidos en las hojas del archivo del cliente.
  const FORMATOS = {
    getnet: {
      nombre: 'Cupones GetNet',
      requeridas: ['cod_entidad_bancaria', 'dat_reconciliation_estimated_date'],
    },
    reporte: {
      nombre: 'Reporte (formato conversor)',
      requeridas: ['cod_banco', 'fecha_vencimiento', 'monto'],
    },
    interfaz: {
      nombre: 'Interfaz del cliente',
      requeridas: [],
    },
  };

  // Campos que define la interfaz de un cliente (qué columna del archivo del cliente usar para cada dato).
  const CAMPOS_INTERFAZ = [
    { id: 'banco', nombre: 'Código de banco', requerido: true,
      sugeridas: ['userbank', 'cod_entidad_bancaria', 'cod_banco', 'codigo_banco', 'banco', 'bank'] },
    { id: 'fecha', nombre: 'Fecha de vencimiento', requerido: true,
      sugeridas: ['acceleratedpaymentdate', 'dat_reconciliation_estimated_date', 'fecha_vencimiento', 'fecha_de_vencimiento', 'fecha_pago', 'paymentdate'] },
    { id: 'monto', nombre: 'Monto', requerido: true,
      sugeridas: ['yieldamount', 'vlu_transaction_amount', 'monto', 'importe', 'amount'] },
    { id: 'nombreBanco', nombre: 'Nombre del banco', requerido: false,
      sugeridas: ['entidad_bancaria', 'nombre_banco', 'bankname'] },
    { id: 'id', nombre: 'Identificador', requerido: false,
      sugeridas: ['id', 'idt_transaction_identifier', 'id_lote', 'installmentid', 'transactionid'] },
  ];

  const COLUMNAS_MONTO = {
    vlu_transaction_amount: 'vlu_transaction_amount (monto de la transacción)',
    vlu_installment_amount: 'vlu_installment_amount (monto de la cuota)',
  };

  const clave = h => normalizar(h).replace(/ /g, '_');

  // Lector de CSV (separador , o ; y comillas). Devuelve filas como texto; descarta las filas vacías
  // (",,,,") para no cargar en memoria archivos con miles de renglones en blanco.
  function leerCsv(texto) {
    if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
    const primera = texto.slice(0, texto.indexOf('\n') > -1 ? texto.indexOf('\n') : texto.length);
    const sep = (primera.split(';').length > primera.split(',').length) ? ';' : ',';
    const filas = [];
    let fila = [], campo = '', comillas = false;
    const cerrarFila = () => {
      fila.push(campo); campo = '';
      if (fila.some(c => c.trim() !== '')) filas.push(fila);
      fila = [];
    };
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (comillas) {
        if (ch === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
        } else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(campo); campo = ''; }
      else if (ch === '\n') cerrarFila();
      else if (ch !== '\r') campo += ch;
    }
    if (campo !== '' || fila.length) cerrarFila();
    return filas;
  }

  // Encabezados de un archivo de ejemplo: la primera fila (entre las 20 primeras) con al menos 2 textos.
  function encabezadosEjemplo(filas) {
    for (let i = 0; i < Math.min(filas.length, 20); i++) {
      const r = (filas[i] || []).map(c => (c == null ? '' : String(c).trim()));
      if (r.filter(c => c && isNaN(Number(c))).length >= 2) return r.filter(Boolean);
    }
    return [];
  }

  // Si el archivo es una definición de interfaz (dos columnas: Campo | Columna), la devuelve.
  function leerDefinicionInterfaz(filas) {
    const alias = {
      banco: ['banco', 'cod banco', 'codigo banco', 'codigo de banco', 'cod_banco'],
      fecha: ['fecha', 'fecha vencimiento', 'fecha de vencimiento', 'fecha_vencimiento', 'vencimiento'],
      monto: ['monto', 'importe'],
      nombreBanco: ['nombre banco', 'nombre del banco', 'nombre_banco'],
      id: ['id', 'identificador', 'id_lote'],
    };
    const res = {};
    (filas || []).slice(0, 30).forEach(r => {
      if (!r || r[0] == null || r[1] == null || String(r[1]).trim() === '') return;
      const k = normalizar(r[0]);
      Object.keys(alias).forEach(campo => { if (alias[campo].includes(k)) res[campo] = String(r[1]).trim(); });
    });
    return res.banco && res.fecha && res.monto ? res : null;
  }

  function sugerirColumna(campo, encabezados) {
    const def = CAMPOS_INTERFAZ.find(c => c.id === campo);
    const claves = encabezados.map(clave);
    for (const s of def.sugeridas) {
      const i = claves.indexOf(s);
      if (i > -1) return encabezados[i];
    }
    return '';
  }

  // Busca en la hoja la fila de encabezados que tiene las columnas de la interfaz del cliente.
  function detectarHojaInterfaz(nombre, filas, interfaz) {
    const req = [interfaz.banco, interfaz.fecha, interfaz.monto].map(clave);
    for (let i = 0; i < Math.min(filas.length, 20); i++) {
      const enc = (filas[i] || []).map(clave);
      if (req.every(r => enc.includes(r))) {
        const datos = filas.slice(i + 1).filter(r => r && r.some(c => c != null && c !== ''));
        return { hoja: nombre, formato: 'interfaz', filaEncabezado: i, encabezados: enc, cantidad: datos.length };
      }
    }
    return { hoja: nombre, formato: null, cantidad: 0 };
  }

  // filas = array de arrays (sheet_to_json con header:1).
  function detectarHoja(nombre, filas) {
    for (let i = 0; i < Math.min(filas.length, 15); i++) {
      const enc = (filas[i] || []).map(clave);
      for (const [id, f] of Object.entries(FORMATOS)) {
        if (f.requeridas.every(r => enc.includes(r))) {
          const datos = filas.slice(i + 1).filter(r => r && r.some(c => c != null && c !== ''));
          return { hoja: nombre, formato: id, filaEncabezado: i, encabezados: enc, cantidad: datos.length };
        }
      }
    }
    return { hoja: nombre, formato: null, cantidad: 0 };
  }

  // Devuelve las filas de tblReporte a partir de la hoja elegida.
  function armarReporte(filas, deteccion, opciones) {
    const enc = deteccion.encabezados;
    const col = n => enc.indexOf(n);
    const salida = [];
    const datos = filas.slice(deteccion.filaEncabezado + 1);
    const tomar = (r, n) => (col(n) > -1 ? r[col(n)] : null);
    const vacio = v => v == null || String(v).trim() === '';
    let ignoradas = 0;
    const totalesPie = [];
    datos.forEach(r => {
      if (!r || !r.some(c => c != null && c !== '')) return;
      if (deteccion.formato === 'interfaz') {
        const it = opciones.interfaz;
        const k = n => (n ? clave(n) : '');
        // Filas sin banco ni fecha (por ejemplo, una fila de totales al pie) no son cupones.
        if (vacio(tomar(r, k(it.banco))) && vacio(tomar(r, k(it.fecha)))) {
          ignoradas++;
          const pie = aNumero(tomar(r, k(it.monto)));
          if (pie != null) totalesPie.push(pie);
          return;
        }
        salida.push({
          ID_LOTE: it.id ? tomar(r, k(it.id)) : null,
          COD_BANCO: aCodigoBanco(tomar(r, k(it.banco))),
          NOMBRE_BANCO: it.nombreBanco ? tomar(r, k(it.nombreBanco)) : null,
          MONTO: aNumero(tomar(r, k(it.monto))),
          FECHA_VENCIMIENTO: aFechaSerial(tomar(r, k(it.fecha))),
          PLAZO: null, TNA: null, TEA: null, CFT: null,
        });
      } else if (deteccion.formato === 'getnet') {
        const campoMonto = (opciones && opciones.columnaMonto) || 'vlu_transaction_amount';
        salida.push({
          ID_LOTE: tomar(r, 'idt_transaction_identifier'),
          COD_BANCO: aCodigoBanco(tomar(r, 'cod_entidad_bancaria')),
          NOMBRE_BANCO: tomar(r, 'entidad_bancaria'),
          MONTO: aNumero(tomar(r, campoMonto)),
          FECHA_VENCIMIENTO: aFechaSerial(tomar(r, 'dat_reconciliation_estimated_date')),
          PLAZO: aNumero(tomar(r, 'num_installment_number')),
          TNA: null, TEA: null, CFT: null,
        });
      } else {
        salida.push({
          ID_LOTE: tomar(r, 'id_lote'),
          COD_BANCO: aCodigoBanco(tomar(r, 'cod_banco')),
          NOMBRE_BANCO: tomar(r, 'nombre_banco'),
          MONTO: aNumero(tomar(r, 'monto')),
          FECHA_VENCIMIENTO: aFechaSerial(tomar(r, 'fecha_vencimiento')),
          PLAZO: aNumero(tomar(r, 'plazo')),
          TNA: aNumero(tomar(r, 'tna')), TEA: aNumero(tomar(r, 'tea')), CFT: aNumero(tomar(r, 'cft')),
        });
      }
    });
    salida.ignoradas = ignoradas;
    salida.totalesPie = totalesPie;
    return salida;
  }

  // Busca en la hoja "Conciliacion" del cliente el importe Bruto, si existe.
  function leerConciliacion(filas) {
    const res = {};
    (filas || []).forEach(r => {
      if (!r || r[0] == null) return;
      const k = normalizar(r[0]);
      if (k === 'bruto') res.bruto = aNumero(r[1]);
      if (k === 'fecha cesion') res.fechaCesion = aFechaSerial(r[1]);
    });
    return res;
  }

  // ------------------------------------------------------------- TXT MELI

  // TXT de cuotas por banco (ancho fijo). Nombre: CUOTA_<NOMBRE COBIS>_<aaaammdd>.txt
  //   Cabecera: [0,6) "CUOTAS" · [6,12) cantidad · [12,20) fecha ddmmaaaa · [20,23) · [23,34) CUIT del banco · [34,54) total
  //   Detalle:  [0,13) · [13,21) vencimiento aaaammdd · [21,41) importe
  function leerTxtMeli(nombreArchivo, texto) {
    if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
    const lineas = texto.split(/\r?\n/).filter(l => l.trim() !== '');
    const res = { archivo: nombreArchivo, cobis: '', cuit: '', cantidad: null, total: null, filas: [], errores: [] };
    const m = String(nombreArchivo).match(/^CUOTA_(.+)_(\d{8})\.[^.]+$/i);
    if (m) res.cobis = m[1].replace(/_/g, ' ').trim();
    if (!lineas.length) { res.errores.push('El archivo está vacío.'); return res; }
    const cab = lineas[0];
    if (cab.slice(0, 6).toUpperCase() !== 'CUOTAS') res.errores.push('La primera línea no es una cabecera CUOTAS.');
    else {
      res.cantidad = Number(cab.slice(6, 12));
      res.cuit = cab.slice(23, 34);
      res.total = Number(cab.slice(34, 54));
    }
    lineas.slice(1).forEach((l, i) => {
      const f = l.slice(13, 21), imp = l.slice(21, 41);
      if (!/^\d{8}$/.test(f) || !/^\d+$/.test(imp.trim())) { res.errores.push(`Línea ${i + 2}: formato inválido.`); return; }
      res.filas.push({ fecha: partesASerial(+f.slice(0, 4), +f.slice(4, 6), +f.slice(6, 8)), monto: Number(imp) });
    });
    if (res.cantidad != null && res.cantidad !== res.filas.length) res.errores.push(`La cabecera dice ${res.cantidad} registros y el archivo tiene ${res.filas.length}.`);
    const suma = res.filas.reduce((s, f) => s + f.monto, 0);
    if (res.total != null && Math.abs(res.total - suma) > 0.5) res.errores.push(`El total de la cabecera (${res.total}) no coincide con la suma de las líneas (${suma}).`);
    return res;
  }

  // Busca el banco de un TXT en la tabla MELI: por nombre COBIS del archivo y, si no, por el CUIT de la cabecera.
  function bancoMeliDeTxt(txt, bancosMeli) {
    const n = normalizar(txt.cobis);
    let b = n ? bancosMeli.find(x => x.cobis && normalizar(x.cobis) === n) : null;
    let por = 'nombre';
    if (!b && txt.cuit) { b = bancosMeli.find(x => String(x.cuit) === String(txt.cuit)); por = 'cuit'; }
    return b ? { banco: b, por, cuitDistinto: !!(txt.cuit && String(b.cuit) !== String(txt.cuit)) } : null;
  }

  // Tabla de bancos para generar Cuotas/Créditos con el esquema MELI: número, CUIT y sucursal de la tabla MELI;
  // nombre del banco de la tabla general por CUIT (como el conversor MELI) o, si no está, el de la tabla MELI.
  function bancosParaMeli(bancosMeli, bancosGenerales) {
    return bancosMeli.filter(b => b.numero != null && b.numero !== '').map(b => {
      const g = (bancosGenerales || []).find(x => String(x.cuit) === String(b.cuit));
      return {
        codigo: Number(b.numero), nombre: g ? g.nombre : b.nombre, cuit: String(b.cuit),
        jurisdiccion: b.sucursal != null && b.sucursal !== '' ? (b.pcia || 'Sin dato') : 'Prueba',
        sucursal: b.sucursal == null || b.sucursal === '' ? null : Number(b.sucursal), codCredito: String(b.numero),
      };
    });
  }

  // -------------------------------------------------------- CARTERA (BI)

  // Export de CreditoCarteraEspejoDetalleHistorico (BI ClickHouse): CSV con ';' o Excel.
  // Columnas que no se suman aunque sean números (igual que los totales del BI).
  const CARTERA_NO_SUMAR = ['periodo', 'serie', 'credito', 'sucursal', 'lote', 'ficuo doc titular', 'ficuo tipodoc titular', 'cuota', 'estado cuota', 'familia', 'motivo'];

  // Encabezados y filas como objetos, a partir de filas (array de arrays).
  function leerCartera(filas) {
    let fila = -1;
    for (let i = 0; i < Math.min(filas.length, 15) && fila < 0; i++) {
      const enc = (filas[i] || []).map(normalizar);
      if (enc.some(h => h.includes('titular')) || enc.includes('estado cuota')) fila = i;
    }
    if (fila < 0) throw new Error('No se encontró la fila de encabezados (se esperan columnas como "ficuo doc titular" y "Estado Cuota").');
    const encabezados = filas[fila].map(h => (h == null ? '' : String(h).trim()));
    const datos = filas.slice(fila + 1).filter(r => r && r.some(c => c != null && String(c).trim() !== ''))
      .map(r => { const o = {}; encabezados.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; });
    return { encabezados: encabezados.filter(Boolean), datos };
  }

  function sugerirColumnaCartera(tipo, encabezados) {
    const n = encabezados.map(normalizar);
    const buscar = lista => { for (const x of lista) { const i = n.indexOf(x); if (i > -1) return encabezados[i]; } return ''; };
    const contiene = t => { const i = n.findIndex(h => h.includes(t)); return i > -1 ? encabezados[i] : ''; };
    if (tipo === 'titular') return buscar(['ficuo doc titular', 'titular', 'doc titular']) || contiene('titular');
    if (tipo === 'tipoDoc') return buscar(['ficuo tipodoc titular']) || contiene('tipodoc');
    if (tipo === 'estado') return buscar(['estado cuota', 'estado']);
    if (tipo === 'estadoDesc') return buscar(['estado cuota desc', 'estado desc', 'estado cuota descripcion']);
    if (tipo === 'periodo') return buscar(['periodo']);
    if (tipo === 'negocio') return buscar(['negocio', 'nro negocio', 'n negocio', 'numero negocio', 'serie', 'familia']);
    if (tipo === 'credito') return buscar(['credito', 'nro credito']);
    return '';
  }

  // Columnas a sumar: numéricas en todas las filas con dato, sin fechas ni identificadores.
  function columnasNumericasCartera(encabezados, datos) {
    const muestra = datos.slice(0, 2000);
    return encabezados.filter(h => {
      const n = normalizar(h);
      if (CARTERA_NO_SUMAR.includes(n) || /(^| )id$/.test(n) || /vencimiento|fecha/.test(n)) return false;
      let hay = false;
      for (const r of muestra) {
        const v = r[h];
        if (v == null || String(v).trim() === '') continue;
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return false;
        if (aNumero(v) == null) return false;
        hay = true;
      }
      return hay;
    });
  }

  const valorTexto = v => (v == null ? '' : String(v).trim());
  const mismoNegocio = (v, negocios) => {
    const t = valorTexto(v);
    return negocios.some(n => n === t || (t !== '' && !isNaN(Number(t)) && !isNaN(Number(n)) && Number(n) === Number(t)));
  };

  // Agrupa por titular: filtra periodo, negocios de Clientes y excluye los estados de cuota pagos.
  function agruparCartera(datos, cfg) {
    const excluidos = new Set((cfg.estadosExcluidos || []).map(String));
    const res = { leidas: datos.length, otrosPeriodos: 0, otrosNegocios: 0, pagas: 0, usadas: 0, grupos: [], totales: {}, porNegocio: {} };
    const grupos = new Map();
    cfg.sumar.forEach(c => { res.totales[c] = 0; });
    datos.forEach(r => {
      if (cfg.colPeriodo && cfg.periodo !== '' && cfg.periodo != null && valorTexto(r[cfg.colPeriodo]) !== String(cfg.periodo)) { res.otrosPeriodos++; return; }
      if (cfg.colNegocio && !mismoNegocio(r[cfg.colNegocio], cfg.negocios)) { res.otrosNegocios++; return; }
      if (cfg.colEstado && excluidos.has(valorTexto(r[cfg.colEstado]))) { res.pagas++; return; }
      res.usadas++;
      const titular = valorTexto(r[cfg.colTitular]) || '(sin titular)';
      const negocio = cfg.colNegocio ? valorTexto(r[cfg.colNegocio]) : '';
      const k = titular + '|' + negocio;
      if (!grupos.has(k)) {
        const g = { titular, tipoDoc: cfg.colTipoDoc ? valorTexto(r[cfg.colTipoDoc]) : '', negocio, cuotas: 0, creditos: new Set(), sumas: {} };
        cfg.sumar.forEach(c => { g.sumas[c] = 0; });
        grupos.set(k, g);
      }
      const g = grupos.get(k);
      g.cuotas++;
      if (cfg.colCredito) g.creditos.add(valorTexto(r[cfg.colCredito]));
      if (!res.porNegocio[negocio]) res.porNegocio[negocio] = { titulares: new Set(), cuotas: 0, sumas: Object.fromEntries(cfg.sumar.map(c => [c, 0])) };
      const pn = res.porNegocio[negocio];
      pn.titulares.add(titular); pn.cuotas++;
      cfg.sumar.forEach(c => { const v = aNumero(r[c]) || 0; g.sumas[c] += v; res.totales[c] += v; pn.sumas[c] += v; });
    });
    res.grupos = [...grupos.values()].map(g => {
      Object.keys(g.sumas).forEach(c => { g.sumas[c] = round2(g.sumas[c]); });
      return Object.assign(g, { creditos: g.creditos.size });
    }).sort((a, b) => (a.negocio < b.negocio ? -1 : a.negocio > b.negocio ? 1 : 0) || (a.titular < b.titular ? -1 : a.titular > b.titular ? 1 : 0));
    Object.keys(res.totales).forEach(c => { res.totales[c] = round2(res.totales[c]); });
    Object.values(res.porNegocio).forEach(pn => { pn.titulares = pn.titulares.size; Object.keys(pn.sumas).forEach(c => { pn.sumas[c] = round2(pn.sumas[c]); }); });
    return res;
  }

  // Valores distintos de una columna con su cantidad (para elegir periodo y estados).
  function valoresDistintos(datos, col) {
    const m = new Map();
    datos.forEach(r => { const v = valorTexto(r[col]); m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].map(([valor, cantidad]) => ({ valor, cantidad }))
      .sort((a, b) => (!isNaN(Number(a.valor)) && !isNaN(Number(b.valor)) ? Number(a.valor) - Number(b.valor) : a.valor < b.valor ? -1 : 1));
  }

  // SQL para consultar el BI directo (tabla del reporte CreditoCarteraEspejoDetalle).
  function sqlCartera(tabla, colNegocio, negocios, periodo, limite, desde) {
    const lista = negocios.map(n => (isNaN(Number(n)) ? `'${String(n).replace(/'/g, "''")}'` : Number(n))).join(', ');
    const w = ['1=1'];
    if (colNegocio && negocios.length) w.push(`\`${colNegocio}\` IN (${lista})`);
    if (periodo) w.push(`periodo=${Number(periodo)}`);
    return `SELECT * FROM ${tabla} WHERE ${w.join(' AND ')} LIMIT ${limite} OFFSET ${desde} FORMAT JSONEachRow`;
  }

  // ------------------------------------------------------------------- Bancos

  // Un banco está completo cuando tiene provincia real, sucursal, CUIT y código de crédito.
  function problemasBanco(b) {
    const p = [];
    if (!b) return ['No existe en la tabla Bancos'];
    if (!b.nombre) p.push('Falta el nombre');
    if (!/^\d{11}$/.test(String(b.cuit || ''))) p.push('CUIT inválido');
    if (!b.jurisdiccion || normalizar(b.jurisdiccion) === 'prueba') p.push('Jurisdicción = Prueba');
    if (b.sucursal == null || b.sucursal === '' || !isFinite(Number(b.sucursal))) p.push('Código Sucursal #N/D');
    return p;
  }

  // Los 3 dígitos del banco en el número de crédito: código con ceros a la izquierda (7 → 007);
  // si el código tiene más de 3 dígitos se toman los 3 últimos (44059 → 059).
  function prefijoBanco(codigo) {
    return String(Math.round(Number(codigo))).padStart(3, '0').slice(-3);
  }

  function numeroCredito(codigoBanco, fechaDDMMYY, secuencia) {
    return prefijoBanco(codigoBanco) + fechaDDMMYY + String(secuencia);
  }

  // Bancos del lote que comparten los mismos 3 dígitos (darían el mismo número de crédito).
  function prefijosRepetidos(codigos) {
    const por = new Map();
    codigos.forEach(c => {
      const p = prefijoBanco(c);
      if (!por.has(p)) por.set(p, new Set());
      por.get(p).add(Number(c));
    });
    return [...por.entries()].filter(([, set]) => set.size > 1).map(([p, set]) => ({ prefijo: p, bancos: [...set] }));
  }

  function codigoCreditoPorDefecto(codigo) {
    return String(codigo).slice(-4); // =RIGHT(A2,4)
  }

  // Valida que cada COD_BANCO del reporte exista y esté completo (Instrucciones!B8:D8).
  function controlarBancos(reporte, bancos) {
    const porCodigo = new Map(bancos.map(b => [Number(b.codigo), b]));
    const usados = new Map();
    reporte.forEach(r => {
      if (r.COD_BANCO == null) return;
      if (!usados.has(r.COD_BANCO)) usados.set(r.COD_BANCO, { codigo: r.COD_BANCO, nombreArchivo: r.NOMBRE_BANCO, filas: 0, monto: 0 });
      const u = usados.get(r.COD_BANCO);
      u.filas++;
      u.monto += r.MONTO || 0;
    });
    const detalle = [...usados.values()].sort((a, b) => a.codigo - b.codigo).map(u => {
      const banco = porCodigo.get(u.codigo);
      return Object.assign(u, { banco, problemas: problemasBanco(banco) });
    });
    return { detalle, conProblemas: detalle.filter(d => d.problemas.length) };
  }

  // Controles de las filas de origen.
  function controlarReporte(reporte) {
    const errores = [];
    reporte.forEach((r, i) => {
      const fila = i + 2;
      if (r.COD_BANCO == null) errores.push(`Fila ${fila}: COD_BANCO vacío`);
      if (r.FECHA_VENCIMIENTO == null) errores.push(`Fila ${fila}: FECHA_VENCIMIENTO vacía o inválida`);
      if (r.MONTO == null) errores.push(`Fila ${fila}: MONTO no numérico`);
    });
    return errores;
  }

  // ------------------------------------------------------------------ Cuotas

  // params: { tipoAccion, secuencia, lote, periodo, tasa, negocio, cedente }
  // opciones.orden: 'codigo' (GetNet: por código de banco) o 'nombre' (MELI: por nombre de banco, como el conversor MELI).
  function generarCuotas(reporte, bancos, params, hoy, opciones) {
    const porNombre = opciones && opciones.orden === 'nombre';
    const nombreDe = new Map();
    reporte.forEach(r => { if (r.COD_BANCO != null && !nombreDe.has(r.COD_BANCO)) nombreDe.set(r.COD_BANCO, String(r.NOMBRE_BANCO || '').toUpperCase()); });
    const ordenTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const porCodigo = new Map();
    bancos.forEach(b => { if (!porCodigo.has(Number(b.codigo))) porCodigo.set(Number(b.codigo), b); });
    const sufijo = hoyDDMMYY(hoy);

    // SORT(UNIQUE(FILTER(COD_BANCO, FECHA_VENCIMIENTO))) + SUMIFS(MONTO)
    const grupos = new Map();
    reporte.forEach(r => {
      if (r.COD_BANCO == null || r.FECHA_VENCIMIENTO == null) return;
      const k = r.COD_BANCO + '|' + r.FECHA_VENCIMIENTO;
      if (!grupos.has(k)) grupos.set(k, { banco: r.COD_BANCO, fecha: r.FECHA_VENCIMIENTO, suma: 0 });
      grupos.get(k).suma += r.MONTO || 0;
    });
    const orden = [...grupos.values()].sort((a, b) =>
      (porNombre ? ordenTexto(nombreDe.get(a.banco), nombreDe.get(b.banco)) : 0) || a.banco - b.banco || a.fecha - b.fecha);

    let bancoAnterior = null, numero = 0;
    const filas = orden.map(g => {
      numero = g.banco === bancoAnterior ? numero + 1 : 1;
      bancoAnterior = g.banco;
      const b = porCodigo.get(g.banco);
      const suc = b && b.sucursal != null && b.sucursal !== '' ? Number(b.sucursal) : '';
      const cuit = b && b.cuit ? String(b.cuit) : '';
      // Número de crédito: 3 dígitos del banco + fecha ddmmyy + secuencia del lote.
      const credito = b ? numeroCredito(g.banco, sufijo, params.secuencia) : '';
      const m = round2(g.suma);
      return {
        sucursal: suc, tipo: FIJOS.tipoIdentificacion, cuit, credito, cuota: numero,
        fecha: g.fecha, importe: m, factor: 1, capital: m, valor: m, interes: 0,
        codBanco: g.banco,
      };
    });

    const encabezado = {
      tipoArchivo: 'CUOTAS',
      tipoAccion: String(params.tipoAccion || '').toUpperCase(),
      cantidad: filas.length,
      secuencia: params.secuencia,
      cesionario: FIJOS.cesionario,
      negocio: String(params.negocio),
      cedente: String(params.cedente),
      totalCapital: round2(filas.reduce((s, f) => s + f.capital, 0)),
      totalValor: round2(filas.reduce((s, f) => s + f.valor, 0)),
      totalInteres: round2(filas.reduce((s, f) => s + f.interes, 0)),
    };
    return { encabezado, filas };
  }

  // ---------------------------------------------------------------- Creditos

  // opciones.nombre: 'recortado' (GetNet: LEFT(nombre,30)) o 'sinComas' (MELI: SUBSTITUTE(nombre,",","")).
  function generarCreditos(cuotas, bancos, params, opciones) {
    const sinComas = opciones && opciones.nombre === 'sinComas';
    const grupos = new Map();
    cuotas.filas.forEach(c => {
      if (c.credito === '') return;
      if (!grupos.has(c.credito)) {
        // XLOOKUP devuelve el primer registro del crédito en Cuotas.
        grupos.set(c.credito, { credito: c.credito, cuit: c.cuit, sucursal: c.sucursal, importe: c.importe, fecha: c.fecha, capital: 0, valor: 0, interes: 0, plan: 0 });
      }
      const g = grupos.get(c.credito);
      g.capital += c.capital; g.valor += c.valor; g.interes += c.interes; g.plan++;
    });
    const ordenTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // SORT de textos
    const filas = [...grupos.values()].sort((a, b) => ordenTexto(a.credito, b.credito)).map(g => {
      const banco = bancos.find(b => String(b.cuit) === String(g.cuit));
      const capital = round2(g.capital), valor = round2(g.valor);
      return {
        credito: g.credito, tipo: FIJOS.tipoIdentificacion, cuit: g.cuit,
        nombre: !banco ? '' : sinComas ? String(banco.nombre || '').replace(/,/g, '') : String(banco.nombre || '').slice(0, 30),
        capital, plan: g.plan, tna: 0, tnaPunitorio: 0, importe: round2(g.importe),
        fechaAlta: g.fecha, fechaPrimerVto: g.fecha, fechaPrimerImpago: g.fecha,
        cuotasRestantes: g.plan, montoCedido: valor, sucursal: g.sucursal,
        saldoCapital: round2(capital), valorActual: round2(valor), interes: round2(g.interes),
      };
    });
    const encabezado = {
      tipoArchivo: 'CREDITOS',
      tipoAccion: String(params.tipoAccion || '').toUpperCase(),
      motivo: FIJOS.motivo,
      cantidad: filas.length,
      periodo: Number(params.periodo),
      secuencia: params.secuencia,
      lote: params.lote,
      cesionario: String(FIJOS.cesionario),
      negocio: String(params.negocio),
      cedente: String(params.cedente),
      totalCapital: round2(filas.reduce((s, f) => s + f.saldoCapital, 0)),
      tasa: round2(Number(params.tasa)),
      totalValor: round2(filas.reduce((s, f) => s + f.valorActual, 0)),
      totalInteres: round2(filas.reduce((s, f) => s + f.interes, 0)),
    };
    return { encabezado, filas };
  }

  // ------------------------------------------------------------ Archivos TXT

  const BOM = '﻿';
  const FIN = '\r\n';

  // Emula la inferencia de tipos de pandas por columna al escribir el CSV.
  function formatearColumnaPandas(valores) {
    const hayTexto = valores.some(v => typeof v === 'string');
    const numeros = valores.filter(v => typeof v === 'number');
    if (hayTexto || numeros.length === 0) return valores.map(pyStr);
    const esFloat = valores.some(v => v == null) || numeros.some(v => !Number.isInteger(v));
    return valores.map(v => (v == null ? '' : esFloat ? pyFloat(v) : String(v)));
  }

  // Igual a GenerarCuotas.py: encabezado = fila 2 de Cuotas, detalle desde la fila 6, 13 columnas.
  function txtCuotas(cuotas) {
    const e = cuotas.encabezado;
    const enc = [e.tipoArchivo, e.tipoAccion, e.cantidad, e.secuencia, e.cesionario, e.negocio, e.cedente,
      e.totalCapital, e.totalValor, e.totalInteres, null, null, null];
    const filas = cuotas.filas.map(f => [f.sucursal, f.tipo, f.cuit === '' ? '' : Number(f.cuit), f.credito, f.cuota,
      fechaYYYYMMDD(f.fecha), f.importe, f.factor, f.capital, f.valor, f.interes, null, null]);
    // Los CUIT se imprimen tal cual (11 dígitos) aunque sean números.
    const columnas = enc.map((_, c) => formatearColumnaPandas(filas.map(f => f[c])));
    const lineas = [lineaCsv(enc.map(pyStr))];
    filas.forEach((f, i) => lineas.push(lineaCsv(columnas.map(col => col[i]))));
    return BOM + lineas.join(FIN) + FIN;
  }

  // Igual a GenerarCreditos.py: filas 1, 4 y 7+ de Creditos, 18 columnas.
  function txtCreditos(creditos) {
    const e = creditos.encabezado;
    const ancho = 18;
    const completar = arr => arr.concat(Array(Math.max(0, ancho - arr.length)).fill(null));
    const lineas = [
      completar(['CAP', 'TD', 'CAPADESC', 'INTADESC']),
      completar([e.tipoArchivo, e.tipoAccion, e.motivo, e.cantidad, e.periodo, e.secuencia, e.lote, e.cesionario,
        e.negocio, e.cedente, e.totalCapital, e.tasa, e.totalValor, e.totalInteres]),
    ];
    creditos.filas.forEach(f => lineas.push([f.credito, f.tipo, f.cuit === '' ? '' : Number(f.cuit), f.nombre, f.capital,
      f.plan, f.tna, f.tnaPunitorio, f.importe, fechaDDMMYY(f.fechaAlta), fechaDDMMYY(f.fechaPrimerVto),
      fechaDDMMYY(f.fechaPrimerImpago), f.cuotasRestantes, f.montoCedido, f.sucursal, f.saldoCapital,
      f.valorActual, f.interes]));
    return BOM + lineas.map(l => lineaCsv(l.map(pyStr))).join(FIN) + FIN;
  }

  function nombreArchivo(tipo, hoy, extension) {
    return (tipo === 'cuotas' ? 'CuotasGetNet' : 'CreditosGetNet') + hoyDDMMYY(hoy) + '.' + (extension || 'csv');
  }

  // ---------------------------------------------------- Formulario / secuencia

  // Reglas de Formulario!C13 y de la numeración por cedente.
  function calcularSecuenciaLote(ultimaSecuencia, tipoAccion) {
    const secuencia = (Number(ultimaSecuencia) || 0) + 1;
    return { secuencia, lote: tipoAccion === 'Alta' ? secuencia : 0 };
  }

  function validarFormulario(p) {
    const errores = [];
    const periodo = Number(p.periodo);
    if (!/^\d{6}$/.test(String(p.periodo || '')) || periodo % 100 < 1 || periodo % 100 > 12) errores.push('PERIODO debe tener formato yyyymm con mes entre 01 y 12.');
    if (!Number.isInteger(Number(p.secuencia)) || Number(p.secuencia) < 1) errores.push('SECUENCIA debe ser un entero mayor o igual a 1.');
    if (p.tipoAccion === 'Alta') {
      if (!Number.isInteger(Number(p.lote)) || Number(p.lote) < 1) errores.push('LOTE de un Alta debe ser un entero mayor o igual a 1.');
    } else if (p.tipoAccion === 'Revolving') {
      if (Number(p.lote) !== 0) errores.push('LOTE de un Revolving debe ser 0.');
    } else errores.push('TIPO DE ACCIÓN debe ser Alta o Revolving.');
    if (p.tasa === '' || p.tasa == null || !isFinite(Number(p.tasa)) || Number(p.tasa) < 0) errores.push('TASA DE DESCUENTO debe ser un número mayor o igual a 0.');
    if (!String(p.negocio || '').trim()) errores.push('Nº DE NEGOCIO es obligatorio.');
    if (!/^\d{11}$/.test(String(p.cedente || ''))) errores.push('CEDENTE debe ser un CUIT de 11 dígitos sin separadores.');
    return errores;
  }

  const api = {
    PROVINCIAS, FIJOS, COLS_REPORTE, FORMATOS, COLUMNAS_MONTO, CAMPOS_INTERFAZ,
    leerTxtMeli, bancoMeliDeTxt, bancosParaMeli,
    leerCartera, sugerirColumnaCartera, columnasNumericasCartera, agruparCartera, valoresDistintos, sqlCartera,
    leerCsv, encabezadosEjemplo, leerDefinicionInterfaz, sugerirColumna, detectarHojaInterfaz,
    normalizar, provinciaPorNombre, round2, aNumero, aFechaSerial, aCodigoBanco,
    fechaDDMMYY, fechaYYYYMMDD, fechaLegible, hoyDDMMYY,
    detectarHoja, armarReporte, leerConciliacion,
    problemasBanco, codigoCreditoPorDefecto, prefijoBanco, numeroCredito, prefijosRepetidos, controlarBancos, controlarReporte,
    generarCuotas, generarCreditos, txtCuotas, txtCreditos, nombreArchivo,
    calcularSecuenciaLote, validarFormulario,
  };
  root.ValoMotor = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
