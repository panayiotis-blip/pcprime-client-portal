// Reports → Profit and loss, Balance sheet. BUILD.md §8.
//
// The figures come from reporting.report_figures (migration 198), which is
// where every decision about roll-up, mapping, sign and period lives. This
// screen chooses the period and prints what comes back; it does no arithmetic
// of its own, so there is exactly one place where a number can be wrong.
//
// The balance sheet carries a warning until a trial balance has been imported,
// and that warning is the point rather than an apology. A journal listing is a
// record of movement. Without the opening position it can tell you what changed
// since the first month held and not what the company is worth — and a balance
// sheet that is quietly short of its opening balances looks exactly like one
// that is right.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useReportingSession } from '../session';

type Figure = {
  line_id: string;
  statement: 'pl' | 'bs';
  section: string;
  line_name: string;
  sort_order: number;
  is_subtotal: boolean;
  amount: number;
};

const rep = () => supabase.schema('reporting');

const eur = (n: number) =>
  n === 0 ? '—' : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthLabel = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The same span a year earlier, which is what a comparative means here. */
const yearBefore = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  return `${d.getUTCFullYear() - 1}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

export default function Reports() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const [months, setMonths] = useState<string[]>([]);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [now, setNow] = useState<Figure[] | null>(null);
  const [prior, setPrior] = useState<Figure[] | null>(null);
  const [hasTrialBalance, setHasTrialBalance] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which months exist, so the period can only ever be one that is held.
  useEffect(() => {
    (async () => {
      const { data, error: e } = await rep().rpc('ledger_months', { p_client: clientId });
      if (e) { setError(e.message); return; }
      const ms = ((data ?? []) as { period_month: string }[]).map((r) => String(r.period_month));
      setMonths(ms);
      if (ms.length) {
        const last = ms[ms.length - 1];
        const firstOfYear = ms.find((m) => m.slice(0, 4) === last.slice(0, 4)) ?? ms[0];
        setFrom(firstOfYear);
        setTo(last);
      }
      const { count } = await rep().from('imports')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('feed', 'trial_balance').eq('status', 'committed');
      setHasTrialBalance((count ?? 0) > 0);
    })();
  }, [clientId]);

  const run = useCallback(async () => {
    if (!from || !to) return;
    setBusy(true); setError(null);
    const [a, b] = await Promise.all([
      rep().rpc('report_figures', { p_client: clientId, p_from: from, p_to: to }),
      rep().rpc('report_figures', { p_client: clientId, p_from: yearBefore(from), p_to: yearBefore(to) }),
    ]);
    setBusy(false);
    if (a.error) { setError(a.error.message); return; }
    setNow((a.data ?? []) as Figure[]);
    setPrior(b.error ? [] : ((b.data ?? []) as Figure[]));
  }, [clientId, from, to]);

  useEffect(() => { void run(); }, [run]);

  const priorById = useMemo(
    () => new Map((prior ?? []).map((f) => [f.line_id, Number(f.amount)])),
    [prior],
  );

  const netAssets = now?.find((f) => f.line_id === 'B-500');
  const totalEquity = now?.find((f) => f.line_id === 'B-699');
  const check = netAssets && totalEquity ? Number(netAssets.amount) - Number(totalEquity.amount) : null;

  const statement = (which: 'pl' | 'bs') => (now ?? []).filter((f) => f.statement === which);

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Reports</h1>
      <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px' }}>
        The master report lines, valued from the ledger for the period you choose, against the same
        period a year earlier.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#64748b' }}>From</label>
        <select className="form-input" value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontSize: 12 }}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <label style={{ fontSize: 12, color: '#64748b' }}>to</label>
        <select className="form-input" value={to} onChange={(e) => setTo(e.target.value)} style={{ fontSize: 12 }}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        {busy && <span style={{ fontSize: 12, color: '#94a3b8' }}>Working…</span>}
      </div>

      <Statement
        title="Profit and loss"
        subtitle={`Movement, ${from ? monthLabel(from) : ''} to ${to ? monthLabel(to) : ''}`}
        rows={statement('pl')}
        prior={priorById}
        priorLabel={from ? monthLabel(yearBefore(from)) + ' to ' + monthLabel(yearBefore(to)) : ''}
      />

      {hasTrialBalance === false && (
        <div className="alert alert-warning" style={{ margin: '20px 0 0' }}>
          <b>The balance sheet has no opening balances.</b> Nothing but journal listings has been
          imported, and a journal listing records movement, not position. These figures are therefore
          the movement since {months.length ? monthLabel(months[0]) : 'the first month held'} — not
          what the company is worth. Import a trial balance and they become the real position.
        </div>
      )}

      <Statement
        title="Balance sheet"
        subtitle={`Position at ${to ? monthLabel(to) : ''}`}
        rows={statement('bs')}
        prior={priorById}
        priorLabel={to ? 'at ' + monthLabel(yearBefore(to)) : ''}
      />

      {check !== null && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 6, fontSize: 13,
          border: '1px solid ' + (Math.abs(check) < 0.005 ? '#bbf7d0' : '#fca5a5'),
          background: Math.abs(check) < 0.005 ? '#f0fdf4' : '#fef2f2',
          color: Math.abs(check) < 0.005 ? '#166534' : '#b91c1c',
        }}>
          <b>Net assets less total equity: {eur(check)}.</b>{' '}
          {Math.abs(check) < 0.005
            ? 'This proves the arithmetic of the statement above it. It does not prove the books balance — B-640 is a plug, so this figure can only ever be nil.'
            : 'This should be nil. The statement does not add up.'}
        </div>
      )}
    </div>
  );
}

function Statement({ title, subtitle, rows, prior, priorLabel }: {
  title: string;
  subtitle: string;
  rows: Figure[];
  prior: Map<string, number>;
  priorLabel: string;
}) {
  let section = '';
  return (
    <div style={{ marginTop: 20, border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>{subtitle}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Line</th>
              <th style={th}>This period</th>
              <th style={{ ...th, color: '#94a3b8' }}>{priorLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const newSection = f.section !== section;
              section = f.section;
              const amt = Number(f.amount);
              const was = prior.get(f.line_id) ?? 0;
              return (
                <tr key={f.line_id} style={{
                  background: f.is_subtotal ? '#f8fafc' : '#fff',
                  fontWeight: f.is_subtotal ? 600 : 400,
                }}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: f.is_subtotal ? 14 : 26 }}>
                    {newSection && !f.is_subtotal && (
                      <div style={{
                        fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase',
                        color: '#94a3b8', margin: '6px 0 2px', marginLeft: -12,
                      }}>{f.section}</div>
                    )}
                    {f.line_name}
                    <span style={{
                      fontFamily: 'ui-monospace, monospace', fontSize: 9.5,
                      color: '#cbd5e1', marginLeft: 8,
                    }}>{f.line_id}</span>
                  </td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: amt < 0 ? '#b91c1c' : '#0f172a' }}>
                    {eur(amt)}
                  </td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: '#94a3b8' }}>
                    {eur(was)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#94a3b8',
  fontWeight: 500, padding: '6px 14px', textAlign: 'right', borderBottom: '1px solid #f1f5f9',
};

const td: React.CSSProperties = { padding: '3px 14px', textAlign: 'right' };
