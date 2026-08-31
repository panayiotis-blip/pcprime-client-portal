// What Client Reporting opens on: the template.
//
// Its own sign-in, its own client dropdown, its own everything. BUILD.md §4 is
// explicit that the template's layout and wording ARE the specification, and a
// chooser of mine in front of it was a second front door to the same building —
// a person clicking Client Reporting expects the app they designed, not a
// waiting room I built.
//
// The sign-in screen needs sixty-three NAMES. It used to be given sixty-three
// clients' figures — 174.026 postings, one client's ledger read in full — before
// it would show at all, which is why it looked like it hung: a load screen, a
// long think, and no dropdown. So the list is built on its own (one query), the
// template opens straight away, and when a client is chosen the template asks
// for that client and waits a few seconds instead of a few minutes.
//
// The loading bay — imports, mapping, the review list — lives behind "Manage
// the data", where it belongs.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildClientList, buildClientBlock, buildTemplateHtml } from '../lib/reports/buildPayload.ts';
import { readCachedBlock, writeCachedBlock } from '../lib/reports/blockCache.ts';
import { supabase } from '../../lib/supabase';

/** Built once per tab: rebuilding the frame on every visit would feel broken. */
let cached: { url: string; at: string; clients: { id: number; name: string; postings: number }[] } | null = null;

/** A client's figures, kept for the tab — signing back in should be instant. */
const blocks = new Map<string, unknown>();

export default function ReportHome() {
  const [url, setUrl] = useState<string | null>(cached?.url ?? null);
  const [at, setAt] = useState<string | null>(cached?.at ?? null);
  const [listed, setListed] = useState(cached?.clients ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const build = useCallback(async () => {
    setBusy('Reading the client list'); setError(null);
    try {
      const list = await buildClientList();
      setBusy('Opening');
      const blob = await buildTemplateHtml(list.json);
      const next = URL.createObjectURL(blob);
      if (cached) URL.revokeObjectURL(cached.url);
      const when = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      cached = { url: next, at: when, clients: list.clients };
      blocks.clear();
      setUrl(next); setAt(when); setListed(list.clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, []);

  useEffect(() => {
    if (started.current || cached) return;
    started.current = true;
    void build();
  }, [build]);

  // The template asks for a client at sign-in; this answers it. The frame is a
  // blob, so its origin is opaque and '*' is the only target that reaches it —
  // the data never leaves the page either way.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; key?: string; feed?: string } | null;
      if (!d) return;

      // The template's Upload buttons used to raise an alert saying the wiring
      // was still to come. It is not: the importer is a screen away. The button
      // now opens it, on the client the frame is signed into, so the one screen
      // a person goes to when they want to upload something is no longer a dead
      // end.
      if (d.type === 'pcp-open-import' && d.key) {
        const want = Number(String(d.key).replace(/^c/, ''));
        const c = listed.find((x) => x.id === want);
        if (!c) return;
        // Opened as a fresh page rather than by setting the session and routing
        // in the same tick. Doing both at once raced: the router matched the
        // no-client tree before the session landed, fell through to this
        // screen, and rebuilt the template — so pressing Upload put you back on
        // the sign-in page, round and round.
        //
        // A new tab also keeps the report you have just waited for. The
        // importer opens beside it, not on top of it.
        window.open(`/reporting/manage?client=${c.id}`, '_blank', 'noopener');
        return;
      }

      if (d.type !== 'pcp-need-client' || !d.key) return;
      const key = String(d.key);
      const frame = e.source as Window | null;
      const reply = (body: Record<string, unknown>) =>
        frame?.postMessage({ type: 'pcp-client-data', key, ...body }, '*');

      const held = blocks.get(key);
      if (held) { reply({ block: held }); return; }

      const id = Number(key.replace(/^c/, ''));
      const who = listed.find((c) => c.id === id);
      if (!Number.isFinite(id) || id <= 0) {
        reply({ error: 'that client id is not one I recognise' });
        return;
      }
      // A client with nothing loaded keeps the empty block it already has:
      // reading zero postings would be a round trip to learn nothing.
      if (who && who.postings === 0) { reply({}); return; }

      void (async () => {
        setReading(who?.name ?? key);
        try {
          // Is what we kept last time still current? 13ms to find out, against
          // roughly ninety seconds to rebuild. The stamp moves when anything is
          // imported or the mapping is changed, and not otherwise — so a second
          // sign-in on unchanged data reads nothing and rebuilds nothing.
          let version: string | null = null;
          const { data: v, error: vErr } = await supabase.schema('reporting')
            .rpc('client_data_version', { p_client: id });
          if (!vErr && typeof v === 'string') {
            version = v;
            const kept = await readCachedBlock(id, version);
            if (kept) {
              blocks.set(key, kept);
              reply({ block: kept });
              setReading(null);
              return;
            }
          }

          const built = await buildClientBlock(id, (step, done, total) => {
            const far = done !== undefined && total
              ? ` ${done.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`
              : '';
            setReading(`${who?.name ?? key} — ${step}${far}`);
            // Say the same thing inside the frame, where the person is looking.
            frame?.postMessage({ type: 'pcp-progress', key, text: `${step}${far}…` }, '*');
          });
          blocks.set(key, built.block);
          reply({ block: built.block });
          // Kept against the stamp it was built from, so the next tab — and the
          // next reload — costs the stamp and nothing else.
          if (version) void writeCachedBlock(id, version, built.block);
        } catch (err) {
          reply({ error: err instanceof Error ? err.message : String(err) });
        } finally { setReading(null); }
      })();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [listed]);

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
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>{busy ?? 'Starting'}…</p>
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
        <span>{listed.length} clients · built at {at}</span>
        {reading && <span style={{ color: '#334155' }}>{reading}…</span>}
        <Link to="/reporting/manage">Manage the data</Link>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', padding: '1px 8px' }}
          disabled={!!busy} onClick={() => void build()}>
          {busy ? 'Rebuilding…' : 'Rebuild'}
        </button>
      </div>
    </div>
  );
}
