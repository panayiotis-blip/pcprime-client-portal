import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isStaffRole, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Yearly service-task completion grid. Shows every period each client's
// enabled services are EXPECTED to fire in the year (computed by
// service_task_year_plan, migration 159) — not just tasks already generated.
// Staff flag done + completion date + reference. A period with no task yet is
// generated on demand when acted on (or in bulk via "Generate all <year>").

type PlanRow = {
  client_id: number;
  client_name: string | null;
  client_code: string | null;
  service_id: number;
  service_key: string;
  service_label: string;
  stage_id: number;
  stage_label: string;
  fire_month: number;
  scheduled_date: string;
  period_label: string;
  task_id: number | null;
  status: string | null;
  completion_data: any;
};

const isDone = (s: string | null) => s === 'done';
const rowKey = (r: PlanRow) => `${r.client_id}:${r.stage_id}:${r.scheduled_date}`;

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
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [edits, setEdits] = useState<Record<string, { reference?: string; completed_date?: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadPlan = async (): Promise<PlanRow[]> => {
    setLoading(true);
    try {
      const rows = await api.getServiceTaskYearPlan(year) as PlanRow[];
      setPlan(rows);
      return rows;
    } catch {
      setPlan([]);
      return [];
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadPlan(); /* eslint-disable-next-line */ }, [year]);
  useEffect(() => {
    api.getServiceDefinitions()
      .then((d: any[]) => setServices(d.map(s => ({ key: s.key, label: s.label }))))
      .catch(() => {});
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plan
      .filter(r => !service || r.service_key === service)
      .filter(r => statusFilter === 'all' || (statusFilter === 'done' ? isDone(r.status) : !isDone(r.status)))
      .filter(r => !q || `${r.stage_label} ${r.period_label} ${r.client_name || ''} ${r.client_code || ''}`.toLowerCase().includes(q))
      .sort((a, b) =>
        (a.scheduled_date || '').localeCompare(b.scheduled_date || '') ||
        (a.client_name || '').localeCompare(b.client_name || ''));
  }, [plan, service, statusFilter, search]);

  const ref = (r: PlanRow) => edits[rowKey(r)]?.reference ?? r.completion_data?.reference ?? '';
  const cdate = (r: PlanRow) => edits[rowKey(r)]?.completed_date ?? r.completion_data?.completed_date ?? '';
  const setEdit = (k: string, patch: { reference?: string; completed_date?: string }) =>
    setEdits(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }));

  // Generate the single period's task on demand, then return the fresh plan.
  const generatePeriod = async (r: PlanRow): Promise<PlanRow[]> => {
    await api.runDueServiceSchedules({
      runDate: `${year}-${String(r.fire_month).padStart(2, '0')}-28`,
      serviceId: r.service_id,
      clientIds: [r.client_id],
    });
    return await loadPlan();
  };

  // Mark a period done. Generates the task first if it doesn't exist yet.
  const markDone = async (r: PlanRow) => {
    const k = rowKey(r);
    setSavingKey(k);
    try {
      let taskId = r.task_id;
      let existing = r.completion_data;
      if (!taskId) {
        const fresh = await generatePeriod(r);
        const nr = fresh.find(x => rowKey(x) === k);
        taskId = nr?.task_id ?? null;
        existing = nr?.completion_data;
        if (!taskId) { alert('Could not generate this task — check the service is still enabled for the client.'); return; }
      }
      const completion_data = {
        ...(existing || {}),
        reference: (edits[k]?.reference ?? existing?.reference) || null,
        completed_date: (edits[k]?.completed_date ?? existing?.completed_date ?? new Date().toISOString().slice(0, 10)) || null,
      };
      await api.updateStaffTask(taskId, { status: 'done', completion_data });
      setEdits(prev => { const n = { ...prev }; delete n[k]; return n; });
      await loadPlan();
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || e));
    } finally {
      setSavingKey(null);
    }
  };

  // Save completion fields on an already-done task (edit ref/date without reopening).
  const saveDetails = async (r: PlanRow) => {
    if (!r.task_id) return;
    const k = rowKey(r);
    setSavingKey(k);
    try {
      const completion_data = {
        ...(r.completion_data || {}),
        reference: ref(r) || null,
        completed_date: cdate(r) || null,
      };
      await api.updateStaffTask(r.task_id, { completion_data });
      setEdits(prev => { const n = { ...prev }; delete n[k]; return n; });
      await loadPlan();
    } catch (e: any) { alert('Save failed: ' + (e?.message || e)); }
    finally { setSavingKey(null); }
  };

  const reopen = async (r: PlanRow) => {
    if (!r.task_id) return;
    const k = rowKey(r);
    setSavingKey(k);
    try {
      await api.updateStaffTask(r.task_id, { status: 'open' });
      await loadPlan();
    } catch (e: any) { alert('Failed: ' + (e?.message || e)); }
    finally { setSavingKey(null); }
  };

  // Bulk: generate every expected period for the year so all tasks exist
  // (e.g. so their emails can be queued). On-demand per-row generation makes
  // this optional now, but it's kept for convenience.
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
      await loadPlan();
    } catch (e: any) {
      setBusy('');
      alert('Generate failed: ' + (e?.message || e));
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const cellStatus = (r: PlanRow): 'done' | 'overdue' | 'pending' | 'ungenerated' => {
    if (isDone(r.status)) return 'done';
    if (!r.task_id) return 'ungenerated';
    return r.scheduled_date && r.scheduled_date < todayIso ? 'overdue' : 'pending';
  };

  // Print the currently-filtered year grid as a clean table (new window).
  const printPlan = () => {
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const STATUS_TEXT = { done: 'Done', overdue: 'Overdue', pending: 'Pending', ungenerated: 'Not generated' } as const;
    const rowsHtml = rows.map(r => `<tr>
      <td>${esc((r.client_code ? r.client_code + '  ' : '') + (r.client_name || `#${r.client_id}`))}</td>
      <td>${esc(r.stage_label)} <span style="color:#888">(${esc(r.period_label)})</span></td>
      <td style="white-space:nowrap">${esc(r.scheduled_date || '—')}</td>
      <td>${esc(STATUS_TEXT[cellStatus(r)])}</td>
      <td style="white-space:nowrap">${esc(cdate(r) || '')}</td>
      <td>${esc(ref(r) || '')}</td>
    </tr>`).join('');
    const svcLabel = service ? (services.find(s => s.key === service)?.label || service) : 'All services';
    const statusLabel = statusFilter === 'all' ? 'All' : statusFilter === 'done' ? 'Done' : 'Outstanding';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Service tasks ${year}</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;color:#111;padding:20px;}
        h2{margin:0 0 2px;} .meta{color:#666;font-size:12px;margin-bottom:12px;}
        table{width:100%;border-collapse:collapse;font-size:12px;}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;}
        th{background:#f1f5f9;}
      </style></head><body>
      <h2>Service tasks — ${year}</h2>
      <div class="meta">${svcLabel} · ${statusLabel} · ${rows.filter(r => isDone(r.status)).length}/${rows.length} done · printed ${new Date().toLocaleString('en-GB')}</div>
      <table><thead><tr><th>Client</th><th>Task</th><th>Due</th><th>Status</th><th>Completed date</th><th>Reference</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print the year grid.'); return; }
    w.document.write(html); w.document.close();
  };

  if (!canView) return <div className="empty-state"><p>Staff only.</p></div>;

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];
  const doneCount = rows.filter(r => isDone(r.status)).length;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2 style={{ margin: 0 }}>Service tasks — {year}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={printPlan} disabled={loading || rows.length === 0}>
            Print
          </button>
          {canBackfill && (
            <button className="btn btn-secondary" onClick={backfill} disabled={!!busy}>
              {busy || `Generate all ${year}`}
            </button>
          )}
        </div>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 12px' }}>
        Every period each client's services are due to run this year — including ones not generated yet.
        Flag each done with its completion date and reference; a not-yet-generated period is created automatically when you mark it done.
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
        <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>{doneCount}/{rows.length} done</span>
      </div>

      {loading ? (
        <PanelSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No expected service tasks for {year}{service ? ' in this service' : ''}. Enable services for clients in Admin → Services.</p>
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
              {rows.map(r => {
                const k = rowKey(r);
                const st = cellStatus(r);
                const color = st === 'done' ? '#047857' : st === 'overdue' ? '#b91c1c' : st === 'ungenerated' ? '#64748b' : '#9b861f';
                const label = st === 'done' ? 'Done' : st === 'overdue' ? 'Overdue' : st === 'ungenerated' ? 'Not generated' : 'Pending';
                const saving = savingKey === k;
                return (
                  <tr key={k}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link to={`/clients/${r.client_id}`}>
                        {r.client_code ? <span className="client-code-inline">{r.client_code}</span> : null}
                        {r.client_name || `#${r.client_id}`}
                      </Link>
                    </td>
                    <td>{r.stage_label} <span style={{ color: '#94a3b8' }}>({r.period_label})</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.scheduled_date || '—'}</td>
                    <td style={{ fontWeight: 600, color }}>{label}</td>
                    <td>
                      <input type="date" className="form-input" style={{ width: 150, padding: '3px 6px' }}
                        value={cdate(r)} onChange={e => setEdit(k, { completed_date: e.target.value })} />
                    </td>
                    <td>
                      <input type="text" className="form-input" style={{ width: 140, padding: '3px 6px' }}
                        placeholder="Ref no." value={ref(r)} onChange={e => setEdit(k, { reference: e.target.value })} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {isDone(r.status) ? (
                        <>
                          <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => saveDetails(r)}>Save</button>{' '}
                          <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => reopen(r)}>Reopen</button>
                        </>
                      ) : (
                        <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => markDone(r)}>
                          {saving ? '…' : '✓ Done'}
                        </button>
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
