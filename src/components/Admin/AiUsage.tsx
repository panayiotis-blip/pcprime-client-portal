import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { formatDateTime } from '../../services/dates';

const usd = (n: number) => '$' + Number(n || 0).toFixed(4);
const num = (n: number) => Number(n || 0).toLocaleString();

// Cost monitoring for AI document scans (extract-document). Token usage is
// logged per scan; cost shown here is an ESTIMATE — the Anthropic console is
// authoritative, and the monthly spend cap should be set there.
export default function AiUsage() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setData(await api.getAiUsageSummary()); }
      catch (err: any) { alert('Failed to load: ' + err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="loading-screen">Loading…</div>;

  const Card = ({ title, t }: { title: string; t: any }) => (
    <div className="card" style={{ flex: 1, minWidth: 220 }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>{title}</h3>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{usd(t.cost)}</div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
        {num(t.scans)} scan{t.scans === 1 ? '' : 's'} · {num(t.input)} in / {num(t.output)} out tokens
      </div>
    </div>
  );

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>AI Usage</h2></div>

      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Token usage for AI document scans. Cost is an <strong>estimate</strong> (tokens × published Haiku rates, in USD) —
        the <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">Anthropic console</a> is authoritative;
        set your monthly spend cap there.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <Card title="This month" t={data.month} />
        <Card title="All time" t={data.all} />
      </div>

      <h3>Recent scans</h3>
      {data.recent.length === 0 ? (
        <div className="empty-state"><p>No AI scans logged yet.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>When</th><th>Model</th>
                <th style={{ textAlign: 'right' }}>Pages</th>
                <th style={{ textAlign: 'right' }}>Input</th>
                <th style={{ textAlign: 'right' }}>Output</th>
                <th style={{ textAlign: 'right' }}>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</td>
                  <td>{r.model || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.pages ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{num(r.input_tokens)}</td>
                  <td style={{ textAlign: 'right' }}>{num(r.output_tokens)}</td>
                  <td style={{ textAlign: 'right' }}>{usd(r.estimated_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
