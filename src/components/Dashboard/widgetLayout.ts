// Dashboard layout metadata + math — deliberately component-free.
//
// The layout logic (default positions, merging a saved layout with the known
// widgets) only needs each widget's id and default geometry, never its React
// component. Keeping it here, apart from widgets.tsx (which imports all eight
// widget components including the recharts chart), lets DashboardLayoutContext
// — loaded eagerly on every authed page — depend on the layout without
// dragging those components into the initial bundle.

// Grid constants — shared with the Dashboard's react-grid-layout config.
export const GRID_COLS = 12;
export const ROW_PX = 20;
export const MIN_W = 2;
export const MAX_W = 12;
export const MIN_H = 3;
export const MAX_H = 40;

export interface WidgetMeta {
  id: string;
  label: string;
  category: 'kpi' | 'content';
  defaultX: number;
  defaultY: number;
  defaultW: number;
  defaultH: number;
  defaultVisible: boolean;
}

// Position/visibility metadata for every widget. widgets.tsx attaches the
// matching React component to each of these by id.
export const WIDGET_META: WidgetMeta[] = [
  // ---- KPIs (rendered inline by Dashboard so the parent owns the data fetch) ----
  { id: 'kpi-clients',         label: 'Total Clients',          category: 'kpi', defaultX: 0, defaultY: 0, defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-invoices',        label: 'Active Invoices',        category: 'kpi', defaultX: 3, defaultY: 0, defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-vat',             label: 'Pending VAT',            category: 'kpi', defaultX: 6, defaultY: 0, defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-overdue',         label: 'Overdue Tasks',          category: 'kpi', defaultX: 9, defaultY: 0, defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-alerts',          label: 'Compliance Alerts',      category: 'kpi', defaultX: 0, defaultY: 5, defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-filings-month',   label: 'Filings Due This Month', category: 'kpi', defaultX: 3, defaultY: 5, defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-filings-overdue', label: 'Overdue Filings',        category: 'kpi', defaultX: 6, defaultY: 5, defaultW: 3, defaultH: 5, defaultVisible: false },

  // ---- Content widgets ----
  { id: 'tasks',           label: 'My Tasks',            category: 'content', defaultX: 0, defaultY: 10, defaultW: 6, defaultH: 14, defaultVisible: true  },
  { id: 'calendar',        label: 'Compliance Calendar', category: 'content', defaultX: 6, defaultY: 10, defaultW: 6, defaultH: 14, defaultVisible: true  },
  { id: 'invoices-trend',  label: 'Invoice Trend',       category: 'content', defaultX: 0, defaultY: 24, defaultW: 6, defaultH: 14, defaultVisible: true  },
  { id: 'quick-actions',   label: 'Quick Actions',       category: 'content', defaultX: 6, defaultY: 24, defaultW: 6, defaultH: 10, defaultVisible: true  },

  // ---- Optional widgets (hidden by default — user enables via Customise panel) ----
  { id: 'recent-clients',  label: 'Recently Added Clients',    category: 'content', defaultX: 0, defaultY: 38, defaultW: 6, defaultH: 14, defaultVisible: false },
  { id: 'pending-week',    label: 'Pending Compliance (Week)', category: 'content', defaultX: 6, defaultY: 38, defaultW: 6, defaultH: 14, defaultVisible: false },
];

export type LayoutWidget = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
};

export type DashboardLayout = { widgets: LayoutWidget[] };

const clampW = (n: number) => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
const clampH = (n: number) => Math.min(MAX_H, Math.max(MIN_H, Math.round(n)));

// Build a default layout from the metadata. Used for first-time users and for
// the "Reset to default" button.
export function buildDefaultLayout(): DashboardLayout {
  return {
    widgets: WIDGET_META.map(w => ({
      id: w.id,
      x: w.defaultX,
      y: w.defaultY,
      w: w.defaultW,
      h: w.defaultH,
      visible: w.defaultVisible,
    })),
  };
}

function normaliseWidget(raw: any, spec: WidgetMeta): LayoutWidget {
  const hasPos =
    Number.isFinite(raw?.x) && Number.isFinite(raw?.y) &&
    Number.isFinite(raw?.w) && Number.isFinite(raw?.h);
  // Layouts saved before free-placement existed have no x/y — fall back to
  // the default position so the dashboard still lays out sensibly.
  return {
    id: spec.id,
    x: hasPos ? Math.max(0, Math.round(raw.x)) : spec.defaultX,
    y: hasPos ? Math.max(0, Math.round(raw.y)) : spec.defaultY,
    w: hasPos ? clampW(raw.w) : spec.defaultW,
    h: hasPos ? clampH(raw.h) : spec.defaultH,
    visible: typeof raw?.visible === 'boolean' ? raw.visible : spec.defaultVisible,
  };
}

// Merge a saved layout with the known widgets: keeps the user's position/size
// choices for widgets they know about, adds entries for any widgets they don't,
// drops entries for widgets that no longer exist.
export function mergeWithRegistry(saved: DashboardLayout | null): DashboardLayout {
  const fallback = buildDefaultLayout();
  if (!saved || !Array.isArray(saved.widgets) || saved.widgets.length === 0) {
    return fallback;
  }
  const specById = new Map(WIDGET_META.map(s => [s.id, s]));
  const seen = new Set<string>();
  const out: LayoutWidget[] = [];
  for (const raw of saved.widgets) {
    const spec = specById.get(raw?.id);
    if (spec && !seen.has(spec.id)) {
      out.push(normaliseWidget(raw, spec));
      seen.add(spec.id);
    }
  }
  for (const spec of WIDGET_META) {
    if (!seen.has(spec.id)) {
      out.push({
        id: spec.id,
        x: spec.defaultX,
        y: spec.defaultY,
        w: spec.defaultW,
        h: spec.defaultH,
        visible: spec.defaultVisible,
      });
    }
  }
  return { widgets: out };
}
