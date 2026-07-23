import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';
import {
  buildDefaultLayout,
  mergeWithRegistry,
  type DashboardLayout,
} from '../components/Dashboard/widgetLayout';

interface DashboardLayoutAPI {
  layout: DashboardLayout;
  resetLayout: () => void;
  applyLayout: (items: { id: string; x: number; y: number; w: number; h: number }[]) => void;
  setWidgetVisible: (id: string, visible: boolean) => void;
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

  // Apply react-grid-layout's onLayoutChange — sets each widget's x/y/w/h.
  const applyLayout = useCallback((items: { id: string; x: number; y: number; w: number; h: number }[]) => {
    const pos = new Map(items.map(it => [it.id, it]));
    mutate(prev => ({
      widgets: prev.widgets.map(w => {
        const p = pos.get(w.id);
        return p ? { ...w, x: p.x, y: p.y, w: p.w, h: p.h } : w;
      }),
    }));
  }, [mutate]);

  const setWidgetVisible = useCallback((id: string, visible: boolean) => {
    mutate(prev => ({
      widgets: prev.widgets.map(w => w.id === id ? { ...w, visible } : w),
    }));
  }, [mutate]);

  return (
    <DashboardLayoutContext.Provider value={{ layout, resetLayout, applyLayout, setWidgetVisible }}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout(): DashboardLayoutAPI {
  const ctx = useContext(DashboardLayoutContext);
  if (!ctx) throw new Error('useDashboardLayout must be used inside DashboardLayoutProvider');
  return ctx;
}
