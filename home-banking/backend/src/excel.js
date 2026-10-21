// Exportación a .xlsx nativo (números como números, débitos en negativo).
import ExcelJS from 'exceljs';

export async function xlsxMovimientos(filas, { hoja = 'Movimientos' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Home Banking VALO';
  const ws = wb.addWorksheet(hoja);
  ws.columns = [
    { header: 'ID', key: 'id', width: 12 }, { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Hora', key: 'hora', width: 10 },
    { header: 'Cliente', key: 'cliente', width: 30 }, { header: 'Cuenta', key: 'cuenta', width: 18 },
    { header: 'Descripción', key: 'descripcion', width: 45 }, { header: 'Beneficiario', key: 'beneficiario', width: 30 },
    { header: 'CUIT', key: 'cuit', width: 14 }, { header: 'CBU origen', key: 'cbuOri', width: 24 }, { header: 'D/C', key: 'dc', width: 6 },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Importe', key: 'importe', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Saldo', key: 'saldo', width: 16, style: { numFmt: '#,##0.00' } },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCE162E' } }; // rojo VALO (Pantone 186 C)
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  for (const f of filas) ws.addRow(f);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
}

// Normaliza un movimiento de getMovementsDetail a una fila de exportación
export const filaMovimiento = (m, { cuenta, cliente, moneda }) => ({
  id: String(m.transactionId ?? m.sequential), fecha: m.processDate, hora: m.hour, cliente, cuenta,
  descripcion: m.description, beneficiario: m.beneficiary ?? '', cuit: m.documentNumber ?? '', cbuOri: m.cbuOri ?? '',
  dc: m.signDC, moneda, importe: (m.signDC === 'D' ? -1 : 1) * Number(m.amount), saldo: Number(m.availableBalance),
});
