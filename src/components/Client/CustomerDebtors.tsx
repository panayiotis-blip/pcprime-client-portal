import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const DAY = 86_400_000;
const eur = (n: number) => '€' + n.toFixed(2);

type Row = {
  customer_id: number; name: string;
  current: number; d30: number; d60: number; d90: number; d90p: number; total: number;
};

// Phase D — aged debtors for the client's own customers (outstanding,
// issued-but-unpaid customer invoices bucketed by age).
export default function CustomerDebtors() {
  const { user } = useAuth();
  const owner = user?.client_id;
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!owner) { setLoading(false); return; }
    (async () => {
      try { setInvoices(await api.getCustomerInvoices(owner, { status: 'issued' })); }
      catch (err: any) { alert('Failed to load: ' + err.message); }
      finally { setLoading(false); }
    })();
  }, [owner]);

  const { rows, totals } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m = new Map<number, Row>();
    for (const inv of invoices) {
      const ref = inv.due_date || inv.issue_date;
      const amt = Number(inv.total_amount || 0);
      let r = m.get(inv.customer_id);
      if (!r) { r = { customer_id: inv.customer_id, name: inv.customer_name || '—', current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 }; m.set(inv.customer_id, r); }
      const days = ref ? Math.floor((today.getTime() - new Date(ref + 'T00:00:00').getTime()) / DAY) : 0;
      if (days <= 0) r.current += amt;
      else if (days <= 30) r.d30 += amt;
      else if (days <= 60) r.d60 += amt;
      else if (days <= 90) r.d90 += amt;
      else r.d90p += amt;
      r.total += amt;
    }
    const rows = [...m.values()].sort((a, b) => b.total - a.total);
    const totals = rows.reduce((t, r) => ({
      current: t.current + r.current, d30: t.d30 + r.d30, d60: t.d60 + r.d60,
      d90: t.d90 + r.d90, d90p: t.d90p + r.d90p, total: t.total + r.total,
    }), { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });
    return { rows, totals };
  }, [invoices]);

  const cell = (n: number, danger = false) => (
    <td style={{ textAlign: 'right', color: danger && n ? '#b91c1c' : undefined }}>{n ? eur(n) : '—'}</td>
  );

  if (!owner) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <style>{`@media print { .app-shell .sidebar, .app-shell .mobile-header, .no-print { display: none !important; } .app-shell .main-content { margin: 0; padding: 0; } }`}</style>
      <div className="dashboard-header">
        <h2>Debtors</h2>
        <div className="dashboard-actions no-print" style={{ display: 'flex', gap: 8 }}>
          <Link to="/sales" className="btn btn-secondary">← Sales Invoices</Link>
          <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No outstanding customer invoices. 🎉</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th style={{ textAlign: 'right' }}>Not yet due</th>
                <th style={{ textAlign: 'right' }}>1–30 days</th>
                <th style={{ textAlign: 'right' }}>31–60 days</th>
                <th style={{ textAlign: 'right' }}>61–90 days</th>
                <th style={{ textAlign: 'right' }}>90+ days</th>
                <th style={{ textAlign: 'right' }}>Total owed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.customer_id}>
                  <td>{r.name}</td>
                  {cell(r.current)}{cell(r.d30)}{cell(r.d60)}{cell(r.d90, true)}{cell(r.d90p, true)}
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{eur(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                <td>Total</td>
                <td style={{ textAlign: 'right' }}>{eur(totals.current)}</td>
                <td style={{ textAlign: 'right' }}>{eur(totals.d30)}</td>
                <td style={{ textAlign: 'right' }}>{eur(totals.d60)}</td>
                <td style={{ textAlign: 'right' }}>{eur(totals.d90)}</td>
                <td style={{ textAlign: 'right' }}>{eur(totals.d90p)}</td>
                <td style={{ textAlign: 'right' }}>{eur(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
