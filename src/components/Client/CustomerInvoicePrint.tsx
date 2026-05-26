import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import PrintToolbar from '../shared/PrintToolbar';

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Printable customer invoice on the client's OWN letterhead (their My Company
// profile). Preview-first via the shared PrintToolbar.
export default function CustomerInvoicePrint() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inv = await api.getCustomerInvoice(Number(id));
        const prof = await api.getCompanyProfile(inv.owner_client_id).catch(() => null);
        if (cancelled) return;
        setInvoice(inv);
        setProfile(prof);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!invoice) return <div className="empty-state"><p>Invoice not found.</p></div>;

  const co   = profile || {};
  const cust = invoice.customer || {};
  const eur  = (n: number) => '€' + Number(n || 0).toFixed(2);

  const vatBreakdown = (() => {
    const sv = Number(invoice.subtotal_vatable || 0);
    const disc = Number(invoice.discount_amount || 0);
    const map = new Map<number, { net: number; vat: number }>();
    for (const l of (invoice.lines || [])) {
      if (!l.vatable || l.line_type === 'remarks') continue;
      const amt = Number(l.amount || 0);
      const rate = Number(l.vat_rate || 0);
      const share = sv > 0 ? amt / sv : 0;
      const net = Math.max(0, amt - share * disc);
      const cur = map.get(rate) || { net: 0, vat: 0 };
      cur.net += net; cur.vat += net * rate / 100;
      map.set(rate, cur);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  })();

  const billTo = [cust.address, cust.vat_number ? `VAT: ${cust.vat_number}` : null].filter(Boolean).join('\n');

  return (
    <div className="print-page" style={{} as CSSProperties}>
      <style>{`
        @media print { body { background: white; } .app-shell .sidebar, .app-shell .mobile-header, .pt-toolbar { display: none !important; } .app-shell .main-content { margin: 0; padding: 0; } .print-page { padding: 0 !important; } }
        .print-page { padding: 24px; max-width: 900px; margin: 0 auto; background: white; color: #0f172a; display: flex; flex-direction: column; min-height: 297mm; }
        .inv-body { flex: 1; display: flex; flex-direction: column; }
        .inv-header { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid #1a2e4a; }
        .inv-header img { max-width: 140px; max-height: 80px; }
        .inv-firm-name { font-weight: 700; font-size: 18px; color: #1a2e4a; }
        .inv-firm-meta { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.5; white-space: pre-line; }
        .inv-title { font-size: 28px; font-weight: 700; color: #1a2e4a; margin: 16px 0 4px; }
        .inv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; font-size: 13px; }
        .inv-meta .panel { background: #f8fafc; padding: 10px 12px; border-radius: 6px; }
        .inv-meta .panel h4 { margin: 0 0 6px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .inv-meta .panel .body { font-size: 13px; white-space: pre-wrap; line-height: 1.5; }
        table.inv-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        table.inv-table th, table.inv-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
        table.inv-table thead th { background: #f1f5f9; font-weight: 600; color: #1a2e4a; }
        table.inv-table td.num, table.inv-table th.num { text-align: right; white-space: nowrap; }
        .inv-totals { margin-top: 16px; margin-left: auto; width: 320px; font-size: 13px; }
        .inv-totals tr td { padding: 4px 8px; }
        .inv-totals tr.total td { border-top: 2px solid #1a2e4a; padding-top: 8px; font-weight: 700; font-size: 16px; }
        .inv-footer { margin-top: auto; padding-top: 16px; font-size: 11px; color: #475569; }
      `}</style>

      <PrintToolbar fileBase={`Invoice-${invoice.invoice_number || invoice.id}`} />

      <div className="inv-body">
        <header className="inv-header">
          {co.logo_url && <img src={co.logo_url} alt={co.business_name || 'Logo'} />}
          <div style={{ flex: 1 }}>
            <div className="inv-firm-name">{co.business_name || '—'}</div>
            <div className="inv-firm-meta">
              {co.address ? co.address + '\n' : ''}
              {co.phone ? `Tel: ${co.phone}  ` : ''}{co.email ? co.email : ''}
              {(co.vat_number || co.registration_number) ? '\n' : ''}
              {co.registration_number ? `Reg: ${co.registration_number}  ` : ''}{co.vat_number ? `VAT: ${co.vat_number}` : ''}
            </div>
          </div>
        </header>

        <h1 className="inv-title">Invoice {invoice.invoice_number || '(draft)'}</h1>

        <div className="inv-meta">
          <div className="panel">
            <h4>Bill to</h4>
            <div className="body"><strong>{cust.name || '—'}</strong>{billTo ? '\n' + billTo : ''}</div>
          </div>
          <div className="panel">
            <h4>Invoice details</h4>
            <div style={{ fontSize: 13 }}>
              <div><strong>Number:</strong> {invoice.invoice_number || <em>(draft)</em>}</div>
              <div><strong>Issue date:</strong> {fmtDate(invoice.issue_date)}</div>
              <div><strong>Due date:</strong> {fmtDate(invoice.due_date)}</div>
              {invoice.status === 'paid' && <div><strong>Paid on:</strong> {fmtDate(invoice.paid_date)}</div>}
            </div>
          </div>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num" style={{ width: 80 }}>Qty</th>
              <th className="num" style={{ width: 100 }}>Unit price</th>
              <th style={{ width: 50, textAlign: 'center' }}>VAT</th>
              <th className="num" style={{ width: 120 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.lines || []).map((l: any) => l.line_type === 'remarks' ? (
              <tr key={l.id}><td colSpan={5} style={{ fontStyle: 'italic', color: '#475569' }}>{l.description}</td></tr>
            ) : (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{Number(l.quantity).toFixed(2)}</td>
                <td className="num">€{Number(l.unit_price).toFixed(2)}</td>
                <td style={{ textAlign: 'center' }}>{l.vatable ? `${Number(l.vat_rate || 0).toFixed(0)}%` : '—'}</td>
                <td className="num">€{Number(l.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="inv-totals">
          <tbody>
            <tr><td style={{ color: '#475569' }}>Vatable subtotal</td><td className="num">{eur(invoice.subtotal_vatable)}</td></tr>
            {Number(invoice.subtotal_nonvatable || 0) > 0 && (
              <tr><td style={{ color: '#475569' }}>Expenses (no VAT)</td><td className="num">{eur(invoice.subtotal_nonvatable)}</td></tr>
            )}
            {Number(invoice.discount_amount || 0) > 0 && (
              <tr><td style={{ color: '#475569' }}>Discount</td><td className="num" style={{ color: '#b91c1c' }}>-{eur(invoice.discount_amount)}</td></tr>
            )}
            {vatBreakdown.length === 0 ? (
              <tr><td style={{ color: '#475569' }}>VAT</td><td className="num">€0.00</td></tr>
            ) : vatBreakdown.map(([rate, v]) => (
              <tr key={rate}><td style={{ color: '#475569' }}>VAT @ {rate}% on {eur(v.net)}</td><td className="num">{eur(v.vat)}</td></tr>
            ))}
            <tr className="total"><td>Total</td><td className="num">{eur(invoice.total_amount)}</td></tr>
          </tbody>
        </table>

        <div className="inv-footer">
          {invoice.notes && <div style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{invoice.notes}</div>}
          {co.footer && <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 6 }}>{co.footer}</div>}
        </div>
      </div>
    </div>
  );
}
