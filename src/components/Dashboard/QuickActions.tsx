import { Link } from 'react-router-dom';
import { ScanLine, UserPlus, SquareCheckBig, BarChart3, LayoutGrid, type LucideIcon } from 'lucide-react';

const ACTIONS: { label: string; to: string; Icon: LucideIcon }[] = [
  { label: 'Scan Document', to: '/scan',    Icon: ScanLine },       // scanner/document-scan
  { label: 'Add Client',    to: '/clients', Icon: UserPlus },       // user-plus
  { label: 'New Task',      to: '/tasks',   Icon: SquareCheckBig }, // keep checkbox icon
  { label: 'Run Report',    to: '/reports', Icon: BarChart3 },      // bar-chart
  // Every client's apps in one place — rentals, payroll and whatever comes
  // next, without going through each client file to reach them.
  { label: 'Client Apps',   to: '/apps',    Icon: LayoutGrid },
];

export default function QuickActions() {
  return (
    <div className="dashboard-widget">
      <h3 style={{ margin: 0 }}>Quick Actions</h3>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16,
      }}>
        {ACTIONS.map(({ label, to, Icon }) => (
          <Link key={to} to={to} className="quick-action-card">
            <Icon size={26} strokeWidth={1.75} aria-hidden />
            <span style={{ fontWeight: 600 }}>{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
