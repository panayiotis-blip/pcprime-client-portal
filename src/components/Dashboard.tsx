import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useDashboardLayout } from '../context/DashboardLayoutContext';
import { api, isStaffRole } from '../services/api';
import { formatDate } from '../services/dates';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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
  const [profile,       setProfile]       = useState<any>(null);
  const [expenses,      setExpenses]      = useState<any[]>([]);
  const [salesInvoices, setSalesInvoices] = useState<any[]>([]);
  const [threads,       setThreads]       = useState<any[]>([]);
  const [deadlines,     setDeadlines]     = useState<any[]>([]);
  const [statement,     setStatement]     = useState<any>(null);
  const [unread,        setUnread]        = useState(0);

  useEffect(() => {
    if (!clientId) return;
    api.getMyUnreadMessageCount(clientId).then(setUnread).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      const [p, exp, inv, thr, dl, stm] = await Promise.all([
        api.getCompanyProfile(clientId).catch(() => null),
        api.getMyExpenses(clientId).catch(() => []),
        api.getCustomerInvoices(clientId).catch(() => []),
        api.getClientThreads(clientId).catch(() => []),
        api.getClientTaxFilings(clientId).catch(() => []),
        api.getClientStatement(clientId).catch(() => null),
      ]);
      if (cancelled) return;
      setProfile(p); setExpenses(exp as any[]); setSalesInvoices(inv as any[]);
      setThreads(thr as any[]); setDeadlines(dl as any[]); setStatement(stm);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const eur = (n: number) => '€' + n.toFixed(2);
  const fmt = (iso: string) => formatDate(iso);
  const monthOf = (s: string | null | undefined) => s ? String(s).slice(0, 7) : '';
  const invNet  = (i: any) => Number(i.total_amount || 0) - Number(i.vat_amount || 0);
  const expNet  = (e: any) => Number(e.amount || 0) - Number(e.vat_amount || 0);

  const thisYM = todayIso().slice(0, 7);
  const last6  = (() => {
    const now = new Date(); const out: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  })();

  const expensesCounted   = expenses.filter(e => e.status !== 'rejected');
  const salesIssuedPaid   = salesInvoices.filter(i => i.status === 'issued' || i.status === 'paid');
  const incomeThisMonth   = salesIssuedPaid.filter(i => monthOf(i.issue_date) === thisYM).reduce((s, i) => s + invNet(i), 0);
  const expensesThisMonth = expensesCounted.filter(e => monthOf(e.expense_date || e.created_at) === thisYM).reduce((s, e) => s + expNet(e), 0);
  const outstanding       = salesInvoices.filter(i => i.status === 'issued').reduce((s, i) => s + Number(i.total_amount || 0), 0);
  const firmBalance       = statement
    ? (statement.invoices as any[]).reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0)
      - (statement.receipts as any[]).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
    : null;

  const chartData = last6.map(ym => ({
    month: ym.slice(5) + '/' + ym.slice(2, 4),
    Income:   salesIssuedPaid.filter(i => monthOf(i.issue_date) === ym).reduce((s, i) => s + invNet(i), 0),
    Expenses: expensesCounted.filter(e => monthOf(e.expense_date || e.created_at) === ym).reduce((s, e) => s + expNet(e), 0),
  }));

  const messagesPreview = threads.filter(t => t.last_body).slice(0, 3);
  const recentExpenses  = expenses.slice(0, 3);
  const today           = todayIso();
  const upcomingDeadlines = deadlines
    .filter(d => d.due_date && d.due_date >= today && d.status !== 'completed' && d.status !== 'filed')
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .slice(0, 3);

  return (
    <div className="dashboard">
      <h2>Welcome back{profile?.business_name ? `, ${profile.business_name}` : ''}</h2>

      {unread > 0 && (
        <Link to="/my-messages" className="card" style={{ display: 'block', marginBottom: 12, background: '#dbeafe', color: '#1e40af', textDecoration: 'none', fontWeight: 500 }}>
          📨 You have <strong>{unread}</strong> new message{unread === 1 ? '' : 's'} — open Messages
        </Link>
      )}

      {/* KPI tiles */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-number" style={{ color: '#166534' }}>{eur(incomeThisMonth)}</div>
          <div className="stat-label">Income this month</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: expensesThisMonth > 0 ? '#92400e' : undefined }}>{eur(expensesThisMonth)}</div>
          <div className="stat-label">Expenses this month</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: outstanding > 0 ? '#1e40af' : undefined }}>{eur(outstanding)}</div>
          <div className="stat-label">Owed to you</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: firmBalance && firmBalance > 0 ? '#b91c1c' : undefined }}>{firmBalance != null ? eur(firmBalance) : '—'}</div>
          <div className="stat-label">Balance with us</div>
        </div>
      </div>

      {/* Trend chart — TEMPORARILY hidden on phones while we diagnose an iOS
          tap-routing issue that only happens on the dashboard. */}
      <div className="card hide-on-mobile" style={{ marginBottom: 16, isolation: 'isolate', position: 'relative', zIndex: 0 }}>
        <h3 style={{ marginTop: 0 }}>Income vs Expenses — last 6 months</h3>
        <div style={{ width: '100%', height: 260, touchAction: 'pan-y' }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => '€' + Math.round(v).toString()} />
              <Tooltip formatter={(v: any) => '€' + Number(v).toFixed(2)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Income"   fill="#16a34a" />
              <Bar dataKey="Expenses" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Preview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>📨 Latest messages</h3>
            <Link to="/my-messages" style={{ fontSize: 12 }}>Open</Link>
          </div>
          {messagesPreview.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>No messages yet.</p>
          ) : messagesPreview.map(t => (
            <div key={t.id} style={{ paddingBottom: 6, borderBottom: '1px solid #f1f5f9', marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t.subject}</div>
              <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.last_body}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>🧾 Recent expenses</h3>
            <Link to="/my-expenses" style={{ fontSize: 12 }}>All</Link>
          </div>
          {recentExpenses.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>No expenses uploaded yet.</p>
          ) : recentExpenses.map((e: any) => (
            <div key={e.id} style={{ paddingBottom: 6, borderBottom: '1px solid #f1f5f9', marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.vendor_name || '—'}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{fmt(e.expense_date || e.created_at)} · {e.expense_type || '—'}</div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{eur(Number(e.amount || 0))}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>⏰ Upcoming deadlines</h3>
            <Link to="/my-deadlines" style={{ fontSize: 12 }}>All</Link>
          </div>
          {upcomingDeadlines.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>No upcoming deadlines.</p>
          ) : upcomingDeadlines.map((d: any, i: number) => (
            <div key={i} style={{ paddingBottom: 6, borderBottom: '1px solid #f1f5f9', marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{d.label || d.kind || 'Filing'}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{fmt(d.due_date)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to="/my-expenses" className="btn btn-primary">📷 Take photo</Link>
        <Link to="/my-messages" className="btn btn-secondary">✉ New message</Link>
        <Link to="/sales"       className="btn btn-secondary">💶 New invoice</Link>
        <Link to="/documents"   className="btn btn-secondary">📁 Upload document</Link>
      </div>

      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 16 }}>
        Documents you upload are processed with automated/AI tools and reviewed by our team before being finalised. See our <Link to="/privacy">Privacy Notice</Link>.
      </p>
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
