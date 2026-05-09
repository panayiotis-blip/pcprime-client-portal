import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

const CATEGORIES = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

// Match many variants: plurals, abbreviations, Greek, sub-types
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Asset: ['asset', 'assets', 'fixed asset', 'current asset', 'debtor', 'receivable', 'bank', 'cash', 'inventory', 'stock', 'property', 'plant', 'equipment', 'ενεργητικ', 'περιουσ'],
  Liability: ['liability', 'liabilities', 'liab', 'creditor', 'payable', 'loan', 'accrual', 'accrued', 'provision', 'overdraft', 'παθητικ', 'υποχρε'],
  Equity: ['equity', 'capital', 'equi', 'reserve', 'retained earning', 'shareholder', 'owner', 'κεφαλαι', 'ιδια κεφ'],
  Income: ['income', 'revenue', 'sales', 'inc', 'rev', 'turnover', 'earning', 'gain', 'fee income', 'εισοδ', 'πωληση', 'εσοδ'],
  Expense: ['expense', 'expenses', 'expenditure', 'cost', 'exp', 'ex.', 'purchase', 'wage', 'salary', 'rent', 'overhead', 'utility', 'δαπαν', 'εξοδ'],
};

// Code-based fallback: common accounting code ranges (Cyprus/BTMS style)
function categoryFromCode(code: string): string | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, '');
  if (!digits) return null;
  const first = digits[0];
  // Typical COA: 1xxxx = Asset, 2xxxx = Liability, 3xxxx = Equity,
  // 4xxxx = Income, 5xxxx = COGS, 6xxxx/7xxxx/8xxxx = Expense
  switch (first) {
    case '1': return 'Asset';
    case '2': return 'Liability';
    case '3': return 'Equity';
    case '4': return 'Income';
    case '5': case '6': case '7': case '8': return 'Expense';
  }
  return null;
}

function matchCategory(raw: string, code?: string): string {
  const lower = (raw || '').toLowerCase().trim();

  // Try keyword match
  if (lower) {
    // Exact match first
    for (const cat of CATEGORIES) {
      if (lower === cat.toLowerCase() || lower === cat.toLowerCase() + 's') return cat;
    }
    // Single-letter codes sometimes used: A, L, E, I, X
    if (lower.length === 1) {
      const map: Record<string, string> = { a: 'Asset', l: 'Liability', e: 'Equity', i: 'Income', x: 'Expense' };
      if (map[lower]) return map[lower];
    }
    // Keyword contains
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) return cat;
      }
    }
  }

  // Fallback: guess from account code digits
  const fromCode = code ? categoryFromCode(code) : null;
  if (fromCode) return fromCode;

  return 'Expense';
}

export default function ChartOfAccounts({ clientId }: { clientId: number }) {
  const { clients } = useApp();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('Expense');
  const [filterCategory, setFilterCategory] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [copyFromClient, setCopyFromClient] = useState<number>(0);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => { try { setAccounts(await api.getAccounts(clientId)); } catch {} };
  useEffect(() => { load(); }, [clientId]);

  const handleAdd = async () => {
    if (!newCode.trim() || !newDesc.trim()) return;
    await api.createAccount(clientId, { code: newCode.trim(), description: newDesc.trim(), category: newCategory });
    setNewCode(''); setNewDesc(''); setShowAdd(false); await load();
  };

  const handleDelete = async (accId: number) => { if (confirm('Delete?')) { await api.deleteAccount(clientId, accId); await load(); } };

  const handleCopy = async () => {
    if (!copyFromClient) return;
    const result = await api.copyAccounts(clientId, copyFromClient);
    alert(`Copied ${result.copied} account(s).`);
    setCopyFromClient(0); setShowImport(false); await load();
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

      // Find header row — look for columns containing code / description / type
      let codeCol = -1, descCol = -1, typeCol = -1;
      let startRow = 0;

      for (let r = 0; r < Math.min(rows.length, 8); r++) {
        const row = rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').toLowerCase().trim();
          if (!val) continue;
          // Code column
          if (codeCol < 0 && (
            val === 'code' || val === 'a/c' || val === 'acct' || val === 'acc code' ||
            val.includes('account code') || val.includes('account no') || val.includes('a/c no') ||
            (val.includes('code') && !val.includes('vat'))
          )) codeCol = c;
          // Description column
          if (descCol < 0 && (
            val === 'description' || val === 'name' || val === 'desc' || val === 'account name' ||
            val.includes('description') || val.includes('account name') ||
            (val.includes('name') && !val.includes('client'))
          )) descCol = c;
          // Type/category column — widened
          if (typeCol < 0 && (
            val === 'type' || val === 'category' || val === 'class' || val === 'nature' || val === 'group' ||
            val.includes('account type') || val.includes('acc type') || val.includes('acct type') ||
            val.includes('category') || val.includes('class') || val.includes('nature') ||
            val.includes('group') || val === 'a/t'
          )) typeCol = c;
        }
        if (codeCol >= 0 && descCol >= 0) { startRow = r + 1; break; }
      }

      // If no headers found, assume col 0=code, 1=desc, 2=type
      if (codeCol < 0) { codeCol = 0; descCol = 1; typeCol = 2; startRow = 0; }
      if (descCol < 0) descCol = 1;

      console.log(`Import column mapping: code=col${codeCol}, desc=col${descCol}, type=col${typeCol}, startRow=${startRow}`);

      const existingCodes = new Set(accounts.map((a: any) => String(a.code)));
      let added = 0;
      let skipped = 0;

      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        const code = String(row[codeCol] || '').trim();
        const description = String(row[descCol] || '').trim();
        const rawType = typeCol >= 0 ? String(row[typeCol] || '') : '';
        const category = matchCategory(rawType, code);

        if (code && description && !existingCodes.has(code)) {
          await api.createAccount(clientId, { code, description, category });
          existingCodes.add(code);
          added++;
        } else if (code && description) {
          skipped++;
        }
      }

      alert(`Imported ${added} account(s). ${skipped} duplicate(s) skipped.`);
      await load();
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const filtered = accounts.filter((a: any) => {
    if (filterCategory && a.category !== filterCategory) return false;
    if (searchTerm) { const t = searchTerm.toLowerCase(); return a.code.toLowerCase().includes(t) || a.description.toLowerCase().includes(t); }
    return true;
  });

  return (
    <div className="chart-of-accounts">
      <div className="list-header">
        <h3>Chart of Accounts ({accounts.length})</h3>
        <div className="coa-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(!showAdd)}>+ Add</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(!showImport)}>Import / Copy</button>
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            if (!confirm('Re-categorize all accounts based on their code digits? (1xxx=Asset, 2xxx=Liability, 3xxx=Equity, 4xxx=Income, 5-8xxx=Expense). This only updates accounts where category doesn\'t match the code.')) return;
            let changed = 0;
            for (const acc of accounts) {
              const guessed = matchCategory('', acc.code);
              if (guessed !== acc.category) {
                await api.updateAccount(clientId, acc.id, { code: acc.code, description: acc.description, category: guessed });
                changed++;
              }
            }
            alert(`Updated ${changed} account(s).`);
            await load();
          }}>🔄 Re-type by Code</button>
        </div>
      </div>

      {showAdd && (
        <div className="coa-add-form card">
          <div className="form-grid">
            <div className="form-group"><label>Code</label><input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} className="form-input" placeholder="e.g. 74810000" /></div>
            <div className="form-group"><label>Description</label><input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} className="form-input" /></div>
            <div className="form-group"><label>Category</label><select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="form-input">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} style={{ marginTop: 12 }}>Save</button>
        </div>
      )}

      {showImport && (
        <div className="coa-import card">
          <h4>Import from Excel / CSV</h4>
          <p className="upload-hint" style={{ marginBottom: 8 }}>
            Excel file with columns: Account Code, Account Description, Account Type (Expense/Income/Asset/Liability/Equity)
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileImport}
            disabled={importing}
          />
          {importing && <p style={{ marginTop: 8, color: '#1e40af' }}>Importing...</p>}

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />

          <h4>Copy from another client</h4>
          <div className="form-row">
            <select value={copyFromClient} onChange={(e) => setCopyFromClient(parseInt(e.target.value))} className="form-input">
              <option value={0}>-- Select Client --</option>
              {clients.filter((c: any) => c.id !== clientId).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleCopy} disabled={!copyFromClient}>Copy</button>
          </div>
        </div>
      )}

      <div className="coa-filters">
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search..." className="form-input" />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="form-input">
          <option value="">All</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="coa-table-wrapper">
        <table className="coa-table">
          <thead><tr><th>Code</th><th>Description</th><th>Category</th><th></th></tr></thead>
          <tbody>
            {filtered.map((acc: any) => (
              <tr key={acc.id}>
                <td className="coa-code">{acc.code}</td>
                <td>{acc.description}</td>
                <td>
                  <select
                    value={acc.category}
                    onChange={async (e) => {
                      await api.updateAccount(clientId, acc.id, { code: acc.code, description: acc.description, category: e.target.value });
                      await load();
                    }}
                    className={`form-input cat-select cat-${acc.category.toLowerCase()}`}
                    style={{ padding: '3px 8px', fontSize: 12, fontWeight: 500 }}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td><button className="btn btn-danger btn-sm" onClick={() => handleDelete(acc.id)}>X</button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>No accounts. Add, import Excel, or copy from another client.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
