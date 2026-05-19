import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Printable payment receipt. Browser print dialog auto-fires once loaded.
export default function ReceiptPrint() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const capturing = sp.get('capture') === '1';   // off-screen PDF render
  const [receipt, setReceipt] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r, co] = await Promise.all([
          api.getReceipt(Number(id)),
          api.getCompanySettings().catch(() => null),
        ]);
        if (cancelled) return;
        setReceipt(r);
        setCompany(co);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (loading || capturing) return;
    const t = setTimeout(() => { try { window.print(); } catch {} }, 300);
    return () => clearTimeout(t);
  }, [loading, capturing]);

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!receipt) return <div className="empty-state"><p>Receipt not found.</p></div>;

  const co = company || {};
  const c  = receipt.client || {};

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

  const clientAddr = [
    c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.country,
  ].filter(Boolean).join('\n');

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
        .print-page { padding: 24px; max-width: 900px; margin: 0 auto; background: var(--letterhead-bg, white); color: var(--letterhead-text, #0f172a); }
        .inv-header { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid var(--brand-primary, #1a2e4a); }
        .inv-header img { max-width: 140px; max-height: 80px; }
        .inv-firm-name { font-weight: 700; font-size: 18px; color: var(--brand-primary, #1a2e4a); }
        .inv-firm-meta { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.5; }
        .inv-title { font-size: 28px; font-weight: 700; color: var(--brand-primary, #1a2e4a); margin: 16px 0 4px; }
        .inv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; font-size: 13px; }
        .inv-meta .panel { background: #f8fafc; padding: 10px 12px; border-radius: 6px; }
        .inv-meta .panel h4 { margin: 0 0 6px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .inv-meta .panel .body { font-size: 13px; white-space: pre-wrap; line-height: 1.5; }
        .rcpt-amount { margin-top: 16px; padding: 16px; background: #f8fafc; border-left: 4px solid var(--brand-secondary, #b8963e); font-size: 18px; }
        .rcpt-amount strong { font-size: 24px; color: var(--brand-primary, #1a2e4a); }
        .rcpt-thanks { margin-top: 16px; font-size: 13px; color: #475569; }
        .inv-footer { margin-top: 32px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; text-align: center; }
        .print-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
      `}</style>

      {!capturing && (
        <div className="print-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => window.close()}>Close</button>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print</button>
        </div>
      )}

      <header className="inv-header">
        {co.logo_url && <img src={co.logo_url} alt={co.name || 'Company logo'} />}
        <div style={{ flex: 1 }}>
          <div className="inv-firm-name">{co.name || co.legal_name || '—'}</div>
          {co.tagline && <div style={{ fontSize: 12, color: '#475569' }}>{co.tagline}</div>}
          <div className="inv-firm-meta">
            {firmAddressLines.length > 0 && <div>{firmAddressLines.join(', ')}</div>}
            <div>
              {co.phone && <span>{co.phone}</span>}
              {co.phone && co.email && <span> · </span>}
              {co.email && <span>{co.email}</span>}
            </div>
            {(co.vat_number || co.registration_number) && (
              <div>
                {co.registration_number && <span>Reg: {co.registration_number}</span>}
                {co.registration_number && co.vat_number && <span> · </span>}
                {co.vat_number && <span>VAT: {co.vat_number}</span>}
              </div>
            )}
          </div>
        </div>
      </header>

      <h1 className="inv-title">Receipt {receipt.receipt_number}</h1>

      <div className="inv-meta">
        <div className="panel">
          <h4>Received from</h4>
          <div className="body">
            <strong>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</strong>
            {clientAddr ? '\n' + clientAddr : ''}
          </div>
        </div>
        <div className="panel">
          <h4>Receipt details</h4>
          <div style={{ fontSize: 13 }}>
            <div><strong>Number:</strong> {receipt.receipt_number}</div>
            <div><strong>Date:</strong> {fmtDate(receipt.receipt_date)}</div>
            {receipt.payment_method && <div><strong>Method:</strong> {receipt.payment_method}</div>}
            {receipt.invoice?.invoice_number && (
              <div><strong>For invoice:</strong> {receipt.invoice.invoice_number}</div>
            )}
          </div>
        </div>
      </div>

      <div className="rcpt-amount">
        Amount received: <strong>€{Number(receipt.amount || 0).toFixed(2)}</strong>
      </div>

      <p className="rcpt-thanks">
        Received with thanks
        {receipt.invoice?.invoice_number
          ? ` in full settlement of invoice ${receipt.invoice.invoice_number}`
          : ''}.
      </p>

      {receipt.notes && (
        <div style={{ marginTop: 16, fontSize: 12, color: '#475569', whiteSpace: 'pre-wrap' }}>
          <strong>Notes:</strong> {receipt.notes}
        </div>
      )}

      {co.report_footer && <div className="inv-footer">{co.report_footer}</div>}
    </div>
  );
}
