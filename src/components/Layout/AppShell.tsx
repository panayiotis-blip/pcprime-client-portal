import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isStaffRole, hasPermission, roleLabel } from '../../services/api';

// Each entry can declare a `requires` predicate to gate visibility by role.
// No predicate = visible to any internal-firm user (owner / supervisor / admin / staff).
type NavItem = { path: string; label: string; icon: string; requires?: (u: any) => boolean };

const adminNav: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: '⌂' },
  { path: '/scan', label: 'Scan Invoice', icon: '⊞' },
  { path: '/invoices', label: 'Invoices', icon: '☰' },
  { path: '/clients', label: 'Clients', icon: '⊡' },
  { path: '/compliance', label: 'Compliance', icon: '✓' },
  { path: '/tasks', label: 'Tasks', icon: '☑' },
  { path: '/task-templates', label: 'Templates', icon: '⊕' },
  { path: '/reports', label: 'Reports', icon: '◈' },
  { path: '/documents', label: 'Documents', icon: '⊟' },
  { path: '/export', label: 'Export', icon: '↓' },
  { path: '/users', label: 'Users', icon: '⊙', requires: (u) => hasPermission(u, 'users.read') },
  { path: '/audit', label: 'Audit Log', icon: '⌚', requires: (u) => hasPermission(u, 'audit.read') },
];

const clientNav: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: '⌂' },
  { path: '/documents', label: 'Documents', icon: '⊟' },
  { path: '/invoices', label: 'Invoices', icon: '☰' },
];

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();

  const navItems = (isStaffRole(user) ? adminNav : clientNav)
    .filter(item => !item.requires || item.requires(user));

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>&#9776;</button>
        <h1>PC Prime Portal</h1>
      </header>

      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" onClick={() => setSidebarOpen(false)} style={{ display: 'block' }}>
            <img
              src="/logo.png"
              alt="PC Prime & Calculate Consultants Ltd"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </Link>
          <p className="sidebar-subtitle">Client Portal</p>
        </div>
        <ul>
          {navItems.map((item) => (
            <li key={item.path}>
              <Link to={item.path} className={location.pathname === item.path ? 'active' : ''} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-name">{user?.display_name}</span>
            <span className="user-role">{roleLabel(user?.role)}</span>
          </div>
          <Link to="/security" className="btn btn-link sidebar-logout" onClick={() => setSidebarOpen(false)} style={{ display: 'block' }}>Security</Link>
          <button className="btn btn-link sidebar-logout" onClick={logout}>Sign Out</button>
        </div>
      </nav>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
