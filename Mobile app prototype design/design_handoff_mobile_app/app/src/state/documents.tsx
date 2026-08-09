import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

import * as portal from '../api/portal';
import { ClientDocument } from '../data/types';

type DocumentsState = {
  documents: ClientDocument[];
  /** Upload from the sheet. The new document lands at the top of the list. */
  upload: (source: string) => void;
};

const DocumentsContext = createContext<DocumentsState | null>(null);

export function useDocuments() {
  const value = useContext(DocumentsContext);
  if (!value) throw new Error('useDocuments must be used inside <DocumentsProvider>');
  return value;
}

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<ClientDocument[]>(() => portal.loadDocuments());

  const upload = useCallback((source: string) => {
    setDocuments((current) => [portal.uploadDocument(source), ...current]);
  }, []);

  const value = useMemo(() => ({ documents, upload }), [documents, upload]);

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}
