import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isStaffRole, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Yearly service-task completion grid. Every service-generated task for the
// selected year, per client, where staff flag done + completion date +
// reference number. A backfill button ensures the whole year's tasks exist.

type Task = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  title: string;
  due_date: string | null;
  status: string;
  service_stage_id: number | null;
  service_key: string | null;
  service_label: string | null;
  stage_label: string | null;
  completion_data: any;
};

const isDone = (s: string) => s === 'done';

export default function ServiceTasksYear() {
  const { user } = useAuth();
  const canView = isStaffRole(user);
  const canBackfill = isSupervisorOrHigher(user);

  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [service, setService] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'outstanding' | 'done'>('all');
  const [services, setServices] = useState<{ key: string; label: string }[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [edits, setEdits] = useState<Record<number, { reference?: string; completed_date?: string }>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.getStaffTasks({ from: `${year}-01-01`, to: `${year}-12-31` })
      .then((rows: any[]) => setTasks(rows.filter(t => t.service_stage_id != null) as Task[]))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [year]);
  useEffect(() => {
    api.getServiceDefinitions()
      .then((d: any[]) => setServices(d.map(s => ({ key: s.key, label: s.label }))))
      .catch(() => {});
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks
      .filter(t => !service || t.service_key === service)
      .filter(t => statusFilter === 'all' || (statusFilter === 'done' ? isDone(t.status) : !isDone(t.status)))
      .filter(t => !q || `${t.title} ${t.client_name || ''} ${t.client_code || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || (a.client_name || '').localeCompare(b.client_name || ''));
  }, [tasks, service, statusFilter, search]);

  const ref = (t: Task) => edits[t.id]?.reference ?? t.completion_data?.reference ?? '';
  const cdate = (t: Task) => edits[t.id]?.completed_date ?? t.completion_data?.completed_date ?? '';
  const setEdit = (id: number, patch: { reference?: string; completed_date?: string }) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async (t: Task, markDone: boolean) => {
    setSavingId(t.id);
    try {
      const completion_data = {
        ...(t.completion_data || {}),
        reference: ref(t) || null,
        completed_date: (cdate(t) || (markDone ? new Date().toISOString().slice(0, 10) : '')) || null,
      };
      const patch: any = { completion_data, status: markDone ? 'done' : (isDone(t.status) ? 'done' : 'open') };
      await api.updateStaffTask(t.id, patch);
      setTasks(prev => prev.map(x => (x.id === t.id ? { ...x, ...patch } : x)));
      setEdits(prev => { const n = { ...prev }; delete n[t.id]; return n; });
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || e));
    } finally {
      setSavingId(null);
    }
  };

  const reopen = async (t: Task) => {
    setSavingId(t.id);
    try {
      await api.updateStaffTask(t.id, { status: 'open' });
      setTasks(prev => prev.map(x => (x.id === t.id ? { ...x, status: 'open' } : x)));
    } catch (e: any) { alert('Failed: ' + (e?.message || e)); }
    finally { setSavingId(null); }
  };

  // Generate every month of the year so the grid shows the full year.
  const backfill = async () => {
    if (!confirm(`Generate all service tasks for ${year}? This creates any missing tasks for every month (existing ones are untouched).`)) return;
    setBusy('Generating…');
    try {
      let created = 0;
      for (let m = 1; m <= 12; m++) {
        setBusy(`Generating ${year}-${String(m).padStart(2, '0')}…`);
        const r = await api.runDueServiceSchedules({ runDate: `${year}-${String(m).padStart(2, '0')}-28` });
        created += r.created_tasks;
      }
      setBusy('');
      alert(`Done — ${created} task(s) created for ${year}.`);
      load();
    } catch (e: any) {
      setBusy('');
      alert('Generate failed: ' + (e?.message || e));
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const cellStatus = (t: Task) => isDone(t.status) ? 'done' : (t.due_date && t.due_date < todayIso ? 'overdue' : 'pending');

  if (!canView) return <div className="empty-state"><p>Staff only.</p></div>;

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2 style={{ margin: 0 }}>Service tasks — {year}</h2>
        {canBackfill && (
          <button className="btn btn-secondary" onClick={backfill} disabled={!!busy}>
            {busy || `Generate all ${year}`}
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 12px' }}>
        Every service-generated task for the year. Flag each as done with its completion date and reference number.
      </p>

      <div className="tf-summary-controls">
        <label><span className="tf-control-label">Year</span>
          <select className="form-input form-input-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label><span className="tf-control-label">Service</span>
          <select className="form-input form-input-sm" value={service} onChange={e => setService(e.target.value)}>
            <option value="">All services</option>
            {services.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label><span className="tf-control-label">Status</span>
          <select className="form-input form-input-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="outstanding">Outstanding</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label><span className="tf-control-label">Search</span>
          <input className="form-input form-input-sm" placeholder="Client or task" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>{rows.length} tasks</span>
      </div>

      {loading ? (
        <PanelSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No service tasks for {year}{service ? ' in this service' : ''}.</p>
          {canBackfill && <button className="btn btn-primary" onClick={backfill} disabled={!!busy}>{busy || `Generate all ${year}`}</button>}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Task</th>
                <th style={{ whiteSpace: 'nowrap' }}>Due</th>
                <th>Status</th>
                <th>Completed date</th>
                <th>Reference</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const st = cellStatus(t);
                const color = st === 'done' ? '#047857' : st === 'overdue' ? '#b91c1c' : '#9b861f';
                return (
                  <tr key={t.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {t.client_id
                        ? <Link to={`/clients/${t.client_id}`}>{t.client_code ? <span className="client-code-inline">{t.client_code}</span> : null}{t.client_name || `#${t.client_id}`}</Link>
                        : '—'}
                    </td>
                    <td>{t.title}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{t.due_date || '—'}</td>
                    <td style={{ fontWeight: 600, color }}>{st === 'done' ? 'Done' : st === 'overdue' ? 'Overdue' : 'Pending'}</td>
                    <td>
                      <input type="date" className="form-input" style={{ width: 150, padding: '3px 6px' }}
                        value={cdate(t)} onChange={e => setEdit(t.id, { completed_date: e.target.value })} />
                    </td>
                    <td>
                      <input type="text" className="form-input" style={{ width: 140, padding: '3px 6px' }}
                        placeholder="Ref no." value={ref(t)} onChange={e => setEdit(t.id, { reference: e.target.value })} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {isDone(t.status) ? (
                        <>
                          <button className="btn btn-secondary btn-sm" disabled={savingId === t.id} onClick={() => save(t, true)}>Save</button>{' '}
                          <button className="btn btn-secondary btn-sm" disabled={savingId === t.id} onClick={() => reopen(t)}>Reopen</button>
                        </>
                      ) : (
                        <button className="btn btn-primary btn-sm" disabled={savingId === t.id} onClick={() => save(t, true)}>✓ Done</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
