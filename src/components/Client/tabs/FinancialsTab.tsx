import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../services/api';

type Props = { clientId: number };

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const eur = (n: number) => '€' + n.toFixed(2);

const statusBadge = (s: string) => {
  switch (s) {
    case 'draft':     return { bg: '#f1f5f9', fg: '#475569', label: 'Draft' };
    case 'issued':    return { bg: '#dbeafe', fg: '#1e40af', label: 'Issued' };
    case 'paid':      return { bg: '#dcfce7', fg: '#166534', label: 'Paid' };
    case 'cancelled': return { bg: '#fee2e2', fg: '#991b1b', label: 'Cancelled' };
    default:          return { bg: '#f1f5f9', fg: '#475569', label: s };
  }
};

// Per-client billing overview: total invoiced, total received, balance due,
// plus a table of invoices and a table of receipts. Row clicks deep-link to
// the matching invoice / printable receipt.
export default function FinancialsTab({ clientId }: Props) {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [invs, rcps] = await Promise.all([
          api.getClientInvoices({ client_id: clientId }),
          api.getReceipts({ client_id: clientId }),
        ]);
        if (cancelled) return;
        setInvoices(invs as any[]);
        setReceipts(rcps as any[]);
      } catch (err: any) {
        if (!cancelled) alert('Failed to load financials: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const summary = useMemo(() => {
    // Total invoiced excludes drafts and cancelled — only money actually due.
    const invoiced = invoices
      .filter(i => i.status === 'issued' || i.status === 'paid')
      .reduce((s, i) => s + Number(i.total_amount || 0), 0);
    const received = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
    return { invoiced, received, balance: invoiced - received };
  }, [invoices, receipts]);

  // For each receipt, show the invoice number it settles (rather than the raw id).
  const invNumByInvoiceId = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of invoices) if (i.invoice_number) m.set(i.id, i.invoice_number);
    return m;
  }, [invoices]);

  if (loading) return <div className="loading-screen">Loading financials…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => window.open(`/billing/statement/${clientId}/print`, '_blank')}
        >📄 Print statement</button>
      </div>

      {/* Summary cards */}
      <div className="stats-grid stats-grid-compact">
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{eur(summary.invoiced)}</div>
          <div className="stat-label">Total invoiced</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{eur(summary.received)}</div>
          <div className="stat-label">Total received</div>
        </div>
        <div
          className="stat-card stat-card-sm"
          style={{ borderLeft: summary.balance > 0 ? '3px solid #b91c1c' : (summary.balance < 0 ? '3px solid #166534' : undefined) }}
        >
          <div
            className="stat-number"
            style={{ color: summary.balance > 0 ? '#b91c1c' : (summary.balance < 0 ? '#166534' : undefined) }}
          >{eur(summary.balance)}</div>
          <div className="stat-label">Balance due</div>
        </div>
      </div>

      {/* Invoices */}
      <div>
        <h3 style={{ marginBottom: 8 }}>Invoices</h3>
        {invoices.length === 0 ? (
          <div className="empty-state"><p>No invoices for this client yet.</p></div>
        ) : (
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Issue date</th>
                  <th>Due date</th>
                  <th>Paid date</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(i => {
                  const b = statusBadge(i.status);
                  return (
                    <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/billing/${i.id}`)}>
                      <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        {i.invoice_number || <em style={{ color: '#94a3b8' }}>(draft)</em>}
                      </td>
                      <td>
                        <span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>{b.label}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.issue_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.due_date)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{i.paid_date ? fmtDate(i.paid_date) : '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(Number(i.total_amount || 0))}</td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(`/billing/${i.id}`); }}
                        >Open</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Receipts */}
      <div>
        <h3 style={{ marginBottom: 8 }}>Receipts</h3>
        {receipts.length === 0 ? (
          <div className="empty-state"><p>No receipts for this client yet.</p></div>
        ) : (
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>For invoice</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {receipts.map(r => (
                  <tr
                    key={r.id} style={{ cursor: 'pointer' }}
                    onClick={() => window.open(`/billing/receipt/${r.id}/print`, '_blank')}
                  >
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{r.receipt_number}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.receipt_date)}</td>
                    <td>{r.payment_method || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                      {r.invoice_id ? (invNumByInvoiceId.get(r.invoice_id) || `#${r.invoice_id}`) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(Number(r.amount || 0))}</td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => { e.stopPropagation(); window.open(`/billing/receipt/${r.id}/print`, '_blank'); }}
                      >Print</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
