// Configure → Data import → the chart of accounts.
//
// Two steps like every other feed: a file is read and checked, what it will do
// is stated, and only then can it be written. What it will do is the part that
// matters here — a chart import is not a replacement. It adds and it updates,
// and it never removes an account, because postings reference codes as text and
// a removed account would leave six years of them pointing at nothing.

import { useCallback, useRef, useState } from 'react';
import {
  prepareChartImport, commitChartImport,
  type ChartPrepared, type ChartCommitted,
} from '../lib/import/chartImport.ts';

export default function ChartImportPanel({
  clientId, clientName, onImported,
}: {
  clientId: number;
  clientName: string;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [prepared, setPrepared] = useState<ChartPrepared | null>(null);
  const [committed, setCommitted] = useState<ChartCommitted | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onProgress = useCallback((step: string, done?: number, total?: number) => {
    setBusy(step);
    setProgress(done !== undefined && total !== undefined ? { done, total } : null);
  }, []);

  const reset = () => {
    setPrepared(null); setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (f: File | undefined) => {
    setError(null); setPrepared(null); setCommitted(null);
    if (!f) return;
    setFile(f);
    try {
      setPrepared(await prepareChartImport(clientId, f, onProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProgress(null); }
  };

  const commit = async () => {
    if (!file || !prepared) return;
    setError(null);
    try {
      setCommitted(await commitChartImport(clientId, file, prepared, onProgress));
      reset();
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProgress(null); }
  };

  const p = prepared;
  const refused = p?.parse.notes.find(
    (n) => n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty',
  );
  const canCommit = !!p && p.parse.ok && p.fingerprint.accepted && !refused;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <strong style={{ fontSize: 13 }}>Chart of accounts</strong>
      <p style={{ color: '#64748b', fontSize: 12.5, margin: '4px 0 12px', maxWidth: 700 }}>
        BTMS's account list, exported as XLS. It defines every account — its type, whether it is a
        section heading, and the report category that seeds the mapping. Importing it never removes
        an account: accounts it does not mention are left alone and reported.
      </p>

      <input
        ref={fileRef} type="file" accept=".xls,.xlsx"
        onChange={(e) => void pick(e.target.files?.[0])}
        disabled={!!busy}
      />

      {busy && (
        <p style={{ fontSize: 13, color: '#334155', marginTop: 10 }}>
          {busy}
          {progress ? ` — ${progress.done.toLocaleString('en-GB')} of ${progress.total.toLocaleString('en-GB')}` : '…'}
        </p>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {p && (
        <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            {p.fileName} · {(p.fileSize / 1024 / 1024).toFixed(1)} MB · sha256 {p.checksum.slice(0, 12)}…
          </div>

          {refused && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>This file cannot be imported.</b><br />{refused.message}
            </div>
          )}

          {!p.fingerprint.accepted && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>This chart does not belong to {clientName}.</b><br />{p.fingerprint.reason}
              {p.fingerprint.unknownSample.length > 0 && (
                <div style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  unknown codes: {p.fingerprint.unknownSample.join(', ')}
                </div>
              )}
            </div>
          )}

          {p.parse.ok && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <Tile label="Accounts" value={p.parse.accounts.length.toLocaleString('en-GB')} />
                <Tile label="Nominal" value={p.parse.counts.nominal.toLocaleString('en-GB')} />
                <Tile label="Sub-ledger" value={p.parse.counts.subLedger.toLocaleString('en-GB')} />
                <Tile label="Headings" value={String(p.parse.counts.headers)} />
                <Tile label="New" value={p.added.toLocaleString('en-GB')} />
                <Tile label="Changed" value={p.changed.toLocaleString('en-GB')} />
              </div>

              <p style={{ fontSize: 12.5, marginTop: 10, color: '#475569' }}>
                {Object.entries(p.parse.counts.byType)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => `${n.toLocaleString('en-GB')} ${t.toLowerCase()}`)
                  .join(' · ')}
                .
              </p>

              <p style={{ fontSize: 12.5, color: '#475569', margin: '6px 0 0' }}>
                The client holds <b>{p.heldBefore.toLocaleString('en-GB')}</b> accounts.
                This adds <b>{p.added.toLocaleString('en-GB')}</b> and updates{' '}
                <b>{p.changed.toLocaleString('en-GB')}</b>.
                {p.absent > 0 && (
                  <> <b>{p.absent.toLocaleString('en-GB')}</b> held accounts are not in this file; they
                    are left exactly as they are, because postings still refer to them.</>
                )}
                {' '}{p.fingerprint.reason}
              </p>

              {p.parse.reportedRecords !== null && (
                <p style={{ fontSize: 12, color: '#166534', margin: '6px 0 0' }}>
                  The file's own count says {p.parse.reportedRecords.toLocaleString('en-GB')} accounts, and
                  that is what was read.
                </p>
              )}

              {p.parse.notes.filter((n) => n.kind === 'unparsable-row').map((n, i) => (
                <p key={i} style={{ fontSize: 12, color: '#92400e', margin: '6px 0 0' }}>{n.message}</p>
              ))}

              {p.duplicateOf && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  This exact file was already imported on{' '}
                  {new Date(p.duplicateOf.uploaded_at).toLocaleDateString('en-GB')} as{' '}
                  {p.duplicateOf.original_filename}.
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!canCommit || !!busy} onClick={() => void commit()}>
                  {busy ? 'Working…' : 'Import the chart'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={reset}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {committed && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          <b>Chart imported.</b> {committed.written.toLocaleString('en-GB')} accounts written —{' '}
          {committed.added.toLocaleString('en-GB')} new, {committed.changed.toLocaleString('en-GB')} updated.
          Import #{committed.importId}.
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 5, padding: '8px 10px' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
