import { Link } from 'react-router-dom';

const ACTIONS: { label: string; to: string; icon: string }[] = [
  { label: 'Scan Document', to: '/scan',     icon: '⊞' },
  { label: 'Add Client',   to: '/clients',  icon: '⊡' },
  { label: 'New Task',     to: '/tasks',    icon: '☑' },
  { label: 'Run Report',   to: '/reports',  icon: '◈' },
];

export default function QuickActions() {
  return (
    <div className="dashboard-widget">
      <h3 style={{ margin: 0 }}>Quick Actions</h3>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16,
      }}>
        {ACTIONS.map(a => (
          <Link key={a.to} to={a.to} className="quick-action-card">
            <span style={{ fontSize: 28 }}>{a.icon}</span>
            <span style={{ fontWeight: 600 }}>{a.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
