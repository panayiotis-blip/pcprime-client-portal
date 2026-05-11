import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api, isStaffRole, hasPermission, roleLabel } from '../../services/api';

// Each entry can declare a `requires` predicate to gate visibility by role.
// No predicate = visible to any internal-firm user (owner / supervisor / admin / staff).
type NavItem = { path: string; label: string; icon: string; requires?: (u: any) => boolean };

const adminNav: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: '⌂' },
  { path: '/scan', label: 'Scan Invoice', icon: '⊞' },
  { path: '/invoices', label: 'Invoices', icon: '☰' },
  { path: '/clients', label: 'Clients', icon: '⊡' },
  { path: '/compliance', label: 'Compliance', icon: '✓' },
  { path: '/calendar', label: 'Calendar', icon: '◷' },
  { path: '/phone-log', label: 'Phone Log', icon: '☎' },
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
  const [newTaskCount, setNewTaskCount] = useState(0);

  const navItems = (isStaffRole(user) ? adminNav : clientNav)
    .filter(item => !item.requires || item.requires(user));

  const refreshTaskBadge = useCallback(async () => {
    if (!user?.id || !isStaffRole(user)) return;
    let lastSeen = localStorage.getItem(`tasks_last_seen_${user.id}`);
    if (!lastSeen) {
      // First-ever visit: anchor "since" to now so badge starts clean
      lastSeen = new Date().toISOString();
      localStorage.setItem(`tasks_last_seen_${user.id}`, lastSeen);
    }
    try {
      const count = await api.countNewTasksForUser(user.id, lastSeen);
      setNewTaskCount(count);
    } catch {}
  }, [user]);

  // Poll every 60s for fresh assigned tasks
  useEffect(() => {
    refreshTaskBadge();
    const id = setInterval(refreshTaskBadge, 60000);
    return () => clearInterval(id);
  }, [refreshTaskBadge]);

  // Also refresh on route change (so visiting /tasks resets it within a beat)
  useEffect(() => { refreshTaskBadge(); }, [location.pathname, refreshTaskBadge]);

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
                {item.path === '/tasks' && newTaskCount > 0 && (
                  <span className="nav-badge" title={`${newTaskCount} new task${newTaskCount === 1 ? '' : 's'} assigned to you`}>
                    {newTaskCount > 9 ? '9+' : newTaskCount}
                  </span>
                )}
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
