import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useDashboardLayout } from '../context/DashboardLayoutContext';
import { api, isStaffRole } from '../services/api';
import KpiTile from './Dashboard/KpiTile';
import SecurityAlertsBanner from './Dashboard/SecurityAlertsBanner';
import CustomisePanel from './Dashboard/CustomisePanel';
import { WIDGET_REGISTRY, ROW_PX, MIN_W, MIN_H } from './Dashboard/widgets';
import { Settings } from 'lucide-react';
import { Toolbar, Button } from './ui';

// react-grid-layout's WidthProvider must wrap the grid once, at module scope —
// calling it on each render would remount the grid.
const GridLayoutWithWidth = WidthProvider(GridLayout);

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Dashboard() {
  const { invoices, clients } = useApp();
  const { user, mfa } = useAuth();
  const showMfaNag = isStaffRole(user) && !mfa.enrolled;

  // ---------- Client view ----------
  if (user?.role === 'client') {
    return <ClientDashboard />;
  }

  // ---------- Staff view (customisable) ----------
  return <StaffDashboard showMfaNag={showMfaNag} userName={user?.display_name} clients={clients} invoices={invoices} />;
}

// Client dashboard — an at-a-glance account summary (their billing position),
// not the scanned-invoice counters staff use.
function ClientDashboard() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [summary, setSummary] = useState<{ balance: number; outstanding: number; lastPayment: string | null } | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getClientStatement(clientId);
        if (cancelled) return;
        const invoiced = (d.invoices as any[]).reduce((s, i) => s + Number(i.total_amount || 0), 0);
        const received = (d.receipts as any[]).reduce((s, r) => s + Number(r.amount || 0), 0);
        const outstanding = (d.invoices as any[]).filter((i) => i.status === 'issued').length;
        const dates = (d.receipts as any[]).map((r) => r.receipt_date).filter(Boolean).sort();
        setSummary({ balance: invoiced - received, outstanding, lastPayment: dates.length ? dates[dates.length - 1] : null });
      } catch { /* RLS / load errors leave the tiles as — */ }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const eur = (n: number) => '€' + n.toFixed(2);
  const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="dashboard">
      <h2>My Dashboard</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-number" style={{ color: summary && summary.balance > 0 ? '#b91c1c' : undefined }}>
            {summary ? eur(summary.balance) : '—'}
          </div>
          <div className="stat-label">Balance due</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{summary ? summary.outstanding : '—'}</div>
          <div className="stat-label">Outstanding invoices</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{summary?.lastPayment ? fmt(summary.lastPayment) : '—'}</div>
          <div className="stat-label">Last payment</div>
        </div>
      </div>
      <div className="quick-actions">
        <Link to="/my-billing" className="btn btn-primary btn-lg">My Account</Link>
        <Link to="/documents" className="btn btn-secondary btn-lg">Upload Documents</Link>
      </div>
    </div>
  );
}

interface StaffDashboardProps {
  showMfaNag: boolean;
  userName?: string;
  clients: any[];
  invoices: any[];
}

function StaffDashboard({ showMfaNag, userName, clients, invoices }: StaffDashboardProps) {
  const { layout, applyLayout, setWidgetVisible } = useDashboardLayout();
  const [customising, setCustomising] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  // Pure vendors (vendor_only) are excluded from the engagement-client count.
  const totalClients   = clients.filter((c: any) => c.client_category !== 'vendor_only').length;
  const activeInvoices = invoices.filter((i: any) => i.status !== 'exported').length;
  const draftInvoices  = invoices.filter((i: any) => i.status === 'draft').length;
  // New clients created this calendar month — drives the Total Clients context line.
  const newClientsThisMonth = (() => {
    const ym = todayIso().slice(0, 7);
    return (clients as any[]).filter(c => String(c.created_at || '').slice(0, 7) === ym).length;
  })();

  const [pendingVat, setPendingVat]             = useState<number | null>(null);
  const [overdueTasks, setOverdueTasks]         = useState<number | null>(null);
  const [complianceAlerts, setComplianceAlerts] = useState<number | null>(null);

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

  const visibleWidgets = useMemo(
    () => layout.widgets.filter(w => w.visible),
    [layout],
  );

  // react-grid-layout's layout array — one entry per visible widget.
  const rglLayout: Layout = useMemo(
    () => visibleWidgets.map(w => ({
      i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: MIN_W, minH: MIN_H,
    })),
    [visibleWidgets],
  );

  // Persist drag/resize changes — only those the user makes in Customise mode
  // (react-grid-layout also fires onLayoutChange on mount / prop changes).
  const handleLayoutChange = (next: Layout) => {
    if (!customising) return;
    applyLayout(next.map(it => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })));
  };

  // Render the inner content for a widget. KPIs are inlined here because they
  // need the data fetched above; content widgets pull from the registry.
  const renderWidgetContent = (id: string) => {
    switch (id) {
      case 'kpi-clients':  return <KpiTile label="Total Clients"     value={totalClients}             to="/clients"    hint={newClientsThisMonth > 0 ? `+${newClientsThisMonth} this month` : 'no new this month'} />;
      case 'kpi-invoices': return <KpiTile label="Active Invoices"   value={activeInvoices}           to="/invoices"   hint={`${draftInvoices} draft${draftInvoices === 1 ? '' : 's'}`} />;
      case 'kpi-vat':      return <KpiTile label="Pending VAT"       value={pendingVat ?? '…'}        to="/compliance" hint="quarterly returns" loading={pendingVat === null} />;
      case 'kpi-overdue':  return <KpiTile label="Overdue Tasks"     value={overdueTasks ?? '…'}      to="/tasks"      hint="past due date" variant={overdueTasks && overdueTasks > 0 ? 'warning' : 'default'} loading={overdueTasks === null} />;
      case 'kpi-alerts':   return <KpiTile label="Compliance Alerts" value={complianceAlerts ?? '…'} to="/compliance" hint="need attention" variant={complianceAlerts && complianceAlerts > 0 ? 'danger' : 'default'} loading={complianceAlerts === null} />;
      default: {
        const spec = WIDGET_REGISTRY.find(s => s.id === id);
        if (!spec?.Component) return null;
        const C = spec.Component;
        return <C />;
      }
    }
  };

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

      <GridLayoutWithWidth
        className={`dashboard-rgl ${customising ? 'customising' : ''}`}
        layout={rglLayout}
        cols={12}
        rowHeight={ROW_PX}
        margin={[14, 14]}
        containerPadding={[0, 0]}
        isDraggable={customising}
        isResizable={customising}
        compactType={null}
        preventCollision
        draggableHandle=".widget-drag-handle"
        onLayoutChange={handleLayoutChange}
      >
        {visibleWidgets.map(w => (
          <div key={w.id} className={`widget-slot ${customising ? 'widget-slot-customising' : ''}`}>
            {customising && (
              <div className="widget-toolbar no-print">
                <button
                  type="button"
                  className="widget-handle widget-drag-handle"
                  title="Drag to move"
                  aria-label="Move widget"
                >⋮⋮</button>
                <button
                  type="button"
                  className="widget-hide-btn"
                  title="Hide this widget"
                  onClick={() => setWidgetVisible(w.id, false)}
                >✕</button>
              </div>
            )}
            <div className="widget-body">{renderWidgetContent(w.id)}</div>
          </div>
        ))}
      </GridLayoutWithWidth>

      {showPanel && <CustomisePanel onClose={() => setShowPanel(false)} />}
    </div>
  );
}
