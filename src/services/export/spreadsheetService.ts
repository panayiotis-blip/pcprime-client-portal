import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import type { Invoice } from '../../types/invoice';

const BTMS_HEADERS = [
  'Journal',
  'Reference',
  'Date(DD/MM/YYYY)',
  'Debit Account',
  'Credit Account',
  'Amount',
  'Vat',
  'Vat Amount',
  'Details',
  'Currency',
  'Currency rate',
  'T Analysis 1',
  'T Analysis 2',
  'T Analysis 3',
  'T Analysis 4',
  'T Analysis 5',
];

function invoiceToRows(invoice: Invoice): Record<string, string | number>[] {
  // Each journal line becomes a separate row in the BTMS export
  if (invoice.journalLines && invoice.journalLines.length > 0) {
    return invoice.journalLines.map((line) => ({
      Journal: invoice.journal || 'JV',
      Reference: invoice.reference || '',
      'Date(DD/MM/YYYY)': invoice.invoiceDate || '',
      'Debit Account': line.debitAccount || '',
      'Credit Account': line.creditAccount || '',
      Amount: line.amount || 0,
      Vat: line.vatCode || '',
      'Vat Amount': line.vatAmount || 0,
      Details: line.details || '',
      Currency: invoice.currency || '',
      'Currency rate': invoice.currencyRate || '',
      'T Analysis 1': line.tAnalysis1 || '',
      'T Analysis 2': line.tAnalysis2 || '',
      'T Analysis 3': line.tAnalysis3 || '',
      'T Analysis 4': line.tAnalysis4 || '',
      'T Analysis 5': line.tAnalysis5 || '',
    }));
  }

  // Fallback: single row with invoice total
  return [{
    Journal: invoice.journal || 'JV',
    Reference: invoice.reference || '',
    'Date(DD/MM/YYYY)': invoice.invoiceDate || '',
    'Debit Account': '',
    'Credit Account': '',
    Amount: invoice.totalAmount || 0,
    Vat: '',
    'Vat Amount': 0,
    Details: '',
    Currency: invoice.currency || '',
    'Currency rate': invoice.currencyRate || '',
    'T Analysis 1': '',
    'T Analysis 2': '',
    'T Analysis 3': '',
    'T Analysis 4': '',
    'T Analysis 5': '',
  }];
}

export function generateExcel(invoices: Invoice[], fileName: string = 'btms_import'): void {
  const rows = invoices.flatMap(invoiceToRows);
  const ws = XLSX.utils.json_to_sheet(rows, { header: BTMS_HEADERS });
  ws['!cols'] = BTMS_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 15) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `${fileName}.xlsx`);
}

export function generateCSV(invoices: Invoice[], fileName: string = 'btms_import'): void {
  const rows = invoices.flatMap(invoiceToRows);
  const ws = XLSX.utils.json_to_sheet(rows, { header: BTMS_HEADERS });
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, `${fileName}.csv`);
}
