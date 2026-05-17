import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useDashboardLayout } from '../context/DashboardLayoutContext';
import { api, isStaffRole } from '../services/api';
import KpiTile from './Dashboard/KpiTile';
import SecurityAlertsBanner from './Dashboard/SecurityAlertsBanner';
import WidgetWrapper from './Dashboard/WidgetWrapper';
import CustomisePanel from './Dashboard/CustomisePanel';
import { WIDGET_REGISTRY } from './Dashboard/widgets';
import { Settings } from 'lucide-react';
import { Toolbar, Button } from './ui';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Dashboard() {
  const { invoices, clients } = useApp();
  const { user, mfa } = useAuth();
  const showMfaNag = isStaffRole(user) && !mfa.enrolled;

  // ---------- Client view (unchanged from Task 1 — no customisation) ----------
  if (user?.role === 'client') {
    const myInvoices = invoices;
    return (
      <div className="dashboard">
        <h2>My Dashboard</h2>
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-number">{myInvoices.length}</div><div className="stat-label">Invoices</div></div>
          <div className="stat-card stat-draft"><div className="stat-number">{myInvoices.filter((i: any) => i.status === 'draft').length}</div><div className="stat-label">Drafts</div></div>
          <div className="stat-card stat-reviewed"><div className="stat-number">{myInvoices.filter((i: any) => i.status === 'reviewed').length}</div><div className="stat-label">Reviewed</div></div>
          <div className="stat-card stat-exported"><div className="stat-number">{myInvoices.filter((i: any) => i.status === 'exported').length}</div><div className="stat-label">Exported</div></div>
        </div>
        <div className="quick-actions">
          <Link to="/documents" className="btn btn-primary btn-lg">Upload Documents</Link>
          <Link to="/invoices" className="btn btn-secondary btn-lg">View Invoices</Link>
        </div>
      </div>
    );
  }

  // ---------- Staff view (customisable) ----------
  return <StaffDashboard showMfaNag={showMfaNag} userName={user?.display_name} clients={clients} invoices={invoices} />;
}

interface StaffDashboardProps {
  showMfaNag: boolean;
  userName?: string;
  clients: any[];
  invoices: any[];
}

function StaffDashboard({ showMfaNag, userName, clients, invoices }: StaffDashboardProps) {
  const { layout, reorder } = useDashboardLayout();
  const [customising, setCustomising] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const totalClients   = clients.length;
  const activeInvoices = invoices.filter((i: any) => i.status !== 'exported').length;

  const [pendingVat, setPendingVat]               = useState<number | null>(null);
  const [overdueTasks, setOverdueTasks]           = useState<number | null>(null);
  const [complianceAlerts, setComplianceAlerts]   = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const today = todayIso();
    (async () => {
      try {
        const vat = await api.getComplianceTasks({ kind: 'vat_quarterly' });
        if (!mounted) return;
        setPendingVat((vat as any[]).filter(t => t.status !== 'filed' && t.status !== 'completed').length);

        const allCompliance = await api.getComplianceTasks({});
        if (!mounted) return;
        setComplianceAlerts((allCompliance as any[]).filter(
          t => t.status !== 'filed' && t.status !== 'completed' && t.due_date < today,
        ).length);

        const tasks = await api.getStaffTasks({});
        if (!mounted) return;
        setOverdueTasks((tasks as any[]).filter(
          t => t.status !== 'done' && t.status !== 'cancelled' && t.due_date && t.due_date < today,
        ).length);
      } catch {
        // Tiles fall back to '…' on error
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Sort widgets by saved order, then render only visible ones
  const visibleWidgets = useMemo(() => {
    return [...layout.widgets]
      .filter(w => w.visible)
      .sort((a, b) => a.order - b.order);
  }, [layout]);

  const widgetIds = useMemo(() => visibleWidgets.map(w => w.id), [visibleWidgets]);

  // Render the inner content for a widget. KPIs are inlined here because they
  // need the data fetched above; content widgets pull from the registry.
  const renderWidgetContent = (id: string) => {
    switch (id) {
      case 'kpi-clients':  return <KpiTile label="Total Clients"     value={totalClients}             to="/clients" />;
      case 'kpi-invoices': return <KpiTile label="Active Invoices"   value={activeInvoices}           to="/invoices" hint="drafts + reviewed" />;
      case 'kpi-vat':      return <KpiTile label="Pending VAT"       value={pendingVat ?? '…'}        to="/compliance" loading={pendingVat === null} />;
      case 'kpi-overdue':  return <KpiTile label="Overdue Tasks"     value={overdueTasks ?? '…'}      to="/tasks"      variant={overdueTasks && overdueTasks > 0 ? 'warning' : 'default'} loading={overdueTasks === null} />;
      case 'kpi-alerts':   return <KpiTile label="Compliance Alerts" value={complianceAlerts ?? '…'} to="/compliance" variant={complianceAlerts && complianceAlerts > 0 ? 'danger' : 'default'} loading={complianceAlerts === null} />;
      default: {
        const spec = WIDGET_REGISTRY.find(s => s.id === id);
        if (!spec?.Component) return null;
        const C = spec.Component;
        return <C />;
      }
    }
  };

  // ---- DnD setup (only active while in customise mode) ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = widgetIds.indexOf(String(active.id));
    const newIndex = widgetIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = [...widgetIds];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, String(active.id));
    // Also include hidden widgets after, preserving their relative order
    const hiddenIds = layout.widgets
      .filter(w => !w.visible)
      .sort((a, b) => a.order - b.order)
      .map(w => w.id);
    reorder([...newOrder, ...hiddenIds]);
  };

  const gridBody = (
    <div className={`dashboard-grid-12 ${customising ? 'dashboard-grid-customising' : ''}`}>
      {visibleWidgets.map(w => (
        <WidgetWrapper key={w.id} id={w.id} size={w.size} customising={customising}>
          {renderWidgetContent(w.id)}
        </WidgetWrapper>
      ))}
    </div>
  );

  return (
    <div className="dashboard">
      <SecurityAlertsBanner />
      {showMfaNag && (
        <div style={{
          padding: '12px 16px',
          marginBottom: 16,
          background: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <strong>Two-factor authentication is not enabled.</strong>{' '}
            We strongly recommend enabling it on your account.
          </div>
          <Link to="/security" className="btn btn-primary btn-sm">Enable now</Link>
        </div>
      )}

      <Toolbar
        title="Dashboard"
        actions={
          customising ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowPanel(true)}>
                Widgets…
              </Button>
              <Button variant="primary" size="sm" onClick={() => { setCustomising(false); setShowPanel(false); }}>
                Done
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Settings size={15} />}
              onClick={() => { setCustomising(true); setShowPanel(true); }}
            >
              Customise
            </Button>
          )
        }
      >
        <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
          Welcome back, {userName}
        </span>
      </Toolbar>

      {customising ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
            {gridBody}
          </SortableContext>
        </DndContext>
      ) : (
        gridBody
      )}

      {showPanel && <CustomisePanel onClose={() => setShowPanel(false)} />}
    </div>
  );
}
