import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Task reporting dashboard (/task-dashboard) — supervisor/owner view of the
// firm's task load: how much is open, what's overdue, what's due this week,
// completion rate, workload per staff member, and a breakdown by service.
// Reads live staff_tasks and aggregates client-side.

type Task = {
  id: number;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  escalated_at: string | null;
  client_name: string | null;
  service_label: string | null;
};

const OPEN_STATUSES = ['open', 'in_progress', 'blocked'];
const todayIso = () => new Date().toISOString().slice(0, 10);
function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
function startOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function Card({ label, value, tone, sub }: { label: string; value: string | number; tone?: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: tone || '#1a365d', marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function TaskDashboard() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [t, users] = await Promise.all([
        api.getStaffTasks({ deleted: 'live' }),
        api.getUsers().catch(() => [] as any[]),
      ]);
      setTasks(t as Task[]);
      const map: Record<string, string> = {};
      for (const u of users as any[]) map[u.id] = u.display_name || u.username;
      setNames(map);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const today = todayIso();
  const weekEnd = addDaysIso(7);
  const monthStart = startOfMonthIso();

  const stats = useMemo(() => {
    const open = tasks.filter(t => OPEN_STATUSES.includes(t.status));
    const overdue = open.filter(t => t.due_date && t.due_date < today);
    const dueWeek = open.filter(t => t.due_date && t.due_date >= today && t.due_date <= weekEnd);
    const doneMonth = tasks.filter(t => t.status === 'done' && (t.completed_at || '').slice(0, 10) >= monthStart);
    const escalated = open.filter(t => t.escalated_at);
    // Completion rate = done ÷ (done + still-open), ignoring cancelled.
    const doneTotal = tasks.filter(t => t.status === 'done').length;
    const denom = doneTotal + open.length;
    const rate = denom === 0 ? 0 : Math.round((doneTotal / denom) * 100);
    return { open, overdue, dueWeek, doneMonth, escalated, rate };
  }, [tasks, today, weekEnd, monthStart]);

  // Per-assignee workload (open / overdue / due-this-week / done-this-month).
  const byStaff = useMemo(() => {
    const rows = new Map<string, { open: number; overdue: number; week: number; doneMonth: number }>();
    const bump = (k: string, f: keyof { open: number; overdue: number; week: number; doneMonth: number }) => {
      const r = rows.get(k) || { open: 0, overdue: 0, week: 0, doneMonth: 0 };
      r[f]++; rows.set(k, r);
    };
    for (const t of tasks) {
      const k = t.assigned_to || '__unassigned__';
      if (OPEN_STATUSES.includes(t.status)) {
        bump(k, 'open');
        if (t.due_date && t.due_date < today) bump(k, 'overdue');
        else if (t.due_date && t.due_date <= weekEnd) bump(k, 'week');
      }
      if (t.status === 'done' && (t.completed_at || '').slice(0, 10) >= monthStart) bump(k, 'doneMonth');
    }
    return Array.from(rows.entries())
      .map(([k, v]) => ({ key: k, name: k === '__unassigned__' ? '— Unassigned —' : (names[k] || 'Unknown'), ...v }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  }, [tasks, names, today, weekEnd, monthStart]);

  // Open tasks by service type.
  const byService = useMemo(() => {
    const rows = new Map<string, { open: number; overdue: number }>();
    for (const t of tasks) {
      if (!OPEN_STATUSES.includes(t.status)) continue;
      const k = t.service_label || 'Manual / ad-hoc';
      const r = rows.get(k) || { open: 0, overdue: 0 };
      r.open++;
      if (t.due_date && t.due_date < today) r.overdue++;
      rows.set(k, r);
    }
    return Array.from(rows.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.open - a.open);
  }, [tasks, today]);

  if (!isSupervisorOrHigher(user)) {
    return <div className="empty-state"><p>This dashboard is available to owners and supervisors only.</p></div>;
  }

  const maxStaffOpen = Math.max(1, ...byStaff.map(r => r.open));

  return (
    <div className="dashboard" style={{ padding: '1rem 1.5rem' }}>
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Task Dashboard</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to="/tasks" style={{ fontSize: 13, color: '#1e40af' }}>Open task list →</Link>
          <button className="btn btn-secondary btn-sm" onClick={reload} disabled={loading}>↻ Refresh</button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 14px' }}>
        Firm-wide task load as of {today}. Open = not done/cancelled.
      </p>

      {loading ? <PanelSkeleton rows={8} /> : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <Card label="Open" value={stats.open.length} />
            <Card label="Overdue" value={stats.overdue.length} tone={stats.overdue.length ? '#b91c1c' : '#1a365d'} sub={stats.escalated.length ? `${stats.escalated.length} escalated` : undefined} />
            <Card label="Due this week" value={stats.dueWeek.length} tone="#b45309" />
            <Card label="Done this month" value={stats.doneMonth.length} tone="#166534" />
            <Card label="Completion rate" value={`${stats.rate}%`} sub="done ÷ (done + open)" />
          </div>

          {/* Workload per staff */}
          <h3 style={{ fontSize: 15, color: '#1a365d', margin: '0 0 8px' }}>Workload per staff member</h3>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Staff member</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 200 }}>Open load</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 90, textAlign: 'right' }}>Open</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 90, textAlign: 'right' }}>Overdue</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 100, textAlign: 'right' }}>Due ≤7d</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 120, textAlign: 'right' }}>Done this month</th>
                </tr>
              </thead>
              <tbody>
                {byStaff.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>No tasks.</td></tr>
                ) : byStaff.map(r => (
                  <tr key={r.key} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', color: r.key === '__unassigned__' ? '#b91c1c' : '#1a365d', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ background: '#eef2f7', borderRadius: 4, height: 8, width: '100%', overflow: 'hidden' }}>
                        <div style={{ background: r.overdue ? '#dc2626' : '#2563eb', height: '100%', width: `${Math.round((r.open / maxStaffOpen) * 100)}%` }} />
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.open}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.overdue ? '#b91c1c' : '#94a3b8', fontWeight: r.overdue ? 700 : 400 }}>{r.overdue || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#b45309' }}>{r.week || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#166534' }}>{r.doneMonth || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* By service type */}
          <h3 style={{ fontSize: 15, color: '#1a365d', margin: '0 0 8px' }}>Open tasks by type</h3>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Service / type</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 90, textAlign: 'right' }}>Open</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, width: 90, textAlign: 'right' }}>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {byService.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>No open tasks.</td></tr>
                ) : byService.map(r => (
                  <tr key={r.label} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', color: '#1a365d' }}>{r.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.open}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.overdue ? '#b91c1c' : '#94a3b8', fontWeight: r.overdue ? 700 : 400 }}>{r.overdue || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
