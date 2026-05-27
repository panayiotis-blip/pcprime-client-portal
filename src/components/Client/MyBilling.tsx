import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { buildStatement } from '../Billing/statement';
import { formatDate } from '../../services/dates';

const fmtDate = (iso: string | null | undefined) => formatDate(iso, '—');
const eur = (n: number) => '€' + n.toFixed(2);

const statusBadge = (s: string) => s === 'paid'
  ? { bg: '#dcfce7', fg: '#166534', label: 'Paid' }
  : { bg: '#dbeafe', fg: '#1e40af', label: 'Issued' };

// Client-facing read-only billing view: their issued/paid invoices, receipts,
// and statement balance. RLS (migration 074) scopes everything to the client.
export default function MyBilling() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getClientStatement(clientId);
        if (!cancelled) setData(d);
      } catch (err: any) {
        if (!cancelled) alert('Failed to load your account: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const statement = useMemo(() => (data ? buildStatement(data.invoices, data.receipts) : null), [data]);

  if (!clientId) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;
  if (loading) return <div className="loading-screen">Loading…</div>;

  const invoices = (data?.invoices || []) as any[];
  const receipts = (data?.receipts || []) as any[];
  const balance  = statement ? statement.closing : 0;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>My Account</h2>
        <div className="dashboard-actions">
          <button
            className="btn btn-secondary"
            onClick={() => window.open(`/billing/statement/${clientId}/print`, '_blank')}
          >📄 Print statement</button>
        </div>
      </div>

      {/* Summary */}
      <div className="stats-grid stats-grid-compact" style={{ marginBottom: 12 }}>
        <div className="stat-card stat-card-sm" style={{ borderLeft: balance > 0 ? '3px solid #b91c1c' : (balance < 0 ? '3px solid #166534' : undefined) }}>
          <div className="stat-number" style={{ color: balance > 0 ? '#b91c1c' : (balance < 0 ? '#166534' : undefined) }}>{eur(balance)}</div>
          <div className="stat-label">Balance due</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{invoices.filter(i => i.status === 'issued').length}</div>
          <div className="stat-label">Outstanding invoices</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{receipts.length}</div>
          <div className="stat-label">Payments received</div>
        </div>
      </div>

      {/* Invoices */}
      <h3 style={{ marginBottom: 8 }}>Invoices</h3>
      {invoices.length === 0 ? (
        <div className="empty-state"><p>No invoices yet.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Issue date</th>
                <th>Due date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => {
                const b = statusBadge(i.status);
                return (
                  <tr key={i.id}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{i.invoice_number || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.issue_date)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.due_date)}</td>
                    <td><span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{b.label}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(Number(i.total_amount || 0))}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => window.open(`/billing/${i.id}/print`, '_blank')}>View / PDF</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Receipts */}
      <h3 style={{ margin: '16px 0 8px' }}>Receipts</h3>
      {receipts.length === 0 ? (
        <div className="empty-state"><p>No receipts yet.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Method</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{r.receipt_number}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.receipt_date)}</td>
                  <td>{r.payment_method || '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(Number(r.amount || 0))}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => window.open(`/billing/receipt/${r.id}/print`, '_blank')}>View / PDF</button>
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
