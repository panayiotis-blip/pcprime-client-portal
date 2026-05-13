import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';

// Column-name aliases — map various spreadsheet header names to our canonical
// client field names. The pc_prime template's columns mostly match, but a few
// rename for clarity (e.g. "Name as per Tax office return").
const HEADER_ALIASES: Record<string, string> = {
  'name as per tax office return': 'name_tax_office',
  'name tax office':                'name_tax_office',
  'tax return type':                'tax_return_type',
  'contact_email':                  'email',
  'tax office return':              'name_tax_office',
};

const KNOWN_FIELDS = new Set([
  'client_code', 'name', 'name_tax_office', 'trading_name', 'business_type',
  'client_category', 'tax_return_type', 'status',
  'tax_number', 'vat_number', 'registration_number',
  'employer_number', 'ergani_number', 'id_number', 'passport_number',
  'date_of_birth', 'nationality', 'contact_person', 'director_name',
  'email', 'phone', 'mobile', 'fax', 'website',
  'address', 'city', 'postal_code', 'country',
  'incorporation_date', 'year_end_date', 'financial_year_end', 'vat_period',
  'notes',
]);

type CredentialRow = {
  client_code: string;
  platform: string;
  username?: string;
  password?: string;
  notes?: string;
};

type ParsedClient = Record<string, any>;

type Validation = { row: number; level: 'ok' | 'warn' | 'error'; messages: string[] };

// Normalise a spreadsheet date cell into ISO YYYY-MM-DD. xlsx sheet_to_json
// can return Date objects, strings, or Excel serial numbers depending on the
// source. Returns '' if it can't parse.
function normaliseDate(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // Excel serial date — xlsx normally converts these, but be defensive
    const d = XLSX.SSF?.parse_date_code?.(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    return '';
  }
  const s = String(v).trim();
  if (!s) return '';
  // DD/MM/YYYY or DD-MM-YYYY
  const m = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/.exec(s);
  if (m) {
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) >= 50 ? '19' : '20') + yyyy;
    return `${yyyy}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try Date parse fallback
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function mapHeader(header: string): string | null {
  const h = String(header || '').trim().toLowerCase();
  if (!h || h.startsWith('__empty')) return null;
  if (HEADER_ALIASES[h]) return HEADER_ALIASES[h];
  // Also try as-is — most of our template headers already match
  const candidate = h.replace(/\s+/g, '_');
  if (KNOWN_FIELDS.has(candidate)) return candidate;
  return null;
}

function transformRow(rawRow: any, columnMap: Record<string, string>): ParsedClient {
  const out: ParsedClient = {};
  for (const rawKey of Object.keys(rawRow)) {
    const targetField = columnMap[rawKey];
    if (!targetField) continue;
    let val = rawRow[rawKey];
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') val = val.trim();
    if (val === '') continue;
    // Date normalisation
    if (targetField === 'date_of_birth' || targetField === 'incorporation_date') {
      const d = normaliseDate(val);
      if (d) out[targetField] = d;
      continue;
    }
    out[targetField] = val;
  }
  return out;
}

function validateRow(row: ParsedClient, idx: number): Validation {
  const msgs: string[] = [];
  let level: Validation['level'] = 'ok';

  if (!row.name || String(row.name).trim() === '') {
    msgs.push('name is required');
    level = 'error';
  }

  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email))) {
    msgs.push('email looks invalid');
    if (level !== 'error') level = 'warn';
  }

  if (row.year_end_date && !/^(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])$/.test(String(row.year_end_date))) {
    msgs.push('year_end_date should be DD/MM');
    if (level !== 'error') level = 'warn';
  }

  if (row.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date_of_birth))) {
    msgs.push('date_of_birth could not be parsed');
    if (level !== 'error') level = 'warn';
  }

  if (row.incorporation_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.incorporation_date))) {
    msgs.push('incorporation_date could not be parsed');
    if (level !== 'error') level = 'warn';
  }

  return { row: idx, level, messages: msgs };
}

export default function BulkImport() {
  const { user } = useAuth();
  const { refreshClients } = useApp();
  const { runWith } = useMFAStepUp();

  // Page-level gate (Owner or Supervisor only)
  const allowed = user?.role === 'owner' || user?.role === 'supervisor';

  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'complete'>('upload');
  const [error, setError] = useState<string | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [unmappedColumns, setUnmappedColumns] = useState<string[]>([]);
  const [clientRows, setClientRows] = useState<ParsedClient[]>([]);
  const [credentialRows, setCredentialRows] = useState<CredentialRow[]>([]);
  const [validations, setValidations] = useState<Validation[]>([]);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [result, setResult] = useState<{
    batch_id: string;
    inserted: number;
    errors: number;
    credentials_added: number;
    credential_errors: number;
    error_details: any[];
  } | null>(null);
  const [recentBatches, setRecentBatches] = useState<any[]>([]);

  const loadBatches = async () => {
    try {
      const data = await api.listRecentBulkImports();
      setRecentBatches(data);
    } catch {}
  };

  useEffect(() => { if (allowed) loadBatches(); }, [allowed]);

  if (!allowed) {
    return (
      <div className="dashboard">
        <div className="dashboard-header"><h2>Bulk Import</h2></div>
        <div className="empty-state">
          <p>Bulk import is restricted to Owner and Supervisor roles.</p>
          <p style={{ marginTop: 8, fontSize: 13, color: '#64748b' }}>
            Your current role: <strong>{user?.role || 'unknown'}</strong>
          </p>
        </div>
      </div>
    );
  }

  const reset = () => {
    setStep('upload');
    setError(null);
    setClientRows([]);
    setCredentialRows([]);
    setValidations([]);
    setColumnMap({});
    setUnmappedColumns([]);
    setConfirmPhrase('');
    setProgress({ current: 0, total: 0, phase: '' });
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });

      const sheetClients = wb.Sheets['Clients'];
      if (!sheetClients) {
        throw new Error('No "Clients" sheet found in the workbook');
      }
      const rawClients: any[] = XLSX.utils.sheet_to_json(sheetClients, { defval: '' });
      if (rawClients.length === 0) {
        throw new Error('"Clients" sheet is empty');
      }

      // Auto-map columns
      const map: Record<string, string> = {};
      const unmapped: string[] = [];
      const headerKeys = Object.keys(rawClients[0]);
      for (const key of headerKeys) {
        const target = mapHeader(key);
        if (target) map[key] = target;
        else if (!String(key).toLowerCase().startsWith('__empty')) unmapped.push(key);
      }
      setColumnMap(map);
      setUnmappedColumns(unmapped);

      const transformed = rawClients.map(r => transformRow(r, map));
      setClientRows(transformed);
      setValidations(transformed.map((r, i) => validateRow(r, i + 1)));

      // Optional Credentials sheet
      const sheetCreds = wb.Sheets['Credentials'];
      if (sheetCreds) {
        const rawCreds: any[] = XLSX.utils.sheet_to_json(sheetCreds, { defval: '' });
        setCredentialRows(rawCreds
          .map(r => ({
            client_code: String(r.client_code || '').trim(),
            platform:    String(r.platform || '').trim(),
            username:    String(r.username || '').trim(),
            password:    String(r.password || '').trim(),
            notes:       String(r.notes || '').trim(),
          }))
          .filter(c => c.client_code && c.platform)
        );
      } else {
        setCredentialRows([]);
      }

      setStep('preview');
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const validCount = validations.filter(v => v.level === 'ok').length;
  const warnCount  = validations.filter(v => v.level === 'warn').length;
  const errorCount = validations.filter(v => v.level === 'error').length;
  const importableCount = validCount + warnCount;

  const handleImport = async () => {
    setStep('importing');
    setError(null);
    setProgress({ current: 0, total: importableCount, phase: 'Inserting clients…' });

    // Skip rows with errors
    const toImport = clientRows.filter((_, i) => validations[i].level !== 'error');

    try {
      const summary = await runWith(() => api.bulkImportClients(toImport));
      setProgress({ current: summary.inserted, total: importableCount, phase: 'Clients inserted; loading credentials…' });

      // Credentials phase: iterate, find client_id by code, insert
      let credAdded = 0;
      let credErrors = 0;
      const credErrorDetails: any[] = [];
      if (credentialRows.length > 0) {
        setProgress({ current: 0, total: credentialRows.length, phase: 'Adding credentials…' });
        for (let i = 0; i < credentialRows.length; i++) {
          const c = credentialRows[i];
          const clientId = summary.codes_to_ids[c.client_code];
          if (!clientId) {
            credErrors++;
            credErrorDetails.push({ row: i + 1, client_code: c.client_code, error: 'no matching client imported' });
            continue;
          }
          try {
            await api.upsertCredentialForClient(clientId, {
              platform: c.platform,
              username: c.username,
              password: c.password,
              notes: c.notes,
            });
            credAdded++;
          } catch (err: any) {
            credErrors++;
            credErrorDetails.push({ row: i + 1, client_code: c.client_code, error: err.message });
          }
          setProgress({ current: i + 1, total: credentialRows.length, phase: 'Adding credentials…' });
        }
      }

      setResult({
        batch_id: summary.batch_id,
        inserted: summary.inserted,
        errors: summary.errors,
        credentials_added: credAdded,
        credential_errors: credErrors,
        error_details: [...summary.error_details, ...credErrorDetails],
      });
      setStep('complete');
      await refreshClients();
      await loadBatches();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) setError(err.message);
      setStep('preview');
    }
  };

  const handleRollback = async (batchId: string) => {
    if (!confirm(`Rollback batch ${batchId}? This soft-deletes every client imported in this batch.`)) return;
    try {
      const r = await runWith(() => api.rollbackBulkImport(batchId));
      alert(`Rolled back ${r.rolled_back} client(s).`);
      await refreshClients();
      await loadBatches();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Rollback failed: ' + err.message);
    }
  };

  // ===== Render =====
  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Bulk Import Clients</h2>
        <Link to="/clients" className="btn btn-secondary">← Back to Clients</Link>
      </div>

      {step === 'upload' && (
        <>
          <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>1. Upload spreadsheet</h3>
            <p style={{ fontSize: 13, color: '#475569' }}>
              The workbook should have a <strong>Clients</strong> sheet (required) and optionally a <strong>Credentials</strong> sheet.
              Columns are auto-mapped by header name — see the template at the project root for the expected layout.
              Greek characters are supported throughout.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="form-input"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              style={{ marginTop: 12 }}
            />
            {error && (
              <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</p>
            )}
          </div>

          {recentBatches.length > 0 && (
            <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Recent imports (last 7 days)</h3>
              <table className="compliance-table">
                <thead>
                  <tr>
                    <th>Imported</th><th>Batch ID</th><th>Total</th><th>Active</th><th>Age</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentBatches.map(b => (
                    <tr key={b.batch_id}>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(b.imported_at).toLocaleString()}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.batch_id}</td>
                      <td>{b.client_count}</td>
                      <td>{b.active_count}</td>
                      <td>{b.age_hours} h</td>
                      <td>
                        {b.can_rollback ? (
                          <button className="btn btn-danger btn-sm" onClick={() => handleRollback(b.batch_id)}>
                            ↶ Rollback
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>rollback expired</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {step === 'preview' && (
        <>
          <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>2. Preview &amp; validate</h3>
            <p style={{ fontSize: 14, color: '#0f172a' }}>
              <strong>{clientRows.length}</strong> rows · <span style={{ color: '#047857' }}>{validCount} valid</span> · <span style={{ color: '#b45309' }}>{warnCount} warnings</span> · <span style={{ color: '#b91c1c' }}>{errorCount} errors</span> · <strong>{importableCount}</strong> will be imported
              {credentialRows.length > 0 && <>; <strong>{credentialRows.length}</strong> credential row{credentialRows.length === 1 ? '' : 's'} to follow</>}.
            </p>
            {unmappedColumns.length > 0 && (
              <p style={{ fontSize: 13, color: '#b45309' }}>
                Unmapped columns (will be ignored on import): <code>{unmappedColumns.join(', ')}</code>
              </p>
            )}
            <p style={{ fontSize: 12, color: '#64748b' }}>
              Rows with errors will be skipped. Rows with warnings will still import.
            </p>
            <div style={{ marginTop: 12, maxHeight: 400, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <table className="compliance-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Row</th>
                    <th>Status</th>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {clientRows.map((r, i) => {
                    const v = validations[i];
                    const colour = v.level === 'error' ? '#fee2e2' : v.level === 'warn' ? '#fef3c7' : '';
                    return (
                      <tr key={i} style={{ background: colour }}>
                        <td>{i + 1}</td>
                        <td>{v.level === 'ok' ? '✅' : v.level === 'warn' ? '⚠️' : '❌'}</td>
                        <td style={{ fontFamily: 'monospace' }}>{r.client_code || <em style={{ color: '#94a3b8' }}>auto</em>}</td>
                        <td>{r.name || <em style={{ color: '#b91c1c' }}>(missing)</em>}</td>
                        <td>{r.business_type || ''}</td>
                        <td style={{ fontSize: 11, color: '#475569' }}>{v.messages.join('; ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>3. Confirm</h3>
            <p style={{ fontSize: 14 }}>
              Type <code style={{ background: '#dbeafe', padding: '1px 6px', borderRadius: 3 }}>IMPORT</code> below to commit.
            </p>
            <input
              type="text"
              className="form-input"
              value={confirmPhrase}
              onChange={e => setConfirmPhrase(e.target.value)}
              placeholder="IMPORT"
              style={{ maxWidth: 200 }}
              autoComplete="off"
              spellCheck={false}
            />
            {error && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={reset}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={confirmPhrase !== 'IMPORT' || importableCount === 0}
              >
                Import {importableCount} client{importableCount === 1 ? '' : 's'}
                {credentialRows.length > 0 && <> + {credentialRows.length} credentials</>}
              </button>
            </div>
          </div>
        </>
      )}

      {step === 'importing' && (
        <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Importing…</h3>
          <p style={{ fontSize: 14 }}>{progress.phase}</p>
          <div style={{ background: '#e2e8f0', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 12 }}>
            <div style={{
              width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%',
              height: '100%',
              background: '#6366f1',
              transition: 'width 0.2s',
            }} />
          </div>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
            {progress.current} / {progress.total}
          </p>
        </div>
      )}

      {step === 'complete' && result && (
        <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
          <h3 style={{ margin: 0, color: '#047857' }}>✓ Import complete</h3>
          <p style={{ fontSize: 14, marginTop: 8 }}>
            Batch <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{result.batch_id}</code>
          </p>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
            <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.inserted}</strong> clients inserted</li>
            {result.errors > 0 && <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9', color: '#b45309' }}><strong>{result.errors}</strong> client rows skipped (see details below)</li>}
            {result.credentials_added > 0 && <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.credentials_added}</strong> credentials added</li>}
            {result.credential_errors > 0 && <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9', color: '#b45309' }}><strong>{result.credential_errors}</strong> credentials skipped</li>}
          </ul>
          {result.error_details.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>Error details ({result.error_details.length})</summary>
              <ul style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                {result.error_details.map((e, i) => (
                  <li key={i}>Row {e.row}{e.client_code ? ` (${e.client_code})` : ''}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={reset}>Import another file</button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleRollback(result.batch_id)}
              title="Rollback available for 24 hours after import"
            >
              ↶ Rollback this batch
            </button>
            <Link to="/clients" className="btn btn-primary">Open Clients</Link>
          </div>
        </div>
      )}
    </div>
  );
}
