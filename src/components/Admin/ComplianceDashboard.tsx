import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

type Task = {
  id: number;
  client_id: number;
  client_name: string;
  client_code: string;
  kind: string;
  period_label: string | null;
  period_start: string;
  period_end: string;
  due_date: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at: string | null;
  submitted_at: string | null;
  reference: string | null;
  notes: string | null;
};

const STATUS_OPTIONS: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled'];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const daysFromToday = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};

const dueClass = (t: Task) => {
  if (t.status === 'completed') return 'status-exported';
  const days = daysFromToday(t.due_date);
  if (days < 0) return 'status-draft';   // overdue — uses red-ish "draft" badge
  if (days <= 14) return 'status-reviewed'; // due soon — amber
  return '';
};

export default function ComplianceDashboard() {
  const { clients } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [fClient, setFClient]   = useState<string>('');
  const [fStatus, setFStatus]   = useState<string>('open'); // 'open' = pending+in_progress
  const [fFrom, setFFrom]       = useState<string>('');
  const [fTo, setFTo]           = useState<string>('');
  const [search, setSearch]     = useState<string>('');

  const reload = async () => {
    setLoading(true);
    try {
      const params: any = { kind: 'vat_quarterly' };
      if (fClient)             params.client_id = Number(fClient);
      if (fStatus && fStatus !== 'all' && fStatus !== 'open') params.status = fStatus;
      if (fFrom)               params.from = fFrom;
      if (fTo)                 params.to = fTo;
      const data = await api.getComplianceTasks(params);
      setTasks(data as Task[]);
    } catch (err: any) {
      alert('Failed to load tasks: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fClient, fStatus, fFrom, fTo]);

  const visibleTasks = useMemo(() => {
    let out = tasks;
    if (fStatus === 'open') out = out.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(t =>
        (t.client_name || '').toLowerCase().includes(q) ||
        (t.client_code || '').toLowerCase().includes(q) ||
        (t.period_label || '').toLowerCase().includes(q),
      );
    }
    return out;
  }, [tasks, fStatus, search]);

  const stats = useMemo(() => {
    const today = todayIso();
    return {
      total: visibleTasks.length,
      overdue: visibleTasks.filter(t => t.status !== 'completed' && t.due_date < today).length,
      due30: visibleTasks.filter(t => {
        if (t.status === 'completed') return false;
        const d = daysFromToday(t.due_date);
        return d >= 0 && d <= 30;
      }).length,
      done: visibleTasks.filter(t => t.status === 'completed').length,
    };
  }, [visibleTasks]);

  const handleGenerate = async () => {
    if (!confirm('Generate the current and next 4 VAT quarters for every VAT-registered client? Duplicates will be skipped automatically.')) return;
    setGenerating(true);
    try {
      const r = await api.generateVatTasks({ lookbackQuarters: 1, lookaheadQuarters: 4 });
      alert(`Done.\nVAT-registered clients: ${r.vat_clients}\nRows attempted:         ${r.attempted}\nNew tasks created:      ${r.created}`);
      await reload();
    } catch (err: any) {
      alert('Generation failed: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const patchTask = async (id: number, patch: Partial<Task>) => {
    try {
      await api.updateComplianceTask(id, patch);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } as Task : t));
    } catch (err: any) {
      alert('Update failed: ' + err.message);
    }
  };

  const markDone = (t: Task) => {
    const today = todayIso();
    patchTask(t.id, {
      status: 'completed',
      completed_at: t.completed_at || today,
      submitted_at: t.submitted_at || today,
    } as Partial<Task>);
  };

  const reopen = (t: Task) => {
    patchTask(t.id, { status: 'pending', completed_at: null, submitted_at: null } as Partial<Task>);
  };

  const handleDelete = async (t: Task) => {
    if (!confirm(`Delete this task for ${t.client_name} (${t.period_label})?`)) return;
    try {
      await api.deleteComplianceTask(t.id);
      setTasks(prev => prev.filter(x => x.id !== t.id));
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div className="dashboard compliance-dashboard">
      <div className="dashboard-header">
        <h2>Compliance — VAT Returns</h2>
        <div className="dashboard-actions">
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating...' : '+ Generate Quarters'}
          </button>
          <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-number">{stats.total}</div><div className="stat-label">Tasks</div></div>
        <div className="stat-card stat-draft"><div className="stat-number">{stats.overdue}</div><div className="stat-label">Overdue</div></div>
        <div className="stat-card stat-reviewed"><div className="stat-number">{stats.due30}</div><div className="stat-label">Due ≤ 30d</div></div>
        <div className="stat-card stat-exported"><div className="stat-number">{stats.done}</div><div className="stat-label">Completed</div></div>
      </div>

      <div className="filters-bar no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '16px 0' }}>
        <div className="form-group" style={{ minWidth: 200 }}>
          <label>Client</label>
          <select className="form-input" value={fClient} onChange={e => setFClient(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.client_code ? `${c.client_code} — ` : ''}{c.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 160 }}>
          <label>Status</label>
          <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="open">Open (pending + in progress)</option>
            <option value="all">All</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
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
          <input type="text" className="form-input" placeholder="client, code, period..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : visibleTasks.length === 0 ? (
        <div className="empty-state">
          <p>No tasks match the current filters.</p>
          <p>Mark clients as VAT-registered (with a period group) on their detail page, then click <strong>+ Generate Quarters</strong>.</p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Period</th>
                <th>Due</th>
                <th>Status</th>
                <th>Completed</th>
                <th>Submitted</th>
                <th>Reference</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map(t => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/clients/${t.client_id}`}>
                      {t.client_code && <span className="client-code-inline">{t.client_code}</span>}
                      {t.client_name}
                    </Link>
                  </td>
                  <td>{t.period_label || `${t.period_start} → ${t.period_end}`}</td>
                  <td>
                    <span className={`status-badge ${dueClass(t)}`}>{t.due_date}</span>
                  </td>
                  <td>
                    <select
                      className="form-input form-input-sm no-print"
                      value={t.status}
                      onChange={e => patchTask(t.id, { status: e.target.value as Task['status'] } as any)}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <span className="print-only">{t.status}</span>
                  </td>
                  <td>
                    <input
                      type="date"
                      className="form-input form-input-sm no-print"
                      value={t.completed_at || ''}
                      onChange={e => patchTask(t.id, { completed_at: e.target.value || null } as any)}
                    />
                    <span className="print-only">{t.completed_at || ''}</span>
                  </td>
                  <td>
                    <input
                      type="date"
                      className="form-input form-input-sm no-print"
                      value={t.submitted_at || ''}
                      onChange={e => patchTask(t.id, { submitted_at: e.target.value || null } as any)}
                    />
                    <span className="print-only">{t.submitted_at || ''}</span>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-input form-input-sm no-print"
                      placeholder="Receipt / ref"
                      value={t.reference || ''}
                      onChange={e => patchTask(t.id, { reference: e.target.value || null } as any)}
                    />
                    <span className="print-only">{t.reference || ''}</span>
                  </td>
                  <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                    {t.status === 'completed' ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => reopen(t)}>Reopen</button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => markDone(t)}>Mark Done</button>
                    )}
                    <button className="btn btn-link btn-sm" onClick={() => handleDelete(t)} style={{ marginLeft: 6 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
