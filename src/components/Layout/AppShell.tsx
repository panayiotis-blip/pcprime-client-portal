import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api, isStaffRole, hasPermission, isSupervisorOrHigher, roleLabel } from '../../services/api';
import QuickActionsFab from './QuickActionsFab';

// Sidebar reorganisation (UI polish Part 1)
// ------------------------------------------------------------
// Items are split into named groups that collapse/expand. The user's choice
// persists per-user via user_dashboard_preferences.sidebar_state. A group not
// explicitly set follows the "smart default" — expanded if it contains the
// active route, collapsed otherwise.

type NavItem = {
  path: string;
  label: string;
  icon: string;
  requires?: (u: any) => boolean;
};

type NavGroup = {
  key: string;
  label: string;
  items: NavItem[];
  requires?: (u: any) => boolean;
};

const STAFF_GROUPS: NavGroup[] = [
  {
    key: 'operations', label: 'Daily Operations',
    items: [
      { path: '/scan',      label: 'Scan Document', icon: '⊞' },
      { path: '/tasks',     label: 'Tasks',         icon: '☑' },
      { path: '/phone-log', label: 'Phone Log',    icon: '☎' },
      { path: '/messages',  label: 'Messages',     icon: '✉' },
      { path: '/client-expenses', label: 'Client Expenses', icon: '📥' },
      { path: '/timesheet', label: 'Timesheet',    icon: '⏱' },
      { path: '/calendar',  label: 'Calendar',     icon: '◷' },
    ],
  },
  {
    key: 'clients', label: 'Clients',
    items: [
      { path: '/clients',     label: 'Clients',     icon: '⊡' },
      { path: '/credentials', label: 'Credentials', icon: '🔑', requires: (u) => hasPermission(u, 'credentials.read') },
    ],
  },
  {
    key: 'compliance', label: 'Compliance & Tax',
    items: [
      { path: '/compliance',  label: 'Compliance',  icon: '✓' },
      { path: '/tax-filings', label: 'Tax Filings', icon: '⎙' },
    ],
  },
  {
    key: 'billing', label: 'Accounting',
    items: [
      { path: '/billing',              label: 'Client Invoices', icon: '€' },
      { path: '/billing/recurring',    label: 'Recurring',       icon: '↻' },
      { path: '/billing/statement',    label: 'Statements',      icon: '▤' },
      { path: '/billing/age-analysis', label: 'Age Analysis',    icon: '◔' },
      { path: '/billing/reports',      label: 'Sales Reports',   icon: '◧' },
      { path: '/billing/service-presets', label: 'Service Presets', icon: '⊕' },
    ],
  },
  {
    key: 'documents', label: 'Documents & Templates',
    items: [
      { path: '/documents',      label: 'Documents', icon: '⊟' },
      { path: '/task-templates', label: 'Templates', icon: '⊕' },
      { path: '/export',         label: 'Export',    icon: '↓' },
    ],
  },
  {
    key: 'administration', label: 'Administration',
    requires: (u) => isSupervisorOrHigher(u),
    items: [
      { path: '/users',                   label: 'Users',           icon: '⊙', requires: (u) => hasPermission(u, 'users.read') },
      { path: '/reports',                 label: 'Reports',         icon: '◈' },
      { path: '/ai-usage',                label: 'AI Usage',        icon: '◇' },
      { path: '/applications',            label: 'Applications',    icon: '📝' },
      { path: '/audit',                   label: 'Audit Log',       icon: '⌚', requires: (u) => hasPermission(u, 'audit.read') },
      { path: '/settings/company',        label: 'Company Settings', icon: '⚙' },
      { path: '/clients/deleted',         label: 'Deleted Clients', icon: '🗑' },
    ],
  },
];

// Client sidebar — Dashboard stands alone; the rest grouped into the firm
// relationship vs the client's own business.
const CLIENT_GROUPS: NavGroup[] = [
  {
    key: 'client-my-business', label: 'My business',
    items: [
      { path: '/my-company',   label: 'My Company',     icon: '🏢' },
      { path: '/my-customers', label: 'Customers',      icon: '👥' },
      { path: '/sales',        label: 'Sales Invoices', icon: '€' },
      { path: '/debtors',      label: 'Debtors',        icon: '◔' },
      { path: '/my-expenses',  label: 'My Expenses',    icon: '🧾' },
      { path: '/my-reports',   label: 'Reports',        icon: '◧' },
    ],
  },
  {
    key: 'client-with-us', label: 'Accountant',
    items: [
      { path: '/my-billing',   label: 'My Account',  icon: '€' },
      { path: '/my-deadlines', label: 'Deadlines',   icon: '⏰' },
      { path: '/documents',    label: 'Documents',   icon: '⊟' },
      { path: '/my-messages',  label: 'Messages',    icon: '✉' },
    ],
  },
];

// Does the active route belong to one of this group's items?
function routeMatchesGroup(group: NavGroup, pathname: string): boolean {
  return group.items.some(item =>
    item.path === pathname || pathname.startsWith(item.path + '/'),
  );
}

// Lookup a NavItem by its path across all groups — used by the Favourites
// section to resolve a pinned menu_item's label + icon.
function findNavItem(path: string): NavItem | undefined {
  for (const g of STAFF_GROUPS) {
    const found = g.items.find(i => i.path === path);
    if (found) return found;
  }
  return undefined;
}

// Bottom-of-sidebar identity block: the user name + role, with a chevron
// that reveals Security / Privacy / Sign Out — keeps the footer compact
// instead of three permanently-stacked links.
function SidebarUserMenu({ user, onLogout, onNavigate }: {
  user: any;
  onLogout: () => void;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sidebar-footer">
      {open && (
        <div className="sidebar-user-menu">
          <Link to="/security" className="sidebar-user-menu-item"
            onClick={() => { setOpen(false); onNavigate(); }}>Security</Link>
          <Link to="/privacy" className="sidebar-user-menu-item"
            onClick={() => { setOpen(false); onNavigate(); }}>Privacy</Link>
          <button type="button" className="sidebar-user-menu-item" onClick={onLogout}>Sign Out</button>
        </div>
      )}
      <button
        type="button"
        className="sidebar-user-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="user-info">
          <span className="user-name">{user?.display_name}</span>
          <span className="user-role">{roleLabel(user?.role)}</span>
        </div>
        <span className="sidebar-user-chevron">{open ? '▾' : '▴'}</span>
      </button>
    </div>
  );
}

type Favourite = {
  id: number;
  favourite_type: 'menu_item' | 'client';
  target_id: string;
  label: string | null;
  sort_order: number;
};

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const [newTaskCount, setNewTaskCount] = useState(0);
  const [msgUnread, setMsgUnread] = useState(0);
  const [expenseCount, setExpenseCount] = useState(0);

  // Per-user explicit collapse/expand state. Loaded once, persisted on change.
  const [groupStates, setGroupStates] = useState<Record<string, 'expanded' | 'collapsed'>>({});
  const [groupStateLoaded, setGroupStateLoaded] = useState(false);

  // Favourites (UI polish Part 3) — pinned menu items + clients.
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [favsLoaded, setFavsLoaded] = useState(false);

  // Filter groups the current user can see (e.g. Administration is leadership-only)
  const visibleGroups = useMemo(() => {
    if (!isStaffRole(user)) return [];
    return STAFF_GROUPS
      .filter(g => !g.requires || g.requires(user))
      .map(g => ({
        ...g,
        items: g.items.filter(i => !i.requires || i.requires(user)),
      }))
      .filter(g => g.items.length > 0);
  }, [user]);

  const refreshTaskBadge = useCallback(async () => {
    if (!user?.id || !isStaffRole(user)) return;
    let lastSeen = localStorage.getItem(`tasks_last_seen_${user.id}`);
    if (!lastSeen) {
      lastSeen = new Date().toISOString();
      localStorage.setItem(`tasks_last_seen_${user.id}`, lastSeen);
    }
    try {
      const count = await api.countNewTasksForUser(user.id, lastSeen);
      setNewTaskCount(count);
    } catch {}
  }, [user]);

  // Unread-message badge — staff: total unread across all clients' threads;
  // client: firm replies they haven't read yet.
  const refreshMsgBadge = useCallback(async () => {
    if (!user?.id) return;
    try {
      if (isStaffRole(user)) {
        const inbox = await api.getMessageInbox();
        setMsgUnread(inbox.reduce((s, r) => s + (r.unread || 0), 0));
      } else if (user.client_id) {
        setMsgUnread(await api.getMyUnreadMessageCount(user.client_id));
      }
    } catch {}
  }, [user]);

  // Staff-only badge: client expenses awaiting review (status 'submitted').
  const refreshExpenseBadge = useCallback(async () => {
    if (!user?.id || !isStaffRole(user)) return;
    try { setExpenseCount(await api.countSubmittedExpenses()); } catch {}
  }, [user]);

  // Load sidebar state once on mount
  useEffect(() => {
    if (!user?.id || !isStaffRole(user)) { setGroupStateLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const s = await api.getMySidebarState();
        if (!cancelled) setGroupStates((s?.groups || {}) as any);
      } catch {}
      finally { if (!cancelled) setGroupStateLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Load favourites once
  useEffect(() => {
    if (!user?.id || !isStaffRole(user)) { setFavsLoaded(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const f = await api.getMyFavourites();
        if (!cancelled) setFavourites(f as Favourite[]);
      } catch {}
      finally { if (!cancelled) setFavsLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Poll tasks badge every 60s and on route change
  useEffect(() => {
    refreshTaskBadge();
    const id = setInterval(refreshTaskBadge, 60000);
    return () => clearInterval(id);
  }, [refreshTaskBadge]);
  useEffect(() => { refreshTaskBadge(); }, [location.pathname, refreshTaskBadge]);

  // Same cadence for the message badge (also refreshes on navigation, so it
  // clears shortly after the user opens and reads their messages).
  useEffect(() => {
    refreshMsgBadge();
    const id = setInterval(refreshMsgBadge, 60000);
    return () => clearInterval(id);
  }, [refreshMsgBadge]);
  useEffect(() => { refreshMsgBadge(); }, [location.pathname, refreshMsgBadge]);

  useEffect(() => {
    refreshExpenseBadge();
    const id = setInterval(refreshExpenseBadge, 60000);
    return () => clearInterval(id);
  }, [refreshExpenseBadge]);
  useEffect(() => { refreshExpenseBadge(); }, [location.pathname, refreshExpenseBadge]);

  // Group expanded check — explicit state wins; otherwise smart default
  const isGroupExpanded = useCallback((g: NavGroup) => {
    const explicit = groupStates[g.key];
    if (explicit) return explicit === 'expanded';
    return routeMatchesGroup(g, location.pathname);
  }, [groupStates, location.pathname]);

  const toggleGroup = (key: string, isExpandedNow: boolean) => {
    const next = { ...groupStates, [key]: isExpandedNow ? 'collapsed' : 'expanded' } as Record<string, 'expanded' | 'collapsed'>;
    setGroupStates(next);
    api.setMySidebarState({ groups: next }).catch(() => {});
  };

  const unpinFavourite = async (id: number) => {
    try {
      await api.unpinFavourite(id);
      setFavourites(prev => prev.filter(f => f.id !== id));
    } catch (err: any) {
      alert('Unpin failed: ' + err.message);
    }
  };

  const pinMenuItem = async (path: string, label: string) => {
    try {
      await api.pinFavourite('menu_item', path, label);
      const f = await api.getMyFavourites();
      setFavourites(f as Favourite[]);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Client-role users see a flat sidebar (no groups)
  if (user && !isStaffRole(user)) {
    return (
      <div className="app-shell">
        <header className="mobile-header" onClick={() => setSidebarOpen(o => !o)}>
          <button className="menu-btn" type="button" aria-label="Open menu" onClick={(e) => { e.stopPropagation(); setSidebarOpen(o => !o); }}>&#9776;</button>
          <h1>PC Prime Portal</h1>
        </header>

        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <Link to="/" onClick={() => setSidebarOpen(false)} style={{ display: 'block' }}>
              <img src="/logo.png" alt="PC Prime & Calculate Consultants Ltd" style={{ width: '100%', height: 'auto', display: 'block' }} />
            </Link>
            <p className="sidebar-subtitle">Client Portal</p>
          </div>
          <ul className="sidebar-nav-list">
            <li>
              <Link to="/" className={location.pathname === '/' ? 'active' : ''} onClick={() => setSidebarOpen(false)}>
                <span className="nav-icon">⌂</span>Dashboard
              </Link>
            </li>
            {CLIENT_GROUPS.map(g => {
              const expanded = isGroupExpanded(g);
              const groupBadge = g.items.some(i => i.path === '/my-messages') ? msgUnread : 0;
              return (
                <li key={g.key} className="sidebar-group">
                  <button
                    type="button"
                    className={`sidebar-group-header ${expanded ? 'expanded' : ''}`}
                    onClick={() => toggleGroup(g.key, expanded)}
                    title={expanded ? 'Collapse' : 'Expand'}
                  >
                    <span className="sidebar-group-label">{g.label}</span>
                    {!expanded && groupBadge > 0 && (
                      <span className="nav-badge" title={`${groupBadge} new message${groupBadge === 1 ? '' : 's'} from your accountant`}>
                        {groupBadge > 9 ? '9+' : groupBadge}
                      </span>
                    )}
                    <span className="sidebar-group-chevron">{expanded ? '▾' : '▸'}</span>
                  </button>
                  {expanded && (
                    <ul className="sidebar-group-items">
                      {g.items.map(item => (
                        <li key={item.path}>
                          <Link
                            to={item.path}
                            className={`sidebar-link sidebar-sub-link ${location.pathname === item.path ? 'active' : ''}`}
                            onClick={() => setSidebarOpen(false)}
                          >
                            <span className="nav-icon">{item.icon}</span>{item.label}
                            {item.path === '/my-messages' && msgUnread > 0 && (
                              <span className="nav-badge" title={`${msgUnread} new message${msgUnread === 1 ? '' : 's'} from your accountant`}>
                                {msgUnread > 9 ? '9+' : msgUnread}
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <SidebarUserMenu user={user} onLogout={logout} onNavigate={() => setSidebarOpen(false)} />
        </nav>

        <main className="main-content"><Outlet /></main>
      </div>
    );
  }

  // Hide the FAB on print-only views so it doesn't appear in screenshots / printouts
  const isPrintRoute = /\/print(\?|$)/.test(location.pathname);

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>&#9776;</button>
        <h1>PC Prime Portal</h1>
      </header>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" onClick={() => setSidebarOpen(false)} style={{ display: 'block' }}>
            <img src="/logo.png" alt="PC Prime & Calculate Consultants Ltd" style={{ width: '100%', height: 'auto', display: 'block' }} />
          </Link>
          <p className="sidebar-subtitle">Client Portal</p>
        </div>

        <ul className="sidebar-nav-list">
          {/* Dashboard — always visible, no group */}
          <li>
            <Link
              to="/"
              className={`sidebar-link ${location.pathname === '/' ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="nav-icon">⌂</span>Dashboard
            </Link>
          </li>

          {/* Favourites — pinned at the top of the sidebar */}
          {favsLoaded && favourites.length > 0 && (() => {
            const favKey = 'favourites';
            const expanded = groupStates[favKey]
              ? groupStates[favKey] === 'expanded'
              : true;   // default: open if any favourites exist
            return (
              <li className="sidebar-group sidebar-group-favourites">
                <button
                  type="button"
                  className={`sidebar-group-header ${expanded ? 'expanded' : ''}`}
                  onClick={() => toggleGroup(favKey, expanded)}
                >
                  <span className="sidebar-group-label">Favourites</span>
                  <span className="sidebar-group-chevron">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <ul className="sidebar-group-items">
                    {favourites
                      .sort((a, b) => {
                        // Menu items first, then clients
                        if (a.favourite_type !== b.favourite_type) {
                          return a.favourite_type === 'menu_item' ? -1 : 1;
                        }
                        return a.sort_order - b.sort_order;
                      })
                      .map(f => {
                        const isMenu = f.favourite_type === 'menu_item';
                        const navItem = isMenu ? findNavItem(f.target_id) : null;
                        const to = isMenu ? f.target_id : `/clients/${f.target_id}`;
                        const label = f.label || navItem?.label || f.target_id;
                        const icon  = isMenu ? (navItem?.icon || '⊕') : '👤';
                        return (
                          <li key={f.id}>
                            <Link
                              to={to}
                              className={`sidebar-link sidebar-sub-link ${location.pathname === to ? 'active' : ''}`}
                              onClick={() => setSidebarOpen(false)}
                            >
                              <span className="nav-icon">{icon}</span>
                              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                              <button
                                type="button"
                                className="sidebar-pin pinned"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  unpinFavourite(f.id);
                                }}
                                title="Unpin"
                              >×</button>
                            </Link>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </li>
            );
          })()}

          {/* Divider — separates Favourites from the main grouped nav */}
          {favsLoaded && favourites.length > 0 && (
            <li className="sidebar-divider" aria-hidden="true" />
          )}

          {/* Grouped items */}
          {groupStateLoaded && visibleGroups.map(g => {
            const expanded   = isGroupExpanded(g);
            // Count of badges inside this group (Tasks + unread Messages + expenses to review)
            const groupBadge =
              (g.items.some(i => i.path === '/tasks') ? newTaskCount : 0) +
              (g.items.some(i => i.path === '/messages') ? msgUnread : 0) +
              (g.items.some(i => i.path === '/client-expenses') ? expenseCount : 0);
            return (
              <li key={g.key} className="sidebar-group">
                <button
                  type="button"
                  className={`sidebar-group-header ${expanded ? 'expanded' : ''}`}
                  onClick={() => toggleGroup(g.key, expanded)}
                  title={expanded ? 'Collapse' : 'Expand'}
                >
                  <span className="sidebar-group-label">{g.label}</span>
                  {/* Surface badge on collapsed group header so notifications aren't hidden */}
                  {!expanded && groupBadge > 0 && (
                    <span className="nav-badge" title={`${groupBadge} new in this section`}>
                      {groupBadge > 9 ? '9+' : groupBadge}
                    </span>
                  )}
                  <span className="sidebar-group-chevron">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <ul className="sidebar-group-items">
                    {g.items.map(item => {
                      const isPinned = favourites.some(f => f.favourite_type === 'menu_item' && f.target_id === item.path);
                      return (
                        <li key={item.path}>
                          <Link
                            to={item.path}
                            className={`sidebar-link sidebar-sub-link ${location.pathname === item.path ? 'active' : ''}`}
                            onClick={() => setSidebarOpen(false)}
                          >
                            <span className="nav-icon">{item.icon}</span>
                            {item.label}
                            {item.path === '/tasks' && newTaskCount > 0 && (
                              <span className="nav-badge" title={`${newTaskCount} new task${newTaskCount === 1 ? '' : 's'} assigned to you`}>
                                {newTaskCount > 9 ? '9+' : newTaskCount}
                              </span>
                            )}
                            {item.path === '/messages' && msgUnread > 0 && (
                              <span className="nav-badge" title={`${msgUnread} unread client message${msgUnread === 1 ? '' : 's'}`}>
                                {msgUnread > 9 ? '9+' : msgUnread}
                              </span>
                            )}
                            {item.path === '/client-expenses' && expenseCount > 0 && (
                              <span className="nav-badge" title={`${expenseCount} client expense${expenseCount === 1 ? '' : 's'} awaiting review`}>
                                {expenseCount > 9 ? '9+' : expenseCount}
                              </span>
                            )}
                            <button
                              type="button"
                              className={`sidebar-pin ${isPinned ? 'pinned' : ''}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (isPinned) {
                                  const fav = favourites.find(f => f.favourite_type === 'menu_item' && f.target_id === item.path);
                                  if (fav) unpinFavourite(fav.id);
                                } else {
                                  pinMenuItem(item.path, item.label);
                                }
                              }}
                              title={isPinned ? 'Unpin from Favourites' : 'Pin to Favourites'}
                            >
                              {isPinned ? '★' : '☆'}
                            </button>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        <SidebarUserMenu user={user} onLogout={logout} onNavigate={() => setSidebarOpen(false)} />
      </nav>

      <main className="main-content">
        <Outlet />
      </main>

      {/* Floating quick-actions button — hidden on print routes */}
      {!isPrintRoute && <QuickActionsFab />}
    </div>
  );
}
