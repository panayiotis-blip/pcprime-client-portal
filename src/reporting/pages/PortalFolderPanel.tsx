// Configure → Data import → the client's BTMS data folder, in the portal.
//
// Upload the exports here and they live with the client: on any machine, backed
// up with everything else, and belonging to that client by construction. The
// folder is the identity — nothing is typed into a file name, so nothing can be
// mistyped, which is what the BTMS company code was meant to guard against and
// what no BTMS export actually carries.
//
// The upload asks for the period, because two of the six feeds carry no date
// anywhere inside them. Asked once, beside the file, and kept with it — rather
// than guessed from a name at import time, months later, by somebody else.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReportingSession } from '../session';
import {
  listBtmsFolder, uploadToBtmsFolder, fileFromPortal, type PortalFile,
} from '../lib/import/portalFolder.ts';
import type { FeedKind } from '../lib/import/folder.ts';
import { prepareLedgerImport, commitLedgerImport } from '../lib/import/ledgerImport.ts';
import { prepareChartImport, commitChartImport } from '../lib/import/chartImport.ts';
import { prepareTrialBalanceImport, commitTrialBalanceImport } from '../lib/import/trialBalanceImport.ts';
import { prepareStockImport, commitStockImport } from '../lib/import/stockImport.ts';
import { preparePayrollImport, commitPayrollImport } from '../lib/import/payrollImport.ts';

const LABEL: Record<FeedKind, string> = {
  chart: 'Chart of accounts',
  ledger: 'Journal listing',
  trial_balance: 'Trial balance',
  stock: 'Stock valuation',
  payroll_cost: 'Payroll — cost analysis',
  payroll_sheet: 'Payroll — paysheet',
  vat_summary: 'VAT figures summary',
  unknown: 'Not recognised',
};

/** The chart first: it names every other file's accounts and seeds the mapping. */
const ORDER: FeedKind[] = [
  'chart', 'ledger', 'trial_balance', 'stock', 'payroll_cost', 'payroll_sheet', 'vat_summary', 'unknown',
];

type RowState = { busy: string | null; done: string | null; error: string | null; when: string };

export default function PortalFolderPanel({ clientId, onImported }: {
  clientId: number;
  onImported: () => void;
}) {
  const { client } = useReportingSession();
  const uploadRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<PortalFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [year, setYear] = useState(String(new Date().getUTCFullYear()));
  const [month, setMonth] = useState('');

  const setRow = (id: number, p: Partial<RowState>) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { busy: null, done: null, error: null, when: '' }), ...p } }));

  const load = useCallback(async () => {
    setError(null); setBusy('Reading the folder');
    try {
      const found = await listBtmsFolder(clientId, (name, done, total) =>
        setBusy(`Reading ${name} (${done} of ${total})`));
      setFiles(found);
      const seeded: Record<number, RowState> = {};
      for (const f of found) seeded[f.id] = { busy: null, done: null, error: null, when: f.suggested ?? '' };
      setRows(seeded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    try {
      for (const file of Array.from(list)) {
        setBusy(`Uploading ${file.name}`);
        await uploadToBtmsFolder(clientId, file, { year, month });
      }
      if (uploadRef.current) uploadRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const importOne = async (f: PortalFile) => {
    setRow(f.id, { busy: 'Reading', error: null, done: null });
    const when = (rows[f.id]?.when ?? '').trim();
    const step = (s: string) => setRow(f.id, { busy: s });
    try {
      const file = await fileFromPortal(f);

      if (f.kind === 'chart') {
        const p = await prepareChartImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        if (!p.fingerprint.accepted) throw new Error(p.fingerprint.reason);
        const r = await commitChartImport(clientId, file, p, step);
        setRow(f.id, {
          busy: null,
          done: `${r.written.toLocaleString('en-GB')} accounts · ${r.mapping.seeded} mapped from the master` +
            (r.mapping.unmapped ? ` · ${r.mapping.unmapped} unmapped` : ''),
        });
      } else if (f.kind === 'ledger') {
        const p = await prepareLedgerImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        if (!p.fingerprint.accepted) throw new Error(p.fingerprint.reason);
        const r = await commitLedgerImport(clientId, file, p, {}, step);
        setRow(f.id, {
          busy: null,
          done: `${r.postingsAdded.toLocaleString('en-GB')} postings across ${r.monthsReplaced} months`,
        });
      } else if (f.kind === 'trial_balance') {
        const m = when.match(/^(\d{4})-(\d{2})$/) ?? when.match(/^(\d{4})$/);
        if (!m) throw new Error('Set the period as YYYY-MM, or YYYY for a year end.');
        const annual = m.length === 2;
        const periodMonth = annual ? `${m[1]}-12-01` : `${m[1]}-${m[2]}-01`;
        const p = await prepareTrialBalanceImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        const r = await commitTrialBalanceImport(clientId, file, p, { periodMonth, isAnnual: annual }, step);
        setRow(f.id, {
          busy: null,
          done: `${r.rows} accounts for ${annual ? 'year ended ' : ''}${r.periodMonth.slice(0, 7)}`,
        });
      } else if (f.kind === 'stock') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) throw new Error('Set the count date as YYYY-MM-DD.');
        const p = await prepareStockImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        const r = await commitStockImport(clientId, file, p, when, step);
        setRow(f.id, {
          busy: null,
          done: `${r.items.toLocaleString('en-GB')} items, ${r.value.toFixed(2)} against ${r.ledgerValue.toFixed(2)} in the ledger`,
        });
      } else if (f.kind === 'payroll_cost' || f.kind === 'payroll_sheet') {
        const partnerKind: FeedKind = f.kind === 'payroll_cost' ? 'payroll_sheet' : 'payroll_cost';
        const partner = (files ?? []).find((x) => x.kind === partnerKind);
        if (!partner) throw new Error('The other payroll report is not in this folder; both are needed.');
        const partnerFile = await fileFromPortal(partner);
        const costFile = f.kind === 'payroll_cost' ? file : partnerFile;
        const sheetFile = f.kind === 'payroll_cost' ? partnerFile : file;
        const p = await preparePayrollImport(clientId, costFile, sheetFile, step);
        const r = await commitPayrollImport(clientId, costFile, sheetFile, p, step);
        const note = `${r.periodMonth.slice(0, 7)} · ${r.employees} employees · cost ${r.cost.toFixed(2)}`;
        setRow(f.id, { busy: null, done: note });
        setRow(partner.id, { busy: null, done: note });
      } else {
        throw new Error('There is no importer for this kind of file yet.');
      }
      onImported();
    } catch (e) {
      setRow(f.id, { busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const byKind = (k: FeedKind) => (files ?? []).filter((f) => f.kind === k);

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>BTMS data</strong>
        <span style={{ fontSize: 12, color: '#64748b' }}>{client!.name}'s folder in the portal</span>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
          disabled={!!busy} onClick={() => void load()}>
          {busy ? 'Working…' : 'Refresh'}
        </button>
      </div>

      <p style={{ color: '#64748b', fontSize: 12.5, margin: '6px 0 0', maxWidth: 720 }}>
        The exports live here, with the client. Nothing is typed into a file name, so one client's
        ledger cannot land under another's — and the files are reachable from any machine and backed
        up with everything else. What each file is comes from reading it, not from its name.
      </p>

      {/* ---- upload, with the one thing the files do not carry ---- */}
      <div style={{
        marginTop: 12, padding: 12, borderRadius: 6,
        border: '1px solid #cbd5e1', background: '#f8fafc',
      }}>
        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>
          Add exports
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input ref={uploadRef} type="file" accept=".xls,.xlsx" multiple disabled={!!busy}
            onChange={(e) => void upload(e.target.files)} />
          <label style={{ fontSize: 12, color: '#64748b' }}>
            Year{' '}
            <input className="form-input" style={{ width: 74, fontSize: 12 }} value={year}
              onChange={(e) => setYear(e.target.value)} placeholder="2026" />
          </label>
          <label style={{ fontSize: 12, color: '#64748b' }}>
            Month{' '}
            <input className="form-input" style={{ width: 60, fontSize: 12 }} value={month}
              onChange={(e) => setMonth(e.target.value)} placeholder="07" />
          </label>
        </div>
        <p style={{ fontSize: 11.5, color: '#64748b', margin: '8px 0 0' }}>
          Year and month are only needed for the trial balance and the stock valuation — those two
          carry no date anywhere inside them, and everything else takes its dates from the postings.
          Leave the month blank for a year end.
        </p>
      </div>

      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      {busy && <p style={{ fontSize: 12.5, color: '#334155', marginTop: 10 }}>{busy}…</p>}

      {files && files.length === 0 && (
        <p style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 12 }}>
          Nothing in this client's BTMS folder yet.
        </p>
      )}

      {files && files.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
            Import the chart of accounts first: it gives every other file its account names and
            seeds the mapping.
          </p>
          {ORDER.filter((k) => byKind(k).length).map((kind) => (
            <div key={kind} style={{ marginTop: 10 }}>
              <div style={{
                fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase',
                color: kind === 'unknown' ? '#cbd5e1' : '#94a3b8', marginBottom: 4,
              }}>{LABEL[kind]}</div>
              {byKind(kind).map((f) => {
                const st = rows[f.id] ?? { busy: null, done: null, error: null, when: '' };
                const needsWhen = kind === 'trial_balance' || kind === 'stock';
                return (
                  <div key={f.id} style={{
                    display: 'grid', gridTemplateColumns: 'minmax(200px,1fr) 130px 110px',
                    gap: 8, alignItems: 'center', padding: '4px 0', borderTop: '1px solid #f8fafc',
                  }}>
                    <span style={{ fontSize: 12.5, minWidth: 0 }}>
                      {f.fileName}
                      <span style={{ color: '#cbd5e1', marginLeft: 8, fontSize: 11 }}>
                        {new Date(f.uploadedAt).toLocaleDateString('en-GB')}
                      </span>
                      {st.done && <span style={{ display: 'block', fontSize: 11.5, color: '#166534' }}>{st.done}</span>}
                      {st.error && <span style={{ display: 'block', fontSize: 11.5, color: '#b91c1c' }}>{st.error}</span>}
                    </span>

                    {needsWhen ? (
                      <input className="form-input" style={{ fontSize: 11.5, padding: '2px 6px' }}
                        placeholder={kind === 'stock' ? 'YYYY-MM-DD' : 'YYYY-MM or YYYY'}
                        value={st.when} onChange={(e) => setRow(f.id, { when: e.target.value })} />
                    ) : <span />}

                    {kind === 'unknown' || kind === 'vat_summary' ? (
                      <span style={{ fontSize: 11, color: '#cbd5e1' }}>
                        {kind === 'unknown' ? '—' : 'no importer yet'}
                      </span>
                    ) : (
                      <button className="btn btn-secondary btn-sm" disabled={!!st.busy || !!st.done}
                        onClick={() => void importOne(f)}>
                        {st.busy ? st.busy : st.done ? 'Imported' : 'Import'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
