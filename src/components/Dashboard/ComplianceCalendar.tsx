import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

type Task = {
  id: number;
  client_id: number;
  client_name: string;
  kind: string;
  period_label: string | null;
  due_date: string;
  status: string;
};

const KIND_LABEL: Record<string, string> = {
  vat_quarterly:            'VAT',
  social_insurance_monthly: 'SI',
  ir7_annual:               'IR7',
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const endOfMonthIso = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
};

export default function ComplianceCalendar() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Tasks due THIS month (or earlier — overdue counts)
        const data = await api.getComplianceTasks({ to: endOfMonthIso() });
        if (mounted) setTasks(data as Task[]);
      } catch {
        if (mounted) setTasks([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const visible = useMemo(() => {
    const today = todayIso();
    return tasks
      .filter(t => t.status !== 'filed' && t.status !== 'completed')
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 12)
      .map(t => ({ ...t, isOverdue: t.due_date < today }));
  }, [tasks]);

  return (
    <div className="dashboard-widget">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Compliance Calendar</h3>
        <Link to="/compliance" style={{ fontSize: 12 }}>View all →</Link>
      </div>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 8px 0' }}>
        Open VAT, SI &amp; IR7 deadlines through end of month.
      </p>
      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Nothing due this month.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map(t => (
            <li key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{
                  display: 'inline-block', minWidth: 32, padding: '1px 6px',
                  fontSize: 11, fontWeight: 600, marginRight: 6,
                  background: '#e0e7ff', color: '#3730a3', borderRadius: 4,
                }}>{KIND_LABEL[t.kind] || t.kind}</span>
                <Link to={`/clients/${t.client_id}`} style={{ color: '#0f172a', textDecoration: 'none' }}>
                  {t.client_name}
                </Link>
                {t.period_label && <span style={{ color: '#64748b' }}> · {t.period_label}</span>}
              </div>
              <span style={{
                whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600,
                color: t.isOverdue ? '#b91c1c' : '#475569',
              }}>{t.due_date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
