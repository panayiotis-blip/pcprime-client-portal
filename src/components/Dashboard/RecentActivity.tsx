import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, hasPermission } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type Entry = {
  id: number;
  ts: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function RecentActivity() {
  const { user } = useAuth();
  const canRead = hasPermission(user, 'audit.read');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!canRead) { setLoading(false); return; }
    (async () => {
      try {
        const data = await api.getAuditLog({ limit: 10 });
        if (mounted) setEntries(data as Entry[]);
      } catch {
        if (mounted) setEntries([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [canRead]);

  return (
    <div className="dashboard-widget">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Recent Activity</h3>
        {canRead && <Link to="/audit" style={{ fontSize: 12 }}>View all →</Link>}
      </div>
      {!canRead ? (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
          Audit-log access required to view recent activity.
        </p>
      ) : loading ? (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>No activity yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0 0' }}>
          {entries.map(e => (
            <li key={e.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <code style={{ fontSize: 12, color: '#475569' }}>{e.action}</code>
                <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatTime(e.ts)}</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {e.actor_email || 'system'}
                {e.target_type && <> · {e.target_type}{e.target_id ? ` #${e.target_id}` : ''}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
