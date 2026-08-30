// The month-by-month checklist, BUILD.md §8.
//
// The Data import screen used to show the last file loaded and nothing else,
// so six years of imports looked exactly like one, and a person who had just
// loaded 2021 could not tell from the screen whether it had landed. This is
// the screen saying what the ledger holds rather than what was last clicked.
//
// A year to a row, a month to a cell. What a person needs to see at a glance
// is not a number but a shape: which months are there, which are missing, and
// whether any of them fails to balance. Everything else is on the cell.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type MonthRow = {
  period_month: string;
  postings: number;
  accounts: number;
  debit: number;
  credit: number;
  difference: number;
  last_import: number | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MonthChecklist({ clientId, reloadKey }: { clientId: number; reloadKey?: number }) {
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // An RPC rather than a table read, and the reason is worth knowing:
      // the policy on postings is staff_can_access(client_id), so reading
      // these 68 months as rows made the database ask that question 174.026
      // times — once per posting — and the request died on the statement
      // timeout. The function asks it once. Migration 195.
      const { data, error: e } = await supabase.schema('reporting')
        .rpc('ledger_months', { p_client: clientId });
      if (e) { setError(e.message); return; }
      setRows(((data ?? []) as Record<string, unknown>[]).map((r) => ({
        period_month: String(r.period_month),
        postings: Number(r.postings),
        accounts: Number(r.accounts),
        debit: Number(r.debit),
        credit: Number(r.credit),
        difference: Number(r.difference),
        last_import: r.last_import === null ? null : Number(r.last_import),
      })));
    })();
  }, [clientId, reloadKey]);

  if (error) return <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>;
  if (rows === null) return <p style={{ color: '#94a3b8', fontSize: 13 }}>Loading the ledger…</p>;

  if (rows.length === 0) {
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
        <strong style={{ fontSize: 13 }}>Months held</strong>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 0' }}>
          Nothing imported yet, so there is no ledger to show.
        </p>
      </div>
    );
  }

  const byMonth = new Map(rows.map((r) => [r.period_month.slice(0, 7), r]));
  const years: number[] = [];
  const firstYear = Number(rows[0].period_month.slice(0, 4));
  const lastYear = Number(rows[rows.length - 1].period_month.slice(0, 4));
  for (let y = firstYear; y <= lastYear; y++) years.push(y);

  // A gap is a month with nothing in it that falls INSIDE the span held. A
  // month after the last one held is simply not loaded yet, which is a
  // different thing and must not be coloured like a hole in the ledger.
  const last = rows[rows.length - 1].period_month.slice(0, 7);
  const totals = rows.reduce(
    (a, r) => ({
      postings: a.postings + r.postings,
      debit: a.debit + r.debit,
      credit: a.credit + r.credit,
      unbalanced: a.unbalanced + (Math.abs(r.difference) >= 0.005 ? 1 : 0),
    }),
    { postings: 0, debit: 0, credit: 0, unbalanced: 0 },
  );
  let gaps = 0;
  for (const y of years) {
    for (let m = 0; m < 12; m++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      if (key < rows[0].period_month.slice(0, 7) || key > last) continue;
      if (!byMonth.has(key)) gaps++;
    }
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Months held</strong>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {rows.length} month{rows.length === 1 ? '' : 's'} ·{' '}
          {totals.postings.toLocaleString('en-GB')} postings · {eur(totals.debit)} each side
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>
          {gaps > 0 && (
            <span style={{ color: '#b91c1c', marginRight: 10 }}>
              {gaps} month{gaps === 1 ? '' : 's'} missing inside the span
            </span>
          )}
          {totals.unbalanced > 0 ? (
            <span style={{ color: '#b91c1c' }}>
              {totals.unbalanced} month{totals.unbalanced === 1 ? '' : 's'} out of balance
            </span>
          ) : (
            <span style={{ color: '#166534' }}>every month balances</span>
          )}
        </span>
      </div>

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Year</th>
              {MONTHS.map((m) => <th key={m} style={th}>{m}</th>)}
              <th style={{ ...th, textAlign: 'right', paddingLeft: 12 }}>Postings</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const inYear = rows.filter((r) => r.period_month.startsWith(String(y)));
              const yearPostings = inYear.reduce((a, r) => a + r.postings, 0);
              return (
                <tr key={y}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{y}</td>
                  {MONTHS.map((label, i) => {
                    const key = `${y}-${String(i + 1).padStart(2, '0')}`;
                    const r = byMonth.get(key);
                    const beyond = key > last || key < rows[0].period_month.slice(0, 7);
                    const unbalanced = r ? Math.abs(r.difference) >= 0.005 : false;
                    return (
                      <td key={label} style={td}>
                        <div
                          title={
                            r
                              ? `${label} ${y} — ${r.postings.toLocaleString('en-GB')} postings, ` +
                                `${r.accounts.toLocaleString('en-GB')} accounts\n` +
                                `debits ${eur(r.debit)} · credits ${eur(r.credit)}\n` +
                                (unbalanced ? `OUT OF BALANCE by ${eur(r.difference)}\n` : 'balances\n') +
                                `from import #${r.last_import ?? '—'}`
                              : beyond
                                ? `${label} ${y} — not loaded`
                                : `${label} ${y} — MISSING: this month falls inside the ledger's span but holds nothing`
                          }
                          style={{
                            height: 26, borderRadius: 3, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontVariantNumeric: 'tabular-nums', fontSize: 10.5,
                            background: r ? (unbalanced ? '#fee2e2' : '#dcfce7') : beyond ? '#f8fafc' : '#fef3c7',
                            color: r ? (unbalanced ? '#b91c1c' : '#166534') : beyond ? '#cbd5e1' : '#92400e',
                            border: `1px solid ${r ? (unbalanced ? '#fca5a5' : '#bbf7d0') : beyond ? '#f1f5f9' : '#fcd34d'}`,
                            cursor: 'default',
                          }}
                        >
                          {r ? (r.postings >= 1000 ? (r.postings / 1000).toFixed(1) + 'k' : r.postings) : beyond ? '·' : '!'}
                        </div>
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: 'right', paddingLeft: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {yearPostings.toLocaleString('en-GB')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: '#94a3b8', margin: '10px 0 0' }}>
        Each cell is a month, and the number is its postings. Hover for both sides, the accounts
        touched and the import it came from. Amber is a month inside the span that holds nothing;
        red is a month that does not balance.
      </p>
    </div>
  );
}

const th: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#94a3b8',
  fontWeight: 500, padding: '0 3px 6px', textAlign: 'center',
};

const td: React.CSSProperties = { padding: '2px 3px', textAlign: 'center', minWidth: 38 };
