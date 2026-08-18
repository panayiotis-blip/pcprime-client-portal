import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, isSupervisorOrHigher, isStaffRole } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import ApplyTaskTemplateModal from './ApplyTaskTemplateModal';
import LogMessageModal from './LogMessageModal';
import TaskCompletionModal, { templateFor } from './TaskCompletionModal';
import SendPendingEmailsModal from './SendPendingEmailsModal';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';
import { formatDateTime } from '../../services/dates';
import { Menu, type MenuItem } from '../ui';
import { MoreHorizontal, MessageSquarePlus, FileText, Printer, RefreshCw, Bell, Mail } from 'lucide-react';

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
  escalated_at: string | null;
  /** Migration 182: the client's supervisor at the moment it escalated. */
  escalated_to: string | null;
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
  const [generating, setGenerating] = useState(false);
  const [reminding, setReminding] = useState(false);
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
  const [fType, setFType]         = useState<string>(''); // '' all · 'manual' · service_key
  const [fOverdue, setFOverdue]   = useState(false);      // supervisor escalation view
  // Migration 182: only the overdue work on clients I supervise. The firm-wide
  // count is the owner's view; this is the one a supervisor can act on.
  const [fMineSupervised, setFMineSupervised] = useState(false);
  // How far ahead to look. The scheduler generates a stage's whole cycle the
  // moment it runs, so an annual service with a long due-month offset drops
  // next year's work into today's list and never leaves. Those tasks are not
  // wrong, just not yet — so they are hidden by default rather than deleted,
  // and the count line says how many are waiting out there.
  const [fHorizon, setFHorizon]   = useState<string>('90');
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
      setStaffUsers(all.filter(u => isStaffRole(u)));
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

  // Task "types" for the filter — each service the tasks belong to, plus manual.
  const typeOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) if (t.service_key) m.set(t.service_key, t.service_label || t.service_key);
    return Array.from(m.entries()).map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  // Everything due on or before this date, or with no due date at all. Null
  // means no horizon. An explicit To date wins — someone who typed a range
  // means it.
  const horizonDate = useMemo(() => {
    if (fHorizon === 'all' || fTo) return null;
    const days = Number(fHorizon);
    if (!Number.isFinite(days)) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }, [fHorizon, fTo]);

  /** Within the horizon — and never hides anything overdue or undated. */
  const withinHorizon = (t: Task) => !horizonDate || !t.due_date || t.due_date <= horizonDate;

  const beyondHorizon = useMemo(
    () => (horizonDate
      ? tasks.filter(t => t.category !== 'return_call' && isOpenStatus(t.status) && !withinHorizon(t)).length
      : 0),
    [tasks, horizonDate],
  );

  const visibleTasks = useMemo(() => {
    let out = tasks.filter(t => t.category !== 'return_call').filter(withinHorizon);
    if (fOverdue) out = out.filter(t => isOpenStatus(t.status) && !!t.due_date && t.due_date < todayIso());
    if (fMineSupervised) out = out.filter(t => t.escalated_to === user?.id);
    if (fStatus === 'open') out = out.filter(t => isOpenStatus(t.status));
    if (fType === 'manual') out = out.filter(t => !t.service_key);
    else if (fType) out = out.filter(t => t.service_key === fType);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.client_name || '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [tasks, fStatus, fType, fOverdue, fMineSupervised, search, horizonDate, user?.id]);

  /** Overdue work escalated to me as the client's supervisor. */
  const mineSupervised = useMemo(
    () => tasks.filter(t =>
      t.category !== 'return_call' &&
      isOpenStatus(t.status) &&
      t.escalated_to === user?.id &&
      !!t.due_date && t.due_date < todayIso(),
    ).length,
    [tasks, user?.id],
  );

  const stats = useMemo(() => {
    const today = todayIso();
    const oneWeekAgo = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoIso = oneWeekAgo.toISOString();
    // Counted on the same horizon as the list. An "open" figure that includes
    // next year's work is the number that made the bars look full.
    const inView = tasks.filter(withinHorizon);
    return {
      open:    inView.filter(t => isOpenStatus(t.status)).length,
      overdue: inView.filter(t => isOpenStatus(t.status) && t.due_date && t.due_date < today).length,
      due7:    inView.filter(t => {
        if (!isOpenStatus(t.status) || !t.due_date) return false;
        const d = daysFromToday(t.due_date);
        return d >= 0 && d <= 7;
      }).length,
      doneWeek: tasks.filter(t => t.status === 'done' && t.completed_at && t.completed_at >= oneWeekAgoIso).length,
    };
  }, [tasks, horizonDate]);

  // Print the currently-filtered task list as a clean table (new window).
  const printTasks = () => {
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const rowsHtml = visibleTasks.map(t => `<tr>
      <td>${esc((t.client_code ? t.client_code + '  ' : '') + (t.client_name || ''))}</td>
      <td>${esc(t.title)}</td>
      <td style="white-space:nowrap">${esc(t.due_date || '')}</td>
      <td>${esc(STATUS_LABEL[t.status as Status] || t.status)}</td>
      <td>${esc(t.priority)}</td>
      <td>${esc(staffUsers.find(u => u.id === t.assigned_to)?.display_name || staffUsers.find(u => u.id === t.assigned_to)?.username || '')}</td>
    </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Tasks</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;color:#111;padding:20px;}
        h2{margin:0 0 2px;} .meta{color:#666;font-size:12px;margin-bottom:12px;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;}
        th{background:#f1f5f9;}
      </style></head><body>
      <h2>Tasks</h2>
      <div class="meta">${visibleTasks.length} task(s) · printed ${new Date().toLocaleString('en-GB')}</div>
      <table><thead><tr><th>Client</th><th>Task</th><th>Due</th><th>Status</th><th>Priority</th><th>Assignee</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print the task list.'); return; }
    w.document.write(html); w.document.close();
  };

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

  const doGenerate = async () => {
    setGenerating(true);
    try {
      const r = await api.runDueServiceSchedules();
      alert(`Generated ${r.created_tasks} task(s) and ${r.created_runs} run(s).`);
      await reload();
    } catch (e: any) {
      alert('Generate failed: ' + (e?.message || e));
    } finally {
      setGenerating(false);
    }
  };

  const doSendReminders = async (mode: 'assignee' | 'supervisor' = 'assignee') => {
    const question = mode === 'supervisor'
      ? 'Email each supervisor everything overdue on the clients they supervise?\n\nStaff only — no client emails. Normally runs Monday mornings.'
      : 'Email every staff member a digest of their overdue and due-soon tasks now?\n\nThese go to staff only — no client emails.';
    if (!confirm(question)) return;
    setReminding(true);
    try {
      const r = await api.runTaskReminders(undefined, mode);
      let msg = mode === 'supervisor'
        ? `Supervisor digests sent to ${r.sent} of ${r.recipients} supervisor(s) with overdue work.`
        : `Reminder digests sent to ${r.sent} of ${r.recipients} staff member(s) with due tasks.`;
      if (r.failures && r.failures.length) msg += `\n\nSkipped/failed:\n` + r.failures.join('\n');
      alert(msg);
    } catch (e: any) {
      alert('Reminders failed: ' + (e?.message || e));
    } finally {
      setReminding(false);
    }
  };

  const supervisor = isSupervisorOrHigher(user);
  const moreItems: MenuItem[] = [
    { key: 'log', label: 'Log message', icon: <MessageSquarePlus size={15} />, onSelect: () => setShowLogMessage(true) },
    { key: 'template', label: 'From template', icon: <FileText size={15} />, onSelect: () => setShowApplyTemplate(true) },
    { key: 'print', label: 'Print task list', icon: <Printer size={15} />, onSelect: printTasks, title: 'Print the current filtered task list' },
    ...(supervisor ? [
      { key: 'generate', label: generating ? 'Generating…' : 'Generate due tasks now', icon: <RefreshCw size={15} />, onSelect: doGenerate, disabled: generating, title: "Generate this month's due tasks now — normally runs automatically every night", separatorBefore: true },
      { key: 'remind', label: reminding ? 'Sending…' : 'Send reminders now', icon: <Bell size={15} />, onSelect: () => doSendReminders('assignee'), disabled: reminding, title: 'Email each staff member their overdue + due-soon tasks now — normally runs automatically every morning' },
      { key: 'remind-sup', label: reminding ? 'Sending…' : 'Send supervisor digest', icon: <Bell size={15} />, onSelect: () => doSendReminders('supervisor'), disabled: reminding || !supervisor, title: 'Email each supervisor everything overdue on their clients — normally runs Monday mornings' },
    ] as MenuItem[] : []),
    { key: 'pending', label: `Send pending emails${pendingEmailsCount ? ` (${pendingEmailsCount})` : ''}`, icon: <Mail size={15} />, onSelect: () => setShowPendingEmails(true), disabled: pendingEmailsCount === 0, title: 'Send the emails queued by the nightly scheduler', separatorBefore: true },
  ];

  return (
    <div className="dashboard staff-tasks-page">
      <div className="dashboard-header">
        <h2>Tasks</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Menu
            label={<><MoreHorizontal size={15} aria-hidden /> More{pendingEmailsCount > 0 && (
              <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{pendingEmailsCount}</span>
            )}</>}
            buttonClassName="btn btn-secondary"
            items={moreItems}
          />
          <button className="btn btn-primary" onClick={() => setShowForm(s => !s)}>
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

      {canDelete && stats.overdue > 0 && (
        <div className="no-print" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
          borderRadius: 8, padding: '10px 14px', margin: '12px 0', fontSize: 14,
        }}>
          {/* Lead with what this person supervises. A firm-wide number is
              everyone's problem and therefore nobody's; the count on your own
              clients is the one you can act on. */}
          <span>
            ⚠ <strong>{stats.overdue}</strong> allocated task{stats.overdue === 1 ? '' : 's'} overdue and needing follow-up
            {mineSupervised > 0 && <> — <strong>{mineSupervised}</strong> on client{mineSupervised === 1 ? '' : 's'} you supervise</>}.
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {mineSupervised > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setFMineSupervised(v => !v); setFOverdue(true); }}>
                {fMineSupervised ? 'All supervisors' : 'Just mine'}
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => { setFOverdue(v => !v); setFMineSupervised(false); }}>
              {fOverdue ? 'Show all' : 'Review overdue'}
            </button>
          </span>
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
        <div className="form-group" style={{ minWidth: 170 }}>
          <label>Type</label>
          <select className="form-input" value={fType} onChange={e => setFType(e.target.value)}>
            <option value="">All types</option>
            {typeOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            <option value="manual">Manual / other</option>
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
          <label>Looking ahead</label>
          <select
            className="form-input"
            value={fHorizon}
            onChange={e => setFHorizon(e.target.value)}
            disabled={!!fTo}
            title={fTo ? 'Ignored while a "Due to" date is set' : 'Hide work that is not due yet'}>
            <option value="30">Next 30 days</option>
            <option value="60">Next 60 days</option>
            <option value="90">Next 90 days</option>
            <option value="180">Next 6 months</option>
            <option value="365">Next 12 months</option>
            <option value="all">Everything</option>
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

      {/* Nothing is deleted by the horizon, so say where it went. */}
      {!loading && beyondHorizon > 0 && (
        <div style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
          {beyondHorizon} open task{beyondHorizon === 1 ? '' : 's'} not due yet {' '}
          <button
            className="btn btn-link btn-sm"
            style={{ padding: 0, fontSize: 12 }}
            onClick={() => setFHorizon('all')}>
            show everything
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : visibleTasks.length === 0 ? (
        <div className="empty-state">
          <p>
            No tasks match the current filters.
            {beyondHorizon > 0 && <> {beyondHorizon} are further ahead than the “Looking ahead” window.</>}
          </p>
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
