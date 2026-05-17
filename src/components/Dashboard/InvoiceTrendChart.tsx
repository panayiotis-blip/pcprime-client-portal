import { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Parses an invoice_date string in either DD/MM/YYYY or YYYY-MM-DD into
// an ISO YYYY-MM key, or '' if unparseable. Falls back to created_at.
function monthKey(invoice: any): string {
  // Prefer the `batch_month` if set (already YYYY-MM from createInvoice)
  if (invoice.batch_month) return invoice.batch_month;
  // Try invoice_date
  const d = invoice.invoice_date as string | undefined;
  if (d) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
      const [, mm, yyyy] = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || [];
      return `${yyyy}-${mm}`;
    }
    if (/^\d{4}-\d{2}/.test(d)) return d.slice(0, 7);
  }
  // Fall back to created_at
  if (invoice.created_at) return String(invoice.created_at).slice(0, 7);
  return '';
}

function lastSixMonthKeys(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  if (!y || !m) return key;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en', { month: 'short' }) + ` ${y.slice(2)}`;
};

export default function InvoiceTrendChart() {
  const { invoices } = useApp();

  const data = useMemo(() => {
    const keys = lastSixMonthKeys();
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, 0);
    for (const inv of invoices) {
      const k = monthKey(inv);
      if (counts.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
    }
    return keys.map(k => ({ month: monthLabel(k), invoices: counts.get(k) || 0 }));
  }, [invoices]);

  const total = data.reduce((sum, d) => sum + d.invoices, 0);

  return (
    <div className="dashboard-widget" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Invoice Trend</h3>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{total} in last 6 months</span>
      </div>
      <div style={{ flex: 1, minHeight: 220, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(13,27,46,0.06)' }} contentStyle={{ borderRadius: 6, fontSize: 12 }} />
            <Bar dataKey="invoices" fill="#1a2e4a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
