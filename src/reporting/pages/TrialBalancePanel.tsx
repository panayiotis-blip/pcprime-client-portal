// Configure → Data import → the trial balance.
//
// The one screen in this application that asks a person for something the file
// does not contain. A trial balance carries no date anywhere inside it, so the
// period is chosen here and stated back before anything is written. The file
// name is not consulted: "a&f tb 07 2026" is a claim, and a claim about which
// period a set of opening balances belongs to is exactly the kind that is
// expensive to get wrong and invisible afterwards.

import { useRef, useState } from 'react';
import { storeInBtmsFolder, filedUnder } from '../lib/import/portalFolder.ts';
import {
  prepareTrialBalanceImport, commitTrialBalanceImport,
  type TbPrepared, type TbCommitted,
} from '../lib/import/trialBalanceImport.ts';

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function TrialBalancePanel({
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
  const [prepared, setPrepared] = useState<TbPrepared | null>(null);
  const [committed, setCommitted] = useState<TbCommitted | null>(null);
  const [error, setError] = useState<string | null>(null);

  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(1);
  const [isAnnual, setIsAnnual] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const periodMonth = `${year}-${String(isAnnual ? 12 : month).padStart(2, '0')}-01`;

  const onProgress = (step: string, done?: number, total?: number) => {
    setBusy(step);
    setProgress(done !== undefined && total !== undefined ? { done, total } : null);
  };

  const reset = () => {
    setPrepared(null); setFile(null); setConfirmed(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (f: File | undefined) => {
    setError(null); setPrepared(null); setCommitted(null); setConfirmed(false);
    if (!f) return;
    setFile(f);
    try {
      setPrepared(await prepareTrialBalanceImport(clientId, f, onProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProgress(null); }
  };

  const commit = async () => {
    if (!file || !prepared) return;
    setError(null);
    try {
      onProgress('Storing the file in the client’s BTMS folder');
      const src = await storeInBtmsFolder(clientId, file, filedUnder(periodMonth), 'trial_balance');
      setCommitted(await commitTrialBalanceImport(
        clientId, file, prepared, src, { periodMonth, isAnnual }, onProgress));
      reset();
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); setProgress(null); }
  };

  const p = prepared;
  const refused = p?.parse.notes.find(
    (n) => n.kind === 'truncated' || n.kind === 'wrong-export' || n.kind === 'empty');
  const canCommit = !!p && p.parse.ok && p.fingerprint.accepted && !refused
    && p.agreesWithReportTotal && confirmed;

  const periodLabel = isAnnual ? `year ended December ${year}` : `${MONTHS[month - 1]} ${year}`;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <strong style={{ fontSize: 13 }}>Trial balance</strong>
      <p style={{ color: '#64748b', fontSize: 12.5, margin: '4px 0 12px', maxWidth: 700 }}>
        The position at a date, which is what the balance sheet needs and a journal listing cannot
        give. The file carries no date inside it, so you say which period it is — the file name is
        not read.
      </p>

      <input ref={fileRef} type="file" accept=".xls,.xlsx"
        onChange={(e) => void pick(e.target.files?.[0])} disabled={!!busy} />

      {busy && (
        <p style={{ fontSize: 13, color: '#334155', marginTop: 10 }}>
          {busy}{progress ? ` — ${progress.done.toLocaleString('en-GB')} of ${progress.total.toLocaleString('en-GB')}` : '…'}
        </p>
      )}

      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {p && (
        <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            {p.fileName} · {(p.fileSize / 1024).toFixed(0)} KB · sha256 {p.checksum.slice(0, 12)}…
          </div>

          {refused && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>This file cannot be imported.</b><br />{refused.message}
            </div>
          )}

          {!p.fingerprint.accepted && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>This trial balance does not belong to {clientName}.</b><br />{p.fingerprint.reason}
            </div>
          )}

          {!p.agreesWithReportTotal && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>The parse does not agree with the file's own Report Total.</b> It will not be
              committed: an opening balance read short is worse than none at all.
            </div>
          )}

          {p.parse.ok && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                <Tile label="Accounts" value={p.parse.rows.length.toLocaleString('en-GB')} />
                <Tile label="Debits" value={eur(p.totals.debit)} />
                <Tile label="Credits" value={eur(p.totals.credit)} />
                <Tile label="Sum of closing" value={eur(p.totals.closing)} />
              </div>

              <p style={{ fontSize: 12.5, marginTop: 10, color: '#475569' }}>
                {p.parse.detailed
                  ? 'Debtors and creditors are listed individually in this export.'
                  : 'Debtors and creditors appear as control totals in this export.'}
                {' '}{p.parse.reportTotal && p.agreesWithReportTotal && (
                  <span style={{ color: '#166534' }}>
                    Agrees with the file's own Report Total of {p.parse.reportTotal.records.toLocaleString('en-GB')} records.
                  </span>
                )}
              </p>

              {Math.abs(p.totals.closing) >= 0.005 && (
                <p style={{ fontSize: 12.5, color: '#92400e', margin: '6px 0 0' }}>
                  The closing balances sum to <b>{eur(p.totals.closing)}</b> rather than nil. That is
                  the trial balance not balancing, which is a fact about the books and not about this
                  import — it is carried in as it stands.
                </p>
              )}

              {/* ---- the period, which the file does not know ---- */}
              <div style={{
                marginTop: 14, padding: 12, borderRadius: 6,
                border: '1px solid #cbd5e1', background: '#f8fafc',
              }}>
                <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>
                  Which period is this?
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12.5 }}>
                    <input type="checkbox" checked={isAnnual}
                      onChange={(e) => { setIsAnnual(e.target.checked); setConfirmed(false); }} />
                    {' '}Year end
                  </label>
                  {!isAnnual && (
                    <select className="form-input" style={{ fontSize: 12 }} value={month}
                      onChange={(e) => { setMonth(Number(e.target.value)); setConfirmed(false); }}>
                      {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                    </select>
                  )}
                  <select className="form-input" style={{ fontSize: 12 }} value={year}
                    onChange={(e) => { setYear(Number(e.target.value)); setConfirmed(false); }}>
                    {Array.from({ length: 12 }, (_, i) => thisYear - i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <label style={{ display: 'block', marginTop: 10, fontSize: 12.5 }}>
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  {' '}These are the balances for <b>{periodLabel}</b>
                </label>
              </div>

              {p.duplicateOf && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  This exact file was already imported on{' '}
                  {new Date(p.duplicateOf.uploaded_at).toLocaleDateString('en-GB')} as {p.duplicateOf.original_filename}.
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!canCommit || !!busy} onClick={() => void commit()}>
                  {busy ? 'Working…' : 'Import the trial balance'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={reset}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {committed && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          <b>Trial balance imported.</b> {committed.rows.toLocaleString('en-GB')} accounts for{' '}
          {committed.isAnnual ? 'year ended ' : ''}{committed.periodMonth.slice(0, 7)}
          {committed.detailed ? ', debtors and creditors in detail' : ''}
          {committed.replaced > 0 && `, replacing ${committed.replaced.toLocaleString('en-GB')}`}.
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
