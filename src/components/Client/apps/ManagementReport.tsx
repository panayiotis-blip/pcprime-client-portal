import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../services/api';
import { PanelSkeleton } from '../../ui';

// Management Report — the general reporting app, allocatable to any client
// (unlike the Greson-specific dashboard). Firm-side view.
//
// The numbers come from the client's OWN portal data: customer invoices for
// revenue, client expenses for costs, both net of VAT so the P&L agrees with
// what the client sees in their own Reports page. On top of that sit manual
// adjustments — payroll, depreciation, accruals, anything the portal doesn't
// hold — stored per client in client_app_data under this app's key, so no
// schema of its own and the usual per-client isolation applies.
//
// Every figure is shown against the period before it and the same period a
// year earlier, because a management number alone says very little.

type Adjustment = { id: string; date: string; label: string; kind: 'revenue' | 'cost'; amount: number; note?: string };
type Period = { from: string; to: string };
type Column = { label: string; period: Period; revenue: number; costs: number; byType: Array<[string, number]> };

const eur = (n: number) =>
  (n < 0 ? '-' : '') + '€' + Math.abs(n).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Local calendar date, NOT toISOString(): east of Greenwich, midnight local is
// the previous day in UTC, which would shift every period boundary back a day.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const shiftYear = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setFullYear(d.getFullYear() + n); return iso(d); };
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);

// The period immediately before this one, of the same length.
const previousPeriod = (p: Period): Period => {
  const len = daysBetween(p.from, p.to);
  return { to: addDays(p.from, -1), from: addDays(p.from, -1 - len) };
};
const lastYear = (p: Period): Period => ({ from: shiftYear(p.from, -1), to: shiftYear(p.to, -1) });

const thisYear = (): Period => {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
};
const quarterOf = (offset: number): Period => {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + offset, year = now.getFullYear();
  while (q < 0) { q += 4; year -= 1; }
  while (q > 3) { q -= 4; year += 1; }
  return { from: iso(new Date(year, q * 3, 1)), to: iso(new Date(year, q * 3 + 3, 0)) };
};
const monthOf = (offset: number): Period => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { from: iso(d), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
};

export default function ManagementReport({ clientId }: { clientId: number }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState<Period>(thisYear);
  const [showAdj, setShowAdj] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    (async () => {
      try {
        const [inv, exp, doc] = await Promise.all([
          api.getCustomerInvoices(clientId),
          api.getMyExpenses(clientId),
          api.getClientAppData(clientId, 'mgmt-report'),
        ]);
        if (!alive) return;
        setInvoices(inv as any[]);
        setExpenses(exp as any[]);
        setAdjustments(Array.isArray(doc?.data?.adjustments) ? doc!.data.adjustments : []);
      } catch (e: any) {
        if (alive) setErr(e?.message || 'Could not load this client\'s figures.');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [clientId]);

  const saveAdjustments = async (next: Adjustment[]) => {
    setAdjustments(next);
    setSaving(true);
    try { await api.saveClientAppData(clientId, 'mgmt-report', { adjustments: next }); }
    catch (e: any) { alert('Could not save: ' + (e?.message || e)); }
    finally { setSaving(false); }
  };

  // One column of the P&L for a given period. Invoices count when issued (or
  // paid); expenses when dated; both net of VAT. Rejected expenses and draft
  // invoices are excluded — they are not costs or revenue yet.
  const columnFor = (label: string, p: Period): Column => {
    const inRange = (d: string | null | undefined) => !!d && d >= p.from && d <= p.to;
    const sales = invoices.filter(i => (i.status === 'issued' || i.status === 'paid') && inRange(i.issue_date));
    const exps = expenses.filter(e => e.status !== 'rejected' && inRange(e.expense_date || (e.created_at || '').slice(0, 10)));

    let revenue = sales.reduce((s, i) => s + (Number(i.total_amount || 0) - Number(i.vat_amount || 0)), 0);
    const byType = new Map<string, number>();
    for (const e of exps) {
      const t = e.expense_type || 'Other';
      byType.set(t, (byType.get(t) || 0) + (Number(e.amount || 0) - Number(e.vat_amount || 0)));
    }
    let costs = [...byType.values()].reduce((s, n) => s + n, 0);

    for (const a of adjustments.filter(a => inRange(a.date))) {
      if (a.kind === 'revenue') { revenue += Number(a.amount || 0); }
      else {
        costs += Number(a.amount || 0);
        byType.set(a.label || 'Adjustment', (byType.get(a.label || 'Adjustment') || 0) + Number(a.amount || 0));
      }
    }
    return { label, period: p, revenue, costs, byType: [...byType.entries()].sort((a, b) => b[1] - a[1]) };
  };

  const cols = useMemo(() => {
    if (loading) return [];
    return [
      columnFor('This period', period),
      columnFor('Previous period', previousPeriod(period)),
      columnFor('Same period last year', lastYear(period)),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, expenses, adjustments, period, loading]);

  if (loading) return <PanelSkeleton rows={6} />;
  if (err) return <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>;

  const [cur, prev, ly] = cols;
  const profit = (c: Column) => c.revenue - c.costs;
  const margin = (c: Column) => (c.revenue ? (profit(c) / c.revenue) * 100 : 0);
  // Change against a comparison column. Meaningless without a base, hence null.
  const delta = (now: number, before: number): number | null => (before === 0 ? null : ((now - before) / Math.abs(before)) * 100);
  const deltaCell = (now: number, before: number) => {
    const d = delta(now, before);
    if (d === null) return <span style={{ color: '#94a3b8' }}>—</span>;
    const up = d >= 0;
    return <span style={{ color: up ? '#166534' : '#b91c1c' }}>{up ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%</span>;
  };

  // Cost lines across all three columns, biggest current cost first.
  const costLines = [...new Set(cols.flatMap(c => c.byType.map(([t]) => t)))]
    .map(t => ({ type: t, values: cols.map(c => c.byType.find(([k]) => k === t)?.[1] ?? 0) }))
    .sort((a, b) => b.values[0] - a.values[0]);

  const periodBtn = (label: string, p: Period) => (
    <button className="btn btn-link btn-sm" onClick={() => setPeriod(p)}>{label}</button>
  );

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>

      <div className="no-print card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>From<br />
            <input type="date" className="form-input" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} /></label>
          <label style={{ fontSize: 12, color: '#64748b' }}>To<br />
            <input type="date" className="form-input" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} /></label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {periodBtn('This month', monthOf(0))}
            {periodBtn('Last month', monthOf(-1))}
            {periodBtn('This quarter', quarterOf(0))}
            {periodBtn('Last quarter', quarterOf(-1))}
            {periodBtn('This year', thisYear())}
          </div>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAdj(s => !s)}>
              {showAdj ? 'Hide adjustments' : `Adjustments (${adjustments.length})`}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 Print</button>
          </span>
        </div>
      </div>

      {showAdj && <AdjustmentsPanel adjustments={adjustments} saving={saving} onChange={saveAdjustments} />}

      {/* Headline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 14 }}>
        <Tile label="Revenue" value={eur(cur.revenue)} foot={<>vs previous {deltaCell(cur.revenue, prev.revenue)}</>} />
        <Tile label="Costs" value={eur(cur.costs)} foot={<>vs previous {deltaCell(cur.costs, prev.costs)}</>} />
        <Tile label="Net profit" value={eur(profit(cur))} foot={<>vs previous {deltaCell(profit(cur), profit(prev))}</>}
          tone={profit(cur) >= 0 ? '#166534' : '#b91c1c'} />
        <Tile label="Margin" value={`${margin(cur).toFixed(1)}%`} foot={<>last year {margin(ly).toFixed(1)}%</>} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
          <thead>
            <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'right' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>Profit &amp; loss</th>
              {cols.map(c => (
                <th key={c.label} style={{ padding: '8px 12px' }}>
                  {c.label}<div style={{ fontWeight: 400, fontSize: 11, color: '#94a3b8' }}>{c.period.from} → {c.period.to}</div>
                </th>
              ))}
              <th style={{ padding: '8px 12px', width: 110 }}>vs previous</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Revenue" values={cols.map(c => c.revenue)} bold delta={deltaCell(cur.revenue, prev.revenue)} />
            <tr><td colSpan={5} style={{ padding: '10px 12px 2px', color: '#64748b', fontSize: 12, fontWeight: 600 }}>Costs</td></tr>
            {costLines.map(l => (
              <Row key={l.type} label={l.type} values={l.values} indent delta={deltaCell(l.values[0], l.values[1])} />
            ))}
            <Row label="Total costs" values={cols.map(c => c.costs)} bold delta={deltaCell(cur.costs, prev.costs)} />
            <Row label="Net profit" values={cols.map(c => profit(c))} bold strong delta={deltaCell(profit(cur), profit(prev))} />
            <Row label="Margin" values={cols.map(c => margin(c))} suffix="%" delta={deltaCell(margin(cur), margin(prev))} />
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 10 }}>
        Revenue is issued and paid customer invoices, net of VAT, by invoice date. Costs are the client's expenses excluding
        rejected ones, net of VAT, by expense date. Draft invoices are not counted. Adjustments you add are included in the
        period they are dated.
      </p>
    </div>
  );
}

function Tile({ label, value, foot, tone }: { label: string; value: string; foot?: React.ReactNode; tone?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || '#0f172a', margin: '4px 0 2px' }}>{value}</div>
      {foot && <div style={{ fontSize: 12, color: '#64748b' }}>{foot}</div>}
    </div>
  );
}

function Row({ label, values, bold, strong, indent, suffix, delta }:
  { label: string; values: number[]; bold?: boolean; strong?: boolean; indent?: boolean; suffix?: string; delta?: React.ReactNode }) {
  const fmt = (n: number) => (suffix === '%' ? `${n.toFixed(1)}%` : eur(n));
  return (
    <tr style={{ borderTop: '1px solid #f1f5f9' }}>
      <td style={{ padding: '7px 12px', paddingLeft: indent ? 26 : 12, fontWeight: bold ? 700 : 400, color: strong ? '#1a365d' : '#334155' }}>{label}</td>
      {values.map((v, i) => (
        <td key={i} style={{ padding: '7px 12px', textAlign: 'right', fontWeight: bold ? 700 : 400, color: i === 0 ? '#0f172a' : '#64748b' }}>{fmt(v)}</td>
      ))}
      <td style={{ padding: '7px 12px', textAlign: 'right' }}>{delta}</td>
    </tr>
  );
}

// Figures the portal does not hold — payroll, depreciation, accruals, anything
// outside the client's invoices and expenses. Dated, so they land in the right
// period and in the comparisons too.
function AdjustmentsPanel({ adjustments, saving, onChange }:
  { adjustments: Adjustment[]; saving: boolean; onChange: (next: Adjustment[]) => void }) {
  const [f, setF] = useState<{ date: string; label: string; kind: 'revenue' | 'cost'; amount: string }>(
    { date: iso(new Date()), label: '', kind: 'cost', amount: '' });

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(f.amount.replace(/[,\s€]/g, ''));
    if (!f.label.trim() || !isFinite(amount) || amount === 0) { alert('Give the adjustment a label and a non-zero amount.'); return; }
    onChange([...adjustments, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date: f.date, label: f.label.trim(), kind: f.kind, amount }]);
    setF(p => ({ ...p, label: '', amount: '' }));
  };
  const remove = (id: string) => { if (confirm('Remove this adjustment?')) onChange(adjustments.filter(a => a.id !== id)); };

  return (
    <div className="no-print" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a365d', marginBottom: 4 }}>
        Adjustments {saving && <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>· saving…</span>}
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>
        Figures the portal doesn't hold — payroll, depreciation, accruals. Costs are positive numbers; a negative amount
        reduces the line. They count in the period they are dated, comparisons included.
      </p>

      {adjustments.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 10 }}>
          <thead>
            <tr style={{ color: '#64748b', textAlign: 'left', background: '#f8fafc' }}>
              <th style={{ padding: '6px 10px', width: 120 }}>Date</th><th style={{ padding: '6px 10px' }}>Label</th>
              <th style={{ padding: '6px 10px', width: 90 }}>Type</th><th style={{ padding: '6px 10px', width: 120, textAlign: 'right' }}>Amount</th>
              <th style={{ padding: '6px 10px', width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {[...adjustments].sort((a, b) => (a.date < b.date ? 1 : -1)).map(a => (
              <tr key={a.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 10px' }}>{a.date}</td>
                <td style={{ padding: '6px 10px' }}>{a.label}</td>
                <td style={{ padding: '6px 10px', color: a.kind === 'revenue' ? '#166534' : '#b45309' }}>{a.kind}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>{eur(a.amount)}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                  <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => remove(a.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, color: '#64748b' }}>Date<br />
          <input type="date" className="form-input" value={f.date} onChange={e => setF(p => ({ ...p, date: e.target.value }))} /></label>
        <label style={{ fontSize: 12, color: '#64748b' }}>Label<br />
          <input className="form-input" value={f.label} onChange={e => setF(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Payroll" style={{ minWidth: 180 }} /></label>
        <label style={{ fontSize: 12, color: '#64748b' }}>Type<br />
          <select className="form-input" value={f.kind} onChange={e => setF(p => ({ ...p, kind: e.target.value as 'revenue' | 'cost' }))}>
            <option value="cost">cost</option><option value="revenue">revenue</option>
          </select></label>
        <label style={{ fontSize: 12, color: '#64748b' }}>Amount (net)<br />
          <input className="form-input" value={f.amount} onChange={e => setF(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" style={{ width: 120 }} /></label>
        <button className="btn btn-primary btn-sm" type="submit">Add</button>
      </form>
    </div>
  );
}
