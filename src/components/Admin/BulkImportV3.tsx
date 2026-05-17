import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';

interface ParsedFile {
  clients: any[];
  contacts: any[];
  directors: any[];
  credentials: any[];
  tax_filings: any[];
}

function emptyParsed(): ParsedFile {
  return { clients: [], contacts: [], directors: [], credentials: [], tax_filings: [] };
}

// V3-format bulk import for the consolidated additional_data_import.xlsx file.
// Reads 5 sheets in one go, sends to the bulk_import_v3 RPC in one transaction.
export default function BulkImportV3() {
  const { user } = useAuth();
  const { refreshClients } = useApp();
  const { runWith } = useMFAStepUp();
  const fileRef = useRef<HTMLInputElement>(null);

  const allowed = user?.role === 'owner' || user?.role === 'supervisor';

  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'complete'>('upload');
  const [parsed, setParsed] = useState<ParsedFile>(emptyParsed());
  const [missingSheets, setMissingSheets] = useState<string[]>([]);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  if (!allowed) {
    return (
      <div className="dashboard">
        <div className="dashboard-header"><h2>Bulk Import V3</h2></div>
        <div className="empty-state">
          <p>Bulk import is restricted to Owner and Supervisor roles.</p>
        </div>
      </div>
    );
  }

  const reset = () => {
    setStep('upload');
    setParsed(emptyParsed());
    setMissingSheets([]);
    setConfirmPhrase('');
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });

      const missing: string[] = [];
      const required = ['Clients'];
      const optional = ['Contacts', 'Relationships', 'Platform Logins', 'Tax Filings'];
      for (const s of required) if (!wb.Sheets[s]) missing.push(s + ' (REQUIRED)');
      for (const s of optional) if (!wb.Sheets[s]) missing.push(s);
      setMissingSheets(missing);

      if (!wb.Sheets['Clients']) {
        throw new Error('Workbook must contain a "Clients" sheet');
      }

      // ---- Clients ----
      const rawClients = XLSX.utils.sheet_to_json(wb.Sheets['Clients'], { defval: '' });
      const clients = rawClients.map((r: any) => ({
        client_code: String(r['Client Code'] || '').trim(),
        name:        String(r['Client Name'] || '').trim(),
        type:        String(r['Type'] || '').trim(),
        tic:         String(r['TIC'] || '').trim(),
        he_number:   String(r['HE Number'] || '').trim(),
        category:    String(r['Category'] || '').trim(),
        status:      String(r['Status'] || '').trim(),
      })).filter((c: any) => c.client_code && c.name);

      // ---- Contacts ----
      let contacts: any[] = [];
      if (wb.Sheets['Contacts']) {
        const raw = XLSX.utils.sheet_to_json(wb.Sheets['Contacts'], { defval: '' });
        contacts = raw.map((r: any) => ({
          client_code:    String(r['Client Code'] || '').trim(),
          email:          String(r['Email'] || '').trim(),
          phone:          String(r['Phone'] || '').trim(),
          mobile:         String(r['Mobile'] || '').trim(),
          fax:            String(r['Fax'] || '').trim(),
          contact_person: String(r['Contact Person'] || '').trim(),
          address:        String(r['Address'] || '').trim(),
        })).filter((c: any) => c.client_code && (c.email || c.phone || c.mobile || c.fax || c.contact_person || c.address));
      }

      // ---- Directors / Relationships ----
      let directors: any[] = [];
      if (wb.Sheets['Relationships']) {
        const raw = XLSX.utils.sheet_to_json(wb.Sheets['Relationships'], { defval: '' });
        directors = raw.map((r: any) => ({
          company_code:    String(r['Company Code'] || '').trim(),
          individual_code: String(r['Individual Code'] || '').trim(),
          individual_name: String(r['Individual Name'] || '').trim(),
          role:            String(r['Role'] || '').trim(),
        })).filter((d: any) => d.company_code);
      }

      // ---- Platform Logins → credentials ----
      let credentials: any[] = [];
      if (wb.Sheets['Platform Logins']) {
        const raw = XLSX.utils.sheet_to_json(wb.Sheets['Platform Logins'], { defval: '' });
        credentials = raw.map((r: any) => ({
          client_code: String(r['Client Code'] || '').trim(),
          platform:    String(r['Platform'] || '').trim(),
          sub_type:    String(r['Sub-Type'] || '').trim(),
          username:    String(r['Username'] || '').trim(),
          password:    String(r['Password'] || ''),
          notes:       String(r['Notes'] || '').trim(),
        })).filter((c: any) => c.client_code && c.platform);
      }

      // ---- Tax Filings ----
      let tax_filings: any[] = [];
      if (wb.Sheets['Tax Filings']) {
        const raw = XLSX.utils.sheet_to_json(wb.Sheets['Tax Filings'], { defval: '' });
        tax_filings = raw.map((r: any) => ({
          client_code: String(r['Client Code'] || '').trim(),
          tax_year:    Number(r['Tax Year']) || null,
          filing_type: String(r['Filing Type'] || '').trim(),
          status:      String(r['Status'] || '').trim(),
        })).filter((t: any) => t.client_code && t.tax_year);
      }

      setParsed({ clients, contacts, directors, credentials, tax_filings });
      setStep('preview');
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const handleImport = async () => {
    setStep('importing');
    setError(null);
    try {
      const summary = await runWith(() => api.bulkImportV3(parsed));
      setResult(summary);
      setStep('complete');
      await refreshClients();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) setError(err.message);
      setStep('preview');
    }
  };

  // Greek sanity samples for the preview
  const greekSamples = parsed.clients
    .filter(c => /[Ͱ-Ͽ]/.test(c.name))
    .slice(0, 3);

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Bulk Import V3 — multi-sheet</h2>
        <Link to="/clients" className="btn btn-secondary">← Back to Clients</Link>
      </div>

      {step === 'upload' && (
        <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Upload <code>additional_data_import.xlsx</code></h3>
          <p style={{ fontSize: 13, color: '#475569' }}>
            Multi-sheet import. Required: <strong>Clients</strong>. Optional:{' '}
            <strong>Contacts</strong>, <strong>Relationships</strong>, <strong>Platform Logins</strong>, <strong>Tax Filings</strong>.
            All sheets process in one transaction; one summary audit entry is written. Greek characters preserved end-to-end.
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
          {error && <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
      )}

      {step === 'preview' && (
        <>
          <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Preview</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{parsed.clients.length}</strong> clients</li>
              <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{parsed.contacts.length}</strong> contact updates</li>
              <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{parsed.directors.length}</strong> director relationships</li>
              <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{parsed.credentials.length}</strong> platform credentials</li>
              <li style={{ padding: '4px 0' }}><strong>{parsed.tax_filings.length}</strong> tax filings</li>
            </ul>
            {missingSheets.length > 0 && (
              <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
                Optional sheets not found: {missingSheets.join(', ')} — those sections skipped.
              </p>
            )}
            {greekSamples.length > 0 && (
              <div style={{ marginTop: 12, padding: 10, background: '#f0fdf4', borderRadius: 6, fontSize: 12 }}>
                <strong>Greek text sanity check (first 3):</strong>
                <ul style={{ margin: '4px 0 0 16px' }}>
                  {greekSamples.map((c, i) => <li key={i}>{c.client_code} — {c.name}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Confirm</h3>
            <p style={{ fontSize: 14 }}>
              Type <code style={{ background: '#dbeafe', padding: '1px 6px', borderRadius: 3 }}>IMPORT</code> to commit.
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
                disabled={confirmPhrase !== 'IMPORT' || parsed.clients.length === 0}
              >
                Import {parsed.clients.length} clients + linked data
              </button>
            </div>
          </div>
        </>
      )}

      {step === 'importing' && (
        <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Importing…</h3>
          <p>One transaction, may take 30–60 seconds for the full 5 sheets. Please don't navigate away.</p>
          <div style={{ background: '#e2e8f0', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 12 }}>
            <div style={{
              width: '40%', height: '100%', background: 'var(--pc-navy-2)',
              animation: 'progress-pulse 1.5s ease-in-out infinite',
            }} />
          </div>
          <style>{`@keyframes progress-pulse { 0%, 100% { transform: translateX(-100%); } 50% { transform: translateX(150%); } }`}</style>
        </div>
      )}

      {step === 'complete' && result && (
        <div style={{ padding: 20, background: 'white', border: '1px solid var(--border)', borderRadius: 8, marginTop: 16 }}>
          <h3 style={{ margin: 0, color: '#047857' }}>✓ Import complete</h3>
          <p style={{ fontSize: 14, marginTop: 8 }}>
            Batch <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{result.batch_id}</code>
          </p>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
            <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.clients}</strong> clients inserted</li>
            <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.contacts}</strong> contact updates</li>
            <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.directors}</strong> directors</li>
            <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.credentials}</strong> credentials encrypted</li>
            <li style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}><strong>{result.tax_filings}</strong> tax filings</li>
            {result.errors > 0 && <li style={{ padding: '4px 0', color: '#b45309' }}><strong>{result.errors}</strong> rows skipped — see details</li>}
          </ul>
          {result.error_details && result.error_details.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>Error details ({result.error_details.length})</summary>
              <ul style={{ marginTop: 8, fontSize: 12, color: '#475569', maxHeight: 300, overflowY: 'auto' }}>
                {result.error_details.map((e: any, i: number) => (
                  <li key={i}>[{e.section}] Row {e.row}{e.client_code ? ` (${e.client_code})` : ''}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={reset}>Import another</button>
            <Link to="/clients" className="btn btn-primary">Open Clients</Link>
          </div>
        </div>
      )}
    </div>
  );
}
