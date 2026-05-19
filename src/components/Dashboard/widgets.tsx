// Central registry of every widget that can appear on the dashboard.
// Adding a new widget = adding an entry here. The Dashboard component reads
// from this registry; the customisation panel iterates over it; the layout
// merger uses the defaults when a user's saved layout doesn't know a widget.
//
// Widgets are placed on a 12-column grid and freely drag-resized: each has
// a width `w` (columns, 2-12) and a height `h` (row units of ROW_PX each).

import type { ComponentType } from 'react';

// Grid constants — shared by the wrapper's resize maths and the CSS grid.
export const GRID_COLS = 12;
export const ROW_PX = 20;
export const MIN_W = 2;
export const MAX_W = 12;
export const MIN_H = 3;
export const MAX_H = 40;

export interface WidgetSpec {
  id: string;
  label: string;
  category: 'kpi' | 'content';
  defaultW: number;
  defaultH: number;
  defaultVisible: boolean;
  // For KPI tiles we render inline (so the data passed in is shared with the
  // parent fetch). For content widgets we render the standalone component.
  Component?: ComponentType<any>;
}

// Content widget components
import MyTasks from './MyTasks';
import ComplianceCalendar from './ComplianceCalendar';
import InvoiceTrendChart from './InvoiceTrendChart';
import QuickActions from './QuickActions';
import RecentlyAddedClients from './RecentlyAddedClients';
import PendingComplianceWeek from './PendingComplianceWeek';
import FilingsDueThisMonth from './FilingsDueThisMonth';
import OverdueFilings from './OverdueFilings';

export const WIDGET_REGISTRY: WidgetSpec[] = [
  // ---- KPIs (rendered inline by Dashboard so the parent owns the data fetch) ----
  { id: 'kpi-clients',  label: 'Total Clients',   category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-invoices', label: 'Active Invoices', category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-vat',      label: 'Pending VAT',     category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-overdue',  label: 'Overdue Tasks',   category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: true  },
  { id: 'kpi-alerts',          label: 'Compliance Alerts',      category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: true,  Component: undefined },
  { id: 'kpi-filings-month',   label: 'Filings Due This Month', category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: true,  Component: FilingsDueThisMonth },
  { id: 'kpi-filings-overdue', label: 'Overdue Filings',        category: 'kpi', defaultW: 3, defaultH: 5, defaultVisible: false, Component: OverdueFilings },

  // ---- Content widgets ----
  { id: 'tasks',           label: 'My Tasks',            category: 'content', defaultW: 6, defaultH: 14, defaultVisible: true,  Component: MyTasks },
  { id: 'calendar',        label: 'Compliance Calendar', category: 'content', defaultW: 6, defaultH: 14, defaultVisible: true,  Component: ComplianceCalendar },
  { id: 'invoices-trend',  label: 'Invoice Trend',       category: 'content', defaultW: 6, defaultH: 14, defaultVisible: true,  Component: InvoiceTrendChart },
  { id: 'quick-actions',   label: 'Quick Actions',       category: 'content', defaultW: 6, defaultH: 10, defaultVisible: true,  Component: QuickActions },

  // ---- Optional widgets (hidden by default — user enables via Customise panel) ----
  { id: 'recent-clients',  label: 'Recently Added Clients',    category: 'content', defaultW: 6, defaultH: 14, defaultVisible: false, Component: RecentlyAddedClients },
  { id: 'pending-week',    label: 'Pending Compliance (Week)', category: 'content', defaultW: 6, defaultH: 14, defaultVisible: false, Component: PendingComplianceWeek },
];

export type LayoutWidget = {
  id: string;
  w: number;
  h: number;
  visible: boolean;
  order: number;
};

export type DashboardLayout = { widgets: LayoutWidget[] };

const clampW = (n: number) => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
const clampH = (n: number) => Math.min(MAX_H, Math.max(MIN_H, Math.round(n)));

// Build a default layout from the registry. Used for first-time users and for
// the "Reset to default" button.
export function buildDefaultLayout(): DashboardLayout {
  return {
    widgets: WIDGET_REGISTRY.map((w, i) => ({
      id: w.id,
      w: w.defaultW,
      h: w.defaultH,
      visible: w.defaultVisible,
      order: i,
    })),
  };
}

// Legacy S/M/L sizes → width/height, for migrating layouts saved before
// drag-resize existed.
const LEGACY_SIZE: Record<string, { w: number; h: number }> = {
  small:  { w: 3,  h: 5  },
  medium: { w: 6,  h: 14 },
  large:  { w: 12, h: 16 },
};

function normaliseWidget(raw: any, spec: WidgetSpec): LayoutWidget {
  let w = Number(raw?.w);
  let h = Number(raw?.h);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    // Pre-drag-resize layout — convert the old `size` field.
    const legacy = LEGACY_SIZE[raw?.size] || { w: spec.defaultW, h: spec.defaultH };
    w = legacy.w;
    h = legacy.h;
  }
  return {
    id: spec.id,
    w: clampW(w),
    h: clampH(h),
    visible: typeof raw?.visible === 'boolean' ? raw.visible : spec.defaultVisible,
    order: Number.isFinite(raw?.order) ? Number(raw.order) : 0,
  };
}

// Merge a saved layout with the registry: keeps the user's size/order choices
// for widgets they know about, adds entries for any registry widgets they
// don't, drops entries for widgets that no longer exist. Also migrates the
// old S/M/L `size` field to the new width/height model.
export function mergeWithRegistry(saved: DashboardLayout | null): DashboardLayout {
  const fallback = buildDefaultLayout();
  if (!saved || !Array.isArray(saved.widgets) || saved.widgets.length === 0) {
    return fallback;
  }
  const specById = new Map(WIDGET_REGISTRY.map(s => [s.id, s]));
  const seen = new Set<string>();
  const out: LayoutWidget[] = [];
  for (const raw of saved.widgets) {
    const spec = specById.get(raw?.id);
    if (spec && !seen.has(spec.id)) {
      out.push(normaliseWidget(raw, spec));
      seen.add(spec.id);
    }
  }
  let nextOrder = Math.max(-1, ...out.map(w => w.order)) + 1;
  for (const spec of WIDGET_REGISTRY) {
    if (!seen.has(spec.id)) {
      out.push({
        id: spec.id,
        w: spec.defaultW,
        h: spec.defaultH,
        visible: spec.defaultVisible,
        order: nextOrder++,
      });
    }
  }
  return { widgets: out };
}
