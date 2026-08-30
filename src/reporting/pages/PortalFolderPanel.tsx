// Configure → Data import → the client's BTMS data folder, in the portal.
//
// Staff save their exports here at the end of a posting session, and the
// reporting application reads them later, unattended. So nothing is stored
// until it has been read and has agreed with the control totals BTMS prints
// inside it: a file that cannot prove it is complete is refused at the door,
// while the person who exported it is still sitting there and can export it
// again.
//
// That is also what makes the folder reviewable. A month whose files all
// passed is a fact somebody can act on; re-opening eleven spreadsheets to find
// out is not.
//
// The folder is the identity — nothing is typed into a file name, so nothing
// can be mistyped, which is what the BTMS company code was meant to guard
// against and what no BTMS export actually carries.
//
// Bank statements and anything else kept for the review are stored too, but
// not parsed: there is no control total to check a PDF against, so they are
// kept as evidence, with a period and whoever saved them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReportingSession } from '../session';
import { supabase } from '../../lib/supabase';
import {
  listBtmsFolder, uploadToBtmsFolder, fileFromPortal, type PortalFile,
} from '../lib/import/portalFolder.ts';
import {
  checkBtmsFile, KIND_LABEL, FEEDS, type DocKind, type FileCheck,
} from '../lib/import/checkFile.ts';
import { prepareLedgerImport, commitLedgerImport } from '../lib/import/ledgerImport.ts';
import { prepareChartImport, commitChartImport } from '../lib/import/chartImport.ts';
import { prepareTrialBalanceImport, commitTrialBalanceImport } from '../lib/import/trialBalanceImport.ts';
import { prepareStockImport, commitStockImport } from '../lib/import/stockImport.ts';
import { preparePayrollImport, commitPayrollImport } from '../lib/import/payrollImport.ts';

/** The chart first: it names every other file's accounts and seeds the mapping. */
const ORDER: DocKind[] = [
  'chart', 'ledger', 'trial_balance', 'stock', 'payroll_cost', 'payroll_sheet',
  'vat_summary', 'detailed_ledger', 'bank_statement', 'other', 'unknown',
];

/** What a person may declare a file to be when it is not a BTMS export. */
const DECLARABLE: DocKind[] = ['bank_statement', 'detailed_ledger', 'other'];

type RowState = { busy: string | null; done: string | null; error: string | null; when: string };

/** A file waiting at the door: checked, shown, not yet stored. */
type Staged = {
  file: File;
  check: FileCheck;
  /** The period a person supplies for the two feeds that state none. */
  when: string;
  saving: boolean;
  saved: string | null;
  error: string | null;
};

const VERDICT_STYLE = {
  ok: { bg: '#f0fdf4', border: '#bbf7d0', ink: '#166534', label: 'Checked' },
  warning: { bg: '#fffbeb', border: '#fde68a', ink: '#92400e', label: 'Check this' },
  blocked: { bg: '#fef2f2', border: '#fecaca', ink: '#b91c1c', label: 'Not stored' },
} as const;

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
  const [staged, setStaged] = useState<Staged[]>([]);
  // The company name BTMS prints, as recorded on the setup screen. One export
  // — the wide trial balance — names the company inside it, and where a name
  // is there to be read it is checked: a file belonging to another client is
  // stopped at the door rather than found later in a report.
  const [btmsName, setBtmsName] = useState<string | null>(null);

  const setRow = (id: number, p: Partial<RowState>) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { busy: null, done: null, error: null, when: '' }), ...p } }));

  const setStage = (i: number, p: Partial<Staged>) =>
    setStaged((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

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

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.schema('reporting').from('client_settings')
        .select('btms_company_name').eq('client_id', clientId).maybeSingle();
      setBtmsName((data as { btms_company_name: string | null } | null)?.btms_company_name ?? null);
    })();
  }, [clientId]);

  // ---- the gate --------------------------------------------------------

  /** Picked files are read and checked. Nothing is stored by picking. */
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const next: Staged[] = [];
    try {
      for (const file of Array.from(list)) {
        setBusy(`Checking ${file.name}`);
        const check = await checkBtmsFile(file, undefined, { companyName: btmsName });
        next.push({
          file, check,
          when: check.period ?? '',
          saving: false, saved: null, error: null,
        });
      }
      setStaged((s) => [...s, ...next]);
      if (uploadRef.current) uploadRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  /** Re-run the check after a person has said what an unrecognised file is. */
  const declare = async (i: number, kind: DocKind) => {
    const s = staged[i];
    if (!s) return;
    setStage(i, { saving: true });
    const check = await checkBtmsFile(s.file, kind, { companyName: btmsName });
    setStage(i, { check, saving: false, when: check.period ?? s.when });
  };

  const saveStaged = async () => {
    setError(null);
    for (let i = 0; i < staged.length; i++) {
      const s = staged[i];
      if (s.saved || s.check.verdict === 'blocked') continue;
      if (s.check.needsPeriod && !s.when.trim()) {
        setStage(i, { error: 'This file states no period. Give it one before it is saved.' });
        continue;
      }
      setStage(i, { saving: true, error: null });
      try {
        const when = periodParts(s.when || s.check.period || '');
        const r = await uploadToBtmsFolder(clientId, s.file, when, {
          ...s.check,
          period: s.when.trim() || s.check.period,
        });
        setStage(i, {
          saving: false,
          saved: r.superseded
            ? `Saved — it replaced ${r.superseded} earlier ${r.superseded === 1 ? 'copy' : 'copies'}`
            : 'Saved',
        });
      } catch (e) {
        setStage(i, { saving: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await load();
  };

  const clearSaved = () => setStaged((s) => s.filter((x) => !x.saved));

  // ---- importing what is already in the folder --------------------------

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
        const partnerKind: DocKind = f.kind === 'payroll_cost' ? 'payroll_sheet' : 'payroll_cost';
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

  const byKind = (k: DocKind) => (files ?? []).filter((f) => f.kind === k);
  const ready = staged.filter((s) => !s.saved && s.check.verdict !== 'blocked').length;
  const refused = staged.filter((s) => s.check.verdict === 'blocked').length;

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
        The exports live here, with the client. Every file is read and checked against the totals
        BTMS prints inside it <b>before</b> it is stored — a file that cannot prove it is complete
        is refused, while you are still at the machine that exported it. Saving a feed again
        replaces the previous copy rather than adding to it.
      </p>

      {/* ---- the door ---- */}
      <div style={{
        marginTop: 12, padding: 12, borderRadius: 6,
        border: '1px solid #cbd5e1', background: '#f8fafc',
      }}>
        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>
          Add files
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input ref={uploadRef} type="file" accept=".xls,.xlsx,.pdf,.csv" multiple disabled={!!busy}
            onChange={(e) => void pick(e.target.files)} />
        </div>
        <p style={{ fontSize: 11.5, color: '#64748b', margin: '8px 0 0', maxWidth: 720 }}>
          Journal listings, trial balances, the chart of accounts, stock and payroll — and bank
          statements or anything else worth keeping for the review, which are stored as they are
          rather than read. Nothing is saved by choosing it: each file is checked first and you
          decide.
        </p>
      </div>

      {/* ---- what the gate found ---- */}
      {staged.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12.5 }}>
              {staged.length} {staged.length === 1 ? 'file' : 'files'} checked
            </strong>
            {refused > 0 && (
              <span style={{ fontSize: 12, color: '#b91c1c' }}>
                {refused} cannot be stored
              </span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {staged.some((s) => s.saved) && (
                <button className="btn btn-secondary btn-sm" onClick={clearSaved}>Clear saved</button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setStaged([])}>Discard all</button>
              <button className="btn btn-primary btn-sm" disabled={!ready || !!busy}
                onClick={() => void saveStaged()}>
                {ready ? `Save ${ready} ${ready === 1 ? 'file' : 'files'}` : 'Nothing to save'}
              </button>
            </div>
          </div>

          {staged.map((s, i) => {
            const v = VERDICT_STYLE[s.check.verdict];
            return (
              <div key={i} style={{
                marginTop: 8, padding: 10, borderRadius: 6,
                border: `1px solid ${v.border}`, background: v.bg,
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase',
                    color: v.ink, fontWeight: 600,
                  }}>{s.saved ? 'Saved' : v.label}</span>
                  <strong style={{ fontSize: 12.5 }}>{s.file.name}</strong>
                  <span style={{ fontSize: 12, color: '#475569' }}>
                    {KIND_LABEL[s.check.kind]}
                  </span>
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => setStaged((x) => x.filter((_, j) => j !== i))}>Remove</button>
                </div>

                <p style={{ fontSize: 12, color: '#475569', margin: '4px 0 0' }}>{s.check.summary}</p>

                {s.check.facts.length > 0 && (
                  <div style={{
                    display: 'flex', gap: 16, flexWrap: 'wrap', margin: '8px 0 0',
                    fontSize: 11.5, color: '#334155',
                  }}>
                    {s.check.facts.map((f) => (
                      <span key={f.label}>
                        <span style={{ color: '#94a3b8' }}>{f.label}</span>{' '}
                        <b style={{ fontFamily: 'ui-monospace, monospace' }}>{f.value}</b>
                      </span>
                    ))}
                  </div>
                )}

                {s.check.problems.map((t, j) => (
                  <p key={j} style={{ fontSize: 12, color: '#b91c1c', margin: '6px 0 0' }}>{t}</p>
                ))}
                {s.check.warnings.map((t, j) => (
                  <p key={j} style={{ fontSize: 12, color: '#92400e', margin: '6px 0 0' }}>{t}</p>
                ))}

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  {/* The two feeds that state no period, and evidence, need one. */}
                  {(s.check.needsPeriod || !FEEDS.includes(s.check.kind)) && !s.saved && (
                    <label style={{ fontSize: 11.5, color: '#475569' }}>
                      Period{' '}
                      <input className="form-input" style={{ width: 120, fontSize: 11.5, padding: '2px 6px' }}
                        placeholder={s.check.kind === 'stock' ? 'YYYY-MM-DD' : 'YYYY-MM'}
                        value={s.when} onChange={(e) => setStage(i, { when: e.target.value })} />
                    </label>
                  )}

                  {/* An unrecognised file is not refused outright — it may be
                      evidence, and a person can say so. */}
                  {!s.saved && (s.check.kind === 'unknown' || DECLARABLE.includes(s.check.kind)) && (
                    <label style={{ fontSize: 11.5, color: '#475569' }}>
                      This is{' '}
                      <select className="form-input" style={{ fontSize: 11.5, padding: '2px 6px' }}
                        value={DECLARABLE.includes(s.check.kind) ? s.check.kind : ''}
                        onChange={(e) => void declare(i, e.target.value as DocKind)}>
                        <option value="">— say what it is —</option>
                        {DECLARABLE.map((k) => (
                          <option key={k} value={k}>{KIND_LABEL[k]}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {s.saving && <span style={{ fontSize: 11.5, color: '#475569' }}>Saving…</span>}
                  {s.saved && <span style={{ fontSize: 11.5, color: '#166534' }}>{s.saved}</span>}
                  {s.error && <span style={{ fontSize: 11.5, color: '#b91c1c' }}>{s.error}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
              }}>{KIND_LABEL[kind]}</div>
              {byKind(kind).map((f) => {
                const st = rows[f.id] ?? { busy: null, done: null, error: null, when: '' };
                const needsWhen = kind === 'trial_balance' || kind === 'stock';
                const importable = FEEDS.includes(kind);
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
                      {f.verdict === 'warning' && (
                        <span style={{ color: '#92400e', marginLeft: 8, fontSize: 11 }}>· checked with a note</span>
                      )}
                      {st.done && <span style={{ display: 'block', fontSize: 11.5, color: '#166534' }}>{st.done}</span>}
                      {st.error && <span style={{ display: 'block', fontSize: 11.5, color: '#b91c1c' }}>{st.error}</span>}
                    </span>

                    {needsWhen ? (
                      <input className="form-input" style={{ fontSize: 11.5, padding: '2px 6px' }}
                        placeholder={kind === 'stock' ? 'YYYY-MM-DD' : 'YYYY-MM or YYYY'}
                        value={st.when} onChange={(e) => setRow(f.id, { when: e.target.value })} />
                    ) : <span />}

                    {!importable ? (
                      <span style={{ fontSize: 11, color: '#cbd5e1' }}>
                        {kind === 'vat_summary' ? 'no importer yet' : 'kept for the review'}
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

/**
 * documents.year and documents.month, from whatever period was settled on.
 * A range ("2026-01 to 2026-08") gives a year and no month, which is right:
 * a listing spanning eight months belongs to none of them.
 */
function periodParts(period: string): { year: string; month: string } {
  const ym = /^(\d{4})-(\d{2})/.exec(period.trim());
  if (ym) return { year: ym[1], month: ym[2] };
  const y = /^(\d{4})/.exec(period.trim());
  return { year: y ? y[1] : String(new Date().getUTCFullYear()), month: '' };
}
