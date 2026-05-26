import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../services/api';

const DAY = 86_400_000;
const eur = (n: number) => '€' + Number(n || 0).toFixed(2);
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const statusBadge = (s: string) => ({
  draft: { bg: '#f1f5f9', fg: '#475569' }, issued: { bg: '#dbeafe', fg: '#1e40af' },
  paid: { bg: '#dcfce7', fg: '#166534' }, cancelled: { bg: '#fee2e2', fg: '#991b1b' },
}[s] || { bg: '#f1f5f9', fg: '#475569' });

// Staff-facing, read-only view of a client's OWN portal billing — their
// company profile, customers, and the invoices they issue to those customers.
// (RLS already lets staff read this; this just surfaces it on the client record.)
export default function ClientBillingTab({ clientId }: { clientId: number }) {
  const [profile, setProfile]     = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices]   = useState<any[]>([]);
  const [receipts, setReceipts]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, cust, inv, rcpt] = await Promise.all([
          api.getCompanyProfile(clientId).catch(() => null),
          api.getCustomers(clientId),
          api.getCustomerInvoices(clientId),
          api.getCustomerReceipts(clientId),
        ]);
        if (cancelled) return;
        setProfile(p); setCustomers(cust as any[]); setInvoices(inv as any[]); setReceipts(rcpt as any[]);
      } catch (err: any) {
        if (!cancelled) alert('Failed to load: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // Aged debtors — issued (unpaid) invoices bucketed by age (mirrors the
  // client's own Debtors screen).
  const debtors = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const m = new Map<number, any>();
    for (const inv of invoices) {
      if (inv.status !== 'issued') continue;
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

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
        This client's own billing in their portal — company profile, customers, and the invoices they issue. View-only.
      </p>

      {/* Company profile */}
      <div>
        <h3 style={{ marginBottom: 8 }}>Company profile</h3>
        <div className="card" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {profile?.logo_url && <img src={profile.logo_url} alt="Logo" style={{ maxHeight: 50, maxWidth: 150, border: '1px solid #e2e8f0', borderRadius: 4 }} />}
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600 }}>{profile?.business_name || <span style={{ color: '#94a3b8' }}>— not set —</span>}</div>
            {profile?.vat_number && <div>VAT: {profile.vat_number}</div>}
            {profile?.registration_number && <div>Reg: {profile.registration_number}</div>}
            {profile?.address && <div style={{ whiteSpace: 'pre-line' }}>{profile.address}</div>}
            {(profile?.phone || profile?.email) && <div>{[profile.phone, profile.email].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
      </div>

      {/* Customers */}
      <div>
        <h3 style={{ marginBottom: 8 }}>Customers ({customers.length})</h3>
        {customers.length === 0 ? (
          <div className="empty-state"><p>No customers yet.</p></div>
        ) : (
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>VAT</th><th style={{ textAlign: 'center' }}>Active</th></tr></thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} style={c.active ? undefined : { opacity: 0.55 }}>
                    <td>{c.name}</td><td>{c.contact_person || '—'}</td><td>{c.email || '—'}</td>
                    <td>{c.phone || '—'}</td><td>{c.vat_number || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{c.active ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sales invoices */}
      <div>
        <h3 style={{ marginBottom: 8 }}>Sales invoices ({invoices.length})</h3>
        {invoices.length === 0 ? (
          <div className="empty-state"><p>No invoices yet.</p></div>
        ) : (
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead>
                <tr><th>Number</th><th>Customer</th><th>Issue date</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th></th></tr>
              </thead>
              <tbody>
                {invoices.map(i => {
                  const bd = statusBadge(i.status);
                  return (
                    <tr key={i.id}>
                      <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{i.invoice_number || '(draft)'}</td>
                      <td>{i.customer_name || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.issue_date)}</td>
                      <td><span style={{ background: bd.bg, color: bd.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{i.status}</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(i.total_amount)}</td>
                      <td><button className="btn btn-secondary btn-sm" onClick={() => window.open(`/sales/${i.id}`, '_blank')}>Open</button></td>
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
        <h3 style={{ marginBottom: 8 }}>Receipts ({receipts.length})</h3>
        {receipts.length === 0 ? (
          <div className="empty-state"><p>No receipts yet.</p></div>
        ) : (
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead>
                <tr><th>Number</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Method</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
              </thead>
              <tbody>
                {receipts.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{r.receipt_number}</td>
                    <td>{r.customer_name || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.invoice_number || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.receipt_date)}</td>
                    <td>{r.payment_method || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Aged debtors */}
      <div>
        <h3 style={{ marginBottom: 8 }}>Debtors (outstanding)</h3>
        {debtors.rows.length === 0 ? (
          <div className="empty-state"><p>No outstanding customer invoices.</p></div>
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
                {debtors.rows.map(r => (
                  <tr key={r.customer_id}>
                    <td>{r.name}</td>
                    <td style={{ textAlign: 'right' }}>{r.current ? eur(r.current) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.d30 ? eur(r.d30) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.d60 ? eur(r.d60) : '—'}</td>
                    <td style={{ textAlign: 'right', color: r.d90 ? '#b91c1c' : undefined }}>{r.d90 ? eur(r.d90) : '—'}</td>
                    <td style={{ textAlign: 'right', color: r.d90p ? '#b91c1c' : undefined }}>{r.d90p ? eur(r.d90p) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{eur(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{eur(debtors.totals.current)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(debtors.totals.d30)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(debtors.totals.d60)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(debtors.totals.d90)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(debtors.totals.d90p)}</td>
                  <td style={{ textAlign: 'right' }}>{eur(debtors.totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
