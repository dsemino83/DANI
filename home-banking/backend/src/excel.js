// Exportación a .xlsx nativo (números como números, débitos en negativo).
import ExcelJS from 'exceljs';

const COLUMNAS_MOVIMIENTOS = [
    { header: 'ID', key: 'id', width: 12 }, { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 30 }, { header: 'Cuenta', key: 'cuenta', width: 18 },
    { header: 'Descripción', key: 'descripcion', width: 45 }, { header: 'Beneficiario', key: 'beneficiario', width: 30 },
    { header: 'CUIT', key: 'cuit', width: 14 }, { header: 'CBU origen', key: 'cbuOri', width: 24 }, { header: 'D/C', key: 'dc', width: 6 },
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

export async function xlsxMovimientos(filas, { hoja: nombre = 'Movimientos' } = {}) {
  const wb = libro();
  hoja(wb, nombre, COLUMNAS_MOVIMIENTOS, filas);
  return wb.xlsx.writeBuffer();
}

// Adjunto de un envío programado: hoja Saldos y/o Movimientos (todos, sin el tope del cuerpo del correo)
export async function xlsxEnvio(empresa, cuentas, contenido) {
  const wb = libro();
  const moneda = (c) => (Number(c.currencyId) === 80 ? 'ARS' : 'USD');
  if (contenido !== 'movimientos') {
    hoja(wb, 'Saldos', [
      { header: 'Cliente', key: 'cliente', width: 30 }, { header: 'CUIT', key: 'cuit', width: 14 }, { header: 'Cuenta', key: 'cuenta', width: 18 },
      { header: 'Nombre', key: 'nombre', width: 30 }, { header: 'Moneda', key: 'moneda', width: 8 },
      { header: 'Disponible', key: 'disponible', width: 18, style: { numFmt: '#,##0.00' } },
      { header: 'Contable', key: 'contable', width: 18, style: { numFmt: '#,##0.00' } },
    ], cuentas.map((c) => ({ cliente: empresa.razon_social, cuit: empresa.cuit, cuenta: c.productNumber, nombre: c.productName ?? '',
      moneda: moneda(c), disponible: Number(c.availableBalance ?? 0), contable: Number(c.accountingBalance ?? 0) })));
  }
  if (contenido !== 'saldos') {
    hoja(wb, 'Movimientos', COLUMNAS_MOVIMIENTOS, cuentas.flatMap((c) => (c.movimientos ?? [])
      .map((m) => filaMovimiento(m, { cuenta: c.productNumber, cliente: empresa.razon_social, moneda: moneda(c) }))));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Normaliza un movimiento de getMovementsDetail a una fila de exportación
export const filaMovimiento = (m, { cuenta, cliente, moneda }) => ({
  id: String(m.transactionId ?? m.sequential), fecha: m.processDate, hora: m.hour, cliente, cuenta,
  descripcion: m.description, beneficiario: m.beneficiary ?? '', cuit: m.documentNumber ?? '', cbuOri: m.cbuOri ?? '',
  dc: m.signDC, moneda, importe: (m.signDC === 'D' ? -1 : 1) * Number(m.amount), saldo: Number(m.availableBalance),
});
