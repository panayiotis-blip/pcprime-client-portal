import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../services/api';

interface Props { clientId: number; }

type Task = {
  id: number;
  client_id: number;
  kind: string;
  due_date: string;
  status: string;
  period_label: string | null;
  notes: string | null;
};

const KIND_LABEL: Record<string, string> = {
  vat_quarterly:    'VAT (Quarterly)',
  social_insurance: 'Social Insurance',
  ir7:              'IR7',
  provisional_tax:  'Provisional Tax',
  he32:             'HE32 (Annual Return)',
  ubo:              'UBO',
};

const STATUS_COLOR: Record<string, string> = {
  open:       '#1e40af',
  in_progress:'#3730a3',
  blocked:    '#b45309',
  completed:  '#047857',
  filed:      '#047857',
  overdue:    '#b91c1c',
};

const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Tab 9: Compliance — read-only summary of all compliance tasks for this
// client, grouped by kind. Full editing happens on the global /compliance page.
export default function ComplianceTab({ clientId }: Props) {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await api.getComplianceTasks({ client_id: clientId });
        if (!mounted) return;
        setTasks(data as Task[]);
      } catch {
        setTasks([]);
      }
    })();
    return () => { mounted = false; };
  }, [clientId]);

  if (tasks === null) return <div className="loading-screen">Loading…</div>;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = tasks.filter(t =>
    t.status !== 'filed' && t.status !== 'completed' && t.due_date >= today
  ).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const overdue = tasks.filter(t =>
    t.status !== 'filed' && t.status !== 'completed' && t.due_date < today
  ).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const done = tasks.filter(t => t.status === 'filed' || t.status === 'completed')
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .slice(0, 10);

  const Section = ({ title, items, emptyText }: { title: string; items: Task[]; emptyText: string }) => (
    <div className="form-section">
      <h3>{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>{emptyText}</p>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Filing</th>
                <th>Period</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id}>
                  <td>{KIND_LABEL[t.kind] || t.kind}</td>
                  <td style={{ fontSize: 12 }}>{t.period_label || '—'}</td>
                  <td>{fmtDate(t.due_date)}</td>
                  <td style={{ color: STATUS_COLOR[t.status] || '#0f172a', textTransform: 'capitalize' }}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="client-tab-content">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Link to="/compliance" className="btn btn-secondary btn-sm">Open Compliance dashboard →</Link>
      </div>
      <Section title="🚨 Overdue" items={overdue} emptyText="Nothing overdue ✓" />
      <Section title="📅 Upcoming" items={upcoming} emptyText="No upcoming deadlines." />
      <Section title="✅ Recently filed" items={done} emptyText="No filings recorded yet." />
    </div>
  );
}
