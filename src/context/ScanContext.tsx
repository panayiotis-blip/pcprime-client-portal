import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { ParsedInvoice } from '../services/ocr/invoiceParser';

export interface ScannedInvoice {
  fileBlob: Blob;
  fileName: string;
  mimeType: string;
  parsed: ParsedInvoice;
  rawOcrText: string;
  confidence: number;
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
