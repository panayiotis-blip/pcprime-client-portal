import { useState, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
// (Link is also used below for the "deleted clients" affordance)
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import { useViewPreferences } from '../../context/ViewPreferencesContext';
import { api, hasPermission } from '../../services/api';
import ViewToggle from '../shared/ViewToggle';
import MergeClients from './MergeClients';
import BulkWipeModal from '../Admin/BulkWipeModal';
import ColumnVisibilityModal, { type ColumnDef } from '../shared/ColumnVisibilityModal';

type SortKey = 'client_code' | 'name' | 'tax_number' | 'invoice_count';
type SortDir = 'asc' | 'desc';

// Column registry for the List view. Order = display order.
const CLIENT_COLUMNS: ColumnDef[] = [
  { id: 'client_code',         label: 'Code',           required: true,  defaultVisible: true  },
  { id: 'name',                label: 'Name',           required: true,  defaultVisible: true  },
  { id: 'client_category',     label: 'Category',                        defaultVisible: true  },
  { id: 'client_status',       label: 'Status',                          defaultVisible: true  },
  { id: 'tax_number',          label: 'TIC',                             defaultVisible: true  },
  { id: 'registration_number', label: 'HE Number',                       defaultVisible: true  },
  { id: 'city',                label: 'City',                            defaultVisible: true  },
  { id: 'updated_at',          label: 'Last Updated',                    defaultVisible: true  },
  { id: 'vat_number',          label: 'VAT',                             defaultVisible: false },
  { id: 'business_type',       label: 'Business Type',                   defaultVisible: false },
  { id: 'phone',               label: 'Phone',                           defaultVisible: false },
  { id: 'mobile',              label: 'Mobile',                          defaultVisible: false },
  { id: 'email',               label: 'Email',                           defaultVisible: false },
  { id: 'contact_person',      label: 'Contact Person',                  defaultVisible: false },
  { id: 'invoices_count',      label: 'Invoices',                        defaultVisible: false },
  { id: 'created_at',          label: 'Created',                         defaultVisible: false },
];

const DEFAULT_VISIBLE_COLS = CLIENT_COLUMNS.filter(c => c.defaultVisible).map(c => c.id);

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'company',        label: 'Company' },
  { value: 'partnership',    label: 'Partnership' },
  { value: 'individual',     label: 'Individual' },
  { value: 'sole_trader',    label: 'Sole Trader' },
  { value: 'self_employed',  label: 'Self-Employed' },
  { value: 'deceased',       label: 'Deceased' },
  { value: 'dormant',        label: 'Dormant' },
  { value: 'prospective',    label: 'Prospective' },
  { value: 'other',          label: 'Other' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active',             label: 'Active' },
  { value: 'liquidated_dormant', label: 'Liquidated / Dormant' },
  { value: 'deceased',           label: 'Deceased' },
  { value: 'old_client',         label: 'Old Client' },
  { value: 'defence_tax_only',   label: 'Defence Tax Only' },
  { value: 'internal',           label: 'Internal' },
];

export default function ClientManager() {
  const { clients, refreshClients, invoices } = useApp();
  const { user } = useAuth();
  const { runWith } = useMFAStepUp();
  const { getMode, setMode } = useViewPreferences();
  const canSeeDeleted = hasPermission(user, 'clients.restore');
  const isOwner = user?.role === 'owner';
  const [showWipe, setShowWipe] = useState(false);
  const [unlinkedCount, setUnlinkedCount] = useState(0);

  useEffect(() => {
    api.countUnlinkedDirectors().then(setUnlinkedCount).catch(() => {});
  }, [clients.length]);

  // Filter state (Phase 6 / clients-v3 Part E2)
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterCity,     setFilterCity]     = useState('');
  const [filterHasVat,   setFilterHasVat]   = useState<'all' | 'yes' | 'no'>('all');

  // Column visibility (Phase 6 / clients-v3 Part E1)
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLS);
  const [showColumnsModal, setShowColumnsModal] = useState(false);

  // Load column prefs once
  useEffect(() => {
    api.getColumnPreferences()
      .then(prefs => {
        const saved = prefs?.clients;
        if (Array.isArray(saved) && saved.length > 0) setVisibleColumns(saved);
      })
      .catch(() => {});
  }, []);

  const saveColumns = (ids: string[]) => {
    setVisibleColumns(ids);
    api.setColumnPreferences('clients', ids).catch(() => {});
  };
  const resetColumns = () => saveColumns(DEFAULT_VISIBLE_COLS);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ client_code: '', name: '', trading_name: '', email: '', phone: '', address: '', tax_number: '', notes: '', country: 'Cyprus' });
  const [createUser, setCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', display_name: '' });
  const viewMode = getMode('clients', 'grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [importMode, setImportMode] = useState<'template' | 'legacy'>('template');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Column sort state for List view
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    try {
      const data: any = { ...form };
      await api.createClient(data);
      await refreshClients();
      if (createUser && userForm.username) {
        alert('Client created. To create a login for them, use Supabase Dashboard → Authentication → Users, then link the user in the Users screen.');
      }
      setForm({ client_code: '', name: '', trading_name: '', email: '', phone: '', address: '', tax_number: '', notes: '', country: 'Cyprus' });
      setUserForm({ username: '', password: '', display_name: '' });
      setCreateUser(false);
      setShowForm(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const previewCode = async (name: string) => {
    if (!name.trim()) { setForm((p: any) => ({ ...p, client_code: '' })); return; }
    try {
      const { code } = await api.getNextClientCode(name);
      setForm((p: any) => ({ ...p, client_code: code }));
    } catch {}
  };

  const handleGenerateMissing = async () => {
    if (!confirm('Generate client codes for all clients that don\'t have one?')) return;
    try {
      const result = await api.generateMissingCodes();
      await refreshClients();
      alert(`Generated codes for ${result.updated} client(s).`);
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleDelete = async (id: number) => {
    const count = invoices.filter((inv: any) => inv.client_id === id).length;
    const detail = count > 0 ? ` (${count} invoice${count === 1 ? '' : 's'} on file)` : '';
    const msg = `Hide this client${detail}? All their data is preserved and they can be restored later from Clients → Deleted.`;
    if (!confirm(msg)) return;
    try {
      await runWith(() => api.deleteClient(id));
      await refreshClients();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Delete failed: ' + err.message);
    }
  };

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { alert('Select an Excel file'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const result = importMode === 'template' ? await api.importStructured(file) : await api.importExcel(file);
      setImportResult(result);
      await refreshClients();
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const getInvoiceCount = (clientId: number) => invoices.filter((inv: any) => inv.client_id === clientId).length;

  const filtered = clients.filter((c: any) => {
    // Free-text search
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      const matches = (c.name || '').toLowerCase().includes(t)
        || (c.client_code || '').toLowerCase().includes(t)
        || (c.tax_number || '').toLowerCase().includes(t)
        || (c.trading_name || '').toLowerCase().includes(t)
        || (c.city || '').toLowerCase().includes(t);
      if (!matches) return false;
    }
    // Structured filters
    if (filterCategory && c.client_category !== filterCategory) return false;
    if (filterStatus   && c.client_status   !== filterStatus)   return false;
    if (filterCity     && c.city            !== filterCity)     return false;
    if (filterHasVat === 'yes' && !c.vat_number) return false;
    if (filterHasVat === 'no'  &&  c.vat_number) return false;
    return true;
  });

  // Distinct cities present in the data — drives the City dropdown
  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients as any[]) if (c.city) s.add(c.city);
    return Array.from(s).sort();
  }, [clients]);

  // Active filter chips
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (filterCategory)         activeFilters.push({ key: 'cat',  label: 'Category: ' + (CATEGORY_OPTIONS.find(o => o.value === filterCategory)?.label || filterCategory), clear: () => setFilterCategory('') });
  if (filterStatus)           activeFilters.push({ key: 'stat', label: 'Status: '   + (STATUS_OPTIONS.find(o => o.value === filterStatus)?.label || filterStatus),     clear: () => setFilterStatus('') });
  if (filterCity)             activeFilters.push({ key: 'city', label: 'City: ' + filterCity,                                             clear: () => setFilterCity('') });
  if (filterHasVat !== 'all') activeFilters.push({ key: 'vat',  label: 'VAT: '  + filterHasVat,                                           clear: () => setFilterHasVat('all') });
  const clearAllFilters = () => { setFilterCategory(''); setFilterStatus(''); setFilterCity(''); setFilterHasVat('all'); };

  // Helper: render any column's cell content for a given client row
  const renderCell = (col: string, c: any) => {
    switch (col) {
      case 'client_code':          return <strong>{c.client_code || '-'}</strong>;
      case 'name':                 return (
        <>
          <Link to={`/clients/${c.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>{c.name}</Link>
          {c.trading_name && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.trading_name}</div>}
        </>
      );
      case 'client_category':      return c.client_category || '-';
      case 'client_status':        return c.client_status || '-';
      case 'tax_number':           return c.tax_number || '-';
      case 'registration_number':  return c.registration_number || '-';
      case 'city':                 return c.city || '-';
      case 'vat_number':           return c.vat_number || '-';
      case 'business_type':        return c.business_type || '-';
      case 'phone':                return c.phone || '-';
      case 'mobile':                return c.mobile || '-';
      case 'email':                return c.email || '-';
      case 'contact_person':       return c.contact_person || '-';
      case 'invoices_count':       return getInvoiceCount(c.id);
      case 'created_at':           return c.created_at ? new Date(c.created_at).toLocaleDateString() : '-';
      case 'updated_at':           return c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '-';
      default:                     return '-';
    }
  };
  const visibleColumnDefs = CLIENT_COLUMNS.filter(c => visibleColumns.includes(c.id));

  // Sort the filtered list — applied to the List view, also to Compact for stability.
  const sortedFiltered = [...filtered].sort((a: any, b: any) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'invoice_count') {
      return dir * (getInvoiceCount(a.id) - getInvoiceCount(b.id));
    }
    const av = String(a[sortKey] || '').toLowerCase();
    const bv = String(b[sortKey] || '').toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  return (
    <div className="client-manager">
      <div className="list-header">
        <h2>Clients ({clients.length})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateMissing} title="Auto-generate codes for clients without one">
            #️⃣ Gen Codes
          </button>
          {canSeeDeleted && <Link to="/clients/deleted" className="btn btn-secondary">🗑 Deleted</Link>}
          {(user?.role === 'owner' || user?.role === 'supervisor') && (
            <>
              <Link to="/clients/bulk-import-v3" className="btn btn-primary">📥 Bulk Import V3</Link>
              <Link to="/clients/bulk-import" className="btn btn-secondary" title="Legacy single-sheet import">📥 Bulk Import (legacy)</Link>
            </>
          )}
          {unlinkedCount > 0 && (
            <Link to="/clients/unlinked-directors" className="btn btn-secondary" style={{ borderColor: '#f59e0b' }} title="Director rows without a linked client">
              ⚠ Unlinked Directors ({unlinkedCount})
            </Link>
          )}
          {isOwner && (
            <button
              className="btn btn-danger"
              onClick={() => setShowWipe(true)}
              title="Pre-go-live: wipe all test data"
            >
              ⚠️ Bulk Wipe
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setShowMerge(!showMerge)}>
            {showMerge ? 'Cancel' : '⇄ Merge Duplicates'}
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImport(!showImport)}>
            {showImport ? 'Cancel' : '📥 Import'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add Client'}
          </button>
        </div>
      </div>

      {showWipe && (
        <BulkWipeModal
          onClose={() => setShowWipe(false)}
          onWiped={() => refreshClients()}
        />
      )}

      {/* Merge UI */}
      {showMerge && (
        <div className="card" style={{ marginBottom: 16 }}>
          <MergeClients onDone={() => setShowMerge(false)} />
        </div>
      )}

      {/* Import UI */}
      {showImport && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="import-mode-selector">
            <button className={`folder-tab ${importMode === 'template' ? 'active' : ''}`} onClick={() => setImportMode('template')}>
              📄 Template Import (Recommended)
            </button>
            <button className={`folder-tab ${importMode === 'legacy' ? 'active' : ''}`} onClick={() => setImportMode('legacy')}>
              🗂 Legacy Multi-tab Import
            </button>
          </div>

          {importMode === 'template' ? (
            <>
              <h3 style={{ marginBottom: 8 }}>Template-based Import</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Download the template, fill it in, and upload it back. Credentials link to clients via <code>client_code</code>.
              </p>
              <a href={api.getImportTemplateUrl()} download className="btn btn-secondary" style={{ marginBottom: 12, display: 'inline-block' }}>
                📥 Download Template
              </a>
              <div style={{ marginTop: 12 }}>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="form-input" />
                <button className="btn btn-primary" onClick={handleImport} disabled={importing} style={{ marginTop: 12 }}>
                  {importing ? 'Importing...' : 'Upload & Import'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 style={{ marginBottom: 8 }}>Legacy Multi-tab Import</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Upload your existing multi-tab Excel (PC TAX CLIENTS, CY LOGIN CODES, UBO's, etc.). This is a best-effort import.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="form-input" />
              <button className="btn btn-primary" onClick={handleImport} disabled={importing} style={{ marginTop: 12 }}>
                {importing ? 'Importing...' : 'Start Import'}
              </button>
            </>
          )}

          {importResult && (
            <div className="import-result" style={{ marginTop: 16, padding: 12, background: '#dcfce7', borderRadius: 6 }}>
              <h4 style={{ margin: 0, color: '#166534' }}>Import complete!</h4>
              <ul style={{ marginTop: 8, marginLeft: 20 }}>
                {importResult.clientsCreated !== undefined && <li><strong>{importResult.clientsCreated}</strong> clients created</li>}
                {importResult.clientsUpdated !== undefined && <li><strong>{importResult.clientsUpdated}</strong> clients updated</li>}
                {importResult.credentialsAdded !== undefined && <li><strong>{importResult.credentialsAdded}</strong> credentials added</li>}
                {importResult.credentialsUpdated !== undefined && <li><strong>{importResult.credentialsUpdated}</strong> credentials updated</li>}
                {importResult.tabsProcessed && <li>Tabs: {importResult.tabsProcessed.join(', ')}</li>}
              </ul>
              {(importResult.errors?.length > 0 || importResult.warnings?.length > 0) && (
                <details style={{ marginTop: 8 }}>
                  <summary>Messages ({(importResult.errors?.length || 0) + (importResult.warnings?.length || 0)})</summary>
                  <ul style={{ marginLeft: 20, fontSize: 12 }}>
                    {importResult.errors?.map((e: string, i: number) => <li key={'e'+i}>{e}</li>)}
                    {importResult.warnings?.map((w: string, i: number) => <li key={'w'+i}>⚠ {w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="client-form card">
          <div className="form-grid">
            <div className="form-group">
              <label>Name *</label>
              <input type="text" value={form.name} onChange={(e) => { setForm((p: any) => ({ ...p, name: e.target.value })); previewCode(e.target.value); }} className="form-input" placeholder="Client name" autoFocus />
            </div>
            <div className="form-group">
              <label>Client Code (auto-generated)</label>
              <input type="text" value={form.client_code} onChange={(e) => setForm((p: any) => ({ ...p, client_code: e.target.value.toUpperCase() }))} className="form-input" placeholder="Will auto-generate: 221XXX001" style={{ fontFamily: 'monospace' }} />
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Format: 221 + first 3 letters + sequential number</p>
            </div>
            <div className="form-group"><label>Trading Name</label><input type="text" value={form.trading_name} onChange={(e) => setForm((p: any) => ({ ...p, trading_name: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Tax Number (TIC)</label><input type="text" value={form.tax_number} onChange={(e) => setForm((p: any) => ({ ...p, tax_number: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((p: any) => ({ ...p, email: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Phone</label><input type="text" value={form.phone} onChange={(e) => setForm((p: any) => ({ ...p, phone: e.target.value }))} className="form-input" /></div>
            <div className="form-group full-width"><label>Address</label><input type="text" value={form.address} onChange={(e) => setForm((p: any) => ({ ...p, address: e.target.value }))} className="form-input" /></div>
            <div className="form-group full-width"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((p: any) => ({ ...p, notes: e.target.value }))} className="form-input" rows={2} /></div>
          </div>
          <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 500 }}>
              <input type="checkbox" checked={createUser} onChange={(e) => setCreateUser(e.target.checked)} />
              Create a client login for this client
            </label>
            {createUser && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-group"><label>Login Username</label><input type="text" value={userForm.username} onChange={(e) => setUserForm(p => ({ ...p, username: e.target.value }))} className="form-input" placeholder="e.g. acme_user" /></div>
                <div className="form-group"><label>Password</label><input type="text" value={userForm.password} onChange={(e) => setUserForm(p => ({ ...p, password: e.target.value }))} className="form-input" placeholder="Initial password" /></div>
                <div className="form-group"><label>Display Name</label><input type="text" value={userForm.display_name} onChange={(e) => setUserForm(p => ({ ...p, display_name: e.target.value }))} className="form-input" placeholder="Defaults to client name" /></div>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleAdd} style={{ marginTop: 12 }}>Save Client</button>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Other details (VAT, services, directors, credentials) can be added after creating the client.</p>
        </div>
      )}

      {/* Search + Filters + Columns + View toggle */}
      <div className="client-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by name, code, TIC, city..." className="form-input client-search" />
        <select className="form-input" value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ maxWidth: 170 }} title="Filter by category">
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }} title="Filter by status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="form-input" value={filterCity} onChange={e => setFilterCity(e.target.value)} style={{ maxWidth: 150 }} title="Filter by city">
          <option value="">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-input" value={filterHasVat} onChange={e => setFilterHasVat(e.target.value as any)} style={{ maxWidth: 140 }} title="Filter by VAT registration">
          <option value="all">VAT: any</option>
          <option value="yes">Has VAT</option>
          <option value="no">No VAT</option>
        </select>
        {viewMode === 'list' && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowColumnsModal(true)} title="Show/hide columns in the list view">
            ☰ Columns
          </button>
        )}
        <ViewToggle value={viewMode} onChange={(m) => setMode('clients', m)} />
      </div>

      {activeFilters.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 12px 0' }}>
          {activeFilters.map(f => (
            <span key={f.key} style={{
              background: '#eef2ff', color: '#3730a3',
              padding: '2px 10px', borderRadius: 999, fontSize: 12,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {f.label}
              <button
                onClick={f.clear}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
                title="Remove filter"
              >✕</button>
            </span>
          ))}
          <button className="btn btn-link btn-sm" onClick={clearAllFilters}>Clear all</button>
        </div>
      )}

      {showColumnsModal && (
        <ColumnVisibilityModal
          title="Choose columns — Clients list"
          columns={CLIENT_COLUMNS}
          visibleIds={visibleColumns}
          onChange={saveColumns}
          onReset={resetColumns}
          onClose={() => setShowColumnsModal(false)}
        />
      )}

      {clients.length === 0 ? (
        <div className="empty-state"><p>No clients yet.</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No clients match your search.</p></div>
      ) : viewMode === 'grid' ? (
        <div className="client-cards">
          {filtered.map((client: any) => (
            <Link to={`/clients/${client.id}`} key={client.id} className="dashboard-client-card">
              <div className="dc-card-header">
                {client.client_code && <span className="client-code-badge">{client.client_code}</span>}
                <h3>{client.name}</h3>
                {client.trading_name && <p className="dc-trading">{client.trading_name}</p>}
              </div>
              <div className="dc-card-info">
                {client.tax_number && <p>TIC: {client.tax_number}</p>}
                {client.vat_number && <p>VAT: {client.vat_number}</p>}
                {client.email && <p>✉ {client.email}</p>}
                {client.phone && <p>☎ {client.phone}</p>}
                <p>{getInvoiceCount(client.id)} invoices</p>
              </div>
              <div className="dc-card-footer"><span>View Details →</span></div>
            </Link>
          ))}
        </div>
      ) : viewMode === 'compact' ? (
        <div className="client-cards client-cards-compact">
          {filtered.map((client: any) => (
            <Link to={`/clients/${client.id}`} key={client.id} className="dashboard-client-card dashboard-client-card-compact">
              <div className="dc-card-header">
                {client.client_code && <span className="client-code-badge">{client.client_code}</span>}
                <h3>{client.name}</h3>
              </div>
              <div className="dc-card-info">
                {client.tax_number && <p>TIC: {client.tax_number}</p>}
                <p>{getInvoiceCount(client.id)} invoices</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table sortable-table">
            <thead>
              <tr>
                {visibleColumnDefs.map(col => {
                  const sortable = ['client_code', 'name', 'tax_number', 'invoices_count'].includes(col.id);
                  const sortKeyForCol = col.id === 'invoices_count' ? 'invoice_count' : col.id as SortKey;
                  return (
                    <th
                      key={col.id}
                      className={sortable ? 'sortable' : ''}
                      onClick={sortable ? () => onSort(sortKeyForCol as SortKey) : undefined}
                    >
                      {col.label}
                      {sortable ? sortIndicator(sortKeyForCol as SortKey) : ''}
                    </th>
                  );
                })}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((c: any) => (
                <tr key={c.id}>
                  {visibleColumnDefs.map(col => (
                    <td key={col.id}>{renderCell(col.id, c)}</td>
                  ))}
                  <td>
                    <Link to={`/clients/${c.id}`} className="btn btn-secondary btn-sm">Open</Link>
                    <button className="btn btn-danger btn-sm" style={{ marginLeft: 4 }} onClick={() => handleDelete(c.id)}>X</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
