import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import PrintToolbar from '../shared/PrintToolbar';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';

type Mode = 'sales' | 'vat' | 'receipts';

// Local calendar date, NOT toISOString(): Cyprus is ahead of UTC, so midnight
// local is still the previous day in UTC, which started every quick range a
// day early and pulled an extra day into the totals.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const firstOfMonth = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};
const today = () => iso(new Date());

const eur = (n: number) => '€' + n.toFixed(2);

// Sales-side reports for monthly journal entry into BTMS. Three views in
// one screen:
//   - Sales: issued+paid invoices in a period (totals + per-row breakdown)
//   - VAT:   output VAT grouped by rate (the figure for the VAT return)
//   - Receipts: payments received in a period
// Each supports CSV download + browser print (chrome hidden on print).
export default function SalesReports() {
  const { clients } = useApp();
  const [mode, setMode]                 = useState<Mode>('sales');
  const [from, setFrom]                 = useState<string>(firstOfMonth());
  const [to, setTo]                     = useState<string>(today());
  const [clientFilter, setClientFilter] = useState<string>('');

  const [sales, setSales]       = useState<any[]>([]);
  const [vatData, setVatData]   = useState<{ lines: any[]; invMap: Map<number, any> }>({ lines: [], invMap: new Map() });
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (mode === 'sales') {
          const invs = await api.getClientInvoices({
            from, to,
            client_id: clientFilter ? Number(clientFilter) : undefined,
          });
          const ip = (invs as any[]).filter(i => i.status === 'issued' || i.status === 'paid');
          if (!cancelled) setSales(ip);
        } else if (mode === 'vat') {
          const invs = await api.getClientInvoices({ from, to });
          const ip   = (invs as any[]).filter(i => i.status === 'issued' || i.status === 'paid');
          const ids  = ip.map(i => i.id as number);
          const lines = await api.getInvoiceLinesByInvoices(ids);
          if (!cancelled) {
            const invMap = new Map<number, any>(ip.map(i => [i.id, i]));
            setVatData({ lines, invMap });
          }
        } else {
          const rcps = await api.getReceipts({
            from, to,
            client_id: clientFilter ? Number(clientFilter) : undefined,
          });
          if (!cancelled) setReceipts(rcps as any[]);
        }
      } catch (err: any) {
        if (!cancelled) alert('Failed to load: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, from, to, clientFilter]);

  // ---------- Totals ----------
  const salesTotals = useMemo(() => sales.reduce((a, s) => ({
    net:   a.net   + Number(s.subtotal_vatable || 0) + Number(s.subtotal_nonvatable || 0) - Number(s.discount_amount || 0),
    vat:   a.vat   + Number(s.vat_amount   || 0),
    gross: a.gross + Number(s.total_amount || 0),
    count: a.count + 1,
  }), { net: 0, vat: 0, gross: 0, count: 0 }), [sales]);

  const vatSummary = useMemo(() => {
    const m = new Map<number, { net: number; vat: number; count: number }>();
    for (const l of vatData.lines) {
      if (!l.vatable) continue;
      const inv = vatData.invMap.get(l.invoice_id); if (!inv) continue;
      const amt   = Number(l.amount || 0);
      const rate  = Number(l.vat_rate || 0);
      const sv    = Number(inv.subtotal_vatable || 0);
      const disc  = Number(inv.discount_amount || 0);
      const share = sv > 0 ? amt / sv : 0;
      const net   = Math.max(0, amt - share * disc);
      const vat   = net * rate / 100;
      const cur   = m.get(rate) || { net: 0, vat: 0, count: 0 };
      cur.net += net; cur.vat += vat; cur.count += 1;
      m.set(rate, cur);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({ rate, ...v }));
  }, [vatData]);

  const vatTotals = useMemo(() => vatSummary.reduce((a, v) => ({
    net: a.net + v.net, vat: a.vat + v.vat, lines: a.lines + v.count,
  }), { net: 0, vat: 0, lines: 0 }), [vatSummary]);

  const receiptsTotals = useMemo(() => receipts.reduce((a, r) => ({
    amount: a.amount + Number(r.amount || 0), count: a.count + 1,
  }), { amount: 0, count: 0 }), [receipts]);

  // ---------- Quick date pickers ----------
  const setQuarter = (offset: number) => {
    const now = new Date();
    let qIdx = Math.floor(now.getMonth() / 3) + offset;
    let year = now.getFullYear();
    while (qIdx < 0) { qIdx += 4; year -= 1; }
    while (qIdx > 3) { qIdx -= 4; year += 1; }
    const startMonth = qIdx * 3;
    setFrom(iso(new Date(year, startMonth, 1)));
    setTo  (iso(new Date(year, startMonth + 3, 0)));
  };
  const setThisMonth = () => { setFrom(firstOfMonth()); setTo(today()); };
  const setYear = (offset: number) => {
    const y = new Date().getFullYear() + offset;
    setFrom(`${y}-01-01`); setTo(`${y}-12-31`);
  };

  // ---------- CSV export ----------
  const downloadCsv = () => {
    let header: string[] = [];
    let rows: string[][] = [];
    let filename = 'report.csv';
    if (mode === 'sales') {
      header = ['Date', 'Invoice', 'Client code', 'Client', 'Net', 'VAT', 'Gross', 'Status'];
      rows = sales.map((s: any) => [
        s.issue_date || '',
        s.invoice_number || '',
        s.client_code || '',
        s.client_name || '',
        (Number(s.subtotal_vatable || 0) + Number(s.subtotal_nonvatable || 0) - Number(s.discount_amount || 0)).toFixed(2),
        Number(s.vat_amount || 0).toFixed(2),
        Number(s.total_amount || 0).toFixed(2),
        s.status,
      ]);
      rows.push(['', '', '', `TOTAL (${salesTotals.count} invoices)`,
        salesTotals.net.toFixed(2), salesTotals.vat.toFixed(2), salesTotals.gross.toFixed(2), '']);
      filename = `sales-${from}-to-${to}.csv`;
    } else if (mode === 'vat') {
      header = ['VAT rate (%)', 'Net amount', 'VAT amount', 'Gross', 'Lines'];
      rows = vatSummary.map(v => [
        v.rate.toFixed(2), v.net.toFixed(2), v.vat.toFixed(2),
        (v.net + v.vat).toFixed(2), String(v.count),
      ]);
      rows.push(['TOTAL', vatTotals.net.toFixed(2), vatTotals.vat.toFixed(2),
        (vatTotals.net + vatTotals.vat).toFixed(2), String(vatTotals.lines)]);
      filename = `vat-${from}-to-${to}.csv`;
    } else {
      header = ['Date', 'Receipt', 'Client code', 'Client', 'Invoice', 'Method', 'Amount'];
      rows = receipts.map((r: any) => [
        r.receipt_date || '',
        r.receipt_number || '',
        r.client?.client_code || '',
        r.client?.name || '',
        r.invoice?.invoice_number || '',
        r.payment_method || '',
        Number(r.amount || 0).toFixed(2),
      ]);
      rows.push(['', '', '', '', '', `TOTAL (${receiptsTotals.count})`, receiptsTotals.amount.toFixed(2)]);
      filename = `receipts-${from}-to-${to}.csv`;
    }
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  return (
    <div className="dashboard">
      <style>{`
        @media print {
          .app-shell .sidebar, .app-shell .mobile-header, .no-print { display: none !important; }
          .app-shell .main-content { margin: 0; padding: 0; }
        }
      `}</style>

      <div className="dashboard-header">
        <h2>Sales Reports</h2>
        <div className="dashboard-actions no-print" style={{ display: 'flex', gap: 8 }}>
          <Link to="/billing" className="btn btn-secondary">← Invoices</Link>
          <button className="btn btn-secondary" onClick={downloadCsv}>⬇ Download CSV</button>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="no-print" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`btn ${mode === 'sales' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('sales')}>Sales</button>
        <button className={`btn ${mode === 'vat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('vat')}>VAT</button>
        <button className={`btn ${mode === 'receipts' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('receipts')}>Receipts</button>
      </div>

      {/* Filters */}
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label>From</label>
            <input type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          {mode !== 'vat' && (
            <div className="form-group">
              <label>Client (optional)</label>
              <SearchableSelect
                value={clientFilter}
                options={toClientOptions(clients)}
                onChange={v => setClientFilter(v ? String(v) : '')}
                placeholder="All clients"
                allowClear
              />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn btn-link btn-sm" onClick={setThisMonth}>This month</button>
          <button className="btn btn-link btn-sm" onClick={() => setQuarter(0)}>This quarter</button>
          <button className="btn btn-link btn-sm" onClick={() => setQuarter(-1)}>Last quarter</button>
          <button className="btn btn-link btn-sm" onClick={() => setYear(0)}>This year</button>
          <button className="btn btn-link btn-sm" onClick={() => setYear(-1)}>Last year</button>
        </div>
      </div>

      <PrintToolbar fileBase={`${mode}-${from}-to-${to}`} targetSelector=".report-export" showClose={false} />

      <div className="report-export">
        <h3 style={{ marginTop: 0 }}>
          {mode === 'sales' ? 'Sales' : mode === 'vat' ? 'Output VAT' : 'Receipts'} — {from || '…'} to {to || '…'}
        </h3>

        {loading ? (
          <div className="loading-screen">Loading…</div>
        ) : mode === 'sales' ? (
          <SalesTable rows={sales} totals={salesTotals} />
        ) : mode === 'vat' ? (
          <VatTable rows={vatSummary} totals={vatTotals} />
        ) : (
          <ReceiptsTable rows={receipts} totals={receiptsTotals} />
        )}
      </div>
    </div>
  );
}

function SalesTable({ rows, totals }: { rows: any[]; totals: { net: number; vat: number; gross: number; count: number } }) {
  return rows.length === 0 ? (
    <div className="empty-state"><p>No invoices in this period.</p></div>
  ) : (
    <div className="export-table-wrapper">
      <table className="export-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Invoice</th>
            <th>Code</th>
            <th>Client</th>
            <th style={{ textAlign: 'right' }}>Net</th>
            <th style={{ textAlign: 'right' }}>VAT</th>
            <th style={{ textAlign: 'right' }}>Gross</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{s.issue_date || '—'}</td>
              <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{s.invoice_number || '—'}</td>
              <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>{s.client_code || '—'}</td>
              <td>{s.client_name || '—'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {eur(Number(s.subtotal_vatable || 0) + Number(s.subtotal_nonvatable || 0) - Number(s.discount_amount || 0))}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{eur(Number(s.vat_amount || 0))}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(Number(s.total_amount || 0))}</td>
              <td style={{ textTransform: 'capitalize', color: s.status === 'paid' ? '#166534' : s.status === 'issued' ? '#1e40af' : '#64748b' }}>{s.status}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
            <td colSpan={4}>TOTAL ({totals.count} invoices)</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.net)}</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.vat)}</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.gross)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function VatTable({ rows, totals }: { rows: any[]; totals: { net: number; vat: number; lines: number } }) {
  return rows.length === 0 ? (
    <div className="empty-state"><p>No vatable sales in this period.</p></div>
  ) : (
    <div className="export-table-wrapper">
      <table className="export-table">
        <thead>
          <tr>
            <th>VAT rate</th>
            <th style={{ textAlign: 'right' }}>Net amount</th>
            <th style={{ textAlign: 'right' }}>VAT amount</th>
            <th style={{ textAlign: 'right' }}>Gross</th>
            <th style={{ textAlign: 'right' }}>Lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(v => (
            <tr key={v.rate}>
              <td style={{ fontWeight: 600 }}>{v.rate}%</td>
              <td style={{ textAlign: 'right' }}>{eur(v.net)}</td>
              <td style={{ textAlign: 'right' }}>{eur(v.vat)}</td>
              <td style={{ textAlign: 'right' }}>{eur(v.net + v.vat)}</td>
              <td style={{ textAlign: 'right' }}>{v.count}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
            <td>TOTAL</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.net)}</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.vat)}</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.net + totals.vat)}</td>
            <td style={{ textAlign: 'right' }}>{totals.lines}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ReceiptsTable({ rows, totals }: { rows: any[]; totals: { amount: number; count: number } }) {
  return rows.length === 0 ? (
    <div className="empty-state"><p>No receipts in this period.</p></div>
  ) : (
    <div className="export-table-wrapper">
      <table className="export-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Receipt</th>
            <th>Code</th>
            <th>Client</th>
            <th>Invoice</th>
            <th>Method</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{r.receipt_date || '—'}</td>
              <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{r.receipt_number}</td>
              <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>{r.client?.client_code || '—'}</td>
              <td>{r.client?.name || '—'}</td>
              <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{r.invoice?.invoice_number || '—'}</td>
              <td>{r.payment_method || '—'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(Number(r.amount || 0))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
            <td colSpan={6}>TOTAL ({totals.count} receipts)</td>
            <td style={{ textAlign: 'right' }}>{eur(totals.amount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
