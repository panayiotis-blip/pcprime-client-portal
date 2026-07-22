import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { FILING_TYPES } from '../shared/TaxFilingMeta';
import { PanelSkeleton } from '../ui';

// Cross-client summary of one filing type: a row per client, a column per tax
// year, coloured so an outstanding year is obvious without opening anything.
// The detailed per-filing list (with bulk actions) is the sibling "List" view.

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
  reference_number: string | null;
};

const YEARS_SHOWN = 6;

type CellState = 'filed' | 'overdue' | 'pending' | 'none';

const CELL_LABEL: Record<CellState, string> = {
  filed:   'Filed',
  overdue: 'Outstanding',
  pending: 'Pending',
  none:    'Not required / no record',
};

// A missing row is deliberately NOT red: a client taken on in 2024 would
// otherwise show a wall of red for years the firm never handled them.
function cellState(f: Filing | undefined, todayIso: string): CellState {
  if (!f) return 'none';
  if (f.status === 'not_required') return 'none';
  if (f.status === 'filed' || f.status === 'submitted' || f.status === 'paid') return 'filed';
  if (f.status === 'overdue') return 'overdue';
  // pending / in_progress turn red once the due date has passed, so a filing
  // nobody re-statused still shows up as outstanding.
  if (f.due_date && f.due_date < todayIso) return 'overdue';
  return 'pending';
}

type Row = {
  clientId: number;
  clientName: string;
  clientCode: string | null;
  byYear: Record<number, Filing | undefined>;
  lastYearFiled: number | null;
  lastFiledDate: string | null;
  lastReference: string | null;
  nextDue: string | null;
  outstanding: number;
};

export default function TaxFilingsSummary() {
  const [filingType, setFilingType] = useState<string>('company_tax_return');
  const [rows, setRows] = useState<Filing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  const years = useMemo(() => {
    const end = new Date().getFullYear();
    return Array.from({ length: YEARS_SHOWN }, (_, i) => end - (YEARS_SHOWN - 1 - i));
  }, []);
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.getAllTaxFilings({ filing_type: filingType });
        if (!cancelled) setRows(data as Filing[]);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filingType]);

  const summary: Row[] = useMemo(() => {
    const byClient = new Map<number, Row>();
    for (const f of rows) {
      let row = byClient.get(f.client_id);
      if (!row) {
        row = {
          clientId: f.client_id,
          clientName: f.client_name || `Client #${f.client_id}`,
          clientCode: f.client_code,
          byYear: {},
          lastYearFiled: null,
          lastFiledDate: null,
          lastReference: null,
          nextDue: null,
          outstanding: 0,
        };
        byClient.set(f.client_id, row);
      }
      // Only the years on screen occupy cells, but every filing still feeds the
      // "last filed" columns — the last return filed may predate the window.
      if (years.includes(f.tax_year)) row.byYear[f.tax_year] = f;

      const state = cellState(f, todayIso);
      if (state === 'filed') {
        if (row.lastYearFiled === null || f.tax_year > row.lastYearFiled) {
          row.lastYearFiled = f.tax_year;
          row.lastReference = f.reference_number || null;
        }
        if (f.filed_date && (!row.lastFiledDate || f.filed_date > row.lastFiledDate)) {
          row.lastFiledDate = f.filed_date;
        }
      } else if (state === 'overdue' || state === 'pending') {
        // Surface the most pressing due date, not the newest filing's.
        if (f.due_date && (!row.nextDue || f.due_date < row.nextDue)) row.nextDue = f.due_date;
      }
    }
    // Outstanding count is over the visible window so it matches the cells.
    for (const row of byClient.values()) {
      row.outstanding = years.reduce((n, y) => {
        const s = cellState(row.byYear[y], todayIso);
        return n + (s === 'overdue' ? 1 : 0);
      }, 0);
    }
    return Array.from(byClient.values())
      .sort((a, b) => b.outstanding - a.outstanding || a.clientName.localeCompare(b.clientName));
  }, [rows, years, todayIso]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    return summary.filter(r => {
      if (outstandingOnly && r.outstanding === 0) return false;
      if (!t) return true;
      return r.clientName.toLowerCase().includes(t) || (r.clientCode || '').toLowerCase().includes(t);
    });
  }, [summary, search, outstandingOnly]);

  return (
    <div className="tf-summary">
      <div className="tf-summary-controls">
        <label>
          <span className="tf-control-label">Filing type</span>
          <select className="form-input form-input-sm" value={filingType} onChange={e => setFilingType(e.target.value)}>
            {FILING_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label>
          <span className="tf-control-label">Search</span>
          <input
            type="text" className="form-input form-input-sm"
            placeholder="Client name or code"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <label className="tf-check">
          <input type="checkbox" checked={outstandingOnly} onChange={e => setOutstandingOnly(e.target.checked)} />
          Outstanding only
        </label>
        <div className="tf-legend">
          {(['filed', 'pending', 'overdue', 'none'] as CellState[]).map(s => (
            <span key={s} className="tf-legend-item">
              <span className={`tf-cell tf-cell--${s}`} aria-hidden="true" />
              {CELL_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <PanelSkeleton rows={8} />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>No clients have a {FILING_TYPES.find(t => t.value === filingType)?.label} on record.</p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table tf-summary-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>Client</th>
                {years.map(y => <th key={y} className="tf-year-head">{y}</th>)}
                <th>Last filed</th>
                <th>Filed on</th>
                <th>Next due</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.clientId}>
                  <td className="tf-client-cell">
                    <Link to={`/clients/${r.clientId}`} title="Open the client record for the full picture">
                      {r.clientCode ? <span className="client-code-inline">{r.clientCode}</span> : null}
                      {r.clientName}
                    </Link>
                  </td>
                  {years.map(y => {
                    const f = r.byYear[y];
                    const s = cellState(f, todayIso);
                    const bits = [
                      `${y} — ${CELL_LABEL[s]}`,
                      f?.due_date ? `Due ${f.due_date}` : null,
                      f?.filed_date ? `Filed ${f.filed_date}` : null,
                      f?.reference_number ? `Ref ${f.reference_number}` : null,
                    ].filter(Boolean);
                    return (
                      <td key={y} className="tf-year-cell">
                        <Link to={`/clients/${r.clientId}`} title={bits.join('\n')} aria-label={bits.join(', ')}>
                          <span className={`tf-cell tf-cell--${s}`} />
                        </Link>
                      </td>
                    );
                  })}
                  <td>{r.lastYearFiled ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.lastFiledDate || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.nextDue || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.lastReference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
