// Configure → Data import → what is in the folder, period by period.
//
// This is the screen the gate exists for. Every file that went into the
// client's BTMS folder was checked against the totals BTMS printed inside it,
// and the verdict was kept. Read back here, a period's worth of staff work can
// be reviewed without opening a single spreadsheet: what was saved, when, by
// whom, whether it agreed with itself, and — the question that actually gets
// asked — what is missing.
//
// Superseded files are shown, quietly. A journal listing re-saved four times
// is four sessions of work, and the fact that the earlier three were replaced
// is part of the history rather than something to hide.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { folderReview, type ReviewRow } from '../lib/import/portalFolder.ts';
import { KIND_LABEL, FEEDS, type DocKind } from '../lib/import/checkFile.ts';

/**
 * What a complete period looks like. The chart is not here: it is not monthly,
 * it changes rarely, and a period is not incomplete for want of a new one.
 */
const EXPECTED: DocKind[] = ['ledger', 'trial_balance'];

const VERDICT = {
  ok: { ink: '#166534', bg: '#f0fdf4', label: 'passed' },
  warning: { ink: '#92400e', bg: '#fffbeb', label: 'passed, with a note' },
  blocked: { ink: '#b91c1c', bg: '#fef2f2', label: 'refused' },
} as const;

/** A file's period, reduced to the month it belongs to for grouping. */
function bucket(period: string | null): string {
  if (!period) return 'No period';
  // A listing spanning months is filed under the month it ends in: that is the
  // session it came from, which is what a reviewer is looking for.
  const parts = period.split(/\s+to\s+/);
  const last = parts[parts.length - 1].trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(last) ? last : period;
}

export default function FolderReviewPanel({ clientId }: { clientId: number }) {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReplaced, setShowReplaced] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      setRows(await folderReview(clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const periods = useMemo(() => {
    const all = (rows ?? []).filter((r) => showReplaced || !r.superseded);
    const by = new Map<string, ReviewRow[]>();
    for (const r of all) {
      const k = bucket(r.period);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows, showReplaced]);

  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  if (rows === null && busy) {
    return <p style={{ fontSize: 12.5, color: '#94a3b8' }}>Reading the folder review…</p>;
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>What is in the folder</strong>
        <span style={{ fontSize: 12, color: '#64748b' }}>period by period, with what each file proved</span>
        <label style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>
          <input type="checkbox" checked={showReplaced}
            onChange={(e) => setShowReplaced(e.target.checked)} style={{ marginRight: 5 }} />
          show replaced copies
        </label>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void load()}>
          {busy ? 'Working…' : 'Refresh'}
        </button>
      </div>

      <p style={{ color: '#64748b', fontSize: 12.5, margin: '6px 0 0', maxWidth: 720 }}>
        Every file was checked against the totals BTMS printed inside it when it was saved, and the
        verdict is what you are reading — not a fresh opinion formed today. A period with a journal
        listing and a trial balance that both passed has nothing left to prove.
      </p>

      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}

      {rows !== null && periods.length === 0 && (
        <p style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 12 }}>
          Nothing has been saved into this client's BTMS folder yet.
        </p>
      )}

      {periods.map(([period, files]) => {
        const present = new Set(files.filter((f) => f.verdict !== 'blocked').map((f) => f.kind));
        const missing = EXPECTED.filter((k) => !present.has(k));
        const trouble = files.filter((f) => f.verdict !== 'ok').length;
        const isOpen = open.has(period);
        return (
          <div key={period} style={{ marginTop: 10, border: '1px solid #f1f5f9', borderRadius: 5 }}>
            <button
              onClick={() => toggle(period)}
              style={{
                display: 'flex', width: '100%', gap: 10, alignItems: 'baseline', flexWrap: 'wrap',
                padding: '8px 10px', background: '#fcfcfd', border: 'none', cursor: 'pointer',
                textAlign: 'left', borderRadius: 5,
              }}
            >
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{isOpen ? '▾' : '▸'}</span>
              <strong style={{ fontSize: 12.5, fontFamily: 'ui-monospace, monospace' }}>{period}</strong>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </span>
              {missing.length > 0 && (
                <span style={{ fontSize: 12, color: '#92400e' }}>
                  no {missing.map((k) => KIND_LABEL[k].toLowerCase()).join(', no ')}
                </span>
              )}
              {trouble > 0 && (
                <span style={{ fontSize: 12, color: '#b91c1c' }}>{trouble} to look at</span>
              )}
              {missing.length === 0 && trouble === 0 && (
                <span style={{ fontSize: 12, color: '#166534' }}>complete</span>
              )}
            </button>

            {isOpen && files.map((f) => {
              const v = VERDICT[f.verdict];
              const facts = Object.entries(f.facts);
              return (
                <div key={f.documentId} style={{
                  padding: '8px 10px', borderTop: '1px solid #f8fafc',
                  opacity: f.superseded ? 0.55 : 1,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase',
                      color: v.ink, background: v.bg, padding: '1px 5px', borderRadius: 3,
                    }}>{v.label}</span>
                    <span style={{ fontSize: 12.5 }}>{f.fileName}</span>
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
                      {KIND_LABEL[f.kind] ?? f.kind}
                    </span>
                    {f.superseded && (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>· replaced by a later save</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#cbd5e1' }}>
                      {new Date(f.uploadedAt).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {facts.length > 0 && (
                    <div style={{
                      display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 5,
                      fontSize: 11.5, color: '#334155',
                    }}>
                      {facts.map(([k, val]) => (
                        <span key={k}>
                          <span style={{ color: '#94a3b8' }}>{k}</span>{' '}
                          <b style={{ fontFamily: 'ui-monospace, monospace' }}>{String(val)}</b>
                        </span>
                      ))}
                    </div>
                  )}

                  {f.problems.map((t, i) => (
                    <p key={i} style={{ fontSize: 11.5, color: '#b91c1c', margin: '4px 0 0' }}>{t}</p>
                  ))}
                  {f.warnings.map((t, i) => (
                    <p key={i} style={{ fontSize: 11.5, color: '#92400e', margin: '4px 0 0' }}>{t}</p>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}

      {rows !== null && rows.some((r) => !FEEDS.includes(r.kind)) && (
        <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 10 }}>
          Bank statements and other evidence are listed too. They are kept with the client but never
          parsed — there is no control total to check a statement against, so nothing here claims
          otherwise.
        </p>
      )}
    </div>
  );
}
