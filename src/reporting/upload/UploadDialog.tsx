// Uploading, on the Data import screen, without leaving the report.
//
// The partner's words: "I want to be able to upload data. It must tell me what
// data is uploaded and allow me to add new data to it. If I upload the same
// month or period or whatever, it must give me a warning and allow me to
// override the old upload."
//
// The template's Data import table already tells him what is loaded. This is
// the other half: its Upload button, answered here.
//
// This is NOT a screen. It is a dialog over the report, it has one job, and
// every way out of it returns to where the person was. The rule in FIX.md — if
// you find yourself writing a screen in React you are building the second
// application again — is about the rail and the reports, and the thing that
// keeps this on the right side of it is that a person can never be left in here.
//
// The order is the order FIX.md sets, and each step earns its place:
//
//   1. pick the file
//   2. ask for the period, because a trial balance and a stock count do not
//      state theirs and nobody can recover them afterwards
//   3. check it BEFORE storing — parse it, fingerprint its accounts against
//      this client's chart, read BTMS's own printed control totals. A file that
//      fails is refused with the reason while the person is still at the
//      machine that exported it, and is never stored
//   4. warn on a repeat, naming the file, when it arrived and who loaded it
//   5. store it in the client's folder, import it, and say what happened

import { useCallback, useEffect, useRef, useState } from 'react';
import { storeInBtmsFolder } from '../lib/import/portalFolder.ts';
import { checkBtmsFile, type FileCheck } from '../lib/import/checkFile.ts';
import { alreadyLoaded, type Already } from './existing.ts';
import { runImport } from './runImport.ts';
import { filedUnderPeriod, periodRequired, periodValue, type Feed } from './feeds.ts';

type Phase = 'pick' | 'checking' | 'checked' | 'repeat' | 'working' | 'done' | 'failed';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function UploadDialog({
  clientId, clientName, feed, onClose, onLoaded,
}: {
  clientId: number;
  clientName: string;
  feed: Feed;
  onClose: () => void;
  onLoaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [period, setPeriod] = useState('');
  const [phase, setPhase] = useState<Phase>('pick');
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [already, setAlready] = useState<Already | null>(null);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Escape closes, as it does on every dialog. Not while it is writing: a
  // half-finished import is not a thing to walk away from by accident.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'working' && phase !== 'checking') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  // Shown wherever there is a period to give; required unless the feed says a
  // blank is honest — a supporting document may not be about a period at all.
  const showPeriod = feed.period !== 'none';
  const stated = periodValue(feed.period, period);
  const ready = !!file && (!periodRequired(feed) || !!stated);

  /** Step 3: parse and check, before anything is stored. */
  const doCheck = useCallback(async () => {
    if (!file) return;
    setPhase('checking'); setError(null);
    try {
      const c = await checkBtmsFile(file, feed.kind as never);
      setCheck(c);
      if (c.verdict === 'blocked') { setPhase('checked'); return; }
      const hit = await alreadyLoaded(clientId, feed.kind, c.period ?? stated);
      if (hit) { setAlready(hit); setPhase('repeat'); return; }
      setPhase('checked');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  }, [file, feed, clientId, stated]);

  /** Steps 5 and 6: store it, then read it. */
  const doLoad = useCallback(async (keepPrior: boolean) => {
    if (!file || !check) return;
    setPhase('working'); setError(null);
    try {
      setStep('Storing the file in the client’s BTMS folder');
      const when = filedUnderPeriod(check.period ?? stated);
      const src = await storeInBtmsFolder(clientId, file, when, feed.kind as never, keepPrior);
      let said = keepPrior
        ? 'Stored beside the file already there.'
        : src.superseded
          ? `Stored, replacing ${src.superseded} earlier ${src.superseded === 1 ? 'copy' : 'copies'}.`
          : 'Stored.';
      if (feed.imported) {
        const r = await runImport(clientId, feed, file, src, stated, (s) => setStep(s));
        said += ' ' + r;
      } else {
        said += ' It is kept with the client for the review; there is no importer for this one yet.';
      }
      setOutcome(said);
      setPhase('done');
      onLoaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  }, [file, check, clientId, feed, stated, onLoaded]);

  const box: React.CSSProperties = {
    background: '#fff', borderRadius: 8, width: 'min(620px, 94vw)',
    maxHeight: '88vh', overflow: 'auto', padding: '18px 20px 16px',
    boxShadow: '0 20px 60px rgba(15,23,42,.28)',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'working') onClose(); }}
    >
      <div style={box} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          {clientName}
        </div>
        <h2 style={{ fontSize: 17, margin: '2px 0 14px' }}>{feed.name}</h2>

        {phase !== 'done' && phase !== 'working' && (
          <>
            <label style={{ display: 'block', fontSize: 12, color: '#475569', marginBottom: 4 }}>
              The file, as BTMS exported it
            </label>
            <input
              ref={fileRef} type="file" className="form-input"
              accept=".xls,.xlsx,.csv,.xml,.pdf"
              disabled={phase === 'checking'}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setCheck(null); setAlready(null); setPhase('pick'); setError(null);
              }}
              style={{ marginBottom: 14, width: '100%' }}
            />

            {showPeriod && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#475569', marginBottom: 4 }}>
                  {feed.ask}
                </label>
                <PeriodInput feed={feed} value={period} onChange={(v) => { setPeriod(v); setCheck(null); setPhase('pick'); }} />
                {feed.period === 'date' && (
                  <p style={{ fontSize: 11, color: '#b45309', margin: '5px 0 0' }}>
                    The count date is nowhere in the file and cannot be worked out later. It is
                    only ever known now.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {phase === 'checking' && <Say>Checking the file against its own totals…</Say>}
        {phase === 'working' && <Say>{step}…</Say>}

        {check && phase === 'checked' && <Verdict check={check} />}

        {phase === 'repeat' && already && check && (
          <div style={{
            border: '1px solid #fde68a', background: '#fffbeb',
            borderRadius: 6, padding: '11px 12px', marginBottom: 12,
          }}>
            <div style={{ fontSize: 13, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>
              {feed.name}{already.period ? `, ${prettyPeriod(already.period)}` : ''} is already loaded
            </div>
            <div style={{ fontSize: 12.5, color: '#78350f' }}>
              <code>{already.fileName}</code>, uploaded{' '}
              {new Date(already.uploadedAt).toLocaleString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              {already.uploadedBy ? ` by ${already.uploadedBy}` : ''}.
            </div>
            <p style={{ fontSize: 11.5, color: '#78350f', margin: '8px 0 0' }}>
              A month re-exported after a correction is normal. Replacing makes this the file the
              app reads and loads this period again; the old one is never deleted — it stays in the
              folder as the record of what was reported at the time.
            </p>
          </div>
        )}

        {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

        {phase === 'done' && (
          <div style={{
            border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 6,
            padding: '11px 12px', marginBottom: 12, fontSize: 13, color: '#166534',
          }}>{outcome}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          {phase === 'done' ? (
            <button className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
          ) : phase === 'repeat' ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-secondary btn-sm" onClick={() => void doLoad(true)}>Keep both</button>
              <button className="btn btn-primary btn-sm" onClick={() => void doLoad(false)}>Replace it</button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" disabled={phase === 'working'} onClick={onClose}>
                Cancel
              </button>
              {check && check.verdict !== 'blocked' && phase === 'checked' ? (
                <button className="btn btn-primary btn-sm" onClick={() => void doLoad(false)}>
                  Store it and load it
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!ready || phase === 'checking' || phase === 'working'}
                  onClick={() => void doCheck()}
                >
                  {phase === 'checking' ? 'Checking…' : 'Check the file'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Say({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px' }}>{children}</p>;
}

/** What the gate found, in the words it found it in. */
function Verdict({ check }: { check: FileCheck }) {
  const bad = check.verdict === 'blocked';
  return (
    <div style={{
      border: '1px solid ' + (bad ? '#fecaca' : '#e2e8f0'),
      background: bad ? '#fef2f2' : '#f8fafc',
      borderRadius: 6, padding: '11px 12px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: bad ? '#b91c1c' : '#0f172a' }}>
        {bad ? 'This file was not stored' : check.label}
      </div>
      <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>{check.summary}</div>
      {check.period && (
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          The file states its own period: <b>{prettyPeriod(check.period)}</b>.
        </div>
      )}
      {!!check.facts.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
          {check.facts.map((f) => (
            <span key={f.label} style={{ fontSize: 11.5, color: '#64748b' }}>
              {f.label} <b style={{ color: '#334155' }}>{f.value}</b>
            </span>
          ))}
        </div>
      )}
      {check.problems.map((p) => (
        <p key={p} style={{ fontSize: 12.5, color: '#b91c1c', margin: '6px 0 0' }}>{p}</p>
      ))}
      {check.warnings.map((w) => (
        <p key={w} style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>{w}</p>
      ))}
    </div>
  );
}

/** Three shapes of period control, because there are three shapes of period. */
function PeriodInput({ feed, value, onChange }: {
  feed: Feed; value: string; onChange: (v: string) => void;
}) {
  const thisYear = new Date().getFullYear();
  if (feed.period === 'date') {
    return (
      <input type="date" className="form-input" value={value}
        onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }} />
    );
  }
  if (feed.period === 'year') {
    return (
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }}>
        <option value="">Choose a year…</option>
        {Array.from({ length: 8 }, (_, i) => thisYear - i).map((y) => (
          <option key={y} value={String(y)}>{y}</option>
        ))}
      </select>
    );
  }
  if (feed.period === 'quarter') {
    // A quarter recorded as the month it ends in, and labelled as the quarter.
    const opts: { v: string; l: string }[] = [];
    for (let y = thisYear; y >= thisYear - 3; y--) {
      for (const m of [12, 9, 6, 3]) {
        opts.push({ v: `${y}-${String(m).padStart(2, '0')}`, l: `Q${m / 3} ${y} (to ${MONTHS[m - 1]})` });
      }
    }
    return (
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 280 }}>
        <option value="">Choose a quarter…</option>
        {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    );
  }
  return (
    <input type="month" className="form-input" value={value}
      onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 220 }} />
  );
}

function prettyPeriod(p: string): string {
  if (/^\d{4}$/.test(p)) return p;
  if (/^\d{4}-\d{2}$/.test(p)) return `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) {
    return new Date(p + 'T00:00:00Z').toLocaleDateString('en-GB',
      { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return p;
}
