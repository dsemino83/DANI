// Exportación a .xlsx nativo (números como números, débitos en negativo).
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';

const LOGO = readFileSync(new URL('./assets/logo-valo.png', import.meta.url));

// Causal del movimiento: el banco la informa en "reference" (Referencia "causa"; documentación v1.22, getMovementsDetail).
// cause / causeId quedan de respaldo por si el banco empieza a completarlos.
export const causalDe = (m) => { for (const v of [m.reference, m.causeId, m.cause]) { const d = String(v ?? '').match(/\d+/); if (d) return String(Number(d[0])); } return null; };
// El CBU originante solo se informa en las causales 366 y 367; en las demás va en blanco
export const CAUSALES_CBU_ORIGEN = ['366', '367'];
export const cbuOrigen = (m) => (CAUSALES_CBU_ORIGEN.includes(causalDe(m)) ? String(m.cbuOri ?? '').trim() : '');
// Columna de la consulta y del Excel: causales 366/367 → CBU originante; las demás → beneficiario
export const cbuOBeneficiario = (m) => (CAUSALES_CBU_ORIGEN.includes(causalDe(m)) ? cbuOrigen(m) : String(m.beneficiary ?? '').trim());

const COLUMNAS_MOVIMIENTOS = [
    { header: 'ID', key: 'id', width: 12 }, { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 30 }, { header: 'Cuenta', key: 'cuenta', width: 18 },
    { header: 'Descripción', key: 'descripcion', width: 45 }, { header: 'Beneficiario', key: 'beneficiario', width: 30 },
    { header: 'CUIT', key: 'cuit', width: 14 }, { header: 'Causal', key: 'causal', width: 8 }, { header: 'CBU origen (366/367) / Beneficiario', key: 'cbuOri', width: 32 }, { header: 'D/C', key: 'dc', width: 6 },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Importe', key: 'importe', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Saldo', key: 'saldo', width: 16, style: { numFmt: '#,##0.00' } },
];

// Hoja con encabezado rojo VALO (Pantone 186 C) y primera fila fija
function hoja(wb, nombre, columnas, filas) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = columnas;
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCE162E' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  for (const f of filas) ws.addRow(f);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

const libro = () => { const wb = new ExcelJS.Workbook(); wb.creator = 'Home Banking VALO'; return wb; };

// Con titulo: arriba el logo del banco, el título y el subtítulo (p. ej. el cliente); si no, tabla sola
export async function xlsxMovimientos(filas, { hoja: nombre = 'Movimientos', titulo = null, subtitulo = '' } = {}) {
  const wb = libro();
  if (titulo) hojaConLogo(wb, nombre, COLUMNAS_MOVIMIENTOS, filas, { titulo, subtitulo, logo: LOGO });
  else hoja(wb, nombre, COLUMNAS_MOVIMIENTOS, filas);
  return wb.xlsx.writeBuffer();
}

// Hoja de un extracto o alerta: logo del banco, título y cliente arriba; la tabla empieza en la fila 5
function hojaConLogo(wb, nombre, columnas, filas, { titulo, empresa = null, subtitulo = null, logo }) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } }); // impreso: A4 apaisado, una página de ancho
  ws.columns = columnas.map(({ key, width, style }) => ({ key, width, style }));
  if (logo) ws.addImage(wb.addImage({ buffer: logo, extension: 'png' }), { tl: { col: 0, row: 0 }, ext: { width: 145, height: 48 } });
  ws.getRow(1).height = 20; ws.getRow(2).height = 20; ws.getRow(3).height = 18;
  const c1 = ws.getCell('C1'); c1.value = titulo; c1.font = { bold: true, size: 14, color: { argb: 'FFCE162E' } };
  const c2 = ws.getCell('C2'); c2.value = subtitulo ?? `${empresa.razon_social} · CUIT ${empresa.cuit}`; c2.font = { bold: true };
  ws.getCell('C3').value = 'Banco de Valores · Home Banking VALO';
  ws.getCell('C3').font = { color: { argb: 'FF727274' }, size: 9 };
  const cab = ws.getRow(5);
  columnas.forEach((col, k) => { cab.getCell(k + 1).value = col.header; });
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCE162E' } };
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  for (const f of filas) ws.addRow(f);
  return ws;
}

const pesos = (v, mon) => `${mon === 'USD' ? 'US$' : '$'} ${Number(v ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Adjunto de un envío programado (extracto diario o alerta): un solo Excel con una pestaña por cuenta. Cada pestaña
// lleva el logo, el título, el cliente y la cuenta (con sus saldos si corresponde) y todos sus movimientos (sin el
// tope del cuerpo del correo). conSaldo = false (alertas): sin la columna Saldo de cada movimiento.
export async function xlsxEnvio(empresa, cuentas, contenido, { titulo = 'Extracto', logo = null, conSaldo = true } = {}) {
  const wb = libro();
  const moneda = (c) => (Number(c.currencyId) === 80 ? 'ARS' : 'USD');
  const conSaldos = contenido !== 'movimientos', conMovs = contenido !== 'saldos';
  const columnas = conMovs
    ? COLUMNAS_MOVIMIENTOS.filter((x) => !['cliente', 'cuenta', 'moneda'].includes(x.key) && (conSaldo || x.key !== 'saldo'))
    : [{ header: 'Cuenta', key: 'cuenta', width: 18 }, { header: 'Nombre', key: 'nombre', width: 30 }, { header: 'Moneda', key: 'moneda', width: 10 },
      { header: 'Disponible', key: 'disponible', width: 18, style: { numFmt: '#,##0.00' } }, { header: 'Contable', key: 'contable', width: 18, style: { numFmt: '#,##0.00' } }];
  const usados = new Set();
  for (const c of cuentas) {
    const mon = moneda(c);
    // Nombre de la pestaña: número de cuenta y moneda (Excel admite hasta 31 caracteres, sin repetir)
    let nombre = `${c.productNumber} ${mon}`.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    for (let k = 2; usados.has(nombre); k++) nombre = `${String(c.productNumber).slice(0, 26)} (${k})`;
    usados.add(nombre);
    const filas = conMovs
      ? (c.movimientos ?? []).map((m) => filaMovimiento(m, { cuenta: c.productNumber, cliente: empresa.razon_social, moneda: mon }))
      : [{ cuenta: c.productNumber, nombre: c.productName ?? '', moneda: mon, disponible: Number(c.availableBalance ?? 0), contable: Number(c.accountingBalance ?? 0) }];
    const ws = hojaConLogo(wb, nombre, columnas, filas, { titulo, empresa, logo });
    ws.getCell('C3').value = `Cuenta ${c.productNumber} · ${c.productName ?? ''} · ${mon}`
      + (conSaldos && conMovs ? ` · Disponible ${pesos(c.availableBalance, mon)} · Contable ${pesos(c.accountingBalance, mon)}` : '');
    ws.getCell('C3').font = { bold: true, color: { argb: 'FF2A2A2D' }, size: 10 };
    if (conMovs && c.errorMovimientos) ws.addRow([`No se pudieron consultar los movimientos: ${c.errorMovimientos}`]);
    else if (conMovs && !filas.length) ws.addRow(['Sin movimientos']);
  }
  if (!cuentas.length) hojaConLogo(wb, 'Sin cuentas', [{ header: 'Detalle', key: 'd', width: 40 }], [{ d: 'Sin cuentas para informar' }], { titulo, empresa, logo });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Normaliza un movimiento de getMovementsDetail a una fila de exportación
export const filaMovimiento = (m, { cuenta, cliente, moneda }) => ({
  id: String(m.transactionId ?? m.sequential), fecha: m.processDate, hora: m.hour, cliente, cuenta,
  descripcion: m.description, beneficiario: m.beneficiary ?? '', cuit: m.documentNumber ?? '', cbuOri: cbuOBeneficiario(m),
  causal: causalDe(m) ?? '', dc: m.signDC, moneda, importe: (m.signDC === 'D' ? -1 : 1) * Number(m.amount), saldo: Number(m.availableBalance),
});
