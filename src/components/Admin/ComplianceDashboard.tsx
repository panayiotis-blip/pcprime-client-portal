import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';

type Status = 'not_started' | 'in_preparation' | 'filed' | 'completed';

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
  status: Status;
  completed_at: string | null;
  submitted_at: string | null;
  reference: string | null;
  notes: string | null;
};

const STATUS_OPTIONS: Status[] = ['not_started', 'in_preparation', 'filed', 'completed'];
const STATUS_LABEL: Record<Status, string> = {
  not_started:    'Not Started',
  in_preparation: 'In Preparation',
  filed:          'Filed',
  completed:      'Completed',
};

const KIND_OPTIONS = [
  { value: '',                          label: 'All' },
  { value: 'vat_quarterly',             label: 'VAT' },
  { value: 'social_insurance_monthly',  label: 'Social Insurance' },
  { value: 'ir7_annual',                label: 'IR7' },
  { value: 'provisional_tax',           label: 'Provisional Tax' },
  { value: 'he32_annual',               label: 'HE32' },
  { value: 'ubo_annual',                label: 'UBO' },
] as const;

const KIND_LABEL: Record<string, string> = {
  vat_quarterly:            'VAT',
  social_insurance_monthly: 'SI',
  ir7_annual:               'IR7',
  provisional_tax:          'Prov. Tax',
  he32_annual:              'HE32',
  ubo_annual:               'UBO',
};

// Default month picker value: this month, formatted YYYY-MM (HTML <input type="month">).
const currentYyyyMm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const daysFromToday = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};

const isOpenStatus = (s: Status) => s === 'not_started' || s === 'in_preparation';
const isClosedStatus = (s: Status) => s === 'filed' || s === 'completed';

const dueClass = (t: Task) => {
  if (isClosedStatus(t.status)) return 'status-exported';
  const days = daysFromToday(t.due_date);
  if (days < 0)   return 'status-draft';     // overdue — red
  if (days <= 14) return 'status-reviewed';  // due soon — amber
  return '';
};

export default function ComplianceDashboard() {
  const { clients } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [fClient, setFClient]   = useState<string>('');
  const [fStatus, setFStatus]   = useState<string>('open'); // 'open' = not_started + in_preparation
  const [fKind, setFKind]       = useState<string>('');
  const [fFrom, setFFrom]       = useState<string>('');
  const [fTo, setFTo]           = useState<string>('');
  const [search, setSearch]     = useState<string>('');
  const [genMonth, setGenMonth] = useState<string>(currentYyyyMm());

  const reload = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (fClient)             params.client_id = Number(fClient);
      if (fKind)               params.kind = fKind;
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

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fClient, fStatus, fKind, fFrom, fTo]);

  const visibleTasks = useMemo(() => {
    let out = tasks;
    if (fStatus === 'open') out = out.filter(t => isOpenStatus(t.status));
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
      total:   visibleTasks.length,
      overdue: visibleTasks.filter(t => !isClosedStatus(t.status) && t.due_date < today).length,
      due30:   visibleTasks.filter(t => {
        if (isClosedStatus(t.status)) return false;
        const d = daysFromToday(t.due_date);
        return d >= 0 && d <= 30;
      }).length,
      done: visibleTasks.filter(t => isClosedStatus(t.status)).length,
    };
  }, [visibleTasks]);

  const runGenerateForMonth = async () => {
    if (!genMonth) { alert('Pick a month first'); return; }
    setGenerating(true);
    try {
      const r = await api.generateForMonth(genMonth);
      const lines = [
        `Routine (due by end of ${genMonth} or overdue):`,
        `  VAT:             ${r.vat.created} new`,
        `  Social Insurance:${r.si.created} new`,
        `  IR7:             ${r.ir7.created} new`,
        `Important (forward-looking):`,
        `  Provisional Tax: ${r.ptax.created} new (${r.ptax.eligible_clients} clients)`,
        `  HE32:            ${r.he32.created} new (${r.he32.eligible_clients} clients with incorporation_date)`,
        `  UBO:             ${r.ubo.created} new (${r.ubo.eligible_clients} eligible companies/partnerships)`,
        ``,
        `Total new tasks: ${r.total}`,
      ];
      alert(lines.join('\n'));
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

  const markFiled = (t: Task) => {
    patchTask(t.id, { status: 'filed', submitted_at: t.submitted_at || todayIso() } as Partial<Task>);
  };

  const markCompleted = (t: Task) => {
    const today = todayIso();
    patchTask(t.id, {
      status: 'completed',
      submitted_at: t.submitted_at || today,
      completed_at: t.completed_at || today,
    } as Partial<Task>);
  };

  const reopen = (t: Task) => {
    patchTask(t.id, { status: 'not_started', completed_at: null, submitted_at: null } as Partial<Task>);
  };

  const handleDelete = async (t: Task) => {
    if (!confirm(`Delete this ${KIND_LABEL[t.kind] || t.kind} task for ${t.client_name} (${t.period_label})?`)) return;
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
        <h2>Compliance</h2>
        <div className="dashboard-actions" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#475569' }}>Focus month:</label>
          <input
            type="month"
            value={genMonth}
            onChange={(e) => setGenMonth(e.target.value)}
            className="form-input"
            style={{ width: 160, padding: '6px 8px' }}
          />
          <button className="btn btn-primary btn-sm" disabled={generating} onClick={runGenerateForMonth}>
            {generating ? 'Generating...' : '+ Generate'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="stats-grid stats-grid-compact">
        <div className="stat-card stat-card-sm"><div className="stat-number">{stats.total}</div><div className="stat-label">Tasks</div></div>
        <div className="stat-card stat-card-sm stat-draft"><div className="stat-number">{stats.overdue}</div><div className="stat-label">Overdue</div></div>
        <div className="stat-card stat-card-sm stat-reviewed"><div className="stat-number">{stats.due30}</div><div className="stat-label">Due ≤ 30d</div></div>
        <div className="stat-card stat-card-sm stat-exported"><div className="stat-number">{stats.done}</div><div className="stat-label">Closed</div></div>
      </div>

      <div className="filters-bar no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '14px 0 16px 0' }}>
        <div className="form-group" style={{ minWidth: 160 }}>
          <label>Type</label>
          <select className="form-input" value={fKind} onChange={e => setFKind(e.target.value)}>
            {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 200 }}>
          <label>Client</label>
          <SearchableSelect
            value={fClient}
            options={toClientOptions(clients)}
            onChange={v => setFClient(v ? String(v) : '')}
            placeholder="All clients"
            allowClear
          />
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Status</label>
          <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="open">Open (not started + in preparation)</option>
            <option value="all">All</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
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
          <p>
            For VAT: mark clients as VAT-registered with a period group on their detail page.<br/>
            For Social Insurance & IR7: clients need an <code>employer_number</code> set.<br/>
            Then click <strong>+ Generate All</strong> above.
          </p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Type</th>
                <th>Period</th>
                <th>Due</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Completed</th>
                <th>Reference</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map(t => (
                <tr key={t.id}>
                  <td title={t.client_name}>
                    <Link to={`/clients/${t.client_id}`}>
                      {t.client_code && <span className="client-code-inline">{t.client_code}</span>}
                      {t.client_name}
                    </Link>
                  </td>
                  <td><span className="status-badge">{KIND_LABEL[t.kind] || t.kind}</span></td>
                  <td>{t.period_label || `${t.period_start} → ${t.period_end}`}</td>
                  <td><span className={`status-badge ${dueClass(t)}`}>{t.due_date}</span></td>
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
                      type="date"
                      className="form-input form-input-sm no-print"
                      value={t.completed_at || ''}
                      onChange={e => patchTask(t.id, { completed_at: e.target.value || null } as any)}
                    />
                    <span className="print-only">{t.completed_at || ''}</span>
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
                    {isClosedStatus(t.status) ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => reopen(t)}>Reopen</button>
                    ) : (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => markFiled(t)}>File</button>
                        <button className="btn btn-primary btn-sm" style={{ marginLeft: 6 }} onClick={() => markCompleted(t)} title="Mark completed">✓</button>
                      </>
                    )}
                    <button className="btn btn-link btn-sm" onClick={() => handleDelete(t)} style={{ marginLeft: 6 }} title="Delete task">🗑</button>
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
