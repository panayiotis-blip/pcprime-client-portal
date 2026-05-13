import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { EmailLinks } from '../shared/MultiEmail';

type ComplianceTask = {
  id: number;
  client_id: number;
  kind: string;
  due_date: string;
  status: string;
};

const COMPLIANCE_LABEL: Record<string, string> = {
  vat_quarterly:    'VAT (Quarterly)',
  social_insurance: 'Social Insurance',
  ir7:              'IR7',
  provisional_tax:  'Provisional Tax',
  he32:             'HE32 (Annual Return)',
  ubo:              'UBO',
};

// Order in which compliance rows appear on the printed card
const COMPLIANCE_ORDER: string[] = [
  'vat_quarterly', 'social_insurance', 'ir7', 'provisional_tax', 'he32', 'ubo',
];

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

// Renders a labelled field row only when value is non-empty
function Field({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="pc-field">
      <span className="pc-field-label">{label}</span>
      <span className="pc-field-value">{value}</span>
    </div>
  );
}

// Section wrapper that only renders if it has visible children
function Section({ title, children }: { title: string; children: any }) {
  // We render the section regardless; the parent decides whether to include it
  // by checking data presence beforehand. This wrapper is just for styling.
  return (
    <section className="pc-section">
      <h3 className="pc-section-title">{title}</h3>
      <div className="pc-section-body">{children}</div>
    </section>
  );
}

export default function ClientCardPrint() {
  const { id } = useParams();
  const clientId = parseInt(id || '0');
  const [client, setClient] = useState<any>(null);
  const [compliance, setCompliance] = useState<ComplianceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, tasks] = await Promise.all([
          api.getClient(clientId),
          api.getComplianceTasks({ client_id: clientId }).catch(() => []),
        ]);
        if (cancelled) return;
        setClient(c);
        setCompliance(tasks as ComplianceTask[]);
        // Audit-log the print action (intentional, async, errors swallowed)
        api.logAction('clients.print_card', 'clients', clientId, { name: c?.name });
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // Auto-trigger the browser print dialog once data is loaded
  useEffect(() => {
    if (loading || error) return;
    const t = setTimeout(() => {
      try { window.print(); } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [loading, error]);

  // Latest task per compliance kind, sorted by the fixed COMPLIANCE_ORDER
  const complianceByKind = useMemo(() => {
    const byKind = new Map<string, ComplianceTask>();
    for (const t of compliance) {
      const existing = byKind.get(t.kind);
      // Prefer open over filed; within same status, the nearest due date wins
      if (!existing) { byKind.set(t.kind, t); continue; }
      const existingOpen = existing.status !== 'filed' && existing.status !== 'completed';
      const tOpen        = t.status !== 'filed'        && t.status !== 'completed';
      if (tOpen && !existingOpen) { byKind.set(t.kind, t); continue; }
      if (tOpen === existingOpen && (t.due_date || '') < (existing.due_date || '')) {
        byKind.set(t.kind, t);
      }
    }
    return COMPLIANCE_ORDER
      .map(kind => byKind.get(kind))
      .filter(Boolean) as ComplianceTask[];
  }, [compliance]);

  if (loading) return <div className="print-card-page"><p style={{ padding: 32 }}>Loading…</p></div>;
  if (error)   return <div className="print-card-page"><p style={{ padding: 32, color: '#b91c1c' }}>Failed to load: {error}</p></div>;
  if (!client) return <div className="print-card-page"><p style={{ padding: 32 }}>Client not found.</p></div>;

  // Decide which sections have any data so we can omit empty ones cleanly
  const hasClientInfo  = client.client_code || client.name || client.trading_name || client.business_type
                        || client.registration_number || client.vat_number || client.tax_number
                        || client.incorporation_date || client.date_of_birth || client.status;
  const hasContact     = client.address || client.city || client.postal_code || client.country
                        || client.phone || client.mobile || client.email || client.website;
  const hasDirectors   = !!client.director_name;
  const hasEngagement  = client.services || client.monthly_fee || client.financial_year_end;
  const hasCompliance  = complianceByKind.length > 0;
  const hasNotes       = !!client.notes;

  const businessTypeLabel = client.business_type || 'Client';

  return (
    <div className="print-card-page">
      {/* On-screen-only toolbar (hidden when printing) */}
      <div className="print-card-toolbar no-print">
        <Link to={`/clients/${clientId}`} className="btn btn-link">← Back to client</Link>
        <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
      </div>

      <article className="print-card">
        {/* ---- Letterhead ---- */}
        <header className="pc-header">
          <div className="pc-header-brand">
            <img src="/logo.png" alt="PC Prime & Calculate Consultants Ltd" className="pc-logo" />
          </div>
          <div className="pc-header-details">
            <div className="pc-firm-name">PC Prime &amp; Calculate Consultants Ltd</div>
            <div className="pc-tagline">Strategic Calculations for Business Growth</div>
            <div className="pc-firm-contact">
              <div>Kiti, Larnaca, Cyprus</div>
              <div>panayiotis@primeandcalculate.com · +357 96 332 274</div>
              <div>primeandcalculate.com</div>
            </div>
          </div>
        </header>
        <div className="pc-header-rule" />

        {/* ---- Title bar ---- */}
        <div className="pc-title-row">
          <div>
            <h1 className="pc-doc-title">Client Card</h1>
            <div className="pc-doc-subtitle">{businessTypeLabel}</div>
          </div>
          <div className="pc-printed-on">Printed: {today()}</div>
        </div>

        {/* ---- Client name banner ---- */}
        <div className="pc-name-banner">
          {client.client_code && <span className="pc-code-badge">{client.client_code}</span>}
          <h2 className="pc-client-name">{client.name}</h2>
          {client.trading_name && client.trading_name !== client.name && (
            <div className="pc-trading-name">Trading as: {client.trading_name}</div>
          )}
        </div>

        {/* ---- Section 1: Client Information ---- */}
        {hasClientInfo && (
          <Section title="Client Information">
            <div className="pc-grid">
              <Field label="Business Type"        value={client.business_type} />
              <Field label="Status"               value={client.status} />
              <Field label="Registration No. (HE)" value={client.registration_number} />
              <Field label="VAT Number"           value={client.vat_number} />
              <Field label="Tax No. (TIC)"        value={client.tax_number} />
              <Field label="ID / Passport No."    value={client.id_number || client.passport_number} />
              <Field label="Incorporation Date"   value={fmtDate(client.incorporation_date)} />
              <Field label="Date of Birth"        value={fmtDate(client.date_of_birth)} />
              <Field label="Nationality"          value={client.nationality} />
              <Field label="Financial Year End"   value={client.financial_year_end} />
            </div>
          </Section>
        )}

        {/* ---- Section 2: Contact Details ---- */}
        {hasContact && (
          <Section title="Contact Details">
            <div className="pc-grid">
              <Field label="Contact Person" value={client.contact_person} />
              <Field label="Email"          value={client.email ? <EmailLinks value={client.email} fallback="" /> : null} />
              <Field label="Phone"          value={client.phone} />
              <Field label="Mobile"         value={client.mobile} />
              <Field label="Website"        value={client.website} />
            </div>
            {(client.address || client.city || client.postal_code || client.country) && (
              <div className="pc-field pc-field-full">
                <span className="pc-field-label">Address</span>
                <span className="pc-field-value">
                  {[client.address, client.city, client.postal_code, client.country].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </Section>
        )}

        {/* ---- Section 3: Directors (single line — single-field schema) ---- */}
        {hasDirectors && (
          <Section title="Directors / Shareholders">
            <div className="pc-field pc-field-full">
              <span className="pc-field-value">{client.director_name}</span>
            </div>
          </Section>
        )}

        {/* ---- Banking section intentionally omitted (no DB schema yet) ---- */}

        {/* ---- Section 5: Engagement Scope ---- */}
        {hasEngagement && (
          <Section title="Engagement Scope">
            <div className="pc-grid">
              <Field label="Services"        value={client.services} />
              <Field label="Monthly Fee"     value={client.monthly_fee} />
              <Field label="Financial Year End" value={client.financial_year_end} />
            </div>
          </Section>
        )}

        {/* ---- Section 6: Compliance Snapshot ---- */}
        {hasCompliance && (
          <Section title="Compliance Snapshot">
            <table className="pc-compliance-table">
              <thead>
                <tr>
                  <th>Filing</th>
                  <th>Status</th>
                  <th>Next due</th>
                </tr>
              </thead>
              <tbody>
                {complianceByKind.map(t => (
                  <tr key={t.id}>
                    <td>{COMPLIANCE_LABEL[t.kind] || t.kind}</td>
                    <td className={`pc-compliance-status pc-compliance-status-${t.status}`}>{t.status}</td>
                    <td>{fmtDate(t.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* ---- Section 7: Notes ---- */}
        {hasNotes && (
          <Section title="Notes">
            <p className="pc-notes-body">{client.notes}</p>
          </Section>
        )}

        {/* ---- Footer ---- */}
        <footer className="pc-footer">
          <div className="pc-footer-rule" />
          <div className="pc-footer-content">
            <span className="pc-confidential">
              This document contains confidential information. For internal use of PC Prime &amp; Calculate Consultants Ltd only.
            </span>
            <span className="pc-page-number">Page 1 of 1</span>
          </div>
          <div className="pc-footer-firm">PC Prime &amp; Calculate Consultants Ltd · primeandcalculate.com</div>
        </footer>
      </article>
    </div>
  );
}
