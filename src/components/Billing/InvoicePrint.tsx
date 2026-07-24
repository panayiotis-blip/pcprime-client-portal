import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import PrintLetterhead from '../shared/PrintLetterhead';
import PrintToolbar from '../shared/PrintToolbar';
import { formatDate } from '../../services/dates';

const fmtDate = (iso: string | null | undefined) => formatDate(iso, '—');

// Printable invoice. Browser print dialog auto-fires once the data is loaded.
// All styles are scoped here so the AppShell sidebar is hidden in print mode.
export default function InvoicePrint() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const capturing = sp.get('capture') === '1';   // off-screen PDF render
  const [invoice, setInvoice] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [inv, co] = await Promise.all([
          api.getClientInvoice(Number(id)),
          api.getCompanySettings().catch(() => null),
        ]);
        if (cancelled) return;
        setInvoice(inv);
        setCompany(co);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!invoice) return <div className="empty-state"><p>Invoice not found.</p></div>;

  const co = company || {};
  const c  = invoice.client || {};

  // Brand colours from company_settings — applied to the printed invoice only.
  const brandVars = {
    '--brand-primary': co.brand_primary_colour,
    '--brand-secondary': co.brand_secondary_colour,
    '--letterhead-bg': co.letterhead_background_colour,
    '--letterhead-text': co.letterhead_text_colour,
  } as unknown as CSSProperties;

  const firmAddressLines = [
    co.address_line1, co.address_line2,
    [co.postal_code, co.city].filter(Boolean).join(' '),
    co.country,
  ].filter(Boolean);

  // Use the snapshot if set, otherwise fall back to the client's current postal address.
  const billTo = invoice.billing_address || [
    c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.country,
    c.vat_number ? `VAT: ${c.vat_number}` : null,
  ].filter(Boolean).join('\n');

  // VAT breakdown — group vatable lines by rate; the discount is allocated
  // pro-rata across vatable lines before computing each line's VAT.
  const vatBreakdown = (() => {
    const sv   = Number(invoice.subtotal_vatable || 0);
    const disc = Number(invoice.discount_amount || 0);
    const map  = new Map<number, { net: number; vat: number }>();
    for (const l of (invoice.lines || [])) {
      if (!l.vatable) continue;
      const amt   = Number(l.amount || 0);
      const rate  = Number(l.vat_rate || 0);
      const share = sv > 0 ? amt / sv : 0;
      const net   = Math.max(0, amt - share * disc);
      const cur   = map.get(rate) || { net: 0, vat: 0 };
      cur.net += net;
      cur.vat += net * rate / 100;
      map.set(rate, cur);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  })();

  return (
    <div className="print-page" style={brandVars}>
      <style>{`
        @media print {
          body { background: white; }
          .app-shell .sidebar,
          .app-shell .mobile-header,
          .print-actions { display: none !important; }
          .app-shell .main-content { margin: 0; padding: 0; }
          .print-page { padding: 0 !important; }
        }
        .print-page { padding: 24px; max-width: 900px; margin: 0 auto; background: var(--letterhead-bg, white); color: var(--letterhead-text, #0f172a); display: flex; flex-direction: column; min-height: 297mm; }
        .inv-body { flex: 1; display: flex; flex-direction: column; position: relative; }
        .inv-header { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid var(--brand-primary, #1a2e4a); }
        .inv-header img { max-width: 140px; max-height: 80px; }
        .inv-firm-name { font-weight: 700; font-size: 18px; color: var(--brand-primary, #1a2e4a); }
        .inv-firm-meta { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.5; }
        .inv-title { font-size: 28px; font-weight: 700; color: var(--brand-primary, #1a2e4a); margin: 16px 0 4px; }
        .inv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; font-size: 13px; }
        .inv-meta .panel { background: #f8fafc; padding: 10px 12px; border-radius: 6px; }
        .inv-meta .panel h4 { margin: 0 0 6px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .inv-meta .panel .body { font-size: 13px; white-space: pre-wrap; line-height: 1.5; }
        table.inv-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        table.inv-table th, table.inv-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
        table.inv-table thead th { background: #f1f5f9; font-weight: 600; color: var(--brand-primary, #1a2e4a); }
        table.inv-table td.num { text-align: right; white-space: nowrap; }
        .inv-totals { margin-top: 16px; margin-left: auto; width: 320px; font-size: 13px; }
        .inv-totals tr td { padding: 4px 8px; }
        .inv-totals tr.total td { border-top: 2px solid var(--brand-primary, #1a2e4a); padding-top: 8px; font-weight: 700; font-size: 16px; }
        .inv-payment { margin-top: 24px; padding: 12px; background: #f8fafc; border-left: 4px solid var(--brand-secondary, #b8963e); font-size: 12px; }
        .inv-payment h4 { margin: 0 0 6px; }
        .inv-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; text-align: center; }
        .print-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
        .status-stamp {
          position: absolute; top: 100px; right: 40px;
          font-size: 48px; font-weight: 800; color: rgba(220, 38, 38, 0.18);
          border: 6px solid rgba(220, 38, 38, 0.18); padding: 8px 24px; border-radius: 8px;
          transform: rotate(-15deg); letter-spacing: 0.08em;
          pointer-events: none;
        }
        .status-stamp.paid     { color: rgba(22, 101, 52, 0.22); border-color: rgba(22, 101, 52, 0.22); }
        .status-stamp.draft    { color: rgba(100, 116, 139, 0.22); border-color: rgba(100, 116, 139, 0.22); }
      `}</style>

      {!capturing && <PrintToolbar fileBase={`Invoice-${invoice.invoice_number || invoice.id}`} />}

      <div className="inv-body">
        {invoice.status === 'paid'      && <div className="status-stamp paid">PAID</div>}
        {invoice.status === 'cancelled' && <div className="status-stamp">CANCELLED</div>}
        {invoice.status === 'draft'     && <div className="status-stamp draft">DRAFT</div>}

        {/* Letterhead */}
        <header className="inv-header">
          <PrintLetterhead
            name={co.name || co.legal_name || '—'}
            logoUrl={co.logo_url}
            position={co.letterhead_logo_position}
            height={co.letterhead_logo_height}
            meta={
              <div className="inv-firm-meta">
                {co.tagline && <div style={{ fontSize: 12, color: '#475569' }}>{co.tagline}</div>}
                {firmAddressLines.length > 0 && <div>{firmAddressLines.join(', ')}</div>}
                <div>
                  {co.phone && <span>{co.phone}</span>}
                  {co.phone && co.email && <span> · </span>}
                  {co.email && <span>{co.email}</span>}
                </div>
                {co.website && <div>{co.website}</div>}
                {(co.vat_number || co.registration_number) && (
                  <div>
                    {co.registration_number && <span>Reg: {co.registration_number}</span>}
                    {co.registration_number && co.vat_number && <span> · </span>}
                    {co.vat_number && <span>VAT: {co.vat_number}</span>}
                  </div>
                )}
              </div>
            }
          />
        </header>

        <h1 className="inv-title">Invoice {invoice.invoice_number || '(draft)'}</h1>

        {/* Meta panels */}
        <div className="inv-meta">
          <div className="panel">
            <h4>Bill to</h4>
            <div className="body">
              <strong>{c.name || '—'}</strong>
              {'\n'}{billTo}
            </div>
          </div>
          <div className="panel">
            <h4>Invoice details</h4>
            <div style={{ fontSize: 13 }}>
              <div><strong>Number:</strong> {invoice.invoice_number || <em>(draft)</em>}</div>
              <div><strong>Code:</strong> {c.client_code || '—'}</div>
              <div><strong>Issue date:</strong> {fmtDate(invoice.issue_date)}</div>
              <div><strong>Due date:</strong> {fmtDate(invoice.due_date)}</div>
              {invoice.status === 'paid' && <div><strong>Paid on:</strong> {fmtDate(invoice.paid_date)}</div>}
            </div>
          </div>
        </div>

        {/* Lines */}
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
              <tr key={l.id}>
                <td colSpan={5} style={{ fontStyle: 'italic', color: '#475569' }}>{l.description}</td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{l.description}</div>
                  {l.line_type !== 'fixed' && (
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'capitalize' }}>{l.line_type}</div>
                  )}
                </td>
                <td className="num">{Number(l.quantity).toFixed(2)}</td>
                <td className="num">€{Number(l.unit_price).toFixed(2)}</td>
                <td style={{ textAlign: 'center' }}>{l.vatable ? `${Number(l.vat_rate || 0).toFixed(0)}%` : '—'}</td>
                <td className="num">€{Number(l.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <table className="inv-totals">
          <tbody>
            <tr>
              <td style={{ color: '#475569' }}>Vatable subtotal</td>
              <td className="num">€{Number(invoice.subtotal_vatable || 0).toFixed(2)}</td>
            </tr>
            {Number(invoice.subtotal_nonvatable || 0) > 0 && (
              <tr>
                <td style={{ color: '#475569' }}>Expenses (no VAT)</td>
                <td className="num">€{Number(invoice.subtotal_nonvatable || 0).toFixed(2)}</td>
              </tr>
            )}
            {Number(invoice.discount_amount || 0) > 0 && (
              <tr>
                <td style={{ color: '#475569' }}>
                  Discount {invoice.discount_type === 'percent' && invoice.discount_value
                    ? `(${Number(invoice.discount_value).toFixed(0)}%)` : ''}
                </td>
                <td className="num" style={{ color: '#b91c1c' }}>-€{Number(invoice.discount_amount).toFixed(2)}</td>
              </tr>
            )}
            {vatBreakdown.length === 0 ? (
              <tr>
                <td style={{ color: '#475569' }}>VAT</td>
                <td className="num">€0.00</td>
              </tr>
            ) : vatBreakdown.map(([rate, v]) => (
              <tr key={rate}>
                <td style={{ color: '#475569' }}>
                  VAT @ {rate}% on €{v.net.toFixed(2)}
                </td>
                <td className="num">€{v.vat.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className="num">€{Number(invoice.total_amount || 0).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        {/* Footer — notes on the left, payment details on the right */}
        {(invoice.notes || co.bank_name || co.iban) && (
          <div style={{ marginTop: 'auto', paddingTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="inv-payment" style={{ marginTop: 0 }}>
              <h4>Notes</h4>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {invoice.notes || <em style={{ color: '#94a3b8' }}>—</em>}
              </div>
            </div>
            <div className="inv-payment" style={{ marginTop: 0 }}>
              <h4>Payment details</h4>
              {co.bank_name && <div><strong>Bank:</strong> {co.bank_name}</div>}
              {co.iban      && <div><strong>IBAN:</strong> {co.iban}</div>}
              {(!co.bank_name && !co.iban) && <em style={{ color: '#94a3b8' }}>—</em>}
            </div>
          </div>
        )}

        {co.report_footer && (
          <div className="inv-footer">{co.report_footer}</div>
        )}
      </div>
    </div>
  );
}
