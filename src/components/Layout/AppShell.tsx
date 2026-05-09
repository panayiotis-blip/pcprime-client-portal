import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isStaffRole, roleLabel } from '../../services/api';

const adminNav = [
  { path: '/', label: 'Dashboard', icon: '⌂' },
  { path: '/scan', label: 'Scan Invoice', icon: '⊞' },
  { path: '/invoices', label: 'Invoices', icon: '☰' },
  { path: '/clients', label: 'Clients', icon: '⊡' },
  { path: '/compliance', label: 'Compliance', icon: '✓' },
  { path: '/documents', label: 'Documents', icon: '⊟' },
  { path: '/export', label: 'Export', icon: '↓' },
  { path: '/users', label: 'Users', icon: '⊙' },
  { path: '/audit', label: 'Audit Log', icon: '⌚' },
];

const clientNav = [
  { path: '/', label: 'Dashboard', icon: '⌂' },
  { path: '/documents', label: 'Documents', icon: '⊟' },
  { path: '/invoices', label: 'Invoices', icon: '☰' },
];

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();

  const navItems = isStaffRole(user) ? adminNav : clientNav;

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
