import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';

// Firm-level master Chart of Accounts (migration 097). Edits here are the
// template that new clients are auto-seeded from, and that existing clients
// can pull via "Apply Master" on their own CoA page.

const CATEGORIES = ['Income', 'Expense', 'Asset', 'Liability', 'Equity'];

// Map the raw "Type" column from the spreadsheet to one of the 5 categories
// the rest of the app uses. Mirrors the migration's seed-time mapping.
function mapType(t: string): string {
  const x = String(t || '').trim().toLowerCase();
  if (x === 'income') return 'Income';
  if (x === 'expenditure' || x === 'expense' || x === 'expenses') return 'Expense';
  if (x === 'asset' || x === 'debtor') return 'Asset';
  if (x === 'liability' || x === 'creditor') return 'Liability';
  if (x === 'equity') return 'Equity';
  return 'Expense';
}

type MasterAccount = {
  id: number;
  code: string;
  description: string;
  category: string;
  type_raw: string | null;
  active: boolean;
  is_header: boolean;
  report_category: string | null;
};

export default function MasterChartOfAccounts() {
  const [accounts, setAccounts] = useState<MasterAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterReport, setFilterReport] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('Expense');
  const [newReportCat, setNewReportCat] = useState('');
  const [newIsHeader, setNewIsHeader] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getMasterAccounts();
      setAccounts(rows);
    } catch (err: any) {
      alert('Failed to load master accounts: ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newCode.trim() || !newDesc.trim()) return;
    try {
      await api.createMasterAccount({
        code: newCode.trim(),
        description: newDesc.trim(),
        category: newCategory,
        report_category: newReportCat.trim() || null,
        is_header: newIsHeader,
        active: true,
      });
      setNewCode(''); setNewDesc(''); setNewReportCat(''); setNewIsHeader(false);
      setShowAdd(false);
      await load();
    } catch (err: any) {
      alert('Add failed: ' + (err?.message || String(err)));
    }
  };

  const handleDelete = async (acc: MasterAccount) => {
    if (!confirm(`Delete ${acc.code} — ${acc.description}?\n\nThis removes it from the master only; existing client copies are kept.`)) return;
    try {
      await api.deleteMasterAccount(acc.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || String(err)));
    }
  };

  const handleApplyToAll = async () => {
    if (!confirm(
      `Apply master CoA to ALL clients?\n\n` +
      `For each client, codes they don't already have will be added. ` +
      `Existing codes (and any edits they've made) are left untouched.`,
    )) return;
    setApplying(true);
    try {
      const r = await api.applyMasterToAllClients();
      alert(
        `Done.\n\n` +
        `${r.clientCount} clients processed.\n` +
        `${r.totalInserted} account(s) added across all clients.\n` +
        `${r.totalSkipped} skipped (already existed).`,
      );
    } catch (err: any) {
      alert('Apply-to-all failed: ' + (err?.message || String(err)));
    } finally {
      setApplying(false);
    }
  };

  // Re-import: lets the user refresh the master from a newer Excel without
  // touching client copies. Same column conventions as the per-client import
  // (Code / Description / Type / Active / Header / Report Category).
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(
      `Import "${file.name}" into the master?\n\n` +
      `New codes are added; existing codes are UPDATED with the spreadsheet values. ` +
      `Codes already present in the master that are NOT in this file are left alone.`,
    )) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

      // Identify columns by header — accept several common variants.
      let codeCol = -1, descCol = -1, typeCol = -1, activeCol = -1, headerCol = -1, reportCol = -1;
      let startRow = 0;
      for (let r = 0; r < Math.min(rows.length, 8); r++) {
        const row = rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').toLowerCase().trim();
          if (!val) continue;
          if (codeCol < 0 && (val === 'code' || val.includes('account code') || val.includes('a/c'))) codeCol = c;
          if (descCol < 0 && (val === 'description' || val === 'name' || val.includes('description') || val.includes('account name'))) descCol = c;
          if (typeCol < 0 && (val === 'type' || val === 'category' || val === 'class')) typeCol = c;
          if (activeCol < 0 && (val === 'active' || val === 'enabled')) activeCol = c;
          if (headerCol < 0 && (val === 'header' || val === 'is header' || val === 'isheader')) headerCol = c;
          if (reportCol < 0 && (val === 'report category' || val === 'report' || val === 'category group')) reportCol = c;
        }
        if (codeCol >= 0 && descCol >= 0) { startRow = r + 1; break; }
      }
      if (codeCol < 0 || descCol < 0) {
        alert('Could not find Code and Description columns in the file.');
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
        return;
      }

      const existingByCode = new Map(accounts.map(a => [a.code, a]));
      let added = 0, updated = 0;
      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        const code = String(row[codeCol] || '').trim();
        const description = String(row[descCol] || '').trim();
        if (!code || !description) continue;
        const rawType = typeCol >= 0 ? String(row[typeCol] || '') : '';
        const category = mapType(rawType);
        const active = activeCol >= 0 ? (row[activeCol] === 1 || row[activeCol] === '1' || row[activeCol] === true || String(row[activeCol]).toLowerCase() === 'true') : true;
        const isHeader = headerCol >= 0 && (row[headerCol] === 1 || row[headerCol] === '1' || row[headerCol] === true || String(row[headerCol]).toLowerCase() === 'true');
        const reportCat = reportCol >= 0 ? String(row[reportCol] || '').trim() : '';
        const existing = existingByCode.get(code);
        if (existing) {
          await api.updateMasterAccount(existing.id, {
            description, category, type_raw: rawType, active, is_header: isHeader, report_category: reportCat || null,
          });
          updated++;
        } else {
          await api.createMasterAccount({ code, description, category, active, is_header: isHeader, report_category: reportCat || null });
          added++;
        }
      }
      alert(`Re-import done: ${added} added, ${updated} updated.`);
      await load();
    } catch (err: any) {
      alert('Import failed: ' + (err?.message || String(err)));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Distinct report categories for the filter dropdown.
  const reportCategories = Array.from(new Set(accounts.map(a => a.report_category).filter(Boolean))) as string[];
  reportCategories.sort();

  const filtered = accounts.filter(a => {
    if (filterCategory && a.category !== filterCategory) return false;
    if (filterReport && a.report_category !== filterReport) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      return a.code.toLowerCase().includes(t) || a.description.toLowerCase().includes(t);
    }
    return true;
  });

  const cellEditable: React.CSSProperties = { padding: '3px 8px', fontSize: 12 };

  return (
    <div style={{ padding: '1rem 1.5rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={{ color: '#1a365d', margin: 0 }}>Master Chart of Accounts</h2>
        <Link to="/" style={{ fontSize: 13, color: '#1e40af' }}>← Back to dashboard</Link>
      </div>
      <p style={{ color: '#5a6478', fontSize: 14, marginTop: 4 }}>
        The firm-level template used to seed every new client. {accounts.length} account(s).
        Edits here don't change existing clients automatically — use "Apply to all clients" below.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(!showAdd)}>+ Add Account</button>
        <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? 'Importing…' : '↑ Re-import from Excel'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileImport} style={{ display: 'none' }} />
        <button className="btn btn-warning btn-sm" onClick={handleApplyToAll} disabled={applying || accounts.length === 0}>
          {applying ? 'Applying to all clients…' : '⇒ Apply to ALL clients'}
        </button>
      </div>

      {showAdd && (
        <div className="card" style={{ background: '#f8fafc', padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 140px 160px', gap: 8 }}>
            <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} className="form-input" placeholder="Code" />
            <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="form-input" placeholder="Description" />
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="form-input">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" value={newReportCat} onChange={(e) => setNewReportCat(e.target.value)} className="form-input" placeholder="Report category" />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 8 }}>
            <input type="checkbox" checked={newIsHeader} onChange={(e) => setNewIsHeader(e.target.checked)} />
            Header row (group label, not a postable account)
          </label>
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleAdd}>Save</button>{' '}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-input" placeholder="Search code or description…" style={{ flex: 1 }} />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="form-input" style={{ width: 160 }}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterReport} onChange={(e) => setFilterReport(e.target.value)} className="form-input" style={{ width: 200 }}>
          <option value="">All report categories</option>
          {reportCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'auto', maxHeight: '60vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9', zIndex: 1 }}>
              <tr style={{ color: '#475569', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', width: 110 }}>Code</th>
                <th style={{ padding: '8px 10px' }}>Description</th>
                <th style={{ padding: '8px 10px', width: 130 }}>Category</th>
                <th style={{ padding: '8px 10px', width: 180 }}>Report category</th>
                <th style={{ padding: '8px 10px', width: 70, textAlign: 'center' }}>Header</th>
                <th style={{ padding: '8px 10px', width: 70, textAlign: 'center' }}>Active</th>
                <th style={{ padding: '8px 10px', width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(acc => (
                <tr key={acc.id} style={{ borderTop: '1px solid #f1f5f9', background: acc.is_header ? '#fefce8' : undefined }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: acc.is_header ? 700 : 400 }}>{acc.code}</td>
                  <td style={{ padding: '6px 10px', fontWeight: acc.is_header ? 600 : 400 }}>
                    <input
                      type="text"
                      defaultValue={acc.description}
                      onBlur={async (e) => {
                        if (e.target.value !== acc.description) {
                          await api.updateMasterAccount(acc.id, { description: e.target.value });
                          await load();
                        }
                      }}
                      className="form-input"
                      style={cellEditable}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <select
                      value={acc.category}
                      onChange={async (e) => { await api.updateMasterAccount(acc.id, { category: e.target.value }); await load(); }}
                      className="form-input"
                      style={cellEditable}
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      defaultValue={acc.report_category || ''}
                      onBlur={async (e) => {
                        if (e.target.value !== (acc.report_category || '')) {
                          await api.updateMasterAccount(acc.id, { report_category: e.target.value.trim() || null });
                          await load();
                        }
                      }}
                      className="form-input"
                      style={cellEditable}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={acc.is_header}
                      onChange={async (e) => { await api.updateMasterAccount(acc.id, { is_header: e.target.checked }); await load(); }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={acc.active}
                      onChange={async (e) => { await api.updateMasterAccount(acc.id, { active: e.target.checked }); await load(); }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(acc)} title="Delete from master">X</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>No accounts match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
