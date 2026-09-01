// The VAT return as filed.
//
// The template's Attach button used to take a file, write its name into browser
// storage, and say the figures would be read "on the next import run". So the
// return was never anywhere, and the comparison the whole screen exists for
// could not happen.
//
// The five boxes are KEYED rather than parsed, and that is deliberate. A filed
// return is usually the PDF the tax office gave back; there is nothing in it
// this application can read, and pretending otherwise would mean either a
// parser that works on one form and silently mis-reads the next, or a screen
// that waits for a file it can never understand. The file is the evidence for
// what was keyed, not the source of it — which is why it is attached beside the
// figures and kept in the client's folder like everything else.
//
// Box 3 and box 5 are computed, not asked: 3 is 1 + 2 and 5 is 3 − 4. A person
// keying five numbers off a return can transpose one, and the two that follow
// arithmetically should not be a second chance to do it.

import { useCallback, useEffect, useState } from 'react';
import { storeInBtmsFolder } from '../lib/import/portalFolder.ts';
import { commitVatReturn } from '../lib/import/vatImport.ts';
import { filedUnderPeriod } from './feeds.ts';

/** '2026 Q2' → '2026-06', the month the quarter ends in. */
export function quarterToPeriod(q: string): string | null {
  const m = q.match(/^(\d{4})\s*Q([1-4])$/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2]) * 3).padStart(2, '0')}`;
}

const money = (v: string) => {
  const n = Number(v.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function VatFiledDialog({
  clientId, clientName, quarter, onClose, onSaved,
}: {
  clientId: number;
  clientName: string;
  quarter: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [box1, setBox1] = useState('');
  const [box2, setBox2] = useState('');
  const [box4, setBox4] = useState('');
  const [prior1, setPrior1] = useState('');
  const [prior4, setPrior4] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const period = quarterToPeriod(quarter);
  const b1 = money(box1), b2 = money(box2), b4 = money(box4);
  const b3 = r2(b1 + b2), b5 = r2(b3 - b4);
  const p1 = money(prior1), p4 = money(prior4);
  const ready = !!period && (box1.trim() !== '' || box4.trim() !== '');

  const save = useCallback(async () => {
    if (!period) return;
    setBusy('Saving the return'); setError(null);
    try {
      let source = null;
      if (file) {
        setBusy('Storing the return in the client’s BTMS folder');
        source = await storeInBtmsFolder(
          clientId, file, filedUnderPeriod(period), 'vat_return' as never,
        );
      }
      setBusy('Saving the figures');
      await commitVatReturn(
        clientId, file, period,
        { box1: b1, box2: b2, box3: b3, box4: b4, box5: b5 },
        source,
        { box1: p1, box4: p4, box5: r2(p1 - p4) },
      );
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [period, file, clientId, b1, b2, b3, b4, b5, p1, p4, onSaved, onClose]);

  const field = (label: string, value: string, set: (v: string) => void, hint?: string) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#475569', marginBottom: 3 }}>
        {label}
        {hint && <span style={{ color: '#94a3b8' }}> — {hint}</span>}
      </label>
      <input
        className="form-input" value={value} inputMode="decimal" disabled={!!busy}
        onChange={(e) => set(e.target.value)} style={{ maxWidth: 200, textAlign: 'right' }}
        placeholder="0,00"
      />
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        style={{
          background: '#fff', borderRadius: 8, width: 'min(560px, 94vw)', maxHeight: '88vh',
          overflow: 'auto', padding: '18px 20px 16px', boxShadow: '0 20px 60px rgba(15,23,42,.28)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          {clientName}
        </div>
        <h2 style={{ fontSize: 17, margin: '2px 0 4px' }}>The VAT return as filed — {quarter}</h2>
        <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 14px' }}>
          What was actually submitted, so the screen can set it against what the ledger rebuilds
          and what BTMS computed. The figures are keyed: a filed return is usually a PDF, and the
          file is the evidence for what was keyed rather than something this app can read.
        </p>

        {!period && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            {quarter} is not a quarter this can file against.
          </div>
        )}

        {field('Box 1 — VAT due on sales', box1, setBox1)}
        {field('Box 2 — VAT due on EU acquisitions', box2, setBox2, 'usually nil')}
        {field('Box 4 — VAT reclaimed on purchases', box4, setBox4)}

        <div style={{
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
          padding: '8px 10px', margin: '4px 0 14px', fontSize: 12.5, color: '#475569',
        }}>
          Box 3 <b>{b3.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</b> and box 5{' '}
          <b>{b5.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</b> follow from those —
          3 is 1 plus 2, and 5 is 3 less 4.
        </div>

        <p style={{ fontSize: 12, color: '#475569', margin: '0 0 6px', fontWeight: 600 }}>
          Prior-period items included in this return
        </p>
        <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 8px' }}>
          Anything posted late and swept into this filing. Leave blank if none.
        </p>
        {field('Output tax, prior periods', prior1, setPrior1)}
        {field('Input tax, prior periods', prior4, setPrior4)}

        <label style={{ display: 'block', fontSize: 12, color: '#475569', margin: '8px 0 3px' }}>
          The return itself <span style={{ color: '#94a3b8' }}>(optional)</span>
        </label>
        <input
          type="file" className="form-input" accept=".pdf,.xls,.xlsx,.csv" disabled={!!busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ width: '100%', marginBottom: 12 }}
        />

        {busy && <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px' }}>{busy}…</p>}
        {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!ready || !!busy} onClick={() => void save()}>
            Save the return
          </button>
        </div>
      </div>
    </div>
  );
}
