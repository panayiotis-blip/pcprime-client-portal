// Configure → Data import → this client's folder.
//
// Link the folder once and the files come from it. No picking six files one at
// a time, no typing a code into a file name, and no chance of one client's
// ledger landing under another's — the folder was chosen deliberately, and
// everything in it belongs to that client.
//
// What each file IS comes from reading it, not from its name (see folder.ts).
// The name is used for one thing only: to suggest a date for the two feeds that
// carry none inside them, and a person confirms that before anything is written.

import { useCallback, useEffect, useState } from 'react';
import { useReportingSession } from '../session';
import {
  folderPickingSupported, linkFolder, linkedFolder, ensureReadable, scanFolder,
  type FoundFile, type FeedKind,
} from '../lib/import/folder.ts';
import { prepareLedgerImport, commitLedgerImport } from '../lib/import/ledgerImport.ts';
import { prepareChartImport, commitChartImport } from '../lib/import/chartImport.ts';
import { prepareTrialBalanceImport, commitTrialBalanceImport } from '../lib/import/trialBalanceImport.ts';
import { prepareStockImport, commitStockImport } from '../lib/import/stockImport.ts';
import { preparePayrollImport, commitPayrollImport } from '../lib/import/payrollImport.ts';

const LABEL: Record<FeedKind, string> = {
  ledger: 'Journal listing',
  chart: 'Chart of accounts',
  trial_balance: 'Trial balance',
  stock: 'Stock valuation',
  payroll_cost: 'Payroll — cost analysis',
  payroll_sheet: 'Payroll — paysheet',
  vat_summary: 'VAT figures summary',
  unknown: 'Not recognised',
};

/** The order they must be imported in: the chart first, so the mapping seeds. */
const ORDER: FeedKind[] = [
  'chart', 'ledger', 'trial_balance', 'stock', 'payroll_cost', 'payroll_sheet', 'vat_summary', 'unknown',
];

type RowState = { busy: string | null; done: string | null; error: string | null; date: string };

export default function FolderPanel({ clientId, onImported }: {
  clientId: number;
  onImported: () => void;
}) {
  const { client } = useReportingSession();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<FoundFile[] | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const setRow = (name: string, p: Partial<RowState>) =>
    setRows((r) => ({ ...r, [name]: { ...(r[name] ?? { busy: null, done: null, error: null, date: '' }), ...p } }));

  useEffect(() => {
    (async () => {
      const h = await linkedFolder(clientId);
      setHandle(h);
      setFiles(null);
    })();
  }, [clientId]);

  const scan = useCallback(async (h: FileSystemDirectoryHandle) => {
    setError(null); setScanning('Reading the folder');
    try {
      if (!(await ensureReadable(h))) {
        setError('Permission to read that folder was not given.');
        return;
      }
      const found = await scanFolder(h, (name, done) => setScanning(`Reading ${name} (${done})`));
      setFiles(found);
      const seeded: Record<string, RowState> = {};
      for (const f of found) {
        seeded[f.name] = { busy: null, done: null, error: null, date: f.suggested ?? '' };
      }
      setRows(seeded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setScanning(null); }
  }, []);

  const link = async () => {
    setError(null);
    try {
      const h = await linkFolder(clientId);
      setHandle(h);
      await scan(h);
    } catch (e) {
      // The picker throws when a person changes their mind, which is not news.
      if ((e as { name?: string })?.name !== 'AbortError') {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const importOne = async (f: FoundFile) => {
    setRow(f.name, { busy: 'Reading', error: null, done: null });
    const state = rows[f.name];
    try {
      const file = await f.handle.getFile();
      const step = (s: string) => setRow(f.name, { busy: s });

      if (f.kind === 'chart') {
        const p = await prepareChartImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        if (!p.fingerprint.accepted) throw new Error(p.fingerprint.reason);
        const r = await commitChartImport(clientId, file, p, step);
        setRow(f.name, {
          busy: null,
          done: `${r.written.toLocaleString('en-GB')} accounts · ${r.mapping.seeded} mapped from the master` +
            (r.mapping.unmapped ? ` · ${r.mapping.unmapped} still unmapped` : ''),
        });
      } else if (f.kind === 'ledger') {
        const p = await prepareLedgerImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        if (!p.fingerprint.accepted) throw new Error(p.fingerprint.reason);
        const r = await commitLedgerImport(clientId, file, p, {}, step);
        setRow(f.name, {
          busy: null,
          done: `${r.postingsAdded.toLocaleString('en-GB')} postings across ${r.monthsReplaced} months`,
        });
      } else if (f.kind === 'trial_balance') {
        const d = (state?.date ?? '').trim();
        const m = d.match(/^(\d{4})-(\d{2})$/) ?? d.match(/^(\d{4})$/);
        if (!m) throw new Error('Set the period first, as YYYY-MM, or YYYY for a year end.');
        const annual = m.length === 2;
        const periodMonth = annual ? `${m[1]}-12-01` : `${m[1]}-${m[2]}-01`;
        const p = await prepareTrialBalanceImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        const r = await commitTrialBalanceImport(clientId, file, p, { periodMonth, isAnnual: annual }, step);
        setRow(f.name, {
          busy: null,
          done: `${r.rows} accounts for ${annual ? 'year ended ' : ''}${r.periodMonth.slice(0, 7)}`,
        });
      } else if (f.kind === 'stock') {
        const d = (state?.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Set the date first, as YYYY-MM-DD.');
        const p = await prepareStockImport(clientId, file, step);
        if (!p.parse.ok) throw new Error(p.parse.notes[0]?.message ?? 'refused at the parsing stage');
        const r = await commitStockImport(clientId, file, p, d, step);
        setRow(f.name, {
          busy: null,
          done: `${r.items.toLocaleString('en-GB')} items, ${r.value.toFixed(2)} against ${r.ledgerValue.toFixed(2)} in the ledger`,
        });
      } else if (f.kind === 'payroll_cost' || f.kind === 'payroll_sheet') {
        // Payroll takes both reports or neither: each is the other's check.
        const partnerKind: FeedKind = f.kind === 'payroll_cost' ? 'payroll_sheet' : 'payroll_cost';
        const partner = (files ?? []).find((x) => x.kind === partnerKind);
        if (!partner) throw new Error('The other payroll report is not in this folder; both are needed.');
        const partnerFile = await partner.handle.getFile();
        const costFile = f.kind === 'payroll_cost' ? file : partnerFile;
        const sheetFile = f.kind === 'payroll_cost' ? partnerFile : file;
        const p = await preparePayrollImport(clientId, costFile, sheetFile, step);
        const r = await commitPayrollImport(clientId, costFile, sheetFile, p, step);
        const note = `${r.periodMonth.slice(0, 7)} · ${r.employees} employees · cost ${r.cost.toFixed(2)}`;
        setRow(f.name, { busy: null, done: note });
        setRow(partner.name, { busy: null, done: note });
      } else {
        throw new Error('There is no importer for this kind of file yet.');
      }
      onImported();
    } catch (e) {
      setRow(f.name, { busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  if (!folderPickingSupported()) {
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
        <strong style={{ fontSize: 13 }}>This client's folder</strong>
        <p style={{ fontSize: 12.5, color: '#92400e', margin: '6px 0 0' }}>
          This browser cannot link a folder. Chrome and Edge can; Firefox and Safari cannot, and
          there the files have to be chosen one at a time below.
        </p>
      </div>
    );
  }

  const byKind = (k: FeedKind) => (files ?? []).filter((f) => f.kind === k);

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 14, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>This client's folder</strong>
        {handle && <span style={{ fontSize: 12, color: '#64748b' }}>{handle.name}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {handle && (
            <button className="btn btn-secondary btn-sm" disabled={!!scanning}
              onClick={() => void scan(handle)}>
              {scanning ? 'Reading…' : files ? 'Read it again' : 'Read the folder'}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => void link()}>
            {handle ? 'Link a different folder' : 'Link a folder'}
          </button>
        </span>
      </div>

      <p style={{ color: '#64748b', fontSize: 12.5, margin: '6px 0 0', maxWidth: 720 }}>
        Linked once and remembered. Every file in it belongs to <b>{client!.name}</b> — which is why
        no code has to be typed into a file name, and why one client's export cannot land on
        another. What each file is comes from reading it, not from its name.
      </p>

      {scanning && <p style={{ fontSize: 12.5, color: '#334155', marginTop: 10 }}>{scanning}…</p>}
      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}

      {files && files.length === 0 && (
        <p style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 10 }}>
          No spreadsheets in that folder.
        </p>
      )}

      {files && files.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
            Import the chart of accounts first: it is what gives every other file its account names
            and seeds the mapping.
          </p>
          {ORDER.filter((k) => byKind(k).length).map((kind) => (
            <div key={kind} style={{ marginTop: 10 }}>
              <div style={{
                fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase',
                color: kind === 'unknown' ? '#cbd5e1' : '#94a3b8', marginBottom: 4,
              }}>{LABEL[kind]}</div>
              {byKind(kind).map((f) => {
                const st = rows[f.name] ?? { busy: null, done: null, error: null, date: '' };
                const needsDate = kind === 'trial_balance' || kind === 'stock';
                return (
                  <div key={f.name} style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(200px,1fr) 130px 110px',
                    gap: 8, alignItems: 'center', padding: '4px 0',
                    borderTop: '1px solid #f8fafc',
                  }}>
                    <span style={{ fontSize: 12.5, minWidth: 0 }}>
                      {f.name}
                      <span style={{ color: '#cbd5e1', marginLeft: 8, fontSize: 11 }}>
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      {st.done && (
                        <span style={{ display: 'block', fontSize: 11.5, color: '#166534' }}>{st.done}</span>
                      )}
                      {st.error && (
                        <span style={{ display: 'block', fontSize: 11.5, color: '#b91c1c' }}>{st.error}</span>
                      )}
                    </span>

                    {needsDate ? (
                      <input
                        className="form-input" style={{ fontSize: 11.5, padding: '2px 6px' }}
                        placeholder={kind === 'stock' ? 'YYYY-MM-DD' : 'YYYY-MM or YYYY'}
                        value={st.date}
                        onChange={(e) => setRow(f.name, { date: e.target.value })}
                        title="Read from the file name as a suggestion. Confirm it before importing."
                      />
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
