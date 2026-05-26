import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const eur = (n: number) => '€' + n.toFixed(2);

// Client business reports — Profit & Loss and VAT — over a chosen period.
// Built from the client's own sales invoices (issued/paid) and expenses.
// More reports to be added over time.
export default function MyReports() {
  const { user } = useAuth();
  const owner = user?.client_id;
  const [mode, setMode] = useState<'pnl' | 'vat'>('pnl');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo]     = useState(today());
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [published, setPublished] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!owner) { setLoading(false); return; }
    (async () => {
      try {
        const [inv, exp, pub] = await Promise.all([
          api.getCustomerInvoices(owner), api.getMyExpenses(owner), api.getAdvisorReports(owner),
        ]);
        setInvoices(inv as any[]); setExpenses(exp as any[]); setPublished(pub as any[]);
      } catch (err: any) { alert('Failed to load: ' + err.message); }
      finally { setLoading(false); }
    })();
  }, [owner]);

  const openReport = async (r: any) => {
    try { window.open(await api.advisorReportFileUrl(r.storage_path), '_blank'); }
    catch (err: any) { alert(err.message); }
  };

  const r = useMemo(() => {
    const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;
    const sales = invoices.filter(i => (i.status === 'issued' || i.status === 'paid') && inRange(i.issue_date));
    const expDate = (e: any) => e.expense_date || (e.created_at || '').slice(0, 10);
    const exps = expenses.filter(e => e.status !== 'rejected' && inRange(expDate(e)));

    const incomeNet  = sales.reduce((s, i) => s + (Number(i.total_amount || 0) - Number(i.vat_amount || 0)), 0);
    const outputVat  = sales.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
    const inputVat   = exps.reduce((s, e) => s + Number(e.vat_amount || 0), 0);
    const expensesNet = exps.reduce((s, e) => s + (Number(e.amount || 0) - Number(e.vat_amount || 0)), 0);

    const byType = new Map<string, number>();
    for (const e of exps) {
      const t = e.expense_type || 'Other';
      byType.set(t, (byType.get(t) || 0) + (Number(e.amount || 0) - Number(e.vat_amount || 0)));
    }
    const expRows = exps.map(e => ({
      date: e.expense_date || (e.created_at || '').slice(0, 10),
      vendor: e.vendor_name || '—',
      type: e.expense_type || 'Other',
      net: Number(e.amount || 0) - Number(e.vat_amount || 0),
      vat: Number(e.vat_amount || 0),
      total: Number(e.amount || 0),
      status: e.status,
    })).sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      incomeNet, expensesNet, profit: incomeNet - expensesNet,
      byType: [...byType.entries()].sort((a, b) => b[1] - a[1]),
      outputVat, inputVat, netVat: outputVat - inputVat,
      salesCount: sales.length, expCount: exps.length, expRows,
    };
  }, [invoices, expenses, from, to]);

  const setThisMonth = () => { setFrom(firstOfMonth()); setTo(today()); };
  const setYear = (offset: number) => { const y = new Date().getFullYear() + offset; setFrom(`${y}-01-01`); setTo(`${y}-12-31`); };
  const setQuarter = (offset: number) => {
    const now = new Date(); let q = Math.floor(now.getMonth() / 3) + offset; let year = now.getFullYear();
    while (q < 0) { q += 4; year -= 1; } while (q > 3) { q -= 4; year += 1; }
    setFrom(new Date(year, q * 3, 1).toISOString().slice(0, 10));
    setTo(new Date(year, q * 3 + 3, 0).toISOString().slice(0, 10));
  };

  if (!owner) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <style>{`@media print { .app-shell .sidebar, .app-shell .mobile-header, .no-print { display: none !important; } .app-shell .main-content { margin: 0; padding: 0; } }`}</style>
      <div className="dashboard-header">
        <h2>Reports</h2>
        <div className="dashboard-actions no-print" style={{ display: 'flex', gap: 8 }}>
          <Link to="/sales" className="btn btn-secondary">← Sales</Link>
          <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      {published.length > 0 && (
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Reports from your accountant</h3>
          <table className="export-table">
            <thead>
              <tr><th>Date</th><th>Title</th><th>Type</th><th>Period</th><th></th></tr>
            </thead>
            <tbody>
              {published.map(r => (
                <tr key={r.id}>
                  <td>{(r.created_at || '').slice(0, 10)}</td>
                  <td>{r.title}{r.notes ? <div style={{ fontSize: 12, color: '#94a3b8' }}>{r.notes}</div> : null}</td>
                  <td>{r.report_type || '—'}</td>
                  <td>{r.period_label || '—'}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn btn-link btn-sm" onClick={() => openReport(r)}>View / download</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="no-print" style={{ marginBottom: 8 }}>Live figures from your data</h3>
      <div className="no-print" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`btn ${mode === 'pnl' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('pnl')}>Profit &amp; Loss</button>
        <button className={`btn ${mode === 'vat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('vat')}>VAT</button>
      </div>

      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group"><label>From</label><input type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="form-group"><label>To</label><input type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn btn-link btn-sm" onClick={setThisMonth}>This month</button>
          <button className="btn btn-link btn-sm" onClick={() => setQuarter(0)}>This quarter</button>
          <button className="btn btn-link btn-sm" onClick={() => setQuarter(-1)}>Last quarter</button>
          <button className="btn btn-link btn-sm" onClick={() => setYear(0)}>This year</button>
          <button className="btn btn-link btn-sm" onClick={() => setYear(-1)}>Last year</button>
        </div>
      </div>

      <h3 style={{ marginTop: 0 }}>{mode === 'pnl' ? 'Profit & Loss' : 'VAT'} — {from} to {to}</h3>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : mode === 'pnl' ? (
        <div className="export-table-wrapper">
          <table className="export-table">
            <tbody>
              <tr><td style={{ fontWeight: 600 }}>Income (sales, ex-VAT)</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{eur(r.incomeNet)}</td></tr>
              <tr><td colSpan={2} style={{ paddingTop: 12, color: '#64748b' }}>Expenses (ex-VAT)</td></tr>
              {r.byType.length === 0 ? (
                <tr><td style={{ paddingLeft: 20, color: '#94a3b8' }}>No expenses in period</td><td></td></tr>
              ) : r.byType.map(([t, v]) => (
                <tr key={t}><td style={{ paddingLeft: 20 }}>{t}</td><td style={{ textAlign: 'right' }}>{eur(v)}</td></tr>
              ))}
              <tr><td style={{ fontWeight: 600 }}>Total expenses</td><td style={{ textAlign: 'right', fontWeight: 600, color: '#b91c1c' }}>-{eur(r.expensesNet)}</td></tr>
              <tr style={{ borderTop: '2px solid #cbd5e1' }}>
                <td style={{ fontWeight: 700, fontSize: 16, paddingTop: 8 }}>{r.profit >= 0 ? 'Net profit' : 'Net loss'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, paddingTop: 8, color: r.profit >= 0 ? '#166534' : '#b91c1c' }}>{eur(r.profit)}</td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ marginTop: 20, marginBottom: 6 }}>Expense detail</h4>
          {r.expRows.length === 0 ? (
            <p style={{ color: '#94a3b8' }}>No expenses uploaded in this period.</p>
          ) : (
            <table className="export-table">
              <thead>
                <tr>
                  <th>Date</th><th>Vendor</th><th>Type</th><th>Status</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th style={{ textAlign: 'right' }}>VAT</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {r.expRows.map((e, i) => (
                  <tr key={i}>
                    <td>{e.date}</td>
                    <td>{e.vendor}</td>
                    <td>{e.type}</td>
                    <td style={{ textTransform: 'capitalize' }}>{e.status}</td>
                    <td style={{ textAlign: 'right' }}>{eur(e.net)}</td>
                    <td style={{ textAlign: 'right' }}>{eur(e.vat)}</td>
                    <td style={{ textAlign: 'right' }}>{eur(e.total)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #cbd5e1', fontWeight: 600 }}>
                  <td colSpan={4}>Totals</td>
                  <td style={{ textAlign: 'right' }}>{eur(r.expensesNet)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(r.inputVat)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(r.expensesNet + r.inputVat)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <tbody>
              <tr><td>Output VAT (on sales)</td><td style={{ textAlign: 'right' }}>{eur(r.outputVat)}</td></tr>
              <tr><td>Input VAT (on expenses)</td><td style={{ textAlign: 'right' }}>-{eur(r.inputVat)}</td></tr>
              <tr style={{ borderTop: '2px solid #cbd5e1' }}>
                <td style={{ fontWeight: 700, paddingTop: 8 }}>{r.netVat >= 0 ? 'VAT payable' : 'VAT reclaimable'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, paddingTop: 8 }}>{eur(Math.abs(r.netVat))}</td>
              </tr>
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            Based on {r.salesCount} sales invoice(s) and {r.expCount} expense(s) in the period. This is an indicative figure — your accountant prepares the official VAT return.
          </p>
        </div>
      )}
    </div>
  );
}
