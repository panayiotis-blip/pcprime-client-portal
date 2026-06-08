import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { ParsedInvoice } from '../services/ocr/invoiceParser';

export interface ScannedInvoice {
  fileBlob: Blob;
  fileName: string;
  mimeType: string;
  parsed: ParsedInvoice;
  rawOcrText: string;
  confidence: number;
  // Per-field self-assessed confidence from the AI extractor (0-100). Keys
  // match the extract-document tool schema: vendor_name, invoice_number,
  // invoice_date, total_amount, subtotal, vat_amount, vat_rate, currency.
  fieldConfidences?: Record<string, number>;
  // Short notes from the extractor about anything ambiguous it noticed
  // (e.g. "two TOTAL labels — chose the lower one").
  fieldNotes?: string[];
  journalCode: string;
  clientId: number;
}

interface ScanContextType {
  scannedInvoices: React.MutableRefObject<ScannedInvoice[]>;
  currentIndex: React.MutableRefObject<number>;
}

const ScanContext = createContext<ScanContextType>({
  scannedInvoices: { current: [] },
  currentIndex: { current: 0 },
});

export function ScanProvider({ children }: { children: ReactNode }) {
  const scannedInvoices = useRef<ScannedInvoice[]>([]);
  const currentIndex = useRef(0);

  return (
    <ScanContext.Provider value={{ scannedInvoices, currentIndex }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  return useContext(ScanContext);
}
