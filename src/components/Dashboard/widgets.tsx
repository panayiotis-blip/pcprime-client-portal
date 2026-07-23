// Central registry of every widget that can appear on the dashboard, WITH its
// React component attached. Dashboard reads this to render; the customisation
// panel iterates it.
//
// The layout metadata and math live in widgetLayout.ts, which imports no
// components — so DashboardLayoutContext (eager on every authed page) can use
// the layout without pulling these components (incl. the recharts chart) into
// the initial bundle. This file is only reached from the lazy Dashboard chunk.
//
// Adding a new widget = add its metadata to widgetLayout.ts's WIDGET_META and,
// if it has a standalone component, wire it into COMPONENTS_BY_ID below.

import type { ComponentType } from 'react';
import { WIDGET_META, type WidgetMeta } from './widgetLayout';

// Re-export the layout surface so existing importers of './widgets' are unaffected.
export {
  GRID_COLS, ROW_PX, MIN_W, MAX_W, MIN_H, MAX_H,
  buildDefaultLayout, mergeWithRegistry,
} from './widgetLayout';
export type { WidgetMeta, LayoutWidget, DashboardLayout } from './widgetLayout';

// Content widget components
import MyTasks from './MyTasks';
import ComplianceCalendar from './ComplianceCalendar';
import InvoiceTrendChart from './InvoiceTrendChart';
import QuickActions from './QuickActions';
import RecentlyAddedClients from './RecentlyAddedClients';
import PendingComplianceWeek from './PendingComplianceWeek';
import FilingsDueThisMonth from './FilingsDueThisMonth';
import OverdueFilings from './OverdueFilings';

export interface WidgetSpec extends WidgetMeta {
  // For KPI tiles we render inline (so the data passed in is shared with the
  // parent fetch). For content widgets we render the standalone component.
  Component?: ComponentType<any>;
}

// id → standalone component. KPIs rendered inline by Dashboard have no entry.
const COMPONENTS_BY_ID: Record<string, ComponentType<any>> = {
  'kpi-filings-month':   FilingsDueThisMonth,
  'kpi-filings-overdue': OverdueFilings,
  'tasks':               MyTasks,
  'calendar':            ComplianceCalendar,
  'invoices-trend':      InvoiceTrendChart,
  'quick-actions':       QuickActions,
  'recent-clients':      RecentlyAddedClients,
  'pending-week':        PendingComplianceWeek,
};

export const WIDGET_REGISTRY: WidgetSpec[] = WIDGET_META.map(meta => ({
  ...meta,
  Component: COMPONENTS_BY_ID[meta.id],
}));
