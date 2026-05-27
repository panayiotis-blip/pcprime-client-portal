import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { formatDate } from '../../services/dates';

// Optional widget — hidden by default. Shows the 5 most-recently-created
// clients in AppContext (which is already loaded for the rest of the app).
export default function RecentlyAddedClients() {
  const { clients } = useApp();
  const recent = [...clients]
    .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 5);

  return (
    <div className="dashboard-widget">
      <h3>Recently added clients</h3>
      {recent.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>No clients yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {recent.map((c: any) => (
            <li key={c.id} style={{
              padding: '8px 0', borderBottom: '1px solid #f1f5f9',
              display: 'flex', justifyContent: 'space-between', gap: 8,
            }}>
              <Link to={`/clients/${c.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>
                {c.client_code ? `${c.client_code} — ` : ''}{c.name}
              </Link>
              <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                {formatDate(c.created_at, '')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
