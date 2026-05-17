import { Fragment, useEffect, useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, RotateCcw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Toolbar, Button, Modal, FormField, Input } from '../ui';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import {
  autoMatch, fieldLabel, IMPORT_FIELDS, FIELD_GROUPS,
  CONFIDENT_THRESHOLD, type AutoMatch,
} from '../../services/smartImport/fields';
import { validateField, parseDateLoose } from '../../services/validation';

// Smart Import — Excel field-mapping import for client data.
// Phases 2-3 cover Steps 1-3: upload, sheet pick, auto-match, and the
// editable column-mapping table with save/load. Steps 4-6 (validation,
// per-client review, execute) arrive in later phases.

const MAX_FILE_MB = 5;
const MAX_ROWS = 10_000;

interface SheetData {
  headers: string[];
  rows: any[][]; // data rows only (header row excluded)
}

interface RowIssue { field: string; level: 'warning' | 'error'; message: string; }
interface RowResult { index: number; record: Record<string, any>; issues: RowIssue[]; }

type RowAction = 'create' | 'update' | 'nochange' | 'skip';
interface FieldDiff { field: string; current: string; incoming: string; willChange: boolean; }
interface ReviewRow {
  index: number;
  record: Record<string, any>;
  action: RowAction;
  matched: any | null;
  diffs: FieldDiff[];
}

const norm = (v: any) => String(v ?? '').trim().toLowerCase();
const normName = (v: any) => norm(v).replace(/\s+/g, ' ');

function displayVal(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toLocaleDateString();
  if (Array.isArray(v)) return v.join('; ');
  return String(v);
}

// Match an import row to an existing client: VAT → client code → name
// (normalised exact match on either the primary or Greek tax-office name).
function matchClient(record: Record<string, any>, clients: any[]): any | null {
  const vat = norm(record.vat_number);
  if (vat) { const m = clients.find((c) => norm(c.vat_number) === vat); if (m) return m; }
  const code = norm(record.client_code);
  if (code) { const m = clients.find((c) => norm(c.client_code) === code); if (m) return m; }
  const nm = normName(record.name);
  if (nm) {
    const m = clients.find((c) => normName(c.name) === nm || normName(c.name_tax_office) === nm);
    if (m) return m;
  }
  return null;
}

function actionBadge(action: RowAction) {
  const map: Record<RowAction, { bg: string; fg: string; label: string }> = {
    create:   { bg: 'rgba(16,185,129,0.12)', fg: '#047857',          label: 'New client' },
    update:   { bg: 'var(--pc-gold-tint)',   fg: 'var(--pc-navy)',   label: 'Update' },
    nochange: { bg: '#eef1f5',               fg: 'var(--pc-text-2)', label: 'No change' },
    skip:     { bg: 'rgba(239,68,68,0.12)',  fg: '#b91c1c',          label: 'Skipped' },
  };
  const s = map[action];
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--pc-text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
    </div>
  );
}

// ---- Payload building for the smart_import RPC (Step 6) ----
const DATE_FIELDS = new Set([
  'incorporation_date', 'date_of_birth', 'vat_registration_date', 'engagement_letter_date',
]);
const NUMERIC_FIELDS = new Set(['year_of_incorporation', 'annual_fee_agreed', 'monthly_fee']);
const VALID_CATEGORIES = [
  'company', 'partnership', 'individual', 'sole_trader', 'self_employed',
  'deceased', 'dormant', 'prospective', 'other', 'vendor_only',
];
const CATEGORY_ALIASES: Record<string, string> = {
  co: 'company', ltd: 'company', limited: 'company',
  ind: 'individual', part: 'partnership', st: 'sole_trader',
};

// Normalise mapped client-field values for the RPC: ISO dates, email as an
// array, numeric fields as numbers, a tidied category. addr_*/director_* keys
// are dropped (addresses are sent separately; directors aren't imported yet).
function prepareFields(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('addr_') || key.startsWith('director_')) continue;
    if (value == null || String(value).trim() === '') continue;
    if (DATE_FIELDS.has(key)) {
      const d = parseDateLoose(value);
      if (d) out[key] = d.toISOString().slice(0, 10);
    } else if (NUMERIC_FIELDS.has(key)) {
      const n = Number(String(value).replace(/[^\d.\-]/g, ''));
      if (isFinite(n)) out[key] = n;
    } else if (key === 'email') {
      const arr = String(value).split(/[;,]+/).map((s) => s.trim()).filter(Boolean);
      if (arr.length) out[key] = arr;
    } else if (key === 'client_category') {
      let c = String(value).trim().toLowerCase().replace(/\s+/g, '_');
      c = CATEGORY_ALIASES[c] || c;
      if (VALID_CATEGORIES.includes(c)) out[key] = c; // unrecognised → dropped
    } else {
      out[key] = String(value).trim();
    }
  }
  return out;
}

// Group addr_<type>_<part> keys into { registered: {...}, trading: {...}, postal: {...} }.
function buildAddresses(raw: Record<string, any>): Record<string, any> | undefined {
  const result: Record<string, any> = {};
  for (const type of ['registered', 'trading', 'postal']) {
    const block: Record<string, string> = {};
    for (const part of ['line1', 'line2', 'city', 'postal', 'country']) {
      const v = raw[`addr_${type}_${part}`];
      if (v != null && String(v).trim() !== '') {
        block[part === 'postal' ? 'postal_code' : part] = String(v).trim();
      }
    }
    if (Object.keys(block).length) result[type] = block;
  }
  return Object.keys(result).length ? result : undefined;
}

// Resolve one review row into the smart_import payload shape.
function buildRowPayload(r: ReviewRow): any {
  const addresses = buildAddresses(r.record);
  if (r.action === 'create') {
    return { action: 'create', fields: prepareFields(r.record), ...(addresses ? { addresses } : {}) };
  }
  const changed: Record<string, any> = {};
  for (const d of r.diffs) if (d.willChange) changed[d.field] = r.record[d.field];
  return {
    action: 'update',
    client_id: r.matched?.id,
    fields: prepareFields(changed),
    ...(addresses ? { addresses } : {}),
  };
}

export default function SmartImport() {
  const { clients, refreshClients } = useApp();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [matches, setMatches] = useState<AutoMatch[]>([]);      // by column index
  const [mapping, setMapping] = useState<Record<number, string>>({}); // colIndex -> field key ('' = ignore)
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const [savedMappings, setSavedMappings] = useState<any[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  const [mergeMode, setMergeMode] = useState<'fill' | 'overwrite'>('fill');
  const [decisions, setDecisions] = useState<Record<number, boolean>>({});
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ created: number; updated: number; failed: number; errors: any[] } | null>(null);

  useEffect(() => {
    api.getImportMappings().then(setSavedMappings).catch(() => {});
  }, []);

  const reset = () => {
    setStep(1); setFileName(''); setWorkbook(null); setSheetNames([]);
    setSelectedSheet(''); setSheet(null); setMatches([]); setMapping({}); setError('');
  };

  const readFile = async (file: File) => {
    setError('');
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('Please choose an Excel file (.xlsx or .xls).');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`That file is too large — the limit is ${MAX_FILE_MB} MB.`);
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      if (wb.SheetNames.length === 0) { setError('That workbook has no sheets.'); return; }
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      setSelectedSheet(wb.SheetNames[0]);
      setFileName(file.name);
      setSheet(null);
    } catch {
      setError('Could not read that file — is it a valid Excel workbook?');
    }
  };

  const detectColumns = () => {
    if (!workbook || !selectedSheet) return;
    const ws = workbook.Sheets[selectedSheet];
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: '' });
    if (aoa.length === 0) { setError('That sheet is empty.'); return; }
    const headers = (aoa[0] || []).map((h) => String(h ?? '').trim());
    const rows = aoa.slice(1) as any[][];
    if (headers.every((h) => !h)) {
      setError('No column headers found in the first row of that sheet.');
      return;
    }
    if (rows.length > MAX_ROWS) {
      setError(`That sheet has ${rows.length.toLocaleString()} rows — the limit is ${MAX_ROWS.toLocaleString()}.`);
      return;
    }
    setSheet({ headers, rows });
    setMatches(headers.map((h) => autoMatch(h)));
    setError('');
    setStep(2);
  };

  // Step 2 → 3: seed the editable mapping from the auto-match guesses.
  const startMapping = () => {
    const seed: Record<number, string> = {};
    matches.forEach((m, i) => { seed[i] = m.fieldKey || ''; });
    setMapping(seed);
    setStep(3);
  };

  const sampleValues = (colIndex: number): string[] =>
    (sheet?.rows.slice(0, 3) || []).map((r) => {
      const v = r[colIndex];
      if (v == null || v === '') return '';
      if (v instanceof Date) return v.toLocaleDateString();
      return String(v);
    });

  const confidentCount = matches.filter(
    (m) => m.fieldKey && m.confidence >= CONFIDENT_THRESHOLD,
  ).length;

  // ---- Save / load mappings ----
  const handleSaveMapping = async () => {
    if (!saveName.trim() || !sheet) { alert('Give the mapping a name first.'); return; }
    setSaveBusy(true);
    try {
      const columnMapping: Record<string, string> = {};
      sheet.headers.forEach((h, i) => { if (mapping[i]) columnMapping[h] = mapping[i]; });
      await api.saveImportMapping({
        name: saveName.trim(),
        description: saveDesc.trim() || null,
        column_mapping: columnMapping,
      });
      setSavedMappings(await api.getImportMappings());
      setShowSave(false);
      setSaveName(''); setSaveDesc('');
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaveBusy(false);
    }
  };

  const applyMapping = (m: any) => {
    if (!sheet || !m) return;
    const cm = (m.column_mapping || {}) as Record<string, string>;
    setMapping((prev) => {
      const next = { ...prev };
      sheet.headers.forEach((h, i) => {
        if (Object.prototype.hasOwnProperty.call(cm, h)) next[i] = cm[h] || '';
      });
      return next;
    });
  };

  // ---- Step 6 — execute the import in chunks of 100 ----
  const runImport = async () => {
    const payloads = reviewRows.filter(isIncluded).map(buildRowPayload);
    if (payloads.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: payloads.length });
    const acc = { created: 0, updated: 0, failed: 0, errors: [] as any[] };
    try {
      const CHUNK = 100;
      for (let i = 0; i < payloads.length; i += CHUNK) {
        const res = await api.smartImport(payloads.slice(i, i + CHUNK));
        acc.created += res.created;
        acc.updated += res.updated;
        acc.failed += res.failed;
        if (res.errors?.length) acc.errors.push(...res.errors);
        setProgress({ done: Math.min(i + CHUNK, payloads.length), total: payloads.length });
      }
      setResult(acc);
      await refreshClients();
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  const downloadLog = () => {
    const esc = (s: any) => {
      const t = String(s ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [
      'Row,Name,Error',
      ...(result?.errors || []).map((e) => [e.row, esc(e.name), esc(e.error)].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smart-import-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ---- Step 3 validation ----
  const mappedKeys = Object.values(mapping).filter(Boolean);
  const nameMapped = mappedKeys.includes('name');
  const duplicateKeys = [...new Set(mappedKeys.filter((k, i) => mappedKeys.indexOf(k) !== i))];

  // ---- Step 4 validation — applies the mapping to every row and checks it ----
  const rowResults: RowResult[] = useMemo(() => {
    if (!sheet) return [];
    const recordOf = (row: any[]): Record<string, any> => {
      const rec: Record<string, any> = {};
      sheet.headers.forEach((_, i) => { if (mapping[i]) rec[mapping[i]] = row[i]; });
      return rec;
    };
    // In-file duplicate detection on client code / VAT.
    const codeCounts: Record<string, number> = {};
    const vatCounts: Record<string, number> = {};
    for (const row of sheet.rows) {
      const r = recordOf(row);
      const code = String(r.client_code ?? '').trim();
      const vat = String(r.vat_number ?? '').trim().toUpperCase();
      if (code) codeCounts[code] = (codeCounts[code] || 0) + 1;
      if (vat) vatCounts[vat] = (vatCounts[vat] || 0) + 1;
    }
    return sheet.rows.map((row, index) => {
      const record = recordOf(row);
      const issues: RowIssue[] = [];
      if (!String(record.name ?? '').trim()) {
        issues.push({ field: 'name', level: 'error', message: 'Name is required' });
      }
      for (const [key, value] of Object.entries(record)) {
        if (value == null || String(value).trim() === '') continue;
        const res = validateField(key, value);
        if (res.level !== 'ok') issues.push({ field: key, level: res.level, message: res.message });
      }
      const code = String(record.client_code ?? '').trim();
      if (code && codeCounts[code] > 1) {
        issues.push({ field: 'client_code', level: 'warning', message: 'Duplicate client code in this file' });
      }
      const vat = String(record.vat_number ?? '').trim().toUpperCase();
      if (vat && vatCounts[vat] > 1) {
        issues.push({ field: 'vat_number', level: 'warning', message: 'Duplicate VAT number in this file' });
      }
      return { index, record, issues };
    });
  }, [sheet, mapping]);

  // ---- Step 5 review — match each row to an existing client + diff ----
  const reviewRows: ReviewRow[] = useMemo(() => {
    return rowResults.map((rr): ReviewRow => {
      if (rr.issues.some((i) => i.level === 'error')) {
        return { index: rr.index, record: rr.record, action: 'skip', matched: null, diffs: [] };
      }
      const matched = matchClient(rr.record, clients);
      if (!matched) {
        return { index: rr.index, record: rr.record, action: 'create', matched: null, diffs: [] };
      }
      const diffs: FieldDiff[] = [];
      for (const [key, raw] of Object.entries(rr.record)) {
        if (key.startsWith('addr_') || key.startsWith('director_')) continue;
        const incoming = displayVal(raw);
        if (!incoming.trim()) continue;
        const current = displayVal(matched[key]);
        if (norm(current) === norm(incoming)) continue;
        const willChange = mergeMode === 'overwrite' ? true : !current.trim();
        diffs.push({ field: key, current, incoming, willChange });
      }
      const action: RowAction = diffs.some((d) => d.willChange) ? 'update' : 'nochange';
      return { index: rr.index, record: rr.record, action, matched, diffs };
    });
  }, [rowResults, clients, mergeMode]);

  // A create/update row is included unless the user has excluded it.
  const isIncluded = (r: ReviewRow): boolean => {
    if (r.action === 'skip' || r.action === 'nochange') return false;
    return decisions[r.index] ?? true;
  };

  // ================= Step 6 — execute + result =================
  if (step === 6 && sheet) {
    const included = reviewRows.filter(isIncluded);
    const newN = included.filter((r) => r.action === 'create').length;
    const updN = included.filter((r) => r.action === 'update').length;
    const directorMapped = Object.values(mapping).some((k) => k.startsWith('director_'));

    let body;
    if (result) {
      const skipped = reviewRows.length - included.length;
      body = (
        <div className="form-section">
          <h3>Import complete</h3>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', margin: '14px 0' }}>
            <Stat label="Created" value={result.created} color="#047857" />
            <Stat label="Updated" value={result.updated} color="var(--pc-navy)" />
            <Stat label="Skipped" value={skipped} color="var(--pc-text-2)" />
            <Stat label="Failed" value={result.failed} color="var(--pc-red)" />
          </div>
          {result.errors.length > 0 && (
            <>
              <p style={{ fontSize: 13, color: 'var(--pc-red)' }}>
                {result.errors.length} row{result.errors.length === 1 ? '' : 's'} failed:
              </p>
              <table className="export-table">
                <thead><tr><th style={{ width: 60 }}>Row</th><th>Name</th><th>Error</th></tr></thead>
                <tbody>
                  {result.errors.slice(0, 50).map((e, k) => (
                    <tr key={k}>
                      <td>{e.row}</td>
                      <td>{e.name}</td>
                      <td style={{ color: 'var(--pc-red)', fontSize: 13 }}>{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {result.errors.length > 0 && (
              <Button variant="secondary" onClick={downloadLog}>Download error log (CSV)</Button>
            )}
            <Button variant="primary" onClick={reset}>Import another file</Button>
          </div>
        </div>
      );
    } else if (running) {
      const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
      body = (
        <div className="form-section">
          <h3>Importing…</h3>
          <p style={{ color: 'var(--pc-text-2)', fontSize: 13 }}>
            {progress.done} of {progress.total} clients · {pct}%. Please don't navigate away.
          </p>
          <div style={{ background: 'var(--pc-border)', height: 10, borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--pc-navy-2)', transition: 'width 0.2s' }} />
          </div>
        </div>
      );
    } else {
      body = (
        <div className="form-section">
          <h3>Ready to import</h3>
          <p style={{ fontSize: 14, color: 'var(--pc-text-2)' }}>
            <strong>{included.length}</strong> client{included.length === 1 ? '' : 's'} will be imported —{' '}
            <strong style={{ color: '#047857' }}>{newN}</strong> new and{' '}
            <strong style={{ color: 'var(--pc-navy)' }}>{updN}</strong> updated. Existing clients are
            merged using the “{mergeMode === 'fill' ? 'fill empty fields only' : 'overwrite'}” rule.
          </p>
          {directorMapped && (
            <p style={{ fontSize: 13, color: '#b45309' }}>
              ⚠ Director columns are mapped, but director import isn't supported yet — those columns
              are skipped (logged as a follow-up).
            </p>
          )}
          <Button variant="primary" disabled={included.length === 0} onClick={runImport}>
            Run import
          </Button>
        </div>
      );
    }

    return (
      <div className="dashboard">
        <Toolbar
          title="Smart Import"
          actions={
            !running && !result ? (
              <>
                <Button variant="secondary" onClick={() => setStep(5)}>← Back</Button>
                <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={reset}>Start over</Button>
              </>
            ) : undefined
          }
        >
          <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
            Step 6 of 6 — import · <strong>{fileName}</strong> › {selectedSheet}
          </span>
        </Toolbar>
        {body}
      </div>
    );
  }

  // ================= Step 5 — per-client review =================
  if (step === 5 && sheet) {
    const newCount = reviewRows.filter((r) => r.action === 'create').length;
    const updateCount = reviewRows.filter((r) => r.action === 'update').length;
    const nochangeCount = reviewRows.filter((r) => r.action === 'nochange').length;
    const skipCount = reviewRows.filter((r) => r.action === 'skip').length;
    const includedCount = reviewRows.filter(isIncluded).length;

    const setAll = (action: RowAction, val: boolean) => {
      setDecisions((prev) => {
        const next = { ...prev };
        reviewRows.forEach((r) => { if (r.action === action) next[r.index] = val; });
        return next;
      });
    };

    return (
      <div className="dashboard">
        <Toolbar
          title="Smart Import"
          actions={
            <>
              <Button variant="secondary" onClick={() => setStep(4)}>← Back</Button>
              <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={reset}>Start over</Button>
            </>
          }
        >
          <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
            Step 5 of 6 — review · <strong>{fileName}</strong> › {selectedSheet}
          </span>
        </Toolbar>

        <div className="form-section">
          <h3>Per-client review</h3>
          <p style={{ fontSize: 13, color: 'var(--pc-text-2)', marginTop: 0 }}>
            <strong style={{ color: '#047857' }}>{newCount}</strong> new ·{' '}
            <strong style={{ color: 'var(--pc-navy)' }}>{updateCount}</strong> to update ·{' '}
            <strong style={{ color: 'var(--pc-text-2)' }}>{nochangeCount}</strong> unchanged ·{' '}
            <strong style={{ color: 'var(--pc-red)' }}>{skipCount}</strong> skipped (errors)
          </p>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>For existing clients:</label>
            <select
              className="form-input"
              value={mergeMode}
              onChange={(e) => setMergeMode(e.target.value as 'fill' | 'overwrite')}
              style={{ maxWidth: 280 }}
            >
              <option value="fill">Only fill in empty fields</option>
              <option value="overwrite">Overwrite with imported values</option>
            </select>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="secondary" onClick={() => setAll('create', true)}>Include all new</Button>
            <Button size="sm" variant="secondary" onClick={() => setAll('update', true)}>Include all updates</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDecisions(() => {
                const n: Record<number, boolean> = {};
                reviewRows.forEach((r) => { n[r.index] = false; });
                return n;
              })}
            >
              Exclude all
            </Button>
          </div>

          <table className="export-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Row</th>
                <th>Name</th>
                <th style={{ width: 110 }}>Action</th>
                <th>Details</th>
                <th style={{ width: 80, textAlign: 'center' }}>Include</th>
              </tr>
            </thead>
            <tbody>
              {reviewRows.map((r) => {
                const expanded = expandedRow === r.index;
                const changeCount = r.diffs.filter((d) => d.willChange).length;
                return (
                  <Fragment key={r.index}>
                    <tr>
                      <td>{r.index + 2}</td>
                      <td>
                        <strong>{displayVal(r.record.name) || <span style={{ color: 'var(--pc-text-3)' }}>—</span>}</strong>
                        {r.matched && (
                          <div style={{ fontSize: 11, color: 'var(--pc-text-3)' }}>
                            matches {r.matched.client_code || r.matched.name}
                          </div>
                        )}
                      </td>
                      <td>{actionBadge(r.action)}</td>
                      <td>
                        {r.action === 'create' && (
                          <span style={{ fontSize: 13, color: 'var(--pc-text-2)' }}>New client — all mapped fields inserted</span>
                        )}
                        {r.action === 'update' && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm"
                            style={{ padding: 0 }}
                            onClick={() => setExpandedRow(expanded ? null : r.index)}
                          >
                            {changeCount} field{changeCount === 1 ? '' : 's'} will change {expanded ? '▲' : '▼'}
                          </button>
                        )}
                        {r.action === 'nochange' && (
                          <span style={{ fontSize: 13, color: 'var(--pc-text-3)' }}>Already up to date</span>
                        )}
                        {r.action === 'skip' && (
                          <span style={{ fontSize: 13, color: 'var(--pc-red)' }}>Has validation errors — skipped</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {r.action === 'create' || r.action === 'update' ? (
                          <input
                            type="checkbox"
                            checked={isIncluded(r)}
                            onChange={(e) => setDecisions((p) => ({ ...p, [r.index]: e.target.checked }))}
                          />
                        ) : (
                          <span style={{ color: 'var(--pc-text-3)' }}>—</span>
                        )}
                      </td>
                    </tr>
                    {expanded && r.action === 'update' && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--pc-tint)', padding: '8px 12px' }}>
                          <table className="export-table" style={{ margin: 0 }}>
                            <thead>
                              <tr><th>Field</th><th>Current</th><th>Imported</th><th style={{ width: 160 }}>Result</th></tr>
                            </thead>
                            <tbody>
                              {r.diffs.map((d, k) => (
                                <tr key={k}>
                                  <td>{fieldLabel(d.field)}</td>
                                  <td style={{ color: 'var(--pc-text-2)' }}>{d.current || '—'}</td>
                                  <td>{d.incoming || '—'}</td>
                                  <td>
                                    {d.willChange
                                      ? <span style={{ color: 'var(--pc-green)' }}>will update</span>
                                      : <span style={{ color: 'var(--pc-text-3)' }}>kept — field not empty</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap', marginTop: 16,
          }}>
            <span style={{
              fontSize: 13, color: 'var(--pc-text-2)',
              padding: '10px 12px', background: '#eef1f5', borderRadius: 6,
            }}>
              <strong>{includedCount}</strong> client{includedCount === 1 ? '' : 's'} selected for import.
              The execute step (with progress + result summary) is the next phase.
            </span>
            <Button variant="primary" onClick={() => setStep(6)}>
              Continue to import →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ================= Step 4 — validation preview =================
  if (step === 4 && sheet) {
    const errorRows = rowResults.filter((r) => r.issues.some((i) => i.level === 'error'));
    const warnRows = rowResults.filter(
      (r) => !r.issues.some((i) => i.level === 'error') && r.issues.some((i) => i.level === 'warning'),
    );
    const cleanCount = rowResults.length - errorRows.length - warnRows.length;
    const preview = rowResults.slice(0, 15);
    return (
      <div className="dashboard">
        <Toolbar
          title="Smart Import"
          actions={
            <>
              <Button variant="secondary" onClick={() => setStep(3)}>← Back</Button>
              <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={reset}>Start over</Button>
            </>
          }
        >
          <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
            Step 4 of 6 — validation · <strong>{fileName}</strong> › {selectedSheet}
          </span>
        </Toolbar>

        <div className="form-section">
          <h3>Validation preview</h3>
          <p style={{ fontSize: 13, color: 'var(--pc-text-2)', marginTop: 0 }}>
            {rowResults.length.toLocaleString()} row{rowResults.length === 1 ? '' : 's'} checked ·{' '}
            <strong style={{ color: 'var(--pc-red)' }}>{errorRows.length}</strong> with errors (won't import) ·{' '}
            <strong style={{ color: '#b45309' }}>{warnRows.length}</strong> with warnings ·{' '}
            <strong style={{ color: 'var(--pc-green)' }}>{cleanCount}</strong> clean
          </p>

          <table className="export-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Row</th>
                <th>Name</th>
                <th>Code</th>
                <th>VAT</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => {
                const blocked = r.issues.some((i) => i.level === 'error');
                return (
                  <tr key={r.index} style={blocked ? { background: 'rgba(239,68,68,0.06)' } : undefined}>
                    <td>{r.index + 2}</td>
                    <td><strong>{String(r.record.name ?? '') || <span style={{ color: 'var(--pc-text-3)' }}>—</span>}</strong></td>
                    <td>{String(r.record.client_code ?? '') || '—'}</td>
                    <td>{String(r.record.vat_number ?? '') || '—'}</td>
                    <td>
                      {r.issues.length === 0 ? (
                        <span style={{ color: 'var(--pc-green)', fontSize: 13 }}>✓ OK</span>
                      ) : (
                        r.issues.map((iss, k) => (
                          <div key={k} style={{ fontSize: 12, color: iss.level === 'error' ? 'var(--pc-red)' : '#b45309' }}>
                            {iss.level === 'error' ? '✕' : '⚠'} {fieldLabel(iss.field)}: {iss.message}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rowResults.length > preview.length && (
            <p style={{ fontSize: 12, color: 'var(--pc-text-3)', marginTop: 6 }}>
              Showing the first {preview.length} rows. The counts above cover all {rowResults.length.toLocaleString()} rows.
            </p>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap', marginTop: 16,
          }}>
            <span style={{
              fontSize: 13, color: 'var(--pc-text-2)',
              padding: '10px 12px', background: '#eef1f5', borderRadius: 6,
            }}>
              Rows with errors are skipped at import. Per-client review and the import
              itself come in the next phases.
            </span>
            <Button variant="primary" onClick={() => setStep(5)}>
              Continue to review →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ================= Step 3 — editable mapping =================
  if (step === 3 && sheet) {
    return (
      <div className="dashboard">
        <Toolbar
          title="Smart Import"
          actions={
            <>
              <Button variant="secondary" onClick={() => setStep(2)}>← Back</Button>
              <Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={reset}>Start over</Button>
            </>
          }
        >
          <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
            Step 3 of 6 — map columns · <strong>{fileName}</strong> › {selectedSheet}
          </span>
        </Toolbar>

        <div className="form-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Map columns to client fields</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {savedMappings.length > 0 && (
                <select
                  className="form-input"
                  defaultValue=""
                  onChange={(e) => {
                    const m = savedMappings.find((x) => x.id === e.target.value);
                    if (m) applyMapping(m);
                    e.target.value = '';
                  }}
                  style={{ maxWidth: 220 }}
                  title="Apply a saved mapping"
                >
                  <option value="">Load saved mapping…</option>
                  {savedMappings.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.is_shared ? ' (shared)' : ''}</option>
                  ))}
                </select>
              )}
              <Button variant="secondary" size="sm" onClick={() => setShowSave(true)}>Save mapping</Button>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--pc-text-2)', margin: '6px 0 12px' }}>
            Each spreadsheet column is pre-filled with its best-guess field. Correct any that are
            wrong, and set columns you don't want to <em>Ignore</em>.
          </p>

          <table className="export-table">
            <thead>
              <tr>
                <th style={{ width: '26%' }}>Spreadsheet column</th>
                <th>Sample values</th>
                <th style={{ width: '30%' }}>Map to field</th>
              </tr>
            </thead>
            <tbody>
              {sheet.headers.map((h, i) => {
                const samples = sampleValues(i).filter(Boolean);
                const lowConfidence = !!matches[i]?.fieldKey
                  && matches[i].confidence < CONFIDENT_THRESHOLD
                  && mapping[i] === matches[i].fieldKey;
                return (
                  <tr key={i}>
                    <td>
                      <strong>{h || <span style={{ color: 'var(--pc-text-3)' }}>(unnamed)</span>}</strong>
                      {lowConfidence && (
                        <div style={{ fontSize: 11, color: '#b45309' }}>low-confidence guess — please check</div>
                      )}
                    </td>
                    <td style={{ color: 'var(--pc-text-2)', fontSize: 13 }}>
                      {samples.length ? samples.join('  ·  ') : <span style={{ color: 'var(--pc-text-3)' }}>—</span>}
                    </td>
                    <td>
                      <select
                        className="form-input"
                        value={mapping[i] ?? ''}
                        onChange={(e) => setMapping((p) => ({ ...p, [i]: e.target.value }))}
                        style={{ width: '100%' }}
                      >
                        <option value="">— Ignore this column —</option>
                        {FIELD_GROUPS.map((g) => (
                          <optgroup key={g} label={g}>
                            {IMPORT_FIELDS.filter((f) => f.group === g).map((f) => (
                              <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Validation */}
          <div style={{ marginTop: 12 }}>
            {!nameMapped && (
              <p style={{ fontSize: 13, color: 'var(--pc-red)', margin: '4px 0' }}>
                ⚠ A column must be mapped to <strong>Name (primary)</strong> — it's required.
              </p>
            )}
            {duplicateKeys.length > 0 && (
              <p style={{ fontSize: 13, color: '#b45309', margin: '4px 0' }}>
                ⚠ Mapped more than once: {duplicateKeys.map(fieldLabel).join(', ')}. The last column wins.
              </p>
            )}
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap', marginTop: 16,
          }}>
            <span style={{
              fontSize: 13, color: 'var(--pc-text-2)',
              padding: '10px 12px', background: '#eef1f5', borderRadius: 6,
            }}>
              ✓ Mapping ready. Next is a validation preview of every row.
            </span>
            <Button
              variant="primary"
              disabled={!nameMapped}
              onClick={() => setStep(4)}
              title={nameMapped ? '' : 'Map a column to Name first'}
            >
              Continue to validation →
            </Button>
          </div>
        </div>

        <Modal
          open={showSave}
          onClose={() => setShowSave(false)}
          title="Save column mapping"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowSave(false)} disabled={saveBusy}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveMapping} disabled={saveBusy}>
                {saveBusy ? 'Saving…' : 'Save mapping'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="Mapping name" required helper="Re-using the same name overwrites that mapping.">
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. BTMS Client List Format" autoFocus />
            </FormField>
            <FormField label="Description">
              <Input value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} placeholder="Optional notes" />
            </FormField>
          </div>
        </Modal>
      </div>
    );
  }

  // ================= Step 2 — detected columns =================
  if (step === 2 && sheet) {
    return (
      <div className="dashboard">
        <Toolbar
          title="Smart Import"
          actions={<Button variant="secondary" leftIcon={<RotateCcw size={15} />} onClick={reset}>Start over</Button>}
        >
          <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
            Step 2 of 6 — column detection · <strong>{fileName}</strong> › {selectedSheet}
          </span>
        </Toolbar>

        <div className="form-section">
          <h3>Detected columns</h3>
          <p style={{ fontSize: 13, color: 'var(--pc-text-2)', marginTop: 0 }}>
            {sheet.headers.length} column{sheet.headers.length === 1 ? '' : 's'} and{' '}
            {sheet.rows.length.toLocaleString()} data row{sheet.rows.length === 1 ? '' : 's'} found.{' '}
            <strong>{confidentCount}</strong> column{confidentCount === 1 ? '' : 's'} auto-matched
            with confidence; you review and correct all of them next.
          </p>

          <table className="export-table">
            <thead>
              <tr>
                <th>Spreadsheet column</th>
                <th>Sample values</th>
                <th>Auto-matched field</th>
                <th style={{ textAlign: 'center' }}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {sheet.headers.map((h, i) => {
                const m = matches[i];
                const confident = !!m?.fieldKey && m.confidence >= CONFIDENT_THRESHOLD;
                const samples = sampleValues(i).filter(Boolean);
                return (
                  <tr key={i}>
                    <td><strong>{h || <span style={{ color: 'var(--pc-text-3)' }}>(unnamed)</span>}</strong></td>
                    <td style={{ color: 'var(--pc-text-2)', fontSize: 13 }}>
                      {samples.length ? samples.join('  ·  ') : <span style={{ color: 'var(--pc-text-3)' }}>—</span>}
                    </td>
                    <td>
                      {m?.fieldKey
                        ? fieldLabel(m.fieldKey)
                        : <span style={{ color: 'var(--pc-text-3)' }}>No match — map manually</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {m?.fieldKey ? (
                        <span style={{
                          fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                          background: confident ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)',
                          color: confident ? '#047857' : '#b45309',
                        }}>
                          {confident ? `${m.confidence}%` : 'Needs review'}
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                          background: '#eef1f5', color: 'var(--pc-navy-2)',
                        }}>Unmapped</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={startMapping}>Continue to mapping →</Button>
          </div>
        </div>
      </div>
    );
  }

  // ================= Step 1 — upload + sheet pick =================
  return (
    <div className="dashboard">
      <Toolbar title="Smart Import">
        <span style={{ fontSize: 'var(--pc-fs-13)', color: 'var(--pc-text-2)' }}>
          Step 1 of 6 — upload an Excel file of client data. Any column layout works;
          you map the columns next.
        </span>
      </Toolbar>

      <div className="form-section">
        <h3>1. Upload spreadsheet</h3>
        <div
          className={`file-upload ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) readFile(f);
          }}
          onClick={() => document.getElementById('smart-import-file')?.click()}
        >
          <div className="upload-icon"><Upload size={36} /></div>
          <div className="upload-text">Drop an Excel file here, or click to browse</div>
          <div className="upload-hint">.xlsx or .xls · up to {MAX_FILE_MB} MB</div>
          <input
            id="smart-import-file"
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }}
          />
        </div>

        {error && (
          <p style={{ color: 'var(--pc-red)', fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
      </div>

      {workbook && (
        <div className="form-section">
          <h3>2. Choose the sheet to import</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <FileSpreadsheet size={18} color="var(--pc-text-2)" />
            <strong>{fileName}</strong>
            {sheetNames.length > 1 ? (
              <select
                className="form-input"
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                style={{ maxWidth: 280 }}
              >
                {sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <span style={{ color: 'var(--pc-text-2)', fontSize: 14 }}>Sheet: {selectedSheet}</span>
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={detectColumns}>Detect columns →</Button>
          </div>
        </div>
      )}
    </div>
  );
}
