import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import PrintToolbar from '../shared/PrintToolbar';

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Printable receipt for a customer payment, on the client's own letterhead.
export default function CustomerReceiptPrint() {
  const { id } = useParams();
  const [receipt, setReceipt] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getCustomerReceipt(Number(id));
        const prof = r ? await api.getCompanyProfile((r as any).owner_client_id).catch(() => null) : null;
        if (cancelled) return;
        setReceipt(r); setProfile(prof);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!receipt) return <div className="empty-state"><p>Receipt not found.</p></div>;

  const co = profile || {};
  const cust = receipt.customer || {};

  return (
    <div className="print-page">
      <style>{`
        @media print { body { background: white; } .app-shell .sidebar, .app-shell .mobile-header, .pt-toolbar { display: none !important; } .app-shell .main-content { margin: 0; padding: 0; } .print-page { padding: 0 !important; } }
        .print-page { padding: 24px; max-width: 900px; margin: 0 auto; background: white; color: #0f172a; }
        .inv-header { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid #1a2e4a; }
        .inv-header img { max-width: 140px; max-height: 80px; }
        .inv-firm-name { font-weight: 700; font-size: 18px; color: #1a2e4a; }
        .inv-firm-meta { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.5; white-space: pre-line; }
        .inv-title { font-size: 26px; font-weight: 700; color: #1a2e4a; margin: 16px 0 4px; }
        .inv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; font-size: 13px; }
        .inv-meta .panel { background: #f8fafc; padding: 10px 12px; border-radius: 6px; }
        .inv-meta .panel h4 { margin: 0 0 6px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .inv-meta .panel .body { font-size: 13px; white-space: pre-wrap; line-height: 1.5; }
        .rcpt-amount { margin-top: 16px; padding: 16px; background: #f8fafc; border-left: 4px solid #b8963e; font-size: 18px; }
        .rcpt-amount strong { font-size: 24px; color: #1a2e4a; }
      `}</style>

      <PrintToolbar fileBase={`Receipt-${receipt.receipt_number}`} />

      <header className="inv-header">
        {co.logo_url && <img src={co.logo_url} alt={co.business_name || 'Logo'} />}
        <div style={{ flex: 1 }}>
          <div className="inv-firm-name">{co.business_name || '—'}</div>
          <div className="inv-firm-meta">
            {co.address ? co.address + '\n' : ''}{co.vat_number ? `VAT: ${co.vat_number}` : ''}
          </div>
        </div>
      </header>

      <h1 className="inv-title">Receipt {receipt.receipt_number}</h1>

      <div className="inv-meta">
        <div className="panel">
          <h4>Received from</h4>
          <div className="body"><strong>{cust.name || '—'}</strong>{cust.address ? '\n' + cust.address : ''}</div>
        </div>
        <div className="panel">
          <h4>Receipt details</h4>
          <div style={{ fontSize: 13 }}>
            <div><strong>Number:</strong> {receipt.receipt_number}</div>
            <div><strong>Date:</strong> {fmtDate(receipt.receipt_date)}</div>
            {receipt.payment_method && <div><strong>Method:</strong> {receipt.payment_method}</div>}
            {receipt.invoice?.invoice_number && <div><strong>For invoice:</strong> {receipt.invoice.invoice_number}</div>}
          </div>
        </div>
      </div>

      <div className="rcpt-amount">
        Amount received: <strong>€{Number(receipt.amount || 0).toFixed(2)}</strong>
      </div>
      <p style={{ marginTop: 16, fontSize: 13, color: '#475569' }}>
        Received with thanks{receipt.invoice?.invoice_number ? ` in full settlement of invoice ${receipt.invoice.invoice_number}` : ''}.
      </p>
    </div>
  );
}
