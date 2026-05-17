import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

export type ViewMode = 'grid' | 'compact' | 'list';
export type ListPage = 'clients' | 'invoices' | 'client_invoices' | 'documents';

interface ViewPreferencesAPI {
  getMode: (page: ListPage, fallback?: ViewMode) => ViewMode;
  setMode: (page: ListPage, mode: ViewMode) => void;
}

const ViewPreferencesContext = createContext<ViewPreferencesAPI | null>(null);

// One-time localStorage → Supabase migration. The previous implementation
// stored choices in localStorage under `<page>_view` with the old labels
// 'cards' / 'table' / 'list'. Map them onto the new vocabulary so people
// don't lose their preferences when this ships.
const LEGACY_KEY: Record<ListPage, string> = {
  clients:         'clients_view',
  invoices:        'invoices_view',
  client_invoices: 'client_invoices_view',
  documents:       'documents_view',
};
const LEGACY_VALUE_MAP: Record<string, ViewMode> = {
  cards:   'grid',
  table:   'list',
  list:    'compact',
  grid:    'grid',
  compact: 'compact',
};
function readLegacy(page: ListPage): ViewMode | null {
  const v = localStorage.getItem(LEGACY_KEY[page]);
  if (!v) return null;
  return LEGACY_VALUE_MAP[v] || null;
}
function clearLegacy(page: ListPage) {
  try { localStorage.removeItem(LEGACY_KEY[page]); } catch {}
}

export function ViewPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, ViewMode>>({});
  const [migrated, setMigrated] = useState(false);

  // Load preferences once per signed-in user
  useEffect(() => {
    if (!user?.id) { setPrefs({}); setMigrated(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const server = await api.getMyViewPreferences();
        if (cancelled) return;
        setPrefs(server as Record<string, ViewMode>);

        // First-load migration: if a page has no server pref but does have a
        // legacy localStorage value, push the legacy value to the server then
        // clear localStorage so we don't keep stale copies.
        if (!migrated) {
          for (const page of Object.keys(LEGACY_KEY) as ListPage[]) {
            if (server[page]) continue;
            const legacy = readLegacy(page);
            if (legacy) {
              try {
                await api.setMyViewPreference(page, legacy);
                if (!cancelled) setPrefs(prev => ({ ...prev, [page]: legacy }));
              } catch {}
              clearLegacy(page);
            }
          }
          if (!cancelled) setMigrated(true);
        }
      } catch {
        // Silent fail — pages will use their per-call fallback
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const getMode = useCallback((page: ListPage, fallback: ViewMode = 'grid'): ViewMode => {
    return (prefs[page] as ViewMode) || fallback;
  }, [prefs]);

  const setMode = useCallback((page: ListPage, mode: ViewMode) => {
    // Optimistic local update, then persist server-side. If save fails the
    // UI stays consistent for this session — next reload re-reads the server.
    setPrefs(prev => ({ ...prev, [page]: mode }));
    api.setMyViewPreference(page, mode).catch(() => {});
  }, []);

  return (
    <ViewPreferencesContext.Provider value={{ getMode, setMode }}>
      {children}
    </ViewPreferencesContext.Provider>
  );
}

export function useViewPreferences(): ViewPreferencesAPI {
  const ctx = useContext(ViewPreferencesContext);
  if (!ctx) throw new Error('useViewPreferences must be used inside ViewPreferencesProvider');
  return ctx;
}
