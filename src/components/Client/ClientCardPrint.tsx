import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { EmailLinks } from '../shared/MultiEmail';
import { vatCategoryLabel, vatPeriods } from '../../services/vatCategories';

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
const COMPLIANCE_ORDER: string[] = ['vat_quarterly','social_insurance','ir7','provisional_tax','he32','ubo'];

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const fmtAddress = (a: any) => {
  if (!a) return null;
  const lines = [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.country]
    .filter(Boolean);
  return lines.length === 0 ? null : lines.join(', ');
};

function FieldRow({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="pc-field">
      <span className="pc-field-label">{label}</span>
      <span className="pc-field-value">{value}</span>
    </div>
  );
}

function Section({ title, children, empty }: { title: string; children: any; empty?: string }) {
  return (
    <section className="pc-section">
      <h3 className="pc-section-title">{title}</h3>
      <div className="pc-section-body">{children || (empty && <span style={{ color: '#94a3b8' }}>{empty}</span>)}</div>
    </section>
  );
}

const isCompanyLike = (cat: string) =>
  cat === 'company' || cat === 'partnership' || cat === 'sole_trader';

export default function ClientCardPrint() {
  const { id } = useParams();
  const clientId = parseInt(id || '0');
  const [client, setClient]         = useState<any>(null);
  const [compliance, setCompliance] = useState<ComplianceTask[]>([]);
  const [company, setCompany]       = useState<any>(null);
  const [addresses, setAddresses]   = useState<any[]>([]);
  const [directors, setDirectors]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, tasks, co, addrs, dirs] = await Promise.all([
          api.getClient(clientId),
          api.getComplianceTasks({ client_id: clientId }).catch(() => []),
          api.getCompanySettings().catch(() => null),
          api.getClientAddresses(clientId).catch(() => []),
          api.getClientDirectors(clientId).catch(() => []),
        ]);
        if (cancelled) return;
        setClient(c);
        setCompliance(tasks as ComplianceTask[]);
        setCompany(co);
        setAddresses(addrs as any[]);
        setDirectors(dirs as any[]);
        api.logAction('clients.print_card', 'clients', clientId, { name: c?.name });
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  useEffect(() => {
    if (loading || error) return;
    const t = setTimeout(() => { try { window.print(); } catch {} }, 250);
    return () => clearTimeout(t);
  }, [loading, error]);

  const complianceByKind = useMemo(() => {
    const byKind = new Map<string, ComplianceTask>();
    for (const t of compliance) {
      const existing = byKind.get(t.kind);
      if (!existing) { byKind.set(t.kind, t); continue; }
      const existingOpen = existing.status !== 'filed' && existing.status !== 'completed';
      const tOpen        = t.status !== 'filed'        && t.status !== 'completed';
      if (tOpen && !existingOpen) { byKind.set(t.kind, t); continue; }
      if (tOpen === existingOpen && (t.due_date || '') < (existing.due_date || '')) {
        byKind.set(t.kind, t);
      }
    }
    return COMPLIANCE_ORDER.map(kind => byKind.get(kind)).filter(Boolean) as ComplianceTask[];
  }, [compliance]);

  if (loading) return <div className="print-card-page"><p style={{ padding: 32 }}>Loading…</p></div>;
  if (error)   return <div className="print-card-page"><p style={{ padding: 32, color: '#b91c1c' }}>Failed to load: {error}</p></div>;
  if (!client) return <div className="print-card-page"><p style={{ padding: 32 }}>Client not found.</p></div>;

  const cat = (client.client_category || '') as string;
  const companyLike = isCompanyLike(cat);

  // Address types shown — fall back to legacy single address if no rows exist
  const findAddr = (t: string) => addresses.find(a => a.address_type === t);
  const primaryAddr  = companyLike ? findAddr('registered') : findAddr('home');
  const tradingAddr  = findAddr('trading');
  const postalAddr   = findAddr('postal');
  const legacyAddr   = (!primaryAddr && (client.address || client.city || client.postal_code || client.country))
    ? { line1: client.address, city: client.city, postal_code: client.postal_code, country: client.country }
    : null;
  const effectivePrimary = primaryAddr || legacyAddr;

  const hasAddresses = !!(effectivePrimary || tradingAddr || postalAddr);
  const businessTypeLabel = client.business_type || client.client_category || 'Client';

  // Brand colours from company_settings — applied to the printed card only.
  const brandVars = {
    '--brand-primary': company?.brand_primary_colour,
    '--brand-secondary': company?.brand_secondary_colour,
    '--letterhead-bg': company?.letterhead_background_colour,
    '--letterhead-text': company?.letterhead_text_colour,
  } as unknown as CSSProperties;

  return (
    <div className="print-card-page" style={brandVars}>
      <div className="print-card-toolbar no-print">
        <Link to={`/clients/${clientId}`} className="btn btn-link">← Back to client</Link>
        <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
      </div>

      <article className="print-card">
        {/* ---- Letterhead ---- */}
        {(() => {
          const co = company || {};
          const firmName = co.name || co.legal_name || 'PC Prime & Calculate Consultants Ltd';
          const tagline  = co.tagline || 'Strategic Calculations for Business Growth';
          const logoSrc  = co.logo_url || '/logo.png';
          const addressLine = [
            co.address_line1, co.address_line2,
            [co.postal_code, co.city].filter(Boolean).join(' '),
            co.country,
          ].filter(Boolean).join(', ') || 'Kiti, Larnaca, Cyprus';
          const contactLine = [co.email || 'panayiotis@primeandcalculate.com', co.phone || '+357 96 332 274']
            .filter(Boolean).join(' · ');
          const website = co.website || 'primeandcalculate.com';
          return (
            <header className="pc-header">
              <div className="pc-header-brand">
                <img src={logoSrc} alt={firmName} className="pc-logo" />
              </div>
              <div className="pc-header-details">
                <div className="pc-firm-name">{firmName}</div>
                {tagline && <div className="pc-tagline">{tagline}</div>}
                <div className="pc-firm-contact">
                  <div>{addressLine}</div>
                  <div>{contactLine}</div>
                  {website && <div>{website}</div>}
                </div>
              </div>
            </header>
          );
        })()}
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
          {client.name_tax_office && client.name_tax_office !== client.name && (
            <div className="pc-trading-name">As per Tax Office: {client.name_tax_office}</div>
          )}
          {client.trading_name && client.trading_name !== client.name && (
            <div className="pc-trading-name">Trading as: {client.trading_name}</div>
          )}
        </div>

        {/* Two-column body */}
        <div className="pc-two-col">
          {/* ---- LEFT COLUMN ---- */}
          <div>
            <Section title="General Information">
              <div className="pc-grid">
                <FieldRow label="Category"          value={client.client_category} />
                <FieldRow label="Business Type"     value={client.business_type} />
                <FieldRow label="Status"            value={client.client_status || client.status} />
                <FieldRow label="VAT Registered"    value={client.vat_status || (client.vat_number ? 'Yes' : null)} />
                <FieldRow label="Incorporation"     value={fmtDate(client.incorporation_date)} />
                <FieldRow label="Date of Birth"     value={fmtDate(client.date_of_birth)} />
                <FieldRow label="Year End"          value={client.year_end_date || client.financial_year_end} />
                <FieldRow label="VAT Category"      value={vatCategoryLabel(client.vat_category) || client.vat_period} />
                <FieldRow label="VAT Periods"       value={vatPeriods(client.vat_category, client.vat_start_month).join(', ')} />
                <FieldRow label="OSS VAT Category"  value={vatCategoryLabel(client.oss_vat_category)} />
                <FieldRow label="OSS VAT Periods"   value={vatPeriods(client.oss_vat_category, client.oss_vat_start_month).join(', ')} />
              </div>
            </Section>

            <Section title="Contact">
              <div className="pc-grid">
                <FieldRow label="Contact Person" value={client.contact_person} />
                <FieldRow label="Email"          value={client.email ? <EmailLinks value={client.email} fallback="" /> : null} />
                <FieldRow label="Phone"          value={client.phone} />
                <FieldRow label="Mobile"         value={client.mobile} />
                <FieldRow label="Website"        value={client.website} />
              </div>
            </Section>

            {hasAddresses && (
              <Section title="Addresses">
                {effectivePrimary && (
                  <div className="pc-field pc-field-full">
                    <span className="pc-field-label">{companyLike ? 'Registered Office' : 'Home'}</span>
                    <span className="pc-field-value">{fmtAddress(effectivePrimary)}</span>
                  </div>
                )}
                {tradingAddr && (
                  <div className="pc-field pc-field-full">
                    <span className="pc-field-label">Trading</span>
                    <span className="pc-field-value">{fmtAddress(tradingAddr)}</span>
                  </div>
                )}
                {postalAddr && (
                  <div className="pc-field pc-field-full">
                    <span className="pc-field-label">Postal</span>
                    <span className="pc-field-value">{fmtAddress(postalAddr)}</span>
                  </div>
                )}
              </Section>
            )}
          </div>

          {/* ---- RIGHT COLUMN ---- */}
          <div>
            <Section title="Tax &amp; Identifiers">
              <div className="pc-grid">
                <FieldRow label="Tax No. (TIC)"  value={client.tax_number} />
                <FieldRow label="VAT Number"     value={client.vat_number} />
                <FieldRow label="VAT Reg. Date"  value={fmtDate(client.vat_registration_date)} />
                <FieldRow label="Reg. No. (HE)"  value={client.registration_number} />
                <FieldRow label="SI Number"      value={client.social_insurance_number} />
                <FieldRow label="SI Employer #"  value={client.employer_number} />
                <FieldRow label="ERGANI"         value={client.ergani_number} />
                <FieldRow label="ID"             value={client.id_number} />
                <FieldRow label="Passport"       value={client.passport_number} />
                <FieldRow label="Nationality"    value={client.nationality} />
              </div>
            </Section>

            <Section title="Directors / Shareholders" empty={companyLike ? 'None recorded' : undefined}>
              {directors.length > 0 ? (
                <table className="pc-compliance-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th style={{ textAlign: 'right' }}>Shareholding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directors.map(d => (
                      <tr key={d.id}>
                        <td>{d.name || '—'}</td>
                        <td>{d.role || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{d.shareholding_pct != null ? `${d.shareholding_pct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : client.director_name ? (
                <p>{client.director_name}</p>
              ) : null}
            </Section>

            {complianceByKind.length > 0 && (
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

            {(client.services || client.monthly_fee) && (
              <Section title="Engagement">
                <div className="pc-grid">
                  <FieldRow label="Services"    value={client.services} />
                  <FieldRow label="Monthly Fee" value={client.monthly_fee != null ? `€${Number(client.monthly_fee).toFixed(2)}` : null} />
                </div>
              </Section>
            )}
          </div>
        </div>

        {/* ---- Notes (full width, below the two columns) ---- */}
        {client.notes && (
          <Section title="Notes">
            <p className="pc-notes-body">{client.notes}</p>
          </Section>
        )}

        {/* ---- Footer ---- */}
        <footer className="pc-footer">
          <div className="pc-footer-rule" />
          {(() => {
            const co = company || {};
            const firmName = co.name || co.legal_name || 'PC Prime & Calculate Consultants Ltd';
            const website  = co.website || 'primeandcalculate.com';
            const footerText = co.report_footer
              || `This document contains confidential information. For internal use of ${firmName} only.`;
            return (
              <>
                <div className="pc-footer-content">
                  <span className="pc-confidential">{footerText}</span>
                  <span className="pc-page-number">Page 1 of 1</span>
                </div>
                <div className="pc-footer-firm">{firmName}{website ? ` · ${website}` : ''}</div>
              </>
            );
          })()}
        </footer>
      </article>
    </div>
  );
}
