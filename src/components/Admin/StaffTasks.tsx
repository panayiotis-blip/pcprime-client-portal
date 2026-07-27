import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import ApplyTaskTemplateModal from './ApplyTaskTemplateModal';
import LogMessageModal from './LogMessageModal';
import TaskCompletionModal, { templateFor } from './TaskCompletionModal';
import SendPendingEmailsModal from './SendPendingEmailsModal';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';
import { formatDateTime } from '../../services/dates';

type Status   = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
type Priority = 'low' | 'medium' | 'high' | 'urgent';

type Task = {
  id: number;
  title: string;
  description: string | null;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  assigned_to: string | null;
  created_by: string | null;
  due_date: string | null;
  priority: Priority;
  status: Status;
  category: 'general' | 'return_call' | 'message' | string;
  completed_at: string | null;
  created_at: string;
  // Migration 108 — linked service stage + completion payload.
  service_stage_id: number | null;
  stage_key: string | null;
  stage_label: string | null;
  service_key: string | null;
  service_label: string | null;
  completion_data: Record<string, any> | null;
};

const STATUS_OPTIONS: Status[] = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];
const STATUS_LABEL: Record<Status, string> = {
  open: 'Open', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
};
const PRIORITY_OPTIONS: Priority[] = ['low', 'medium', 'high', 'urgent'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const daysFromToday = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};

const isOpenStatus = (s: Status) => s === 'open' || s === 'in_progress' || s === 'blocked';

const priorityClass = (p: Priority) => {
  switch (p) {
    case 'urgent': return 'status-draft';     // red
    case 'high':   return 'status-reviewed';  // amber
    case 'medium': return '';
    case 'low':    return 'status-exported';  // green-ish
  }
};

const dueClass = (t: Task) => {
  if (!isOpenStatus(t.status) || !t.due_date) return '';
  const days = daysFromToday(t.due_date);
  if (days < 0)  return 'status-draft';
  if (days <= 7) return 'status-reviewed';
  return '';
};

export default function StaffTasks() {
  const { user } = useAuth();
  // Delete + Restore + the Deleted-tasks view are supervisor-only — keeps
  // junior staff from removing other people's tasks.
  const canDelete = isSupervisorOrHigher(user);
  const { clients } = useApp();
  const location = useLocation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [showLogMessage,    setShowLogMessage]    = useState(false);
  const [showPendingEmails, setShowPendingEmails] = useState(false);
  const [pendingEmailsCount, setPendingEmailsCount] = useState(0);
  const [completingTask,    setCompletingTask]    = useState<Task | null>(null);

  // Filters — default to showing only MY tasks (changeable to "All" any time)
  const [fAssignee, setFAssignee] = useState<string>(user?.id || '');
  const [fStatus, setFStatus]     = useState<string>('open'); // 'open' = open + in_progress + blocked
  const [fPriority, setFPriority] = useState<string>('');
  const [fClient, setFClient]     = useState<string>('');
  const [fFrom, setFFrom]         = useState<string>('');
  const [fTo, setFTo]             = useState<string>('');
  const [search, setSearch]       = useState<string>('');
  // Migration 102: 'live' hides soft-deleted rows (default), 'deleted'
  // shows ONLY the trash so the user can restore something they killed
  // by mistake.
  const [fDeleted, setFDeleted]   = useState<'live' | 'deleted'>('live');

  // New task form (inline) — auto-opens when navigated to with ?new=1 (FAB)
  const [showForm, setShowForm] = useState(() => new URLSearchParams(location.search).get('new') === '1');
  const [creating, setCreating] = useState(false);
  const blankForm = () => ({
    title: '',
    description: '',
    client_id: '' as string,
    assigned_to: user?.id || '',
    due_date: '',
    priority: 'medium' as Priority,
  });
  const [form, setForm] = useState<ReturnType<typeof blankForm>>(blankForm());

  const reload = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (fAssignee)  params.assignee  = fAssignee;
      if (fPriority)  params.priority  = fPriority;
      if (fClient)    params.client_id = Number(fClient);
      if (fStatus && fStatus !== 'all' && fStatus !== 'open') params.status = fStatus;
      if (fFrom)      params.from = fFrom;
      if (fTo)        params.to   = fTo;
      params.deleted = fDeleted;
      const data = await api.getStaffTasks(params);
      setTasks(data as Task[]);
    } catch (err: any) {
      alert('Failed to load tasks: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // One-time: load the list of staff users for the assignee dropdown
  const loadStaff = async () => {
    try {
      const all = await api.getUsers();
      setStaffUsers(all.filter((u: any) => u.role !== 'client'));
    } catch {}
  };

  useEffect(() => { loadStaff(); }, []);

  // Poll the count of pending automated emails so the toolbar can show
  // a badge when there's work to send. Cheap because the view only
  // returns rows with email_sent=false.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await api.getPendingServiceEmails();
        if (!cancelled) setPendingEmailsCount((rows as any[]).length);
      } catch { /* swallow — non-critical */ }
    };
    refresh();
    return () => { cancelled = true; };
  }, [showPendingEmails]);
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fAssignee, fStatus, fPriority, fClient, fFrom, fTo, fDeleted]);

  // Defence: if the user isn't a supervisor but somehow has the trash
  // view selected (role change mid-session, stale local state), flip
  // them back to the live list.
  useEffect(() => {
    if (!canDelete && fDeleted === 'deleted') setFDeleted('live');
  }, [canDelete, fDeleted]);

  // Stamp the "I've now seen the Tasks page" marker, so the sidebar badge
  // resets to 0 — also fires on every visit so newly-arrived tasks get cleared.
  useEffect(() => {
    if (user?.id) localStorage.setItem(`tasks_last_seen_${user.id}`, new Date().toISOString());
  }, [user?.id, tasks.length]);

  const userById = useMemo(() => {
    const m = new Map<string, any>();
    for (const u of staffUsers) m.set(u.id, u);
    return m;
  }, [staffUsers]);

  // Return-call tasks get their own section at the top, so we exclude them
  // from the main list to avoid duplication.
  const returnCalls = useMemo(() => {
    return tasks
      .filter(t => t.category === 'return_call' && isOpenStatus(t.status))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    let out = tasks.filter(t => t.category !== 'return_call');
    if (fStatus === 'open') out = out.filter(t => isOpenStatus(t.status));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.client_name || '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [tasks, fStatus, search]);

  const stats = useMemo(() => {
    const today = todayIso();
    const oneWeekAgo = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();
    return {
      open:    tasks.filter(t => isOpenStatus(t.status)).length,
      overdue: tasks.filter(t => isOpenStatus(t.status) && t.due_date && t.due_date < today).length,
      due7:    tasks.filter(t => {
        if (!isOpenStatus(t.status) || !t.due_date) return false;
        const d = daysFromToday(t.due_date);
        return d >= 0 && d <= 7;
      }).length,
      doneWeek: tasks.filter(t => t.status === 'done' && t.completed_at && t.completed_at >= oneWeekAgoIso).length,
    };
  }, [tasks]);

  const patchTask = async (id: number, patch: Partial<Task>) => {
    try {
      await api.updateStaffTask(id, patch);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } as Task : t));
    } catch (err: any) {
      alert('Update failed: ' + err.message);
    }
  };

  const handleDelete = async (t: Task) => {
    if (!confirm(`Delete task: "${t.title}"?\n\nThis can be undone — use the "Show: Deleted" filter to find and restore it.`)) return;
    try {
      await api.deleteStaffTask(t.id);
      setTasks(prev => prev.filter(x => x.id !== t.id));
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  // Soft-delete twin: marks the task as not-needed but keeps it visible
  // (status='cancelled'). Different from delete — this is a decision
  // ("we won't do this"), not a mistake ("oops").
  const handleNotRequired = async (t: Task) => {
    if (t.status === 'cancelled') return;
    if (!confirm(`Mark "${t.title}" as not required?\n\nThe task stays in the list (greyed out) so the decision is auditable. Use Delete instead if it was created by mistake.`)) return;
    try {
      await api.updateStaffTask(t.id, { status: 'cancelled' } as any);
      setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: 'cancelled' as Status } : x));
    } catch (err: any) {
      alert('Update failed: ' + err.message);
    }
  };

  const handleRestore = async (t: Task) => {
    try {
      await api.restoreStaffTask(t.id);
      // Auto-switch back to the live list so the user actually sees the
      // restored task — staying in the trash would have just made it
      // disappear with no visible result. Also clear the assignee filter
      // if the restored task isn't assigned to me, so it's not hidden by
      // the default "my tasks" lens.
      if (t.assigned_to !== fAssignee) setFAssignee('');
      setFDeleted('live');
      // reload() runs via the filter useEffect; alert confirms the action.
      alert(`Restored "${t.title}". Now showing the live task list.`);
    } catch (err: any) {
      alert('Restore failed: ' + err.message);
    }
  };

  const handleCreate = async () => {
    if (!form.title.trim()) { alert('Title is required'); return; }
    setCreating(true);
    try {
      await api.createStaffTask({
        title:       form.title.trim(),
        description: form.description.trim() || undefined,
        client_id:   form.client_id ? Number(form.client_id) : null,
        assigned_to: form.assigned_to || null,
        due_date:    form.due_date || null,
        priority:    form.priority,
      });
      setForm(blankForm());
      setShowForm(false);
      await reload();
    } catch (err: any) {
      alert('Create failed: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const assigneeName = (uid: string | null) => {
    if (!uid) return '—';
    const u = userById.get(uid);
    return u?.display_name || u?.username || uid.slice(0, 8);
  };

  return (
    <div className="dashboard staff-tasks-page">
      <div className="dashboard-header">
        <h2>Tasks</h2>
        <div className="dashboard-actions">
          <button className="btn btn-secondary" onClick={() => setShowLogMessage(true)}>
            Log message
          </button>
          <button className="btn btn-secondary" onClick={() => setShowApplyTemplate(true)} style={{ marginLeft: 6 }}>
            From template
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setShowPendingEmails(true)}
            style={{ marginLeft: 6, position: 'relative' }}
            title="Send the emails queued by the nightly scheduler"
            disabled={pendingEmailsCount === 0}
          >
            📧 Send pending emails
            {pendingEmailsCount > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -6,
                background: '#dc2626', color: '#fff',
                borderRadius: 999, fontSize: 10, fontWeight: 700,
                padding: '1px 6px',
              }}>{pendingEmailsCount}</span>
            )}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)} style={{ marginLeft: 6 }}>
            {showForm ? 'Cancel' : '+ New Task'}
          </button>
        </div>
      </div>

      <div className="stats-grid stats-grid-compact">
        <div className="stat-card stat-card-sm"><div className="stat-number">{stats.open}</div><div className="stat-label">Open</div></div>
        <div className="stat-card stat-card-sm stat-draft"><div className="stat-number">{stats.overdue}</div><div className="stat-label">Overdue</div></div>
        <div className="stat-card stat-card-sm stat-reviewed"><div className="stat-number">{stats.due7}</div><div className="stat-label">Due ≤ 7d</div></div>
        <div className="stat-card stat-card-sm stat-exported"><div className="stat-number">{stats.doneWeek}</div><div className="stat-label">Done this week</div></div>
      </div>

      {/* ===== Return Calls section — always visible, even when empty ===== */}
      <div style={{
        marginTop: 16, padding: 16, background: '#eef1f5',
        border: '1px solid var(--pc-border-strong)', borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: returnCalls.length ? 10 : 0 }}>
          <h3 style={{ margin: 0, color: 'var(--pc-navy-2)' }}>
            📞 Return Calls
            {returnCalls.length > 0 && (
              <span style={{
                marginLeft: 8, background: '#dc2626', color: 'white',
                fontSize: 12, padding: '2px 8px', borderRadius: 999,
              }}>{returnCalls.length}</span>
            )}
          </h3>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {fAssignee === user?.id ? 'For you' : fAssignee ? `For ${assigneeName(fAssignee)}` : 'All staff'}
          </span>
        </div>
        {returnCalls.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No calls to return ✓</p>
        ) : (
          <div className="compliance-table-wrapper">
            <table className="compliance-table" style={{ background: 'white' }}>
              <thead>
                <tr>
                  <th>Caller</th>
                  <th>Client</th>
                  <th>For</th>
                  <th>Received</th>
                  <th>Message</th>
                  <th className="no-print">Action</th>
                </tr>
              </thead>
              <tbody>
                {returnCalls.map(t => {
                  const desc = t.description || '';
                  const callerMatch = /^From:\s*([^\n(]+)/.exec(desc);
                  const caller = callerMatch ? callerMatch[1].trim() : t.title.replace(/^Return call:\s*/i, '');
                  const messageBody = desc.split('\n\n').slice(1).join('\n\n').trim() || desc;
                  return (
                    <tr key={t.id}>
                      <td><strong>{caller}</strong></td>
                      <td>
                        {t.client_id ? (
                          <Link to={`/clients/${t.client_id}`}>{t.client_code ? `${t.client_code} — ` : ''}{t.client_name}</Link>
                        ) : '—'}
                      </td>
                      <td>{assigneeName(t.assigned_to)}</td>
                      <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                        {formatDateTime(t.created_at)}
                      </td>
                      <td style={{ maxWidth: 360, fontSize: 13 }}>
                        <span style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>
                          {messageBody}
                        </span>
                      </td>
                      <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => patchTask(t.id, { status: 'done' } as any)}
                          title="Call returned — close this task"
                        >
                          ✓ Mark as Returned
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="form-section no-print" style={{ marginTop: 12, padding: 12, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>New task</h3>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Title *</label>
              <input type="text" className="form-input" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} autoFocus />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Description</label>
              <textarea className="form-input" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Client (optional)</label>
              <SearchableSelect
                value={form.client_id}
                options={toClientOptions(clients)}
                onChange={v => setForm(p => ({ ...p, client_id: v ? String(v) : '' }))}
                placeholder="—"
                allowClear
              />
            </div>
            <div className="form-group">
              <label>Assignee</label>
              <select className="form-input" value={form.assigned_to} onChange={e => setForm(p => ({ ...p, assigned_to: e.target.value }))}>
                <option value="">— Unassigned</option>
                {staffUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Due date</label>
              <input type="date" className="form-input" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select className="form-input" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value as Priority }))}>
                {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create task'}</button>
            <button className="btn btn-secondary" onClick={() => { setShowForm(false); setForm(blankForm()); }} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="filters-bar no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '16px 0' }}>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Assignee</label>
          <select className="form-input" value={fAssignee} onChange={e => setFAssignee(e.target.value)}>
            <option value="">All</option>
            <option value={user?.id || ''}>Me ({user?.display_name})</option>
            {staffUsers.filter(u => u.id !== user?.id).map(u => (
              <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Status</label>
          <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="open">Open (open + in progress + blocked)</option>
            <option value="all">All</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        {canDelete && (
          <div className="form-group" style={{ minWidth: 120 }}>
            <label>Show</label>
            <select
              className="form-input"
              value={fDeleted}
              onChange={e => setFDeleted(e.target.value as 'live' | 'deleted')}
              title="Switch between the live list and the trash (recoverable deletes)"
              style={fDeleted === 'deleted' ? { background: '#fef3c7', borderColor: '#f59e0b' } : undefined}
            >
              <option value="live">Live tasks</option>
              <option value="deleted">🗑 Deleted (restorable)</option>
            </select>
          </div>
        )}
        <div className="form-group" style={{ minWidth: 140 }}>
          <label>Priority</label>
          <select className="form-input" value={fPriority} onChange={e => setFPriority(e.target.value)}>
            <option value="">All</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Client</label>
          <SearchableSelect
            value={fClient}
            options={toClientOptions(clients)}
            onChange={v => setFClient(v ? String(v) : '')}
            placeholder="All clients"
            allowClear
          />
        </div>
        <div className="form-group">
          <label>Due from</label>
          <input type="date" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Due to</label>
          <input type="date" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
        <div className="form-group" style={{ position: 'relative', minWidth: search || showSearch ? 220 : 40 }}>
          <label>&nbsp;</label>
          {showSearch || search ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="text"
                className="form-input"
                placeholder="title, description, client..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-link btn-sm"
                onClick={() => { setSearch(''); setShowSearch(false); }}
                title="Clear search"
                style={{ padding: '4px 8px' }}
              >✕</button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSearch(true)}
              title="Search tasks"
              style={{ padding: '8px 12px' }}
            >🔍</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : visibleTasks.length === 0 ? (
        <div className="empty-state">
          <p>No tasks match the current filters.</p>
          <p>Click <strong>+ New Task</strong> to create one.</p>
        </div>
      ) : false ? (
        // Removed compact-list branch — table view only per user direction
        <div className="compact-list">
          {visibleTasks.map(t => {
            const overdue = t.due_date && t.due_date < todayIso();
            return (
              <div key={t.id} className="compact-row">
                <span className="cl-badge" style={{ background: priorityClass(t.priority) === 'status-draft' ? '#fee2e2' : '#eef1f5', color: priorityClass(t.priority) === 'status-draft' ? '#b91c1c' : 'var(--pc-navy-2)' }}>
                  {t.priority}
                </span>
                <span className="cl-strong">{t.title}</span>
                <span className="cl-muted">
                  {t.client_id ? <Link to={`/clients/${t.client_id}`} style={{ color: 'inherit' }}>{t.client_code ? `${t.client_code} — ` : ''}{t.client_name}</Link> : '—'}
                </span>
                <span className="cl-muted" style={{ color: overdue ? '#b91c1c' : undefined, whiteSpace: 'nowrap' }}>
                  {t.due_date || '—'}
                </span>
                <span className="status-badge" style={{ whiteSpace: 'nowrap' }}>{STATUS_LABEL[t.status]}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Client</th>
                <th>Assignee</th>
                <th>Due</th>
                <th>Priority</th>
                <th>Status</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map(t => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.title}</div>
                    {t.description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{t.description}</div>}
                  </td>
                  <td>
                    {t.client_id ? (
                      <Link to={`/clients/${t.client_id}`}>
                        {t.client_code && <span className="client-code-inline">{t.client_code}</span>}
                        {t.client_name}
                      </Link>
                    ) : '—'}
                  </td>
                  <td>
                    <select
                      className="form-input form-input-sm no-print"
                      value={t.assigned_to || ''}
                      onChange={e => patchTask(t.id, { assigned_to: e.target.value || null } as any)}
                    >
                      <option value="">—</option>
                      {staffUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
                      ))}
                    </select>
                    <span className="print-only">{assigneeName(t.assigned_to)}</span>
                  </td>
                  <td>
                    <input
                      type="date"
                      className="form-input form-input-sm no-print"
                      value={t.due_date || ''}
                      onChange={e => patchTask(t.id, { due_date: e.target.value || null } as any)}
                    />
                    {t.due_date && <span className={`status-badge no-print ${dueClass(t)}`} style={{ marginLeft: 6, fontSize: 11 }}>{t.due_date}</span>}
                    <span className="print-only">{t.due_date || ''}</span>
                  </td>
                  <td>
                    <select
                      className="form-input form-input-sm no-print"
                      value={t.priority}
                      onChange={e => patchTask(t.id, { priority: e.target.value as Priority } as any)}
                    >
                      {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <span className={`status-badge print-only ${priorityClass(t.priority)}`}>{t.priority}</span>
                  </td>
                  <td>
                    <select
                      className="form-input form-input-sm no-print"
                      value={t.status}
                      onChange={e => {
                        const next = e.target.value as Status;
                        // Intercept the move to 'done' so we can capture
                        // payment dates / references for payment-type stages.
                        // Tasks without a stage link, and all non-'done'
                        // transitions, fall through to the existing path.
                        if (next === 'done' && t.status !== 'done' && templateFor(t.stage_key)) {
                          setCompletingTask(t);
                          return;
                        }
                        patchTask(t.id, { status: next } as any);
                      }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    <span className="print-only">{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                    {fDeleted === 'deleted' ? (
                      canDelete ? (
                        <button className="btn btn-link btn-sm" onClick={() => handleRestore(t)} title="Move back to the live list">↶ Restore</button>
                      ) : null
                    ) : (
                      <>
                        {t.status !== 'cancelled' && (
                          <button className="btn btn-link btn-sm" onClick={() => handleNotRequired(t)} title="Mark as cancelled but keep in list">Not required</button>
                        )}
                        {canDelete && (
                          <button className="btn btn-link btn-sm" onClick={() => handleDelete(t)} title="Soft delete — restorable from the Show: Deleted filter">Delete</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showApplyTemplate && (
        <ApplyTaskTemplateModal
          onClose={() => setShowApplyTemplate(false)}
          onApplied={() => reload()}
        />
      )}

      {showPendingEmails && (
        <SendPendingEmailsModal
          onClose={() => setShowPendingEmails(false)}
          onDone={() => { setShowPendingEmails(false); reload(); }}
        />
      )}

      {completingTask && (
        <TaskCompletionModal
          taskTitle={completingTask.title}
          stageKey={completingTask.stage_key}
          initialData={completingTask.completion_data || undefined}
          onClose={() => setCompletingTask(null)}
          onConfirm={async (data) => {
            try {
              await api.updateStaffTask(completingTask.id, { status: 'done', completion_data: data } as any);
              setCompletingTask(null);
              await reload();
            } catch (err: any) {
              alert('Save failed: ' + (err?.message || String(err)));
            }
          }}
        />
      )}

      {showLogMessage && (
        <LogMessageModal
          onClose={() => setShowLogMessage(false)}
          onSaved={() => reload()}
        />
      )}
    </div>
  );
}
