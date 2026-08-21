import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import PrintLetterhead from '../shared/PrintLetterhead';
import PrintToolbar from '../shared/PrintToolbar';
import { formatDate } from '../../services/dates';

type TimeEntry = {
  id: number;
  user_id: string;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  entry_date: string;
  minutes: number;
  service: string;
  description: string | null;
  billable: boolean;
  rate_snapshot: number | null;
};

const fmtDate = (iso: string) => formatDate(iso, '');
const todayLong = () => formatDate(new Date());

const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60); const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
};

// Printable timesheet. Reads filters from URL query params so the parent
// /timesheet page can hand off the current view by simply opening a new tab.
//   ?staff=<uuid>   filter to one staff member (omit = all)
//   ?from=YYYY-MM-DD
//   ?to=YYYY-MM-DD
//   ?client=<id>
//   ?service=<picklist>
export default function TimesheetPrint() {
  const [params] = useSearchParams();
  const staffId   = params.get('staff')   || '';
  const fromDate  = params.get('from')    || '';
  const toDate    = params.get('to')      || '';
  const clientId  = params.get('client')  || '';
  const serviceP  = params.get('service') || '';

  const [company, setCompany]   = useState<any>(null);
  const [entries, setEntries]   = useState<TimeEntry[]>([]);
  const [staff, setStaff]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [co, users, data] = await Promise.all([
          api.getCompanySettings(),
          api.getUsers(),
          api.getTimeEntries({
            user_id:   staffId || undefined,
            client_id: clientId ? Number(clientId) : undefined,
            service:   serviceP || undefined,
            from:      fromDate || undefined,
            to:        toDate || undefined,
          }),
        ]);
        if (cancelled) return;
        setCompany(co);
        setStaff(users as any[]);
        setEntries(data as TimeEntry[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [staffId, fromDate, toDate, clientId, serviceP]);

  const staffName = (uid: string) => staff.find(u => u.id === uid)?.display_name || uid;
  const subjectStaff = staffId ? staffName(staffId) : 'All staff';

  const totals = useMemo(() => {
    const totalMin    = entries.reduce((s, e) => s + e.minutes, 0);
    const billableMin = entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
    const value       = entries
      .filter(e => e.billable && e.rate_snapshot != null)
      .reduce((s, e) => s + (e.minutes / 60) * Number(e.rate_snapshot), 0);
    // Taken from the entries themselves rather than a fixed list: only
    // services with time on them were ever shown, and this way a service added
    // under Company Settings appears here without a second place to update.
    const byService = Array.from(new Set(entries.map(e => e.service))).sort().map(svc => {
      const rows = entries.filter(e => e.service === svc);
      const mins = rows.reduce((s, e) => s + e.minutes, 0);
      const val  = rows.filter(e => e.billable && e.rate_snapshot != null)
        .reduce((s, e) => s + (e.minutes / 60) * Number(e.rate_snapshot), 0);
      return { service: svc, minutes: mins, value: val };
    }).filter(b => b.minutes > 0);
    return { totalMin, billableMin, value, byService };
  }, [entries]);

  if (loading) return <div className="loading-screen">Loading…</div>;

  const co = company || {};
  // Brand colours from company_settings — applied to the printed timesheet only.
  const brandVars = {
    '--brand-primary': co.brand_primary_colour,
    '--brand-secondary': co.brand_secondary_colour,
    '--letterhead-bg': co.letterhead_background_colour,
    '--letterhead-text': co.letterhead_text_colour,
  } as unknown as CSSProperties;
  const addressLines = [
    co.address_line1, co.address_line2,
    [co.postal_code, co.city].filter(Boolean).join(' '),
    co.country,
  ].filter(Boolean);

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
        .ts-header { display: flex; gap: 16px; align-items: flex-start; border-bottom: 2px solid var(--brand-primary, #1a2e4a); padding-bottom: 12px; margin-bottom: 16px; }
        .ts-header img { max-width: 140px; max-height: 80px; }
        .ts-firm-name { font-weight: 700; font-size: 18px; color: var(--brand-primary, #1a2e4a); }
        .ts-firm-tag  { font-size: 12px; color: #475569; }
        .ts-firm-meta { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.5; }
        .ts-doc-title { font-size: 22px; font-weight: 700; margin: 8px 0 4px; color: var(--brand-primary, #1a2e4a); }
        .ts-meta-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 13px; margin-bottom: 12px; }
        table.ts-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.ts-table th, table.ts-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
        table.ts-table thead th { background: #f1f5f9; font-weight: 600; color: var(--brand-primary, #1a2e4a); }
        .ts-totals { margin-top: 16px; display: flex; gap: 24px; flex-wrap: wrap; font-size: 13px; }
        .ts-totals .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
        .ts-totals .value { font-weight: 700; font-size: 18px; color: var(--brand-primary, #1a2e4a); }
        .ts-breakdown { margin-top: 12px; font-size: 12px; }
        .ts-breakdown table { width: auto; }
        .ts-signature { margin-top: 40px; display: flex; gap: 60px; flex-wrap: wrap; font-size: 12px; }
        .ts-signature .line { border-bottom: 1px solid #0f172a; min-width: 200px; height: 20px; margin-bottom: 4px; }
        .ts-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #64748b; text-align: center; }
        .print-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
      `}</style>

      <PrintToolbar fileBase="Timesheet" />

      {/* Letterhead */}
      <header className="ts-header">
        <PrintLetterhead
          name={co.name || co.legal_name || '—'}
          logoUrl={co.logo_url}
          position={co.letterhead_logo_position}
          height={co.letterhead_logo_height}
          meta={
            <div className="ts-firm-meta">
              {co.tagline && <div className="ts-firm-tag">{co.tagline}</div>}
              {addressLines.length > 0 && <div>{addressLines.join(', ')}</div>}
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

      <h1 className="ts-doc-title">Timesheet</h1>
      <div className="ts-meta-row">
        <div>
          <strong>Staff:</strong> {subjectStaff}
          {fromDate || toDate ? (
            <>
              {'  ·  '}<strong>Period:</strong> {fromDate ? fmtDate(fromDate) : '—'} → {toDate ? fmtDate(toDate) : '—'}
            </>
          ) : null}
        </div>
        <div style={{ color: '#64748b' }}>Printed: {todayLong()}</div>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>No time entries for this period.</div>
      ) : (
        <table className="ts-table">
          <thead>
            <tr>
              <th>Date</th>
              {!staffId && <th>Staff</th>}
              <th>Client</th>
              <th>Service</th>
              <th>Description</th>
              <th style={{ textAlign: 'right' }}>Hours</th>
              <th style={{ textAlign: 'center' }}>Bill.</th>
              <th style={{ textAlign: 'right' }}>Rate</th>
              <th style={{ textAlign: 'right' }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const value = (e.billable && e.rate_snapshot != null)
                ? `€${((e.minutes / 60) * Number(e.rate_snapshot)).toFixed(2)}`
                : '—';
              return (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.entry_date)}</td>
                  {!staffId && <td>{staffName(e.user_id)}</td>}
                  <td>
                    {e.client_name
                      ? <span>{e.client_code ? <span style={{ color: '#64748b' }}>{e.client_code} </span> : null}{e.client_name}</span>
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td>{e.service}</td>
                  <td>{e.description || ''}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatMinutes(e.minutes)}</td>
                  <td style={{ textAlign: 'center' }}>{e.billable ? '✓' : ''}</td>
                  <td style={{ textAlign: 'right' }}>{e.rate_snapshot != null ? `€${Number(e.rate_snapshot).toFixed(2)}` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{value}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Totals */}
      <div className="ts-totals">
        <div>
          <div className="label">Total time</div>
          <div className="value">{formatMinutes(totals.totalMin)}</div>
        </div>
        <div>
          <div className="label">Billable time</div>
          <div className="value">{formatMinutes(totals.billableMin)}</div>
        </div>
        <div>
          <div className="label">Billable value</div>
          <div className="value">€{totals.value.toFixed(2)}</div>
        </div>
        <div>
          <div className="label">Entries</div>
          <div className="value">{entries.length}</div>
        </div>
      </div>

      {/* Per-service breakdown */}
      {totals.byService.length > 0 && (
        <div className="ts-breakdown">
          <strong>By service:</strong>
          <table className="ts-table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Service</th>
                <th style={{ textAlign: 'right' }}>Hours</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {totals.byService.map(b => (
                <tr key={b.service}>
                  <td>{b.service}</td>
                  <td style={{ textAlign: 'right' }}>{formatMinutes(b.minutes)}</td>
                  <td style={{ textAlign: 'right' }}>€{b.value.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Signature line (mainly for paper sign-off) */}
      <div className="ts-signature">
        <div>
          <div className="line" />
          <div>Staff signature</div>
        </div>
        <div>
          <div className="line" />
          <div>Approved by</div>
        </div>
        <div>
          <div className="line" />
          <div>Date</div>
        </div>
      </div>

      {co.report_footer && (
        <div className="ts-footer">{co.report_footer}</div>
      )}
    </div>
  );
}
