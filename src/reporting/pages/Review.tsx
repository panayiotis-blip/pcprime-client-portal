// Review. BUILD.md §9.
//
// The screen the whole application is for. Everything else loads data; this
// says what is wrong with it.
//
// Two rules from the specification shape it. Every exception must be findable
// in BTMS from what is on screen — so journal, journal number, batch and
// reference are shown, not summarised away. And the checks that did NOT run
// are listed as prominently as the ones that did: a review screen showing nine
// green ticks and silent about the three it could not perform reads as
// assurance, which is worse than showing nothing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useReportingSession } from '../session';
import { allRows } from '../lib/import/pages.ts';

type Exception = {
  id: number;
  check_name: string;
  sev: 'high' | 'medium' | 'low';
  month: string | null;
  txn_date: string | null;
  account: string | null;
  report_line: string | null;
  journal: string | null;
  journal_no: string | null;
  batch: string | null;
  reference: string | null;
  amount: number | null;
  description: string;
  detail: string | null;
};

const rep = () => supabase.schema('reporting');

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SEV_COLOUR: Record<string, { bg: string; fg: string; border: string }> = {
  high: { bg: '#fef2f2', fg: '#b91c1c', border: '#fca5a5' },
  medium: { bg: '#fffbeb', fg: '#92400e', border: '#fcd34d' },
  low: { bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' },
};

/** The checks BUILD.md §9 lists that cannot run from what is stored. */
const NOT_RUN = [
  {
    n: 3,
    name: 'Unclassified or unmapped cash',
    why: 'Needs the bank statement feed. No bank statement has ever been imported.',
  },
  {
    n: 9,
    name: 'Balances over 90 days',
    why: 'Needs an allocations export linking receipts to invoices, which BTMS has not been asked for yet (§13). Without it, ageing would be oldest-first guesswork.',
  },
  {
    n: 11,
    name: 'An unposted journal inside a reported month',
    why: 'The parser reads the posted flag — it found 9 unposted journals in A&F 2026 — but the postings table has no column to keep it in. Adding one would sit empty until every file is imported again.',
  },
];

export default function Review() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const [rows, setRows] = useState<Exception[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sev, setSev] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [check, setCheck] = useState<string>('all');

  const load = useCallback(async () => {
    const data = await allRows<Exception>((from, to) =>
      rep().from('exceptions')
        .select('id, check_name, sev, month, txn_date, account, report_line, journal, journal_no, batch, reference, amount, description, detail')
        .eq('client_id', clientId)
        .order('sev').order('month', { ascending: false })
        .range(from, to));
    setRows(data);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    setBusy(true); setError(null);
    const { error: e } = await rep().rpc('regenerate_exceptions', { p_client: clientId });
    setBusy(false);
    if (e) { setError(e.message); return; }
    await load();
  };

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      high: all.filter((r) => r.sev === 'high').length,
      medium: all.filter((r) => r.sev === 'medium').length,
      low: all.filter((r) => r.sev === 'low').length,
    };
  }, [rows]);

  const checks = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.check_name, (m.get(r.check_name) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const shown = useMemo(() => (rows ?? []).filter(
    (r) => (sev === 'all' || r.sev === sev) && (check === 'all' || r.check_name === check),
  ), [rows, sev, check]);

  return (
    <div style={{ padding: 24, maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Review</h1>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run()}>
          {busy ? 'Running the checks…' : 'Run the checks'}
        </button>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 16px', maxWidth: 780 }}>
        What is wrong with this client's figures. Every item carries the journal, batch and
        reference it came from, so it can be found in BTMS from what is on this screen.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {([['all', `All ${counts.total}`], ['high', `High ${counts.high}`],
           ['medium', `Medium ${counts.medium}`], ['low', `Low ${counts.low}`]] as const).map(([k, label]) => (
          <button key={k} className={'btn btn-sm ' + (sev === k ? 'btn-primary' : 'btn-secondary')}
            onClick={() => setSev(k)}>{label}</button>
        ))}
        <select className="form-input" style={{ fontSize: 12, minWidth: 220 }}
          value={check} onChange={(e) => setCheck(e.target.value)}>
          <option value="all">Every check</option>
          {checks.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
        </select>
      </div>

      {rows === null && <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 18, fontSize: 13, color: '#64748b' }}>
          No exceptions have been generated yet. Run the checks.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((r) => {
          const c = SEV_COLOUR[r.sev] ?? SEV_COLOUR.low;
          return (
            <div key={r.id} style={{
              border: `1px solid ${c.border}`, borderLeft: `3px solid ${c.fg}`,
              background: c.bg, borderRadius: 5, padding: '9px 12px',
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase',
                  fontWeight: 600, color: c.fg,
                }}>{r.sev}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{r.check_name}</span>
                {r.month && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {new Date(r.month + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
                  </span>
                )}
                {r.amount !== null && (
                  <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13 }}>
                    {eur(Number(r.amount))}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 3, color: '#0f172a' }}>{r.description}</div>
              {r.detail && <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{r.detail}</div>}

              {(r.account || r.journal || r.reference || r.report_line) && (
                <div style={{
                  fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: '#64748b',
                  marginTop: 5, display: 'flex', gap: 12, flexWrap: 'wrap',
                }}>
                  {r.account && <span>account {r.account}</span>}
                  {r.report_line && <span>line {r.report_line}</span>}
                  {r.journal && <span>journal {r.journal}{r.journal_no ? ' ' + r.journal_no : ''}</span>}
                  {r.batch && <span>batch {r.batch}</span>}
                  {r.reference && <span>ref {r.reference}</span>}
                  {r.txn_date && <span>{r.txn_date}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---- what was not checked, said as loudly as what was ---- */}
      <div style={{
        marginTop: 22, border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, background: '#fcfcfd',
      }}>
        <strong style={{ fontSize: 13 }}>Three of the twelve checks did not run</strong>
        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 10px' }}>
          Nothing above rules these out. They need data this client does not have yet.
        </p>
        {NOT_RUN.map((c) => (
          <div key={c.n} style={{ fontSize: 12.5, marginTop: 8 }}>
            <b>{c.n}. {c.name}</b>
            <div style={{ color: '#64748b', marginTop: 1 }}>{c.why}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
