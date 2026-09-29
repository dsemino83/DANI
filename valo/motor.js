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

  // ------------------------------------------------------------------- Bancos

  // Un banco está completo cuando tiene provincia real, sucursal, CUIT y código de crédito.
  function problemasBanco(b) {
    const p = [];
    if (!b) return ['No existe en la tabla Bancos'];
    if (!b.nombre) p.push('Falta el nombre');
    if (!/^\d{11}$/.test(String(b.cuit || ''))) p.push('CUIT inválido');
    if (!b.jurisdiccion || normalizar(b.jurisdiccion) === 'prueba') p.push('Jurisdicción = Prueba');
    if (b.sucursal == null || b.sucursal === '' || !isFinite(Number(b.sucursal))) p.push('Código Sucursal #N/D');
    if (b.codCredito == null || String(b.codCredito).trim() === '' || !/^\d+$/.test(String(b.codCredito).trim())) p.push('Código Nº Crédito vacío');
    return p;
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
  function generarCuotas(reporte, bancos, params, hoy) {
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
    const orden = [...grupos.values()].sort((a, b) => a.banco - b.banco || a.fecha - b.fecha);

    let bancoAnterior = null, numero = 0;
    const filas = orden.map(g => {
      numero = g.banco === bancoAnterior ? numero + 1 : 1;
      bancoAnterior = g.banco;
      const b = porCodigo.get(g.banco);
      const suc = b && b.sucursal != null && b.sucursal !== '' ? Number(b.sucursal) : '';
      const cuit = b && b.cuit ? String(b.cuit) : '';
      const codCred = b && b.codCredito != null && String(b.codCredito).trim() !== '' ? String(b.codCredito).trim() : '';
      const credito = codCred === '' ? '' : (/^\d+(\.\d+)?$/.test(codCred) ? String(Math.round(Number(codCred))) : codCred) + sufijo;
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

  function generarCreditos(cuotas, bancos, params) {
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
        nombre: banco ? String(banco.nombre || '').slice(0, 30) : '',
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
    leerCsv, encabezadosEjemplo, leerDefinicionInterfaz, sugerirColumna, detectarHojaInterfaz,
    normalizar, provinciaPorNombre, round2, aNumero, aFechaSerial, aCodigoBanco,
    fechaDDMMYY, fechaYYYYMMDD, fechaLegible, hoyDDMMYY,
    detectarHoja, armarReporte, leerConciliacion,
    problemasBanco, codigoCreditoPorDefecto, controlarBancos, controlarReporte,
    generarCuotas, generarCreditos, txtCuotas, txtCreditos, nombreArchivo,
    calcularSecuenciaLote, validarFormulario,
  };
  root.ValoMotor = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
