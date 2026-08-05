import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api, isStaffRole, hasPermission } from '../../services/api';

// Ctrl/Cmd+K "jump to" palette — search clients (already loaded in AppContext,
// so RLS-safe with no extra query) and the app's main destinations.
//
// Routes are a curated list here rather than the AppShell nav, on purpose: it
// keeps the palette self-contained (no coupling to / circular import with the
// central shell). It's a "jump to the common places" list, not every route.

type RouteItem = { path: string; label: string; keywords?: string; requires?: (u: any) => boolean };

const STAFF_ROUTES: RouteItem[] = [
  { path: '/',                 label: 'Dashboard' },
  { path: '/clients',          label: 'Clients', keywords: 'customers companies' },
  { path: '/apps',             label: 'Client Apps', keywords: 'rentals payroll app launcher open client app' },
  { path: '/clients/address-book', label: 'Address Book', keywords: 'addresses saved reuse' },
  { path: '/scan',             label: 'Scan Document', keywords: 'upload invoice ocr' },
  { path: '/tasks',            label: 'Tasks' },
  { path: '/inbox',            label: 'Inbox', keywords: 'email mail' },
  { path: '/messages',         label: 'Messages' },
  { path: '/calendar',         label: 'Calendar' },
  { path: '/timesheet',        label: 'Timesheet', keywords: 'time hours' },
  { path: '/phone-log',        label: 'Phone Log', keywords: 'call' },
  { path: '/compliance',       label: 'Compliance' },
  { path: '/tax-filings',      label: 'Tax Filings', keywords: 'td1 taxisnet return' },
  { path: '/billing',          label: 'Client Invoices', keywords: 'billing invoice' },
  { path: '/billing/statement', label: 'Statements' },
  { path: '/documents',        label: 'Documents', keywords: 'files' },
  { path: '/reports',          label: 'Reports' },
  { path: '/bulk-email',       label: 'Bulk Email' },
  { path: '/credentials',      label: 'Credentials', keywords: 'passwords logins', requires: u => hasPermission(u, 'credentials.read') },
  { path: '/users',            label: 'Users', keywords: 'staff', requires: u => hasPermission(u, 'users.read') },
  { path: '/settings/company', label: 'Company Settings' },
  { path: '/settings/services', label: 'Service Settings' },
];

const CLIENT_ROUTES: RouteItem[] = [
  { path: '/',             label: 'Dashboard' },
  { path: '/my-billing',   label: 'My Account', keywords: 'billing statement' },
  { path: '/my-deadlines', label: 'Deadlines' },
  { path: '/my-messages',  label: 'Messages' },
  { path: '/my-emails',    label: 'Inbox', keywords: 'email mail' },
  { path: '/my-company',   label: 'My Company' },
  { path: '/my-customers', label: 'Customers' },
  { path: '/sales',        label: 'Sales Invoices' },
  { path: '/debtors',      label: 'Debtors' },
  { path: '/my-scan',      label: 'Scan Document', keywords: 'upload' },
  { path: '/my-reports',   label: 'Reports' },
  { path: '/documents',    label: 'Documents', keywords: 'files' },
];

const MAX_CLIENTS = 7;
const MAX_TASKS = 6;

type TaskLite = { id: number; title: string; client_id: number | null; client_name: string | null; client_code: string | null };

type Result =
  | { kind: 'route'; path: string; label: string }
  | { kind: 'client'; id: number; name: string; code: string | null }
  | { kind: 'task'; id: number; title: string; clientId: number | null; clientName: string | null };

export default function CommandPalette() {
  const navigate = useNavigate();
  const { clients } = useApp();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const tasksLoaded = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazily load active (open + in-progress) tasks the first time a staff user
  // opens the palette (they aren't in AppContext). Cached for the session.
  useEffect(() => {
    if (!open || !isStaffRole(user) || tasksLoaded.current) return;
    tasksLoaded.current = true;
    Promise.all([
      api.getStaffTasks({ status: 'open' }),
      api.getStaffTasks({ status: 'in_progress' }),
    ])
      .then(([a, b]: any[][]) => setTasks([...a, ...b].map(t => ({
        id: t.id, title: t.title || `Task #${t.id}`,
        client_id: t.client_id ?? null, client_name: t.client_name ?? null, client_code: t.client_code ?? null,
      }))))
      .catch(() => { tasksLoaded.current = false; });
  }, [open, user]);

  // Global Ctrl/Cmd+K toggles the palette. preventDefault stops the browser's
  // own Ctrl+K (focus address/search bar) from swallowing it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after the portal paints
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const routes = useMemo(
    () => (isStaffRole(user) ? STAFF_ROUTES : CLIENT_ROUTES).filter(r => !r.requires || r.requires(user)),
    [user],
  );

  const results: Result[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const routeMatches = routes
      .filter(r => !q || r.label.toLowerCase().includes(q) || (r.keywords || '').includes(q))
      .map<Result>(r => ({ kind: 'route', path: r.path, label: r.label }));

    // Clients only for staff, and only once there's a query. Client-role users
    // don't get client results — /clients/:id is a staff route, and their
    // AppContext.clients is just their own RLS-scoped record anyway.
    let clientMatches: Result[] = [];
    if (q && isStaffRole(user)) {
      clientMatches = (clients as any[])
        .filter(c => {
          const hay = `${c.name || ''} ${c.client_name || ''} ${c.client_code || ''} ${c.tax_number || ''} ${c.trading_name || ''}`.toLowerCase();
          return hay.includes(q);
        })
        .slice(0, MAX_CLIENTS)
        .map<Result>(c => ({ kind: 'client', id: c.id, name: c.name || `Client #${c.id}`, code: c.client_code || null }));
    }

    let taskMatches: Result[] = [];
    if (q && isStaffRole(user)) {
      taskMatches = tasks
        .filter(t => `${t.title} ${t.client_name || ''} ${t.client_code || ''}`.toLowerCase().includes(q))
        .slice(0, MAX_TASKS)
        .map<Result>(t => ({ kind: 'task', id: t.id, title: t.title, clientId: t.client_id, clientName: t.client_name }));
    }
    return [...routeMatches, ...clientMatches, ...taskMatches];
  }, [query, routes, clients, tasks, user]);

  // Keep the highlight in range as results change.
  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const go = (r: Result) => {
    setOpen(false);
    if (r.kind === 'client') navigate(`/clients/${r.id}`);
    else if (r.kind === 'task') navigate(r.clientId ? `/clients/${r.clientId}` : '/tasks');
    else navigate(r.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) go(results[active]); }
  };

  // First client / task in the flat list mark where each section starts.
  const firstClientIdx = results.findIndex(r => r.kind === 'client');
  const firstTaskIdx = results.findIndex(r => r.kind === 'task');

  return createPortal(
    <div className="cmdk-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-input-row">
          <Search size={16} className="cmdk-input-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to a client or page…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search clients and pages"
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>

        <div className="cmdk-results" role="listbox">
          {results.length === 0 ? (
            <div className="cmdk-empty">No matches.</div>
          ) : (
            results.map((r, i) => (
              <div key={r.kind === 'client' ? `c${r.id}` : r.kind === 'task' ? `t${r.id}` : `r${r.path}`}>
                {i === 0 && r.kind === 'route' && <div className="cmdk-section">Pages</div>}
                {i === firstClientIdx && <div className="cmdk-section">Clients</div>}
                {i === firstTaskIdx && <div className="cmdk-section">Tasks</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk-item ${i === active ? 'active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  {r.kind === 'client' ? (
                    <>
                      {r.code && <span className="client-code-inline">{r.code}</span>}
                      <span className="cmdk-item-label">{r.name}</span>
                    </>
                  ) : r.kind === 'task' ? (
                    <>
                      <span className="cmdk-item-label">{r.title}</span>
                      {r.clientName && <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>{r.clientName}</span>}
                    </>
                  ) : (
                    <span className="cmdk-item-label">{r.label}</span>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
