import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

interface AppState {
  clients: any[];
  invoices: any[];
  refreshClients: () => Promise<void>;
  refreshInvoices: () => Promise<void>;
}

const AppContext = createContext<AppState>({
  clients: [], invoices: [],
  refreshClients: async () => {}, refreshInvoices: async () => {},
});

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);

  // Stable identities: these are handed to consumers through context and are
  // used in effect dependency arrays, so re-creating them every render would
  // defeat the memoised value below.
  const refreshClients = useCallback(async () => {
    try { setClients(await api.getClients()); } catch {}
  }, []);

  const refreshInvoices = useCallback(async () => {
    try { setInvoices(await api.getInvoices()); } catch {}
  }, []);

  useEffect(() => {
    if (user) {
      refreshClients();
      refreshInvoices();
    }
  }, [user, refreshClients, refreshInvoices]);

  // Without this, the provider hands every consumer a brand-new object on each
  // render, re-rendering all of them whenever anything in the tree changes.
  const value = useMemo(
    () => ({ clients, invoices, refreshClients, refreshInvoices }),
    [clients, invoices, refreshClients, refreshInvoices],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
