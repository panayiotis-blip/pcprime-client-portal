// Configure → Data import → the stock valuation.
//
// The file states no date, so the operator does — the same as the trial
// balance, and for the same reason: a valuation filed under the wrong date is
// a cost of sales figure that is wrong in two periods at once.
//
// What the screen is really for is the comparison. §6.6: the valuation and the
// stock account rarely agree and the gap changes sign, and it must be resolved
// before a gross margin is reported. So the ledger figure is fetched as soon as
// a date is chosen and shown beside the file's, before anything is committed.

import { useEffect, useRef, useState } from 'react';
import {
  prepareStockImport, commitStockImport, stockPerLedger,
  type StockPrepared, type StockCommitted,
} from '../lib/import/stockImport.ts';

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StockPanel({ clientId, onImported }: {
  clientId: number;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<StockPrepared | null>(null);
  const [committed, setCommitted] = useState<StockCommitted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valuedAt, setValuedAt] = useState('');
  const [ledger, setLedger] = useState<{ value: number; hasOpening: boolean } | null>(null);

  // The ledger figure follows the date, not the file.
  useEffect(() => {
    if (!prepared || !/^\d{4}-\d{2}-\d{2}$/.test(valuedAt)) { setLedger(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const v = await stockPerLedger(clientId, valuedAt);
        if (!cancelled) setLedger({ value: v.value, hasOpening: v.hasOpening });
      } catch { if (!cancelled) setLedger(null); }
    })();
    return () => { cancelled = true; };
  }, [clientId, valuedAt, prepared]);

  const reset = () => {
    setPrepared(null); setFile(null); setValuedAt(''); setLedger(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (f: File | undefined) => {
    setError(null); setPrepared(null); setCommitted(null);
    if (!f) return;
    setFile(f);
    try {
      setPrepared(await prepareStockImport(clientId, f, (s) => setBusy(s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const commit = async () => {
    if (!file || !prepared) return;
    setError(null);
    try {
      setCommitted(await commitStockImport(clientId, file, prepared, valuedAt, (s) => setBusy(s)));
      reset();
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const p = prepared;
  const refused = p?.parse.notes.find((n) => n.kind === 'truncated' || n.kind === 'empty');
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(valuedAt);
  const canCommit = !!p && p.parse.ok && !refused && dated;
  const diff = p && ledger ? Math.round((p.parse.totals.value - ledger.value) * 100) / 100 : null;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <strong style={{ fontSize: 13 }}>Stock valuation</strong>
      <p style={{ color: '#64748b', fontSize: 12.5, margin: '4px 0 12px', maxWidth: 700 }}>
        What the stock was worth at a date. The file does not say which date, so you do. It is
        compared with the stock account in the ledger, which rarely agrees.
      </p>

      <input ref={fileRef} type="file" accept=".xls,.xlsx"
        onChange={(e) => void pick(e.target.files?.[0])} disabled={!!busy} />

      {busy && <p style={{ fontSize: 13, color: '#334155', marginTop: 10 }}>{busy}…</p>}
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {p && (
        <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
          {refused && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>This file cannot be imported.</b><br />{refused.message}
            </div>
          )}

          {p.parse.ok && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <Tile label="Items" value={p.parse.totals.items.toLocaleString('en-GB')} />
                <Tile label="Units" value={p.parse.totals.units.toLocaleString('en-GB')} />
                <Tile label="Value" value={eur(p.parse.totals.value)} />
                <Tile label="Negative lines" value={p.parse.negative.items.toLocaleString('en-GB')} />
              </div>

              {p.parse.footer && (
                <p style={{ fontSize: 12, color: '#166534', margin: '8px 0 0' }}>
                  Agrees with the file's own total of {p.parse.footer.items.toLocaleString('en-GB')} items
                  and {eur(p.parse.footer.value)}.
                </p>
              )}

              {p.parse.negative.items > 0 && (
                <p style={{ fontSize: 12.5, color: '#92400e', margin: '6px 0 0' }}>
                  <b>{p.parse.negative.items}</b> lines carry a negative quantity, worth{' '}
                  <b>{eur(p.parse.negative.value)}</b>. Goods went out that were never booked in, and
                  this is the first place to look when the valuation and the ledger disagree.
                </p>
              )}

              <div style={{
                marginTop: 14, padding: 12, borderRadius: 6,
                border: '1px solid #cbd5e1', background: '#f8fafc',
              }}>
                <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>
                  What date was this stock counted?
                </div>
                <input type="date" className="form-input" value={valuedAt} style={{ marginTop: 8, fontSize: 12.5 }}
                  onChange={(e) => setValuedAt(e.target.value)} />
                {dated && ledger && (
                  <p style={{ fontSize: 12.5, margin: '10px 0 0', color: '#334155' }}>
                    The ledger carries <b>{eur(ledger.value)}</b> on the stock line at that date, against{' '}
                    <b>{eur(p.parse.totals.value)}</b> counted —{' '}
                    <b style={{ color: Math.abs(diff ?? 0) < 0.005 ? '#166534' : '#b91c1c' }}>
                      {eur(diff ?? 0)}
                    </b>{' '}
                    {Math.abs(diff ?? 0) < 0.005 ? 'apart.' : 'out. §6.6: resolve this before reporting a margin.'}
                  </p>
                )}
              </div>

              {p.duplicateOf && (
                <div className="alert alert-warning" style={{ marginTop: 10 }}>
                  This exact file was already imported on{' '}
                  {new Date(p.duplicateOf.uploaded_at).toLocaleDateString('en-GB')}.
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!canCommit || !!busy} onClick={() => void commit()}>
                  {busy ? 'Working…' : 'Import the valuation'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={reset}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {committed && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          <b>Stock imported.</b> {committed.items.toLocaleString('en-GB')} items worth{' '}
          {eur(committed.value)} at {committed.valuedAt}, against {eur(committed.ledgerValue)} in the
          ledger — {eur(committed.difference)} apart. Import #{committed.importId}.
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
