// Configure → Data import → payroll.
//
// Two files, together, because §6.4 calls them "two reports, each a check on
// the other". The screen asks for both and will not commit until they agree:
// where the gross, deductions, contributions, net or cost differ, one of the
// two files is wrong, and a wrong payroll cost reaches the client's accounts,
// their IR.7 and their social insurance return at the same time.
//
// The month is not asked for. Both files state it, and they must state the
// same one.

import { useRef, useState } from 'react';
import { storeInBtmsFolder, filedUnder } from '../lib/import/portalFolder.ts';
import {
  preparePayrollImport, commitPayrollImport,
  type PayrollPrepared, type PayrollCommitted,
} from '../lib/import/payrollImport.ts';

const eur = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollPanel({ clientId, onImported }: {
  clientId: number;
  onImported: () => void;
}) {
  const costRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLInputElement>(null);
  const [costFile, setCostFile] = useState<File | null>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PayrollPrepared | null>(null);
  const [committed, setCommitted] = useState<PayrollCommitted | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPrepared(null); setCostFile(null); setSheetFile(null);
    if (costRef.current) costRef.current.value = '';
    if (sheetRef.current) sheetRef.current.value = '';
  };

  const tryPrepare = async (c: File | null, s: File | null) => {
    setError(null); setPrepared(null); setCommitted(null);
    if (!c || !s) return;
    try {
      setPrepared(await preparePayrollImport(clientId, c, s, (step) => setBusy(step)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const commit = async () => {
    if (!costFile || !sheetFile || !prepared) return;
    setError(null);
    try {
      setBusy('Storing both reports in the client’s BTMS folder');
      const filed = filedUnder(prepared.periodMonth);
      const cost = await storeInBtmsFolder(clientId, costFile, filed, 'payroll_cost');
      const sheet = await storeInBtmsFolder(clientId, sheetFile, filed, 'payroll_sheet');
      setCommitted(await commitPayrollImport(
        clientId, costFile, sheetFile, prepared, { cost, sheet }, (s) => setBusy(s)));
      reset();
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const p = prepared;
  const parseRefused = p && (!p.cost.ok || !p.sheet.ok);
  const canCommit = !!p && p.cost.ok && p.sheet.ok && p.periodsAgree && p.reconciliation.agrees;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <strong style={{ fontSize: 13 }}>Payroll</strong>
      <p style={{ color: '#64748b', fontSize: 12.5, margin: '4px 0 12px', maxWidth: 700 }}>
        Both reports, together. They are independent statements of the same month, so each is a
        check on the other — and neither is imported unless they agree.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 12.5 }}>
          <span style={{ display: 'inline-block', width: 130, color: '#64748b' }}>Cost analysis</span>
          <input ref={costRef} type="file" accept=".xls,.xlsx" disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0] ?? null; setCostFile(f); void tryPrepare(f, sheetFile); }} />
        </label>
        <label style={{ fontSize: 12.5 }}>
          <span style={{ display: 'inline-block', width: 130, color: '#64748b' }}>Paysheet listing</span>
          <input ref={sheetRef} type="file" accept=".xls,.xlsx" disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0] ?? null; setSheetFile(f); void tryPrepare(costFile, f); }} />
        </label>
      </div>

      {busy && <p style={{ fontSize: 13, color: '#334155', marginTop: 10 }}>{busy}…</p>}
      {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}

      {(costFile && !sheetFile) || (!costFile && sheetFile) ? (
        <p style={{ fontSize: 12.5, color: '#92400e', marginTop: 10 }}>
          Both files are needed. One alone gives no check at all.
        </p>
      ) : null}

      {p && (
        <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
          {parseRefused && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>A file was refused at the parsing stage.</b><br />
              {[...p.cost.notes, ...p.sheet.notes].map((n) => n.message).join(' ')}
            </div>
          )}

          {!p.periodsAgree && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <b>These two files are for different months.</b> The cost analysis says{' '}
              {p.cost.period || '(none)'} and the paysheet says {p.sheet.period || '(none)'}.
            </div>
          )}

          {p.cost.ok && p.sheet.ok && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <Tile label="Month" value={p.cost.period || '—'} />
                <Tile label="Departments" value={String(p.cost.departments.length)} />
                <Tile label="Employees" value={String(p.sheet.employees.length)} />
                <Tile label="Gross" value={eur(p.cost.totals?.gross[0] ?? 0)} />
                <Tile label="Cost to company" value={eur(p.cost.totals?.cost[0] ?? 0)} />
              </div>

              {/* The check, which is the whole reason both files are asked for. */}
              <div style={{
                marginTop: 14, border: '1px solid ' + (p.reconciliation.agrees ? '#bbf7d0' : '#fca5a5'),
                background: p.reconciliation.agrees ? '#f0fdf4' : '#fef2f2',
                borderRadius: 6, padding: 12,
              }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: p.reconciliation.agrees ? '#166534' : '#b91c1c' }}>
                  {p.reconciliation.agrees
                    ? 'The two reports agree on every line.'
                    : 'The two reports do not agree. Neither will be imported.'}
                </div>
                <table style={{ marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#94a3b8' }}>
                      <th style={{ textAlign: 'left', padding: '2px 14px 2px 0', fontWeight: 500 }} />
                      <th style={{ textAlign: 'right', padding: '2px 14px', fontWeight: 500 }}>Cost analysis</th>
                      <th style={{ textAlign: 'right', padding: '2px 14px', fontWeight: 500 }}>Paysheet</th>
                      <th style={{ textAlign: 'right', padding: '2px 0 2px 14px', fontWeight: 500 }}>Difference</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {p.reconciliation.rows.map((r) => (
                      <tr key={r.what}>
                        <td style={{ padding: '2px 14px 2px 0' }}>{r.what}</td>
                        <td style={{ textAlign: 'right', padding: '2px 14px' }}>{eur(r.analysis)}</td>
                        <td style={{ textAlign: 'right', padding: '2px 14px' }}>{eur(r.paysheet)}</td>
                        <td style={{
                          textAlign: 'right', padding: '2px 0 2px 14px',
                          color: Math.abs(r.diff) < 0.005 ? '#166534' : '#b91c1c', fontWeight: 600,
                        }}>{eur(r.diff)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!canCommit || !!busy} onClick={() => void commit()}>
                  {busy ? 'Working…' : 'Import the payroll'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={reset}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {committed && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          <b>Payroll imported.</b> {committed.periodMonth.slice(0, 7)} —{' '}
          {committed.employees} employees across {committed.departments} departments, gross{' '}
          {eur(committed.gross)}, cost to the company {eur(committed.cost)}. Import #{committed.importId}.
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
