import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import ApplyTaskTemplateModal from './ApplyTaskTemplateModal';
import LogMessageModal from './LogMessageModal';
import LogCallModal from './LogCallModal';

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
  completed_at: string | null;
  created_at: string;
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
  const { clients } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'table' | 'list'>(
    () => (localStorage.getItem('staff_tasks_view') as 'table' | 'list') || 'table'
  );
  const setView = (m: 'table' | 'list') => { setViewMode(m); localStorage.setItem('staff_tasks_view', m); };
  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [showLogMessage,    setShowLogMessage]    = useState(false);
  const [logCallForTask,    setLogCallForTask]    = useState<{ task_id: number; client_id: number | null } | null>(null);

  // Filters
  const [fAssignee, setFAssignee] = useState<string>('');
  const [fStatus, setFStatus]     = useState<string>('open'); // 'open' = open + in_progress + blocked
  const [fPriority, setFPriority] = useState<string>('');
  const [fClient, setFClient]     = useState<string>('');
  const [fFrom, setFFrom]         = useState<string>('');
  const [fTo, setFTo]             = useState<string>('');
  const [search, setSearch]       = useState<string>('');

  // New task form (inline)
  const [showForm, setShowForm] = useState(false);
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
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fAssignee, fStatus, fPriority, fClient, fFrom, fTo]);

  const userById = useMemo(() => {
    const m = new Map<string, any>();
    for (const u of staffUsers) m.set(u.id, u);
    return m;
  }, [staffUsers]);

  const visibleTasks = useMemo(() => {
    let out = tasks;
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
    if (!confirm(`Delete task: "${t.title}"?`)) return;
    try {
      await api.deleteStaffTask(t.id);
      setTasks(prev => prev.filter(x => x.id !== t.id));
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
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
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)} style={{ marginLeft: 6 }}>
            {showForm ? 'Cancel' : '+ New Task'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-number">{stats.open}</div><div className="stat-label">Open</div></div>
        <div className="stat-card stat-draft"><div className="stat-number">{stats.overdue}</div><div className="stat-label">Overdue</div></div>
        <div className="stat-card stat-reviewed"><div className="stat-number">{stats.due7}</div><div className="stat-label">Due ≤ 7d</div></div>
        <div className="stat-card stat-exported"><div className="stat-number">{stats.doneWeek}</div><div className="stat-label">Done this week</div></div>
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
              <select className="form-input" value={form.client_id} onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}>
                <option value="">—</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.client_code ? `${c.client_code} — ` : ''}{c.name}</option>
                ))}
              </select>
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
        <div className="form-group" style={{ minWidth: 140 }}>
          <label>Priority</label>
          <select className="form-input" value={fPriority} onChange={e => setFPriority(e.target.value)}>
            <option value="">All</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Client</label>
          <select className="form-input" value={fClient} onChange={e => setFClient(e.target.value)}>
            <option value="">All</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.client_code ? `${c.client_code} — ` : ''}{c.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Due from</label>
          <input type="date" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Due to</label>
          <input type="date" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
          <label>Search</label>
          <input type="text" className="form-input" placeholder="title, description, client..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="form-group">
          <label>View</label>
          <div className="view-toggle">
            <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Table view">☰ Table</button>
            <button className={`view-btn ${viewMode === 'list'  ? 'active' : ''}`} onClick={() => setView('list')}  title="Compact list">≡ List</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : visibleTasks.length === 0 ? (
        <div className="empty-state">
          <p>No tasks match the current filters.</p>
          <p>Click <strong>+ New Task</strong> to create one.</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="compact-list">
          {visibleTasks.map(t => {
            const overdue = t.due_date && t.due_date < todayIso();
            return (
              <div key={t.id} className="compact-row">
                <span className="cl-badge" style={{ background: priorityClass(t.priority) === 'status-draft' ? '#fee2e2' : '#e0e7ff', color: priorityClass(t.priority) === 'status-draft' ? '#b91c1c' : '#3730a3' }}>
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
                      onChange={e => patchTask(t.id, { status: e.target.value as Status } as any)}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    <span className="print-only">{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-link btn-sm" title="Log a call about this task" onClick={() => setLogCallForTask({ task_id: t.id, client_id: t.client_id })}>📞 Log call</button>
                    <button className="btn btn-link btn-sm" onClick={() => handleDelete(t)} style={{ marginLeft: 4 }}>Delete</button>
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

      {showLogMessage && (
        <LogMessageModal
          onClose={() => setShowLogMessage(false)}
          onSaved={() => reload()}
        />
      )}

      {logCallForTask && (
        <LogCallModal
          preSelectedTaskId={logCallForTask.task_id}
          preSelectedClientId={logCallForTask.client_id}
          onClose={() => setLogCallForTask(null)}
          onSaved={() => setLogCallForTask(null)}
        />
      )}
    </div>
  );
}
