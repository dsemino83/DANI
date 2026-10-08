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

  // Equivalencias fijas nombre de banco → código, como las usa GetNet (entidad_bancaria / cod_entidad_bancaria).
  // Mandan sobre la búsqueda en las tablas (p. ej. HSBC → 7, Galicia, por la fusión).
  const ALIAS_BANCOS = [
    ['BANCO SANTANDER RIO S.A.', 72], ['BANCO MACRO S.A.', 285], ['BANCO DE LA PROVINCIA DE BUENOS AIRES', 14],
    ['BANCO DE LA NACION ARGENTINA', 11], ['BANCO DE GALICIA Y BUENOS AIRES S.A.', 7], ['BANCO BBVA ARGENTINA S A', 17],
    ['BANCO BBVA ARGENTINA S.A.', 17], ['BANCO DE LA CIUDAD DE BUENOS AIRES', 29], ['BANCO DE LA PROVINCIA DE CORDO', 20],
    ['INDUSTRIAL AND COMMERCIAL BANK OF CHINA (ARGENTINA) S.A.', 15], ['HSBC Bank Argentina S.A.', 7],
    ['BANCO PROVINCIA DEL NEUQUEN S.A.', 97],
  ];
  // Código de banco a partir del nombre ("BANCO PROVINCIA DEL NEUQUEN S.A." → 97): equivalencias fijas, después
  // Bancos MELI (nombre o COBIS) y Bancos. Compara sin "banco", "de", "S.A.", etc.; acepta palabras cortadas
  // ("CORDO" = "CORDOBA") y elige el nombre con más palabras en común.
  function crearBuscadorBancoPorNombre(bancos, bancosMeli) {
    const VACIAS = new Set(['banco', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'sa', 'sau', 's', 'a', 'u', 'argentina', 'arg', 'and', 'of', 'bank']);
    const clavePalabras = t => normalizar(String(t || '').replace(/_/g, ' ')).split(' ').filter(w => w && !VACIAS.has(w));
    const alias = new Map(ALIAS_BANCOS.map(([n, c]) => [clavePalabras(n).join(' '), c]));
    const lista = [];
    (bancosMeli || []).forEach(b => { const n = Number(b.numero); if (n) [b.nombre, b.cobis].forEach(x => x && lista.push({ n, p: clavePalabras(x) })); });
    (bancos || []).forEach(b => { const n = Number(b.codigo); if (n && b.nombre) lista.push({ n, p: clavePalabras(b.nombre) }); });
    const igualOPrefijo = (a, b) => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));
    const cache = new Map();
    return nombre => {
      const p = clavePalabras(nombre);
      const k = p.join(' ');
      if (!k) return null;
      if (alias.has(k)) return alias.get(k);
      if (cache.has(k)) return cache.get(k);
      let mejor = null, puntaje = 0;
      lista.forEach(x => {
        if (!x.p.length) return;
        const comunes = p.filter(w => x.p.some(v => igualOPrefijo(w, v))).length;
        // Todas las palabras de uno tienen que estar en el otro; gana el de más palabras en común y menos sobrantes.
        if (comunes < Math.min(p.length, x.p.length)) return;
        const pts = comunes * 10 - Math.abs(x.p.length - p.length);
        if (pts > puntaje) { puntaje = pts; mejor = x.n; }
      });
      cache.set(k, mejor);
      return mejor;
    };
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
    getnetCupones: {
      nombre: 'Cesión de cupones GetNet',
      requeridas: ['entidad_emisora', 'fecha_esperada_pago', 'mov_amount_install'],
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
        if (f.requeridas.length && f.requeridas.every(r => enc.includes(r))) {
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
      } else if (deteccion.formato === 'getnetCupones') {
        // Cesión de cupones GetNet: el banco viene por nombre (ENTIDAD_EMISORA) y se busca su código en Bancos.
        const nombreBanco = tomar(r, 'entidad_emisora');
        const resolver = opciones && opciones.codigoPorNombre;
        salida.push({
          ID_LOTE: tomar(r, 'pay_payment_id'),
          COD_BANCO: resolver ? resolver(nombreBanco) : null,
          NOMBRE_BANCO: nombreBanco,
          MONTO: aNumero(tomar(r, 'mov_amount_install')),
          FECHA_VENCIMIENTO: aFechaSerial(tomar(r, 'fecha_esperada_pago')),
          PLAZO: aNumero(tomar(r, 'gtwt_installments')),
          TNA: null, TEA: null, CFT: null,
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
      res.total = round2(Number(cab.slice(34, 54)) / 100); // importes en centavos: se divide por 100
    }
    lineas.slice(1).forEach((l, i) => {
      const f = l.slice(13, 21), imp = l.slice(21, 41);
      if (!/^\d{8}$/.test(f) || !/^\d+$/.test(imp.trim())) { res.errores.push(`Línea ${i + 2}: formato inválido.`); return; }
      res.filas.push({ fecha: partesASerial(+f.slice(0, 4), +f.slice(4, 6), +f.slice(6, 8)), monto: round2(Number(imp) / 100) });
    });
    if (res.cantidad != null && res.cantidad !== res.filas.length) res.errores.push(`La cabecera dice ${res.cantidad} registros y el archivo tiene ${res.filas.length}.`);
    const suma = res.filas.reduce((s, f) => s + f.monto, 0);
    if (res.total != null && Math.abs(res.total - suma) > 0.005) res.errores.push(`El total de la cabecera (${res.total}) no coincide con la suma de las líneas (${suma}).`);
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
    if (tipo === 'capital') return buscar(['ficuo saldo capital', 'saldo capital']) || contiene('saldo capital') || buscar(['ficuo capital', 'capital']) || contiene('capital');
    if (tipo === 'intDto') return buscar(['ficuo saldo int a dto', 'saldo int a dto', 'ficuo saldo int a desc', 'saldo int a descuento'])
      || buscar(['ficuo saldo interes a descuento', 'saldo interes a descuento']) || contiene('int a dto') || contiene('int a desc');
    if (tipo === 'intDev') return buscar(['ficuo int dev a cobrar', 'int dev a cobrar', 'ficuo int dev cobrar'])
      || contiene('dev a cobrar') || contiene('int dev') || contiene('int deveng');
    return '';
  }

  // Columnas a sumar: numéricas en todas las filas con dato, sin fechas ni identificadores.
  function columnasNumericasCartera(encabezados, datos) {
    const muestra = datos.slice(0, 2000);
    return encabezados.filter(h => {
      const n = normalizar(h);
      if (CARTERA_NO_SUMAR.includes(n) || /(^| )id$/.test(n) || /vencimiento|fecha|periodo/.test(n)) return false;
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
    const res = { leidas: datos.length, otrosPeriodos: 0, otrosNegocios: 0, pagas: 0, usadas: 0, grupos: [], totales: {}, porNegocio: {},
      calcTotales: { capital: 0, intDto: 0, intDev: 0 } };
    const grupos = new Map();
    cfg.sumar.forEach(c => { res.totales[c] = 0; });
    datos.forEach(r => {
      if (cfg.colPeriodo && cfg.periodo !== '' && cfg.periodo != null && valorTexto(r[cfg.colPeriodo]) !== String(cfg.periodo)) { res.otrosPeriodos++; return; }
      if (cfg.colNegocio && !mismoNegocio(r[cfg.colNegocio], cfg.negocios)) { res.otrosNegocios++; return; }
      const n = cfg.colCantidad ? aNumero(r[cfg.colCantidad]) || 0 : 1; // filas ya agregadas (Power BI) traen la cantidad de cuotas
      if (cfg.colEstado && excluidos.has(valorTexto(r[cfg.colEstado]))) { res.pagas += n; return; }
      res.usadas += n;
      const titular = valorTexto(r[cfg.colTitular]) || '(sin titular)';
      const negocio = cfg.colNegocio ? valorTexto(r[cfg.colNegocio]) : '';
      const k = titular; // se agrupa solo por titular
      if (!grupos.has(k)) {
        const e = cfg.ente ? cfg.ente(titular) : null;
        const g = { titular, ente: (e && e.nombre) || '', mis: e && e.mis != null ? e.mis : '', tipoDoc: cfg.colTipoDoc ? valorTexto(r[cfg.colTipoDoc]) : '', negocio,
          cuotas: 0, creditos: new Set(), sumas: {}, capital: 0, intDto: 0, intDev: 0 };
        cfg.sumar.forEach(c => { g.sumas[c] = 0; });
        grupos.set(k, g);
      }
      const g = grupos.get(k);
      g.cuotas += n;
      if (cfg.colCredito) g.creditos.add(valorTexto(r[cfg.colCredito]));
      if (!res.porNegocio[negocio]) res.porNegocio[negocio] = { titulares: new Set(), cuotas: 0, valor: 0, sumas: Object.fromEntries(cfg.sumar.map(c => [c, 0])) };
      const pn = res.porNegocio[negocio];
      pn.titulares.add(titular); pn.cuotas += n;
      // Valor a descuento = FICUO SALDO CAPITAL + (− FICUO SALDO INT A DTO + INT DEV A COBRAR)
      const calc = cfg.calc || {};
      const cap = calc.capital ? aNumero(r[calc.capital]) || 0 : 0;
      const dto = calc.intDto ? aNumero(r[calc.intDto]) || 0 : 0;
      const dev = calc.intDev ? aNumero(r[calc.intDev]) || 0 : 0;
      g.capital += cap; g.intDto += dto; g.intDev += dev;
      res.calcTotales.capital += cap; res.calcTotales.intDto += dto; res.calcTotales.intDev += dev;
      pn.valor += cap - dto + dev;
      cfg.sumar.forEach(c => { const v = aNumero(r[c]) || 0; g.sumas[c] += v; res.totales[c] += v; pn.sumas[c] += v; });
    });
    res.grupos = [...grupos.values()].map(g => {
      Object.keys(g.sumas).forEach(c => { g.sumas[c] = round2(g.sumas[c]); });
      return Object.assign(g, { creditos: g.creditos.size, capital: round2(g.capital), intDto: round2(g.intDto), intDev: round2(g.intDev),
        valor: round2(g.capital - g.intDto + g.intDev) });
    }).sort((a, b) => (a.titular < b.titular ? -1 : a.titular > b.titular ? 1 : 0));
    Object.keys(res.totales).forEach(c => { res.totales[c] = round2(res.totales[c]); });
    const ct = res.calcTotales;
    ct.valor = round2(ct.capital - ct.intDto + ct.intDev);
    ['capital', 'intDto', 'intDev'].forEach(k => { ct[k] = round2(ct[k]); });
    Object.values(res.porNegocio).forEach(pn => { pn.titulares = pn.titulares.size; pn.valor = round2(pn.valor); Object.keys(pn.sumas).forEach(c => { pn.sumas[c] = round2(pn.sumas[c]); }); });
    return res;
  }

  // ------------------------------------------------------------ POWER BI (modelo ePortfolio_Mensual)
  // Consulta DAX que la página manda al flujo de Power Automate ("Ejecutar una consulta en un conjunto de datos").
  // Agrega fctFideicomisoCuotaSaldo del último mes por titular, fideicomiso (negocio = FideicomisoSerie) y estado;
  // los nombres de salida coinciden con los que la pestaña reconoce sola (titular, Estado Cuota, saldo capital, ...).
  const PBI_TABLA = 'fctFideicomisoCuotaSaldo';
  function daxCarteraPowerBI(opciones = {}) {
    const t = opciones.tabla || PBI_TABLA;
    const c = n => `'${t}'[${n}]`;
    // Igual que el reporte ePortfolio: fideicomiso desde la tabla Fideicomiso y mes desde 'Fecha Periodo'[Mes]
    // (por las relaciones del modelo). Sin periodo: el último mes con cuotas; con periodo (ej. 2026-09): ese mes.
    const p = opciones.periodo != null ? String(opciones.periodo).trim() : '';
    const mes = p ? `"${p.replace(/"/g, '""')}"` : `MAXX ( SUMMARIZE ( '${t}', 'Fecha Periodo'[Mes] ), 'Fecha Periodo'[Mes] )`;
    // Solo los negocios de Clientes (por FideicomisoId o Serie): Power BI corta las respuestas de más de 15 MB.
    const negocios = (opciones.negocios || []).map(n => String(n).trim()).filter(Boolean);
    const lista = '{ ' + negocios.map(n => `"${n.replace(/"/g, '""')}"`).join(', ') + ' }';
    return [
      'DEFINE',
      `  VAR ElMes = ${mes}`,
      ...(negocios.length ? [
        '  VAR LosNegocios =',
        "    FILTER ( ALL ( 'Fideicomiso'[FideicomisoId], 'Fideicomiso'[FideicomisoSerie] ),",
        `      'Fideicomiso'[FideicomisoId] & "" IN ${lista} || 'Fideicomiso'[FideicomisoSerie] & "" IN ${lista} )`,
      ] : []),
      '  VAR T =',
      '    SUMMARIZECOLUMNS (',
      "      'Fecha Periodo'[Mes],",
      "      'Fideicomiso'[FideicomisoId],",
      "      'Fideicomiso'[FideicomisoSerie],",
      "      'Fideicomiso'[Fideicomiso],",
      `      ${c('CUITDeudor')},`,
      `      ${c('FideicomisoCreditoCuotaEstadoId')},`,
      `      ${c('Situacion ePortfolio')},`,
      "      TREATAS ( { ElMes }, 'Fecha Periodo'[Mes] ),",
      ...(negocios.length ? ['      LosNegocios,'] : []),
      `      "xCuotas", COUNTROWS ( '${t}' ),`,
      `      "xSaldoCapital", SUM ( ${c('Saldo_Capital')} ),`,
      `      "xIntDto", SUM ( ${c('Saldo_Interes_a_dto_')} ),`,
      `      "xIntDevVN", SUM ( ${c('Int Dev Calculado VN')} ),`,
      `      "xIntDevVD", SUM ( ${c('Int Dev Calculado VD')} ),`,
      `      "xSaldoDeuda", SUM ( ${c('SaldoDeDeuda')} )`,
      '    )',
      'EVALUATE',
      '  SELECTCOLUMNS (',
      '    T,',
      `    "Titular", ${c('CUITDeudor')},`,
      "    \"Negocio\", 'Fideicomiso'[FideicomisoSerie],",
      "    \"Fideicomiso\", 'Fideicomiso'[Fideicomiso],",
      "    \"FideicomisoId\", 'Fideicomiso'[FideicomisoId],",
      `    "Estado Cuota", ${c('FideicomisoCreditoCuotaEstadoId')},`,
      `    "Estado Cuota Desc", LOOKUPVALUE ( 'FideicomisoCreditoCuotaEstado'[FideicomisoCreditoCuotaEstado], 'FideicomisoCreditoCuotaEstado'[FideicomisoCreditoCuotaEstadoId], ${c('FideicomisoCreditoCuotaEstadoId')} ),`,
      `    "Situacion ePortfolio", ${c('Situacion ePortfolio')},`,
      "    \"Periodo\", 'Fecha Periodo'[Mes],",
      '    "Cuotas", [xCuotas],',
      '    "Saldo Capital", [xSaldoCapital],',
      '    "Saldo Int a Dto", [xIntDto],',
      '    "Int Dev a Cobrar", [xIntDevVN],',
      '    "Int Dev Calculado VD", [xIntDevVD],',
      '    "Saldo de Deuda", [xSaldoDeuda]',
      '  )',
      'ORDER BY [Titular]',
    ].join('\n');
  }

  // Consultas de diagnóstico: qué fideicomisos y periodos hay en la tabla de cuotas y cómo se ven por la dimensión Fideicomiso.
  function daxDiagnosticoPowerBI(tabla = PBI_TABLA) {
    const c = n => `'${tabla}'[${n}]`;
    return {
      porTabla: ['EVALUATE', 'SUMMARIZECOLUMNS (', `  ${c('FideicomisoId')},`, `  ${c('Periodo')},`, `  ${c('Fecha de Corte')},`,
        `  "Cuotas", COUNTROWS ( '${tabla}' ),`, `  "Saldo capital", SUM ( ${c('Saldo_Capital')} )`, ')',
        `ORDER BY ${c('FideicomisoId')}, ${c('Periodo')}`].join('\n'),
      porDimension: ['EVALUATE', 'SUMMARIZECOLUMNS (', "  'Fideicomiso'[FideicomisoId],", "  'Fideicomiso'[FideicomisoSerie],", "  'Fideicomiso'[Fideicomiso],",
        "  'Fecha Periodo'[Mes],", `  "Cuotas", COUNTROWS ( '${tabla}' ),`, `  "Periodo (tabla de cuotas)", MAX ( ${c('Periodo')} ),`, `  "Saldo capital", SUM ( ${c('Saldo_Capital')} )`, ')',
        "ORDER BY 'Fideicomiso'[FideicomisoId], 'Fecha Periodo'[Mes]"].join('\n'),
    };
  }

  // Filas que devuelve Power BI (firstTableRows del flujo o la respuesta cruda de executeQueries):
  // las claves vienen como "[Titular]" o "tabla[Columna]"; se dejan solo con el nombre de la columna.
  function leerFilasPowerBI(respuesta) {
    let filas = respuesta;
    if (filas && !Array.isArray(filas)) {
      filas = filas.filas || filas.firstTableRows || filas.rows
        || (filas.results && filas.results[0] && filas.results[0].tables && filas.results[0].tables[0] && filas.results[0].tables[0].rows);
    }
    if (typeof filas === 'string') { try { filas = JSON.parse(filas); } catch (e) { /* no es JSON */ } }
    if (!Array.isArray(filas)) throw new Error('Power BI no devolvió filas (se esperaba una lista en "filas" o "firstTableRows").');
    const limpiar = k => { const m = String(k).match(/\[([^\]]*)\]\s*$/); return (m ? m[1] : String(k)).trim(); };
    const encabezados = [];
    const datos = filas.map(r => {
      const o = {};
      Object.keys(r || {}).forEach(k => { const h = limpiar(k); if (!encabezados.includes(h)) encabezados.push(h); o[h] = r[k]; });
      return o;
    });
    // Periodo y fecha de corte como texto corto (Power BI manda las fechas como 2026-09-30T00:00:00).
    datos.forEach(o => Object.keys(o).forEach(h => {
      if (typeof o[h] === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z?$/.test(o[h])) o[h] = o[h].slice(0, 10);
    }));
    const colCantidad = encabezados.find(h => normalizar(h) === 'cuotas') || '';
    // Identificadores que no son importes (vienen numéricos de Power BI).
    const noSumar = encabezados.filter(h => /^(titular|negocio|fideicomisoid|estado cuota|situacion eportfolio)$/.test(normalizar(h)));
    return { encabezados, datos, colCantidad, noSumar };
  }

  // ------------------------------------------------------------ INVENTARIO DE GARANTÍAS
  // Reportes de ancho fijo del sistema de cartera (garhicon.sqr "asociadas a deuda", garhisin.sqr "no asociadas a producto").
  // Detalle: MONEDA · PREF. (S/N) · ABIERTA_CERRADA · TIPO GARANTIA [43,65) · CODIGO GARANTIA [65,91) · CLIENTE [91,97)
  // · DESCRIPCION CLIENTE · MONTO PESOS · MONTO MONEDA ORIG. Los importes se toman del final de la línea
  // (la descripción puede traer caracteres de dos bytes que corren las columnas).
  const MONEDAS_GARANTIA = { 2: 'Dólar EE.UU.', 80: 'Pesos' };
  function leerInventarioGarantias(texto, nombreArchivo = '') {
    const lineas = String(texto).replace(/\r/g, '').split('\n');
    const num = v => Number(String(v).replace(/,/g, ''));
    let reporte = '', titulo = '', fecha = '';
    const filas = [], controles = [];
    for (const l of lineas) {
      if (!reporte) { const m = l.match(/REPORTE\s*:\s*(\S+)/); if (m) reporte = m[1]; }
      if (!titulo) { const m = l.match(/HISTORICO DE (GARANTIAS[A-Z ]+?)\s{2,}/); if (m) titulo = m[1].trim(); }
      if (!fecha) { const m = l.match(/\bAL:\s*(\d{1,2}\/[A-Z]{3}\/\d{4})/); if (m) fecha = m[1]; }
      const d = l.match(/^\s+(\d+)\s+([SN])\s+([AC])\s/);
      if (d && l.length > 100) {
        const m = l.slice(97).match(/^(.*?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$/);
        if (!m) continue;
        filas.push({
          moneda: Number(d[1]), monedaDesc: MONEDAS_GARANTIA[Number(d[1])] || String(d[1]), preferida: d[2] === 'S',
          abiertaCerrada: d[3], tipo: l.slice(43, 65).trim(), codigo: l.slice(65, 91).trim(), cliente: l.slice(91, 97).trim(),
          descripcion: m[1].trim(), montoPesos: num(m[2]), montoOrigen: num(m[3]),
        });
        continue;
      }
      // Nombre completo del tipo (el detalle lo trae cortado a 22 caracteres).
      const t = l.match(/\*\*\* TOTAL TIPO GARANTIA (.+?) EN MONEDA /);
      if (t) { filas.filter(f => f.tipo !== t[1] && t[1].startsWith(f.tipo)).forEach(f => { f.tipo = t[1]; }); continue; }
      const c = l.match(/\*\* TOTAL (NO PREFERIDA|PREFERIDA) PARA MONEDA (.+?) ES:\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})/);
      if (c) controles.push({ preferida: c[1] === 'PREFERIDA', moneda: c[2].trim(), montoPesos: num(c[3]), montoOrigen: num(c[4]) });
    }
    if (!filas.length) throw new Error(`${nombreArchivo || 'El archivo'} no tiene líneas de garantías (se espera el reporte HISTORICO DE GARANTIAS VIGENTES).`);
    const origen = /garhicon/i.test(reporte) || /ASOCIADAS A DEUDA/.test(titulo) ? 'Asociada a deuda'
      : /garhisin/i.test(reporte) || /NO ASOCIADAS/.test(titulo) ? 'No asociada a producto' : (titulo || reporte);
    filas.forEach(f => Object.assign(f, { origen, fecha, archivo: nombreArchivo }));
    // Control: los subtotales "** TOTAL PREFERIDA / NO PREFERIDA" del reporte contra la suma del detalle.
    const diferencias = controles.map(c => {
      const desc = c.moneda.toUpperCase().startsWith('PESOS') ? 'Pesos' : 'Dólar EE.UU.';
      const suma = round2(filas.filter(f => f.preferida === c.preferida && f.monedaDesc === desc).reduce((a, f) => a + f.montoPesos, 0));
      return Object.assign(c, { suma, ok: Math.abs(suma - c.montoPesos) < 0.01 });
    });
    return { reporte, titulo, fecha, origen, filas, controles: diferencias };
  }

  // ------------------------------------------------------------ INVENTARIOS CONTABLES DE GARANTÍAS
  // A partir de garhicon + garhisin se arman los inventarios por cuenta (modelo: Inventarios_ejemplos.xlsx).
  // moneda 'USD': importe en dólares (monto moneda orig.) × tipo de cambio Com. A 3500; 'ARS': monto en pesos.
  const INVENTARIOS_CONTABLES = [
    { id: '715.023.007.02', cuenta: '715.023.007.02.9', contra: '725.084.007.02.9', titulo: 'Preferidas en USD - EFECTU$S',
      moneda: 'USD', filtro: f => f.moneda === 2 && f.preferida && f.tipo === 'EFECTU$S', columnas: ['ente', 'fecha', 'concepto', 'cuit', 'importe'] },
    { id: '715.025.091.02', cuenta: '715.025.091.02.1', contra: '725.084.091.02.6', titulo: 'No preferidas en USD',
      moneda: 'USD', filtro: f => f.moneda === 2 && !f.preferida, columnas: ['ente', 'fecha', 'concepto', 'cuit', 'importe'] },
    { id: '715.023.091.02', cuenta: '715.023.091.02.6', contra: '725.084.091.02.6', titulo: 'Preferidas en USD (sin EFECTU$S)',
      moneda: 'USD', filtro: f => f.moneda === 2 && f.preferida && f.tipo !== 'EFECTU$S', columnas: ['ente', 'fecha', 'concepto', 'cuit', 'importe'] },
    { id: '711.023.090.3', cuenta: '711.023.090.3', contra: '721.084.090.3', titulo: 'Preferidas en pesos',
      moneda: 'ARS', filtro: f => f.moneda === 80 && f.preferida, columnas: ['ente', 'concepto', 'cuit', 'importe'] },
    { id: '711.025.090.8', cuenta: '711.025.090.8', contra: '721.084.090.3', titulo: 'No preferidas en pesos',
      moneda: 'ARS', filtro: f => f.moneda === 80 && !f.preferida, columnas: ['fecha', 'ente', 'concepto', 'cuit', 'importe'] },
  ];
  const INVENTARIO_DENOMINACION = 'Garantía Valor Actualizado';
  const INVENTARIO_FIRMAS = [
    { nombre: 'Otto Zygal', cargo: 'Analista Senior de Administración de Carteras de Crédito y Garantías' },
    { nombre: 'Paola S. Pupich', cargo: 'Jefe de Administración de Carteras de Crédito y Garantías' },
  ];
  // Tipos que no son títulos: el concepto es solo el nombre del cliente.
  const TIPOS_SIN_SUFIJO = /^(EFECT|EFECTU\$S|FZAGRAL|FZAESPEC|AVALGRAL|CESIOCHEQ|CESION|OTVIV)/;
  const conceptoGarantia = f => (TIPOS_SIN_SUFIJO.test(f.tipo) ? f.descripcion : `${f.descripcion} - ${f.tipo}`);
  const fechaReporteIso = t => { // "1/OCT/2026" → "2026-10-01"
    const m = String(t || '').match(/^(\d{1,2})\/([A-Z]{3})\/(\d{4})$/);
    const meses = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const meses2 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    if (!m) return '';
    let i = meses.indexOf(m[2]); if (i < 0) i = meses2.indexOf(m[2]);
    return i < 0 ? '' : `${m[3]}-${ceros(i + 1, 2)}-${ceros(m[1], 2)}`;
  };

  // Fecha del inventario: los reportes de los primeros días del mes (AL 1/OCT) corresponden al cierre del mes anterior
  // (30/09). Se toma hasta el día 10; después, la fecha del reporte.
  function fechaInventarioDesdeReporte(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    if (Number(m[3]) > 10) return iso;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 0);
    return claveDia(d);
  }

  // Padrón (CUIT y fecha de cada garantía) armado desde inventarios anteriores en Excel (hojas con Ente, Fecha, Concepto,
  // CUIT, Importe, o Cliente/CUIT). Devuelve { entes: {ente: {cuit, historial:[{fecha, concepto, importe}]}}, nombres: {nombre: cuit} }.
  function leerPadronDesdeInventarios(hojas) {
    const padron = { entes: {}, nombres: {}, garantias: {} };
    const iso = v => {
      if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${ceros(v.getMonth() + 1, 2)}-${ceros(v.getDate(), 2)}`;
      if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${ceros(d.getUTCMonth() + 1, 2)}-${ceros(d.getUTCDate(), 2)}`; }
      const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/) || String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return '';
      return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${ceros(m[2], 2)}-${ceros(m[1], 2)}`;
    };
    const cuitDe = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length === 11 ? d : ''; };
    hojas.forEach(h => {
      const filas = h.filas || [];
      for (let i = 0; i < Math.min(filas.length, 20); i++) {
        const enc = (filas[i] || []).map(normalizar);
        const col = n => enc.indexOf(n);
        const cCuit = col('cuit');
        if (cCuit < 0) continue;
        const cEnte = col('ente'), cFecha = col('fecha'), cConc = col('concepto'), cImp = col('importe');
        const cNombre = cConc > -1 ? cConc : col('cliente');
        for (const r of filas.slice(i + 1)) {
          if (!r) continue;
          const cuit = cuitDe(r[cCuit]);
          if (!cuit) continue;
          const nombre = String(r[cNombre] == null ? '' : r[cNombre]).trim();
          if (nombre) padron.nombres[normalizar(nombre.replace(/\s*-\s*[^-]*$/, '')) || normalizar(nombre)] = cuit;
          const ente = cEnte > -1 ? String(r[cEnte] == null ? '' : r[cEnte]).trim() : '';
          if (!/^\d+$/.test(ente)) continue;
          const e = padron.entes[ente] || (padron.entes[ente] = { cuit, historial: [] });
          e.cuit = cuit;
          e.historial.push({ fecha: cFecha > -1 ? iso(r[cFecha]) : '', concepto: nombre, importe: cImp > -1 ? aNumero(r[cImp]) || 0 : 0 });
        }
        break;
      }
    });
    return padron;
  }

  // Base de entes desde Excel: personas jurídicas (legal_name, tax_id_number, external_code), personas humanas
  // (first_name, last_name, second_last_name, tax_id_number, external_code) o una planilla simple Ente / CUIT / Nombre.
  // Solo se guardan ente, CUIT y nombre.
  function leerBaseEntes(hojas) {
    const filas = [];
    let sinEnte = 0, sinCuit = 0;
    hojas.forEach(h => {
      const t = h.filas || [];
      for (let i = 0; i < Math.min(t.length, 15); i++) {
        const enc = (t[i] || []).map(normalizar);
        const col = (...ns) => { for (const n of ns) { const k = enc.indexOf(n); if (k > -1) return k; } return -1; };
        const cEnte = col('external code', 'ente', 'codigo ente', 'cliente', 'codigo cliente');
        const cCuit = col('tax id number', 'cuit', 'cuil', 'cuit cuil');
        if (cEnte < 0 || cCuit < 0) continue;
        const cRazon = col('legal name', 'razon social', 'nombre', 'denominacion', 'descripcion');
        const cNom = col('first name'), cApe = col('last name'), cApe2 = col('second last name');
        const tipo = cRazon > -1 && cNom < 0 ? 'juridica' : cNom > -1 ? 'humana' : '';
        for (const r of t.slice(i + 1)) {
          if (!r) continue;
          const ente = String(r[cEnte] == null ? '' : r[cEnte]).trim().replace(/\.0+$/, '');
          const cuit = String(r[cCuit] == null ? '' : r[cCuit]).replace(/\D/g, '');
          if (!/^\d+$/.test(ente)) { sinEnte++; continue; }
          if (cuit.length !== 11) { sinCuit++; continue; }
          const nombre = cRazon > -1 && cNom < 0 ? String(r[cRazon] || '').trim()
            : [r[cNom], r[cApe], cApe2 > -1 ? r[cApe2] : ''].map(x => String(x == null ? '' : x).trim()).filter(Boolean).join(' ');
          filas.push({ ente, cuit, nombre: nombre.replace(/\s+/g, ' '), tipo });
        }
        break;
      }
    });
    const unicos = new Map();
    filas.forEach(f => { if (!unicos.has(f.ente)) unicos.set(f.ente, f); });
    return { filas: [...unicos.values()], sinEnte, sinCuit, repetidos: filas.length - unicos.size };
  }

  function unirPadron(base, nuevo) {
    const p = { entes: Object.assign({}, (base && base.entes) || {}), nombres: Object.assign({}, (base && base.nombres) || {}, nuevo.nombres || {}),
      garantias: Object.assign({}, (base && base.garantias) || {}, nuevo.garantias || {}) };
    Object.entries(nuevo.entes || {}).forEach(([k, v]) => { p.entes[k] = v; });
    return p;
  }

  // Arma los inventarios. padron.garantias[codigo] = {fecha, cuit, concepto} (lo cargado a mano) manda sobre el resto.
  function armarInventariosContables(filas, padron = {}, base = {}) {
    const entes = padron.entes || {}, garantias = padron.garantias || {}, nombres = padron.nombres || {};
    const cuitPorNombre = desc => {
      const n = normalizar(desc);
      if (!n) return '';
      if (nombres[n]) return nombres[n];
      const k = Object.keys(nombres).find(x => x.length >= 8 && (x.startsWith(n) || n.startsWith(x)));
      return k ? nombres[k] : '';
    };
    return INVENTARIOS_CONTABLES.map(def => {
      const elegidas = filas.filter(f => def.filtro(f)).map(f => Object.assign({}, f, { importe: round2(def.moneda === 'USD' ? f.montoOrigen : f.montoPesos) }))
        .filter(f => f.importe !== 0);
      // Fecha por ente: si el inventario anterior tiene una sola garantía de ese ente, esa fecha; si tiene varias,
      // la del importe más parecido (sin repetir).
      const usadas = new Map();
      const filasInv = elegidas.map(f => {
        const g = garantias[f.codigo] || {};
        const e = entes[f.cliente];
        let fecha = g.fecha || '', concepto = g.concepto || '';
        if (!fecha && e && e.historial && e.historial.length) {
          const libres = e.historial.map((h, i) => i).filter(i => !(usadas.get(f.cliente) || new Set()).has(i));
          const pool = libres.length ? libres : e.historial.map((h, i) => i);
          const i = pool.reduce((b, j) => (Math.abs(e.historial[j].importe - f.importe) < Math.abs(e.historial[b].importe - f.importe) ? j : b), pool[0]);
          fecha = e.historial[i].fecha;
          if (!usadas.has(f.cliente)) usadas.set(f.cliente, new Set());
          usadas.get(f.cliente).add(i);
        }
        const b = base[f.cliente];
        const cuit = g.cuit || (b && b.cuit) || (e && e.cuit) || cuitPorNombre(f.descripcion);
        // Nombre: el del inventario anterior (el reporte corta los nombres y a veces pega nombre y apellido),
        // sin el sufijo que traía ("- AL41", "- FIANZA"); después se agrega el tipo de la garantía actual.
        if (!concepto && e && e.historial && e.historial.length && e.historial[0].concepto) {
          const nombre = e.historial[0].concepto.replace(/\s*-\s*[^-]*$/, '').trim() || e.historial[0].concepto;
          concepto = conceptoGarantia(Object.assign({}, f, { descripcion: nombre }));
        }
        if (!concepto && b && b.nombre) concepto = conceptoGarantia(Object.assign({}, f, { descripcion: b.nombre }));
        return { codigo: f.codigo, ente: f.cliente, fecha, concepto: concepto || conceptoGarantia(f), cuit, importe: f.importe, tipo: f.tipo,
          descripcion: f.descripcion, origen: f.origen, faltaCuit: !cuit, faltaFecha: !fecha };
      }).sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999') || String(a.concepto).localeCompare(String(b.concepto)));
      return { def, filas: filasInv, total: round2(filasInv.reduce((a, f) => a + f.importe, 0)) };
    });
  }

  // Com. A 3500 del BCRA (com3500.xls): filas con una fecha y el tipo de cambio de referencia.
  function leerCom3500(filas) {
    const lista = [];
    const iso = v => {
      if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${ceros(v.getMonth() + 1, 2)}-${ceros(v.getDate(), 2)}`;
      if (typeof v === 'number' && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${ceros(d.getUTCMonth() + 1, 2)}-${ceros(d.getUTCDate(), 2)}`; }
      const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${ceros(m[2], 2)}-${ceros(m[1], 2)}` : '';
    };
    (filas || []).forEach(r => {
      if (!r) return;
      for (let i = 0; i < r.length - 1; i++) {
        const f = iso(r[i]);
        if (!f) continue;
        const tc = r.slice(i + 1).map(aNumero).find(x => x != null && x > 0 && x < 1e6);
        if (tc != null) { lista.push({ fecha: f, tc }); break; }
      }
    });
    const unicos = new Map(lista.map(x => [x.fecha, x]));
    return [...unicos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  // Respuesta de la API de estadísticas del BCRA (variable 5, Com. A 3500): v4 {results:[{detalle:[{fecha, valor}]}]}
  // o v3 {results:[{fecha, valor}]} → [{fecha, tc}] ordenado.
  function leerTcApiBcra(json) {
    const res = (json && (json.results || (json.body && json.body.results))) || [];
    const filas = res.flatMap(r => (Array.isArray(r.detalle) ? r.detalle : [r]));
    const lista = filas.map(x => ({ fecha: String(x.fecha || '').slice(0, 10), tc: Number(x.valor) }))
      .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) && x.tc > 0);
    const unicos = new Map(lista.map(x => [x.fecha, x]));
    return [...unicos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  // Tipo de cambio del último día hábil del mes de 'hoy' (el mes del inventario), o el último publicado antes de ese día.
  function elegirTipoCambio(lista, hoy = new Date(), feriados = []) {
    if (!lista || !lista.length) return null;
    const objetivo = claveDia(ultimoDiaHabil(hoy, 0, feriados));
    const exacto = lista.find(x => x.fecha === objetivo);
    if (exacto) return Object.assign({ objetivo, exacto: true }, exacto);
    const previos = lista.filter(x => x.fecha <= objetivo);
    const r = previos.length ? previos[previos.length - 1] : lista[lista.length - 1];
    return Object.assign({ objetivo, exacto: false }, r);
  }

  // Importe en letras (castellano), ej. 1234.5 → "MIL DOSCIENTOS TREINTA Y CUATRO CON 50/100".
  function numeroEnLetras(n) {
    const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
      'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO',
      'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
    const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
    const menorMil = x => {
      if (x === 0) return '';
      if (x === 100) return 'CIEN';
      const c = Math.floor(x / 100), r = x % 100;
      const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
      return [C[c], dec].filter(Boolean).join(' ');
    };
    const apocope = t => t.replace(/VEINTIUNO$/, 'VEINTIUN').replace(/(^| )UNO$/, '$1UN');
    const entero = x => {
      if (x === 0) return 'CERO';
      const partes = [];
      const billones = Math.floor(x / 1e12), millones = Math.floor((x % 1e12) / 1e6), miles = Math.floor((x % 1e6) / 1e3), resto = x % 1e3;
      if (billones) partes.push(billones === 1 ? 'UN BILLON' : apocope(entero(billones)) + ' BILLONES');
      if (millones) partes.push(millones === 1 ? 'UN MILLON' : apocope(entero(millones)) + ' MILLONES');
      if (miles) partes.push(miles === 1 ? 'MIL' : apocope(menorMil(miles)) + ' MIL');
      if (resto) partes.push(menorMil(resto));
      return partes.join(' ');
    };
    const v = Math.round(Math.abs(Number(n) || 0) * 100);
    const ent = Math.floor(v / 100), cent = v % 100;
    return `${n < 0 ? 'MENOS ' : ''}${entero(ent)} CON ${ceros(cent, 2)}/100`;
  }

  // ------------------------------------------------------------ BASTANTEO DE FIRMANTES
  // A partir del "Resumen documentos OCR" (PDF) y la planilla del cliente (Excel con los firmantes y sus CUIT) se arma
  // un JSON por poder (modelo PODER_COMPLEJO_AR). Catálogo de circuitos operativos: código, nombre y clave del JSON.
  const BASTANTEO_CATALOGO = [
    ['CA_ABRIR', 'Abrir caja de ahorro', 'abrir_caja_de_ahorro'], ['CA_CERRAR', 'Cerrar caja de ahorro', 'cerrar_caja_de_ahorro'],
    ['CA_EXTRAER', 'Extraer fondos', 'extraer_fondos'], ['CA_SOBREGIRO_FCI', 'Sobregiro de FCI', 'sobregiro_de_fci'],
    ['CC_ABRIR', 'Abrir cuentas corrientes', 'abrir_cuentas_corrientes'], ['CC_CERRAR', 'Cerrar cuentas corrientes', 'cerrar_cuentas_corrientes'],
    ['CC_GIRAR_DESC', 'Girar descubierto dentro limites', 'girar_descubierto_dentro_limites'], ['CC_SOL_ACUERDO_DESC', 'Solicitar acuerdo descubierto', 'solicitar_acuerdo_descubierto'],
    ['CG_CEDER_CREDITO_GAR', 'Ceder credito en garantia', 'ceder_credito_en_garantia'], ['CG_CREDITO_MONEDA_EX', 'Tomar credito en moneda extranjera', 'tomar_credito_en_moneda_extranjera'],
    ['CG_CREDITO_PESOS', 'Tomar credito en pesos', 'tomar_credito_en_pesos'], ['CG_GAR_ADUANERA', 'Solicitar garantia aduanera', 'solicitar_garantia_aduanera'],
    ['CG_HIPOTECA', 'Constituir hipoteca', 'construir_hipoteca'], ['CG_OTORGAR_FIANZAS', 'Otorgar fianzas', 'otorgar_fianzas'],
    ['CG_PERCIBIR_CREDITOS', 'Percibir importes de creditos', 'percibir_importes_de_creditos'], ['CG_PRENDA_REG', 'Constituir prenda con registro', 'construir_prenda_con_registro'],
    ['CG_PRENDA_SIN_REG', 'Constituir prenda sin registro', 'construir_prenda_sin_registro'], ['CG_SOL_GARANTIAS', 'Solicitar garantias', 'solicitar_garantias'],
    ['COMEX_CAMBIO_MONEDA', 'Operaciones cambio moneda', 'operaciones_cambio_moneda'], ['COMEX_CARTA_CRED_IMP', 'Solicitar apertura carta credito importacion', 'solicitar_apertura_carta_credito_importacion'],
    ['COMEX_POSTFIN_EXPORT', 'Solicitar postfinanciacion de exportaciones', 'solicitar_postfinanciacion_de_exportaciones'], ['COMEX_PREFIN_EXPORT', 'Solicitar prefinanciacion de exportaciones', 'solicitar_prefinanciacion_de_exportaciones'],
    ['CONS_SOLICITAR_SALDO', 'Solicitar saldo de cuentas', 'solicitar_saldo_de_cuentas'], ['CSEG_ABRIR', 'Abrir caja de seguridad', 'abrir_caja_de_seguridad'],
    ['CSEG_ACCEDER', 'Acceder caja de seguridad', 'acceder_caja_de_seguridad'], ['CSEG_CERRAR', 'Cerrar caja de seguridad', 'cerrar_caja_de_seguridad'],
    ['CTR_BANCA_ELECTRON', 'Firmar contratos de banca electronica', 'firmar_contratos_de_banca_electronica'], ['CTR_FIDEICOMISO', 'Celebrar contratos fideicomiso', 'celebrar_contratos_fideicomiso'],
    ['CTR_FIRMA_DIGITAL', 'Firma digital', 'firma_digital'], ['CTR_FIRMAR_SERVICIOS', 'Firmar contratos de prestacion de servicios', 'firmar_contratos_de_prestacion_de_servicios'],
    ['CTR_LEASING', 'Tomar bienes en leasing', 'tomar_bienes_en_leasing'], ['ECHEQ_COBRAR', 'Cobrar cheques', 'cobrar_cheques'],
    ['ECHEQ_DEPOSITAR', 'Depositar eCheqs', 'depositar_echeqs'], ['ECHEQ_DESC_PAGO_DIF', 'Descontar cheques pagos diferidos', 'descontar_cheques_pagos_diferidos'],
    ['ECHEQ_DESCONTAR', 'Descontar cheques', 'descontar_cheques'], ['ECHEQ_ENDOSAR', 'Endosar cheques', 'endosar_cheques'],
    ['ECHEQ_ENDOSAR_DEP', 'Endosar para deposito', 'endosar_para_deposito'], ['ECHEQ_FIRMAR', 'Firmar cheques', 'firmar_cheques'],
    ['ECHEQ_FIRMAR_PROV', 'Proveedores firmar cheques', 'proveedores_firmar_cheques'], ['ECHEQ_RET_CHEQUERAS', 'Retirar chequeras', 'retirar_chequeras'],
    ['ECHEQ_RET_RECHAZADOS', 'Retirar cheques rechazados', 'retirar_cheques_rechazados'], ['ECHEQ_SOL_CHEQUERAS', 'Solicitar chequeras', 'solicitar_chequeras'],
    ['LYP_ACEPTAR_LETRAS', 'Aceptar letras de cambio', 'aceptar_letras_de_cambio'], ['LYP_AVALAR_LETRAS', 'Avalar letras de cambio', 'avalar_letras_de_cambio'],
    ['LYP_DESC_PAGARES', 'Descontar pagares', 'descontar_pagares'], ['LYP_ENDOSAR_PAGARES', 'Endosar pagares', 'endosar_pagares'],
    ['LYP_FIRMAR_LETRAS', 'Firmar letras de cambio', 'firmar_letras_de_cambio'], ['LYP_FIRMAR_PAGARES', 'Firmar pagares', 'firmar_pagares'],
    ['PF_CEDER', 'Ceder plazo fijo', 'ceder_plazo_fijo'], ['PF_COBRAR', 'Cobrar plazo fijo', 'cobrar_plazo_fijo'],
    ['PF_CONSTITUIR', 'Constituir plazo fijo', 'constituir_plazo_fijo'], ['PF_ENDOSAR', 'Endosar plazo fijo', 'endosar_plazo_fijo'],
    ['TRF_A_TERCEROS', 'Transferencias a cuentas de terceros', 'transferencias_a_cuentas_de_terceros'], ['TRF_ENTRE_CTAS_EMP', 'Transferencias entre cuentas de la empresa', 'transferencias_entre_cuentas_de_la_empresa'],
    ['VN_ABRIR_CUENTA_ALYC', 'Abrir cuentas ALyC', 'abrir_cuentas_alyc'], ['VN_CAUCIONAR', 'Caucionar valores negociables', 'caucionar_valores_negociables'],
    ['VN_DEPOSITAR', 'Depositar valores negociables', 'depositar_valores_negociables'], ['VN_OPERAR_BOLSAS', 'Operar en bolsas', 'operar_en_bolsas'],
    ['VN_ORDEN_COMPRA', 'Ordenar compra valores negociables', 'ordenar_compra_valores_negociables'], ['VN_ORDEN_VENTA', 'Ordenar venta valores negociables', 'ordenar_venta_valores_negociables'],
    ['VN_RETIRAR', 'Retirar valores negociables', 'retirar_valores_negociables'],
  ];
  // Orden de las facultades en el JSON (el del modelo PODER_COMPLEJO_AR); incluye tres sin código en el catálogo.
  const BASTANTEO_CLAVES = ['extraer_fondos', 'operar_en_bolsas', 'abrir_cuentas_alyc', 'tomar_bienes_en_leasing', 'solicitar_saldo_de_cuentas',
    'firmar_contratos_de_prestacion_de_servicios', 'firmar_contratos_de_banca_electronica', 'operaciones_cambio_moneda', 'proveedores_firmar_cheques',
    'firma_digital', 'celebrar_contratos_fideicomiso', 'construir_prenda_con_registro', 'construir_prenda_sin_registro', 'construir_hipoteca',
    'otorgar_fianzas', 'ceder_credito_en_garantia', 'tomar_credito_en_pesos', 'tomar_credito_en_moneda_extranjera',
    'solicitar_apertura_carta_credito_importacion', 'solicitar_prefinanciacion_de_exportaciones', 'solicitar_postfinanciacion_de_exportaciones',
    'percibir_importes_de_creditos', 'descontar_pagares', 'solicitar_garantia_aduanera', 'descontar_cheques_pagos_diferidos', 'solicitar_garantias',
    'abrir_caja_de_seguridad', 'cerrar_caja_de_seguridad', 'acceder_caja_de_seguridad', 'firmar_letras_de_cambio', 'aceptar_letras_de_cambio',
    'avalar_letras_de_cambio', 'firmar_pagares', 'endosar_pagares', 'depositar_valores_negociables', 'retirar_valores_negociables',
    'ordenar_compra_valores_negociables', 'ordenar_venta_valores_negociables', 'alquilar_valores_negociables', 'caucionar_valores_negociables',
    'celebrar_contratos_colocacion', 'celebrar_contratos_underwriting', 'firmar_cheques', 'endosar_cheques', 'endosar_para_deposito', 'cobrar_cheques',
    'descontar_cheques', 'retirar_cheques_rechazados', 'depositar_echeqs', 'solicitar_chequeras', 'retirar_chequeras', 'constituir_plazo_fijo',
    'cobrar_plazo_fijo', 'endosar_plazo_fijo', 'ceder_plazo_fijo', 'transferencias_entre_cuentas_de_la_empresa', 'transferencias_a_cuentas_de_terceros',
    'abrir_caja_de_ahorro', 'cerrar_caja_de_ahorro', 'sobregiro_de_fci', 'abrir_cuentas_corrientes', 'cerrar_cuentas_corrientes',
    'girar_descubierto_dentro_limites', 'solicitar_acuerdo_descubierto'];
  const BASTANTEO_EXTRA = { alquilar_valores_negociables: 'Alquilar valores negociables', celebrar_contratos_colocacion: 'Celebrar contratos de colocación',
    celebrar_contratos_underwriting: 'Celebrar contratos de underwriting' };

  // Facultades tal como aparecen en el resumen OCR: [grupo, texto] → clave del JSON.
  const FACULTADES_OCR = [
    ['cuentas corrientes', 'abrir', 'abrir_cuentas_corrientes'], ['cuentas corrientes', 'cerrar', 'cerrar_cuentas_corrientes'],
    ['cuentas corrientes', 'girar en descubierto', 'girar_descubierto_dentro_limites'], ['cuentas corrientes', 'solicitar acuerdo en descubierto', 'solicitar_acuerdo_descubierto'],
    ['cajas de ahorro', 'abrir', 'abrir_caja_de_ahorro'], ['cajas de ahorro', 'cerrar', 'cerrar_caja_de_ahorro'],
    ['', 'extraer fondos', 'extraer_fondos'], ['', 'sobregiro de fci', 'sobregiro_de_fci'],
    ['caja de seguridad', 'abrir', 'abrir_caja_de_seguridad'], ['caja de seguridad', 'cerrar', 'cerrar_caja_de_seguridad'], ['caja de seguridad', 'acceder', 'acceder_caja_de_seguridad'],
    ['plazos fijos', 'constituir', 'constituir_plazo_fijo'], ['plazos fijos', 'cobrar', 'cobrar_plazo_fijo'], ['plazos fijos', 'endosar', 'endosar_plazo_fijo'], ['plazos fijos', 'ceder', 'ceder_plazo_fijo'],
    ['transferencias', 'entre cuentas de la empresa', 'transferencias_entre_cuentas_de_la_empresa'], ['transferencias', 'a cuentas de terceros', 'transferencias_a_cuentas_de_terceros'],
    ['chequeras', 'solicitar', 'solicitar_chequeras'], ['chequeras', 'retirar', 'retirar_chequeras'],
    ['cheques', 'firmar', 'firmar_cheques'], ['cheques', 'endosar', 'endosar_cheques'], ['cheques', 'cobrar', 'cobrar_cheques'], ['cheques', 'descontar', 'descontar_cheques'],
    ['cheques', 'retirar rechazados', 'retirar_cheques_rechazados'], ['cheques', 'depositar e cheqs', 'depositar_echeqs'], ['cheques', 'depositar echeqs', 'depositar_echeqs'],
    ['cheques', 'endosar para deposito', 'endosar_para_deposito'], ['cheques', 'descontar pagos diferidos', 'descontar_cheques_pagos_diferidos'],
    ['creditos', 'tomar en pesos', 'tomar_credito_en_pesos'], ['creditos', 'tomar en moneda extranjera', 'tomar_credito_en_moneda_extranjera'],
    ['creditos', 'solicitar apertura carta de credito importacion', 'solicitar_apertura_carta_credito_importacion'],
    ['creditos', 'solicitar prefinanciacion de exportaciones', 'solicitar_prefinanciacion_de_exportaciones'],
    ['creditos', 'solicitar post financiacion de exportaciones', 'solicitar_postfinanciacion_de_exportaciones'],
    ['creditos', 'solicitar postfinanciacion de exportaciones', 'solicitar_postfinanciacion_de_exportaciones'],
    ['creditos', 'solicitar garantias', 'solicitar_garantias'], ['creditos', 'percibir importes de credito', 'percibir_importes_de_creditos'],
    ['creditos', 'descontar pagares', 'descontar_pagares'], ['creditos', 'solicitar garantia aduanera', 'solicitar_garantia_aduanera'],
    ['garantias', 'construir prenda con registro', 'construir_prenda_con_registro'], ['garantias', 'construir prenda sin registro', 'construir_prenda_sin_registro'],
    ['garantias', 'constituir prenda con registro', 'construir_prenda_con_registro'], ['garantias', 'constituir prenda sin registro', 'construir_prenda_sin_registro'],
    ['garantias', 'construir hipoteca', 'construir_hipoteca'], ['garantias', 'constituir hipoteca', 'construir_hipoteca'],
    ['garantias', 'otorgar fianzas', 'otorgar_fianzas'], ['garantias', 'ceder credito en garantia', 'ceder_credito_en_garantia'],
    ['valores negociables', 'depositar', 'depositar_valores_negociables'], ['valores negociables', 'retirar', 'retirar_valores_negociables'],
    ['valores negociables', 'ordenar compra', 'ordenar_compra_valores_negociables'], ['valores negociables', 'ordenar venta', 'ordenar_venta_valores_negociables'],
    ['valores negociables', 'alquilar', 'alquilar_valores_negociables'], ['valores negociables', 'caucionar', 'caucionar_valores_negociables'],
    ['valores negociables', 'operar en bolsas', 'operar_en_bolsas'], ['valores negociables', 'abrir cuentas alyc', 'abrir_cuentas_alyc'],
    ['cambiarias', 'firmar letras de cambio', 'firmar_letras_de_cambio'], ['cambiarias', 'aceptar letras de cambio', 'aceptar_letras_de_cambio'],
    ['cambiarias', 'avalar letras de cambio', 'avalar_letras_de_cambio'], ['cambiarias', 'firmar pagares', 'firmar_pagares'], ['cambiarias', 'endosar pagares', 'endosar_pagares'],
  ];
  const GRUPOS_OCR = [...new Set(FACULTADES_OCR.map(f => f[0]).filter(Boolean))];
  function claveFacultadOcr(grupo, texto) {
    const t = normalizar(texto), g = normalizar(grupo || '');
    const f = FACULTADES_OCR.find(x => x[0] === g && x[1] === t) || FACULTADES_OCR.find(x => !x[0] && x[1] === t)
      || FACULTADES_OCR.find(x => x[1] === t && x[1].split(' ').length > 1);
    if (f) return f[2];
    // También vale el nombre del catálogo o la clave escrita con espacios.
    const c = BASTANTEO_CATALOGO.find(x => normalizar(x[1]) === t || normalizar(x[2]) === t);
    return c ? c[2] : null;
  }

  // Lee el "Resumen documentos OCR" (líneas de texto del PDF) y devuelve los poderes ("Acreditación de Poderes").
  function leerPoderesOcr(lineas) {
    const L = lineas.map(l => String(l || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const inicios = [];
    L.forEach((l, i) => { if (/^acreditaci[oó]n de poderes$/i.test(l)) inicios.push(i); });
    const finSeccion = l => /^(acreditaci[oó]n de poderes|balance|dictamen\b)/i.test(l);
    const valor = (bloque, etiqueta) => { const re = new RegExp('^' + etiqueta + '\\s*:\\s*(.*)$', 'i'); const l = bloque.find(x => re.test(x)); return l ? l.match(re)[1].trim() : ''; };
    return inicios.map(ini => {
      let fin = L.length;
      for (let j = ini + 1; j < L.length; j++) if (finSeccion(L[j])) { fin = j; break; }
      const b = L.slice(ini, fin).filter(l => l !== '<<PAGINA>>');
      const io = b.findIndex(l => /^otorgante$/i.test(l));
      const otorg = io > -1 ? b.slice(io) : b;
      const poder = {
        razon_social: valor(b, 'Raz[oó]n Social'), cuit_empresa: valor(b, 'CUIT').replace(/\D/g, ''), fecha_emision: valor(b, 'Fecha de Emisi[oó]n'),
        otorgante: { nombre_completo: valor(otorg, 'Nombre Completo'), dni: valor(otorg, 'Numero de Identificaci[oó]n').replace(/\D/g, ''), fecha_nacimiento: valor(otorg, 'Fecha de Nacimiento') || null },
        apoderados: [], usos: [],
      };
      // Apoderados: entre "Resumen de Apoderadores" y "Uso de Firmas" (nombre y número en la misma línea o en líneas seguidas).
      const ia = b.findIndex(l => /^resumen de apoderad/i.test(l)), iu = b.findIndex(l => /^uso de firmas?$/i.test(l));
      if (ia > -1) {
        let nombre = '';
        b.slice(ia + 1, iu > -1 ? iu : undefined).forEach(l => {
          if (/^(nombre completo|identificaci[oó]n|grupo)(\s|$)/i.test(l)) return;
          const m = l.match(/^(.*?)\s*(\d{6,9})(?:\s+(.+))?$/);
          if (m) {
            const n = (nombre + ' ' + m[1]).trim();
            poder.apoderados.push({ nombre_completo: n, dni: m[2], grupo: m[3] ? m[3].trim() : null });
            nombre = '';
          } else nombre = (nombre + ' ' + l).trim();
        });
      }
      // Usos de firma: descripción, tipo, limitaciones y la tabla de facultades (una columna Si/No por uso).
      const iUsos = [];
      b.forEach((l, i) => { if (/^uso de firma \d+$/i.test(l)) iUsos.push(i); });
      const iFac = b.findIndex(l => /^facultades otorgadas$/i.test(l));
      iUsos.forEach((i, k) => {
        const hasta = k + 1 < iUsos.length ? iUsos[k + 1] : (iFac > -1 && iFac > i ? iFac : b.length);
        const tramo = b.slice(i + 1, hasta);
        const texto = (et, corte) => {
          const p = tramo.findIndex(x => new RegExp('^' + et + '\\s*:', 'i').test(x));
          if (p < 0) return '';
          const partes = [tramo[p].replace(new RegExp('^' + et + '\\s*:\\s*', 'i'), '')];
          for (let q = p + 1; q < tramo.length && !corte.test(tramo[q]); q++) partes.push(tramo[q]);
          return partes.join(' ').replace(/\s+/g, ' ').trim();
        };
        poder.usos.push({
          descripcion: texto('Descripci[oó]n', /^(tipo de firma|limitaciones|facultades otorgadas)\s*:?/i),
          tipo: (texto('Tipo de Firma', /^(limitaciones|facultades otorgadas|descripci)/i) || '').toUpperCase(),
          limitaciones: texto('Limitaciones', /^(facultades otorgadas|uso de firma|descripci|tipo de firma)/i) || null,
          facultades: {},
        });
      });
      if (!poder.usos.length) poder.usos.push({ descripcion: '', tipo: '', limitaciones: null, facultades: {} });
      // Tabla de facultades: grupos (Cuentas Corrientes, Cheques…) y renglones "texto Si/No"; los textos largos pueden
      // venir partidos en dos renglones con el Si/No en el medio.
      if (iFac > -1) {
        let grupo = '', buf = [], pend = null;
        const asignar = (texto, vals) => {
          const k = claveFacultadOcr(grupo, texto);
          if (!k) return false;
          poder.usos.forEach((u, n) => { const v = vals[Math.min(n, vals.length - 1)]; u.facultades[k] = /^s/i.test(v); });
          return true;
        };
        for (const l of b.slice(iFac + 1)) {
          if (/^conclusi[oó]n/i.test(l)) break;
          if (/^facultad(\s+\d+)*$/i.test(l) || /^\d+(\s+\d+)*$/.test(l)) continue;
          const m = l.match(/^(.*?)\s*((?:\b(?:Si|Sí|No)\b\s*)+)$/i);
          if (m) {
            const vals = m[2].trim().split(/\s+/);
            const texto = [...buf, m[1]].join(' ').trim();
            buf = [];
            if (texto && asignar(texto, vals)) { pend = null; continue; }
            pend = { texto, vals };
            continue;
          }
          if (pend) {
            const texto = (pend.texto + ' ' + l).trim();
            if (asignar(texto, pend.vals)) { pend = null; continue; }
            pend.texto = texto;
            continue;
          }
          if (!buf.length && GRUPOS_OCR.includes(normalizar(l))) { grupo = l; continue; }
          buf.push(l);
        }
      }
      return poder;
    });
  }

  // Planilla del cliente: firmantes (CUIT y nombre), CUIT de la empresa, escrituras (fecha y número) y las marcas "X".
  const MARCAS_BASTANTEO = [
    ['apertura de cuenta', ['abrir_cuentas_corrientes', 'abrir_caja_de_ahorro']], ['cierre de cuenta', ['cerrar_cuentas_corrientes', 'cerrar_caja_de_ahorro']],
    ['transferencias', ['transferencias_entre_cuentas_de_la_empresa', 'transferencias_a_cuentas_de_terceros']], ['endoso cheques', ['endosar_cheques']],
    ['retirar cheque rechazado', ['retirar_cheques_rechazados']], ['cobrar y percibir', ['cobrar_cheques', 'percibir_importes_de_creditos']],
    ['librar cheques', ['firmar_cheques']], ['girar en descubierto', ['girar_descubierto_dentro_limites']],
    ['tomar prestamos pesos', ['tomar_credito_en_pesos']], ['tomar prestamos me', ['tomar_credito_en_moneda_extranjera']],
    ['efectuar op de exterior y cambio', ['operaciones_cambio_moneda']], ['firma digital', ['firma_digital']],
    ['celebrar contratos fideico', ['celebrar_contratos_fideicomiso']], ['celebrar contratos colocac', ['celebrar_contratos_colocacion']],
    ['celebrar contratos under', ['celebrar_contratos_underwriting']], ['constituir pf', ['constituir_plazo_fijo']],
    ['apertura caja de seguridad', ['abrir_caja_de_seguridad']], ['cierre de caja de seguridad', ['cerrar_caja_de_seguridad']],
    ['homebanking', ['firmar_contratos_de_banca_electronica']], ['interbanking', ['firmar_contratos_de_banca_electronica']],
  ];
  function leerClienteBastanteo(hojas) {
    const r = { cliente: '', cuit: '', firmantes: [], escrituras: [], marcas: {} };
    const iso = v => {
      if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${ceros(v.getMonth() + 1, 2)}-${ceros(v.getDate(), 2)}`;
      if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${ceros(d.getUTCMonth() + 1, 2)}-${ceros(d.getUTCDate(), 2)}`; }
      return '';
    };
    const vistos = new Set();
    hojas.forEach(h => {
      const t = h.filas || [];
      t.forEach((fila, i) => {
        const f = (fila || []).map(c => (c == null ? '' : c));
        const n = f.map(c => normalizar(c));
        // Datos del cliente.
        const ic = n.indexOf('cliente');
        if (ic > -1 && !r.cliente) { const v = f.slice(ic + 1).find(c => String(c).trim() && !/^\d+$/.test(String(c))); if (v) r.cliente = String(v).trim(); }
        const icu = n.indexOf('cuit');
        if (icu > -1 && !r.cuit) { const v = f.slice(icu + 1).map(c => String(c).replace(/\D/g, '')).find(c => c.length === 11); if (v) r.cuit = v; }
        // Encabezado de firmantes: tiene "cuit" y una columna de nombre.
        const iNom = n.findIndex(c => /nombre/.test(c) && /firmante|apellido|nombre/.test(c));
        if (icu > -1 && iNom > -1) {
          for (const g of t.slice(i + 1)) {
            const cuit = String((g || [])[icu] == null ? '' : g[icu]).replace(/\D/g, '');
            if (cuit.length !== 11) { if ((g || []).some(c => c != null && String(c).trim())) { if (r.firmantes.length) break; } continue; }
            if (vistos.has(cuit)) continue;
            vistos.add(cuit);
            r.firmantes.push({ cuit, nombre: String(g[iNom] || '').trim() });
          }
        }
        // Escrituras: encabezado con "escritura" (fecha y número debajo).
        const ie = n.findIndex(c => /^escritura/.test(c));
        if (ie > -1) {
          const iF = n.findIndex(c => c === 'fecha');
          for (const g of t.slice(i + 1)) {
            const fecha = iso((g || [])[iF > -1 ? iF : ie - 1]), num = (g || [])[ie];
            if (!fecha || num == null || !/^\d+$/.test(String(num).trim())) { if (r.escrituras.length) break; continue; }
            if (!r.escrituras.some(e => e.fecha === fecha && e.numero === String(num))) r.escrituras.push({ fecha, numero: String(num).trim() });
          }
        }
        // Marcas "X" al lado de un concepto.
        f.forEach((c, k) => {
          const txt = normalizar(c);
          if (!txt || txt === 'x') return;
          const sig = f.slice(k + 1).find(x => String(x).trim() !== '');
          if (sig == null || normalizar(sig) !== 'x') return;
          const m = MARCAS_BASTANTEO.find(([et]) => txt === et || txt.startsWith(et));
          if (m) m[1].forEach(cl => { r.marcas[cl] = true; });
        });
      });
    });
    return r;
  }

  const formatoCuit = c => { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (c || null); };
  // CUIT que contiene el DNI (posiciones 3 a 10): primero los firmantes de la planilla, después la lista extra.
  function cuitPorDni(dni, ...listas) {
    const d = String(dni || '').replace(/\D/g, '');
    if (!d) return '';
    const d8 = d.padStart(8, '0');
    for (const l of listas) {
      const c = (l || []).map(x => String(x.cuit || x).replace(/\D/g, '')).find(x => x.length === 11 && x.slice(2, 10) === d8);
      if (c) return c;
    }
    return '';
  }

  // Arma el JSON de un poder. edicion: { deed_number, board_resolution_power_attorney, power_attorney_type, cuits: {dni: cuit} }.
  function jsonPoder(poder, cliente, edicion = {}) {
    const cuits = edicion.cuits || {};
    const ident = dni => { const c = cuits[dni] || cuitPorDni(dni, cliente && cliente.firmantes); return c ? Number(c) : (dni ? Number(dni) : null); };
    const marcas = (cliente && cliente.marcas) || {};
    return {
      deed_number: edicion.deed_number || null,
      incorporation_date: null,
      incorporation_resolution_number: null,
      board_resolution_power_attorney: edicion.board_resolution_power_attorney || null,
      power_attorney_type: edicion.power_attorney_type || 'Poder Especial para Operaciones Bancarias',
      power_attorney_scope: Object.assign({ new: true, revoke: false, complementary: false }, edicion.scope || {}),
      fecha_emision: poder.fecha_emision || null,
      razon_social: poder.razon_social || null,
      cuit_empresa: formatoCuit(poder.cuit_empresa),
      otorgante: { numero_de_identificacion: ident(poder.otorgante.dni), nombre_completo: poder.otorgante.nombre_completo || null, fecha_nacimiento: poder.otorgante.fecha_nacimiento || null },
      apoderados: poder.apoderados.map(a => ({ numero_de_identificacion: ident(a.dni), nombre_completo: a.nombre_completo, grupo: a.grupo || null })),
      estructuras_de_firma: poder.usos.map((u, n) => {
        const ed = (edicion.facultades || [])[n] || {};
        return {
          tipo_de_firma: u.tipo || null,
          estructura_de_firma: u.descripcion || null,
          firma_individual: /INDIVIDUAL|INDISTINTA/.test(u.tipo),
          firma_conjunta: /CONJUNTA/.test(u.tipo),
          facultades: Object.fromEntries(BASTANTEO_CLAVES.map(k => [k, k in ed ? !!ed[k] : k in u.facultades ? u.facultades[k] : !!marcas[k]])),
          limitaciones: u.limitaciones || null,
          limite_de_operacion: null,
        };
      }),
    };
  }

  // Un solo JSON con todos los poderes: cada apoderado junta sus facultades (si tiene varios poderes con el mismo tipo de
  // firma, vale lo que le dé cualquiera de ellos). Si el poder asigna un grupo al apoderado, se respeta; si no, los
  // apoderados con el mismo tipo de firma y las mismas facultades van al mismo grupo (A, B, C…, sin repetir los que ya
  // traen los poderes). Hay una estructura de firma por grupo. jsons = los JSON de cada poder (ya revisados).
  function jsonBastanteoUnico(jsons, cliente) {
    const letra = n => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
    const personas = new Map(); // id + tipo → datos
    jsons.forEach(j => j.estructuras_de_firma.forEach(e => j.apoderados.forEach(a => {
      const k = a.numero_de_identificacion + '|' + (e.tipo_de_firma || '');
      if (!personas.has(k)) personas.set(k, { apoderado: a, grupoPoder: a.grupo ? String(a.grupo).trim() : '', tipo: e.tipo_de_firma, individual: e.firma_individual, conjunta: e.firma_conjunta,
        facultades: Object.fromEntries(BASTANTEO_CLAVES.map(c => [c, false])), limitaciones: new Set(), escrituras: new Set(), estructuras: new Set() });
      const p = personas.get(k);
      BASTANTEO_CLAVES.forEach(c => { if (e.facultades[c]) p.facultades[c] = true; });
      if (e.limitaciones) p.limitaciones.add(e.limitaciones);
      if (j.deed_number) p.escrituras.add(String(j.deed_number));
      if (e.estructura_de_firma) p.estructuras.add(e.estructura_de_firma);
    })));
    const grupos = new Map();
    personas.forEach(p => {
      const k = p.grupoPoder ? 'G|' + p.grupoPoder + '|' + (p.tipo || '')
        : (p.tipo || '') + '|' + BASTANTEO_CLAVES.map(c => (p.facultades[c] ? 1 : 0)).join('');
      if (!grupos.has(k)) grupos.set(k, { nombre: p.grupoPoder, tipo: p.tipo, individual: p.individual, conjunta: p.conjunta,
        facultades: Object.assign({}, p.facultades), personas: [], limitaciones: new Set(), escrituras: new Set() });
      const g = grupos.get(k);
      // Grupo indicado por el poder: valen las facultades que tenga cualquiera de sus integrantes.
      BASTANTEO_CLAVES.forEach(c => { if (p.facultades[c]) g.facultades[c] = true; });
      g.personas.push(p);
      p.limitaciones.forEach(x => g.limitaciones.add(x));
      p.escrituras.forEach(x => g.escrituras.add(x));
    });
    const lista = [...grupos.values()].sort((a, b) => b.personas.length - a.personas.length);
    const usados = new Set(lista.filter(g => g.nombre).map(g => g.nombre));
    let n = 0;
    lista.forEach(g => {
      if (!g.nombre) { while (usados.has(letra(n))) n++; g.nombre = letra(n); usados.add(g.nombre); }
      g.grupo = g.nombre;
      g.personas.forEach(p => { p.grupo = g.grupo; });
    });
    // Un apoderado puede quedar en más de un grupo (por ejemplo, firma individual en uno y conjunta en otro).
    const apoderados = new Map();
    personas.forEach(p => {
      const id = p.apoderado.numero_de_identificacion;
      if (!apoderados.has(id)) apoderados.set(id, { numero_de_identificacion: id, nombre_completo: p.apoderado.nombre_completo, grupo: [] });
      apoderados.get(id).grupo.push(p.grupo);
    });
    const otorgantes = [...new Map(jsons.map(j => [j.otorgante.numero_de_identificacion, j.otorgante])).values()];
    const fechas = jsons.map(j => j.fecha_emision).filter(Boolean).sort();
    const nombres = g => g.personas.map(p => p.apoderado.nombre_completo).join(', ');
    return {
      deed_number: [...new Set(jsons.map(j => j.deed_number).filter(Boolean))].join(', ') || null,
      incorporation_date: null,
      incorporation_resolution_number: null,
      board_resolution_power_attorney: [...new Set(jsons.map(j => j.board_resolution_power_attorney).filter(Boolean))].join(', ') || null,
      power_attorney_type: [...new Set(jsons.map(j => j.power_attorney_type).filter(Boolean))].join(' / ') || null,
      power_attorney_scope: { new: true, revoke: false, complementary: false },
      fecha_emision: fechas.length ? fechas[fechas.length - 1] : null,
      razon_social: (cliente && cliente.cliente) || (jsons[0] && jsons[0].razon_social) || null,
      cuit_empresa: formatoCuit((cliente && cliente.cuit) || (jsons[0] && jsons[0].cuit_empresa)),
      otorgante: otorgantes.length === 1 ? otorgantes[0] : otorgantes,
      apoderados: [...apoderados.values()].map(a => Object.assign(a, { grupo: a.grupo.join(', ') })),
      estructuras_de_firma: lista.map(g => ({
        grupo: g.grupo,
        tipo_de_firma: g.tipo || null,
        estructura_de_firma: `Grupo ${g.grupo} - ${g.conjunta ? 'firma conjunta' : 'firma individual / indistinta'} (${nombres(g)})`,
        firma_individual: !!g.individual,
        firma_conjunta: !!g.conjunta,
        apoderados: g.personas.map(p => p.apoderado.numero_de_identificacion),
        escrituras: [...g.escrituras],
        facultades: g.facultades,
        limitaciones: [...g.limitaciones].join(' | ') || null,
        limite_de_operacion: null,
      })),
      poderes: jsons.map(j => ({ deed_number: j.deed_number, fecha_emision: j.fecha_emision, razon_social: j.razon_social, cuit_empresa: j.cuit_empresa,
        power_attorney_type: j.power_attorney_type, board_resolution_power_attorney: j.board_resolution_power_attorney,
        apoderados: j.apoderados.map(a => a.numero_de_identificacion), estructuras: j.estructuras_de_firma.map(e => e.estructura_de_firma) })),
    };
  }

  // ------------------------------------------------------------ TXT NO COBIS
  // Diseño (hoja "NO COBIS" del archivo de inventario Payway), 156 caracteres por línea, una por ente (MIS):
  // código cliente = MIS (10, ceros a la izq.) · tipo de crédito CCASR (10, espacios a la der.) · tasa 0100000000 (10)
  // · saldo de capital = valor a descuento × 100 (14, ceros) · saldo interés (12 ceros) · saldo OCIF (12 ceros)
  // · moneda 080 · módulo "NO COBIS" (64, espacios) · fecha concesión dd/mm/aaaa · fecha vencimiento dd/mm/aaaa · operación ajustada 1.
  const NO_COBIS = { tipoCredito: 'CCASR', tasa: 100000000, tasaApi: 1, moneda: 80, modulo: 'NO COBIS', operacionAjustada: 1 };
  const ceros = (v, n) => String(v).padStart(n, '0');
  const fechaBarra = d => ceros(d.getDate(), 2) + '/' + ceros(d.getMonth() + 1, 2) + '/' + d.getFullYear();
  const claveDia = d => d.getFullYear() + '-' + ceros(d.getMonth() + 1, 2) + '-' + ceros(d.getDate(), 2);

  // Último día hábil (lunes a viernes, sin feriados) del mes de 'fecha' + 'desplazamiento' meses.
  // feriados: lista opcional de fechas 'aaaa-mm-dd'.
  function ultimoDiaHabil(fecha, desplazamiento = 0, feriados = []) {
    const f = new Set(feriados);
    const d = new Date(fecha.getFullYear(), fecha.getMonth() + desplazamiento + 1, 0);
    while (d.getDay() === 0 || d.getDay() === 6 || f.has(claveDia(d))) d.setDate(d.getDate() - 1);
    return d;
  }

  // Concesión = hoy; vencimiento = último día hábil del mes, o del mes siguiente si hoy ya es ese día.
  function fechasNoCobis(hoy = new Date(), feriados = []) {
    const concesion = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    let vencimiento = ultimoDiaHabil(concesion, 0, feriados);
    // Si hoy es el último día hábil (o ya pasó, p. ej. un sábado 31), vence el último día hábil del mes siguiente.
    if (claveDia(vencimiento) <= claveDia(concesion)) vencimiento = ultimoDiaHabil(concesion, 1, feriados);
    return { concesion, vencimiento };
  }

  function lineaNoCobis(mis, importe, fechas) {
    const centavos = Math.round(Number(importe) * 100);
    const codigo = String(mis).replace(/\D/g, '');
    if (!codigo || codigo.length > 10) throw new Error(`MIS inválido: ${mis}`);
    if (!(centavos >= 0) || String(centavos).length > 14) throw new Error(`Importe fuera de rango para el MIS ${mis}: ${importe}`);
    return ceros(codigo, 10) + NO_COBIS.tipoCredito.padEnd(10, ' ') + ceros(NO_COBIS.tasa, 10) + ceros(centavos, 14)
      + ceros(0, 12) + ceros(0, 12) + ceros(NO_COBIS.moneda, 3) + NO_COBIS.modulo.padEnd(64, ' ')
      + fechaBarra(fechas.concesion) + fechaBarra(fechas.vencimiento) + NO_COBIS.operacionAjustada;
  }

  // grupos: resultado de agruparCartera (usa g.mis y g.valor). bancosMeli: tabla Bancos MELI.
  // Van todos los MIS de Bancos MELI: con el valor a descuento si hay cartera para ese banco, si no con 0.
  // Los titulares sin MIS quedan afuera (aviso); un valor negativo se informa en 0 (aviso).
  function txtNoCobis(grupos, hoy = new Date(), feriados = [], bancosMeli = []) {
    const fechas = fechasNoCobis(hoy, feriados);
    const limpiar = v => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const porMis = new Map(), nombres = new Map();
    const sinMis = [], negativos = [], bancosSinMis = [];
    (bancosMeli || []).forEach(b => {
      const mis = limpiar(b.mis);
      if (!mis) { bancosSinMis.push(b); return; }
      if (!porMis.has(mis)) { porMis.set(mis, 0); nombres.set(mis, b.nombre || b.cobis || ''); }
    });
    const conDatos = new Set();
    grupos.forEach(g => {
      const mis = limpiar(g.mis);
      if (!mis) { sinMis.push(g); return; }
      conDatos.add(mis);
      if (!nombres.has(mis)) nombres.set(mis, g.ente || '');
      porMis.set(mis, round2((porMis.get(mis) || 0) + (Number(g.valor) || 0)));
    });
    const filas = [...porMis.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([mis, valor]) => {
      if (valor < 0) negativos.push(mis);
      const v = valor > 0 ? valor : 0;
      return { mis, nombre: nombres.get(mis) || '', valor: v, conDatos: conDatos.has(mis), linea: lineaNoCobis(mis, v, fechas) };
    });
    return {
      fechas, filas, sinMis, negativos, bancosSinMis,
      conDatos: filas.filter(f => f.conDatos).length,
      total: round2(filas.reduce((t, f) => t + f.valor, 0)),
      texto: filas.map(f => f.linea).join('\r\n') + (filas.length ? '\r\n' : ''),
      nombre: 'NoCobis' + fechaBarra(fechas.concesion).replace(/\//g, '').replace(/(\d{4})(\d{2})(\d{2})$/, '$1$3') + '.txt',
    };
  }

  // ------------------------------------------------ NO COBIS por API (Orquestador de Riesgos)
  // Mismo contenido que el TXT, en el formato del endpoint POST /v1/nocobis/ingreso (una operación por MIS).
  function loteApiNoCobis(t) {
    const op = f => ({
      cliente: Number(f.mis), banco: f.nombre, tipoCredito: NO_COBIS.tipoCredito, moneda: NO_COBIS.moneda,
      saldoCapital: f.valor, saldoInteres: 0, saldoOcif: 0,
      fechaConcesion: fechaBarra(t.fechas.concesion), fechaVencimiento: fechaBarra(t.fechas.vencimiento), tasaInteres: NO_COBIS.tasaApi,
    });
    return {
      tipo: 'VALO NO COBIS', generado: new Date().toISOString(),
      fechaConcesion: fechaBarra(t.fechas.concesion), fechaVencimiento: fechaBarra(t.fechas.vencimiento),
      total: t.total, operaciones: t.filas.map(op),
    };
  }

  // Script de PowerShell que envía el lote a la API desde una PC de la red de VALO.
  // El client_secret NO va en la página ni en el script: se pide la primera vez y queda cifrado en esa PC (DPAPI).
  function scriptPowerShellNoCobis(cfg = {}) {
    const base = cfg.baseUrl || 'http://gateway-api-microservicios-core-test.apps.closdesa.bvsa.local/riesgos';
    const token = cfg.tokenUrl || 'https://ssohomo.valo.ar/auth/realms/COBIS-TEST/protocol/openid-connect/token';
    const clientId = cfg.clientId || 'apiriesgos';
    return `# VALO - EPORTFOLIO · Envío de NO COBIS a la API del Orquestador de Riesgos (POST /v1/nocobis/ingreso)
# Uso (PowerShell, desde una PC de la red de VALO):
#   .\\nocobis-api.ps1                       -> SIMULA: valida el lote y el catálogo, muestra qué se enviaría. No envía nada.
#   .\\nocobis-api.ps1 -Enviar               -> envía las operaciones con saldo > 0 (pide confirmación).
#   .\\nocobis-api.ps1 -Enviar -Reemplazar   -> antes de ingresar, cancela las operaciones vigentes del mismo tipo de crédito de cada cliente.
#   -Archivo <ruta>  lote NoCobis_*.json descargado de la página (por defecto el más nuevo de esta carpeta o de Descargas).
#   -TipoCredito X   usa otro código del catálogo NOCOBIS en lugar del que trae el lote.
#   -OlvidarClave    borra la clave guardada y la vuelve a pedir.
# Deja NoCobis_resultado_<fecha>.csv con el resultado de cada operación (número de operación, avisos o error).
param(
  [string]$Archivo = '',
  [switch]$Enviar,
  [switch]$Reemplazar,
  [switch]$Confirmado,
  [switch]$OlvidarClave,
  [string]$TipoCredito = '',
  [string]$BaseUrl = '${base}',
  [string]$TokenUrl = '${token}',
  [string]$ClientId = '${clientId}'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Proxy de la red (p. ej. McAfee Web Gateway): se autentica con el usuario de Windows, como el navegador.
try { $px = [Net.WebRequest]::DefaultWebProxy; if ($px) { $px.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } } catch {}
try { [Net.Http.HttpClient]::DefaultProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}
$Carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

# --- lote
if (-not $Archivo) {
  $cand = @(Get-ChildItem -Path $Carpeta, (Join-Path $HOME 'Downloads') -Filter 'NoCobis*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if (-not $cand.Count) { throw 'No encontré ningún NoCobis*.json. Descargalo desde la pestaña Cartera o indicá -Archivo.' }
  $Archivo = $cand[0].FullName
}
$Lote = [IO.File]::ReadAllText($Archivo, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($Lote.tipo -ne 'VALO NO COBIS') { throw "El archivo $Archivo no es un lote NO COBIS de la página." }
$Ops = @($Lote.operaciones)
if ($TipoCredito) { foreach ($o in $Ops) { $o.tipoCredito = $TipoCredito } }
Write-Host "Lote: $Archivo"
Write-Host ("Concesión {0} · vencimiento {1} · {2} operaciones · total {3:N2}" -f $Lote.fechaConcesion, $Lote.fechaVencimiento, $Ops.Count, [double]$Lote.total)

# --- credencial (client_secret) guardada cifrada para este usuario de Windows
$ArchivoClave = Join-Path $Carpeta 'nocobis-credencial.txt'
if ($OlvidarClave -and (Test-Path $ArchivoClave)) { Remove-Item $ArchivoClave }
if (Test-Path $ArchivoClave) { $Seguro = Get-Content $ArchivoClave | ConvertTo-SecureString }
else {
  $Seguro = Read-Host "client_secret de '$ClientId' (se guarda cifrado en $ArchivoClave)" -AsSecureString
  $Seguro | ConvertFrom-SecureString | Set-Content $ArchivoClave
}
$Secreto = (New-Object System.Net.NetworkCredential('', $Seguro)).Password

# --- token OAuth2 (client credentials), reutilizado hasta que esté por vencer
$script:Token = $null; $script:Vence = [DateTime]::MinValue
function Obtener-Token([switch]$Forzar) {
  if (-not $Forzar -and $script:Token -and (Get-Date) -lt $script:Vence) { return $script:Token }
  $cuerpo = @{ client_id = $ClientId; client_secret = $Secreto; grant_type = 'client_credentials' }
  try { $r = Invoke-RestMethod -Method Post -Uri $TokenUrl -Body $cuerpo -ContentType 'application/x-www-form-urlencoded' }
  catch {
    $d = Detalle-Error $_
    throw ("No se pudo obtener el token (HTTP {0}: {1}). Si la clave es incorrecta, ejecutá con -OlvidarClave." -f $d.codigo, $d.texto)
  }
  $script:Token = $r.access_token
  $script:Vence = (Get-Date).AddSeconds([Math]::Max(30, [int]$r.expires_in - 30))
  return $script:Token
}
function Detalle-Error($e) {
  $cod = 0; $txt = $e.Exception.Message
  if ($e.Exception.Response) { try { $cod = [int]$e.Exception.Response.StatusCode } catch {} }
  if ($e.ErrorDetails -and $e.ErrorDetails.Message) { $txt = $e.ErrorDetails.Message }
  elseif ($e.Exception.Response -and $e.Exception.Response.GetResponseStream) {
    try { $txt = (New-Object IO.StreamReader($e.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  }
  if ($cod -eq 407) { $txt = 'el proxy de internet de la red (McAfee Web Gateway) pide autenticación y no aceptó el usuario de Windows: pedile a sistemas que habiliten este sitio para PowerShell' }
  elseif ($txt -match '<html') { $txt = $txt -replace '<[^>]+>', ' ' }
  if ($txt.Length -gt 300) { $txt = $txt.Substring(0, 300) + '...' }
  return @{ codigo = $cod; texto = (($txt -replace '\\s+', ' ').Trim()) }
}
# Llama a la API; ante 401 renueva el token y reintenta una sola vez.
function Llamar-Api([string]$Metodo, [string]$Ruta, $Cuerpo = $null) {
  for ($i = 0; $i -lt 2; $i++) {
    $h = @{ Authorization = 'Bearer ' + (Obtener-Token -Forzar:($i -gt 0)) }
    try {
      if ($Cuerpo -ne $null) {
        $json = $Cuerpo | ConvertTo-Json -Depth 5 -Compress
        $r = Invoke-RestMethod -Method $Metodo -Uri ($BaseUrl + $Ruta) -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
      } else { $r = Invoke-RestMethod -Method $Metodo -Uri ($BaseUrl + $Ruta) -Headers $h }
      # Un array JSON sale elemento por elemento (PowerShell 7 lo devuelve como un solo objeto).
      if ($r -is [array]) { return $r } else { return ,$r }
    } catch {
      $d = Detalle-Error $_
      if ($d.codigo -eq 401 -and $i -eq 0) { continue }
      throw ("HTTP {0}: {1}" -f $d.codigo, $d.texto)
    }
  }
}

# --- catálogo: el tipo de crédito tiene que existir
$Catalogo = @(Llamar-Api 'Get' '/v1/nocobis/catalogo')
$Tipos = @($Catalogo | ForEach-Object { $_.tipoCredito })
$Faltan = @($Ops | ForEach-Object { $_.tipoCredito } | Sort-Object -Unique | Where-Object { $Tipos -notcontains $_ })
if ($Faltan.Count) {
  Write-Host ''
  Write-Host ("El tipo de crédito {0} no está en el catálogo NOCOBIS. Tipos disponibles:" -f ($Faltan -join ', ')) -ForegroundColor Red
  foreach ($c in $Catalogo) { Write-Host ("  {0,-12} {1}  ({2})" -f $c.tipoCredito, $c.descripcion, $c.producto) }
  throw 'Volvé a ejecutar con -TipoCredito <código correcto>.'
}

$AIngresar = @($Ops)
$ConCartera = @($Ops | Where-Object { [double]$_.saldoCapital -gt 0 }).Count
Write-Host ("Se envían {0} operaciones, igual que el TXT NO COBIS ({1} con cartera, {2} en 0)." -f $AIngresar.Count, $ConCartera, ($AIngresar.Count - $ConCartera))
foreach ($o in $Ops) { Write-Host ("  cliente {0,-6} {1,-40} {2,-10} {3,20:N2}" -f $o.cliente, $o.banco, $o.tipoCredito, [double]$o.saldoCapital) }

# Operaciones vigentes del cliente con ese tipo de crédito (la API responde 404 "Sin operaciones" cuando no hay).
function Vigentes($o) {
  try { return @(Llamar-Api 'Get' ('/v1/nocobis/operacion?cliente=' + $o.cliente) | Where-Object { $_.tipoCredito -eq $o.tipoCredito }) }
  catch { if ($_.Exception.Message -match '^HTTP 404') { return }; throw }
}
if ($Reemplazar) {
  Write-Host 'Operaciones vigentes que se cancelarían DESPUÉS de ingresar la nueva (si el ingreso falla, no se cancelan):'
  foreach ($o in $Ops) {
    $vig = @(Vigentes $o)
    foreach ($v in $vig) { Write-Host ("  cliente {0} · operación {1} · saldo {2:N2}" -f $o.cliente, $v.numeroOperacion, [double]$v.saldoCapital) }
    $o | Add-Member -NotePropertyName vigentes -NotePropertyValue $vig -Force
  }
}

if (-not $Enviar) { Write-Host ''; Write-Host 'SIMULACIÓN: no se envió nada. Para enviar, ejecutá con -Enviar.' -ForegroundColor Yellow; return }
if (-not $Confirmado) {
  $resp = Read-Host ("Escribí SI para enviar {0} operaciones a {1}" -f $AIngresar.Count, $BaseUrl)
  if ($resp -ne 'SI') { Write-Host 'Cancelado.'; return }
}

# --- envío (sin reintentos automáticos: ante un error se registra y se sigue con la próxima)
$Resultado = @()
foreach ($o in $Ops) {
  $fila = [ordered]@{ cliente = $o.cliente; banco = $o.banco; tipoCredito = $o.tipoCredito; saldoCapital = $o.saldoCapital; canceladas = ''; operacion = ''; resultado = ''; avisos = ''; error = '' }
  try {
    # Primero se ingresa la nueva; recién si sale bien se cancelan las vigentes anteriores.
    if ([double]$o.saldoCapital -ge 0) {  # todas las líneas, como el TXT (también las de saldo 0)
      $cuerpo = [ordered]@{
        cliente = [long]$o.cliente; tipoCredito = [string]$o.tipoCredito; moneda = [int]$o.moneda
        saldoCapital = [decimal]$o.saldoCapital; saldoInteres = [decimal]$o.saldoInteres; saldoOcif = [decimal]$o.saldoOcif
        fechaConcesion = [string]$o.fechaConcesion; fechaVencimiento = [string]$o.fechaVencimiento; tasaInteres = [decimal]$o.tasaInteres
      }
      $r = Llamar-Api 'Post' '/v1/nocobis/ingreso' $cuerpo
      $fila.operacion = $r.operacion; $fila.resultado = $r.resultado; $fila.avisos = (@($r.avisos) -join ' | ')
      Write-Host ("OK   cliente {0}: operación {1} {2}" -f $o.cliente, $r.operacion, $fila.avisos) -ForegroundColor Green
    } else { $fila.resultado = 'saldo 0: no se ingresa' }
    if ($Reemplazar) {
      $canc = @()
      foreach ($v in @($o.vigentes)) {
        try { $rc = Llamar-Api 'Post' '/v1/nocobis/cancelar' @{ cliente = [long]$o.cliente; numeroOp = [long]$v.numeroOperacion }; $canc += $rc.operacion }
        catch { $fila.error = ('Ingresada, pero no se pudo cancelar la operación {0}: {1}' -f $v.numeroOperacion, $_.Exception.Message) }
      }
      $fila.canceladas = ($canc -join ' ')
    }
  } catch {
    $fila.error = $_.Exception.Message
    Write-Host ("ERROR cliente {0}: {1}" -f $o.cliente, $fila.error) -ForegroundColor Red
  }
  $Resultado += New-Object PSObject -Property $fila
}
$Salida = Join-Path $Carpeta ('NoCobis_resultado_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.csv')
$Resultado | Export-Csv -Path $Salida -NoTypeInformation -Delimiter ';' -Encoding UTF8
Write-Host ''
Write-Host ("Listo: {0} ingresadas, {1} con error. Detalle en {2}" -f @($Resultado | Where-Object { $_.operacion }).Count, @($Resultado | Where-Object { $_.error }).Count, $Salida)
`;
  }

  // Agente de la cola NO COBIS: corre en una PC de la red de VALO (Programador de tareas), toma los envíos pendientes que
  // deja la página en la base compartida (Supabase), los ingresa en la API y guarda el resultado. Ver scriptPowerShellNoCobis.
  function scriptPowerShellAgenteNoCobis(cfg = {}) {
    const base = cfg.baseUrl || 'http://gateway-api-microservicios-core-test.apps.closdesa.bvsa.local/riesgos';
    const token = cfg.tokenUrl || 'https://ssohomo.valo.ar/auth/realms/COBIS-TEST/protocol/openid-connect/token';
    const clientId = cfg.clientId || 'apiriesgos';
    return `# VALO - EPORTFOLIO · Agente NO COBIS (cola de envíos de la página -> API del Orquestador de Riesgos)
# Corre en una PC de la red de VALO con salida a internet. Toma los envíos "pendientes" que deja la página,
# se loguea en la API, ingresa las operaciones y deja el resultado en la página. Si hay varias PCs con el agente,
# cada envío lo toma una sola.
# Primera vez (a mano):   powershell -ExecutionPolicy Bypass -File nocobis-agente.ps1 -Configurar
#   pide el usuario del sitio para el agente (ej. robot@valo.ar), su contraseña y el client_secret de la API;
#   quedan cifrados para este usuario de Windows en agente-credenciales.xml.
# Programado (cada 5 min): ver el comando schtasks en la página. Cada ejecución procesa los pendientes y termina.
# Registro: agente.log en esta carpeta.
param(
  [switch]$Configurar,
  [string]$Agente = '',
  [string]$SupabaseUrl = '${cfg.supabaseUrl || ''}',
  [string]$SupabaseKey = '${cfg.supabaseKey || ''}',
  [string]$BaseUrl = '${base}',
  [string]$TokenUrl = '${token}',
  [string]$ClientId = '${clientId}'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Proxy de la red (p. ej. McAfee Web Gateway): se autentica con el usuario de Windows, como el navegador.
try { $px = [Net.WebRequest]::DefaultWebProxy; if ($px) { $px.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } } catch {}
try { [Net.Http.HttpClient]::DefaultProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}
$Carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Log = Join-Path $Carpeta 'agente.log'
if (-not $Agente) { $Agente = [Environment]::MachineName }
function Anotar([string]$Texto) {
  $l = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Texto
  Add-Content -Path $Log -Value $l -Encoding UTF8
  Write-Host $l
}
function Ahora { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
function Detalle-Error($e) {
  $cod = 0; $txt = $e.Exception.Message
  if ($e.Exception.Response) { try { $cod = [int]$e.Exception.Response.StatusCode } catch {} }
  if ($e.ErrorDetails -and $e.ErrorDetails.Message) { $txt = $e.ErrorDetails.Message }
  elseif ($e.Exception.Response -and $e.Exception.Response.GetResponseStream) {
    try { $txt = (New-Object IO.StreamReader($e.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  }
  if ($cod -eq 407) { $txt = 'el proxy de internet de la red (McAfee Web Gateway) pide autenticación y no aceptó el usuario de Windows: pedile a sistemas que habiliten este sitio para PowerShell' }
  elseif ($txt -match '<html') { $txt = $txt -replace '<[^>]+>', ' ' }
  if ($txt.Length -gt 300) { $txt = $txt.Substring(0, 300) + '...' }
  return ("HTTP {0}: {1}" -f $cod, (($txt -replace '\\s+', ' ').Trim()))
}

# --- credenciales (cifradas con DPAPI para el usuario de Windows que ejecuta el agente)
$ArchCred = Join-Path $Carpeta 'agente-credenciales.xml'
if ($Configurar) {
  $u = Read-Host 'Usuario del sitio para el agente (ej. robot@valo.ar)'
  $p = Read-Host 'Contraseña de ese usuario' -AsSecureString
  $s = Read-Host "client_secret de la API ('$ClientId')" -AsSecureString
  New-Object PSObject -Property @{ usuario = $u.Trim(); clave = ($p | ConvertFrom-SecureString); secreto = ($s | ConvertFrom-SecureString) } | Export-Clixml $ArchCred
  Write-Host 'Credenciales guardadas. Se prueba la conexión...'
}
if (-not (Test-Path $ArchCred)) { Anotar 'Falta configurar: ejecutá una vez nocobis-agente.ps1 -Configurar'; exit 1 }
$Cred = Import-Clixml $ArchCred
function Plano($Cifrado) { (New-Object System.Net.NetworkCredential('', ($Cifrado | ConvertTo-SecureString))).Password }
if (-not $SupabaseUrl -or -not $SupabaseKey) { Anotar 'Falta la conexión con la base (SupabaseUrl / SupabaseKey): descargá el agente desde el sitio.'; exit 1 }

# --- base compartida (Supabase): login del agente y llamadas REST
$script:SbToken = $null
function Sb-Login {
  $b = @{ email = $Cred.usuario; password = (Plano $Cred.clave) } | ConvertTo-Json -Compress
  try { $r = Invoke-RestMethod -Method Post -Uri ($SupabaseUrl + '/auth/v1/token?grant_type=password') -Headers @{ apikey = $SupabaseKey } -Body ([Text.Encoding]::UTF8.GetBytes($b)) -ContentType 'application/json' }
  catch { throw ('No se pudo iniciar sesión en el sitio con ' + $Cred.usuario + ' (' + (Detalle-Error $_) + '). Revisá el usuario o volvé a ejecutar con -Configurar.') }
  $script:SbToken = $r.access_token
}
function Sb([string]$Metodo, [string]$Ruta, $Cuerpo = $null, [string]$Prefer = '') {
  $h = @{ apikey = $SupabaseKey; Authorization = 'Bearer ' + $script:SbToken }
  if ($Prefer) { $h['Prefer'] = $Prefer }
  $u = $SupabaseUrl + '/rest/v1' + $Ruta
  try {
    if ($Cuerpo -ne $null) {
      $json = $Cuerpo | ConvertTo-Json -Depth 20 -Compress
      $r = Invoke-RestMethod -Method $Metodo -Uri $u -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
    } else { $r = Invoke-RestMethod -Method $Metodo -Uri $u -Headers $h }
  } catch { throw ('Base compartida: ' + (Detalle-Error $_)) }
  if ($r -is [array]) { return $r } else { return ,$r }
}
function Actualizar-Envio([string]$Path, $Cambios) { Sb 'Post' '/rpc/doc_update' @{ p_path = $Path; p_patch = $Cambios } | Out-Null }

# --- API NO COBIS: token OAuth2 (client credentials) y llamadas, renovando el token ante un 401
$script:Token = $null; $script:Vence = [DateTime]::MinValue
function Obtener-Token([switch]$Forzar) {
  if (-not $Forzar -and $script:Token -and (Get-Date) -lt $script:Vence) { return $script:Token }
  $cuerpo = @{ client_id = $ClientId; client_secret = (Plano $Cred.secreto); grant_type = 'client_credentials' }
  try { $r = Invoke-RestMethod -Method Post -Uri $TokenUrl -Body $cuerpo -ContentType 'application/x-www-form-urlencoded' }
  catch { throw ('No se pudo obtener el token de la API (' + (Detalle-Error $_) + ').') }
  $script:Token = $r.access_token
  $script:Vence = (Get-Date).AddSeconds([Math]::Max(30, [int]$r.expires_in - 30))
  return $script:Token
}
function Llamar-Api([string]$Metodo, [string]$Ruta, $Cuerpo = $null) {
  for ($i = 0; $i -lt 2; $i++) {
    $h = @{ Authorization = 'Bearer ' + (Obtener-Token -Forzar:($i -gt 0)) }
    try {
      if ($Cuerpo -ne $null) {
        $json = $Cuerpo | ConvertTo-Json -Depth 5 -Compress
        $r = Invoke-RestMethod -Method $Metodo -Uri ($BaseUrl + $Ruta) -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
      } else { $r = Invoke-RestMethod -Method $Metodo -Uri ($BaseUrl + $Ruta) -Headers $h }
      if ($r -is [array]) { return $r } else { return ,$r }
    } catch {
      $cod = 0; if ($_.Exception.Response) { try { $cod = [int]$_.Exception.Response.StatusCode } catch {} }
      if ($cod -eq 401 -and $i -eq 0) { continue }
      throw (Detalle-Error $_)
    }
  }
}
# Operaciones vigentes del cliente con ese tipo de crédito (la API responde 404 "Sin operaciones" cuando no hay).
function Vigentes($o) {
  try { return @(Llamar-Api 'Get' ('/v1/nocobis/operacion?cliente=' + $o.cliente) | Where-Object { $_.tipoCredito -eq $o.tipoCredito }) }
  catch { if ($_.Exception.Message -match '^HTTP 404') { return }; throw }
}

# --- procesar la cola
try {
  Sb-Login
  # señal de vida para la página ("Agente activo")
  Sb 'Post' '/docs' @{ path = 'maestros/agenteNoCobis'; coleccion = 'maestros'; data = @{ ultimaVez = (Ahora); agente = $Agente; usuario = $Cred.usuario } } 'resolution=merge-duplicates,return=minimal' | Out-Null
  if ($Configurar) { Obtener-Token | Out-Null; Write-Host 'OK: sesión en el sitio y token de la API correctos. Ya se puede programar la tarea.' -ForegroundColor Green }
  $Pendientes = @(Sb 'Get' '/docs?coleccion=eq.envios&data->>estado=eq.pendiente&select=path,data&order=path.asc')
} catch { Anotar ('ERROR ' + $_.Exception.Message); exit 1 }
if (-not $Pendientes.Count) { exit 0 }

foreach ($Envio in $Pendientes) {
  $Path = $Envio.path
  $tomado = $false
  try { $tomado = [bool]((Sb 'Post' '/rpc/tomar_envio' @{ p_path = $Path; p_agente = $Agente })[0]) } catch { Anotar ("ERROR al tomar $Path : " + $_.Exception.Message); continue }
  if (-not $tomado) { continue }   # lo tomó otro agente
  $Ops = @($Envio.data.lote.operaciones)
  $Reemplazar = [bool]$Envio.data.reemplazar
  Anotar ("Envío $Path : {0} operaciones (reemplazar: {1})" -f $Ops.Count, $Reemplazar)
  $Res = New-Object System.Collections.ArrayList
  $Fatal = $null
  try { Obtener-Token | Out-Null } catch { $Fatal = $_.Exception.Message }
  if (-not $Fatal) {
    foreach ($o in $Ops) {
      $fila = [ordered]@{ cliente = $o.cliente; banco = $o.banco; saldoCapital = $o.saldoCapital }
      try {
        # Primero se ingresa la nueva; recién si sale bien se cancelan las vigentes anteriores.
        $vig = @(); if ($Reemplazar) { $vig = @(Vigentes $o) }
        if ([double]$o.saldoCapital -ge 0) {  # todas las líneas, como el TXT (también las de saldo 0)
          $cuerpo = [ordered]@{
            cliente = [long]$o.cliente; tipoCredito = [string]$o.tipoCredito; moneda = [int]$o.moneda
            saldoCapital = [decimal]$o.saldoCapital; saldoInteres = [decimal]$o.saldoInteres; saldoOcif = [decimal]$o.saldoOcif
            fechaConcesion = [string]$o.fechaConcesion; fechaVencimiento = [string]$o.fechaVencimiento; tasaInteres = [decimal]$o.tasaInteres
          }
          $r = (Llamar-Api 'Post' '/v1/nocobis/ingreso' $cuerpo)[0]
          $fila.operacion = $r.operacion; $fila.resultado = $r.resultado; $fila.avisos = @($r.avisos)
        } elseif (-not $Reemplazar) { continue }
        if ($Reemplazar) {
          $canc = @(); $errC = @()
          foreach ($v in $vig) {
            try { $rc = Llamar-Api 'Post' '/v1/nocobis/cancelar' @{ cliente = [long]$o.cliente; numeroOp = [long]$v.numeroOperacion }; $canc += $rc[0].operacion }
            catch { $errC += ('no se pudo cancelar la operación {0}: {1}' -f $v.numeroOperacion, $_.Exception.Message) }
          }
          $fila.canceladas = $canc
          if ($errC.Count) { $fila.error = 'Ingresada, pero ' + ($errC -join ' | ') }
        }
      } catch { $fila.error = $_.Exception.Message }
      [void]$Res.Add($fila)
    }
  }
  $ing = @($Res | Where-Object { $_.operacion }).Count
  $err = @($Res | Where-Object { $_.error }).Count
  $cambios = @{ estado = $(if ($Fatal) { 'error' } else { 'terminado' }); terminado = (Ahora); resultados = $Res.ToArray(); ingresadas = $ing; conError = $err }
  if ($Fatal) { $cambios.error = $Fatal }
  try { Actualizar-Envio $Path $cambios } catch { Anotar ("ERROR al guardar el resultado de $Path : " + $_.Exception.Message) }
  Anotar ("Envío $Path terminado: {0} ingresadas, {1} con error{2}" -f $ing, $err, $(if ($Fatal) { ' · ' + $Fatal } else { '' }))
}
`;
  }

  // Archivo de envío en un solo paso: un .cmd (doble clic) con el lote adentro. Ingresa en la API desde la PC
  // (conectada a la red de VALO / VPN), muestra el resultado y, si viene con datos de la base, lo deja en la página.
  // cfg: { lote, envioPath, supabaseUrl, supabaseKey, token, baseUrl, tokenUrl, clientId }
  function cmdEnvioNoCobis(cfg) {
    const base = cfg.baseUrl || 'http://gateway-api-microservicios-core-test.apps.closdesa.bvsa.local/riesgos';
    const tokenUrl = cfg.tokenUrl || 'https://ssohomo.valo.ar/auth/realms/COBIS-TEST/protocol/openid-connect/token';
    const clientId = cfg.clientId || 'apiriesgos';
    const lit = v => "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'";
    const lote = JSON.stringify(cfg.lote).replace(/\r?\n/g, ' ');
    const ps = `
# VALO - EPORTFOLIO · Envío NO COBIS a la API (generado ${new Date().toISOString().slice(0, 16).replace('T', ' ')})
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Proxy de la red (p. ej. McAfee Web Gateway): se autentica con el usuario de Windows, como el navegador.
try { $px = [Net.WebRequest]::DefaultWebProxy; if ($px) { $px.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } } catch {}
try { [Net.Http.HttpClient]::DefaultProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}
try { $Host.UI.RawUI.WindowTitle = 'VALO - Envío NO COBIS' } catch {}
$BaseUrl = ${lit(base)}
$TokenUrl = ${lit(tokenUrl)}
$ClientId = ${lit(clientId)}
$SbUrl = ${lit(cfg.supabaseUrl)}
$SbKey = ${lit(cfg.supabaseKey)}
$SbToken = ${lit(cfg.token)}
$EnvioPath = ${lit(cfg.envioPath)}
$Lote = @'
${lote}
'@ | ConvertFrom-Json
function Detalle-Error($e) {
  $cod = 0; $txt = $e.Exception.Message
  if ($e.Exception.Response) { try { $cod = [int]$e.Exception.Response.StatusCode } catch {} }
  if ($e.ErrorDetails -and $e.ErrorDetails.Message) { $txt = $e.ErrorDetails.Message }
  elseif ($e.Exception.Response -and $e.Exception.Response.GetResponseStream) {
    try { $txt = (New-Object IO.StreamReader($e.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
  }
  if ($cod -eq 407) { $txt = 'el proxy de internet de la red (McAfee Web Gateway) pide autenticación y no aceptó el usuario de Windows: pedile a sistemas que habiliten este sitio para PowerShell' }
  elseif ($txt -match '<html') { $txt = $txt -replace '<[^>]+>', ' ' }
  if ($txt.Length -gt 300) { $txt = $txt.Substring(0, 300) + '...' }
  if ($cod) { return ("HTTP {0}: {1}" -f $cod, (($txt -replace '\\s+', ' ').Trim())) }
  return (($txt -replace '\\s+', ' ').Trim())
}
function Sb([string]$Ruta, $Cuerpo) {
  $json = $Cuerpo | ConvertTo-Json -Depth 20 -Compress
  $r = Invoke-RestMethod -Method Post -Uri ($SbUrl + '/rest/v1' + $Ruta) -Headers @{ apikey = $SbKey; Authorization = 'Bearer ' + $SbToken } -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
  if ($r -is [array]) { return $r } else { return ,$r }
}
function Ahora { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

Write-Host ''
Write-Host '  VALO - EPORTFOLIO · Envío NO COBIS a la API' -ForegroundColor Cyan
$Ops = @($Lote.operaciones)   # todas las líneas, igual que el TXT NO COBIS
$ConCartera = @($Ops | Where-Object { [double]$_.saldoCapital -gt 0 }).Count
Write-Host ("  {0} operaciones ({1} con cartera, {2} en 0) · total {3:N2} · concesión {4} · vencimiento {5}" -f $Ops.Count, $ConCartera, ($Ops.Count - $ConCartera), [double]$Lote.total, $Lote.fechaConcesion, $Lote.fechaVencimiento)
Write-Host ''

# 1) que nadie lo haya enviado ya (doble clic dos veces, otro usuario...)
$Informar = [bool]($SbUrl -and $EnvioPath)
if ($Informar) {
  try { $tomado = [bool]((Sb '/rpc/tomar_envio' @{ p_path = $EnvioPath; p_agente = ($env:USERNAME + '@' + [Environment]::MachineName) })[0]) }
  catch {
    $d = Detalle-Error $_
    Write-Host ('  No se pudo verificar el envío en la página (' + $d + ').') -ForegroundColor Red
    if ($d -match '^HTTP 401') { Write-Host '  El archivo venció (vale una hora): en la página tocá "Descargar de nuevo" en la lista de envíos.' }
    exit 1
  }
  if (-not $tomado) { Write-Host '  Este envío ya se procesó o se canceló: no se envía de nuevo. Mirá el resultado en la página.' -ForegroundColor Yellow; exit 0 }
}

# 2) clave de la API: se pide la primera vez y queda cifrada para este usuario de Windows
$Dir = Join-Path $env:APPDATA 'VALO'
$ArchClave = Join-Path $Dir 'nocobis-credencial.txt'
function Pedir-Clave {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $s = Read-Host "  Primera vez: pegá el client_secret de la API ('$ClientId')" -AsSecureString
  $s | ConvertFrom-SecureString | Set-Content $ArchClave
  return $s
}
$Seguro = if (Test-Path $ArchClave) { Get-Content $ArchClave | ConvertTo-SecureString } else { Pedir-Clave }

# 3) login (token) e ingreso, operación por operación
$Res = New-Object System.Collections.ArrayList
$Fatal = $null
$Token = $null
for ($intento = 0; $intento -lt 2 -and -not $Token; $intento++) {
  $sec = (New-Object System.Net.NetworkCredential('', $Seguro)).Password
  try {
    $t = Invoke-RestMethod -Method Post -Uri $TokenUrl -Body @{ client_id = $ClientId; client_secret = $sec; grant_type = 'client_credentials' } -ContentType 'application/x-www-form-urlencoded'
    $Token = $t.access_token
    Write-Host '  Login OK' -ForegroundColor Green
  } catch {
    $d = Detalle-Error $_
    if ($intento -eq 0 -and $d -match 'invalid_client|Invalid client') { Write-Host '  La clave guardada no es válida.' -ForegroundColor Yellow; $Seguro = Pedir-Clave }
    else { $Fatal = 'No se pudo hacer el login en la API: ' + $d }
  }
}
if ($Token) {
  $script:Token = $Token
  # Llamada a la API; si el token venció (401) se pide otro y se reintenta una vez.
  function Api([string]$Metodo, [string]$Ruta, $Cuerpo = $null) {
    for ($i = 0; $i -lt 2; $i++) {
      $hh = @{ Authorization = 'Bearer ' + $script:Token }
      try {
        if ($Cuerpo -ne $null) {
          $json = $Cuerpo | ConvertTo-Json -Depth 5 -Compress
          return Invoke-RestMethod -Method $Metodo -Uri ($BaseUrl + $Ruta) -Headers $hh -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
        }
        return Invoke-RestMethod -Method $Metodo -Uri ($BaseUrl + $Ruta) -Headers $hh
      } catch {
        $c = 0; if ($_.Exception.Response) { try { $c = [int]$_.Exception.Response.StatusCode } catch {} }
        if ($c -eq 401 -and $i -eq 0) {
          $sec = (New-Object System.Net.NetworkCredential('', $Seguro)).Password
          $script:Token = (Invoke-RestMethod -Method Post -Uri $TokenUrl -Body @{ client_id = $ClientId; client_secret = $sec; grant_type = 'client_credentials' } -ContentType 'application/x-www-form-urlencoded').access_token
          continue
        }
        throw
      }
    }
  }
  # Operaciones vigentes del cliente con ese tipo de crédito (la API responde 404 "Sin operaciones" cuando no hay).
  function Vigentes($o) {
    try { return @(Api 'Get' ('/v1/nocobis/operacion?cliente=' + $o.cliente) | ForEach-Object { $_ } | Where-Object { $_.tipoCredito -eq $o.tipoCredito }) }
    catch { $c = 0; if ($_.Exception.Response) { try { $c = [int]$_.Exception.Response.StatusCode } catch {} }; if ($c -eq 404) { return }; throw }
  }
  foreach ($o in $Ops) {
    $fila = [ordered]@{ cliente = $o.cliente; banco = $o.banco; saldoCapital = $o.saldoCapital }
    try {
      # Primero se ingresa la nueva; recién si sale bien se cancelan las vigentes anteriores.
      $vig = @(); if ($Lote.reemplazar) { $vig = @(Vigentes $o) }
      if ([double]$o.saldoCapital -ge 0) {  # todas las líneas, como el TXT (también las de saldo 0)
        $cuerpo = [ordered]@{
          cliente = [long]$o.cliente; tipoCredito = [string]$o.tipoCredito; moneda = [int]$o.moneda
          saldoCapital = [decimal]$o.saldoCapital; saldoInteres = [decimal]$o.saldoInteres; saldoOcif = [decimal]$o.saldoOcif
          fechaConcesion = [string]$o.fechaConcesion; fechaVencimiento = [string]$o.fechaVencimiento; tasaInteres = [decimal]$o.tasaInteres
        }
        $r = Api 'Post' '/v1/nocobis/ingreso' $cuerpo
        $fila.operacion = $r.operacion; $fila.resultado = $r.resultado; $fila.avisos = @($r.avisos)
        Write-Host ("  OK     {0,-6} {1,-38} operación {2}" -f $o.cliente, $o.banco, $r.operacion) -ForegroundColor Green
      }
      if ($Lote.reemplazar) {
        $canc = @(); $errC = @()
        foreach ($v in $vig) {
          try {
            $rc = Api 'Post' '/v1/nocobis/cancelar' @{ cliente = [long]$o.cliente; numeroOp = [long]$v.numeroOperacion }
            $canc += $rc.operacion
            Write-Host ("         {0,-6} {1,-38} cancelada la anterior {2}" -f $o.cliente, $o.banco, $v.numeroOperacion)
          } catch { $errC += ('no se pudo cancelar la operación {0}: {1}' -f $v.numeroOperacion, (Detalle-Error $_)) }
        }
        $fila.canceladas = $canc
        if ($errC.Count) { $fila.error = 'Ingresada, pero ' + ($errC -join ' | '); Write-Host ("  AVISO  {0,-6} {1,-38} {2}" -f $o.cliente, $o.banco, $fila.error) -ForegroundColor Yellow }
      }
    } catch {
      $fila.error = Detalle-Error $_
      Write-Host ("  ERROR  {0,-6} {1,-38} {2}" -f $o.cliente, $o.banco, $fila.error) -ForegroundColor Red
      if ($fila.error -match 'could not be resolved|remote name|No such host|Name or service not known|resolver el nombre|Unable to connect|No es posible conectar|actively refused|denegó') {
        $Fatal = 'No se llega a la API: conectate a la red de VALO o a la VPN y volvé a ejecutar el archivo.'
        [void]$Res.Add($fila); break
      }
    }
    [void]$Res.Add($fila)
  }
}
$ing = @($Res | Where-Object { $_.operacion }).Count
$err = @($Res | Where-Object { $_.error }).Count

# 4) resultado a la página
if ($Informar) {
  # Si no se ingresó nada por un problema de conexión o de login, vuelve a quedar pendiente para reintentar con el mismo archivo.
  $cambios = @{ estado = $(if ($Fatal -and -not $ing) { 'pendiente' } else { 'terminado' }); terminado = (Ahora); resultados = $Res.ToArray(); ingresadas = $ing; conError = $err }
  $cambios.error = $(if ($Fatal) { $Fatal } else { '' })
  try { Sb '/rpc/doc_update' @{ p_path = $EnvioPath; p_patch = $cambios } | Out-Null }
  catch { Write-Host ('  No se pudo dejar el resultado en la página (' + (Detalle-Error $_) + ').') -ForegroundColor Yellow }
}
Write-Host ''
if ($Fatal) { Write-Host ('  ' + $Fatal) -ForegroundColor Red }
Write-Host ("  Listo: {0} operaciones ingresadas, {1} con error." -f $ing, $err) -ForegroundColor $(if ($err -or $Fatal) { 'Yellow' } else { 'Green' })
`;
    // Cabecera de .cmd: para cmd es una etiqueta; para PowerShell, un comentario. Ejecuta el resto con PowerShell.
    const cab = `<# :
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); Invoke-Expression $f"
echo.
pause
exit /b
#>`;
    return (cab + ps).replace(/\r?\n/g, '\r\n');
  }

  // Prueba de conexión con la API NO COBIS: solo consultas (red, token, catálogo y operaciones de un cliente).
  function scriptPowerShellProbarNoCobis(cfg = {}) {
    const base = cfg.baseUrl || 'http://gateway-api-microservicios-core-test.apps.closdesa.bvsa.local/riesgos';
    const token = cfg.tokenUrl || 'https://ssohomo.valo.ar/auth/realms/COBIS-TEST/protocol/openid-connect/token';
    const clientId = cfg.clientId || 'apiriesgos';
    const tipo = cfg.tipoCredito || NO_COBIS.tipoCredito;
    const cliente = cfg.cliente || 644;
    return `# VALO - EPORTFOLIO · Prueba de conexión con la API NO COBIS (Orquestador de Riesgos)
# SOLO CONSULTA: no ingresa ni cancela operaciones. Clic derecho -> "Ejecutar con PowerShell",
# o: powershell -ExecutionPolicy Bypass -File probar-api-nocobis.ps1
# Usa la misma clave guardada que nocobis-api.ps1 (nocobis-credencial.txt en esta carpeta); si no está, la pide.
param(
  [string]$BaseUrl = '${base}',
  [string]$TokenUrl = '${token}',
  [string]$ClientId = '${clientId}',
  [string]$TipoCredito = '${tipo}',
  [long]$Cliente = ${cliente},
  [switch]$OlvidarClave,
  [switch]$SinPausa
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Proxy de la red (p. ej. McAfee Web Gateway): se autentica con el usuario de Windows, como el navegador.
try { $px = [Net.WebRequest]::DefaultWebProxy; if ($px) { $px.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } } catch {}
try { [Net.Http.HttpClient]::DefaultProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}
$Carpeta = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$script:Ok = $true
function Paso([string]$Titulo, [scriptblock]$Accion) {
  Write-Host ''
  Write-Host $Titulo -ForegroundColor Cyan
  try { & $Accion; return $true }
  catch {
    $script:Ok = $false
    $m = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $m = $_.ErrorDetails.Message }
    try { if ($_.Exception.Response) { $m = ('HTTP {0}: {1}' -f [int]$_.Exception.Response.StatusCode, $m) } } catch {}
    Write-Host ('  [ERROR] ' + (($m -replace '\\s+', ' ').Trim())) -ForegroundColor Red
    if ($Titulo -like '3)*') { Write-Host '  Si la clave es incorrecta, volvé a ejecutar con -OlvidarClave para ingresarla de nuevo.' -ForegroundColor DarkYellow }
    return $false
  }
}
function Llega([string]$Url) {
  $u = [Uri]$Url
  $c = New-Object Net.Sockets.TcpClient
  try {
    $t = $c.BeginConnect($u.Host, $u.Port, $null, $null)
    if (-not $t.AsyncWaitHandle.WaitOne(5000)) { throw ('sin respuesta de {0}:{1} (red, VPN o firewall)' -f $u.Host, $u.Port) }
    $c.EndConnect($t)
    Write-Host ('  [OK] {0}:{1} responde' -f $u.Host, $u.Port) -ForegroundColor Green
  } finally { $c.Close() }
}

Write-Host 'Prueba de conexión con la API NO COBIS (solo consulta, no envía datos)' -ForegroundColor Yellow
Write-Host ('API:   ' + $BaseUrl)
Write-Host ('Token: ' + $TokenUrl)

$red1 = Paso '1) Red: servidor de token' { Llega $TokenUrl }
$red2 = Paso '2) Red: servidor de la API' { Llega $BaseUrl }

$Token = $null
if ($red1) {
  Paso '3) Token (OAuth2 client credentials)' {
    $ArchivoClave = Join-Path $Carpeta 'nocobis-credencial.txt'
    if ($OlvidarClave -and (Test-Path $ArchivoClave)) { Remove-Item $ArchivoClave }
    if (Test-Path $ArchivoClave) { $Seguro = Get-Content $ArchivoClave | ConvertTo-SecureString }
    else {
      $Seguro = Read-Host "  client_secret de '$ClientId' (se guarda cifrado en $ArchivoClave)" -AsSecureString
      $Seguro | ConvertFrom-SecureString | Set-Content $ArchivoClave
    }
    $sec = (New-Object System.Net.NetworkCredential('', $Seguro)).Password
    $r = Invoke-RestMethod -Method Post -Uri $TokenUrl -Body @{ client_id = $ClientId; client_secret = $sec; grant_type = 'client_credentials' } -ContentType 'application/x-www-form-urlencoded'
    if (-not $r.access_token) { throw 'el servidor no devolvió access_token' }
    $script:Token = $r.access_token
    Write-Host ('  [OK] token obtenido (vence en {0} segundos)' -f $r.expires_in) -ForegroundColor Green
  } | Out-Null
} else { Write-Host ''; Write-Host '3) Token: no se prueba (no hay red hacia el servidor de token)' -ForegroundColor DarkYellow }

if ($script:Token -and $red2) {
  $h = @{ Authorization = 'Bearer ' + $script:Token }
  Paso '4) API: catálogo NOCOBIS (GET /v1/nocobis/catalogo)' {
    $cat = @(Invoke-RestMethod -Uri ($BaseUrl + '/v1/nocobis/catalogo') -Headers $h | ForEach-Object { $_ })
    Write-Host ('  [OK] {0} tipos de crédito' -f $cat.Count) -ForegroundColor Green
    foreach ($c in $cat) { Write-Host ('       {0,-12} {1}' -f $c.tipoCredito, $c.descripcion) }
    if (@($cat | Where-Object { $_.tipoCredito -eq $TipoCredito }).Count) { Write-Host ('  [OK] el tipo {0} existe en el catálogo' -f $TipoCredito) -ForegroundColor Green }
    else { $script:Ok = $false; Write-Host ('  [ATENCIÓN] el tipo {0} NO está en el catálogo: hay que usar otro código' -f $TipoCredito) -ForegroundColor Red }
  } | Out-Null
  Paso ('5) API: operaciones del cliente {0} (GET /v1/nocobis/operacion)' -f $Cliente) {
    try { $ops = @(Invoke-RestMethod -Uri ($BaseUrl + '/v1/nocobis/operacion?cliente=' + $Cliente) -Headers $h | ForEach-Object { $_ }) }
    catch { $c = 0; if ($_.Exception.Response) { try { $c = [int]$_.Exception.Response.StatusCode } catch {} }; if ($c -eq 404) { $ops = @() } else { throw } }  # 404 = sin operaciones
    Write-Host ('  [OK] {0} operaciones vigentes' -f $ops.Count) -ForegroundColor Green
    foreach ($o in $ops) { Write-Host ('       operación {0} · {1} · saldo {2:N2} · {3} a {4}' -f $o.numeroOperacion, $o.tipoCredito, [double]$o.saldoCapital, $o.fechaAlta, $o.fechaVencimiento) }
  } | Out-Null
} else { Write-Host ''; Write-Host '4-5) API: no se prueba (falta el token o la red hacia la API)' -ForegroundColor DarkYellow }

Write-Host ''
if ($script:Ok) { Write-Host 'RESULTADO: conexión OK. No se envió ningún dato.' -ForegroundColor Green }
else { Write-Host 'RESULTADO: hay problemas (ver los [ERROR] de arriba). No se envió ningún dato.' -ForegroundColor Red }
if (-not $SinPausa) { Read-Host 'Enter para cerrar' | Out-Null }
`;
  }

  // Valores distintos de una columna con su cantidad (para elegir periodo y estados).
  function valoresDistintos(datos, col) {
    const m = new Map();
    datos.forEach(r => { const v = valorTexto(r[col]); m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].map(([valor, cantidad]) => ({ valor, cantidad }))
      .sort((a, b) => (!isNaN(Number(a.valor)) && !isNaN(Number(b.valor)) ? Number(a.valor) - Number(b.valor) : a.valor < b.valor ? -1 : 1));
  }

  // ---------------------------------------------- Extracción automática del BI

  const TABLA_CARTERA = 'CreditoCarteraEspejoDetalleHistorico';
  const IMPORTES_CARTERA = ['ficuo capital', 'ficuo saldo capital', 'ficuo interes', 'ficuo saldo interes',
    'ficuo int deveng calculado vn', 'ficuo saldo valor fideicomitido'];
  const id = c => '`' + String(c).replace(/`/g, '') + '`';
  const lit = v => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  // Consultas ClickHouse del último periodo para los negocios de Clientes.
  // Sin columna de negocio definida, el negocio se busca en Serie y en Familia.
  // cfg: { negocios, colNegocio, estadosPagos, importes, colTitular, colTipoDoc, colCredito, colEstado }
  function sqlExtraccionCartera(cfg, tipo) {
    const lista = (cfg.negocios || []).map(lit).join(', ') || "''";
    const filtroNeg = cfg.colNegocio
      ? `toString(${id(cfg.colNegocio)}) IN (${lista})`
      : `(toString(Serie) IN (${lista}) OR toString(Familia) IN (${lista}))`;
    const w = [`periodo = (SELECT max(periodo) FROM ${TABLA_CARTERA})`, filtroNeg];
    if (tipo === 'detalle') return `SELECT * FROM ${TABLA_CARTERA} WHERE ${w.join(' AND ')} FORMAT JSONEachRow`;
    const colEstado = cfg.colEstado || 'Estado Cuota';
    if (cfg.estadosPagos && cfg.estadosPagos.length) w.push(`toString(${id(colEstado)}) NOT IN (${cfg.estadosPagos.map(lit).join(', ')})`);
    const titular = id(cfg.colTitular || 'ficuo doc titular');
    const s = c => `sum(toFloat64(ifNull(${id(c)}, 0)))`;
    const importes = (cfg.importes || []).map(c => `round(${s(c)}, 2) AS ${id('Suma ' + c)}`);
    const calc = cfg.calc || {};
    if (calc.capital && calc.intDto && calc.intDev) {
      importes.unshift(`round(${s(calc.capital)}, 2) AS ${id('Saldo capital')}`, `round(${s(calc.intDto)}, 2) AS ${id('Saldo int a dto')}`,
        `round(${s(calc.intDev)}, 2) AS ${id('Int dev a cobrar')}`,
        `round(${s(calc.capital)} - ${s(calc.intDto)} + ${s(calc.intDev)}, 2) AS ${id('Valor a descuento')}`);
    }
    // Ente y MIS según el CUIT del titular (tabla Bancos MELI; el ente, si no está, de Bancos).
    // cfg.entes: [[cuit, nombre, mis], ...]
    const entes = (cfg.entes || []).filter(e => e[0] && e[1]);
    const cuitTit = `replaceRegexpAll(toString(${titular}), '[^0-9]', '')`;
    const segun = (lista, v) => lista.length ? `multiIf(${lista.map(e => `${cuitTit} = ${lit(e[0])}, ${lit(v(e))}`).join(', ')}, '')` : "''";
    const ente = segun(entes, e => e[1]);
    const mis = segun(entes.filter(e => e[2] != null && e[2] !== ''), e => e[2]);
    return `SELECT toString(${titular}) AS Titular, ${ente} AS Ente, ${mis} AS MIS, ` +
      `count() AS ${id('Cuotas impagas')}${importes.length ? ', ' + importes.join(', ') : ''} ` +
      `FROM ${TABLA_CARTERA} WHERE ${w.join(' AND ')} GROUP BY Titular ORDER BY Titular FORMAT JSONEachRow`;
  }

  // Botón de favoritos: se usa estando en la página del BI (mismo servidor que /clickhouse/).
  function bookmarkletCartera(cfg) {
    const codigo = `(async()=>{
const SQLD=${JSON.stringify(sqlExtraccionCartera(cfg, 'detalle'))};
const SQLA=${JSON.stringify(sqlExtraccionCartera(cfg, 'agrupado'))};
if(!/bi-click/i.test(location.hostname)){alert('VALO Cartera: abrí primero el BI (bi-click-desa...) y después tocá este favorito.');return;}
const q=async s=>{const u=new URL('/clickhouse/',location.origin);u.searchParams.set('database','BI_CLIC');const r=await fetch(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:s});if(!r.ok)throw new Error(await r.text());const t=(await r.text()).trim();return t?t.split('\\n').map(JSON.parse):[];};
const csv=f=>{if(!f.length)return '';const h=Object.keys(f[0]);return '\\ufeff'+[h,...f.map(r=>h.map(c=>{const v=r[c];return typeof v==='number'?String(v).replace('.',','):v;}))].map(x=>x.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(';')).join('\\r\\n');};
const bajar=(t,n)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/csv;charset=utf-8'}));a.download=n;document.body.appendChild(a);a.click();setTimeout(()=>a.remove(),1000);};
try{const[d,g]=await Promise.all([q(SQLD),q(SQLA)]);if(!d.length){alert('VALO Cartera: el BI no devolvió filas para los negocios configurados en el último periodo.');return;}
const p=d[0].periodo||'';bajar(csv(g),'Cartera_por_titular_'+p+'.csv');setTimeout(()=>bajar(csv(d),'Cartera_detalle_'+p+'.csv'),600);
alert('VALO Cartera: periodo '+p+'\\n'+g.length+' titulares, '+d.length+' cuotas.\\nSe descargaron Cartera_por_titular y Cartera_detalle (este último se puede subir en la pestaña Cartera).');}
catch(e){alert('VALO Cartera: no se pudo consultar el BI.\\n'+e.message);}})();`;
    return 'javascript:' + encodeURIComponent(codigo.replace(/\n/g, ''));
  }

  // Script de PowerShell para el Programador de tareas de Windows.
  function scriptPowerShellCartera(cfg, carpeta, endpoint) {
    const aqui = t => t.replace(/'@/g, "' @");
    return `# VALO - EPORTFOLIO · Extracción automática de Cartera desde el BI (CreditoCarteraEspejoDetalle)
# Generado el ${new Date().toISOString().slice(0, 10)}. Negocios: ${(cfg.negocios || []).join(', ')}
# Deja en la carpeta: Cartera_por_titular_<aaaammdd>.csv, Cartera_por_titular_ULTIMO.csv,
# Cartera_detalle_<aaaammdd>.csv (se puede subir en la pestaña Cartera) y registro.log.
$ErrorActionPreference = 'Stop'
$Endpoint = '${endpoint}'
$Carpeta  = '${carpeta.replace(/'/g, "''")}'
$SqlAgrupado = @'
${aqui(sqlExtraccionCartera(cfg, 'agrupado'))}
'@
$SqlDetalle = @'
${aqui(sqlExtraccionCartera(cfg, 'detalle'))}
'@

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Proxy de la red (p. ej. McAfee Web Gateway): se autentica con el usuario de Windows, como el navegador.
try { $px = [Net.WebRequest]::DefaultWebProxy; if ($px) { $px.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } } catch {}
try { [Net.Http.HttpClient]::DefaultProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$Log = Join-Path $Carpeta 'registro.log'

function Consultar([string]$Sql) {
  $Url = $Endpoint + '?database=BI_CLIC'
  $Cuerpo = [Text.Encoding]::UTF8.GetBytes($Sql)
  $R = Invoke-WebRequest -Uri $Url -Method Post -Body $Cuerpo -ContentType 'text/plain; charset=utf-8' -UseDefaultCredentials -UseBasicParsing
  $Texto = [Text.Encoding]::UTF8.GetString($R.RawContentStream.ToArray())
  $Filas = @()
  foreach ($Linea in ($Texto -split "\`n")) { if ($Linea.Trim()) { $Filas += ($Linea | ConvertFrom-Json) } }
  return ,$Filas
}

# CSV con ';', coma decimal y UTF-8 con BOM (se abre bien en Excel en español).
$Cultura = [Globalization.CultureInfo]::GetCultureInfo('es-AR')
function Guardar($Filas, [string]$Nombre) {
  $Ruta = Join-Path $Carpeta $Nombre
  $Salida = foreach ($F in $Filas) {
    $O = [ordered]@{}
    foreach ($P in $F.PSObject.Properties) {
      $V = $P.Value
      if ($V -is [double] -or $V -is [decimal] -or $V -is [single]) { $V = $V.ToString($Cultura) }
      $O[$P.Name] = $V
    }
    [pscustomobject]$O
  }
  $Lineas = $Salida | ConvertTo-Csv -Delimiter ';' -NoTypeInformation
  [IO.File]::WriteAllLines($Ruta, [string[]]$Lineas, (New-Object Text.UTF8Encoding $true))
  return $Ruta
}

try {
  $Hoy = Get-Date -Format 'yyyyMMdd'
  $Agrupado = Consultar $SqlAgrupado
  $Detalle  = Consultar $SqlDetalle
  if ($Detalle.Count -eq 0) { throw 'El BI no devolvió filas para los negocios configurados.' }
  Guardar $Agrupado "Cartera_por_titular_$Hoy.csv" | Out-Null
  Guardar $Agrupado 'Cartera_por_titular_ULTIMO.csv' | Out-Null
  Guardar $Detalle  "Cartera_detalle_$Hoy.csv" | Out-Null
  Add-Content $Log "$(Get-Date -Format s) OK periodo $($Detalle[0].periodo): $($Agrupado.Count) titulares, $($Detalle.Count) cuotas"
} catch {
  Add-Content $Log "$(Get-Date -Format s) ERROR $($_.Exception.Message)"
  exit 1
}
`;
  }

  function comandoTareaCartera(rutaScript, hora) {
    return `schtasks /Create /F /SC DAILY /ST ${hora} /TN "VALO Cartera BI" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \\"${rutaScript}\\""`;
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

  // Sin ceros adelante: banco 7 → "7" + ddmmaa + secuencia (los ceros de relleno del banco se quitan).
  function numeroCredito(codigoBanco, fechaDDMMYY, secuencia) {
    return (prefijoBanco(codigoBanco) + fechaDDMMYY + String(secuencia)).replace(/^0+(?=\d)/, '');
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

  // opciones.nombre: 'recortado' (GetNet: LEFT(nombre,30)) o 'sinComas' (MELI: SUBSTITUTE(nombre,",","")); siempre máx. 30 caracteres.
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
        nombre: !banco ? '' : sinComas ? String(banco.nombre || '').replace(/,/g, '').slice(0, 30) : String(banco.nombre || '').slice(0, 30),
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

  // Cuotas<Cliente><ddmmaa>.csv / Creditos<Cliente><ddmmaa>.csv (nombre del cliente sin acentos, espacios ni símbolos).
  function nombreArchivo(tipo, hoy, extension, cliente) {
    const nombre = String(cliente || 'GetNet').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '') || 'GetNet';
    return (tipo === 'cuotas' ? 'Cuotas' : 'Creditos') + nombre + hoyDDMMYY(hoy) + '.' + (extension || 'csv');
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
    sqlExtraccionCartera, bookmarkletCartera, scriptPowerShellCartera, comandoTareaCartera, IMPORTES_CARTERA,
    NO_COBIS, ultimoDiaHabil, fechasNoCobis, lineaNoCobis, txtNoCobis, loteApiNoCobis, scriptPowerShellNoCobis, scriptPowerShellProbarNoCobis, scriptPowerShellAgenteNoCobis, cmdEnvioNoCobis,
    leerCartera, BASTANTEO_CATALOGO, BASTANTEO_CLAVES, BASTANTEO_EXTRA, leerPoderesOcr, leerClienteBastanteo, cuitPorDni, formatoCuit, jsonPoder, jsonBastanteoUnico, leerInventarioGarantias, INVENTARIOS_CONTABLES, INVENTARIO_DENOMINACION, INVENTARIO_FIRMAS, fechaReporteIso, fechaInventarioDesdeReporte, leerPadronDesdeInventarios, leerBaseEntes, unirPadron, armarInventariosContables, leerCom3500, leerTcApiBcra, elegirTipoCambio, numeroEnLetras, daxCarteraPowerBI, daxDiagnosticoPowerBI, leerFilasPowerBI, sugerirColumnaCartera, columnasNumericasCartera, agruparCartera, valoresDistintos, sqlCartera,
    leerCsv, encabezadosEjemplo, leerDefinicionInterfaz, sugerirColumna, detectarHojaInterfaz,
    normalizar, provinciaPorNombre, crearBuscadorBancoPorNombre, round2, aNumero, aFechaSerial, aCodigoBanco,
    fechaDDMMYY, fechaYYYYMMDD, fechaLegible, hoyDDMMYY,
    detectarHoja, armarReporte, leerConciliacion,
    problemasBanco, codigoCreditoPorDefecto, prefijoBanco, numeroCredito, prefijosRepetidos, controlarBancos, controlarReporte,
    generarCuotas, generarCreditos, txtCuotas, txtCreditos, nombreArchivo,
    calcularSecuenciaLote, validarFormulario,
  };
  root.ValoMotor = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
