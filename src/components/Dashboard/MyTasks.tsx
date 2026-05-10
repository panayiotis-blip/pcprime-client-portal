import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type Task = {
  id: number;
  title: string;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const priorityColor = (p: Task['priority']) => {
  switch (p) {
    case 'urgent': return '#b91c1c';
    case 'high':   return '#b45309';
    case 'medium': return '#475569';
    case 'low':    return '#94a3b8';
  }
};

export default function MyTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!user) return;
    (async () => {
      try {
        const data = await api.getStaffTasks({ assignee: user.id });
        if (!mounted) return;
        setTasks((data as Task[]).filter(t => t.status !== 'done' && t.status !== 'cancelled'));
      } catch {
        if (mounted) setTasks([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [user?.id]);

  const visible = useMemo(() => {
    // Sort: due_date asc (nulls last), then by priority weight, then newest first
    const weight = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
    return [...tasks]
      .sort((a, b) => {
        const ad = a.due_date || '9999-99-99';
        const bd = b.due_date || '9999-99-99';
        if (ad !== bd) return ad.localeCompare(bd);
        return weight[a.priority] - weight[b.priority];
      })
      .slice(0, 10);
  }, [tasks]);

  const today = todayIso();

  return (
    <div className="dashboard-widget">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>My Tasks</h3>
        <Link to="/tasks" style={{ fontSize: 12 }}>View all →</Link>
      </div>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 8px 0' }}>
        Open tasks assigned to you, by due date.
      </p>
      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>No open tasks assigned to you.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map(t => {
            const overdue = t.due_date && t.due_date < today;
            return (
              <li key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: priorityColor(t.priority), marginRight: 8, verticalAlign: 'middle',
                    }} title={t.priority} />
                    {t.title}
                  </span>
                  {t.due_date && (
                    <span style={{
                      whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600,
                      color: overdue ? '#b91c1c' : '#475569',
                    }}>{t.due_date}</span>
                  )}
                </div>
                {t.client_id && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, marginLeft: 16 }}>
                    <Link to={`/clients/${t.client_id}`} style={{ color: '#64748b', textDecoration: 'none' }}>
                      {t.client_code ? `${t.client_code} — ` : ''}{t.client_name}
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
