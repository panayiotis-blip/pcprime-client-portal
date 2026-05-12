import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';
import {
  buildDefaultLayout,
  mergeWithRegistry,
  type DashboardLayout,
  type WidgetSize,
} from '../components/Dashboard/widgets';

interface DashboardLayoutAPI {
  layout: DashboardLayout;
  resetLayout: () => void;
  setWidgetSize: (id: string, size: WidgetSize) => void;
  setWidgetVisible: (id: string, visible: boolean) => void;
  reorder: (orderedIds: string[]) => void;
}

const DashboardLayoutContext = createContext<DashboardLayoutAPI | null>(null);

const SAVE_DEBOUNCE_MS = 500;

export function DashboardLayoutProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [layout, setLayout] = useState<DashboardLayout>(buildDefaultLayout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Load on sign-in
  useEffect(() => {
    if (!user?.id) { setLayout(buildDefaultLayout()); return; }
    let cancelled = false;
    (async () => {
      try {
        const saved = await api.getMyDashboardLayout();
        if (cancelled) return;
        setLayout(mergeWithRegistry(saved as DashboardLayout | null));
      } catch {
        if (!cancelled) setLayout(buildDefaultLayout());
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Debounced server save — fires SAVE_DEBOUNCE_MS after the last mutation
  const queueSave = useCallback((next: DashboardLayout) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.setMyDashboardLayout(next).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const mutate = useCallback((updater: (prev: DashboardLayout) => DashboardLayout) => {
    setLayout(prev => {
      const next = updater(prev);
      queueSave(next);
      return next;
    });
  }, [queueSave]);

  const resetLayout = useCallback(() => {
    const def = buildDefaultLayout();
    setLayout(def);
    queueSave(def);
  }, [queueSave]);

  const setWidgetSize = useCallback((id: string, size: WidgetSize) => {
    mutate(prev => ({
      widgets: prev.widgets.map(w => w.id === id ? { ...w, size } : w),
    }));
  }, [mutate]);

  const setWidgetVisible = useCallback((id: string, visible: boolean) => {
    mutate(prev => ({
      widgets: prev.widgets.map(w => w.id === id ? { ...w, visible } : w),
    }));
  }, [mutate]);

  const reorder = useCallback((orderedIds: string[]) => {
    mutate(prev => {
      const byId = new Map(prev.widgets.map(w => [w.id, w]));
      const newWidgets = orderedIds
        .map((id, i) => {
          const w = byId.get(id);
          return w ? { ...w, order: i } : null;
        })
        .filter(Boolean) as DashboardLayout['widgets'];
      // Append any widgets not in the ordered list (shouldn't happen but
      // protects against bugs in callers)
      for (const w of prev.widgets) {
        if (!orderedIds.includes(w.id)) newWidgets.push({ ...w, order: newWidgets.length });
      }
      return { widgets: newWidgets };
    });
  }, [mutate]);

  return (
    <DashboardLayoutContext.Provider value={{ layout, resetLayout, setWidgetSize, setWidgetVisible, reorder }}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout(): DashboardLayoutAPI {
  const ctx = useContext(DashboardLayoutContext);
  if (!ctx) throw new Error('useDashboardLayout must be used inside DashboardLayoutProvider');
  return ctx;
}
