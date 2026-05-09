export interface LineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
}

export interface JournalLine {
  debitAccount: string;
  creditAccount: string;
  amount: number;
  vatCode: string;
  vatAmount: number;
  details: string;
  tAnalysis1: string;
  tAnalysis2: string;
  tAnalysis3: string;
  tAnalysis4: string;
  tAnalysis5: string;
}

export interface Invoice {
  id?: number;
  clientId: number;
  invoiceNumber: string;
  vendorName: string;
  invoiceDate: string; // DD/MM/YYYY
  dueDate?: string;
  totalAmount: number;
  currency: string;
  currencyRate: string;
  rawOcrText: string;
  status: 'draft' | 'reviewed' | 'exported';
  journal: string;
  reference: string;
  journalLines: JournalLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceFile {
  id?: number;
  invoiceId: number;
  fileName: string;
  mimeType: string;
  fileBlob: Blob;
  thumbnailBlob?: Blob;
  createdAt: Date;
}
