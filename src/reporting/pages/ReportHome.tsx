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
// There is no loading bay beside it any more. Imports, mapping and the review
// list are screens the template already has, written to the specification; the
// copies that lived behind "Manage the data" were a second application a person
// could get stuck in. Uploading happens on the template's own Data import
// screen, and this file answers it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildClientList, buildClientBlock, buildTemplateHtml } from '../lib/reports/buildPayload.ts';
import { readCachedBlock, writeCachedBlock, forgetCachedBlock } from '../lib/reports/blockCache.ts';
import { saveBudget, type BudgetMessage } from '../lib/reports/budgetStore.ts';
import { saveKeyedColumn, deleteKeyedColumn } from '../lib/reports/keyedStore.ts';
import {
  saveReviewSignoffs, saveWorkingPapers,
  type ReviewMap, type WorkingPapers,
} from '../lib/reports/signoffStore.ts';
import UploadDialog from '../upload/UploadDialog.tsx';
import VatFiledDialog from '../upload/VatFiledDialog.tsx';
import { feedByName, type Feed } from '../upload/feeds.ts';
import { readFolder } from '../upload/readFolder.ts';
import { setSection } from '../lib/reports/sectionStore.ts';
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
  /**
   * What an action inside the frame had to say for itself.
   *
   * Kept apart from `error` because the two have to behave differently. An
   * error means the report could not be built and there is nothing to show;
   * this means something happened while the report was open, and the report
   * must still be there afterwards.
   */
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  // The Upload button on the template's own Data import table opens this. It is
  // a dialog over the report, never a screen: every way out returns here.
  const [upload, setUpload] = useState<
    { feed: Feed; clientId: number; clientName: string; period?: string } | null>(null);
  // Attaching the return that was actually filed, from the VAT screen.
  const [vatFiled, setVatFiled] = useState<{ clientId: number; clientName: string; quarter: string } | null>(null);
  const started = useRef(false);

  /**
   * Build the frame and the client list.
   *
   * There was a Rebuild button beside this and it is gone: the partner could
   * not tell what it did, and a person should not have to know when a report
   * has gone stale. It goes stale on one event -- something being imported --
   * and the report refreshes itself on that event now.
   */
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
      const d = e.data as
        ({ type?: string; key?: string; feed?: string; feature?: string; on?: boolean; q?: string; period?: string;
           wp?: WorkingPapers; review?: ReviewMap;
           from?: string; to?: string; name?: string; amounts?: Record<string, number | null> }
          & Partial<BudgetMessage>) | null;
      if (!d) return;

      // The budget is keyed by hand and never generated, so every figure in it
      // is somebody’s decision. The template writes local storage as it is
      // typed and tells us; this is what makes it the practice’s record
      // rather than one machine’s.
      if (d.type === 'pcp-budget-save' && d.key) {
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        void saveBudget(cid, { months: d.months ?? [], budget: d.budget ?? {} })
          .catch((err) => setNotice({
            text: 'The budget was not saved: ' + (err instanceof Error ? err.message : String(err)),
            bad: true,
          }));
        return;
      }

      // A column the partner keyed himself, sitting with a client: a target, a
      // what-if, an agreed adjustment. Saved against the client AND the period
      // it was typed against, because a target for seven months is not a target
      // for twelve. Nothing derives these figures and nothing else reads them —
      // not the statements, not the review, not the audit.
      if ((d.type === 'pcp-keyed-save' || d.type === 'pcp-keyed-delete') && d.key) {
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        const from = String(d.from ?? ''), to = String(d.to ?? ''), name = String(d.name ?? '');
        const doing = d.type === 'pcp-keyed-save'
          ? saveKeyedColumn(cid, { from, to, name, amounts: d.amounts ?? {} }).then(() => undefined)
          : deleteKeyedColumn(cid, from, to, name);
        void doing
          .then(() => setNotice({
            text: d.type === 'pcp-keyed-save'
              ? `“${name}” is saved against this client and this period.`
              : `“${name}” has been removed.`,
            bad: false,
          }))
          .catch((err) => setNotice({
            text: 'The keyed column was not saved: ' + (err instanceof Error ? err.message : String(err)),
            bad: true,
          }));
        return;
      }

      // A sign-off is somebody putting their name to work having been done:
      // an exception cleared with a reason, or a working paper prepared and
      // reviewed. The reviewer is not the preparer and is not on the same
      // machine, so neither can stay in one browser.
      if (d.type === 'pcp-review-save' && d.key) {
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        void saveReviewSignoffs(cid, d.review ?? {})
          .catch((err) => setNotice({
            text: 'The sign-off was not saved: ' + (err instanceof Error ? err.message : String(err)),
            bad: true,
          }));
        return;
      }
      if (d.type === 'pcp-wp-save' && d.key) {
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        void saveWorkingPapers(cid, d.wp ?? {})
          .catch((err) => setNotice({
            text: 'The working paper was not saved: ' + (err instanceof Error ? err.message : String(err)),
            bad: true,
          }));
        return;
      }

      // The return as filed, keyed beside the file it came on. The VAT screen
      // asks for it; the figures cannot be read out of a tax office PDF.
      if (d.type === 'pcp-vat-filed' && d.key && d.q) {
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        const who = listed.find((c) => c.id === cid);
        setVatFiled({
          clientId: cid,
          clientName: who?.name ?? `Client ${cid}`,
          quarter: String(d.q),
        });
        return;
      }

      // Which sections a client gets, decided on Client setup. The frame has
      // already shown the change; this is what makes it outlast the tab.
      if (d.type === 'pcp-feature' && d.key && d.feature) {
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        const section = String(d.feature);
        const on = d.on === true;
        void setSection(cid, section, on)
          .then(() => {
            // Built before the decision, so it no longer matches.
            blocks.delete(String(d.key));
            void forgetCachedBlock(cid);
          })
          .catch((err) => setNotice({
            text: `${section} was not saved: ` + (err instanceof Error ? err.message : String(err))
              + ' — the switch will read its stored value again on the next sign-in.',
            bad: true,
          }));
        return;
      }

      // “It looks in that folder for changes or updates”. The comparison came
      // across in the payload; this is the button that acts on it.
      if (d.type === 'pcp-read-folder' && d.key) {
        const key = String(d.key);
        const frame = e.source as Window | null;
        const cid = Number(key.replace(/^c/, ''));
        if (!Number.isFinite(cid) || cid <= 0) return;
        const who = listed.find((c) => c.id === cid);
        void (async () => {
          setReading(who?.name ?? String(cid));
          try {
            const r = await readFolder(cid, (step) => {
              setReading(`${who?.name ?? cid} — ${step}`);
              frame?.postMessage({ type: 'pcp-progress', key, text: `${step}…` }, '*');
            });
            const said = r.done.length
              ? `Read ${r.done.length} file${r.done.length === 1 ? '' : 's'}.`
              : 'Nothing was read.';
            const bad = r.failed.length
              ? ` ${r.failed.length} could not be read: ` + r.failed.map((x) => `${x.fileName} (${x.why})`).join('; ')
              : '';
            // What was built no longer includes what has just been read.
            blocks.delete(key);
            void forgetCachedBlock(cid);
            // A file that would not import is news, not a catastrophe: the
            // others went in, and the person is still reading the report. It
            // used to call setError, which unmounted the frame under them.
            setNotice({ text: said + bad, bad: r.failed.length > 0 });
            // What is on screen predates what was just read into the ledger.
            if (r.done.length) frame?.postMessage({ type: 'pcp-refresh', key }, '*');
            frame?.postMessage(
              { type: 'pcp-folder-done', key, text: said + bad, ok: r.failed.length === 0 }, '*',
            );
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            setNotice({ text: 'Could not read the folder: ' + why, bad: true });
            frame?.postMessage(
              { type: 'pcp-folder-done', key, text: 'Could not read the folder: ' + why, ok: false }, '*',
            );
          } finally { setReading(null); }
        })();
        return;
      }

      // “I want to be able to upload data” — on the screen that already says
      // what is loaded, without leaving the report.
      if (d.type === 'pcp-upload' && d.key && d.feed) {
        const f = feedByName(String(d.feed));
        const cid = Number(String(d.key).replace(/^c/, ''));
        if (!f || !Number.isFinite(cid) || cid <= 0) return;
        const who = listed.find((c) => c.id === cid);
        setUpload({
          feed: f, clientId: cid, clientName: who?.name ?? `Client ${cid}`,
          // The reconciliation panel names the month it wants.
          period: typeof d.period === 'string' ? d.period : undefined,
        });
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

  // Only where there is no report to show. This used to catch every error,
  // including one raised by an action taken INSIDE the report — which unmounted
  // the frame, threw the blob away, and put the person back at the template's
  // own sign-in. It read as being signed out, because it was.
  //
  // Anything that happens while the report is open goes to the notice in the
  // footer instead, and the report stays where it is.
  if (error && !url) {
    return (
      <div style={{ padding: 32, maxWidth: 640 }}>
        <div className="alert alert-error"><b>The report could not be built.</b><br />{error}</div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => void build()}>Try again</button>
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
      {vatFiled && (
        <VatFiledDialog
          clientId={vatFiled.clientId}
          clientName={vatFiled.clientName}
          quarter={vatFiled.quarter}
          onClose={() => setVatFiled(null)}
          onSaved={() => {
            const key = 'c' + vatFiled.clientId;
            blocks.delete(key);
            void forgetCachedBlock(vatFiled.clientId);
            const frame = (document.querySelector('iframe') as HTMLIFrameElement | null)
              ?.contentWindow;
            frame?.postMessage({ type: 'pcp-refresh', key }, '*');
            setNotice({ text: `The filed return for ${vatFiled.quarter} is saved.`, bad: false });
          }}
        />
      )}

      {upload && (
        <UploadDialog
          clientId={upload.clientId}
          clientName={upload.clientName}
          feed={upload.feed}
          initialPeriod={upload.period}
          onClose={() => setUpload(null)}
          onLoaded={() => {
            // What was built is now out of date by exactly the file that was
            // just loaded. Both copies go — the tab’s and the stored one — so
            // the next sign-in reads the client again rather than serving a
            // report that predates the import.
            const key = 'c' + upload.clientId;
            blocks.delete(key);
            void forgetCachedBlock(upload.clientId);
            // The frame is showing a report built before this file arrived.
            const frame = (document.querySelector('iframe') as HTMLIFrameElement | null)
              ?.contentWindow;
            frame?.postMessage({ type: 'pcp-refresh', key }, '*');
          }}
        />
      )}

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
        {notice && (
          <span style={{ color: notice.bad ? '#b91c1c' : '#166534' }}>
            {notice.text}
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: 8, padding: '0 6px' }}
              onClick={() => setNotice(null)}
            >dismiss</button>
          </span>
        )}
        {reading && <span style={{ color: '#334155' }}>{reading}…</span>}
      </div>
    </div>
  );
}
