import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, hasPermission } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type AuditEntry = {
  id: number;
  ts: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: any;
  ip_address: string | null;
  user_agent: string | null;
};

const PAGE_SIZE = 200;

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Build a one-line human summary from the audit entry.
function summarize(e: AuditEntry): string {
  if (e.action.endsWith('.create'))      return 'created';
  if (e.action.endsWith('.delete'))      return 'soft-deleted';
  if (e.action.endsWith('.restore'))     return 'restored';
  if (e.action.endsWith('.hard_delete')) return 'HARD deleted';
  if (e.action.endsWith('.update') && e.summary?.old && e.summary?.new) {
    const changed: string[] = [];
    for (const k of Object.keys(e.summary.new)) {
      if (k === 'updated_at') continue;
      if (JSON.stringify(e.summary.old[k]) !== JSON.stringify(e.summary.new[k])) {
        changed.push(k);
      }
    }
    if (changed.length === 0) return 'no field change';
    if (changed.length <= 4)  return `changed: ${changed.join(', ')}`;
    return `changed ${changed.length} fields`;
  }
  return '';
}

export default function AuditLog() {
  const { user } = useAuth();
  if (!hasPermission(user, 'audit.read')) {
    return (
      <div className="dashboard">
        <div className="dashboard-header"><h2>Audit Log</h2></div>
        <div className="empty-state">
          <p>The audit log is visible to Owner and Supervisor roles only.</p>
        </div>
      </div>
    );
  }

  const [entries, setEntries]   = useState<AuditEntry[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'list'>(
    () => (localStorage.getItem('audit_view') as 'table' | 'list') || 'table'
  );
  const setView = (m: 'table' | 'list') => { setViewMode(m); localStorage.setItem('audit_view', m); };
  const [loading, setLoading]   = useState(true);
  const [hasMore, setHasMore]   = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [fActor, setFActor]   = useState<string>('');
  const [fAction, setFAction] = useState<string>('');
  const [fTarget, setFTarget] = useState<string>('');
  const [fFrom, setFFrom]     = useState<string>('');
  const [fTo, setFTo]         = useState<string>('');
  const [search, setSearch]   = useState<string>('');

  const reload = async (append: boolean) => {
    setLoading(true);
    try {
      const offset = append ? entries.length : 0;
      const data = await api.getAuditLog({
        actor:        fActor       || undefined,
        action:       fAction      || undefined,
        target_type:  fTarget      || undefined,
        from:         fFrom        || undefined,
        to:           fTo          || undefined,
        limit:        PAGE_SIZE,
        offset,
      });
      setEntries(append ? [...entries, ...(data as AuditEntry[])] : (data as AuditEntry[]));
      setHasMore((data as AuditEntry[]).length === PAGE_SIZE);
    } catch (err: any) {
      alert('Failed to load audit log: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Reload when filters change (not when expanding rows or typing in search)
  useEffect(() => { reload(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fActor, fAction, fTarget, fFrom, fTo]);

  // Dropdown values populated from what's currently loaded
  const actors  = useMemo(() => Array.from(new Set(entries.map(e => e.actor_email).filter(Boolean) as string[])).sort(),  [entries]);
  const actions = useMemo(() => Array.from(new Set(entries.map(e => e.action))).sort(),                                  [entries]);
  const targets = useMemo(() => Array.from(new Set(entries.map(e => e.target_type).filter(Boolean) as string[])).sort(), [entries]);

  // Free-text filter is applied client-side
  const visible = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter(e =>
      (e.actor_email || '').toLowerCase().includes(q) ||
      (e.target_id   || '').toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="dashboard audit-log-page">
      <div className="dashboard-header">
        <h2>Audit Log</h2>
        <div className="dashboard-actions">
          <button className="btn btn-secondary" onClick={() => reload(false)}>Refresh</button>
        </div>
      </div>

      <div className="filters-bar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '16px 0' }}>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Actor</label>
          <select className="form-input" value={fActor} onChange={e => setFActor(e.target.value)}>
            <option value="">All actors</option>
            {actors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Action</label>
          <select className="form-input" value={fAction} onChange={e => setFAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 140 }}>
          <label>Target table</label>
          <select className="form-input" value={fTarget} onChange={e => setFTarget(e.target.value)}>
            <option value="">All targets</option>
            {targets.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>From</label>
          <input type="date" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div className="form-group">
          <label>To</label>
          <input type="date" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
          <label>Search</label>
          <input type="text" className="form-input" placeholder="actor, action, target id..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="form-group">
          <label>View</label>
          <div className="view-toggle">
            <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Table view">☰ Table</button>
            <button className={`view-btn ${viewMode === 'list'  ? 'active' : ''}`} onClick={() => setView('list')}  title="Compact list">≡ List</button>
          </div>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className="loading-screen">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>No audit entries match these filters.</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="compact-list">
          {visible.map(e => (
            <div key={e.id} className="compact-row">
              <span className="cl-muted" style={{ whiteSpace: 'nowrap' }}>{formatTime(e.ts)}</span>
              <span className="cl-strong">{e.actor_email || 'system'}</span>
              <code className="cl-muted">{e.action}</code>
              <span className="cl-muted">{e.target_type ? `${e.target_type}${e.target_id ? ' #' + e.target_id : ''}` : '—'}</span>
            </div>
          ))}
          {hasMore && (
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <button className="btn btn-secondary" onClick={() => reload(true)} disabled={loading}>
                {loading ? 'Loading...' : 'Load older entries'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="compliance-table-wrapper">
            <table className="compliance-table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(e => (
                  <Fragment key={e.id}>
                    <tr onClick={() => toggle(e.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatTime(e.ts)}</td>
                      <td>{e.actor_email || <em style={{ color: '#888' }}>system</em>}</td>
                      <td><code>{e.action}</code></td>
                      <td>{e.target_type ? `${e.target_type} #${e.target_id ?? '?'}` : '—'}</td>
                      <td>{summarize(e)}</td>
                    </tr>
                    {expanded.has(e.id) && (
                      <tr>
                        <td colSpan={5} style={{ background: '#f8fafc', padding: 12 }}>
                          <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflow: 'auto' }}>
                            {JSON.stringify(e.summary, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <button className="btn btn-secondary" onClick={() => reload(true)} disabled={loading}>
                {loading ? 'Loading...' : 'Load older entries'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
