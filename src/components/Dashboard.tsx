import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api, isStaffRole } from '../services/api';
import KpiTile from './Dashboard/KpiTile';
import MyTasks from './Dashboard/MyTasks';
import ComplianceCalendar from './Dashboard/ComplianceCalendar';
import InvoiceTrendChart from './Dashboard/InvoiceTrendChart';
import QuickActions from './Dashboard/QuickActions';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Dashboard() {
  const { invoices, clients } = useApp();
  const { user, mfa } = useAuth();
  const showMfaNag = isStaffRole(user) && !mfa.enrolled;

  // ---------- Client view (unchanged) ----------
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

  // ---------- Admin / staff view (redesigned) ----------
  // KPI metrics computed from existing AppContext + a couple of background fetches.
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
        // Pending VAT: open VAT quarterly tasks (any due date)
        const vat = await api.getComplianceTasks({ kind: 'vat_quarterly' });
        if (!mounted) return;
        setPendingVat((vat as any[]).filter(t => t.status !== 'filed' && t.status !== 'completed').length);

        // Compliance Alerts: any compliance task overdue (across all kinds)
        const allCompliance = await api.getComplianceTasks({});
        if (!mounted) return;
        setComplianceAlerts((allCompliance as any[]).filter(
          t => t.status !== 'filed' && t.status !== 'completed' && t.due_date < today,
        ).length);

        // Overdue staff tasks: status open + due date in the past
        const tasks = await api.getStaffTasks({});
        if (!mounted) return;
        setOverdueTasks((tasks as any[]).filter(
          t => t.status !== 'done' && t.status !== 'cancelled' && t.due_date && t.due_date < today,
        ).length);
      } catch {
        // Soft fail — KPI tiles will keep showing '…'
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="dashboard">
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

      <div className="dashboard-header" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>Welcome back, {user?.display_name}</span>
      </div>

      <div className="dashboard-grid-3row">
        {/* Row 1 — KPI strip */}
        <div className="kpi-strip">
          <KpiTile label="Total Clients"      value={totalClients}                     to="/clients" />
          <KpiTile label="Active Invoices"    value={activeInvoices}                   to="/invoices" hint="drafts + reviewed" />
          <KpiTile label="Pending VAT"        value={pendingVat ?? '…'}                to="/compliance" loading={pendingVat === null} />
          <KpiTile label="Overdue Tasks"      value={overdueTasks ?? '…'}              to="/tasks"     variant={overdueTasks && overdueTasks > 0 ? 'warning' : 'default'} loading={overdueTasks === null} />
          <KpiTile label="Compliance Alerts"  value={complianceAlerts ?? '…'}          to="/compliance" variant={complianceAlerts && complianceAlerts > 0 ? 'danger' : 'default'} loading={complianceAlerts === null} />
        </div>

        {/* Row 2 */}
        <div className="dashboard-row dashboard-row-2col">
          <MyTasks />
          <ComplianceCalendar />
        </div>

        {/* Row 3 */}
        <div className="dashboard-row dashboard-row-2col">
          <InvoiceTrendChart />
          <QuickActions />
        </div>
      </div>
    </div>
  );
}
