// The report itself, inside the portal.
//
// Sign in to the portal, choose the client, and this is what opens: the
// template, with that client's figures, filling the screen. The import and
// mapping screens stay in the rail behind it — they are the loading bay, not
// the product, and a person coming to look at a client's figures should not
// have to walk through them first.
//
// The build is kept for the session. It takes about a minute on a client with
// 174.026 postings, and rebuilding it every time somebody clicked away and back
// would make the report feel broken. "Rebuild" is there for after an import.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReportingSession } from '../session';
import { buildClientBlock, buildTemplateHtml, oneClientPayload } from '../lib/reports/buildPayload.ts';

/**
 * One built report per client, for as long as the tab lives. Blob URLs are
 * revoked when replaced, so a session that rebuilds a few times does not leave
 * a trail of 7MB objects behind it.
 */
const built = new Map<number, { url: string; at: string }>();

export default function ViewTemplate() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const [url, setUrl] = useState<string | null>(built.get(clientId)?.url ?? null);
  const [at, setAt] = useState<string | null>(built.get(clientId)?.at ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [count, setCount] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const build = useCallback(async () => {
    setBusy('Starting'); setError(null); setCount(null);
    try {
      const payload = await buildClientBlock(clientId, (step: string, done?: number, total?: number) => {
        setBusy(step);
        setCount(done !== undefined && total !== undefined ? { done, total } : null);
      });
      setBusy('Opening the report');
      const blob = await buildTemplateHtml(oneClientPayload(payload));
      const next = URL.createObjectURL(blob);
      const previous = built.get(clientId);
      if (previous) URL.revokeObjectURL(previous.url);
      const when = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      built.set(clientId, { url: next, at: when });
      setUrl(next); setAt(when);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setCount(null); }
  }, [clientId]);

  // Build once on arrival, if this client has not been built this session.
  useEffect(() => {
    if (started.current || built.has(clientId)) return;
    started.current = true;
    void build();
  }, [clientId, build]);

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 700 }}>
        <div className="alert alert-error"><b>The report could not be built.</b><br />{error}</div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => void build()}>
          Try again
        </button>
      </div>
    );
  }

  if (!url) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1 style={{ fontSize: 18, margin: '0 0 6px' }}>Building {client!.name}'s report</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>
          {busy ?? 'Starting'}
          {count ? ` — ${count.done.toLocaleString('en-GB')} of ${count.total.toLocaleString('en-GB')} postings` : '…'}
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
          It is read once and kept for the rest of this session.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px',
        borderBottom: '1px solid #e2e8f0', background: '#fff', fontSize: 12, color: '#64748b',
      }}>
        <span>Built at {at}</span>
        <a href={url} target="_blank" rel="noopener noreferrer">Open in its own tab</a>
        <a href={url} download={`reporting-${client!.code ?? clientId}.html`}>Save</a>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
          disabled={!!busy} onClick={() => void build()}>
          {busy ? 'Rebuilding…' : 'Rebuild'}
        </button>
      </div>
      <iframe
        title={`${client!.name} reporting`}
        src={url}
        style={{ flex: 1, width: '100%', border: 'none' }}
      />
    </div>
  );
}
