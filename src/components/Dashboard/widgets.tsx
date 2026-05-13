// Central registry of every widget that can appear on the dashboard.
// Adding a new widget = adding an entry here. The Dashboard component reads
// from this registry; the customisation panel iterates over it; the layout
// merger uses defaultSize/defaultVisible when a user's saved layout doesn't
// know about a newer widget.

import type { ComponentType } from 'react';

export type WidgetSize = 'small' | 'medium' | 'large';

export interface WidgetSpec {
  id: string;
  label: string;
  category: 'kpi' | 'content';
  defaultSize: WidgetSize;
  defaultVisible: boolean;
  // For KPI tiles we render inline (so the data passed in is shared with the
  // parent fetch). For content widgets we render the standalone component.
  Component?: ComponentType<any>;
}

// Content widget components (lazy import to keep this file tidy)
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
  { id: 'kpi-clients',  label: 'Total Clients',     category: 'kpi', defaultSize: 'small',  defaultVisible: true  },
  { id: 'kpi-invoices', label: 'Active Invoices',   category: 'kpi', defaultSize: 'small',  defaultVisible: true  },
  { id: 'kpi-vat',      label: 'Pending VAT',       category: 'kpi', defaultSize: 'small',  defaultVisible: true  },
  { id: 'kpi-overdue',  label: 'Overdue Tasks',     category: 'kpi', defaultSize: 'small',  defaultVisible: true  },
  { id: 'kpi-alerts',          label: 'Compliance Alerts',     category: 'kpi', defaultSize: 'small',  defaultVisible: true,  Component: undefined },
  { id: 'kpi-filings-month',   label: 'Filings Due This Month', category: 'kpi', defaultSize: 'small',  defaultVisible: true,  Component: FilingsDueThisMonth },
  { id: 'kpi-filings-overdue', label: 'Overdue Filings',        category: 'kpi', defaultSize: 'small',  defaultVisible: true,  Component: OverdueFilings },

  // ---- Content widgets ----
  { id: 'tasks',           label: 'My Tasks',                category: 'content', defaultSize: 'medium', defaultVisible: true,  Component: MyTasks },
  { id: 'calendar',        label: 'Compliance Calendar',     category: 'content', defaultSize: 'medium', defaultVisible: true,  Component: ComplianceCalendar },
  { id: 'invoices-trend',  label: 'Invoice Trend',           category: 'content', defaultSize: 'medium', defaultVisible: true,  Component: InvoiceTrendChart },
  { id: 'quick-actions',   label: 'Quick Actions',           category: 'content', defaultSize: 'medium', defaultVisible: true,  Component: QuickActions },

  // ---- Optional widgets (hidden by default — user enables via Customise panel) ----
  { id: 'recent-clients',  label: 'Recently Added Clients',  category: 'content', defaultSize: 'medium', defaultVisible: false, Component: RecentlyAddedClients },
  { id: 'pending-week',    label: 'Pending Compliance (Week)', category: 'content', defaultSize: 'medium', defaultVisible: false, Component: PendingComplianceWeek },
];

export type LayoutWidget = {
  id: string;
  size: WidgetSize;
  visible: boolean;
  order: number;
};

export type DashboardLayout = { widgets: LayoutWidget[] };

// Build a default layout from the registry. Used for first-time users and for
// the "Reset to default" button.
export function buildDefaultLayout(): DashboardLayout {
  return {
    widgets: WIDGET_REGISTRY.map((w, i) => ({
      id: w.id,
      size: w.defaultSize,
      visible: w.defaultVisible,
      order: i,
    })),
  };
}

// Merge a saved layout with the registry: keeps user choices for widgets they
// know about; adds entries for any registry widgets they don't (at the
// registry's default visibility/size); drops entries for widgets that no
// longer exist in code.
export function mergeWithRegistry(saved: DashboardLayout | null): DashboardLayout {
  const fallback = buildDefaultLayout();
  if (!saved || !Array.isArray(saved.widgets) || saved.widgets.length === 0) {
    return fallback;
  }
  const knownIds = new Set(WIDGET_REGISTRY.map(w => w.id));
  const savedById = new Map<string, LayoutWidget>(
    saved.widgets.filter(w => knownIds.has(w.id)).map(w => [w.id, w])
  );
  // Start with saved (preserves user's order/size choices)
  const out: LayoutWidget[] = [];
  for (const w of saved.widgets) {
    if (knownIds.has(w.id)) out.push({ ...w });
  }
  // Append any registry widgets the user hasn't seen yet, at end, with defaults
  let nextOrder = Math.max(-1, ...out.map(w => w.order)) + 1;
  for (const spec of WIDGET_REGISTRY) {
    if (!savedById.has(spec.id)) {
      out.push({
        id: spec.id,
        size: spec.defaultSize,
        visible: spec.defaultVisible,
        order: nextOrder++,
      });
    }
  }
  return { widgets: out };
}
