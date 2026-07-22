import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import {
  FILING_TYPES, FILING_STATUSES,
  filingTypeLabel, StatusPill, taxYears,
} from '../shared/TaxFilingMeta';
import TaxFilingsSummary from './TaxFilingsSummary';

type Filing = {
  id: number;
  client_id: number;
  client_name: string | null;
  client_code: string | null;
  tax_year: number;
  filing_type: string;
  status: string;
  due_date: string | null;
  filed_date: string | null;
  filed_by_user_id: string | null;
  reference_number: string | null;
  amount: number | null;
  notes: string | null;
};

const DEFAULT_VIEWS: { key: string; label: string; filter: any }[] = [
  { key: 'overdue',         label: '🚨 Overdue Filings',      filter: { overdue_only: true } },
  { key: 'pending_year',    label: '📅 Pending This Year',    filter: { year: new Date().getFullYear(), status: 'pending' } },
  { key: 'filed_year',      label: '✅ Filed This Year',      filter: { year: new Date().getFullYear(), status: 'filed' } },
  { key: 'this_month',      label: '⏰ Due This Month',       filter: { due_this_month: true } },
];

// Global cross-client Tax Filings page
export default function TaxFilingsPage() {
  const [searchParams] = useSearchParams();
  const { runWith } = useMFAStepUp();
  const [rows, setRows] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Filter state
  const initialFilter = useMemo(() => {
    const f: any = {};
    if (searchParams.get('overdue') === '1') f.overdue_only = true;
    if (searchParams.get('due_this_month') === '1') f.due_this_month = true;
    if (searchParams.get('year')) f.year = Number(searchParams.get('year'));
    if (searchParams.get('status')) f.status = searchParams.get('status');
    if (searchParams.get('filing_type')) f.filing_type = searchParams.get('filing_type');
    return f;
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const [filter, setFilter] = useState<any>(initialFilter);
  // Deep links that carry a filter (from the dashboard tiles) open the detailed
  // list, since they describe a specific slice rather than the whole picture.
  const [view, setView] = useState<'summary' | 'list'>(
    Object.keys(initialFilter).length > 0 ? 'list' : 'summary',
  );

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getAllTaxFilings(filter);
      setRows(data as Filing[]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [JSON.stringify(filter)]);

  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggleSelectAll = () => {
    if (allOnPageSelected) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };
  const toggleSelect = (id: number) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const setFilterField = (k: string, v: any) => {
    setFilter((prev: any) => {
      const next = { ...prev };
      if (v === '' || v == null) delete next[k];
      else next[k] = v;
      return next;
    });
  };
  const clearFilters = () => setFilter({});

  const applyView = (view: any) => setFilter(view.filter);

  const bulkMark = async (status: string) => {
    if (selected.size === 0) return;
    if (!confirm(`Mark ${selected.size} filing${selected.size === 1 ? '' : 's'} as "${status}"?`)) return;
    try {
      const patch: any = { status };
      if (status === 'filed' || status === 'submitted' || status === 'paid') {
        patch.filed_date = new Date().toISOString().slice(0, 10);
      }
      await runWith(() => api.bulkUpdateTaxFilings(Array.from(selected), patch));
      await load();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Bulk update failed: ' + err.message);
    }
  };

  const exportExcel = () => {
    const data = rows.map(r => ({
      'Client Code':   r.client_code || '',
      'Client Name':   r.client_name || '',
      'Tax Year':      r.tax_year,
      'Filing Type':   filingTypeLabel(r.filing_type),
      'Status':        r.status,
      'Due Date':      r.due_date || '',
      'Filed Date':    r.filed_date || '',
      'Reference':     r.reference_number || '',
      'Amount':        r.amount ?? '',
      'Notes':         r.notes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tax Filings');
    XLSX.writeFile(wb, `tax-filings-export-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const activeFilterChips: { key: string; label: string }[] = [];
  if (filter.year)           activeFilterChips.push({ key: 'year',         label: `Year: ${filter.year}` });
  if (filter.filing_type)    activeFilterChips.push({ key: 'filing_type',  label: `Type: ${filingTypeLabel(filter.filing_type)}` });
  if (filter.status)         activeFilterChips.push({ key: 'status',       label: `Status: ${filter.status}` });
  if (filter.overdue_only)   activeFilterChips.push({ key: 'overdue_only', label: 'Overdue only' });
  if (filter.due_this_month) activeFilterChips.push({ key: 'due_this_month', label: 'Due this month' });

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Tax Filings</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {/* Summary is the default: the at-a-glance picture across clients.
              List keeps the filters, bulk status actions and Excel export. */}
          <div className="tf-view-toggle">
            <button
              className={`btn btn-sm ${view === 'summary' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setView('summary')}
            >
              Summary
            </button>
            <button
              className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
          {view === 'list' && (
            <button className="btn btn-secondary btn-sm" onClick={exportExcel} disabled={rows.length === 0}>⬇ Export Excel</button>
          )}
        </div>
      </div>

      {view === 'summary' ? <TaxFilingsSummary /> : (<>

      {/* Quick views */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        {DEFAULT_VIEWS.map(v => (
          <button key={v.key} className="btn btn-secondary btn-sm" onClick={() => applyView(v)}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
        <div className="form-group" style={{ minWidth: 110 }}>
          <label>Year</label>
          <select className="form-input" value={filter.year || ''} onChange={e => setFilterField('year', e.target.value ? Number(e.target.value) : null)}>
            <option value="">All</option>
            {taxYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 240 }}>
          <label>Filing Type</label>
          <select className="form-input" value={filter.filing_type || ''} onChange={e => setFilterField('filing_type', e.target.value || null)}>
            <option value="">All</option>
            {FILING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 150 }}>
          <label>Status</label>
          <select className="form-input" value={filter.status || ''} onChange={e => setFilterField('status', e.target.value || null)}>
            <option value="">All</option>
            {FILING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ alignSelf: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!filter.overdue_only} onChange={e => setFilterField('overdue_only', e.target.checked || null)} />
            Overdue
          </label>
        </div>
        <div className="form-group" style={{ alignSelf: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!filter.due_this_month} onChange={e => setFilterField('due_this_month', e.target.checked || null)} />
            Due this month
          </label>
        </div>
        {activeFilterChips.length > 0 && (
          <button className="btn btn-link btn-sm" onClick={clearFilters}>Clear all</button>
        )}
      </div>

      {activeFilterChips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {activeFilterChips.map(c => (
            <span key={c.key} style={{
              background: 'var(--pc-gold-tint)', color: 'var(--pc-navy)',
              border: '1px solid var(--pc-navy)',
              padding: '2px 10px', borderRadius: 999, fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {c.label}
              <button
                onClick={() => setFilterField(c.key, null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                title="Remove filter"
              >✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
          padding: '8px 12px', background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: 6, marginBottom: 12,
        }}>
          <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={() => bulkMark('filed')}>Mark Filed</button>
          <button className="btn btn-secondary btn-sm" onClick={() => bulkMark('not_required')}>Mark Not Required</button>
          <button className="btn btn-secondary btn-sm" onClick={() => bulkMark('overdue')}>Mark Overdue</button>
          <button className="btn btn-link btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No tax filings match these filters.</p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} />
                </th>
                <th>Client</th>
                <th style={{ width: 60 }}>Year</th>
                <th>Filing Type</th>
                <th>Status</th>
                <th>Due</th>
                <th>Filed</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                  <td>
                    <Link to={`/clients/${r.client_id}`}>
                      {r.client_code ? <span className="client-code-inline">{r.client_code}</span> : null}
                      {r.client_name || `Client #${r.client_id}`}
                    </Link>
                  </td>
                  <td>{r.tax_year}</td>
                  <td>{filingTypeLabel(r.filing_type)}</td>
                  <td><StatusPill status={r.status} /></td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.due_date || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.filed_date || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.reference_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}
    </div>
  );
}
