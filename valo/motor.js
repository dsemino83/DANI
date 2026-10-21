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
    // "¥" es una Ñ mal codificada en algunos Excel ("VENINI NU¥EZ").
    return String(texto == null ? '' : texto).replace(/¥/g, 'Ñ')
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

  // Saldo de deuda por fiduciante y mes de vencimiento, sin filtrar negocios. Cuotas de la última foto mensual
  // (Periodo más reciente) vencidas hasta antes de ayer (la cobranza de ayer y hoy puede no estar bajada). Deuda impaga = cuotas en estado
  // Impaga (4) por su valor (capital + interés, "ficuo valor cuota"); además, lo que falta cobrar de las Paga Parcial (1)
  // = saldo de capital + saldo de interés. Saldo de deuda = impago + saldo de Paga Parcial. Quedan afuera Normal (0),
  // Paga (2) y Paga a Regularizar (3) (cobradas, saldo 0).
  function daxSaldoDeuda(opciones = {}) {
    const t = opciones.tabla || PBI_TABLA, c = n => `'${t}'[${n}]`;
    const hasta = opciones.hasta ? `DATE ( ${opciones.hasta.slice(0, 4)}, ${Number(opciones.hasta.slice(5, 7))}, ${Number(opciones.hasta.slice(8, 10))} )` : 'TODAY () - 2';
    // Una misma cuota puede estar repetida en la foto (otro lote u otra fecha de cálculo, a veces con otro estado):
    // se toma el renglón más reciente de cada cuota (fecha de cálculo y número de lote) antes de mirar el estado.
    // Además devuelve, por fiduciante (renglones sin vencimiento), las cuotas vencidas que siguen en estado Normal: nadie
    // las marcó como pagas ni impagas, así que su estado en Power BI no está actualizado.
    return [
      'DEFINE',
      `  VAR Hasta = ${hasta}`,
      // Foto de cartera: la última, o la del mes elegido (ej. 2026-09 = cierre de septiembre, como el reporte del BI).
      opciones.periodo ? `  VAR UltimoPeriodo = CALCULATE ( MAX ( ${c('Periodo')} ), FILTER ( ALL ( ${c('Periodo')} ), FORMAT ( ${c('Periodo')}, "yyyy-MM" ) = "${String(opciones.periodo).slice(0, 7).replace(/"/g, '')}" ) )`
        : `  VAR UltimoPeriodo = MAX ( ${c('Periodo')} )`,
      '  VAR T = SELECTCOLUMNS (',
      `      FILTER ( '${t}', ${c('Periodo')} = UltimoPeriodo && ${c('CuotaFechaVencimientoId')} <= Hasta ),`,
      `      "Clave", ${c('NroCredito')} & "|" & ${c('CuotaNumero')},`,
      `      "Orden", FORMAT ( ${c('Fecha de Calculo')}, "yyyyMMdd" ) & FORMAT ( ${c('Numero de Lote')}, "000" ),`,
      `      "Fid", ${c('EnteFiducianteId')} & "",`,
      `      "Est", ${c('FideicomisoCreditoCuotaEstadoId')} & "",`,
      `      "Vto", FORMAT ( ${c('CuotaFechaVencimientoId')}, "yyyy-MM-dd" ),`,
      `      "Calc", ${c('Fecha de Calculo')},`,
      `      "Valor", ${c('Capital')} + ${c('Interes')},`,
      `      "Saldo", ${c('Saldo_Capital')} + ${c('Saldo_Interes')} )`,
      '  VAR Ult = SELECTCOLUMNS ( GROUPBY ( T, [Clave], "M", MAXX ( CURRENTGROUP (), [Orden] ) ), "Clave", [Clave] & "", "Orden", [M] & "" )',
      '  VAR Ultimas = NATURALINNERJOIN ( T, Ult )',
      '  VAR G = GROUPBY ( FILTER ( Ultimas, [Est] IN { "1", "4" } ), [Fid], [Vto],',
      '      "Cuotas", SUMX ( CURRENTGROUP (), IF ( [Est] = "4", 1, 0 ) ), "Deuda", SUMX ( CURRENTGROUP (), IF ( [Est] = "4", [Valor], 0 ) ),',
      '      "CuotasPP", SUMX ( CURRENTGROUP (), IF ( [Est] = "1", 1, 0 ) ), "SaldoPP", SUMX ( CURRENTGROUP (), IF ( [Est] = "1", [Saldo], 0 ) ) )',
      '  VAR SinMarcar = SELECTCOLUMNS ( GROUPBY ( Ultimas, [Fid], "N", SUMX ( CURRENTGROUP (), IF ( [Est] = "0", 1, 0 ) ), "V", SUMX ( CURRENTGROUP (), IF ( [Est] = "0", [Valor], 0 ) ),',
      '      "C", MAXX ( CURRENTGROUP (), [Calc] ) ), "Fid", [Fid], "Vto", "", "Cuotas", [N], "Deuda", [V], "CuotasPP", 0, "SaldoPP", 0 )',
      'EVALUATE',
      '  ADDCOLUMNS ( UNION ( G, SinMarcar ),',
      "    \"Fiduciante\", LOOKUPVALUE ( 'Fiduciante'[Ente], 'Fiduciante'[EnteId], [Fid] ),",
      '    "Periodo", UltimoPeriodo, "Hasta", Hasta )',
      'ORDER BY [Fid], [Vto]',
    ].join('\n');
  }
  // Detalle del saldo de deuda por deudor y crédito: un renglón por fiduciante, CUIT del deudor, número de crédito y
  // fecha de vencimiento, con lo impago (estado 4) y el saldo de las cuotas Paga Parcial (estado 1). Mismo criterio que
  // daxSaldoDeuda (última foto de cartera o la del mes elegido, el renglón más reciente de cada cuota).
  function daxSaldoDeudaDetalle(opciones = {}) {
    const t = opciones.tabla || PBI_TABLA, c = n => `'${t}'[${n}]`;
    const hasta = opciones.hasta ? `DATE ( ${opciones.hasta.slice(0, 4)}, ${Number(opciones.hasta.slice(5, 7))}, ${Number(opciones.hasta.slice(8, 10))} )` : 'TODAY () - 2';
    return [
      'DEFINE',
      `  VAR Hasta = ${hasta}`,
      opciones.periodo ? `  VAR UltimoPeriodo = CALCULATE ( MAX ( ${c('Periodo')} ), FILTER ( ALL ( ${c('Periodo')} ), FORMAT ( ${c('Periodo')}, "yyyy-MM" ) = "${String(opciones.periodo).slice(0, 7).replace(/"/g, '')}" ) )`
        : `  VAR UltimoPeriodo = MAX ( ${c('Periodo')} )`,
      '  VAR T = SELECTCOLUMNS (',
      `      FILTER ( '${t}', ${c('Periodo')} = UltimoPeriodo && ${c('CuotaFechaVencimientoId')} <= Hasta ),`,
      `      "Clave", ${c('NroCredito')} & "|" & ${c('CuotaNumero')},`,
      `      "Orden", FORMAT ( ${c('Fecha de Calculo')}, "yyyyMMdd" ) & FORMAT ( ${c('Numero de Lote')}, "000" ),`,
      `      "Fid", ${c('EnteFiducianteId')} & "",`,
      `      "Cuit", ${c('CUITDeudor')} & "",`,
      `      "Cred", ${c('NroCredito')} & "",`,
      `      "Est", ${c('FideicomisoCreditoCuotaEstadoId')} & "",`,
      `      "Vto", FORMAT ( ${c('CuotaFechaVencimientoId')}, "yyyy-MM-dd" ),`,
      `      "Valor", ${c('Capital')} + ${c('Interes')},`,
      `      "Saldo", ${c('Saldo_Capital')} + ${c('Saldo_Interes')} )`,
      '  VAR Ult = SELECTCOLUMNS ( GROUPBY ( T, [Clave], "M", MAXX ( CURRENTGROUP (), [Orden] ) ), "Clave", [Clave] & "", "Orden", [M] & "" )',
      '  VAR Ultimas = NATURALINNERJOIN ( T, Ult )',
      '  VAR G = GROUPBY ( FILTER ( Ultimas, [Est] IN { "1", "4" } ), [Fid], [Cuit], [Cred], [Vto],',
      '      "Cuotas", SUMX ( CURRENTGROUP (), IF ( [Est] = "4", 1, 0 ) ), "Deuda", SUMX ( CURRENTGROUP (), IF ( [Est] = "4", [Valor], 0 ) ),',
      '      "CuotasPP", SUMX ( CURRENTGROUP (), IF ( [Est] = "1", 1, 0 ) ), "SaldoPP", SUMX ( CURRENTGROUP (), IF ( [Est] = "1", [Saldo], 0 ) ) )',
      'EVALUATE',
      "  ADDCOLUMNS ( G, \"Fiduciante\", LOOKUPVALUE ( 'Fiduciante'[Ente], 'Fiduciante'[EnteId], [Fid] ) )",
      'ORDER BY [Fiduciante], [Cuit], [Cred], [Vto]',
    ].join('\n');
  }
  // Renglones del detalle: [{ fiduciante, cuitFid, cuit, credito, vto, cuotas, impago, cuotasPP, pp, saldo }].
  function armarDeudaDetalle(respuesta) {
    const num = v => Number(v) || 0;
    return leerFilasPowerBI(respuesta).datos.map(r => ({
      fiduciante: String(r.Fiduciante || ''), cuitFid: String(r.Fid == null ? '' : r.Fid), cuit: String(r.Cuit == null ? '' : r.Cuit).replace(/\D/g, ''),
      credito: String(r.Cred == null ? '' : r.Cred), vto: String(r.Vto || '').slice(0, 10),
      cuotas: num(r.Cuotas), impago: round2(num(r.Deuda)), cuotasPP: num(r.CuotasPP), pp: round2(num(r.SaldoPP)),
    })).map(x => Object.assign(x, { saldo: round2(x.impago + x.pp) })).filter(x => x.saldo || x.cuotas || x.cuotasPP);
  }
  // Tabla fiduciante × mes: { meses, filas: [{ cuit, fiduciante, porMes: {mes: deuda}, fechas: {mes: [vencimientos]},
  // cuotas, total }], totalesMes, total }. Power BI devuelve un renglón por fiduciante y fecha de vencimiento.
  function armarSaldoDeuda(respuesta) {
    const todos = leerFilasPowerBI(respuesta).datos;
    // Renglones sin vencimiento: cuotas vencidas de cada fiduciante que siguen en estado Normal (sin actualizar).
    const sinMarcar = [];
    let periodo = '', hasta = '';
    todos.forEach(r => {
      const cuit = String(r.Fid == null ? '' : r.Fid);
      if (!r.Vto && Number(r.Cuotas) > 0) sinMarcar.push({ cuit, fiduciante: r.Fiduciante || cuit, cuotas: Number(r.Cuotas), valor: round2(Number(r.Deuda) || 0) });
      periodo = periodo || String(r.Periodo || '').slice(0, 10);
      hasta = hasta || String(r.Hasta || '').slice(0, 10);
    });
    const datos = todos.filter(r => r.Vto);
    datos.forEach(r => { r.Vto = String(r.Vto).slice(0, 10); r.Mes = r.Vto.slice(0, 7); });
    const meses = [...new Set(datos.filter(r => Number(r.Deuda)).map(r => String(r.Mes)))].sort();
    const porFid = new Map();
    datos.forEach(r => {
      const cuit = String(r.Fid == null ? '' : r.Fid);
      if (!porFid.has(cuit)) porFid.set(cuit, { cuit, fiduciante: r.Fiduciante || cuit, porMes: {}, fechas: {}, porDia: {}, ppPorDia: {}, cuotas: 0, total: 0, ppCuotas: 0, pp: 0 });
      const f = porFid.get(cuit), v = Number(r.Deuda) || 0, pp = Number(r.SaldoPP) || 0;
      f.ppCuotas += Number(r.CuotasPP) || 0;
      f.pp = round2(f.pp + pp);
      if (r.Vto && pp) f.ppPorDia[r.Vto] = round2((f.ppPorDia[r.Vto] || 0) + pp);
      if (!v) return;
      f.porMes[r.Mes] = round2((f.porMes[r.Mes] || 0) + v);
      if (r.Vto) f.porDia[r.Vto] = round2((f.porDia[r.Vto] || 0) + v);
      if (r.Vto) { f.fechas[r.Mes] = f.fechas[r.Mes] || []; if (!f.fechas[r.Mes].includes(r.Vto)) f.fechas[r.Mes].push(r.Vto); f.fechas[r.Mes].sort(); }
      f.cuotas += Number(r.Cuotas) || 0;
      f.total = round2(f.total + v);
    });
    sinMarcar.sort((a, b) => b.valor - a.valor);
    porFid.forEach(f => { f.saldoDeuda = round2(f.total + f.pp); });
    const filas = [...porFid.values()].filter(f => f.total || f.pp).sort((a, b) => (b.total + b.pp) - (a.total + a.pp));
    const totalesMes = Object.fromEntries(meses.map(m => [m, round2(filas.reduce((s, f) => s + (f.porMes[m] || 0), 0))]));
    const total = round2(filas.reduce((s, f) => s + f.total, 0)), pp = round2(filas.reduce((s, f) => s + f.pp, 0));
    return { meses, filas, totalesMes, total, cuotas: filas.reduce((s, f) => s + f.cuotas, 0), pp, ppCuotas: filas.reduce((s, f) => s + f.ppCuotas, 0),
      saldoDeuda: round2(total + pp), periodo, hasta, sinMarcar };
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

  // ------------------------------------------------------------ USO DE ACUERDOS (ccusosob.sqr, libro de deudores)
  // Reporte de cuentas corrientes por oficina (ccusosob_<fecha>_ofN.lis). Detalle: CUENTA · NOMBRE (18 car.) · TIPO
  // (O / C1 / C2…) · LIMITE · TASA · FECHA USO · TOTAL UTILIZADO · INT.CONTRATADO · INT.EXEDIDO · INT.LIQUIDADO · ESTADO…
  // La cuenta y el nombre vienen solo en el primer uso de cada cuenta. Los intereses se ubican por la columna donde
  // termina el importe (el nombre puede traer caracteres de dos bytes que corren la línea uno o dos lugares).
  function leerUsoAcuerdos(texto, nombreArchivo = '') {
    const lineas = String(texto).replace(/\r/g, '').split('\n');
    const num = v => Number(String(v).replace(/,/g, ''));
    let fecha = '', oficina = '', oficinaNro = 0, moneda = '', cuenta = '', nombre = '', ultima = null;
    const filas = [], totalesCuenta = [], generales = [];
    const iso = t => { const m = String(t || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
    for (const l of lineas) {
      if (!fecha) { const m = l.match(/FEC\. PROCESO:\s*(\d{2}\/\d{2}\/\d{4})/); if (m) fecha = iso(m[1]); }
      const o = l.match(/^OFICINA:\s*(.+?)\s*\((\d+)\)/);
      if (o) { oficina = o[1].trim(); oficinaNro = Number(o[2]); continue; }
      const mo = l.match(/^MONEDA:\s*(.+?)\s*\((\d+)\)/);
      if (mo) { moneda = Number(mo[2]); continue; }
      const a = l.match(/^ (\d-\d{3}-\d{10}-\d)\s/);
      const d = l.match(/^(.*?)\s+(\S+)\s+(?:-?[\d,]+\.\d{2}\s+)?-?\d+\.\d{4}\s+(\d{2}\/\d{2}\/\d{4})\s/);
      if (d && (a || /^\s{30,}\S/.test(l))) {
        if (a) { cuenta = a[1]; nombre = d[1].slice(a[0].length).trim(); }
        if (!cuenta) continue;
        let contratado = 0, excedido = 0, liquidado = 0;
        for (const m of l.matchAll(/-?[\d,]+\.\d{2}(?![\d.])/g)) {
          const fin = m.index + m[0].length;
          if (fin >= 124 && fin <= 142) contratado += num(m[0]);
          else if (fin >= 143 && fin <= 162) excedido += num(m[0]);
          else if (fin >= 163 && fin <= 182) liquidado += num(m[0]);
        }
        const resto = l.match(/\s([A-Z])\s+\d{2}\/\d{2}\/\d{4}/);
        ultima = { cuenta, nombre, tipo: d[2], fechaUso: iso(d[3]), contratado: round2(contratado), excedido: round2(excedido), liquidado: round2(liquidado),
          estado: resto ? resto[1] : '', moneda, oficina, oficinaNro, archivo: nombreArchivo };
        filas.push(ultima);
        continue;
      }
      // Total de intereses de cada cuenta (contratado · excedido · liquidado): sirve de control del detalle.
      const t = l.match(/TOTAL INTERESES:/);
      if (t && cuenta) {
        let c = 0, e = 0;
        for (const m of l.matchAll(/-?[\d,]+\.\d{2}(?![\d.])/g)) {
          const fin = m.index + m[0].length;
          if (fin >= 124 && fin <= 142) c += num(m[0]); else if (fin >= 143 && fin <= 162) e += num(m[0]);
        }
        totalesCuenta.push({ cuenta, moneda, intereses: round2(c + e) });
        continue;
      }
      const g = l.match(/TOTAL GENERAL:\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})/);
      if (g) generales.push({ moneda, contratado: num(g[1]), excedido: num(g[2]), liquidado: num(g[3]) });
    }
    if (!filas.length && !generales.length) throw new Error(`${nombreArchivo || 'El archivo'} no tiene usos de acuerdos (se espera el reporte ccusosob, LIBRO DE DEUDORES).`);
    filas.forEach(f => { f.fechaProceso = fecha; });
    const porCuenta = new Map();
    filas.forEach(f => { const k = f.cuenta + '|' + f.moneda; porCuenta.set(k, round2((porCuenta.get(k) || 0) + f.contratado + f.excedido)); });
    const malos = totalesCuenta.filter(t => Math.abs((porCuenta.get(t.cuenta + '|' + t.moneda) || 0) - t.intereses) >= 0.01);
    return { reporte: 'ccusosob', usoAcuerdos: true, fecha, origen: 'Uso de acuerdos (cuentas corrientes)', oficinas: [...new Set(filas.map(f => f.oficina))],
      filas, controles: totalesCuenta.map(t => ({ cuenta: t.cuenta, ok: !malos.includes(t) })), generales };
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
    // Desde el reporte de uso de acuerdos (ccusosob): interés contratado + interés excedido de cada uso en pesos.
    { id: '131.804.015', cuenta: '131.804.015.0', contra: '131804015', titulo: 'Intereses devengados a cobrar cuentas corrientes',
      denominacion: 'Intereses devengados a cobrar cuentas corrientes', encabezado: 'Inventario de Intereses', fuente: 'ccusosob',
      moneda: 'ARS', columnas: ['concepto', 'cuit', 'tipo', 'importe'] },
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

  // Inventarios anteriores en PDF (renglones "NOMBRE  CUIT  …"): nombre → CUIT, para los reportes que no traen el ente.
  function leerPadronDesdeLineasPdf(lineas) {
    const nombres = {};
    (lineas || []).forEach(l => {
      const m = String(l || '').match(/^(.*?[A-Za-zÁÉÍÓÚÑáéíóúñ].*?)\s+(\d{11})(?:\s|$)/);
      if (!m) return;
      const n = normalizar(m[1].replace(/^\d+\s+/, ''));
      if (n && !/^(cuit|concepto|total)/.test(n)) nombres[n] = m[2];
    });
    return { entes: {}, nombres, garantias: {} };
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
  // usos: filas de leerUsoAcuerdos (cuenta 131.804.015). padron.cuentasCC[cuenta] = {cuit, nombre, excluir} (cargado a mano);
  // opciones.cuentasPbi: leerCuentasPowerBI (cuenta → cliente, del cubo PasivasComercial);
  // opciones.cuitsPorNombre: {nombre del reporte: cuit} encontrado en la base de entes.
  function armarInventariosContables(filas, padron = {}, base = {}, usos = [], opciones = {}) {
    const entes = padron.entes || {}, garantias = padron.garantias || {}, nombres = padron.nombres || {};
    const cuitPorNombre = desc => {
      const n = normalizar(desc);
      if (!n) return '';
      if (nombres[n]) return nombres[n];
      const k = Object.keys(nombres).find(x => x.length >= 8 && (x.startsWith(n) || n.startsWith(x)));
      return k ? nombres[k] : '';
    };
    return INVENTARIOS_CONTABLES.map(def => {
      if (def.fuente === 'ccusosob') return inventarioUsoAcuerdos(def, usos, padron, cuitPorNombre, opciones);
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

  // Filas de la consulta de Power BI (tabla CuentasClientes: Cuenta, CUIT, Ente, Nombre, Estado) → { cuenta: [clientes] }.
  // La cuenta va sin guiones: 3-001-0000001560-0 del ccusosob = 300100000015600 del cubo.
  function leerCuentasPowerBI(filas) {
    const r = {};
    (filas || []).forEach(f => {
      const x = {};
      Object.entries(f || {}).forEach(([k, v]) => { x[normalizar(String(k).replace(/^.*\[(.+)\]$/, '$1'))] = v; });
      const cuenta = String(x.cuenta == null ? '' : x.cuenta).replace(/\D/g, ''), cuit = String(x.cuit == null ? '' : x.cuit).replace(/\D/g, '');
      if (!cuenta || cuit.length !== 11) return;
      const ente = String(x.ente == null ? '' : x.ente).replace(/\.0+$/, '').trim();
      (r[cuenta] || (r[cuenta] = [])).push({ cuit, ente, nombre: String(x.nombre || '').trim(), estado: String(x.estado || '').trim() });
    });
    return r;
  }
  // Cliente de una cuenta: si hay varios (cotitulares), el que tiene el nombre del reporte; si no, el de la cuenta activa.
  function clienteDeCuenta(mapa, cuenta, nombre) {
    const lista = (mapa || {})[String(cuenta).replace(/\D/g, '')] || [];
    if (lista.length < 2) return lista[0] || {};
    const n = normalizar(nombre);
    return lista.find(c => n && normalizar(c.nombre).startsWith(n)) || lista.find(c => /activa/i.test(c.estado)) || lista[0];
  }

  function inventarioUsoAcuerdos(def, usos, padron, cuitPorNombre, opciones) {
    const cuentas = padron.cuentasCC || {}, porNombre = opciones.cuitsPorNombre || {};
    const proceso = usos.map(u => u.fechaProceso).filter(Boolean).sort().pop() || '';
    const limite = proceso ? `${Number(proceso.slice(0, 4)) - 1}${proceso.slice(4)}` : '';
    const conInteres = usos.filter(u => u.moneda === 80 && round2(u.contratado + u.excedido) !== 0);
    const antiguo = u => !!(limite && u.fechaUso && u.fechaUso < limite);
    // Cuentas que se sacan a mano (ej. intereses viejos de una entidad en liquidación): se informan aparte.
    const excluidos = conInteres.filter(u => (cuentas[u.cuenta] || {}).excluir);
    const porUso = conInteres.filter(u => !excluidos.includes(u)).map(u => {
      const m = cuentas[u.cuenta] || {};
      const cuit = m.cuit || clienteDeCuenta(opciones.cuentasPbi, u.cuenta, u.nombre).cuit || porNombre[u.nombre] || cuitPorNombre(u.nombre);
      return { codigo: u.cuenta, ente: u.cuenta, cuentaCC: true, concepto: u.nombre, descripcion: m.nombre || u.nombre, cuit, tipo: u.tipo,
        importe: round2(u.contratado + u.excedido), fechaUso: u.fechaUso, antiguo: antiguo(u), oficina: u.oficina, faltaCuit: !cuit, faltaFecha: false };
    });
    // Una fila por cliente (CUIT; sin CUIT, por cuenta) y tipo de descubierto, en el orden en que aparece en el reporte.
    const grupos = new Map();
    porUso.forEach(f => {
      const k = (f.cuit || f.codigo) + '|' + f.tipo;
      const g = grupos.get(k);
      if (!g) grupos.set(k, Object.assign({}, f, { usos: 1, cuentas: [f.codigo] }));
      else { g.importe = round2(g.importe + f.importe); g.usos++; if (!g.cuentas.includes(f.codigo)) g.cuentas.push(f.codigo); }
    });
    const filasInv = [...grupos.values()];
    const resumen = lista => [...lista.reduce((m, u) => m.set(u.cuenta, { cuenta: u.cuenta, nombre: u.nombre,
      importe: round2(((m.get(u.cuenta) || {}).importe || 0) + u.contratado + u.excedido), usos: ((m.get(u.cuenta) || {}).usos || 0) + 1 }), new Map()).values()];
    return { def, filas: filasInv, usos: porUso.length, total: round2(filasInv.reduce((a, f) => a + f.importe, 0)), excluidos: resumen(excluidos),
      antiguos: resumen(conInteres.filter(antiguo)), fechaProceso: proceso };
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
  // "Dictamen Acta de Designación de Autoridades": razón social, fecha y autoridades (nombre, DNI, rol). El rol puede venir
  // en la misma línea que el nombre y el DNI o en las líneas siguientes.
  function leerAutoridadesOcr(lineas) {
    const L = lineas.map(l => String(l || '').replace(/\s+/g, ' ').trim()).filter(l => l && l !== '<<PAGINA>>');
    const actas = [];
    // Actas de designación y estatutos (su "Estructura Administración": presidente, gerentes…).
    L.forEach((l, i) => {
      const esEstatuto = /^estatuto$/i.test(l);
      if (!esEstatuto && !/^dictamen acta de designaci[oó]n/i.test(l)) return;
      let fin = L.length;
      for (let j = i + 1; j < L.length; j++) if (/^(acreditaci[oó]n de poderes|balance|dictamen\b|estatuto$)/i.test(L[j])) { fin = j; break; }
      const b = L.slice(i, fin);
      const valor = et => { const re = new RegExp('^' + et + '\\s*:\\s*(.*)$', 'i'); const x = b.find(y => re.test(y)); return x ? x.match(re)[1].trim() : ''; };
      const acta = { razon_social: valor('Raz[oó]n Social'), cuit_empresa: valor('CUIT').replace(/\D/g, ''), fecha: valor('Fecha del Documento') || valor('Fecha de Constituci[oó]n'), autoridades: [] };
      if (esEstatuto) acta.estatuto = true;
      const ia = b.findIndex(x => (esEstatuto ? /^estructura (de )?administraci[oó]n/i : /^autoridades designadas/i).test(x));
      if (esEstatuto && ia < 0) return;
      const corte = esEstatuto ? b.findIndex((x, k) => k > ia && /^(accionistas|otros autorizados|facultades|conclusi[oó]n)/i.test(x)) : -1;
      let ult = null;
      b.slice(ia > -1 ? ia + 1 : 0, corte > -1 ? corte : undefined).forEach(x => {
        if (/^(nombre completo|identificaci[oó]n|rol|duraci[oó]n)(\s|$)/i.test(x) || /:/.test(x)) return;
        const m = x.match(/^(.*?\D)\s*(\d{6,9})(?:\s+(.+))?$/);
        const sinDni = !m && x.match(/^(.+?)\s+((?:director|directora|presidente|presidenta|vicepresidente|vicepresidenta|s[ií]ndico|gerente|socio gerente)\b.*)$/i);
        if (m && m[1].trim()) { ult = { nombre_completo: m[1].trim(), dni: m[2], rol: (m[3] || '').trim() }; acta.autoridades.push(ult); }
        else if (sinDni) { ult = { nombre_completo: sinDni[1].trim(), dni: '', rol: sinDni[2].trim() }; acta.autoridades.push(ult); }
        else if (ult && !ult.rol) ult.rol = x;
      });
      acta.autoridades.forEach(a => { a.rol = a.rol.replace(/\s+(indefinid[oa]|indefinite|\d+(\s*(años?|ejercicios?))?)$/i, '').trim(); });
      actas.push(acta);
    });
    return actas;
  }
  // Presidente o equivalente: "Director titular y/- Presidente", "Socio gerente", "Gerente titular" (SRL). No vicepresidente
  // ni suplentes.
  // También quien tiene la representación legal ("Director Titular / Vicepresidente (con representación legal)").
  const esPresidente = rol => { const r = normalizar(rol); return /\bpresident[ea]\b/.test(r) || (/\bgerente\b|representacion legal|representante legal/.test(r) && !/suplente/.test(r)); };
  // Firmante con grupo "D" en el resumen = el presidente, con todas las facultades (firma individual). Si no figura en
  // ningún poder, se arma un poder con él para el bastanteo y el control.
  // Presidente: el de la última acta de directorio (actas de Complif o del PDF), o el firmante "D" o "(Presidente)" del resumen.
  function presidentesDeActas(actas) {
    const l = [].concat(actas || []).filter(a => a && a.autoridades).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    // La última acta de cada empresa (Complif vincula actas de empresas del mismo grupo): se juntan sus presidentes.
    const vistas = new Set(), out = [];
    for (const a of l) {
      const k = razonClave(a.razon_social || '');
      if (vistas.has(k)) continue;
      const p = a.autoridades.filter(x => esPresidente(x.rol));
      if (p.length) { vistas.add(k); out.push(...p); }
    }
    return out;
  }
  function poderesFirmantesD(cliente, poderes, actas) {
    const pres = presidentesDeActas(actas);
    return ((cliente && cliente.firmantes) || []).filter(f => !f.revocado
      // "D" es el presidente cuando firma individual (o lo dice el texto / el acta). "D CONJUNTA: A+D, B+D…" con varios
      // firmantes es un grupo D de un poder, no el presidente.
      && ((f.uso && f.uso.grupo === 'D' && !(f.uso.tipos || [f.uso.tipo]).every(t => t === 'CONJUNTA')) || /\bpresident[ea]\b|\bsocio\s+gerente\b/i.test(f.observacion || '')
        || pres.some(p => firmanteDe(p, [f])) || ((cliente && cliente.presidentes) || []).some(p => firmanteDe({ nombre_completo: p }, [f])))
      && !(poderes || []).some(p => p.apoderados.some(a => firmanteDe(a, [f])))).map(f => {
      const letra = (f.uso && f.uso.grupo) || 'D';
      const persona = { nombre_completo: f.nombre, dni: f.dni || '', cuit: f.cuit || '', grupo: letra };
      const u = { tipo: 'INDIVIDUAL', descripcion: 'Presidente: todas las facultades', limitaciones: null, grupo: letra, grupos: [letra], combinaciones: [letra],
        facultades: Object.fromEntries(BASTANTEO_CLAVES.map(k => [k, true])) };
      return { razon_social: cliente.cliente || '', cuit_empresa: cliente.cuit || '', fecha_emision: null, otorgante: { nombre_completo: f.nombre, dni: f.dni || '', fecha_nacimiento: null },
        apoderados: [persona], usos: [u], presidente: persona, porFirmanteD: true };
    });
  }

  // Sin "Acreditación de Poderes": poder armado con el presidente del acta, con todas las facultades.
  function poderDelPresidente(actas) {
    for (const acta of [].concat(actas || []).reverse()) {
      const pres = acta.autoridades.find(a => esPresidente(a.rol));
      if (!pres) continue;
      const persona = { nombre_completo: pres.nombre_completo, dni: pres.dni, grupo: null };
      return {
        razon_social: acta.razon_social, cuit_empresa: acta.cuit_empresa, fecha_emision: acta.fecha,
        otorgante: { nombre_completo: pres.nombre_completo, dni: pres.dni, fecha_nacimiento: null },
        apoderados: [persona],
        usos: [{ tipo: 'INDIVIDUAL', descripcion: pres.rol + ' según el acta del ' + (acta.fecha || 's/f') + ': todas las facultades (el PDF no trae acreditación de poderes)', limitaciones: null,
          facultades: Object.fromEntries(BASTANTEO_CLAVES.map(k => [k, true])) }],
        presidente: persona, porActa: true,
      };
    }
    return null;
  }

  // Grupos y combinaciones de firma de un uso, según su descripción (y sus limitaciones). Contempla:
  //  - combinaciones explícitas "A+A, A+B, B+B+C" (en la descripción o las limitaciones): mandan;
  //  - cláusulas separadas por "o" / "y/o" / ";": "Dos del Grupo A, o uno del A con uno del B, o dos del B con uno
  //    del C" → A+A, A+B, B+B+C;
  //  - en cada cláusula, integrantes unidos por "con", "junto con", "+", "y uno/otro…": cada uno con su cantidad
  //    (un/uno/una/otro = 1, dos/ambos/2 = 2, tres/3 = 3…) y sus grupos alternativos ("uno del Grupo B o C");
  //  - un solo grupo sin cantidad en una firma conjunta ("Grupo B conjuntamente") → B+B; "tres del Grupo A" → A+A+A;
  //  - "dos cualesquiera de los Grupos A, B y C" → todos los pares entre esos grupos;
  //  - "con el Presidente" → grupo + D; letras sin rótulo "A y B", "A + B", "un A con un B"; texto en mayúsculas.
  // Sin grupo en la descripción: grupo null (los grupos se arman por facultades).
  const RE_ETIQUETA = '(?:[Gg]rupos?|GRUPOS?|[Cc]ategor[ií]as?|CATEGOR[IÍ]AS?|[Cc]lases?|CLASES?)';
  const RE_SEP = '(?:,|\\b[oOyYuU]\\b|\\b[yY]\\s*\\/\\s*[oO]\\b|\\/|-)';
  const RE_CUANTO = '(?:[Uu]n[oa]?|U[Nn][OoAa]?|[Oo]tr[oa]|O[Tt][Rr][OoAa]|[Dd]os|DOS|[Tt]res|TRES|[Cc]uatro|CUATRO|[Aa]mbos|AMBOS)';
  function letrasDe(texto) {
    // "Categoría B o C", "Grupos A, B y C", "Grupo A / Grupo B", "GRUPO A Y GRUPO B".
    const re = new RegExp(`\\b${RE_ETIQUETA}\\s+([A-Z0-9]{1,2})\\b((?:\\s*${RE_SEP}\\s*(?:${RE_ETIQUETA}\\s+)?[A-Z0-9]\\b(?!\\.))*)`, 'g');
    const sig = new RegExp(`${RE_SEP}\\s*(?:${RE_ETIQUETA}\\s+)?([A-Z0-9])\\b`, 'g');
    let out = [];
    for (const m of texto.matchAll(re)) out.push(m[1], ...[...m[2].matchAll(sig)].map(x => x[1]));
    // "un A con un B", "dos B".
    if (!out.length) out = [...texto.matchAll(new RegExp(`\\b${RE_CUANTO}\\s+([A-Z])\\b`, 'g'))].map(m => m[1]);
    // Letras sin rótulo: "A y B", "A + B", "A con B", "A, B o C".
    if (!out.length) {
      const m = texto.match(/(?:^|[\s(])([A-Z])((?:\s*(?:,|\+|\b[yYoOeE]\b|\bcon\b|\bCON\b)\s*[A-Z])+)\b(?![a-záéíóúñ])/);
      if (m) out = [m[1], ...[...m[2].matchAll(/(?:,|\+|\b[yYoOeE]\b|\bcon\b|\bCON\b)\s*([A-Z])/g)].map(x => x[1])];
    }
    return out.map(x => x.toUpperCase());
  }
  // Cantidad de firmantes de un integrante ("dos del Grupo B" → 2; sin cantidad → null).
  function cuantosDe(t) {
    // La cantidad más cercana antes del grupo ("Dos firmas: una del Grupo A" → 1).
    const ms = [...String(t).matchAll(/\b(un|uno|una|otro|otra|dos|ambos|tres|cuatro|1|2|3|4)\b(?!\s*[.,]\d)/gi)];
    const g = String(t).search(new RegExp(`\\b${RE_ETIQUETA}\\s+[A-Z0-9]|\\b[A-Z]\\b`));
    const m = ms.filter(x => g < 0 || x.index < g).pop() || ms[0];
    if (!m) return null;
    return { un: 1, uno: 1, una: 1, otro: 1, otra: 1, 1: 1, dos: 2, ambos: 2, 2: 2, tres: 3, 3: 3, cuatro: 4, 4: 4 }[m[1].toLowerCase()];
  }
  // Combinaciones de una cláusula, leída como una pequeña gramática:
  //   alternativas (separadas por "o", "/", ";") de integrantes (unidos por "con", "+", "y", "junto con"), cada uno
  //   con su cantidad ("dos del Grupo B") y sus grupos posibles ("uno del Grupo B o C", "Grupo I/II/III").
  // Casos: "Grupo B + Grupo A o Grupo B + Grupo B" → A+B, B+B; "Grupo A con Grupo B o con Grupo C" → A+B, A+C;
  // "Grupo A (dos cualesquiera) o indistinta con Grupo B" → A+A, A+B; "Grupo I con Grupo I (dos integrantes)" → I+I;
  // "2 apoderados de Grupo A + Grupo B" → A+B (el 2 es el total); "Grupo 1 (dos) + Grupo 2 (uno)" → 1+1+2;
  // lo que está entre paréntesis y nombra grupos es otra alternativa: "Grupo A (2 de A) o (1 de A + 1 de B)".
  // Las palabras se escriben sin distinguir mayúsculas, pero las letras de grupo tienen que ser mayúsculas ("Grupo A",
  // no "grupo a la vez"): la expresión no usa la bandera i y cada palabra se arma con ci().
  const ci = w => w.split('').map(ch => ch === ' ' ? '\\s+' : ch.toLowerCase() !== ch.toUpperCase() ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch).join('');
  const cis = l => '(?:' + l.map(ci).join('|') + ')';
  const RE_GX = '(?:IV|VI{1,3}|IX|I{2,3}|\\d{1,2}|[A-Z])(?![\\wÁÉÍÓÚáéíóúÑñ-])';
  const NUM = { un: 1, uno: 1, una: 1, otro: 1, otra: 1, dos: 2, ambos: 2, tres: 3, cuatro: 4 };
  const RE_NUM = `(?:${cis(Object.keys(NUM))}|[1-4](?![\\d.,%]))`;
  const RE_SUST = cis(['apoderados', 'apoderado', 'apoderadas', 'apoderada', 'firmas', 'firma', 'integrantes', 'integrante', 'miembros', 'miembro', 'mandatarios', 'mandatario', 'del', 'de', 'los', 'las', 'la', 'el']);
  const numDe = t => NUM[t.toLowerCase()] || Number(t);
  function tokensDe(s, sueltas = false) {
    const etq = RE_ETIQUETA, b = '(?<![\\wÁÉÍÓÚáéíóúÑñ])', f = '(?![\\wÁÉÍÓÚáéíóúÑñ])';
    // Un elemento de lista no es una cantidad ("Grupo 1 y 1 del Grupo 2").
    const noCant = `(?!\\s+${RE_SUST}${f})`;
    const sepLista = `(?:,|\\/|${b}${ci('y')}\\s*\\/\\s*${ci('o')}${f}|${b}[oOyYuUeE]${f})`;
    const re = new RegExp([
      // "de cualquier otro Grupo", "de otro Grupo distinto" (= un grupo distinto de los demás) / "de cualquier Grupo".
      `${b}(?<comodin>(?:${cis(['cualquier', 'cualquiera'])}\\s+(?:${cis(['de los', 'del'])}\\s+)?)?(?:${cis(['otro', 'otros'])}\\s+)?${etq}(?:\\s+${cis(['distinto', 'distintos', 'diferente'])})?)(?!\\s+(?:${ci('tipo')}\\s+)?${RE_GX})(?=[\\s,;.)]|$)`,
      `${b}${etq}\\s+(?:${ci('tipo')}\\s+)?(?<g>${RE_GX})(?<lista>(?:\\s*${sepLista}\\s*(?:${etq}\\s+)?${RE_GX}${noCant})*)`, // Grupo X (o lista "B o C", "A y B", "I/II")
      `${b}(?<ng>${RE_NUM})\\s+(?:${RE_SUST}\\s+)*(?<gn>${RE_GX})(?=\\s|$|[,;)+.])`, // dos del A / 2 Firma A
      `${b}(?<n>${RE_NUM})${f}`,
      `${b}(?<j>${cis(['junto con', 'conjuntamente con', 'con', 'más', 'mas'])})${f}|(?<mas>\\+)`,
      `${b}(?<o>${cis(['o bien', 'o', 'u', 'ó'])}|${ci('y')}\\s*\\/\\s*${ci('o')})${f}|(?<barra>\\/)`,
      `${b}(?<y>[yYeE])${f}`,
      `(?<s>;)`, `(?<c>,)`,
      `⟨(?<p>\\d)⟩`,
      sueltas ? `${b}(?<l>[A-Z])(?![\\wÁÉÍÓÚáéíóúÑñ.-])` : '(?<l>(?!))', // (no iniciales: "J.A. Salvochea")
    ].join('|'), 'g');
    const out = [];
    for (const m of s.matchAll(re)) {
      const g = m.groups;
      if (g.comodin != null) {
        // Solo cuenta si dice "cualquier" u "otro" (un "Grupo" suelto no es un comodín).
        if (/cualquier|otro|distint|diferente/i.test(g.comodin)) out.push({ t: 'G', v: /otro|distint|diferente/i.test(g.comodin) ? '*' : '?' });
      } else if (g.g != null) {
        out.push({ t: 'G', v: g.g });
        // Lista: "," "/" "o" = otro grupo posible del mismo integrante; "y" = otro integrante.
        // Con rótulo propio ("Grupo A o Grupo B + …") la "o" puede abrir otra combinación: decide la gramática.
        for (const x of (g.lista || '').matchAll(new RegExp(`(${sepLista})\\s*(${etq}\\s+)?(${RE_GX})${noCant}`, 'g')))
          out.push(/^[yYeE]$/.test(x[1]) ? { t: 'J' } : x[2] ? { t: 'O' } : { t: 'A' }, { t: 'G', v: x[3] });
      } else if (g.ng != null) out.push({ t: 'N', v: numDe(g.ng) }, { t: 'G', v: g.gn });
      else if (g.n != null) out.push({ t: 'N', v: numDe(g.n) });
      else if (g.j != null || g.mas != null || g.y != null) out.push({ t: 'J' });
      else if (g.o != null || g.barra != null) out.push({ t: 'O' });
      else if (g.s != null) out.push({ t: 'S' });
      else if (g.c != null) out.push({ t: 'C' });
      else if (g.p != null) out.push({ t: 'P', v: Number(g.p) });
      else if (g.l != null) out.push({ t: 'G', v: g.l });
    }
    return out;
  }
  function combosDeClausula(c, minimo = 2) {
    const res = [];
    // Paréntesis: si nombran grupos son otra alternativa; si solo dicen una cantidad ("(dos)", "(2)") quedan como marca.
    let s = String(c);
    for (let i = 0; i < 3 && /\([^()]*\)/.test(s); i++) {
      s = s.replace(/\(([^()]*)\)/g, (x, inner) => {
        const sub = inner.replace(/^\s*(?:o|y\s*\/\s*o|o\s+bien)\s+/i, '');
        const ts = tokensDe(sub);
        // "(entre sí o con Grupo A)", "(…, o … con Clase C)": sigue la frase de afuera ("Grupo C … o con Grupo A").
        const primero = ts.find(t => t.t !== 'C' && t.t !== 'O');
        if (ts.some(t => t.t === 'G') && primero && primero.t === 'J') return ' o ' + sub.replace(/^[^]*?(?=\b(?:junto\s+con|conjuntamente\s+con|con)\b)/i, '') + ' ';
        if (ts.some(t => t.t === 'G')) { combosDeClausula(sub, minimo).forEach(r => res.push(r)); return ' ; '; }
        const n = inner.match(new RegExp(`^\\s*(?:${RE_NUM})(?![\\wÁÉÍÓÚáéíóúÑñ])`));
        return n ? ` ⟨${numDe(n[0].trim())}⟩ ` : ' ';
      });
    }
    let tk = tokensDe(s);
    if (!tk.some(t => t.t === 'G')) tk = tokensDe(s, true);
    let alt = [], ult = null, union = false, pend = null;
    const cerrar = () => {
      if (!alt.length) return;
      const m = alt.map(x => ({ gs: [...new Set(x.gs)], n: x.n }));
      // "2 apoderados de Grupo A + Grupo B": la cantidad inicial es el total de firmantes.
      if (m.length > 1 && !alt[0].fijo && m[0].n === m.length && m.slice(1).every(x => x.n == null)) m[0].n = 1;
      if (m.length === 1) m[0].n = Math.max(m[0].n || minimo, minimo);
      let r = [[]];
      m.forEach(x => { r = r.flatMap(p => x.gs.map(g => [...p, ...Array(x.n || 1).fill(g)])); });
      // Un integrante con varios grupos posibles y cantidad 2 ("dos del Grupo A o B"): sin repetir el mismo par.
      r.forEach(p => res.push(p.slice().sort()));
      alt = []; ult = null; union = false; pend = null;
    };
    const siguiente = i => tk.slice(i + 1).find(t => t.t !== 'C');
    const hayUnionAntesDeOtra = i => { for (let k = i + 1; k < tk.length; k++) { if (tk[k].t === 'O' || tk[k].t === 'S') return false; if (tk[k].t === 'J') return true; } return false; };
    tk.forEach((t, i) => {
      if (t.t === 'S') { cerrar(); return; }
      if (t.t === 'N') { pend = t.v; return; }
      // "(dos)" detrás de un grupo es su cantidad; "(dos integrantes)" detrás de "Grupo I con Grupo I" es el total.
      if (t.t === 'P') { if (ult && (alt.length === 1 || t.v !== alt.length)) { ult.n = t.v; ult.fijo = true; } return; }
      if (t.t === 'J') { union = true; return; }
      if (t.t === 'A') { if (ult) ult.alterna = true; return; }
      if (t.t === 'G') {
        if (ult && !union && ult.gs.includes(t.v) && pend == null) return;            // "Grupo A (2 de A)"
        if (ult && !union && pend == null && ult.alterna) { ult.gs.push(t.v); ult.alterna = false; return; }
        if (ult && !union && ult.gs.includes(t.v) && pend != null) { ult.n = pend; pend = null; return; }
        // Sin "con" y con un grupo ya nombrado: es la misma regla dicha de nuevo ("Grupo A (…) + Grupo B (…) - uno de A
        // con uno de B"): otra alternativa.
        if (!union && alt.some(x => x.gs.includes(t.v))) { const p = pend; cerrar(); pend = p; }
        ult = { gs: [t.v], n: pend }; alt.push(ult); pend = null; union = false; return;
      }
      if (t.t === 'O' || t.t === 'C') {
        const sig = siguiente(i);
        if (!sig || !alt.length) return;
        if (sig.t === 'N') { cerrar(); return; }
        if (sig.t === 'J' && t.t === 'O') {
          // "Grupo A con Grupo B o con Grupo C": otra alternativa con los mismos integrantes salvo el último.
          const base = alt.length > 1 ? alt.slice(0, -1).map(x => Object.assign({}, x)) : [{ gs: alt[0].gs.slice(), n: 1 }];
          cerrar(); alt = base; ult = alt[alt.length - 1]; return;
        }
        if (sig.t === 'G') {
          if (t.t === 'O' && hayUnionAntesDeOtra(i)) { cerrar(); return; }
          if (ult) ult.alterna = true;
        }
      }
    });
    cerrar();
    return res;
  }
  // Uso de firma tal como queda en el bastanteo: corrige el tipo cuando la descripción lo contradice (Complif a veces
  // marca INDIVIDUAL "Dos cualesquiera conjunta e indistinta") y separa los usos mixtos ("Grupo A individual, o dos de
  // Grupo B conjuntos, o uno de Grupo B con uno de Grupo C") en uno individual y uno conjunto.
  // "Firma 2: …", "Uso 3 - …": numeración del uso, no una cantidad de firmantes.
  const sinNumeracion = t => String(t || '').replace(/^\s*(?:firma|uso(?:\s+de\s+firma)?|estructura|esquema)\s+\d+\s*[:\-–.]\s*/i, '');
  function usoCompleto(u) {
    const d = sinNumeracion(u.descripcion);
    // "conjunta e indistinta" = dos cualesquiera en conjunto; "conjunta o indistinta" / "y/o" = cualquiera de las dos formas.
    const plano = t => String(t).replace(/conjunta(mente)?\s+e\s+indistinta(mente)?/gi, 'conjunta');
    const RE_IND = /individual|indistint|separad|alternad/i, RE_CONJ = /conjunt/i;
    const esConj = c => { const t = tokensDe(c); return RE_CONJ.test(plano(c)) || t.some(x => x.t === 'J') || t.some(x => x.t === 'N' && x.v >= 2); };
    const esInd = c => RE_IND.test(plano(c)) && !esConj(c);
    let tipo = String(u.tipo || '').toUpperCase();
    // Cláusulas (fuera de paréntesis) separadas por "o" / ";".
    const partes = [];
    let desde = 0;
    for (const m of d.matchAll(/;|,?\s+(?:o|u|ó)\s+(?=(?:dos|tres|un|uno|una|ambos|cualquier|grupo|categor|clase|[A-Z]\b|[1-4]\b))/gi)) {
      const antes = d.slice(0, m.index);
      if ((antes.match(/\(/g) || []).length > (antes.match(/\)/g) || []).length) continue;
      partes.push(d.slice(desde, m.index)); desde = m.index + m[0].length;
    }
    partes.push(d.slice(desde));
    const ind = partes.filter(esInd), conj = partes.filter(c => !esInd(c) && esConj(c));
    if (ind.length && conj.length && tokensDe(ind.join(' ')).some(t => t.t === 'G') && tokensDe(conj.join(' ')).some(t => t.t === 'G')) {
      const parte = (tp, txt) => { const v = Object.assign({}, u, { tipo: tp, descripcion: txt }); Object.assign(v, gruposDelUso(v)); v.descripcion = u.descripcion; v.parte = txt; return v; };
      return [parte('INDIVIDUAL', ind.join(' o ')), parte('CONJUNTA', conj.join(' o '))];
    }
    const pd = plano(d);
    if (/INDIVIDUAL|INDISTINTA/.test(tipo) && !RE_IND.test(pd) && esConj(d)) tipo = 'CONJUNTA';
    else if (/CONJUNTA/.test(tipo) && RE_IND.test(pd) && !esConj(d)) tipo = 'INDIVIDUAL';
    if (tipo && tipo !== String(u.tipo || '').toUpperCase()) { u.tipoOriginal = u.tipo; u.tipo = tipo; }
    return [Object.assign(u, gruposDelUso(u))];
  }
  function gruposDelUso(u) {
    const d = sinNumeracion(u.descripcion), lim = String(u.limitaciones || '');
    const conjunta = /CONJUNTA/.test(u.tipo || '');
    const combo = l => l.slice().sort().join('+');
    const unicos = l => [...new Set(l)].sort();
    // Firma conjunta "con el Presidente": el presidente es el grupo D (A + Presidente → A+D).
    if (conjunta && /\bpresident[ea]\b/i.test(d)) {
      const gp = unicos(letrasDe(d).filter(x => x !== 'D'));
      return { grupo: gp[0] || null, grupos: gp, combinaciones: gp.map(x => x + '+D'), conPresidente: true };
    }
    const todas = letrasDe(d);
    if (!conjunta) {
      if (!todas.length) return { grupo: null, grupos: [], combinaciones: [] };
      // Individual: vale para todos los grupos que nombra ("cualquier apoderado de Grupo A o Grupo B").
      const grupos = unicos(todas);
      return { grupo: todas[0], grupos, combinaciones: grupos };
    }
    // 1) Combinaciones explícitas ("A+B", "B + B + C").
    let combos = unicos([...`${d} ${lim}`.matchAll(/\b[A-Z](?:\s*\+\s*[A-Z])+\b/g)].map(m => combo(m[0].replace(/\s/g, '').split('+'))));
    // Junto a las explícitas: "2 de A, o A+B, o A+C, o 2 de C" → también A+A y C+C.
    if (combos.length) [...d.matchAll(/\b(dos|2|tres|3)\s+(?:del?\s+)?(?:(?:los|las)\s+)?(?:apoderad[oa]s\s+)?(?:(?:del?\s+)?(?:grupo|clase|categor[ií]a)\s+)?([A-Z])\b(?!\s*\+)/gi)]
      .filter(m => /[A-Z]/.test(m[2]) && m[2] === m[2].toUpperCase()).forEach(m => combos.push(combo(Array(/tres|3/i.test(m[1]) ? 3 : 2).fill(m[2]))));
    combos = unicos(combos);
    // 2) Cláusulas.
    if (!combos.length) {
      const RE_INICIO = '(?=(?:dos|tres|cuatro|un|uno|una|ambos|cualquier|al menos|de a|1|2|3|4)\\b)';
      // Cortes fuera de los paréntesis ("Grupo A (2 de A, o 1 de A + 1 de B)" queda entero).
      const clausulas = [];
      let desde = 0;
      for (const m of d.matchAll(new RegExp(`;|,?\\s+(?:y\\s*\\/\\s*o|o|u|ó)\\s+${RE_INICIO}`, 'gi'))) {
        const antes = d.slice(0, m.index);
        if ((antes.match(/\(/g) || []).length > (antes.match(/\)/g) || []).length) continue;
        clausulas.push(d.slice(desde, m.index)); desde = m.index + m[0].length;
      }
      clausulas.push(d.slice(desde));
      // Todos los multiconjuntos de tamaño n con esas letras.
      const multis = (ls, n, desde = 0) => n === 0 ? [[]] : ls.slice(desde).flatMap((x, i) => multis(ls, n - 1, desde + i).map(r => [x, ...r]));
      clausulas.forEach(c => {
        const l = letrasDe(c);
        if (!l.length && !tokensDe(c).some(t => t.t === 'G') && !tokensDe(c, true).some(t => t.t === 'G')) return;
        const ls = [...new Set(l)];
        const n = cuantosDe(c);
        // "Dos cualesquiera de los Grupos A, B y C": todas las combinaciones posibles entre esos grupos.
        if (ls.length > 1 && /\b(cualesquiera|cualquiera|indistintamente)\b/i.test(c) && !/\bcon\b|\+/i.test(c)) { multis(ls, Math.max(n || 2, 2)).forEach(r => combos.push(combo(r))); return; }
        combosDeClausula(c).forEach(r => combos.push(combo(r)));
      });
      combos = unicos(combos);
    }
    if (!combos.length) return { grupo: todas[0] || null, grupos: unicos(todas), combinaciones: [] };
    const grupos = unicos(combos.flatMap(c => c.split('+')).filter(x => x !== '*' && x !== '?'));
    return { grupo: todas[0] || grupos[0], grupos, combinaciones: combos };
  }

  // ------------------------------------------------------------ COMPLIF
  // Documentos de GET /api/documents/v1/organization (type = "Poder", "Poder Complejo", "Acta de designación de
  // autoridades"; document_type = PODER_COMPLEJO_AR, ACTA_DESIGNACION_AUTORIDADES_AR…). Lo que extrajo el OCR viene en
  // ocr_data_responses; se busca adentro el objeto con apoderados / estructuras de firma (mismo modelo que el JSON del
  // bastanteo) o la lista de autoridades del acta.
  // El Estatuto trae las autoridades de la sociedad ("directors": presidente, gerentes…): se usa como un acta.
  const COMPLIF_TIPOS = ['Poder', 'Poder Complejo', 'Acta de designación de autoridades', 'Estatuto'];
  function complifJson(v) {
    if (typeof v === 'string' && /^\s*[\[{]/.test(v)) { try { return JSON.parse(v); } catch (e) { return v; } }
    return v;
  }
  function complifBuscar(v, prueba, prof = 0) {
    v = complifJson(v);
    if (!v || typeof v !== 'object' || prof > 7) return null;
    if (prueba(v)) return v;
    for (const x of Array.isArray(v) ? v : Object.values(v)) { const r = complifBuscar(x, prueba, prof + 1); if (r) return r; }
    return null;
  }
  const complifEsActa = doc => /acta de designaci|^estatuto/i.test(doc.type || '') || /ACTA_DESIGNACION|ESTATUTO/i.test(doc.document_type || '');
  const complifEsPoder = doc => !complifEsActa(doc) && (/^poder/i.test(doc.type || '') || /^PODER/i.test(doc.document_type || ''));
  const complifNumero = v => String(v == null ? '' : v).replace(/\D/g, '');
  const complifDni = v => { const d = complifNumero(v); return d.length === 11 ? d.slice(2, 10).replace(/^0+/, '') : d; };
  const complifSiNo = v => v === true || /^(s[ií]|true|1|yes)$/i.test(String(v == null ? '' : v).trim());
  // Primer valor de texto con alguna de esas claves (en cualquier nivel).
  function complifCampo(obj, claves) {
    const o = complifBuscar(obj, x => !Array.isArray(x) && claves.some(k => x[k] != null && String(x[k]).trim() !== '' && typeof x[k] !== 'object'));
    if (!o) return '';
    const k = claves.find(c => o[c] != null && String(o[c]).trim() !== '' && typeof o[c] !== 'object');
    return String(o[k]).trim();
  }
  // Valor de la primera clave de un objeto que cumpla la expresión (plantillas con nombres en inglés).
  const complifValor = (o, re) => { const k = Object.keys(o || {}).find(c => re.test(c) && o[c] != null && typeof o[c] !== 'object'); return k ? String(o[k]).trim() : ''; };
  const RE_NOMBRE = /^(nombre_completo|full_name|name|nombre)$/i, RE_ID = /identificaci|dni|document|id_number|cuit|cuil|tax/i;
  // Plantilla "Poder" (simple): principal (otorgante), authorized_agents (apoderados), company_name, issue_date.
  // Vencimiento del poder en Complif (expiration_date del documento o fecha_vencimiento del OCR). 2199-12-31 = sin vencimiento.
  function vencimientoComplif(doc) {
    const v = String((doc && doc.expiration_date) || (doc && doc.ocr_data_responses && doc.ocr_data_responses.fecha_vencimiento) || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < '2199-01-01' ? v : null;
  }
  function poderSimpleComplif(doc) {
    const ocr = complifBuscar(doc.ocr_data_responses != null ? doc.ocr_data_responses : doc, x => !Array.isArray(x) && Array.isArray(complifJson(x.authorized_agents)));
    if (!ocr) return null;
    const pr = complifJson(ocr.principal) || {};
    const persona = a => { a = typeof a === 'object' && a ? a : { name: String(a || '') }; const id = complifValor(a, RE_ID);
      return { nombre_completo: complifValor(a, RE_NOMBRE) || complifValor(a, /name|nombre/i), dni: complifDni(id), cuit: complifNumero(id).length === 11 ? complifNumero(id) : '', grupo: complifValor(a, /^(grupo|group)$/i).toUpperCase() || null }; };
    const otorg = persona(pr);
    const u = { descripcion: complifValor(ocr, /signature|firma/i), tipo: /conjunt|joint/i.test(JSON.stringify(ocr)) && !/individual|indistint/i.test(JSON.stringify(ocr)) ? 'CONJUNTA' : 'INDIVIDUAL', limitaciones: complifValor(ocr, /limit/i) || null, facultades: {} };
    return {
      razon_social: complifValor(ocr, /^(company_name|razon_social)$/i), cuit_empresa: complifNumero(complifValor(ocr, /cuit|tax/i)), fecha_emision: complifValor(ocr, /^(issue_date|fecha_emision)$/i) || null,
      deed_number: complifValor(ocr, /deed|escritura/i), board_resolution_power_attorney: '', power_attorney_type: '',
      otorgante: { nombre_completo: otorg.nombre_completo, dni: otorg.dni, fecha_nacimiento: null },
      apoderados: complifJson(ocr.authorized_agents).map(persona).filter(a => a.nombre_completo),
      usos: usoCompleto(u),
      simple: true,
      vencimiento: vencimientoComplif(doc),
      complif: { id: doc.id_document || doc.id || doc.uuid || null, type: doc.type || '', document_type: doc.document_type || '' },
    };
  }
  function poderDesdeComplif(doc) {
    const simple = poderSimpleComplif(doc);
    if (simple) return simple;
    const ocr = complifBuscar(doc.ocr_data_responses != null ? doc.ocr_data_responses : doc, x => !Array.isArray(x) && (Array.isArray(complifJson(x.apoderados)) || Array.isArray(complifJson(x.estructuras_de_firma))));
    if (!ocr) return null;
    const otorg = complifJson(ocr.otorgante) || {};
    const estructuras = complifJson(ocr.estructuras_de_firma);
    const usos = (Array.isArray(estructuras) && estructuras.length ? estructuras : [ocr]).flatMap(e => {
      const fac = complifJson(e.facultades) || {};
      const facultades = {};
      Object.keys(fac).forEach(k => { if (typeof fac[k] !== 'object') facultades[k] = complifSiNo(fac[k]); });
      const tipo = String(e.tipo_de_firma || (e.firma_conjunta ? 'CONJUNTA' : e.firma_individual ? 'INDIVIDUAL' : '')).toUpperCase();
      const u = { descripcion: e.estructura_de_firma || e.descripcion || '', tipo, limitaciones: e.limitaciones || null, limite_de_operacion: e.limite_de_operacion || null, facultades };
      return usoCompleto(u);
    });
    return {
      razon_social: ocr.razon_social || complifCampo(doc, ['razon_social', 'company_name']) || '',
      cuit_empresa: complifNumero(ocr.cuit_empresa || complifCampo(doc, ['cuit_empresa', 'cuit', 'tax_id'])),
      fecha_emision: ocr.fecha_emision || null,
      deed_number: ocr.deed_number != null ? String(ocr.deed_number) : '',
      board_resolution_power_attorney: ocr.board_resolution_power_attorney != null ? String(ocr.board_resolution_power_attorney) : '',
      alcance: complifJson(ocr.power_attorney_scope) || null,
      power_attorney_type: ocr.power_attorney_type || '',
      otorgante: { nombre_completo: otorg.nombre_completo || '', dni: complifDni(otorg.numero_de_identificacion), fecha_nacimiento: otorg.fecha_nacimiento || null },
      apoderados: (complifJson(ocr.apoderados) || []).map(a => ({ nombre_completo: a.nombre_completo || a.nombre || '', dni: complifDni(a.numero_de_identificacion || a.dni), cuit: complifNumero(a.numero_de_identificacion).length === 11 ? complifNumero(a.numero_de_identificacion) : '', grupo: a.grupo ? String(a.grupo).trim().toUpperCase() : null })),
      usos,
      vencimiento: vencimientoComplif(doc),
      complif: { id: doc.id_document || doc.id || doc.uuid || null, type: doc.type || '', document_type: doc.document_type || '' },
    };
  }
  // Acta de designación: lista de autoridades (nombre, identificación, rol / cargo).
  function actaDesdeComplif(doc) {
    const lista = complifBuscar(doc.ocr_data_responses != null ? doc.ocr_data_responses : doc, x => Array.isArray(x) && x.length && x.every(y => y && typeof y === 'object')
      && x.some(y => Object.keys(y).some(k => /nombre|name/i.test(k)) && Object.keys(y).some(k => /rol|cargo|role|position/i.test(k))));
    if (!lista) return null;
    const valor = (y, re) => { const k = Object.keys(y).find(c => re.test(c)); return k && y[k] != null ? String(y[k]).trim() : ''; };
    return {
      razon_social: complifCampo(doc.ocr_data_responses || doc, ['razon_social', 'company_name']), cuit_empresa: complifNumero(complifCampo(doc.ocr_data_responses || doc, ['cuit_empresa', 'cuit', 'tax_id'])),
      fecha: complifCampo(doc.ocr_data_responses || doc, ['fecha_del_documento', 'fecha_documento', 'fecha', 'document_date', 'issue_date', 'registration_date', 'incorporation_date']),
      estatuto: /^estatuto/i.test(doc.type || '') || undefined,
      autoridades: lista.map(y => ({ nombre_completo: valor(y, /nombre|name/i), dni: complifDni(valor(y, /identificaci|dni|document|numero|id_number|cuit|cuil|tax/i)), rol: valor(y, /rol|cargo|role|position|title/i) })).filter(a => a.nombre_completo),
      complif: { id: doc.id_document || doc.id || doc.uuid || null, type: doc.type || '', document_type: doc.document_type || '' },
    };
  }
  // Documentos de una empresa: por CUIT (el OCR no siempre lo trae) o por razón social (sin "S.A.", "SA", "SRL"…).
  // Abreviaturas de cooperativas ("PLURAL COOP DE CRED CONS Y VIV LTDA").
  const ABREV_RAZON = { coop: 'cooperativa', cred: 'credito', cons: 'consumo', viv: 'vivienda', serv: 'servicios', prov: 'provision' };
  const razonClave = t => normalizar(String(t || '').replace(/\((?:ex|antes)\b[^)]*\)|\s-\s*(?:ex|antes)\b.*$|\s-\s*cuenta cerrada.*$/i, ' ')).replace(/[.,]/g, ' ')
    .replace(/\b(s ?a ?u?|s ?r ?l|s ?a ?s|sociedad anonima|ltda|limitada|sa|srl|sas|sau)\b/g, ' ').replace(/\b(coop|cred|cons|viv|serv|prov)\b/g, w => ABREV_RAZON[w]).replace(/\s+/g, ' ').trim();
  // Palabras que pueden sobrar en una razón social sin que sea otra empresa ("… SOCIEDAD DE BOLSA", "… ALYC Y AN PROPIO").
  const RAZON_EXTRA = new Set(['compania', 'sociedad', 'de', 'del', 'la', 'el', 'y', 'bolsa', 'agente', 'agentes', 'liquidacion', 'compensacion', 'integral', 'alyc', 'an', 'propio',
    'negociacion', 'argentina', 'sucursal', 'anonima', 'colectiva', 'unipersonal', 'comercial', 'industrial', 'financiera', 'saic', 'saci', 'sacif', 'saicf', 'sacifi', 'saicfi', 'sh', 'scs', 'sca']);
  // Palabras comunes que solas no identifican a una empresa.
  const RAZON_GENERICA = new Set(['cooperativa', 'mercado', 'banco', 'grupo', 'inversiones', 'valores', 'capital', 'seguros', 'credito', 'consumo', 'vivienda',
    'servicios', 'asociacion', 'mutual', 'fondos', 'fondo', 'fideicomiso', 'securities', 'bursatil', 'financiera', 'argentina', 'asset', 'management', 'partners', 'holding']);
  const extraOk = w => RAZON_EXTRA.has(w) || w.length <= 2; // iniciales ("C.I.A.S.A.")
  const sinExtra = (corto, largo) => largo.split(' ').filter(w => w && !corto.split(' ').includes(w)).every(extraOk);
  // Razones sociales parecidas, con errores de tipeo ("INTERPRISE" / "ENTERPRISES"): cada palabra de la más corta está
  // en la otra, igual o a 2 letras de distancia (palabras de más de 4 letras).
  function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function razonParecida(a, b) {
    let x = a.split(' ').filter(Boolean), y = b.split(' ').filter(Boolean);
    if (x.length > y.length) [x, y] = [y, x];
    if (!x.length || x.join('').length < 6) return false;
    // Una palabra con letras agregadas adelante es otra palabra ("CAPITAL" / "INCAPITAL"); al final es un plural
    // ("SERVICE" / "SERVICES").
    const otra = (w, v) => { const [c, l] = w.length <= v.length ? [w, v] : [v, w]; return l.includes(c) && !l.startsWith(c); };
    // Una sola palabra: hasta 1 letra de diferencia ("CETROGAR" no es "METROGAS").
    const tope = x.length === 1 ? 1 : 2;
    const parecida = (w, v) => v === w || (w.length > 4 && v.length > 4 && !otra(w, v) && distancia(w, v) <= tope);
    // Las palabras de más en la razón más larga tienen que ser de forma ("SOCIEDAD DE BOLSA"), no otro nombre ("Y CIA").
    return x.every(w => y.some(v => parecida(w, v))) && y.filter(v => !x.some(w => parecida(w, v))).every(extraOk);
  }
  // ¿La razón social del Excel ("CLIENTE") corresponde al nombre del archivo? Un resumen copiado de otra empresa
  // conserva el CLIENTE de la original ("FIORITO FACTORING SA.xlsx" con CLIENTE "ABUT S.A"). Basta una palabra
  // distintiva en común, un prefijo ("BCO" / "BANCO") o la sigla ("CAMMESA").
  function razonDelArchivo(cliente, archivo) {
    const pal = t => razonClave(String(t || '').replace(/\.xlsx?$/i, '').replace(/[()_\-]/g, ' ')).split(' ').filter(w => w.length >= 2);
    const x = pal(cliente), y = pal(archivo);
    if (!x.length || !y.length) return true;
    if (x.join('') === y.join('')) return true;
    const dist = w => w.length >= 3 && !RAZON_EXTRA.has(w) && !RAZON_GENERICA.has(w);
    const igual = (w, v) => w === v || (w.length >= 3 && v.length >= 3 && (w.startsWith(v) || v.startsWith(w))) || (w.length > 4 && v.length > 4 && distancia(w, v) <= 1);
    if (x.some(w => dist(w) && y.some(v => dist(v) && igual(w, v)))) return true;
    // Sigla con sílabas ("FECOVITA" = FEderación de COoperativas VITivinícolas Argentinas).
    const silabas = (t, ws, usadas) => !t ? usadas >= 2 : ws.some((w, i) => [...Array(Math.min(w.length, t.length))].some((_, k) => t.startsWith(w.slice(0, k + 1)) && silabas(t.slice(k + 1), ws.slice(i + 1), usadas + 1)));
    if ((y.length === 1 && y[0].length >= 4 && silabas(y[0], x, 0)) || (x.length === 1 && x[0].length >= 4 && silabas(x[0], y, 0))) return true;
    const sigla = ws => ws.filter(w => !['de', 'del', 'la', 'el', 'y'].includes(w)).map(w => w[0]).join('');
    const jx = x.join(''), jy = y.join('');
    return [sigla(x), jx].some(a => a.length >= 3 && (a === sigla(y) || jy.includes(a))) || [sigla(y), jy].some(a => a.length >= 3 && jx.includes(a));
  }
  // Razón social de los documentos de Complif con ese CUIT (la del poder más usado), o ''.
  function razonPorCuit(docs, cuit) {
    const c = complifNumero(cuit);
    if (c.length !== 11) return '';
    const cuenta = new Map();
    (docs || []).forEach(doc => {
      const p = leidoDe(doc);
      if (!p || p.autoridades || p.cuit_empresa !== c || !p.razon_social) return;
      cuenta.set(p.razon_social, (cuenta.get(p.razon_social) || 0) + 1);
    });
    return [...cuenta].sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || '';
  }
  // Texto completo de un documento (para buscar el CUIT): se calcula una vez por documento (el chequeo masivo recorre
  // todos los documentos de Complif por cada empresa).
  const TEXTO_DOC = new WeakMap();
  const textoDoc = doc => { if (!TEXTO_DOC.has(doc)) TEXTO_DOC.set(doc, JSON.stringify(doc)); return TEXTO_DOC.get(doc); };
  const LEIDO_DOC = new WeakMap();
  const leidoDe = doc => { if (!LEIDO_DOC.has(doc)) LEIDO_DOC.set(doc, complifEsActa(doc) ? actaDesdeComplif(doc) : poderDesdeComplif(doc)); return LEIDO_DOC.get(doc); };
  function complifDeEmpresa(docs, cuit, nombre, opciones) {
    const soloCuit = !!(opciones && opciones.soloCuit);
    const c = complifNumero(cuit);
    // Sin razón social: la del primer documento que coincide por CUIT (así entran las actas, que no traen CUIT).
    if (!nombre && c.length === 11) {
      const d = (docs || []).find(x => JSON.stringify(x).includes(formatoCuit(c)) || JSON.stringify(x).includes(c));
      if (d) { const p = complifEsActa(d) ? actaDesdeComplif(d) : poderDesdeComplif(d); if (p) nombre = p.razon_social; }
    }
    const n = razonClave(nombre);
    // Alias entre paréntesis ("NSS SA (IPLAN)", "… SOCIEDAD ANONIMA (CAMMESA)"): también valen como nombre.
    // (Un alias genérico como "(COOPERATIVA LIMITADA)" no cuenta.)
    const alias = t => [...String(t || '').matchAll(/\(([^)]+)\)/g)].map(m => m[1]).filter(x => !/^\s*(ex|antes)\b/i.test(x)).map(x => razonClave(x))
      .filter(x => x.length >= 3 && !x.split(' ').every(w => RAZON_EXTRA.has(w) || RAZON_GENERICA.has(w)));
    const sinParen = t => razonClave(String(t || '').replace(/\([^)]*\)/g, ' '));
    const nombres = [...new Set([n, sinParen(nombre), ...alias(nombre)].filter(Boolean))];
    const mismaRazon = (dnTexto) => { const ds = [...new Set([razonClave(dnTexto), sinParen(dnTexto), ...alias(dnTexto)].filter(Boolean))];
      // Nombre de una sola palabra distintiva ("PLURALCOOP") que aparece como palabra en la razón del documento.
      const palabra = (a, b) => !a.includes(' ') && a.length >= 6 && !RAZON_GENERICA.has(a) && b.split(' ').includes(a);
      return nombres.some(a => ds.some(b => a === b || palabra(a, b) || palabra(b, a) || (a.length > 5 && b.length > 5 && ((b.includes(a) && sinExtra(a, b)) || (a.includes(b) && sinExtra(b, a)))) || razonParecida(a, b))); };
    const poderes = [], actas = [];
    // Vínculos de Complif (relations: id, name, type): un documento es de la empresa si está vinculado a ella, aunque el
    // OCR diga otra razón social (un poder otorgado por varias empresas). Se toman los vínculos de los documentos que
    // coinciden por CUIT y los que tienen el nombre de la empresa.
    const rels = doc => (Array.isArray(doc.relations) ? doc.relations : []).filter(x => x && typeof x === 'object');
    const relDeEmpresa = x => !!(n && x.name && mismaRazon(x.name));
    const idsEmpresa = new Set();
    (docs || []).forEach(doc => {
      const p0 = leidoDe(doc);
      // soloCuit (el Excel de una empresa con la razón social de otra): por nombre solo si el documento no es de otro CUIT.
      const otroCuit = x => soloCuit && c.length === 11 && complifNumero(x && x.cuit_empresa).length === 11 && complifNumero(x.cuit_empresa) !== c;
      const porCuit = (c && p0 && !p0.autoridades && p0.cuit_empresa === c) || (p0 && n && p0.razon_social && !otroCuit(p0) && mismaRazon(p0.razon_social));
      rels(doc).forEach(x => { if (x.id != null && (porCuit || relDeEmpresa(x))) idsEmpresa.add(String(x.id)); });
    });
    const vinculado = doc => rels(doc).some(x => (x.id != null && idsEmpresa.has(String(x.id))) || relDeEmpresa(x));
    (docs || []).forEach(doc => {
      const p0 = leidoDe(doc);
      if (!p0) return;
      // Copia: el resultado leído se reutiliza entre empresas y acá se le agregan datos.
      const p = structuredClone(p0);
      if (vinculado(doc)) { p.vinculado = true; p.complif.creado = doc.ocr_created_at || doc.created_at || ''; (p.autoridades ? actas : poderes).push(p); return; }
      const dc = p.cuit_empresa || complifNumero(complifCampo(doc, ['cuit_empresa', 'cuit', 'tax_id']));
      const dn = razonClave(p.razon_social || complifCampo(doc, ['razon_social', 'company_name']));
      // El CUIT se busca con guiones (30-70819244-5, como lo guarda Complif) y sin guiones, en cualquier campo del documento.
      const enDoc = c.length === 11 && (texto => texto.includes(formatoCuit(c)) || texto.includes(c))(textoDoc(doc));
      const dcOtro = soloCuit && c.length === 11 && complifNumero(dc).length === 11 && complifNumero(dc) !== c;
      if (!((c && (dc === c || enDoc)) || (n && dn && !dcOtro && mismaRazon(p.razon_social || complifCampo(doc, ['razon_social', 'company_name']))))) return;
      p.complif.creado = doc.ocr_created_at || doc.created_at || '';
      (p.autoridades ? actas : poderes).push(p);
    });
    // Complif puede tener el mismo poder más de una vez (subido de nuevo, o con la plantilla "Poder" y la "Poder
    // Complejo"): mismos apoderados y misma fecha = el mismo poder. Queda el Poder Complejo y, entre iguales, el último.
    const firma = p => (p.fecha_emision || '') + '|' + p.apoderados.map(a => a.dni || normalizar(a.nombre_completo)).sort().join(',');
    const unicos = new Map();
    poderes.forEach(p => {
      const k = firma(p), prev = unicos.get(k);
      const mejor = !prev || (prev.simple && !p.simple) || (!!prev.simple === !!p.simple && String(p.complif.creado) > String(prev.complif.creado));
      if (mejor) { if (prev) p.duplicados = (prev.duplicados || 0) + 1; unicos.set(k, p); } else prev.duplicados = (prev.duplicados || 0) + 1;
    });
    poderes.length = 0;
    unicos.forEach(p => poderes.push(p));
    poderes.sort((a, b) => String(a.fecha_emision || '').localeCompare(String(b.fecha_emision || '')));
    actas.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
    return { poderes, actas };
  }

  // Control firmante por firmante: el uso de firma del resumen (Excel) contra lo que dan los poderes (JSON único).
  // Puntos: tipo de firma, grupo, combinaciones conjuntas y límite.
  const TIENE_LIMITE = /(no exced|no superen?|hasta (la suma|un monto|u\$s|usd|\$)|monto m[aá]ximo|l[ií]mite de|tope)/i;
  // Una frase pone un límite de monto si habla de un tope y trae un importe ("hasta U$S 50.000", "no superen $3.000.000"),
  // y no es "sin límite de monto" ni "hasta la suma autorizada por el Banco".
  const RE_IMPORTE = /(\$|u\$s|usd|d[oó]lares|pesos|\b\d{1,3}(?:\.\d{3}){1,}\b|\b\d+\s*(?:mil|millones)\b)/i;
  const fraseConLimite = x => TIENE_LIMITE.test(x) && RE_IMPORTE.test(x) && !/\bsin\s+(l[ií]mite|limitaci[oó]n)\s+de\s+(tiempo\s+ni\s+de\s+)?(monto|montos|importe|cantidad)/i.test(x);
  const frasesDe = l => String(l).split(/(?<=[.;|])\s+(?=[A-ZÁÉÍÓÚ¡¿(])|\s+\|\s+/);
  const tieneLimite = l => frasesDe(l).some(fraseConLimite);
  // Grupos para comparar: "1"/"I" = A, "2"/"II" = B… (un poder numera los grupos y el resumen usa letras, o al revés).
  const GRUPO_EQUIV = { 1: 'A', I: 'A', 2: 'B', II: 'B', 3: 'C', III: 'C', 4: 'D', IV: 'D', 5: 'E', V: 'E', 6: 'F', VI: 'F' };
  const grupoComparable = g => GRUPO_EQUIV[g] || g;
  const comboComparable = c => c.split('+').map(grupoComparable).sort().join('+');
  function controlResumen(unico, cliente, actas, revocados) {
    const firmantes = (cliente && cliente.firmantes) || [];
    const presidentes = (actas ? presidentesDeActas(actas) : []).concat(((cliente && cliente.presidentes) || []).map(n => ({ nombre_completo: n })));
    const textoDe = (f, res) => `${res.texto || ''} ${f.observacion || ''}`;
    const base = firmantes.map(f => {
      const ids = [f.cuit, f.dni].filter(Boolean).map(x => String(Number(String(x).replace(/\D/g, ''))));
      const apo = (unico.apoderados || []).find(a => ids.includes(String(a.numero_de_identificacion)) || (a.numero_de_identificacion && ids.some(i => i.length <= 8 && String(a.numero_de_identificacion).slice(2, 10).replace(/^0+/, '') === i)))
        || (unico.apoderados || []).find(a => firmanteDe({ nombre_completo: a.nombre_completo }, [f]));
      const est = apo && !apo.advertencia ? unico.estructuras_de_firma.filter(e => e.apoderados.includes(apo.numero_de_identificacion)) : [];
      const res = f.uso || { grupo: '', tipo: '', tipos: [], combinaciones: [], texto: f.observacion || '' };
      return { f, est, res, apo };
    });
    // Equivalencia de grupos de la empresa: el resumen puede nombrar con otra letra (o con letras donde el poder usa
    // números) el mismo grupo. Se arma con los firmantes que tienen un solo grupo en el poder: números y romanos por
    // mayoría; letras solo si todos los firmantes de ese grupo coinciden y ninguna letra del resumen se repite.
    const votos = {};
    base.forEach(({ f, est, res }) => {
      if (!res.grupo || !est.length || est.every(e => e.grupoAutomatico) || /\bpresident/i.test(textoDe(f, res))) return;
      const gs = [...new Set(est.map(e => e.grupo).filter(Boolean))];
      if (gs.length !== 1) return;
      (votos[gs[0]] = votos[gs[0]] || {})[res.grupo] = (votos[gs[0]][res.grupo] || 0) + 1;
    });
    const equiv = {};
    Object.entries(votos).forEach(([g, v]) => {
      const tot = Object.values(v).reduce((x, y) => x + y, 0);
      const [letra, n] = Object.entries(v).sort((x, y) => y[1] - x[1])[0];
      if (letra === g) return;
      if (!/^[A-Z]$/.test(g)) { if (n / tot >= 0.6) equiv[g] = letra; return; }
      if (n === tot) equiv[g] = letra;
    });
    Object.keys(equiv).forEach(g => { if (/^[A-Z]$/.test(g) && Object.keys(equiv).some(h => h !== g && equiv[h] === equiv[g])) delete equiv[g]; });
    // No se traduce a una letra que ya es un grupo propio del poder (sería mezclar dos grupos distintos).
    const gruposPoder = new Set(base.flatMap(x => x.est.map(e => e.grupo)).filter(Boolean));
    Object.keys(equiv).forEach(g => { if (gruposPoder.has(equiv[g])) delete equiv[g]; });
    const trad = g => equiv[g] || grupoComparable(g);
    const tradCombo = c => c.split('+').map(trad).sort().join('+');
    // Grupos propios (de una sola persona) que el resumen pone en otro grupo: Bartolucci es el grupo B del poder y el
    // resumen lo pone en el A, así que para todos el B+A del poder es A+A.
    const unaPersona = g => new Set(unico.estructuras_de_firma.filter(e => e.grupo === g).flatMap(e => e.apoderados)).size <= 1;
    const propioComo = {};
    base.forEach(({ est, res }) => {
      if (!res.grupo) return;
      [...new Set(est.map(e => e.grupo))].forEach(g => {
        if (!g || grupoComparable(g) === grupoComparable(res.grupo) || !unaPersona(g)) return;
        propioComo[g] = propioComo[g] && propioComo[g] !== grupoComparable(res.grupo) ? null : grupoComparable(res.grupo);
      });
    });
    return base.map(({ f, est, res, apo }) => {
      const fila = { nombre: f.nombre, ident: f.cuit || f.dni, resumen: res.texto || '', monto_hasta: f.monto_hasta, puntos: [] };
      if (!est.length) {
        fila.sinPoder = true;
        fila.puntos.push(f.revocado ? { punto: 'Poder', ok: true, resumen: 'REVOCADO', poder: 'Sin poder vigente (revocado)' }
          : { punto: 'Poder', ok: false, resumen: res.texto || '—', poder: (r => r ? `Revocado: ${r}. No figura en los poderes vigentes` : 'No figura como apoderado en los poderes')(revocacionDe(f, revocados)) });
        return fila;
      }
      if (f.revocado) fila.puntos.push({ punto: 'Poder', ok: false, resumen: 'REVOCADO', poder: 'Tiene un poder vigente', detalle: 'el resumen lo da por revocado pero el poder sigue vigente' });
      // "D" / "(Presidente)" en el resumen: el presidente firma con todas las facultades aunque también sea apoderado.
      const dicePres = /\bpresident[ea]\b/i.test(textoDe(f, res));
      const presActa = presidentes.some(p => firmanteDe(p, [f]));
      // (Solo si el grupo del resumen no coincide con el de los poderes; si coincide, se controla como a cualquier firmante.)
      if ((res.grupo === 'D' || dicePres) && (presActa || dicePres) && !est.some(e => e.grupo === res.grupo)) {
        fila.presidente = true;
        fila.puntos.push({ punto: 'Grupo', ok: presActa ? true : null, resumen: res.grupo || 'Presidente',
          poder: presActa ? 'Presidente (o socio gerente) según el acta o el resumen: todas las facultades' : 'Presidente según el resumen (no está en las actas de Complif); en los poderes: grupo ' + [...new Set(est.map(e => e.grupo))].join(', ') });
        return fila;
      }
      const tipos = [...new Set(est.map(e => e.tipo_de_firma).filter(Boolean))];
      const grupos = [...new Set(est.map(e => e.grupo))];
      // Combinaciones que da el poder, también las que hoy no tienen firmantes en la planilla (B+C sin nadie del grupo C).
      const combos = [...new Set(est.filter(e => e.firma_conjunta).flatMap(e => (e.combinaciones || []).filter(c => c.includes('+'))))].sort();
      const combosSinFirmantes = [...new Set(est.filter(e => e.firma_conjunta).flatMap(e => (e.combinaciones_sin_firmantes || []).filter(c => c.includes('+'))))];
      // El límite se controla sobre la firma individual (en la conjunta no aplica).
      const estLim = est.some(e => !e.firma_conjunta) ? est.filter(e => !e.firma_conjunta) : est;
      const limites = [...new Set(estLim.map(e => e.limitaciones).filter(Boolean))];
      fila.poder = { tipos, grupos, combos, limites };
      // Tipos del resumen: puede dar los dos ("A INDIVIDUAL h/ $2.000.000 * A CONJUNTA A+A").
      const resTipos = res.tipos && res.tipos.length ? res.tipos : res.tipo ? [res.tipo] : [];
      const faltaTipo = resTipos.filter(t => !tipos.includes(t));
      // Si el poder le da firma individual, también puede firmar en conjunto: un resumen conjunto es más restrictivo.
      const masRestrictivo = faltaTipo.length === 1 && faltaTipo[0] === 'CONJUNTA' && tipos.includes('INDIVIDUAL');
      // El poder le da una firma individual restringida ("solo endoso para depósito", E-BANVAL) que quedó como limitación.
      const restringida = faltaTipo.length === 1 && faltaTipo[0] === 'INDIVIDUAL' && est.some(e => /Firma individual restringida/.test(e.limitaciones || ''));
      fila.puntos.push(restringida ? { punto: 'Uso de firma', ok: null, resumen: resTipos.join(' / '), poder: tipos.join(' / '), detalle: 'el poder solo le da una firma individual restringida (ver limitaciones)' }
        : masRestrictivo ? { punto: 'Uso de firma', ok: null, resumen: resTipos.join(' / '), poder: tipos.join(' / '), detalle: 'el poder le da firma individual; el resumen (conjunta) es más restrictivo' }
        : { punto: 'Uso de firma', ok: !resTipos.length ? null : !faltaTipo.length, resumen: resTipos.join(' / ') || '—', poder: tipos.join(' / ') || '—' });
      // Si el poder no asigna grupos, la letra la pone la página (por las facultades): no se compara.
      const grupoAuto = est.every(e => e.grupoAutomatico);
      // Grupos "propios" del firmante en el poder: tienen solo a él ("Bartolucci (B) con cualquiera del grupo A", o un poder
      // solo para él sin grupos). El resumen suele ponerlo en el grupo con el que firma ("A CONJUNTA A+A"): su B+A es A+A.
      const propiosPoder = res.grupo ? grupos.filter(g => grupoComparable(g) !== grupoComparable(res.grupo) && unaPersona(g)) : [];
      if (res.grupo) {
        const usados = grupos.filter(g => equiv[g] && equiv[g] !== g);
        const otros = apo && unico.otrosGrupos && unico.otrosGrupos[apo.numero_de_identificacion] ? [...unico.otrosGrupos[apo.numero_de_identificacion]] : [];
        const okOtro = !grupos.map(trad).includes(grupoComparable(res.grupo)) && otros.map(trad).includes(grupoComparable(res.grupo));
        const ok = grupos.includes(res.grupo) || grupos.map(trad).includes(grupoComparable(res.grupo)) || grupos.map(grupoComparable).includes(grupoComparable(res.grupo)) || okOtro;
        fila.puntos.push(grupoAuto ? { punto: 'Grupo', ok: null, resumen: res.grupo, poder: `No aplica: el poder no asigna grupos (letra ${grupos.join(', ')} puesta según las facultades)` }
          : !ok && propiosPoder.length === grupos.length ? { punto: 'Grupo', ok: null, resumen: res.grupo, poder: grupos.join(', '),
            detalle: `en el poder tiene un grupo propio (solo él: ${grupos.join(', ')}); el resumen lo pone en el grupo ${res.grupo}` }
          : ok && usados.length && !grupos.includes(res.grupo) ? { punto: 'Grupo', ok: /^[A-Z]$/.test(usados[0]) ? null : true, resumen: res.grupo, poder: grupos.join(', '),
            detalle: 'el resumen nombra ' + usados.map(g => `"${equiv[g]}" al grupo ${g} del poder`).join(' y ') }
          : okOtro ? { punto: 'Grupo', ok: true, resumen: res.grupo, poder: grupos.join(', ') + ' (y ' + otros.join(', ') + ' en otro poder)' }
          // También está en un poder que no asigna grupos (letra puesta por la página): la letra del resumen puede ser esa.
          : !ok && est.some(e => e.grupoAutomatico) ? { punto: 'Grupo', ok: null, resumen: res.grupo, poder: grupos.join(', '),
            detalle: 'uno de sus poderes no asigna grupos (letra ' + est.filter(e => e.grupoAutomatico).map(e => e.grupo).join(', ') + ' puesta según las facultades)' }
          : { punto: 'Grupo', ok, resumen: res.grupo, poder: grupos.join(', ') });
      }
      // Combinaciones: se controlan cuando el resumen da firma conjunta y las lista.
      if (!masRestrictivo && res.combinaciones.length) {
        // Grupos automáticos: no importa la letra sino la forma de la combinación (dos del mismo grupo o de grupos distintos).
        const forma = c => new Set(c.split('+')).size === 1 ? 'dos del mismo grupo' : 'de grupos distintos';
        // El resumen puede listar todas las combinaciones de la empresa: se miran las que incluyen el grupo del firmante.
        const propios = new Set([grupoComparable(res.grupo), ...grupos.map(trad)].filter(Boolean));
        const delFirmante = res.combinaciones.filter(c => comboComparable(c).split('+').some(x => propios.has(x)));
        const resLista = grupoAuto || !delFirmante.length ? res.combinaciones : delFirmante;
        const resC = grupoAuto ? [...new Set(resLista.map(forma))] : [...new Set(resLista.map(comboComparable))];
        // Se compara con y sin la equivalencia de letras, y vale la lectura que menos diferencias da.
        const podT = grupoAuto ? [...new Set(combos.map(forma))] : [...new Set(combos.map(tradCombo))];
        const podD = grupoAuto ? podT : [...new Set(combos.map(comboComparable))];
        const difs = pc => resC.filter(c => !pc.includes(c)).length;
        // Con sus grupos propios leídos como el grupo del resumen (B+A → A+A).
        const como = x => propiosPoder.includes(x) ? grupoComparable(res.grupo) : propioComo[x] || trad(x);
        const podP = !grupoAuto && combos.some(c => c.split('+').some(x => propiosPoder.includes(x) || propioComo[x])) ? [...new Set(combos.map(c => c.split('+').map(como).sort().join('+')))] : null;
        let podC = difs(podD) < difs(podT) ? podD : podT;
        const extra = pc => pc.filter(c => !resC.includes(c)).length;
        if (podP && (difs(podP) < difs(podC) || (difs(podP) === difs(podC) && extra(podP) < extra(podC)))) podC = podP;
        // Lo que el poder da aunque hoy no haya firmantes para armarlo (B+C sin nadie del grupo C) no es un "sobrante".
        const podNo = grupoAuto ? [] : podC === podP ? [] : combosSinFirmantes.map(podC === podD ? comboComparable : tradCombo);
        const sobran = resC.filter(c => !podC.includes(c) && !podNo.includes(c)), faltan = podC.filter(c => !resC.includes(c));
        // Que el poder dé más combinaciones que las que lista el resumen no es un error: el resumen es más restrictivo.
        fila.puntos.push({ punto: 'Firmas conjuntas', ok: sobran.length ? false : faltan.length ? null : true, resumen: res.combinaciones.join('; ') || '—',
          poder: (combos.join('; ') || '—') + (grupoAuto && combos.length ? ` (${podC.join(', ')}; letra puesta según las facultades)` : ''),
          detalle: [sobran.length ? 'el resumen incluye ' + sobran.join(', ') + ' que el poder no da' : '', faltan.length ? (sobran.length ? 'el poder también da ' : 'el resumen es más restrictivo: el poder también da ') + faltan.join(', ') : '',
            podC === podP ? 'grupo de una sola persona leído como el grupo donde la pone el resumen: ' + [...new Set(combos.flatMap(c => c.split('+')).filter(x => propiosPoder.includes(x) || propioComo[x]))].map(x => x + ' = ' + (propiosPoder.includes(x) ? grupoComparable(res.grupo) : propioComo[x])).join(', ') : ''].filter(Boolean).join('; ') });
      }
      // Firma conjunta: el límite del poder es para la firma individual, así que no se controla.
      const limiteRes = f.monto_hasta && f.monto_hasta < 99999999 ? f.monto_hasta : res.limite || null;
      if (resTipos.length ? !resTipos.includes('INDIVIDUAL') : (tipos.length && tipos.every(t => t === 'CONJUNTA'))) {
        fila.puntos.push({ punto: 'Límite', ok: null, resumen: limiteRes ? (res.limiteTexto || String(limiteRes)) : 'sin límite', poder: 'No aplica: firma conjunta (el límite es para la firma individual)' });
        return fila;
      }
      const sinLimite = !limiteRes;
      // Frases de límite que valen para este firmante: no las de la firma conjunta ni las que nombran a otro apoderado
      // ("Jorge Martín Amar tiene límite de $200.000").
      const otros = (unico.apoderados || []).filter(a => a !== apo && a.nombre_completo && !firmanteDe({ nombre_completo: a.nombre_completo }, [f]));
      const nombra = (x, nombre) => { const ps = palabrasNombre(nombre), t = ' ' + normalizar(x) + ' '; return ps.length >= 2 && ps.every(w => t.includes(' ' + w + ' ')); };
      const aplica = x => fraseConLimite(x) && !/conjunt/i.test(x) && (nombra(x, f.nombre) || !otros.some(a => nombra(x, a.nombre_completo)));
      const frasesLim = [...new Set(limites.flatMap(l => frasesDe(l).filter(aplica)))];
      const conLimite = frasesLim.length > 0;
      fila.puntos.push({ punto: 'Límite', ok: sinLimite === !conLimite ? true : (sinLimite ? false : null), resumen: sinLimite ? 'sin límite' : (res.limiteTexto || String(limiteRes)),
        poder: conLimite ? frasesLim.join(' | ') : 'sin límite en el poder' });
      return fila;
    });
  }

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
          } else if (/^\D+\s[A-Z]{1,2}$/.test(l) && l.split(' ').length > 2) {
            // Sin número de identificación: nombre y grupo.
            const g = l.match(/^(.*)\s([A-Z]{1,2})$/);
            poder.apoderados.push({ nombre_completo: (nombre + ' ' + g[1]).trim(), dni: '', grupo: g[2] });
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
      poder.usos = poder.usos.flatMap(usoCompleto);
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
  // "B CONJUNTA B+B; B+C" → { grupo: 'B', tipo: 'CONJUNTA', combinaciones: ['B+B', 'B+C'] }.
  // "B CONJUNTA B+B; B+C" → { grupo: 'B', tipo: 'CONJUNTA', tipos: ['CONJUNTA'], combinaciones: ['B+B', 'B+C'] }.
  // "* A INDIVIDUAL H/ $2.000.000 * A CONJUNTA A+A" → tipos INDIVIDUAL y CONJUNTA, límite 2.000.000 (de la individual).
  function usoDelResumen(texto) {
    const t = String(texto || '').toUpperCase().trim();
    if (!t) return null;
    const tipos = [...new Set((t.match(/\b(INDIVIDUAL|CONJUNTA|INDISTINTA)\b/g) || []).map(x => (x === 'INDISTINTA' ? 'INDIVIDUAL' : x)))];
    const tipo = tipos[0] || '';
    const pre = t.split(/\b(?:INDIVIDUAL|CONJUNTA|INDISTINTA)\b/)[0].replace(/^[\s*•\-]+|[\s:*\-]+$/g, '').replace(/^GRUPO\s+/, '').trim();
    const grupo = /^[A-Z]{1,3}$/.test(pre) ? pre : '';
    const combinaciones = [...new Set((t.match(/\b[A-Z]{1,3}(?:\s*\+\s*[A-Z]{1,3})+\b/g) || []).map(c => c.replace(/\s/g, '').split('+').sort().join('+')))].sort();
    // Límite escrito en el texto de la firma individual ("H/ $ 50.000.000", "HASTA USD 50.000").
    let limite = null, limiteTexto = '';
    const ind = t.match(/\b(?:INDIVIDUAL|INDISTINTA)\b([^*;]*?)(?=\bCONJUNTA\b|\b[A-Z]{1,3}\s*\+|\*|;|$)/);
    const RE_HASTA = /(?:\bH\s*\/|\bHASTA\b)\s*(?:LA SUMA DE\s*)?(U\$S|USD|US\$|\$)?\s*([\d.,]+\d)/;
    // Si el texto solo habla de firma individual, el "hasta" puede estar antes ("A) Hasta USD 600.000 de forma indistinta").
    const m = (ind && !/SIN L[IÍ]MITE/.test(ind[1]) && ind[1].match(RE_HASTA)) || (tipos.length === 1 && tipos[0] === 'INDIVIDUAL' && !/SIN L[IÍ]MITE/.test(t) && t.match(RE_HASTA));
    if (m) { limite = Number(m[2].replace(/\.(?=\d{3}\b)/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '')) || null; limiteTexto = `${m[1] || ''} ${m[2]}`.trim(); }
    return { grupo, tipo, tipos, combinaciones, limite, limiteTexto, texto: String(texto).trim() };
  }

  function leerClienteBastanteo(hojas) {
    const r = { cliente: '', cuit: '', firmantes: [], escrituras: [], marcas: {}, presidentes: [] };
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
        // El valor de cada rótulo es la primera celda con dato a su derecha. Algunos resúmenes tienen el encabezado cruzado
        // ("CLIENTE 30716908816 … CUIT ACA VALORES SA"): el número de 11 dígitos es el CUIT y el texto, la razón social.
        // Un rol ("PRESIDENTE / REPRESENTANTE LEGAL", "SOCIO GERENTE") nunca es la razón social.
        const ES_ROL = /^(presidente|vicepresidente|socio|gerente|representante|apoderad|director|mandato|acta|cuit|cdi|cuentas)\b/;
        const valorDe = k => { const v = f.slice(k + 1).map(c => String(c).trim()).find(Boolean); return v == null ? '' : v; };
        const tomar = v => {
          const d = String(v).replace(/[\s.-]/g, '');
          if (/^\d{11}$/.test(d)) { if (!r.cuit) r.cuit = d; return; }
          if (!r.cliente && v && !/^\d+$/.test(d) && !ES_ROL.test(normalizar(v))) r.cliente = String(v).trim();
        };
        const ic = n.indexOf('cliente');
        if (ic > -1) tomar(valorDe(ic));
        // Encabezado del resumen: "PRESIDENTE", "PRESIDENTE / REPRESENTANTE LEGAL", "SOCIO GERENTE", "REPRESENTANTE LEGAL"
        // y al lado el nombre: esa persona firma como presidente (todas las facultades).
        if (!r.firmantes.length) n.forEach((c, k) => {
          if (!/^(presidente|socio gerente|gerente|representante legal)\b/.test(c)) return;
          const v = f.slice(k + 1).map(x => String(x).trim()).find(x => x && /^[A-Za-zÁÉÍÓÚÑáéíóúñ¥.'\s-]+$/.test(x) && x.split(/\s+/).length >= 2 && !/^(cuit|mandato|acta|cuentas)\b/i.test(x));
          if (v && !r.presidentes.includes(v)) r.presidentes.push(v);
        });
        const icu = n.indexOf('cuit') > -1 ? n.indexOf('cuit') : n.indexOf('cdi');
        // (Una fila de encabezado de firmantes también tiene "Cuit": esa no es el dato del cliente.)
        if (icu > -1 && !n.some(c => /firmante|nombre/.test(c))) {
          tomar(valorDe(icu));
          if (!r.cuit) { const v = f.slice(icu + 1).map(c => String(c).replace(/\D/g, '')).find(c => c.length === 11); if (v) r.cuit = v; }
        }
        // Encabezado de firmantes: una columna de identificación ("Cuit", "CUIL", "DNI / CUIL"…) y una de nombre.
        const iNom = n.findIndex(c => /nombre/.test(c) && /firmante|apellido|nombre/.test(c));
        // Identificación: CUIT, CUIL, DNI o, para extranjeros, CI / cédula / CDI / pasaporte ("CI URUGUAY").
        const iId = n.findIndex(c => /\b(cuit|cuil|dni|cdi|ci|cedula|pasaporte|documento)\b/.test(c) && c.length <= 20);
        // Sin columna CUIT/DNI ("Ente | Rol | Nombre y Apellido firmante | …"): se lee igual, por número de ente y nombre.
        const sinId = iId < 0 && iNom > -1 && n.includes('ente') && n.some(c => /observaci|monto hasta|rol/.test(c));
        if ((iId > -1 || sinId) && iNom > -1) {
          const icu = iId;
          // La columna CUIT a veces trae el DNI (7 u 8 dígitos): queda como DNI y el CUIT se busca después en la base
          // de entes (por número de ente o por DNI).
          const iEnte = n.indexOf('ente');
          const iHasta = n.findIndex(c => /monto hasta/.test(c));
          let vacias = 0;
          for (const g of t.slice(i + 1)) {
            const fila = g || [];
            // El dato puede estar corrido una columna (filas con una marca adelante): se busca alrededor de la columna.
            const cand = icu < 0 ? [] : [icu, icu + 1, icu - 1].map(k => String(fila[k] == null ? '' : fila[k]).replace(/\D/g, ''));
            const num = cand.find(x => x.length === 11) || cand.find(x => x.length >= 7 && x.length <= 8) || '';
            const nombre = String(fila[iNom] || fila[iNom + 1] || '').trim();
            const enteVal = [iEnte, iEnte + 1].map(k => (k > -1 ? String(fila[k] == null ? '' : fila[k]).trim() : '')).find(x => /^\d{2,7}$/.test(x)) || '';
            // Uso de firma del resumen ("B CONJUNTA B+B; B+C") y monto hasta (puede venir corrido una columna).
            const despues = fila.slice(iNom + 1).map(c => (c == null ? '' : String(c).trim()));
            const observacion = despues.find(c => /\b(individual|conjunta|indistinta)\b/i.test(c)) || '';
            // Sin CUIT/DNI se acepta igual si tiene nombre y ente u observación (el CUIT sale después de la base de entes).
            if (!nombre || /^\d+$/.test(nombre) || !(num || enteVal || observacion)) {
              if (fila.some(c => c != null && String(c).trim())) { if (r.firmantes.length) break; } else if (r.firmantes.length && ++vacias > 1) break;
              continue;
            }
            vacias = 0;
            const clave = num || (enteVal ? 'e:' + enteVal : 'n:' + normalizar(nombre));
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            const montos = (iHasta > -1 ? [fila[iHasta], fila[iHasta + 1], fila[iHasta - 1]] : []).map(c => Number(String(c == null ? '' : c).replace(/[^\d.]/g, ''))).filter(x => x > 0);
            // "REVOCADO" en cualquier celda de la fila: el firmante figura como revocado en el resumen.
            const revocado = despues.some(c => /\brevoc/i.test(c));
            const extra = { observacion, monto_hasta: montos.length ? Math.max(...montos) : null, uso: usoDelResumen(observacion), revocado };
            r.firmantes.push(Object.assign(num.length === 11 ? { cuit: num, dni: num.slice(2, 10).replace(/^0+/, ''), ente: enteVal, nombre }
              : { cuit: '', dni: num, ente: enteVal, nombre }, extra));
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

  // Firmante de la planilla que corresponde a una persona del PDF: por el DNI dentro del CUIT y, si no, por el nombre
  // (mismas palabras en cualquier orden, sin acentos).
  function firmanteDe(persona, firmantes) {
    const lista = firmantes || [];
    const d8 = String(persona.dni || '').replace(/\D/g, '').padStart(8, '0');
    const porDni = persona.dni && lista.find(f => (f.dni && String(f.dni).padStart(8, '0') === d8)
      || (String(f.cuit || '').replace(/\D/g, '').length === 11 && String(f.cuit).replace(/\D/g, '').slice(2, 10) === d8));
    if (porDni) return porDni;
    const palabras = t => normalizar(t).split(' ').filter(Boolean).sort().join(' ');
    const n = palabras(persona.nombre_completo);
    if (!n) return null;
    const exacto = lista.find(f => palabras(f.nombre) === n);
    if (exacto) return exacto;
    // Nombre parecido (uno de los dos más corto o con una letra distinta): "Sandra Alejandra VELAZQUEZ" / "Sandra Velázquez",
    // "ANGEL REY LOPEZ (H)" / "Angel REY LOPEZ (Hijo)", "CANALE" / "CANALES". Solo si no tienen documentos distintos y hay
    // un único candidato.
    const doc = x => { const c = String(x.cuit || '').replace(/\D/g, ''); return x.dni ? String(x.dni).replace(/\D/g, '').padStart(8, '0') : c.length === 11 ? c.slice(2, 10) : ''; };
    const dp = doc(persona);
    const cands = lista.filter(f => { const df = doc(f); return !(dp && df && dp !== df) && nombresParecidos(persona.nombre_completo, f.nombre); });
    return cands.length === 1 ? cands[0] : null;
  }
  const NOMBRE_VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'h', 'hijo', 'jr', 'vda', 'venezolana', 'venezolano', 'venez']);
  const palabrasNombre = t => normalizar(String(t || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w.length > 1 && !NOMBRE_VACIAS.has(w)).map(w => (w === 'ma' ? 'maria' : w));
  function casiIgual(a, b) {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
    // Distancia de edición ≤ 1.
    let i = 0, j = 0, dif = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++dif > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return dif + (a.length - i) + (b.length - j) <= 1;
  }
  function nombresParecidos(x, y) {
    let a = palabrasNombre(x), b = palabrasNombre(y);
    if (a.length > b.length) [a, b] = [b, a];
    if (a.length < 2) return false;
    return a.every(w => b.some(v => casiIgual(w, v))) && a.some(w => w.length >= 4 && b.includes(w));
  }
  // Revocatorias: un poder que revoca (alcance "revoke" de Complif, o el texto del poder: "revoca los poderes…") anula los
  // poderes anteriores de la empresa. Si solo revoca (no es nuevo ni complementario), tampoco otorga facultades.
  const TEXTO_REVOCA = /\brevoc(a|an|ando|ase)\s+(expresamente\s+|en todos sus t[eé]rminos\s+)?(el|los|todo|todos|la|las)\s+(poder|poderes|mandato)/i;
  function revocaPoder(p) {
    const a = p.alcance || {};
    if (a.revoke === true) return true;
    return (p.usos || []).some(u => TEXTO_REVOCA.test(`${u.descripcion || ''} ${u.limitaciones || ''}`));
  }
  // Alcance de una revocatoria:
  //  - parcial ("revocación parcial", "únicamente con respecto a: (i) Ariel IBACETA (DNI …)"): solo saca de los poderes
  //    anteriores a las personas que nombra (por DNI o por nombre) cerca de la palabra "revoca";
  //  - de un poder E-BANVAL / banca electrónica: anula solo los poderes anteriores de ese tipo;
  //  - si no: anula todos los poderes anteriores de la empresa.
  const RE_EBANVAL = /e[.\-\s]?banval|banca electr[oó]nica/i;
  const textoPoder = p => (p.usos || []).map(u => `${u.descripcion || ''} ${u.limitaciones || ''}`).join(' ');
  function textoRevocatorio(p) {
    const t = textoPoder(p);
    const partes = [];
    for (const m of t.matchAll(/revoc/gi)) partes.push(t.slice(Math.max(0, m.index - 80), m.index + 900));
    return partes.join(' ');
  }
  function nombradoEn(a, texto) {
    const digitos = texto.replace(/(\d)\.(?=\d{3}\b)/g, '$1');
    const dni = String(a.dni || '').replace(/\D/g, '').replace(/^0+/, '');
    if (dni.length >= 7 && new RegExp(`\\b0*${dni}\\b`).test(digitos)) return true;
    const ps = palabrasNombre(a.nombre_completo);
    const t = ' ' + normalizar(texto) + ' ';
    return ps.length >= 2 && ps.every(w => t.includes(' ' + w + ' '));
  }
  // Una revocatoria solo alcanza a los poderes de la misma empresa (Complif vincula poderes de varias empresas).
  function mismaEmpresa(a, b) {
    const ca = complifNumero(a.cuit_empresa), cb = complifNumero(b.cuit_empresa);
    if (ca.length === 11 && cb.length === 11) return ca === cb;
    const ra = razonClave(a.razon_social), rb = razonClave(b.razon_social);
    return !ra || !rb || ra === rb || razonParecida(ra, rb);
  }
  const otorga = p => (p.usos || []).some(u => u.tipo || String(u.descripcion || '').trim());
  // Poder complementario que incorpora apoderados a un grupo de un poder anterior ("es incorporada como integrante del
  // Grupo B … con las mismas facultades"): hereda los usos de firma del poder anterior en los que participa ese grupo.
  function heredarComplementarios(vigentes) {
    vigentes.forEach(p => {
      const a = p.alcance || {};
      if (!(a.complementary === true || /\bincorporad[oa]s?\b|\bse\s+incorpora|mismas\s+facultades/i.test(textoPoder(p)))) return;
      const gs = [...new Set(p.apoderados.map(x => letraGrupo(x.grupo)).filter(Boolean))];
      if (!gs.length) return;
      const vistas = new Set(p.usos.map(u => (u.tipo || '') + '|' + (u.combinaciones || []).join(',')));
      vigentes.filter(q => q !== p && !q.complementarioDe && mismaEmpresa(p, q) && q.fecha_emision && p.fecha_emision && q.fecha_emision < p.fecha_emision)
        .forEach(q => q.usos.forEach(u => {
          const toca = (u.combinaciones || []).some(c => c.split('+').some(x => gs.includes(x))) || (u.grupos || []).some(x => gs.includes(x));
          const k = (u.tipo || '') + '|' + (u.combinaciones || []).join(',');
          if (!toca || vistas.has(k)) return;
          vistas.add(k);
          p.usos.push(Object.assign({}, u, { heredadoDe: q.fecha_emision }));
        }));
      p.complementarioDe = true;
    });
  }
  // opciones.ignorar: claves (claveRevocatoria) de poderes cuya revocatoria no se aplica (excepción cargada a mano, por
  // ejemplo cuando Complif marca como revocatorio un poder que no lo es).
  const claveRevocatoria = p => `${p.fecha_emision || ''}|${String(p.deed_number || '').replace(/\D/g, '')}`;
  function aplicarRevocatorias(poderes, opciones = {}) {
    const ignorar = new Set(opciones.ignorar || []);
    // Se puede volver a correr con otras excepciones: cada poder recupera los apoderados que tenía antes de las
    // revocaciones parciales.
    poderes.forEach(p => {
      if (!p._apoderadosOriginales) Object.defineProperty(p, '_apoderadosOriginales', { value: (p.apoderados || []).slice(), writable: true, enumerable: false });
      else p.apoderados = p._apoderadosOriginales.slice();
    });
    const ignorados = poderes.filter(p => revocaPoder(p) && ignorar.has(claveRevocatoria(p)));
    const revocan = poderes.filter(p => revocaPoder(p) && !ignorar.has(claveRevocatoria(p)));
    if (!revocan.length) { const vigentes = poderes.slice(); heredarComplementarios(vigentes); return { vigentes, anulados: [], quitados: [], avisos: [], revocan, ignorados }; }
    const anulados = [], quitados = [], avisos = [];
    const vigentes = poderes.filter(p => {
      for (const r of revocan) {
        if (r === p || !r.fecha_emision || !p.fecha_emision || !(p.fecha_emision < r.fecha_emision) || !mismaEmpresa(r, p)) continue;
        // Un poder que se remite al anterior como vigente ("quedan sometidos a … la Escritura Matriz N° 415 … mientras
        // subsista el Poder Matriz") lo complementa: no lo revoca.
        const tRev = textoPoder(r);
        if (/sometid[oa]s?\s+a|se\s+remite|por\s+reproducida|mientras\s+subsista|poder\s+matriz|escritura\s+matriz/i.test(tRev)
          && (!p.deed_number || new RegExp(`\\b${String(p.deed_number).replace(/\D/g, '')}\\b`).test(tRev) || /matriz/i.test(tRev))) continue;
        // El revocante sin apoderados leídos (el OCR no los trajo): no se puede saber a quién designa, así que no deja a
        // los anteriores sin poder. Queda el aviso para revisarlo.
        if (!r.apoderados.length && (r.usos || []).some(u => u.tipo)) { if (!avisos.some(a => a.poder === r)) avisos.push({ poder: r, motivo: 'revoca los poderes anteriores, pero no trae apoderados (revisar el OCR): se mantienen los anteriores' }); continue; }
        const tr = textoRevocatorio(r);
        // Una revocación sin usos de firma que lista apoderados (Complif pone ahí a los revocados) es parcial: solo ellos.
        const listados = !otorga(r) && r.apoderados.length ? p.apoderados.filter(a => r.apoderados.some(x => firmanteDe(x, [{ nombre: a.nombre_completo, dni: a.dni, cuit: a.cuit }]))) : [];
        const nombrados = [...new Set(p.apoderados.filter(a => nombradoEn(a, tr)).concat(listados))];
        const parcial = /parcial|[uú]nicamente\s+(con\s+)?respecto|s[oó]lo\s+(con\s+)?respecto|en\s+cuanto\s+a/i.test(tr) || listados.length > 0 || (nombrados.length && nombrados.length < p.apoderados.length);
        if (parcial) {
          if (!nombrados.length) continue;
          nombrados.forEach(a => quitados.push({ apoderado: a, poder: p, revocante: r, motivo: `revocado por el poder del ${r.fecha_emision}` }));
          p.apoderados = p.apoderados.filter(a => !nombrados.includes(a));
          if (!p.apoderados.length) { anulados.push({ poder: p, revocante: r, motivo: `revocación parcial del ${r.fecha_emision}: no le quedan apoderados` }); return false; }
          continue;
        }
        if (RE_EBANVAL.test(textoPoder(r)) && !RE_EBANVAL.test(textoPoder(p))) continue;
        anulados.push({ poder: p, revocante: r, motivo: `revocado por el poder del ${r.fecha_emision}` });
        return false;
      }
      const a = p.alcance || {};
      // Solo revoca (no tiene usos de firma propios): no otorga facultades. Si trae usos, otorga aunque Complif diga "new: false".
      if (revocaPoder(p) && !ignorar.has(claveRevocatoria(p)) && !otorga(p)) { anulados.push({ poder: p, motivo: 'revocatoria: no otorga facultades' }); return false; }
      return true;
    });
    heredarComplementarios(vigentes);
    return { vigentes, anulados, quitados, avisos, revocan, ignorados };
  }

  // Un firmante sin poder vigente que figuraba en un poder revocado (anulado entero o revocación parcial que lo quitó):
  // "figuraba en el poder del 2019-07-31 (esc. 132), revocado por el poder del 2024-12-17". revocados = { anulados, quitados }.
  function revocacionDe(f, revocados) {
    if (!revocados) return '';
    const etq = p => `${p.fecha_emision || 's/f'}${p.deed_number ? ' (esc. ' + p.deed_number + ')' : ''}`;
    const casos = [];
    (revocados.quitados || []).forEach(q => { if (q.apoderado && firmanteDe(q.apoderado, [f])) casos.push({ p: q.poder, motivo: q.motivo }); });
    (revocados.anulados || []).forEach(a => { if (a.poder && (a.poder.apoderados || []).some(x => firmanteDe(x, [f]))) casos.push({ p: a.poder, motivo: a.motivo }); });
    if (!casos.length) return '';
    casos.sort((x, y) => String(y.p.fecha_emision || '').localeCompare(String(x.p.fecha_emision || '')));
    // El más reciente: es el que lo dejó sin poder.
    return `figuraba en el poder del ${etq(casos[0].p)}, ${casos[0].motivo || 'revocado'}`;
  }

  // Firmantes de la planilla que no aparecen como apoderados en ningún poder.
  function firmantesSinPoder(poderes, firmantes) {
    // Un firmante repetido en la planilla (con CUIT y con DNI) cuenta como usado si cualquiera de sus renglones coincide.
    const aps = poderes.flatMap(p => p.apoderados);
    return (firmantes || []).filter(f => !aps.some(a => firmanteDe(a, [f])));
  }

  // Poder con apoderados en grupos con letra (A, B, C) y usos de firma que hablan de "Grupo 1 / Grupo 2" (Complif):
  // el 1 es la primera letra, el 2 la segunda… ("2 apoderados del GRUPO 1" = A+A). Si los apoderados ya tienen grupos
  // con número, no se toca.
  function alinearGruposNumerados(poder) {
    const letras = [...new Set((poder.apoderados || []).map(a => letraGrupo(a.grupo)).filter(Boolean))].sort();
    if (!letras.length || letras.some(l => /^\d+$/.test(l))) return poder.usos;
    const cambia = x => (/^\d+$/.test(x) && letras[Number(x) - 1] ? letras[Number(x) - 1] : x);
    const tieneNumeros = u => [u.grupo, ...(u.grupos || []), ...(u.combinaciones || []).flatMap(c => String(c).split('+'))].some(x => /^\d+$/.test(String(x || '')));
    return (poder.usos || []).map(u => (!tieneNumeros(u) ? u : Object.assign({}, u, {
      grupo: u.grupo ? cambia(String(u.grupo)) : u.grupo,
      grupos: u.grupos ? u.grupos.map(x => cambia(String(x))) : u.grupos,
      combinaciones: u.combinaciones ? [...new Set(u.combinaciones.map(c => String(c).split('+').map(cambia).sort().join('+')))] : u.combinaciones,
    })));
  }

  // Arma el JSON de un poder. edicion: { deed_number, board_resolution_power_attorney, power_attorney_type, cuits: {dni: cuit} }.
  function jsonPoder(poder, cliente, edicion = {}) {
    const cuits = edicion.cuits || {};
    const firmantes = cliente && cliente.firmantes && cliente.firmantes.length ? cliente.firmantes : null;
    const ident = (dni, persona) => {
      const f = firmantes && persona ? firmanteDe(persona, firmantes) : null;
      const c = cuits[dni] || (f && f.cuit) || (persona && persona.cuit) || cuitPorDni(dni, firmantes);
      return c ? Number(String(c).replace(/\D/g, '')) : (dni ? Number(dni) : null);
    };
    // Con planilla: solo van los apoderados que están en ella.
    // (edicion.todosApoderados: van todos los del poder, también los que no están en la planilla.)
    const apoderados = firmantes && !edicion.todosApoderados ? poder.apoderados.filter(a => firmanteDe(a, firmantes)) : poder.apoderados;
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
      apoderados: apoderados.map(a => ({ numero_de_identificacion: ident(a.dni, a), nombre_completo: a.nombre_completo, grupo: a.grupo || null })),
      estructuras_de_firma: alinearGruposNumerados(poder).map((u, n) => Object.defineProperty((() => {
        const ed = (edicion.facultades || [])[n] || {};
        // Si el uso es de un grupo y el poder asigna grupos, el uso vale solo para los apoderados de ese grupo.
        const comb = expandirComodines(u.combinaciones && u.combinaciones.length ? u.combinaciones : combinacionesPorGrupos(u, poder.apoderados), poder.apoderados);
        const conComodin = (u.combinaciones || []).some(c => /[*?]/.test(c));
        const gruposUso = conComodin ? [] : u.grupos && u.grupos.length ? u.grupos : u.grupo ? [u.grupo] : [];
        // Si ningún apoderado del poder tiene una letra (grupos escritos como descripción), el uso vale para todos.
        const mapea = gruposUso.length && poder.apoderados.some(a => letraGrupo(a.grupo));
        const delUso = mapea ? apoderados.filter(a => gruposUso.includes(letraGrupo(a.grupo))) : apoderados;
        return {
          grupo: u.grupo || null,
          combinaciones: comb && comb.length ? comb : null,
          con_presidente: u.conPresidente || undefined,
          apoderados: delUso.map(a => ident(a.dni, a)),
          tipo_de_firma: u.tipo || null,
          estructura_de_firma: u.descripcion || null,
          firma_individual: /INDIVIDUAL|INDISTINTA/.test(u.tipo),
          firma_conjunta: /CONJUNTA/.test(u.tipo),
          facultades: Object.fromEntries(BASTANTEO_CLAVES.map(k => [k, k in ed ? !!ed[k] : k in u.facultades ? u.facultades[k] : !!marcas[k]])),
          limitaciones: u.limitaciones || null,
          limite_de_operacion: null,
        };
      })(), 'vencimiento', { value: poder.vencimiento || null, enumerable: false })),
    };
  }

  // Un solo JSON con todos los poderes: cada apoderado junta sus facultades (si tiene varios poderes con el mismo tipo de
  // firma, vale lo que le dé cualquiera de ellos). Si el poder asigna un grupo al apoderado, se respeta; si no, los
  // apoderados con el mismo tipo de firma y las mismas facultades van al mismo grupo (A, B, C…, sin repetir los que ya
  // traen los poderes). Hay una estructura de firma por grupo. jsons = los JSON de cada poder (ya revisados).
  // Letra de grupo de un apoderado: "A", "b", "Grupo C" → "A"/"B"/"C"; una descripción ("Grupo Aeromar") → ''.
  // También "CATEGORÍA A", "CLASE B", "TIPO DE FIRMA C", "GRUPO DE FIRMAS CLASE A", "GRUPO II - CONJUNTA",
  // "GRUPO A - APODERADO AUTORIZADOR". Con dos rótulos ("GRUPO 1 - CATEGORIA A") o "CLASE A DE LIQUIDACIONES" (distinta de
  // "CLASE A DE PATRIMONIO") no hay una sola letra: queda como descripción.
  function letraGrupo(g) {
    const t = String(g == null ? '' : g).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/^ESQUEMA GENERICO\s*-\s*/, '');
    const m = t.match(/^(?:(?:GRUPO(?:\s+DE\s+FIRMAS?)?|CLASE|CATEGORIA|TIPO(?:\s+DE\s+FIRMA)?|FIRMA)\s+)*([A-Z0-9]{1,2}|I{3}|VI{2,3})(?:\s*[-–(:]\s*(.*))?$/);
    if (!m || (m[2] && /\b(GRUPO|CLASE|CATEGORIA|TIPO)\s+[A-Z0-9]{1,3}\b/.test(m[2]))) return '';
    return m[1];
  }
  // Firma conjunta que no nombra grupos ("Dos apoderados conjuntamente", "con otro apoderado", "dos de distinta
  // clase"): las combinaciones salen de los grupos que el poder les da a sus apoderados.
  // Combinaciones con comodín ("A+*" = A con uno de cualquier otro grupo; "?" = de cualquier grupo): se completan con
  // los grupos que el poder les da a sus apoderados.
  function expandirComodines(combos, apoderados) {
    if (!combos || !combos.some(c => /[*?]/.test(c))) return combos;
    const gs = [...new Set((apoderados || []).map(a => letraGrupo(a.grupo)).filter(Boolean))].sort();
    const out = new Set();
    combos.forEach(c => {
      let r = [[]];
      c.split('+').forEach(x => {
        r = r.flatMap(p => (x === '*' || x === '?' ? gs.filter(g => x === '?' || !p.includes(g)) : [x]).map(g => [...p, g]));
      });
      // "*" también tiene que ser distinto de los grupos fijos que vienen después.
      r.filter(p => c.split('+').every((x, i) => x !== '*' || p.filter((y, j) => j !== i && y === p[i]).length === 0)).forEach(p => out.add(p.slice().sort().join('+')));
    });
    return [...out].sort();
  }
  function combinacionesPorGrupos(u, apoderados) {
    if (!/CONJUNTA/.test(u.tipo || '')) return null;
    const gs = [...new Set((apoderados || []).map(a => letraGrupo(a.grupo)).filter(Boolean))].sort();
    if (!gs.length) return null;
    const d = String(u.descripcion || '');
    const n = Math.min(Math.max(cuantosDe(d) || 2, 2), 4);
    const distintos = /distint|diferente|otro grupo|de otra clase/i.test(d);
    const multis = (ls, k, desde = 0) => k === 0 ? [[]] : ls.slice(desde).flatMap((x, i) => multis(ls, k - 1, desde + i).map(r => [x, ...r]));
    const r = multis(gs, n).filter(c => !distintos || new Set(c).size === c.length).map(c => c.join('+'));
    return r.length && r.length <= 30 ? r : null;
  }
  const USO_RESTRINGIDO = /(\bs[oó]lo (para|a)\b|[uú]nicamente|exclusivamente|endoso para dep[oó]sito|e-?banval)/i;
  function jsonBastanteoUnico(jsons, cliente) {
    jsons = jsons.map(j => Object.assign({}, j));
    const letra = n => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
    const personas = new Map(); // id + tipo → datos
    // Uso individual de alcance restringido ("solo para endoso para depósito", "E-BANVAL") en un poder que tiene firma
    // conjunta: no es un grupo individual aparte; queda como limitación de la firma conjunta.
    const restringidas = [];
    jsons.forEach(j => {
      if (!j.estructuras_de_firma.some(e => e.firma_conjunta)) return;
      j.estructuras_de_firma = j.estructuras_de_firma.filter(e => {
        const r = e.firma_individual && !e.firma_conjunta && USO_RESTRINGIDO.test(`${e.estructura_de_firma || ''} ${e.limitaciones || ''}`);
        if (r) restringidas.push(e.estructura_de_firma);
        return !r;
      });
    });
    jsons.forEach(j => j.estructuras_de_firma.forEach(e => (e.apoderados ? j.apoderados.filter(a => e.apoderados.includes(a.numero_de_identificacion)) : j.apoderados).forEach(a => {
      // Grupo del poder: un carácter ("A", "Grupo B"). Si es una descripción ("Grupo Aeromar"), cada descripción distinta
      // es un grupo propio con letra puesta por la página (como un poder sin asignación de grupos).
      const grupoPoder = letraGrupo(a.grupo) || e.grupo || '';
      const grupoDesc = !grupoPoder && a.grupo ? normalizar(a.grupo) : '';
      const k = a.numero_de_identificacion + '|' + (e.tipo_de_firma || '') + '|' + grupoPoder + '|' + grupoDesc;
      if (!personas.has(k)) personas.set(k, { apoderado: a, grupoPoder, grupoDesc, tipo: e.tipo_de_firma, individual: e.firma_individual, conjunta: e.firma_conjunta,
        facultades: Object.fromEntries(BASTANTEO_CLAVES.map(c => [c, false])), limitaciones: new Set(), escrituras: new Set(), estructuras: new Set(), combinaciones: new Set() });
      const p = personas.get(k);
      // Solo las combinaciones donde aparece el grupo del apoderado (B en "A+A; A+B" → A+B).
      (e.combinaciones || []).filter(c => !grupoPoder || c.split('+').includes(grupoPoder)).forEach(c => p.combinaciones.add(c));
      if (e.con_presidente) p.conPresidente = true;
      BASTANTEO_CLAVES.forEach(c => { if (e.facultades[c]) p.facultades[c] = true; });
      if (e.limitaciones) p.limitaciones.add(e.limitaciones);
      if (j.deed_number) p.escrituras.add(String(j.deed_number));
      if (e.estructura_de_firma) p.estructuras.add(e.estructura_de_firma);
    })));
    // Una persona en varios grupos de los poderes (A, B, C…): vale la primera letra y se descarta la de menos poder.
    const primera = new Map();
    personas.forEach(p => { if (!p.grupoPoder) return; const id = p.apoderado.numero_de_identificacion, g = primera.get(id); if (!g || p.grupoPoder < g) primera.set(id, p.grupoPoder); });
    const descartados = {};
    personas.forEach((p, k) => {
      const id = p.apoderado.numero_de_identificacion;
      if (p.grupoPoder && p.grupoPoder !== primera.get(id)) { (descartados[id] = descartados[id] || new Set()).add(p.grupoPoder); personas.delete(k); }
    });
    const grupos = new Map();
    personas.forEach(p => {
      const k = p.grupoPoder ? 'G|' + p.grupoPoder + '|' + (p.tipo || '') : p.grupoDesc ? 'D|' + p.grupoDesc + '|' + (p.tipo || '')
        : (p.tipo || '') + '|' + BASTANTEO_CLAVES.map(c => (p.facultades[c] ? 1 : 0)).join('');
      if (!grupos.has(k)) grupos.set(k, { nombre: p.grupoPoder, tipo: p.tipo, individual: p.individual, conjunta: p.conjunta,
        facultades: Object.assign({}, p.facultades), personas: [], limitaciones: new Set(), escrituras: new Set(), combinaciones: new Set() });
      const g = grupos.get(k);
      // Grupo indicado por el poder: valen las facultades que tenga cualquiera de sus integrantes.
      BASTANTEO_CLAVES.forEach(c => { if (p.facultades[c]) g.facultades[c] = true; });
      g.personas.push(p);
      p.limitaciones.forEach(x => g.limitaciones.add(x));
      p.escrituras.forEach(x => g.escrituras.add(x));
      p.combinaciones.forEach(x => g.combinaciones.add(x));
      if (p.conPresidente) g.conPresidente = true;
    });
    const lista = [...grupos.values()].sort((a, b) => b.personas.length - a.personas.length);
    if (restringidas.length) lista.filter(g => g.conjunta).forEach(g => restringidas.forEach(x => g.limitaciones.add('Firma individual restringida (no es un grupo aparte): ' + x)));
    const usados = new Set(lista.filter(g => g.nombre).map(g => g.nombre));
    let n = 0;
    lista.forEach(g => {
      if (!g.nombre) { while (usados.has(letra(n))) n++; g.nombre = letra(n); usados.add(g.nombre); g.auto = true; }
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
    // Combinaciones posibles con los apoderados que quedaron (B+B necesita dos del grupo B; B+C, uno de cada uno).
    const integrantes = {};
    // (Una letra puede tener un grupo individual y uno conjunto: se cuentan las personas de todos.)
    const porLetra = {};
    lista.forEach(g => g.personas.forEach(p => (porLetra[g.grupo] = porLetra[g.grupo] || new Set()).add(p.apoderado.numero_de_identificacion)));
    Object.keys(porLetra).forEach(l => { integrantes[l] = porLetra[l].size; });
    const posible = c => { const n = {}; c.split('+').forEach(x => { n[x] = (n[x] || 0) + 1; }); return Object.keys(n).every(x => (integrantes[x] || 0) >= n[x]); };
    // Poder sin grupos y firma conjunta ("dos cualesquiera de los apoderados"): dos del mismo grupo (armado por facultades).
    const totalApoderados = new Set(lista.flatMap(g => g.personas.map(p => p.apoderado.numero_de_identificacion))).size;
    // Con el presidente sin letra de grupo en el poder: la letra del grupo + D.
    lista.forEach(g => { if (g.conPresidente && ![...g.combinaciones].some(c => c.endsWith('+D'))) g.combinaciones.add([g.grupo, 'D'].sort().join('+')); });
    lista.forEach(g => { if (g.auto && g.conjunta && !g.combinaciones.size) g.combinaciones.add(g.grupo + '+' + g.grupo); });
    lista.forEach(g => {
      const t = [...g.combinaciones].sort();
      // Con grupos automáticos la combinación vale con cualquier otro apoderado del poder.
      const ok = c => (g.auto ? totalApoderados >= 2 : posible(c));
      g.combOk = t.filter(ok); g.combNo = t.filter(c => !ok(c));
    });
    const descGrupo = g => `Grupo ${g.grupo} - ${g.conjunta ? 'firma conjunta' : 'firma individual / indistinta'}` +
      (g.conjunta && g.combOk.length ? ' ' + g.combOk.join('; ') : '') + ` (${nombres(g)})`;
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
      apoderados: [...apoderados.values()].map(a => Object.assign(a, { grupo: a.grupo.join(', ') }))
        .concat(((cliente && cliente.sinPoder) || []).filter(f => !apoderados.has(Number(f.cuit || f.dni))).map(f => ({ numero_de_identificacion: Number(f.cuit || f.dni),
          nombre_completo: f.nombre, grupo: null, advertencia: 'Está en la planilla del cliente pero no figura en ningún poder' }))),
      estructuras_de_firma: lista.map(g => Object.defineProperty({
        grupo: g.grupo,
        tipo_de_firma: g.tipo || null,
        estructura_de_firma: descGrupo(g),
        combinaciones: g.combOk.length ? g.combOk : null,
        combinaciones_sin_firmantes: g.combNo.length ? g.combNo : undefined,
        firma_individual: !!g.individual,
        firma_conjunta: !!g.conjunta,
        apoderados: g.personas.map(p => p.apoderado.numero_de_identificacion),
        escrituras: [...g.escrituras],
        facultades: g.facultades,
        limitaciones: [...g.limitaciones].join(' | ') || null,
        limite_de_operacion: null,
      // Letra puesta por la página (el poder no asigna grupos): no se exporta en el JSON.
      }, 'grupoAutomatico', { value: !!g.auto, enumerable: false })),
      // Grupos que la persona tiene en otros poderes (descartados por la regla de la primera letra): el control los acepta.
      get otrosGrupos() { return descartados; },
      poderes: jsons.map(j => ({ deed_number: j.deed_number, fecha_emision: j.fecha_emision, razon_social: j.razon_social, cuit_empresa: j.cuit_empresa,
        power_attorney_type: j.power_attorney_type, board_resolution_power_attorney: j.board_resolution_power_attorney,
        apoderados: j.apoderados.map(a => a.numero_de_identificacion), estructuras: j.estructuras_de_firma.map(e => e.estructura_de_firma) })),
    };
  }

  // ------------------------------------------------------------ JSON DE BASTANTEO (formato 1.0: empresa / apoderados / reglasFirma)
  // Se arma desde el JSON único. Grupos: los que designa la planilla del cliente (letra del uso de firma del resumen,
  // "B CONJUNTA B+B; B+C"); con opciones.fuente = 'complif', los de los poderes (Complif / PDF). Sin letra en el poder, los
  // grupos ya vienen armados por agrupamiento (mismo tipo de firma y facultades). Reglas:
  // (Como en producción: en ConjuntaIndistinta el quorum es el total de firmas; en Conjunta, las firmas de cada grupo.)
  //  - firma individual de un grupo → ConjuntaIndistinta [A], quorum 1; de varios grupos ("A y/o B") → [A, B], quorum 1;
  //    de una persona sin grupo → Individual con su CUIT en firmantes, quorum 1 (no juega);
  //  - dos cualesquiera de un grupo (A+A) → ConjuntaIndistinta [A], quorum 2;
  //  - dos cualesquiera de varios grupos (A+A, A+B y B+B) → ConjuntaIndistinta [A, B], quorum 2;
  //  - uno de cada grupo (A+B) → Conjunta [A, B], quorum 1; A+A+B+B → Conjunta, quorum 2.
  // Circuitos = códigos del catálogo de cada facultad.
  const CIRCUITO_DE_CLAVE = Object.fromEntries(BASTANTEO_CATALOGO.map(c => [c[2], c[0]]));
  // Circuitos que el sistema de destino tiene con dos códigos (van los dos juntos).
  const CIRCUITOS_GEMELOS = { TRF_ENTRE_CTAS_EMP: ['TRF_ENTRE_CUENTAS_EM'] };
  const PARTICULAS_APELLIDO = /^(DE|DEL|LA|LAS|LOS|DI|DA|VAN|VON|MC|MAC|SAN|SANTA)$/;
  // Nombres de pila frecuentes: en "CARLOS MODESTO AGUIAR MARTINEZ" los primeros que son nombres van a nombre y el resto
  // (aunque sean dos palabras) a apellido.
  const NOMBRES_PILA = new Set(('adrian adriana agustin agustina alan alberto alejandra alejandro alfredo alicia ana andrea andres angel angela angeles ' +
    'anibal antonio ariel armando augusto aurora beatriz belen benjamin bernardo blanca bruno camila carina carla carlos carmen carolina catalina ' +
    'cecilia cesar claudia claudio clara constanza cristian cristina dalma damian daniel daniela dario david debora diana diego dolores domingo ' +
    'eduardo elena elias eliana elisa elsa emanuel emilia emiliano emilio enrique ernesto esteban estefania eugenia eugenio evangelina ezequiel ' +
    'fabian fabiana fabio facundo federico felipe fernanda fernando florencia francisco franco gabriel gabriela gaston gerardo german gisela ' +
    'gonzalo graciela guadalupe guillermo gustavo hector hernan horacio hugo ignacio ines irene isabel ismael ivan jaime javier jesus joaquin ' +
    'jorge jose josefina juan juana julia julian juliana julieta julio karina laura leandro leonardo leonel lorena lourdes lucas lucia luciana ' +
    'luciano lucila luis luisa lujan magdalena manuel marcela marcelo marcos marco margarita maria mariana mariano maricel marina mario marta ' +
    'martin martina matias mauricio maximiliano melisa mercedes micaela miguel milagros miriam modesto monica natalia nelson nicolas noelia norberto ' +
    'norma octavio omar oscar osvaldo pablo pamela patricia patricio paula paulina pedro pilar rafael ramiro ramon raquel raul ricardo roberto ' +
    'rocio rodolfo rodrigo rolando romina rosa rosana ruben sabrina salvador samuel sandra sandro santiago sebastian sergio silvia silvina ' +
    'sofia solange soledad sonia susana tatiana teresa tomas valentin valeria vanesa veronica vicente victor victoria virginia virignia walter ' +
    'yamila ximena martha marta oriana irena clotilde justo fortunato analia veronica estefania gisella nahuel thiago tobias bautista valentina').split(' '));
  const esNombrePila = w => NOMBRES_PILA.has(normalizar(w));
  // "BREA, RICARDO CESAR JOSE" → apellido BREA; sin coma, el apellido es la primera palabra (con "DE LA", "DEL"…).
  // otro: el mismo nombre en otro orden (la planilla suele traer "APELLIDO NOMBRE" y el poder "NOMBRE APELLIDO"): el
  // apellido son las últimas palabras de uno que son las primeras del otro.
  function separarNombre(completo, otro) {
    const t = String(completo || '').replace(/\s+/g, ' ').trim();
    if (!t) return { apellido: '', nombre: '', seguro: false };
    if (t.includes(',')) { const [a, ...n] = t.split(','); return { apellido: a.trim(), nombre: n.join(',').trim(), seguro: true }; }
    const p = t.split(' ');
    const o = String(otro || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    // El otro trae el apellido en mayúsculas ("Estefania DE ROSA"): esas palabras, juntas en este nombre, son el apellido.
    const may = w => /[A-ZÁÉÍÓÚÑ]{2}/.test(w) && w === w.toUpperCase();
    if (o.some(w => /[a-záéíóúñ]/.test(w)) && o.some(may)) {
      const ap = o.filter(may).map(normalizar).join(' ');
      for (let i = 0; i < p.length; i++) for (let k = p.length; k > i; k--) {
        if (p.slice(i, k).map(normalizar).join(' ') === ap && (i === 0 || k === p.length) && k - i < p.length)
          return { apellido: p.slice(i, k).join(' '), nombre: p.slice(0, i).concat(p.slice(k)).join(' '), seguro: true };
      }
    }
    if (o.length === p.length && normalizar(o.join(' ')) !== normalizar(t)) {
      for (let k = p.length - 1; k >= 1; k--) {
        const fin = p.slice(k).map(normalizar).join(' ');
        // (Si lo que queda como apellido son nombres de pila y el nombre no tiene ninguno, el orden es el otro.)
        if (normalizar(o.slice(0, p.length - k).join(' ')) === fin && !(p.slice(k).every(esNombrePila) && !p.slice(0, k).some(esNombrePila)))
          return { apellido: p.slice(k).join(' '), nombre: p.slice(0, k).join(' '), seguro: true };
      }
    }
    // "Eduardo Fortunato AMIRANTE": el apellido es lo que está en mayúsculas al final.
    const mayus = w => /[A-ZÁÉÍÓÚÑ]{2}/.test(w) && w === w.toUpperCase();
    if (p.some(w => !mayus(w) && /[a-záéíóúñ]/.test(w)) && mayus(p[p.length - 1])) {
      let i = p.length - 1;
      while (i > 0 && (mayus(p[i - 1]) || PARTICULAS_APELLIDO.test(p[i - 1].toUpperCase()))) i--;
      if (i > 0) return { apellido: p.slice(i).join(' '), nombre: p.slice(0, i).join(' '), seguro: true };
    }
    // Nombres de pila al principio ("ADRIÁN ALBERTO FANTÍN"): el resto es el apellido; al final ("ZAPATA JUAN CARLOS"):
    // lo de adelante es el apellido.
    let ini = 0;
    while (ini < p.length - 1 && esNombrePila(p[ini])) ini++;
    if (ini > 0) return { apellido: p.slice(ini).join(' '), nombre: p.slice(0, ini).join(' '), seguro: true };
    let fin = p.length;
    while (fin > 1 && esNombrePila(p[fin - 1])) fin--;
    if (fin < p.length) return { apellido: p.slice(0, fin).join(' '), nombre: p.slice(fin).join(' '), seguro: true };
    // "Sebastian Roig" (nombre y apellido en ese orden): el apellido es la última palabra (con "de la", "del"…).
    if (p.length > 1 && p.every(w => !mayus(w))) {
      let i = p.length - 1;
      while (i > 1 && PARTICULAS_APELLIDO.test(p[i - 1].toUpperCase())) i--;
      return { apellido: p.slice(i).join(' '), nombre: p.slice(0, i).join(' '), seguro: p.length === 2 };
    }
    let k = 0;
    while (k < p.length - 2 && PARTICULAS_APELLIDO.test(p[k].toUpperCase())) k++;
    return { apellido: p.slice(0, k + 1).join(' '), nombre: p.slice(k + 1).join(' '), seguro: p.length <= 1 };
  }
  // Reglas de negocio del sistema de destino: Conjunta / ConjuntaIndistinta con quorum entero > 0; ConjuntaIndistinta con
  // al menos 1 grupo; Conjunta con al menos 2; Individual con un firmante. Grupos y firmantes tienen que existir.
  function validarJsonBastanteo(j) {
    const errores = [];
    const grupos = new Set((j.apoderados || []).flatMap(a => a.grupos || []));
    const cuits = new Set((j.apoderados || []).map(a => a.cuitCuil));
    (j.reglasFirma || []).forEach(r => {
      const q = `${r.referencia} (${r.tipo})`;
      if (!['Individual', 'Conjunta', 'ConjuntaIndistinta'].includes(r.tipo)) errores.push(`${q}: tipo desconocido.`);
      if (/Conjunta/.test(r.tipo) && !(Number.isInteger(r.quorum) && r.quorum > 0)) errores.push(`${q}: el quorum tiene que ser un entero mayor a 0.`);
      if (r.tipo === 'ConjuntaIndistinta' && !(r.grupos || []).length) errores.push(`${q}: tiene que tener al menos 1 grupo.`);
      if (r.tipo === 'Conjunta' && (r.grupos || []).length < 2) errores.push(`${q}: tiene que tener al menos 2 grupos.`);
      if (r.tipo === 'Individual' && (r.firmantes || []).length !== 1) errores.push(`${q}: tiene que tener un firmante.`);
      (r.grupos || []).filter(g => !grupos.has(g)).forEach(g => errores.push(`${q}: el grupo ${g} no tiene apoderados.`));
      (r.firmantes || []).filter(c => !cuits.has(c)).forEach(c => errores.push(`${q}: el firmante ${c} no está entre los apoderados.`));
      if (!(r.circuitos || []).length) errores.push(`${q}: no tiene circuitos.`);
    });
    if (!(j.apoderados || []).length) errores.push('No hay apoderados.');
    (j.apoderados || []).filter(a => !a.cuitCuil).forEach(a => errores.push(`${a.apellido}, ${a.nombre}: sin CUIT/CUIL.`));
    return errores;
  }
  // Monto de una estructura de firma, leído del texto del poder ("en operaciones que no excedan la suma de U$S 500.000",
  // "hasta $ 10.000.000", "≤U$S500.000"): { monto, moneda }. "que excedan U$S 500.000" / "más de" es la regla para montos
  // mayores: no tiene tope (null). Sin monto en el texto: null.
  function montoDeTexto(texto) {
    const t = String(texto || '').replace(/\s+/g, ' ');
    const re = /(U\$S|U\$D|USD|US\$|D[OÓ]LARES|\$|ARS|PESOS)\s*([\d][\d.]*(?:,\d{1,2})?)(\s*(?:MILLONES|MILL\.?))?/gi;
    let m;
    while ((m = re.exec(t))) {
      const antes = t.slice(Math.max(0, m.index - 70), m.index).toLowerCase();
      let valor = Number(m[2].replace(/\./g, '').replace(',', '.'));
      if (m[3]) valor *= 1e6;
      if (!(valor > 0)) continue;
      const moneda = /\$/.test(m[1]) && !/U\$|US\$/i.test(m[1]) || /ARS|PESOS/i.test(m[1]) ? 'ARS' : 'USD';
      // Lo último que se dice antes del importe decide: "no excedan", "hasta", "≤" (tope) o "excedan", "más de", ">" (sin tope).
      const ultimo = (re2 => { let x, u = null; while ((x = re2.exec(antes))) u = x[0]; return u; })(/no\s+(?:exced|super|sobrepas)\w*|hasta|≤|<=|menor\w*|inferior\w*|no\s+mayor\w*|exced\w*|super\w*|mayor\w*|m[aá]s\s+de|>/g);
      if (!ultimo) continue;
      if (/^no\s|hasta|≤|<=|menor|inferior/.test(ultimo)) return { monto: valor, moneda };
      return { monto: null, moneda: null, desde: valor };
    }
    return { monto: null, moneda: null };
  }

  // Tipo de cambio escrito en la planilla del cliente: "TIPO DE CAMBIO AL 11/01/2024: 834.5000", "TC: 9/11/2022 $166,50",
  // "(según fecha 2/9/2026 - cotización $1511 - …)". Devuelve { tc, fecha (aaaa-mm-dd o ''), texto } o null.
  function tcDePlanilla(hojas) {
    const num = v => {
      let t = String(v).trim();
      if (/,/.test(t) && /\./.test(t)) t = t.replace(/\./g, '').replace(',', '.');
      else if (/,/.test(t)) t = t.replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
      return Number(t);
    };
    const iso = f => { const m = String(f || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${ceros(m[2], 2)}-${ceros(m[1], 2)}` : ''; };
    const pats = [
      /TIPO\s+DE\s+CAMBIO(?:\s+(?:AL|DEL)?\s*(\d{1,2}\/\d{1,2}\/\d{4}))?\s*[:=]?\s*\$?\s*(\d[\d.,]*)/i,
      /\bT\.?\s?C\.?\s*[:=]?\s*(\d{1,2}\/\d{1,2}\/\d{4})?\s*\$?\s*(\d[\d.,]*)/i,
      /cotizaci[oó]n\s*(?:de\s*)?\$?\s*(\d[\d.,]*)/i,
    ];
    for (const h of hojas || []) for (const fila of h.filas || []) for (const c of fila || []) {
      const t = String(c == null ? '' : c);
      if (t.length < 4 || t.length > 2000) continue;
      for (let k = 0; k < pats.length; k++) {
        const m = t.match(pats[k]);
        if (!m) continue;
        const valor = num(k === 2 ? m[1] : m[2]);
        if (!(valor > 1 && valor < 100000)) continue;
        const fecha = k === 2 ? iso((t.match(/fecha\s*(\d{1,2}\/\d{1,2}\/\d{4})/i) || [])[1]) : iso(m[1]);
        return { tc: valor, fecha, texto: t.trim().slice(0, 160) };
      }
    }
    return null;
  }

  // Optimización de reglas: se juntan las que, con los mismos circuitos, el mismo vencimiento y el mismo monto, dicen lo
  // mismo con otra forma:
  //  1. grupos con exactamente los mismos integrantes → un solo grupo (la primera letra);
  //  2. misma regla (tipo, quorum, grupos, firmante) repetida → una, con los circuitos de todas;
  //  3. una firma de A y una firma de B (ConjuntaIndistinta [A] q1 + [B] q1) → ConjuntaIndistinta [A, B] q1;
  //  4. A+A, B+B y A+B (ConjuntaIndistinta [A] q2 + [B] q2 + Conjunta [A, B] q1) con el mismo monto y vencimiento →
  //     ConjuntaIndistinta [A, B] q2 con los circuitos de las tres (aunque cada una tenga otros circuitos);
  //  5. una regla cuyas firmas ya alcanzan para otra menos exigente que tiene todos sus circuitos (A+A cuando existe
  //     "dos cualesquiera de A y/o B" con esos circuitos) sobra: se saca. Mismo vencimiento y mismo monto (la regla con
  //     tope y la sin tope quedan las dos).
  // Devuelve { lista, notas } (notas: qué se unificó, para la pantalla).
  function optimizarReglas(lista, apoderados) {
    const notas = [];
    // 1. Grupos con los mismos integrantes.
    const miembros = {};
    (apoderados || []).forEach(a => (a.grupos || []).forEach(g => (miembros[g] = miembros[g] || new Set()).add(a.cuitCuil)));
    const firma = g => [...(miembros[g] || [])].sort().join(',');
    const alias = {};
    Object.keys(miembros).sort().forEach(g => {
      const igual = Object.keys(miembros).sort().find(h => h < g && !alias[h] && firma(h) && firma(h) === firma(g));
      if (igual) { alias[g] = igual; notas.push(`Los grupos ${igual} y ${g} tienen los mismos integrantes: quedan como ${igual}.`); }
    });
    if (Object.keys(alias).length) {
      (apoderados || []).forEach(a => { a.grupos = [...new Set(a.grupos.map(g => alias[g] || g))].sort(); });
      lista.forEach(r => { r.grupos = [...new Set(r.grupos.map(g => alias[g] || g))].sort(); });
    }
    // 2. Reglas idénticas (también las que quedaron iguales por el paso 1).
    const clave = r => [r.tipo, r.quorum, r.grupos.join(','), (r.firmantes || []).join(','), r.monto || '', r.moneda || '', r._vto || ''].join('|');
    const juntar = l => {
      const m = new Map();
      l.forEach(r => {
        const k = clave(r);
        if (!m.has(k)) { m.set(k, r); return; }
        const x = m.get(k);
        x.circuitos = [...new Set(x.circuitos.concat(r.circuitos))].sort();
        notas.push(`Se juntaron dos reglas ${r.tipo} [${r.grupos.join(', ')}] quorum ${r.quorum} iguales.`);
      });
      return [...m.values()];
    };
    lista = juntar(lista);
    // 3 y 4. Mismos circuitos, vencimiento y monto.
    const base = r => [r.circuitos.join(','), r._vto || '', r.monto || '', r.moneda || ''].join('|');
    const porBase = new Map();
    lista.forEach(r => { const k = base(r); (porBase.get(k) || porBase.set(k, []).get(k)).push(r); });
    const quitar = new Set(), nuevas = [];
    porBase.forEach(rs => {
      // 3. Firma individual de varios grupos.
      const ind = rs.filter(r => r.tipo === 'ConjuntaIndistinta' && r.quorum === 1 && !quitar.has(r));
      if (ind.length > 1) {
        const gs = [...new Set(ind.flatMap(r => r.grupos))].sort();
        ind.forEach(r => quitar.add(r));
        nuevas.push(Object.defineProperty(Object.assign({}, ind[0], { grupos: gs, descripcion: `Grupo ${gs.join(' y/o ')} - firma individual` }), '_vto', { value: ind[0]._vto, writable: true, enumerable: false }));
        notas.push(`Firma individual de ${ind.map(r => r.grupos.join('/')).join(', ')} con los mismos circuitos: una sola regla ConjuntaIndistinta [${gs.join(', ')}] quorum 1.`);
      }
    });
    // 4. Dos cualesquiera de varios grupos: todas las parejas presentes con el mismo monto y vencimiento.
    const porMonto = new Map();
    lista.filter(r => !quitar.has(r)).forEach(r => { const k = [r._vto || '', r.monto || '', r.moneda || ''].join('|'); (porMonto.get(k) || porMonto.set(k, []).get(k)).push(r); });
    porMonto.forEach(rs => {
      const dobles = rs.filter(r => r.tipo === 'ConjuntaIndistinta' && r.quorum === 2 && r.grupos.length === 1 && !quitar.has(r));
      const gs = dobles.map(r => r.grupos[0]).sort();
      if (gs.length > 1) {
        const cruces = gs.flatMap((a, i) => gs.slice(i + 1).map(b => rs.find(r => r.tipo === 'Conjunta' && r.quorum === 1 && r.grupos.join(',') === [a, b].join(',') && !quitar.has(r))));
        if (cruces.every(Boolean)) {
          const todas = dobles.concat(cruces);
          todas.forEach(r => quitar.add(r));
          const circuitos = [...new Set(todas.flatMap(r => r.circuitos))].sort();
          const distintos = todas.some(r => r.circuitos.join() !== circuitos.join());
          nuevas.push(Object.defineProperty(Object.assign({}, dobles[0], { grupos: gs, quorum: 2, circuitos, descripcion: `Firma conjunta: dos cualesquiera de ${gs.join(' y/o ')}` }), '_vto', { value: dobles[0]._vto, writable: true, enumerable: false }));
          notas.push(`${gs.map(g => g + '+' + g).join(', ')} y ${cruces.map(r => r.grupos.join('+')).join(', ')}${dobles[0].monto ? ` (hasta ${dobles[0].moneda} ${dobles[0].monto})` : ' (sin tope)'}: una sola regla ConjuntaIndistinta [${gs.join(', ')}] quorum 2` +
            (distintos ? ` con los circuitos de todas (${circuitos.length}); antes cada combinación tenía los suyos.` : '.'));
        }
      }
    });
    lista = juntar(lista.filter(r => !quitar.has(r)).concat(nuevas));
    // 5. Reglas cubiertas por otra menos exigente.
    const firmasMinimas = r => { // conjuntos mínimos de firmas (lista de grupos) que cumplen la regla
      if (r.tipo === 'Conjunta') return [r.grupos.flatMap(g => Array(r.quorum).fill(g))];
      if (r.tipo !== 'ConjuntaIndistinta' || r.quorum > 4 || r.grupos.length > 6) return null;
      const out = [], arma = (desde, acc) => { if (acc.length === r.quorum) { out.push(acc); return; } r.grupos.slice(desde).forEach((g, i) => arma(desde + i, acc.concat(g))); };
      arma(0, []);
      return out;
    };
    const cumple = (firmas, r) => r.tipo === 'ConjuntaIndistinta' ? firmas.filter(g => r.grupos.includes(g)).length >= r.quorum
      : r.tipo === 'Conjunta' ? r.grupos.every(g => firmas.filter(x => x === g).length >= r.quorum) : false;
    const cubre = (grande, chica) => grande !== chica && (grande._vto || '') === (chica._vto || '') && chica.circuitos.every(c => grande.circuitos.includes(c))
      && (grande.monto || null) === (chica.monto || null) && (grande.moneda || null) === (chica.moneda || null)
      && (firmasMinimas(chica) || [null]).every(f => f && cumple(f, grande));
    const sobran = new Set();
    lista.forEach(r => {
      const g = lista.find(x => !sobran.has(x) && cubre(x, r));
      if (g) { sobran.add(r); notas.push(`${r.descripcion.split(' · ')[0]} (${r.tipo} [${r.grupos.join(', ')}] quorum ${r.quorum}) ya está cubierta por "${g.descripcion.split(' · ')[0]}", que tiene todos sus circuitos: se saca.`); }
    });
    lista = lista.filter(r => !sobran.has(r));
    return { lista, notas };
  }
  function jsonBastanteoV1(unico, cliente, opciones = {}) {
    const fuente = opciones.fuente === 'complif' ? 'complif' : 'planilla';
    const firmantes = (cliente && cliente.firmantes) || [];
    const avisos = [];
    const idTexto = id => String(id == null ? '' : id).replace(/\D/g, '');
    const firmanteDeId = a => {
      const d = idTexto(a.numero_de_identificacion);
      return firmanteDe({ dni: d.length === 11 ? d.slice(2, 10).replace(/^0+/, '') : d, cuit: d.length === 11 ? d : '', nombre_completo: a.nombre_completo }, firmantes);
    };
    const apoderadosU = (unico.apoderados || []).filter(a => a.grupo);
    const planillaDe = new Map(apoderadosU.map(a => [a.numero_de_identificacion, firmanteDeId(a)]));
    // Letra del poder → letra de la planilla: todos los integrantes del grupo que están en la planilla con una letra
    // tienen que coincidir; si no, queda la del poder y se avisa.
    const renombre = {};
    if (fuente === 'planilla') {
      const porGrupo = {};
      (unico.estructuras_de_firma || []).forEach(e => (e.apoderados || []).forEach(id => {
        const f = planillaDe.get(id), l = f && f.uso && f.uso.grupo;
        if (l) (porGrupo[e.grupo] = porGrupo[e.grupo] || new Set()).add(l);
      }));
      Object.entries(porGrupo).forEach(([g, ls]) => {
        if (ls.size === 1) renombre[g] = [...ls][0];
        else avisos.push(`El grupo ${g} de los poderes tiene en la planilla firmantes de los grupos ${[...ls].sort().join(', ')}: cada uno va con la letra de la planilla y las reglas quedan con la del poder.`);
      });
    }
    const ren = g => renombre[g] || g;
    const reglas = new Map();
    // Con los JSON de cada poder (opciones.jsons) y todos los usos conjuntos con combinaciones, cada regla sale del uso
    // de firma exacto del poder (sus circuitos y sus combinaciones). Si no, de los grupos del JSON único.
    const porUso = (opciones.jsons || []).flatMap(j => j.estructuras_de_firma || []);
    const exacto = porUso.length && porUso.every(e => !e.firma_conjunta || (e.combinaciones || []).length);
    // Apoderados del poder que no están en el JSON único (grupos sin usos de firma, p. ej. un grupo C): van igual.
    if (opciones.jsons) {
      const ya = new Set(apoderadosU.map(a => a.numero_de_identificacion));
      opciones.jsons.flatMap(j => j.apoderados || []).forEach(a => {
        if (ya.has(a.numero_de_identificacion) || !letraGrupo(a.grupo)) return;
        ya.add(a.numero_de_identificacion);
        apoderadosU.push({ numero_de_identificacion: a.numero_de_identificacion, nombre_completo: a.nombre_completo, grupo: letraGrupo(a.grupo) });
        planillaDe.set(a.numero_de_identificacion, firmanteDeId(a));
      });
    }
    (exacto ? porUso : unico.estructuras_de_firma || []).forEach(e => {
      const circuitos = [...new Set(Object.entries(e.facultades || {}).filter(([k, v]) => v && CIRCUITO_DE_CLAVE[k])
        .flatMap(([k]) => [CIRCUITO_DE_CLAVE[k]].concat(CIRCUITOS_GEMELOS[CIRCUITO_DE_CLAVE[k]] || [])))].sort();
      const mt = montoDeTexto(`${e.estructura_de_firma || ''} ${e.limitaciones || ''}`);
      const delTexto = mt.monto ? { monto: mt.monto, moneda: mt.moneda } : {};
      const agregar = (tipo, quorum, grupos, extra0 = {}, combo = '', firmantes = []) => {
        const extra = Object.assign({}, delTexto, extra0);
        // Misma regla (tipo, quorum, grupos, firmante, monto y vencimiento del poder) desde varios usos: se juntan los circuitos.
        const vto = e.vencimiento || '';
        const k = [tipo, quorum, grupos.join(','), firmantes.join(','), extra.monto || '', extra.moneda || '', vto].join('|');
        if (reglas.has(k)) { const r = reglas.get(k); r.circuitos = [...new Set(r.circuitos.concat(circuitos))].sort(); return; }
        const descripcion = tipo === 'Individual' ? `Firma individual - ${combo}`
          : tipo === 'ConjuntaIndistinta' ? (combo === 'individual' ? `Grupo ${grupos.join(' y/o ')} - firma individual` : grupos.length > 1 ? `Firma conjunta: ${combo}` : `Grupo ${grupos[0]} - firma conjunta ${combo}`) : `Firma conjunta ${combo}`;
        reglas.set(k, Object.defineProperty(Object.assign({ tipo, quorum, moneda: null, monto: null, descripcion, circuitos, grupos, firmantes }, extra), '_vto', { value: vto, writable: true, enumerable: false }));
      };
      if (e.firma_individual && !e.firma_conjunta) {
        // Límite de la firma individual escrito en la planilla ("H/ $ 50.000.000"), si es el mismo para todo el grupo.
        const lim = fuente === 'planilla' ? [...new Set((e.apoderados || []).map(id => { const f = planillaDe.get(id); return f && f.uso && f.uso.limite ? `${f.uso.limite}|${f.uso.limiteTexto}` : ''; }))] : [];
        const extra = lim.length === 1 && lim[0] ? { monto: Number(lim[0].split('|')[0]), moneda: /U\$S|USD|US\$/.test(lim[0]) ? 'USD' : 'ARS' } : {};
        // Firma individual de un grupo: ConjuntaIndistinta con quorum 1 (una firma de cualquiera del grupo). Las personas
        // sin grupo van como Individual con su CUIT (el sistema pide un firmante en la regla individual).
        const grupoDe = id => { const f = planillaDe.get(id), a = apoderadosU.find(x => x.numero_de_identificacion === id);
          return (fuente === 'planilla' && f && f.uso && f.uso.grupo) || (a && ren(String(a.grupo).split(',')[0].trim())) || ''; };
        const conGrupo = [...new Set((e.apoderados || []).map(grupoDe).filter(Boolean))].sort();
        if (conGrupo.length) agregar('ConjuntaIndistinta', 1, conGrupo, extra, 'individual');
        (e.apoderados || []).filter(id => !grupoDe(id)).forEach(id => {
          const a = apoderadosU.find(x => x.numero_de_identificacion === id);
          if (!a) return;
          const f = planillaDe.get(id), d = idTexto(id) || idTexto(f && f.cuit);
          if (!d) return;
          agregar('Individual', 1, [], extra, a.nombre_completo, [d.length === 11 ? formatoCuit(d) : d]);
        });
        return;
      }
      let combos = [...new Map((e.combinaciones && e.combinaciones.length ? e.combinaciones : [`${e.grupo}+${e.grupo}`])
        .map(c => c.split('+').map(ren).sort()).map(ls => [ls.join('+'), ls])).values()];
      // Todas las parejas posibles entre los grupos (A+A, A+B, B+B): dos cualesquiera de esos grupos.
      const gs = [...new Set(combos.flat())].sort();
      const parejas = gs.flatMap((a, i) => gs.slice(i).map(b => `${a}+${b}`));
      const claves = new Set(combos.map(ls => ls.join('+')));
      if (gs.length > 1 && parejas.every(p => claves.has(p))) {
        agregar('ConjuntaIndistinta', 2, gs, {}, `dos cualesquiera de ${gs.join(' y/o ')}`);
        combos = combos.filter(ls => ls.length !== 2);
      }
      combos.forEach(ls => {
        const unicos = [...new Set(ls)].sort();
        if (unicos.length === 1) { agregar('ConjuntaIndistinta', ls.length, unicos, {}, ls.join('+')); return; }
        // Uno (o n) de cada grupo: quorum = firmas por grupo.
        const cuenta = unicos.map(g => ls.filter(x => x === g).length);
        if (new Set(cuenta).size > 1) avisos.push(`La combinación ${ls.join('+')} pide distinta cantidad de firmas por grupo: va como Conjunta con quorum ${Math.max(...cuenta)} (revisar).`);
        agregar('Conjunta', Math.max(...cuenta), unicos, {}, ls.join('+'));
      });
    });
    const apoderados = apoderadosU.map(a => {
      const f = planillaDe.get(a.numero_de_identificacion);
      // Nombre de Complif / del poder; el del Excel ayuda a saber cuál es el apellido.
      const n = a.nombre_completo ? separarNombre(a.nombre_completo, f && f.nombre) : separarNombre(f && f.nombre);
      if (!n.seguro) avisos.push(`${a.nombre_completo}: apellido "${n.apellido}" (revisar).`);
      const id = idTexto(a.numero_de_identificacion) || idTexto(f && f.cuit);
      if (!id) avisos.push(`${a.nombre_completo}: sin CUIT/CUIL.`);
      // Con la planilla, la letra que le da a la persona manda; si no tiene, la del poder (o la del agrupamiento).
      const propia = fuente === 'planilla' && f && f.uso && f.uso.grupo;
      return { cuitCuil: id.length === 11 ? formatoCuit(id) : id, nombre: n.nombre, apellido: n.apellido, estado: 'Activa',
        grupos: propia ? [propia] : [...new Set(String(a.grupo).split(',').map(x => ren(x.trim())).filter(Boolean))].sort() };
    });
    const opt = optimizarReglas([...reglas.values()], apoderados);
    // Tope en las dos monedas: cada regla con monto va también en la otra moneda al tipo de cambio Com. A 3500
    // (opciones.tc = { tc, fecha }). Sin tipo de cambio, solo la del poder (y se avisa).
    const conTope = opt.lista.filter(r => r.monto && (r.moneda === 'USD' || r.moneda === 'ARS'));
    if (conTope.length && !(opciones.tc && opciones.tc.tc > 0)) avisos.push('Hay reglas con tope: falta el tipo de cambio (Com. A 3500) para agregar la misma regla en la otra moneda.');
    if (conTope.length && opciones.tc && opciones.tc.tc > 0) {
      const tc = opciones.tc.tc, fTc = String(opciones.tc.fecha || '').split('-').reverse().join('/');
      const fmt = (n, d) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
      conTope.forEach(r => {
        const otra = r.moneda === 'USD' ? 'ARS' : 'USD';
        const monto = round2(r.moneda === 'USD' ? r.monto * tc : r.monto / tc);
        const gemela = Object.defineProperty(Object.assign({}, r, { moneda: otra, monto,
          descripcion: `${r.descripcion} · equivale a ${r.moneda} ${fmt(r.monto, 2)} al TC Com. A 3500${fTc ? ' del ' + fTc : ''} (${fmt(tc, 4)})` }), '_vto', { value: r._vto, writable: true, enumerable: false });
        opt.lista.splice(opt.lista.indexOf(r) + 1, 0, gemela);
      });
    }
    const hoy = claveDia(opciones.hoy || new Date());
    opt.lista.forEach(r => { if (r._vto) r.descripcion = `${r.descripcion} · vence ${r._vto.split('-').reverse().join('/')}`; });
    [...new Set(opt.lista.filter(r => r._vto && r._vto < hoy).map(r => r._vto))].forEach(v => avisos.push(`Hay reglas de un poder vencido el ${v.split('-').reverse().join('/')} (vencimiento en Complif): revisar si sigue vigente.`));
    const json = {
      version: '1.0',
      empresa: { cuit: formatoCuit(unico.cuit_empresa), razonSocial: unico.razon_social || null, estado: 'Activa' },
      apoderados,
      // Orden: conjuntas indistintas, conjuntas e individuales.
      reglasFirma: opt.lista.sort((a, b) => ['ConjuntaIndistinta', 'Conjunta', 'Individual'].indexOf(a.tipo) - ['ConjuntaIndistinta', 'Conjunta', 'Individual'].indexOf(b.tipo))
        .map((r, i) => Object.assign({ referencia: `regla-${i + 1}` }, r)),
    };
    // Avisos y grupos renombrados: para la pantalla, no se exportan.
    Object.defineProperty(json, 'avisos', { value: avisos, enumerable: false });
    Object.defineProperty(json, 'renombre', { value: renombre, enumerable: false });
    Object.defineProperty(json, 'unificaciones', { value: opt.notas, enumerable: false });
    return json;
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

  function lineaNoCobis(mis, importe, fechas, tipoCredito = NO_COBIS.tipoCredito) {
    const centavos = Math.round(Number(importe) * 100);
    const codigo = String(mis).replace(/\D/g, '');
    if (!codigo || codigo.length > 10) throw new Error(`MIS inválido: ${mis}`);
    if (!(centavos >= 0) || String(centavos).length > 14) throw new Error(`Importe fuera de rango para el MIS ${mis}: ${importe}`);
    return ceros(codigo, 10) + String(tipoCredito).slice(0, 10).padEnd(10, ' ') + ceros(NO_COBIS.tasa, 10) + ceros(centavos, 14)
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


  // ------------------------------------------------ NO COBIS FCIC MELI (reporte de cupones + patrimonio del fondo)
  // Reemplaza la planilla "No Cobis" (Power Query sobre el reporte de cupones + cubo FCIAbiertos) y la "Copia de
  // 03-MARZO" (solapas PEGAR DATOS, DG y TXT DE NO COBIS): el saldo contable de la cuenta 121049010 (cubo SaldosContables,
  // día ayer hábil) se reparte entre los bancos según el peso de sus cheques en la cartera (importe actual) y se informa
  // por CUIT de la lista DG.
  const FCIC_MELI_INICIAL = {
    fondo: 'MELIFCIC', cuentaContable: '121049010', tipoCredito: 'FCICMELI',
    // Solapa DG: CUIT, ente COBIS (Hoja3), nombre.
    dg: [
      ["30500010912", "1216", "BANCO DE LA NACION ARGENTINA"],
      ["30500003193", "2520", "BANCO BBVA ARGENTINA S.A."],
      ["30500008454", "911", "BANCO SANTANDER RIO S.A."],
      ["30500010084", "2526", "BANCO MACRO S.A"],
      ["30685376349", "16724", "TARJETA NARANJA SAU"],
      ["33999242109", "2505", "BANCO DE LA PROVINCIA DE BUENOS AIRES"],
      ["30500001735", "909", "BANCO DE GALICIA Y BUENOS AIRES S.A"],
      ["30500006613", "2899", "BANCO PATAGONIA S.A"],
      ["30709447846", "13614", "INDUSTRIAL AND COMERCIAL BANK OF CHINA (ARGENTINA) S.A.U"],
      ["30999228565", "8859", "BANCO DE LA PROVINCIA DE CORDOBA S.A"],
      ["30999032083", "644", "BANCO DE LA CIUDAD DE BS AS"],
      ["33500005179", "1217", "BANCO SUPERVIELLE S.A."],
      ["30692432661", "12374", "NUEVO BANCO DE SANTA FE SA"],
      ["30590360763", "630", "Cencosud"],
      ["30500012516", "9442", "BANCO DE LA PAMPA SA"],
      ["30500011072", "2121", "BANCO HIPOTECARIO S.A."],
      ["30500014047", "10492", "BANCO PROVINCIA DEL NEUQUEN S.A."],
      ["30670157799", "9441", "NUEVO BANCO DEL CHACO SA"],
      ["30500010602", "9608", "BANCO DE CORRIENTES SA"],
      ["30571421352", "9695", "BANCO CREDICOOP COOPERATIVO LTDO"],
      ["30500012990", "15670", "BANCO DEL  CHUBUT S.A."],
      ["30500009442", "3001", "BANCO DE SAN JUAN S.A."],
      ["33707995519", "8147", "NUEVO BANCO DE ENTRE RIOS SA"],
      ["30697265895", "16996", "BANCO DE SERVICIOS FINANCIEROS CARREFOUR S.A.U"],
      ["30604731018", "2493", "BANCO COMAFI SA"],
      ["30671375900", "2993", "BANCO DE FORMOSA S.A."],
      ["30575655781", "2494", "BANCO PROVINCIA DE TIERRA DEL FUEGO"],
      ["30500098801", "11553", "BANCO DE SANTA CRUZ S.A."],
      ["33999181819", "2533", "BANCO MUNICIPAL DE ROSARIO"],
      ["30704960995", "11153", "BANCO DE SERVICIOS Y TRANSACCIONES S.A"],
      ["30712331239", "17001", "BANCO BICA S.A"],
      ["30677937560", "2509", "BANCO DEL SOL S.A."],
      ["30685029959", "9670", "BANCO INDUSTRIAL S.A."],
      ["30714195960", "17002", "BANCO COINAG S.A"],
      ["33686664649", "3958", "BANCO DE SANTIAGO DEL ESTERO S.A"],
      ["30534487491", "2524", "BANCO MERIDIAN S.A."],
      ["30535610440", "2539", "BANCO ROELA SA"],
      ["30542033637", "2986", "BANCO DE COMERCIO S.A"]
    ].map(([cuit, ente, nombre]) => ({ cuit, ente, nombre })),
    // Nombre del banco en el reporte de cupones → CUIT (columnas H:I de la planilla No Cobis).
    bancos: [
      ["Banco de la Nacion Argentina", "30500010912"],
      ["BBVA BANCO FRANCES S.A.", "30500003193"],
      ["BANCO SANTANDER RIO S.A.", "30500008454"],
      ["Banco Macro S.A.", "30500010084"],
      ["NARANJA", "30685376349"],
      ["BANCO DE LA PROV.DE BS.AS.", "33999242109"],
      ["BANCO DE GALICIA Y BUENOS AIRE", "30500001735"],
      ["Banco Patagonia S.A.", "30500006613"],
      ["ICBC", "30709447846"],
      ["Banco de la Provincia de Córdoba S.A.", "30999228565"],
      ["BANCO DE LA CIUDAD DE BS.AS.", "30999032083"],
      ["Banco Supervielle S.A.", "33500005179"],
      ["Nuevo Banco de Santa Fe S.A.", "30692432661"],
      ["Cencosud", "30590360763"],
      ["BANCO DE LA PAMPA SOC DE ECONO", "30500012516"],
      ["Banco Hipotecario S.A.", "30500011072"],
      ["BANCO PCIA DE NEUQUEN S.A.", "30500014047"],
      ["NUEVO BCO.DEL CHACO S.A.", "30670157799"],
      ["Banco de Corrientes S.A.", "30500010602"],
      ["BANCO CREDICOOP COOP LIMITADO", "30571421352"],
      ["BANCO DE CHUBUT S.A.", "30500012990"],
      ["Banco de San Juan S.A.", "30500009442"],
      ["NUEVO BCO.ENTRE RIOS S.A.", "33707995519"],
      ["BANCO DE SERVICIOS FINANCIEROS", "30697265895"],
      ["Banco Comafi S.A.", "30604731018"],
      ["Banco de Formosa S.A.", "30671375900"],
      ["BCO PCIA DE TIERRA DEL FUEGO", "30575655781"],
      ["Banco de Santa Cruz S.A.", "30500098801"],
      ["Banco Municipal de Rosario", "33999181819"],
      ["Banco de Servicios y Transacciones S.A.", "30704960995"],
      ["Banco Bica S.A.", "30712331239"],
      ["Banco del Sol", "30677937560"],
      ["Banco Industrial S.A.", "30685029959"],
      ["Banco Coinag S.A.", "30714195960"],
      ["BANCO DE SANTIAGO DEL ESTERO SA", "33686664649"],
      ["Banco Meridian", "30534487491"],
      ["Banco Roela", "30535610440"],
      ["Banco de Comercio S.A.", "30542033637"],
      ["BANCO DE LA PROV. DE CORDOBA", "30999228565"]
    ].map(([nombre, cuit]) => ({ nombre, cuit })),
  };
  // Feriados nacionales (aaaa-mm-dd) para los días hábiles.
  const FERIADOS_AR = ['2026-01-01', '2026-02-16', '2026-02-17', '2026-03-23', '2026-03-24', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-25',
    '2026-06-15', '2026-06-20', '2026-07-09', '2026-07-10', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-07', '2026-12-08', '2026-12-25',
    '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-24', '2027-03-25', '2027-03-26', '2027-04-02', '2027-05-01', '2027-05-25', '2027-06-20',
    '2027-07-09', '2027-12-08', '2027-12-25'];
  const esHabil = (d, feriados) => d.getDay() !== 0 && d.getDay() !== 6 && !(feriados || FERIADOS_AR).includes(claveDia(d));
  function diaHabilAnterior(fecha, feriados = FERIADOS_AR) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - 1);
    while (!esHabil(d, feriados)) d.setDate(d.getDate() - 1);
    return d;
  }
  // Concesión = día hábil anterior a hoy; vencimiento = último día hábil de ese mes, o del mes siguiente si coinciden.
  function fechasFcicMeli(hoy = new Date(), feriados = FERIADOS_AR) {
    return fechasNoCobis(diaHabilAnterior(hoy, feriados), feriados);
  }
  const claveBanco = t => normalizar(String(t || '')).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  // Reporte de cupones (Reporte de Cheques de Pago Diferido, .xls): Fondo | Moneda | Descripción | Banco | Vencimiento |
  // Fecha | Importe Nominal | Importe Actual | … Se toman las filas del fondo y se suma el importe actual por banco.
  function leerReporteCupones(filas, fondo = 'MELIFCIC') {
    const num = v => typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/,/g, ''));
    let iBanco = 3, iImporte = 7, iFecha = 5;
    const enc = (filas || []).slice(0, 6).find(f => (f || []).some(c => /^banco$/i.test(String(c || '').trim())) && (f || []).some(c => /importe actual/i.test(String(c || ''))));
    if (enc) { iBanco = enc.findIndex(c => /^banco$/i.test(String(c || '').trim())); iImporte = enc.findIndex(c => /importe actual/i.test(String(c || ''))); }
    const porBanco = new Map();
    let total = 0, cheques = 0, fecha = null;
    (filas || []).forEach(f => {
      if (!f || String(f[0] || '').trim().toUpperCase() !== String(fondo).toUpperCase()) return;
      const v = num(f[iImporte]);
      if (!isFinite(v)) return;
      const banco = String(f[iBanco] || '').trim();
      porBanco.set(banco, (porBanco.get(banco) || 0) + v);
      total += v; cheques++;
      if (!fecha && f[iFecha] != null && f[iFecha] !== '') fecha = f[iFecha];
    });
    const grupos = [...porBanco].map(([banco, monto]) => ({ banco, monto, porcentaje: total ? monto / total : 0 })).sort((a, b) => b.monto - a.monto);
    return { grupos, total, cheques, fecha, fondo };
  }
  // Arma la solapa DG y el TXT. base = saldo de la cuenta 121049010. cfg = { dg, bancos, tipoCredito }.
  function armarNoCobisFcic(rep, base, fechas, cfg = FCIC_MELI_INICIAL) {
    const cuitDe = new Map((cfg.bancos || []).map(b => [claveBanco(b.nombre), String(b.cuit).replace(/\D/g, '')]));
    const porCuit = new Map(), sinCuit = [];
    rep.grupos.forEach(g => {
      const cuit = cuitDe.get(claveBanco(g.banco));
      if (!cuit) { sinCuit.push(g); return; }
      const x = porCuit.get(cuit) || { porcentaje: 0, monto: 0, bancos: [] };
      x.porcentaje += g.porcentaje; x.monto += g.monto; x.bancos.push(g.banco);
      porCuit.set(cuit, x);
    });
    const enDg = new Set((cfg.dg || []).map(x => String(x.cuit).replace(/\D/g, '')));
    // Bancos con cheques que no están en la lista DG: en la planilla quedaban afuera sin aviso.
    const fueraDg = [...porCuit].filter(([c]) => !enDg.has(c)).map(([cuit, x]) => ({ cuit, bancos: x.bancos, monto: x.monto, saldo: round2(x.porcentaje * base) }));
    const tipo = cfg.tipoCredito || 'FCICMELI';
    const filas = (cfg.dg || []).map(x => {
      const cuit = String(x.cuit).replace(/\D/g, ''), g = porCuit.get(cuit);
      // Sin cheques de ese banco: saldo 0 (el SI.ERROR(…;0) de la columna C de DG).
      const saldo = g ? round2(g.porcentaje * base) : 0;
      const ente = String(x.ente || '').replace(/\D/g, '');
      return { cuit, ente, nombre: x.nombre || (g ? g.bancos.join(', ') : ''), porcentaje: g ? g.porcentaje : 0, monto: g ? g.monto : 0, saldo, conDatos: !!g,
        linea: ente ? lineaNoCobis(ente, saldo, fechas, tipo) : '' };
    });
    const validas = filas.filter(f => f.linea);
    return { fechas, base, filas, sinCuit, fueraDg, sinEnte: filas.filter(f => !f.ente),
      total: round2(validas.reduce((t, f) => t + f.saldo, 0)),
      // Como el TXT que se sube a COBIS: líneas separadas por CRLF, sin salto después de la última.
      texto: validas.map(f => f.linea).join('\r\n') };
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


  // ------------------------------------------------------------ Descuento de cheques (eCheq)
  const CUIT_VALO = '30576124275';
  const digitosDe = v => String(v == null ? '' : v).replace(/\D/g, '');
  // Fecha de la API ("2026-10-16", "2026-10-16T00:00:00", "16/10/2026") como dd/mm/aaaa.
  function fechaEcheq(v) {
    if (v instanceof Date && !isNaN(v)) return `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`;
    const t = String(v == null ? '' : v).trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}` : t;
  }
  // Un cheque de la consulta, con nombres de campo uniformes. Si fue endosado a VALO, el beneficiario (el cliente que
  // lo descuenta) es quien hizo el último endoso a VALO.
  function normalizarEcheq(r) {
    r = r || {};
    const endosos = (Array.isArray(r.listEcheqEndorsementResponse) ? r.listEcheqEndorsementResponse : []).filter(e => e && digitosDe(e.beneficiarioDocumento) === CUIT_VALO);
    const ult = endosos.reduce((a, b) => { if (!a) return b; const fa = Date.parse(a.fechaHora || '') || 0, fb = Date.parse(b.fechaHora || '') || 0;
      return fb !== fa ? (fb > fa ? b : a) : (Number(b.idEndoso || -1) > Number(a.idEndoso || -1) ? b : a); }, null);
    const banco = r.banco && typeof r.banco === 'object' ? r.banco : null;
    const cmc7 = digitosDe(r.cmc7);
    const txt = v => String(v == null ? '' : v).trim();
    return {
      banco: txt(banco ? (banco.descripcion || banco.nombre || banco.desc) : (r.bancoDesc || r.bankName || r.banco)),
      bancoCodigo: txt(banco ? (banco.codigo || banco.id) : (r.bancoCodigo || r.bancoId || (/^\d+$/.test(txt(r.banco)) ? r.banco : ''))) || cmc7.slice(0, 3),
      sucursal: txt(r.sucursal || r.branch),
      chequeId: txt(r.chequeId || r.echeqId || r.checkId),
      chequeNumero: txt(r.chequeNumero || r.checkNumber),
      cmc7,
      emisorCuit: txt(r.emisorCuit || r.issuerDocument),
      emisorNombre: txt(r.emisorNombre || r.issuerName),
      beneficiarioDocumento: txt(ult && ult.emisorDocumento) || txt(r.beneficiarioDocumento || r.beneficiaryDocument),
      beneficiarioNombre: txt(ult && ult.emisorRazonSocial) || txt(r.beneficiarioNombre || r.beneficiaryName),
      fechaPago: txt(r.fechaPago || r.paymentDate),
      fechaEmision: txt(r.fechaEmision || r.issueDate),
      monto: Number(r.monto != null ? r.monto : r.amount) || 0,
      monedaDesc: txt(r.monedaDesc || r.currency),
      estado: txt(r.estado || r.state || r.status),
    };
  }
  // Lista de cheques de la respuesta del flujo de consulta (arreglo, o adentro de body / echeqsResponseArray…).
  function echeqsDeRespuesta(x) {
    if (Array.isArray(x)) return x;
    for (const k of ['echeqsResponseArray', 'listEcheqsResponseArray', 'echeqs', 'value', 'body']) if (x && Array.isArray(x[k])) return x[k];
    if (x && typeof x.body === 'string') { try { return echeqsDeRespuesta(JSON.parse(x.body)); } catch (e) { /* no JSON */ } }
    if (x && x.body && typeof x.body === 'object') return echeqsDeRespuesta(x.body);
    return [];
  }
  // Tabla de clientes COBIS (CUIT del beneficiario → código de cliente COBIS), como la Hoja2 del Excel de eCheqs:
  // columna A CUIT, B código (con o sin encabezado; opcional C nombre).
  function leerClientesCobis(filas) {
    const out = new Map();
    (filas || []).forEach(f => {
      const cuit = digitosDe(f && f[0]), cod = digitosDe(f && f[1]);
      if (cuit.length === 11 && cod) out.set(cuit, { cuit, codigo: cod, nombre: String((f[2] == null ? '' : f[2])).trim() });
    });
    return [...out.values()];
  }
  // Monto como lo escribe Excel en la interfaz (sin miles, punto decimal, sin ceros de más): 2112186.04
  const montoCobis = n => String(Math.round((Number(n) || 0) * 100) / 100);
  // Línea de la interfaz COBIS de un cheque (fórmula de la columna AD de la hoja MENU):
  // cod|beneficiario|CUIT|cod|beneficiario|CUIT|hoy|fechaPago|N° cheque|banco|sucursal|1041|monto|fechaPago|CUIT emisor|emisor||||1|chequeId|
  function lineaCobisEcheq(c, codigo, hoy) {
    const suc = Number((String(c.sucursal || '').match(/^\s*(\d{1,4})/) || [])[1] || (c.cmc7 || '').slice(3, 6)) || '';
    const banco = Number(c.bancoCodigo) || c.bancoCodigo || '';
    const fp = fechaEcheq(c.fechaPago), limpio = v => String(v == null ? '' : v).replace(/[|\r\n]+/g, ' ').trim();
    return [codigo, limpio(c.beneficiarioNombre), digitosDe(c.beneficiarioDocumento), codigo, limpio(c.beneficiarioNombre), digitosDe(c.beneficiarioDocumento),
      fechaEcheq(hoy), fp, limpio(c.chequeNumero), banco, suc, '1041', montoCobis(c.monto), fp, digitosDe(c.emisorCuit), limpio(c.emisorNombre),
      '', '', '', '1', limpio(c.chequeId)].join('|') + '|';
  }
  // Interfaz COBIS de varios cheques: las líneas y los cheques sin código de cliente (no van, como el IFERROR del Excel).
  function interfazCobisEcheq(cheques, clientes, hoy) {
    const cod = new Map((clientes || []).map(x => [digitosDe(x.cuit), String(x.codigo)]));
    const lineas = [], sinCodigo = [];
    (cheques || []).forEach(c => { const k = cod.get(digitosDe(c.beneficiarioDocumento)); if (k) lineas.push(lineaCobisEcheq(c, k, hoy || new Date())); else sinCodigo.push(c); });
    return { lineas, sinCodigo, texto: lineas.join('\r\n') + (lineas.length ? '\r\n' : '') };
  }
  // Resultado de la aceptación de un cheque, a partir de la respuesta del flujo.
  function resultadoAceptacion(j) {
    if (!j || typeof j !== 'object') return { aceptado: false, mensaje: 'Respuesta vacía del flujo' };
    const d = j.detalle && typeof j.detalle === 'object' ? j.detalle : {};
    const textos = [];
    const juntar = v => { if (!v) return; if (typeof v === 'string') textos.push(v); else if (Array.isArray(v)) v.forEach(juntar);
      else if (typeof v === 'object') juntar(v.message || v.mensaje || v.description || v.descripcion || v.messageText || v.code); };
    ['message', 'mensaje', 'messages', 'errors', 'error', 'description', 'descripcion'].forEach(k => juntar(d[k]));
    const aceptado = j.aceptado === true;
    let mensaje = [...new Set(textos.map(t => String(t).trim()).filter(Boolean))].join(' · ');
    if (!mensaje) mensaje = aceptado ? 'Aceptado' : j.etapa === 'login' ? 'No se pudo ingresar al banco (login)' : j.mensaje || `No aceptado${j.estadoHttp ? ' (HTTP ' + j.estadoHttp + ')' : ''}`;
    return { aceptado, mensaje, historico: j.historico !== false, fecha: j.fecha || '' };
  }
  const api = { revocacionDe, normalizarEcheq, echeqsDeRespuesta, leerClientesCobis, lineaCobisEcheq, interfazCobisEcheq, resultadoAceptacion, fechaEcheq, razonDelArchivo, razonPorCuit,
    PROVINCIAS, FIJOS, COLS_REPORTE, FORMATOS, COLUMNAS_MONTO, CAMPOS_INTERFAZ,
    leerTxtMeli, bancoMeliDeTxt, bancosParaMeli,
    sqlExtraccionCartera, bookmarkletCartera, scriptPowerShellCartera, comandoTareaCartera, IMPORTES_CARTERA,
    NO_COBIS, ultimoDiaHabil, fechasNoCobis, FCIC_MELI_INICIAL, FERIADOS_AR, diaHabilAnterior, fechasFcicMeli, leerReporteCupones, armarNoCobisFcic, lineaNoCobis, txtNoCobis, loteApiNoCobis, scriptPowerShellNoCobis, scriptPowerShellProbarNoCobis, scriptPowerShellAgenteNoCobis, cmdEnvioNoCobis,
    leerCartera, BASTANTEO_CATALOGO, BASTANTEO_CLAVES, BASTANTEO_EXTRA, leerPoderesOcr, leerAutoridadesOcr, COMPLIF_TIPOS, poderDesdeComplif, actaDesdeComplif, complifDeEmpresa, controlResumen, usoDelResumen, aplicarRevocatorias, claveRevocatoria, poderesFirmantesD, presidentesDeActas, gruposDelUso, usoCompleto, tokensDe, combosDeClausula, poderDelPresidente, leerClienteBastanteo, cuitPorDni, formatoCuit, firmanteDe, firmantesSinPoder, jsonPoder, jsonBastanteoUnico, jsonBastanteoV1, optimizarReglas, montoDeTexto, tcDePlanilla, validarJsonBastanteo, separarNombre, leerInventarioGarantias, leerUsoAcuerdos, leerCuentasPowerBI, clienteDeCuenta, leerPadronDesdeLineasPdf, INVENTARIOS_CONTABLES, INVENTARIO_DENOMINACION, INVENTARIO_FIRMAS, fechaReporteIso, fechaInventarioDesdeReporte, leerPadronDesdeInventarios, leerBaseEntes, unirPadron, armarInventariosContables, leerCom3500, leerTcApiBcra, elegirTipoCambio, numeroEnLetras, daxCarteraPowerBI, daxDiagnosticoPowerBI, daxSaldoDeuda, armarSaldoDeuda, daxSaldoDeudaDetalle, armarDeudaDetalle, leerFilasPowerBI, sugerirColumnaCartera, columnasNumericasCartera, agruparCartera, valoresDistintos, sqlCartera,
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
