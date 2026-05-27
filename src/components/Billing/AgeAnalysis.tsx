import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import PrintToolbar from '../shared/PrintToolbar';
import { formatDate } from '../../services/dates';

const DAY = 86_400_000;

type Row = {
  client_id: number;
  client_name: string;
  client_code: string | null;
  current: number; d30: number; d60: number; d90: number; d90p: number;
  total: number;
};

// Aged-debtors report: every issued (unpaid) invoice, grouped per client and
// bucketed by how long it has been overdue.
export default function AgeAnalysis() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setInvoices(await api.getClientInvoices({ status: 'issued' }));
      } catch (err: any) {
        alert('Failed to load: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const { rows, totals } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const byClient = new Map<number, Row>();

    for (const inv of invoices) {
      const ref = inv.due_date || inv.issue_date;
      const amt = Number(inv.total_amount || 0);
      let r = byClient.get(inv.client_id);
      if (!r) {
        r = {
          client_id: inv.client_id,
          client_name: inv.client_name || '—',
          client_code: inv.client_code || null,
          current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0,
        };
        byClient.set(inv.client_id, r);
      }
      const days = ref
        ? Math.floor((today.getTime() - new Date(ref + 'T00:00:00').getTime()) / DAY)
        : 0;
      if      (days <= 0)  r.current += amt;
      else if (days <= 30) r.d30  += amt;
      else if (days <= 60) r.d60  += amt;
      else if (days <= 90) r.d90  += amt;
      else                 r.d90p += amt;
      r.total += amt;
    }

    const rows = [...byClient.values()].sort((a, b) => b.total - a.total);
    const totals = rows.reduce((t, r) => ({
      current: t.current + r.current, d30: t.d30 + r.d30, d60: t.d60 + r.d60,
      d90: t.d90 + r.d90, d90p: t.d90p + r.d90p, total: t.total + r.total,
    }), { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });

    return { rows, totals };
  }, [invoices]);

  const eur = (n: number) => '€' + n.toFixed(2);
  const cell = (n: number, danger = false) => (
    <td style={{ textAlign: 'right', color: danger && n ? '#b91c1c' : undefined }}>
      {n ? eur(n) : '—'}
    </td>
  );

  return (
    <div className="dashboard">
      <style>{`
        @media print {
          .app-shell .sidebar, .app-shell .mobile-header, .no-print { display: none !important; }
          .app-shell .main-content { margin: 0; padding: 0; }
        }
      `}</style>

      <div className="dashboard-header">
        <h2>Age Analysis — Outstanding Invoices</h2>
        <div className="dashboard-actions no-print" style={{ display: 'flex', gap: 8 }}>
          <Link to="/billing" className="btn btn-secondary">← Invoices</Link>
        </div>
      </div>

      <PrintToolbar fileBase={`age-analysis-${new Date().toISOString().slice(0, 10)}`} targetSelector=".report-export" showClose={false} />

      <div className="report-export">
        <h3 style={{ marginTop: 0 }}>Outstanding invoices — as at {formatDate(new Date())}</h3>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No outstanding (issued, unpaid) invoices. 🎉</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Client</th>
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
                <tr key={r.client_id}>
                  <td>{r.client_code ? r.client_code + ' — ' : ''}{r.client_name}</td>
                  {cell(r.current)}
                  {cell(r.d30)}
                  {cell(r.d60)}
                  {cell(r.d90, true)}
                  {cell(r.d90p, true)}
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
    </div>
  );
}
