import { useEffect, useState } from 'react';
import { api } from '../../../services/api';

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
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, cust, inv] = await Promise.all([
          api.getCompanyProfile(clientId).catch(() => null),
          api.getCustomers(clientId),
          api.getCustomerInvoices(clientId),
        ]);
        if (cancelled) return;
        setProfile(p); setCustomers(cust as any[]); setInvoices(inv as any[]);
      } catch (err: any) {
        if (!cancelled) alert('Failed to load: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

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
    </div>
  );
}
