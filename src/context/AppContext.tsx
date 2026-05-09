import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
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

  const refreshClients = async () => {
    try { setClients(await api.getClients()); } catch {}
  };

  const refreshInvoices = async () => {
    try { setInvoices(await api.getInvoices()); } catch {}
  };

  useEffect(() => {
    if (user) {
      refreshClients();
      refreshInvoices();
    }
  }, [user]);

  return (
    <AppContext.Provider value={{ clients, invoices, refreshClients, refreshInvoices }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
