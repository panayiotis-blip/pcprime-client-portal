// What Client Reporting opens on: the template.
//
// Its own sign-in, its own client dropdown, its own everything. BUILD.md §4 is
// explicit that the template's layout and wording ARE the specification, and a
// chooser of mine in front of it was a second front door to the same building —
// a person clicking Client Reporting expects the app they designed, not a
// waiting room I built.
//
// So the payload carries every client that has data, and the template does the
// choosing exactly as it was drawn. The loading bay — imports, mapping, the
// review list — lives behind "Manage the data", where it belongs.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildAllClients, buildTemplateHtml } from '../lib/reports/buildPayload.ts';

/** Built once per tab: a minute's wait on every visit would feel broken. */
let cached: { url: string; at: string; clients: { id: number; name: string; postings: number }[] } | null = null;

export default function ReportHome() {
  const [url, setUrl] = useState<string | null>(cached?.url ?? null);
  const [at, setAt] = useState<string | null>(cached?.at ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const build = useCallback(async () => {
    setBusy('Starting'); setError(null); setCount(null);
    try {
      const all = await buildAllClients((step, done, total) => {
        setBusy(step);
        setCount(done !== undefined && total !== undefined ? { done, total } : null);
      });
      setBusy('Opening');
      const blob = await buildTemplateHtml(all.json);
      const next = URL.createObjectURL(blob);
      if (cached) URL.revokeObjectURL(cached.url);
      const when = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      cached = { url: next, at: when, clients: all.clients };
      setUrl(next); setAt(when);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setCount(null); }
  }, []);

  useEffect(() => {
    if (started.current || cached) return;
    started.current = true;
    void build();
  }, [build]);

  if (error) {
    return (
      <div style={{ padding: 32, maxWidth: 640 }}>
        <div className="alert alert-error"><b>The report could not be built.</b><br />{error}</div>
        <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => void build()}>Try again</button>
          <Link className="btn btn-secondary btn-sm" to="/reporting/manage">Manage the data</Link>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div style={{ padding: 32, maxWidth: 560 }}>
        <h1 style={{ fontSize: 18, margin: '0 0 6px' }}>Opening client reporting</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>
          {busy ?? 'Starting'}
          {count ? ` — ${count.done.toLocaleString('en-GB')} of ${count.total.toLocaleString('en-GB')}` : '…'}
        </p>
        {count && (
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, maxWidth: 360 }}>
            <div style={{
              height: 4, borderRadius: 2, background: '#0f172a',
              width: `${Math.round((count.done / Math.max(count.total, 1)) * 100)}%`,
            }} />
          </div>
        )}
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>
          Read once and kept for this tab.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <iframe
        title="PC Prime client reporting"
        src={url}
        style={{ flex: 1, width: '100%', border: 'none' }}
      />
      {/* Small, and out of the way: this is the template's screen, not mine. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '4px 12px',
        borderTop: '1px solid #e2e8f0', background: '#fff', fontSize: 11.5, color: '#94a3b8',
      }}>
        <span>Built at {at}</span>
        <Link to="/reporting/manage">Manage the data</Link>
        <a href={url} target="_blank" rel="noopener noreferrer">Open in its own tab</a>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', padding: '1px 8px' }}
          disabled={!!busy} onClick={() => void build()}>
          {busy ? 'Rebuilding…' : 'Rebuild'}
        </button>
      </div>
    </div>
  );
}
