// Configure -> Data import. BUILD.md §8 and §7.
//
// Two steps, always: a file is read and checked, what it will do is stated,
// and only then can it be committed. Nothing about a file is taken on trust —
// not which client it belongs to, not how much of it BTMS actually exported.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useReportingSession } from '../session';
import {
  prepareLedgerImport, commitLedgerImport,
  type Prepared, type Committed,
} from '../lib/import/ledgerImport.ts';

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

type Feed = { feed: string; last_file: string | null; uploaded_at: string | null; covers_to: string | null };

/** Which BTMS company holds this client's books (migration 193). */
type Btms = { code: string | null; name: string | null };

export default function DataImport() {
  const { client } = useReportingSession();
  const clientId = client!.id;

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowLoss, setAllowLoss] = useState(false);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [btms, setBtms] = useState<Btms | null>(null);

  const loadFeeds = useCallback(async () => {
    const { data } = await supabase.schema('reporting')
      .from('feed_status').select('feed, last_file, uploaded_at, covers_to').eq('client_id', clientId);
    setFeeds((data ?? []) as Feed[]);
  }, [clientId]);

  useEffect(() => { void loadFeeds(); }, [loadFeeds]);

  // Read fresh rather than carried in the session: the session holds the
  // register's identity, and this is BTMS's, which is a different name for the
  // same company and must never be a stale copy of one.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.schema('reporting')
        .from('client_settings').select('btms_company_code, btms_company_name')
        .eq('client_id', clientId).maybeSingle();
      const r = data as { btms_company_code: string | null; btms_company_name: string | null } | null;
      setBtms({ code: r?.btms_company_code ?? null, name: r?.btms_company_name ?? null });
    })();
  }, [clientId]);

  const onProgress = (step: string, done?: number, total?: number) => {
    setBusy(step);
    setProgress(done !== undefined && total !== undefined ? { done, total } : null);
  };

  const pick = async (f: File | undefined) => {
    setError(null); setPrepared(null); setCommitted(null); setAllowLoss(false);
    if (!f) return;
    setFile(f);
    try {
      const p = await prepareLedgerImport(clientId, f, onProgress);
      setPrepared(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProgress(null); }
  };

  const commit = async () => {
    if (!file || !prepared) return;
    setError(null);
    try {
      const res = await commitLedgerImport(clientId, file, prepared, { allowLoss }, onProgress);
      setCommitted(res);
      setPrepared(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await loadFeeds();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProgress(null); }
  };

  const p = prepared;
  // Every kind that means the file must not be committed. A journal that does
  // not agree to its own control total belongs here: it is the signature of a
  // part-exported or hand-edited file, and the figures beneath it are wrong.
  const refusedNote = p?.parse.notes.find((n) =>
    n.kind === 'truncated' || n.kind === 'wrong-export' ||
    n.kind === 'empty' || n.kind === 'account-total-mismatch');
  const unpostedNote = p?.parse.notes.find((n) => n.kind === 'unposted-journals');
  const canCommit = !!p && p.parse.ok && p.fingerprint.accepted && !refusedNote && (!p.wouldLose || allowLoss);

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 2px' }}>Data import</h1>
      <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 14px' }}>
        The analytical journal listing, exported from BTMS as <b>Microsoft Excel 97-2000 — Data only (XLS)</b>,
        sorted by account and grouped by none.
      </p>

      {/* Which company to export FROM. The ledger file names no client anywhere
          inside it, so the moment to get this right is in BTMS, before the export
          — not here, where only the account codes can tell one client from
          another. BUILD.md §7.2. */}
      {btms && (
        <div style={{
          border: '1px solid #e2e8f0', borderLeft: '3px solid #0f172a', borderRadius: 6,
          padding: '10px 14px', marginBottom: 20, fontSize: 13, background: '#fff',
        }}>
          {btms.name || btms.code ? (
            <>
              <div style={{ color: '#64748b', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                Export from this BTMS company
              </div>
              <div style={{ fontWeight: 600, marginTop: 3 }}>
                {btms.name ?? '—'}
                {btms.code && (
                  <span style={{
                    fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 400,
                    background: '#f1f5f9', color: '#334155', padding: '2px 6px',
                    borderRadius: 3, marginLeft: 8,
                  }}>{btms.code}</span>
                )}
              </div>
              {btms.name && btms.name.trim().toLowerCase() !== client!.name.trim().toLowerCase() && (
                <div style={{ color: '#64748b', marginTop: 4 }}>
                  BTMS spells this company differently from the register, which holds it as{' '}
                  <b>{client!.name}</b>. Both are this client.
                </div>
              )}
              {!btms.code && (
                <div style={{ color: '#64748b', marginTop: 4 }}>
                  No BTMS company code is recorded, so the name above is all there is to go on.
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#64748b' }}>
              Which BTMS company holds <b>{client!.name}</b>'s books has not been recorded. The ledger
              file carries no client name inside it, so nothing here can confirm you exported the right
              company — only the account codes in the file will, once this client has some.
            </div>
          )}
        </div>
      )}

      {/* ---- the feeds this client has ---- */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
        <strong style={{ fontSize: 13 }}>Feeds</strong>
        {feeds.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 0' }}>Nothing imported yet.</p>}
        {feeds.map((f) => (
          <div key={f.feed} style={{ display: 'flex', gap: 12, fontSize: 13, marginTop: 8, alignItems: 'baseline' }}>
            <span style={{ minWidth: 150, fontWeight: 500 }}>{f.feed.replace(/_/g, ' ')}</span>
            <span style={{ color: '#64748b' }}>{f.last_file}</span>
            <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>
              covers to {f.covers_to ? monthLabel(f.covers_to) : '—'}
              {f.uploaded_at && ` · uploaded ${new Date(f.uploaded_at).toLocaleDateString('en-GB')}`}
            </span>
          </div>
        ))}
      </div>

      <input
        ref={fileRef} type="file" accept=".xls,.xlsx"
        onChange={(e) => void pick(e.target.files?.[0])}
        disabled={!!busy}
      />

      {busy && (
        <p style={{ fontSize: 13, color: '#334155', marginTop: 12 }}>
          {busy}{progress ? ` — ${progress.done.toLocaleString('en-GB')} of ${progress.total.toLocaleString('en-GB')}` : '…'}
        </p>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 14 }}>{error}</div>}

      {/* ---- what the file is, before anything is written ---- */}
      {p && (
        <div style={{ marginTop: 18, border: '1px solid #e2e8f0', borderRadius: 6, padding: 16 }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
            {p.fileName} · {(p.fileSize / 1024 / 1024).toFixed(1)} MB · sha256 {p.checksum.slice(0, 12)}…
          </div>

          {refusedNote && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              <b>This file cannot be imported.</b><br />{refusedNote.message}
            </div>
          )}

          {!p.fingerprint.accepted && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              <b>This file does not belong to {client!.name}.</b><br />
              {p.fingerprint.reason}
              {p.fingerprint.unknownSample.length > 0 && (
                <div style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  unknown codes: {p.fingerprint.unknownSample.join(', ')}
                </div>
              )}
            </div>
          )}

          {p.parse.ok && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <Tile label="Postings" value={p.parse.postings.length.toLocaleString('en-GB')} />
                <Tile label="Accounts" value={p.parse.accounts.length.toLocaleString('en-GB')} />
                <Tile label="Months" value={String(p.parse.monthsCovered.length)} />
                <Tile label="Debits" value={eur(p.parse.totals.debit)} />
                <Tile label="Credits" value={eur(p.parse.totals.credit)} />
              </div>

              <p style={{ fontSize: 13, marginTop: 12 }}>
                {p.parse.monthsCovered.length > 0 && (
                  <>Covers <b>{monthLabel(p.parse.monthsCovered[0])}</b> to{' '}
                    <b>{monthLabel(p.parse.monthsCovered.at(-1)!)}</b>. </>
                )}
                {Math.abs(p.parse.totals.debit - p.parse.totals.credit) < 0.005
                  ? <span style={{ color: '#166534' }}>Debits equal credits.</span>
                  : <span style={{ color: '#b91c1c' }}>
                      Out of balance by {eur(p.parse.totals.debit - p.parse.totals.credit)} — the export is incomplete.
                    </span>}
              </p>

              <p style={{ fontSize: 13, color: '#475569' }}>
                Committing replaces <b>{p.wouldReplace.toLocaleString('en-GB')}</b> postings already held for those
                months with the <b>{p.parse.postings.length.toLocaleString('en-GB')}</b> in this file.
                {' '}{p.fingerprint.reason}
              </p>

              {/* Not a refusal — the figures are usable, but a person should
                  know they can still move under them. */}
              {unpostedNote && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  {unpostedNote.message}
                </div>
              )}

              {p.duplicateOf && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  This exact file was already imported on{' '}
                  {new Date(p.duplicateOf.uploaded_at).toLocaleDateString('en-GB')} as {p.duplicateOf.original_filename}.
                </div>
              )}

              {p.wouldLose && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  <b>This file carries fewer postings than it would replace.</b> That is what a
                  part-exported file looks like — BTMS paginates, and an export can capture one page.
                  Check the file covers the whole period before overriding.
                  <label style={{ display: 'block', marginTop: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={allowLoss} onChange={(e) => setAllowLoss(e.target.checked)} />
                    {' '}I have checked it, replace them anyway
                  </label>
                </div>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary" disabled={!canCommit || !!busy} onClick={() => void commit()}>
                  {busy ? 'Working…' : 'Import into the ledger'}
                </button>
                <button className="btn btn-secondary" disabled={!!busy}
                  onClick={() => { setPrepared(null); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {committed && (
        <div className="alert alert-success" style={{ marginTop: 18 }}>
          <b>Imported.</b> {committed.postingsAdded.toLocaleString('en-GB')} postings across{' '}
          {committed.monthsReplaced} month{committed.monthsReplaced === 1 ? '' : 's'}, replacing{' '}
          {committed.postingsRemoved.toLocaleString('en-GB')}. Import #{committed.importId}.
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
