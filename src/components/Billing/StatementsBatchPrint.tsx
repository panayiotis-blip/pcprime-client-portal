import { useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { buildStatement } from './statement';
import PrintToolbar from '../shared/PrintToolbar';

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const eur = (n: number) => '€' + n.toFixed(2);

// Combined print of several client statements — one per page.
export default function StatementsBatchPrint() {
  const [sp] = useSearchParams();
  const ids  = (sp.get('clients') || '').split(',').map(s => Number(s.trim())).filter(Boolean);
  const from = sp.get('from') || undefined;
  const to   = sp.get('to')   || undefined;
  const capturing = sp.get('capture') === '1';

  const [docs, setDocs]       = useState<any[] | null>(null);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const co = await api.getCompanySettings().catch(() => null);
        const results: any[] = [];
        for (const id of ids) {
          results.push(await api.getClientStatement(id));
        }
        if (cancelled) return;
        setCompany(co);
        setDocs(results);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!docs || docs.length === 0) return <div className="empty-state"><p>No statements to print.</p></div>;

  const co = company || {};
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

  return (
    <div className="print-page" style={brandVars}>
      <style>{`
        @media print {
          body { background: white; }
          .app-shell .sidebar,
          .app-shell .mobile-header,
          .print-actions { display: none !important; }
          .app-shell .main-content { margin: 0; padding: 0; }
        }
        .stmt-page { padding: 24px; max-width: 900px; margin: 0 auto; background: var(--letterhead-bg, white); color: var(--letterhead-text, #0f172a); }
        .stmt-page + .stmt-page { page-break-before: always; }
        .inv-header { display: flex; gap: 16px; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid var(--brand-primary, #1a2e4a); }
        .inv-header img { max-width: 140px; max-height: 80px; }
        .inv-firm-name { font-weight: 700; font-size: 18px; color: var(--brand-primary, #1a2e4a); }
        .inv-firm-meta { font-size: 11px; color: #475569; margin-top: 4px; line-height: 1.5; }
        .inv-title { font-size: 26px; font-weight: 700; color: var(--brand-primary, #1a2e4a); margin: 14px 0 4px; }
        .inv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px; font-size: 13px; }
        .inv-meta .panel { background: #f8fafc; padding: 10px 12px; border-radius: 6px; }
        .inv-meta .panel h4 { margin: 0 0 6px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
        .inv-meta .panel .body { font-size: 13px; white-space: pre-wrap; line-height: 1.5; }
        table.inv-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
        table.inv-table th, table.inv-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
        table.inv-table thead th { background: #f1f5f9; font-weight: 600; color: var(--brand-primary, #1a2e4a); }
        table.inv-table td.num, table.inv-table th.num { text-align: right; white-space: nowrap; }
        table.inv-table tr.opening td { font-style: italic; color: #64748b; }
        table.inv-table tr.closing td { border-top: 2px solid var(--brand-primary, #1a2e4a); font-weight: 700; font-size: 14px; }
        .print-actions { display: flex; justify-content: flex-end; gap: 8px; max-width: 900px; margin: 0 auto 12px; padding: 0 24px; }
      `}</style>

      {!capturing && <PrintToolbar fileBase="Statements" />}

      {docs.map((data: any, di: number) => {
        const c = data.client || {};
        const st = buildStatement(data.invoices, data.receipts, from, to);
        const clientAddr = [
          c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.country,
          c.vat_number ? `VAT: ${c.vat_number}` : null,
        ].filter(Boolean).join('\n');

        return (
          <div className="stmt-page" key={di}>
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
                </div>
              </div>
            </header>

            <h1 className="inv-title">Statement of Account</h1>

            <div className="inv-meta">
              <div className="panel">
                <h4>Account</h4>
                <div className="body">
                  <strong>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</strong>
                  {clientAddr ? '\n' + clientAddr : ''}
                </div>
              </div>
              <div className="panel">
                <h4>Statement period</h4>
                <div style={{ fontSize: 13 }}>
                  <div><strong>From:</strong> {from ? fmtDate(from) : 'Account opening'}</div>
                  <div><strong>To:</strong> {fmtDate(to || new Date().toISOString().slice(0, 10))}</div>
                  <div><strong>Balance due:</strong> {eur(st.closing)}</div>
                </div>
              </div>
            </div>

            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Date</th>
                  <th>Description</th>
                  <th className="num" style={{ width: 90 }}>Debit</th>
                  <th className="num" style={{ width: 90 }}>Credit</th>
                  <th className="num" style={{ width: 100 }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="opening">
                  <td colSpan={4}>Balance brought forward</td>
                  <td className="num">{eur(st.opening)}</td>
                </tr>
                {st.rows.map((r, idx) => (
                  <tr key={idx}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{r.description}</td>
                    <td className="num">{r.debit ? eur(r.debit) : '—'}</td>
                    <td className="num">{r.credit ? eur(r.credit) : '—'}</td>
                    <td className="num">{eur(r.balance)}</td>
                  </tr>
                ))}
                {st.rows.length === 0 && (
                  <tr><td colSpan={5} style={{ color: '#64748b' }}>No transactions in this period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="closing">
                  <td colSpan={4}>Balance due</td>
                  <td className="num">{eur(st.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}
