import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../services/dates';

const fmtDate = (iso: string | null | undefined) => formatDate(iso, '—');

const FILING_LABELS: Record<string, string> = {
  individual_tax_return:                'Personal income tax return',
  individual_tax_return_self_employed:  'Personal income tax return (self-employed)',
  individual_tax_return_pensioner:      'Personal income tax return (pensioner)',
  company_tax_return:                   'Company income tax return',
  vat_return:                           'VAT return',
  social_insurance_return:              'Social insurance return',
  ergani_filing:                        'Ergani filing',
  other:                                'Other',
};

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  not_required: { bg: '#f1f5f9', fg: '#475569', label: 'Not required' },
  pending:      { bg: '#dbeafe', fg: '#1e40af', label: 'Pending' },
  in_progress:  { bg: '#fef9c3', fg: '#854d0e', label: 'In progress' },
  filed:        { bg: '#dcfce7', fg: '#166534', label: 'Filed' },
  submitted:    { bg: '#dcfce7', fg: '#166534', label: 'Submitted' },
  paid:         { bg: '#dcfce7', fg: '#166534', label: 'Paid' },
  overdue:      { bg: '#fee2e2', fg: '#991b1b', label: 'Overdue' },
};

const OPEN_STATUSES = ['pending', 'in_progress', 'overdue'];

const label = (t: string) => FILING_LABELS[t] || t;
const badge = (s: string) => STATUS[s] || { bg: '#f1f5f9', fg: '#475569', label: s };

// Client-facing read-only view of their own tax-filing deadlines.
export default function MyDeadlines() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getClientTaxFilings(clientId);
        if (!cancelled) setRows(d as any[]);
      } catch (err: any) {
        if (!cancelled) alert('Failed to load deadlines: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const today = new Date().toISOString().slice(0, 10);

  const { open, done } = useMemo(() => {
    const open = rows
      .filter(r => OPEN_STATUSES.includes(r.status))
      .sort((a, b) => (a.due_date || '9999-99-99') < (b.due_date || '9999-99-99') ? -1 : 1);
    const done = rows.filter(r => !OPEN_STATUSES.includes(r.status));
    return { open, done };
  }, [rows]);

  const overdueCount = open.filter(r => r.status === 'overdue' || (r.due_date && r.due_date < today)).length;

  if (!clientId) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;
  if (loading) return <div className="loading-screen">Loading…</div>;

  const row = (r: any, highlightOverdue: boolean) => {
    const b = badge(r.status);
    const od = highlightOverdue && (r.status === 'overdue' || (r.due_date && r.due_date < today));
    return (
      <tr key={r.id}>
        <td>{label(r.filing_type)}</td>
        <td>{r.tax_year}</td>
        <td style={{ whiteSpace: 'nowrap', color: od ? '#b91c1c' : undefined, fontWeight: od ? 600 : undefined }}>
          {fmtDate(r.due_date)}
        </td>
        <td><span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{b.label}</span></td>
      </tr>
    );
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>Deadlines</h2></div>

      {overdueCount > 0 && (
        <div className="card" style={{ marginBottom: 12, background: '#fee2e2', color: '#991b1b' }}>
          ⚠️ You have <strong>{overdueCount}</strong> overdue filing{overdueCount === 1 ? '' : 's'}. Please contact us if you need help.
        </div>
      )}

      <h3 style={{ marginBottom: 8 }}>Upcoming &amp; open</h3>
      {open.length === 0 ? (
        <div className="empty-state"><p>Nothing outstanding right now. 🎉</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr><th>Filing</th><th>Tax year</th><th>Due date</th><th>Status</th></tr>
            </thead>
            <tbody>{open.map(r => row(r, true))}</tbody>
          </table>
        </div>
      )}

      {done.length > 0 && (
        <>
          <h3 style={{ margin: '16px 0 8px' }}>Completed</h3>
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead>
                <tr><th>Filing</th><th>Tax year</th><th>Due date</th><th>Status</th></tr>
              </thead>
              <tbody>{done.map(r => row(r, false))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
