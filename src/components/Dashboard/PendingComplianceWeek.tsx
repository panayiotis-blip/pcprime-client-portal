import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

type Task = {
  id: number;
  client_id: number;
  client_name: string | null;
  client_code: string | null;
  kind: string;
  due_date: string;
  status: string;
};

const KIND_LABEL: Record<string, string> = {
  vat_quarterly: 'VAT',
  social_insurance: 'SI',
  ir7: 'IR7',
  provisional_tax: 'Prov. Tax',
  he32: 'HE32',
  ubo: 'UBO',
};

const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

// Optional widget — hidden by default. Shows compliance tasks due in the
// next 7 days that aren't filed/completed.
export default function PendingComplianceWeek() {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const all = await api.getComplianceTasks({}) as Task[];
        if (!mounted) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const weekOut = new Date(today); weekOut.setDate(weekOut.getDate() + 7);
        const todayIso  = today.toISOString().slice(0, 10);
        const weekIso   = weekOut.toISOString().slice(0, 10);
        const filtered = all.filter(t =>
          t.status !== 'filed' && t.status !== 'completed'
          && t.due_date >= todayIso && t.due_date <= weekIso
        ).sort((a, b) => a.due_date.localeCompare(b.due_date));
        setTasks(filtered);
      } catch {
        setTasks([]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="dashboard-widget">
      <h3>Pending compliance (next 7 days)</h3>
      {tasks === null ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>
      ) : tasks.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Nothing due this week ✓</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tasks.slice(0, 8).map(t => (
            <li key={t.id} style={{
              padding: '6px 0', borderBottom: '1px solid #f1f5f9',
              display: 'grid', gridTemplateColumns: '60px 1fr 48px', alignItems: 'center', gap: 8, fontSize: 13,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#3730a3',
                background: '#e0e7ff', padding: '2px 6px', borderRadius: 4, textAlign: 'center',
              }}>{KIND_LABEL[t.kind] || t.kind}</span>
              <Link to={`/clients/${t.client_id}`} style={{ color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.client_code ? `${t.client_code} — ` : ''}{t.client_name}
              </Link>
              <span style={{ fontSize: 12, color: '#64748b', textAlign: 'right' }}>{fmtDate(t.due_date)}</span>
            </li>
          ))}
          {tasks.length > 8 && (
            <li style={{ padding: '6px 0', fontSize: 12 }}>
              <Link to="/compliance">+ {tasks.length - 8} more…</Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
