import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';

type Tab = 'invoices' | 'compliance' | 'workload';

const KIND_LABEL: Record<string, string> = {
  vat_quarterly:            'VAT',
  social_insurance_monthly: 'SI',
  ir7_annual:               'IR7',
  provisional_tax:          'Prov. Tax',
  he32_annual:              'HE32',
  ubo_annual:               'UBO',
};

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const monthKey = (invoice: any): string => {
  if (invoice.batch_month) return invoice.batch_month;
  const d = invoice.invoice_date as string | undefined;
  if (d) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
      const [, , mm, yyyy] = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || [];
      return `${yyyy}-${mm}`;
    }
    if (/^\d{4}-\d{2}/.test(d)) return d.slice(0, 7);
  }
  if (invoice.created_at) return String(invoice.created_at).slice(0, 7);
  return '';
};

const fmtMoney = (n: number) => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Reports() {
  const { invoices, clients } = useApp();
  const [tab, setTab] = useState<Tab>('invoices');

  // Compliance + tasks fetched on mount
  const [complianceTasks, setComplianceTasks] = useState<any[]>([]);
  const [staffTasks,      setStaffTasks]      = useState<any[]>([]);
  const [staffUsers,      setStaffUsers]      = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, t, u] = await Promise.all([
          api.getComplianceTasks({}),
          api.getStaffTasks({}),
          api.getUsers(),
        ]);
        if (cancelled) return;
        setComplianceTasks(c as any[]);
        setStaffTasks((t as any[]));
        setStaffUsers((u as any[]).filter(x => x.role !== 'client'));
      } catch (err: any) {
        alert('Failed to load reports data: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Reports</h2>
        <div className="dashboard-actions">
          <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="tab-bar no-print">
        <button className={`tab-btn ${tab === 'invoices'   ? 'active' : ''}`} onClick={() => setTab('invoices')}>Monthly Invoices</button>
        <button className={`tab-btn ${tab === 'compliance' ? 'active' : ''}`} onClick={() => setTab('compliance')}>Compliance Status</button>
        <button className={`tab-btn ${tab === 'workload'   ? 'active' : ''}`} onClick={() => setTab('workload')}>Staff Workload</button>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : tab === 'invoices' ? (
        <InvoiceSummary invoices={invoices} clients={clients} />
      ) : tab === 'compliance' ? (
        <ComplianceSnapshot tasks={complianceTasks} clients={clients} />
      ) : (
        <Workload tasks={staffTasks} staffUsers={staffUsers} />
      )}
    </div>
  );
}

// ============================================================
// Report 1 — Monthly Invoice Summary
// ============================================================
function InvoiceSummary({ invoices, clients }: { invoices: any[]; clients: any[] }) {
  const [fClient, setFClient] = useState<string>('');
  const [fFrom,   setFFrom]   = useState<string>('');
  const [fTo,     setFTo]     = useState<string>('');

  const clientName = (id: number) => {
    const c = clients.find((x: any) => x.id === id);
    return c ? `${c.client_code ? c.client_code + ' — ' : ''}${c.name}` : `#${id}`;
  };

  const rows = useMemo(() => {
    type Acc = {
      client_id: number; month: string; count: number;
      draft: number; reviewed: number; exported: number; total: number;
    };
    const groups = new Map<string, Acc>();
    for (const inv of invoices) {
      if (fClient && String(inv.client_id) !== fClient) continue;
      const m = monthKey(inv);
      if (!m) continue;
      if (fFrom && m < fFrom) continue;
      if (fTo   && m > fTo)   continue;
      const key = `${inv.client_id}|${m}`;
      const existing = groups.get(key) || {
        client_id: inv.client_id, month: m, count: 0, draft: 0, reviewed: 0, exported: 0, total: 0,
      };
      existing.count++;
      if (inv.status === 'draft')    existing.draft++;
      if (inv.status === 'reviewed') existing.reviewed++;
      if (inv.status === 'exported') existing.exported++;
      existing.total += Number(inv.total_amount || 0);
      groups.set(key, existing);
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.client_id !== b.client_id
        ? clientName(a.client_id).localeCompare(clientName(b.client_id))
        : b.month.localeCompare(a.month) // newest month first within a client
    );
    // eslint-disable-next-line
  }, [invoices, fClient, fFrom, fTo]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    count: acc.count + r.count,
    draft: acc.draft + r.draft,
    reviewed: acc.reviewed + r.reviewed,
    exported: acc.exported + r.exported,
    total: acc.total + r.total,
  }), { count: 0, draft: 0, reviewed: 0, exported: 0, total: 0 }), [rows]);

  return (
    <div>
      <div className="filters-bar no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }}>
        <div className="form-group" style={{ minWidth: 220 }}>
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
          <label>From month</label>
          <input type="month" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div className="form-group">
          <label>To month</label>
          <input type="month" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state"><p>No invoices match these filters.</p></div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Count</th>
                <th style={{ textAlign: 'right' }}>Drafts</th>
                <th style={{ textAlign: 'right' }}>Reviewed</th>
                <th style={{ textAlign: 'right' }}>Exported</th>
                <th style={{ textAlign: 'right' }}>Total amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.client_id}-${r.month}`}>
                  <td>{clientName(r.client_id)}</td>
                  <td>{r.month}</td>
                  <td style={{ textAlign: 'right' }}>{r.count}</td>
                  <td style={{ textAlign: 'right' }}>{r.draft}</td>
                  <td style={{ textAlign: 'right' }}>{r.reviewed}</td>
                  <td style={{ textAlign: 'right' }}>{r.exported}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, background: '#f8fafc' }}>
                <td colSpan={2}>Total ({rows.length} rows)</td>
                <td style={{ textAlign: 'right' }}>{totals.count}</td>
                <td style={{ textAlign: 'right' }}>{totals.draft}</td>
                <td style={{ textAlign: 'right' }}>{totals.reviewed}</td>
                <td style={{ textAlign: 'right' }}>{totals.exported}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Report 2 — Compliance Status Snapshot
// ============================================================
function ComplianceSnapshot({ tasks, clients }: { tasks: any[]; clients: any[] }) {
  const [fKind, setFKind] = useState<string>('');

  const today = todayIso();
  const clientName = (id: number) => {
    const c = clients.find((x: any) => x.id === id);
    return c ? `${c.client_code ? c.client_code + ' — ' : ''}${c.name}` : `#${id}`;
  };

  const rows = useMemo(() => {
    type Acc = {
      client_id: number; kind: string;
      open: number; overdue: number; filed: number; completed: number;
    };
    const groups = new Map<string, Acc>();
    for (const t of tasks) {
      if (fKind && t.kind !== fKind) continue;
      const key = `${t.client_id}|${t.kind}`;
      const existing = groups.get(key) || {
        client_id: t.client_id, kind: t.kind, open: 0, overdue: 0, filed: 0, completed: 0,
      };
      const isOpen = t.status === 'not_started' || t.status === 'in_preparation';
      if (isOpen)              existing.open++;
      if (t.status === 'filed')     existing.filed++;
      if (t.status === 'completed') existing.completed++;
      if (isOpen && t.due_date < today) existing.overdue++;
      groups.set(key, existing);
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.client_id !== b.client_id
        ? clientName(a.client_id).localeCompare(clientName(b.client_id))
        : (KIND_LABEL[a.kind] || a.kind).localeCompare(KIND_LABEL[b.kind] || b.kind)
    );
    // eslint-disable-next-line
  }, [tasks, fKind]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    open:      acc.open      + r.open,
    overdue:   acc.overdue   + r.overdue,
    filed:     acc.filed     + r.filed,
    completed: acc.completed + r.completed,
  }), { open: 0, overdue: 0, filed: 0, completed: 0 }), [rows]);

  return (
    <div>
      <div className="filters-bar no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }}>
        <div className="form-group" style={{ minWidth: 200 }}>
          <label>Type</label>
          <select className="form-input" value={fKind} onChange={e => setFKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state"><p>No compliance tasks yet.</p></div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Open</th>
                <th style={{ textAlign: 'right', color: '#b91c1c' }}>Overdue</th>
                <th style={{ textAlign: 'right' }}>Filed</th>
                <th style={{ textAlign: 'right' }}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.client_id}-${r.kind}`}>
                  <td>{clientName(r.client_id)}</td>
                  <td>{KIND_LABEL[r.kind] || r.kind}</td>
                  <td style={{ textAlign: 'right' }}>{r.open}</td>
                  <td style={{ textAlign: 'right', color: r.overdue > 0 ? '#b91c1c' : undefined, fontWeight: r.overdue > 0 ? 600 : 400 }}>{r.overdue}</td>
                  <td style={{ textAlign: 'right' }}>{r.filed}</td>
                  <td style={{ textAlign: 'right' }}>{r.completed}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, background: '#f8fafc' }}>
                <td colSpan={2}>Total ({rows.length} rows)</td>
                <td style={{ textAlign: 'right' }}>{totals.open}</td>
                <td style={{ textAlign: 'right', color: totals.overdue > 0 ? '#b91c1c' : undefined }}>{totals.overdue}</td>
                <td style={{ textAlign: 'right' }}>{totals.filed}</td>
                <td style={{ textAlign: 'right' }}>{totals.completed}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Report 3 — Staff Workload
// ============================================================
function Workload({ tasks, staffUsers }: { tasks: any[]; staffUsers: any[] }) {
  const today = todayIso();
  const oneWeekFromToday = (() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  const rows = useMemo(() => {
    type Acc = {
      user_id: string | null;
      open: number; in_progress: number; blocked: number; done: number;
      overdue: number; due_this_week: number;
    };
    const groups = new Map<string, Acc>();
    const ensure = (uid: string | null) => {
      const k = uid || '__unassigned__';
      const e = groups.get(k) || {
        user_id: uid, open: 0, in_progress: 0, blocked: 0, done: 0, overdue: 0, due_this_week: 0,
      };
      groups.set(k, e);
      return e;
    };
    for (const t of tasks) {
      const e = ensure(t.assigned_to);
      if (t.status === 'open')        e.open++;
      if (t.status === 'in_progress') e.in_progress++;
      if (t.status === 'blocked')     e.blocked++;
      if (t.status === 'done')        e.done++;
      const isOpen = t.status !== 'done' && t.status !== 'cancelled';
      if (isOpen && t.due_date && t.due_date < today)            e.overdue++;
      if (isOpen && t.due_date && t.due_date >= today && t.due_date <= oneWeekFromToday) e.due_this_week++;
    }
    const userName = (uid: string | null) => {
      if (!uid) return '— Unassigned —';
      const u = staffUsers.find(x => x.id === uid);
      return u?.display_name || u?.username || uid.slice(0, 8);
    };
    return Array.from(groups.values()).sort((a, b) =>
      userName(a.user_id).localeCompare(userName(b.user_id))
    );
  }, [tasks, staffUsers, today, oneWeekFromToday]);

  const userName = (uid: string | null) => {
    if (!uid) return '— Unassigned —';
    const u = staffUsers.find(x => x.id === uid);
    return u?.display_name || u?.username || uid.slice(0, 8);
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '8px 0' }}>
        Snapshot of current staff_tasks workload by assignee.
      </p>
      {rows.length === 0 ? (
        <div className="empty-state"><p>No tasks yet.</p></div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Assignee</th>
                <th style={{ textAlign: 'right' }}>Open</th>
                <th style={{ textAlign: 'right' }}>In progress</th>
                <th style={{ textAlign: 'right' }}>Blocked</th>
                <th style={{ textAlign: 'right' }}>Done</th>
                <th style={{ textAlign: 'right', color: '#b45309' }}>Due ≤ 7d</th>
                <th style={{ textAlign: 'right', color: '#b91c1c' }}>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.user_id || '__unassigned__'}>
                  <td>{userName(r.user_id)}</td>
                  <td style={{ textAlign: 'right' }}>{r.open}</td>
                  <td style={{ textAlign: 'right' }}>{r.in_progress}</td>
                  <td style={{ textAlign: 'right' }}>{r.blocked}</td>
                  <td style={{ textAlign: 'right' }}>{r.done}</td>
                  <td style={{ textAlign: 'right', color: r.due_this_week > 0 ? '#b45309' : undefined, fontWeight: r.due_this_week > 0 ? 600 : 400 }}>{r.due_this_week}</td>
                  <td style={{ textAlign: 'right', color: r.overdue > 0 ? '#b91c1c' : undefined, fontWeight: r.overdue > 0 ? 600 : 400 }}>{r.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
