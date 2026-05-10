import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
// (Link is also used below for the "deleted clients" affordance)
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import MergeClients from './MergeClients';

type ViewMode = 'cards' | 'table' | 'list';

export default function ClientManager() {
  const { clients, refreshClients, invoices } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ client_code: '', name: '', trading_name: '', email: '', phone: '', address: '', tax_number: '', notes: '', country: 'Cyprus' });
  const [createUser, setCreateUser] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', password: '', display_name: '' });
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('clients_view') as ViewMode) || 'cards');
  const [searchTerm, setSearchTerm] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [importMode, setImportMode] = useState<'template' | 'legacy'>('template');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setView = (m: ViewMode) => { setViewMode(m); localStorage.setItem('clients_view', m); };

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
    const msg = count > 0 ? `This client has ${count} invoice(s). Delete all?` : 'Delete this client?';
    if (confirm(msg)) { await api.deleteClient(id); await refreshClients(); }
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
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return (c.name || '').toLowerCase().includes(t)
      || (c.client_code || '').toLowerCase().includes(t)
      || (c.tax_number || '').toLowerCase().includes(t)
      || (c.trading_name || '').toLowerCase().includes(t);
  });

  return (
    <div className="client-manager">
      <div className="list-header">
        <h2>Clients ({clients.length})</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleGenerateMissing} title="Auto-generate codes for clients without one">
            #️⃣ Gen Codes
          </button>
          <Link to="/clients/deleted" className="btn btn-secondary">🗑 Deleted</Link>
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

      {/* Search + View toggle */}
      <div className="client-toolbar">
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by name, code, TIC..." className="form-input client-search" />
        <div className="view-toggle">
          <button className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Card view">▦</button>
          <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Table view">☰</button>
          <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="Compact list">≡</button>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="empty-state"><p>No clients yet.</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>No clients match your search.</p></div>
      ) : viewMode === 'cards' ? (
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
      ) : viewMode === 'table' ? (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Type</th><th>TIC</th><th>VAT</th><th>Contact</th><th>Phone</th><th>Invoices</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => (
                <tr key={c.id}>
                  <td><strong>{c.client_code || '-'}</strong></td>
                  <td>
                    <Link to={`/clients/${c.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>{c.name}</Link>
                    {c.trading_name && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.trading_name}</div>}
                  </td>
                  <td>{c.business_type || '-'}</td>
                  <td>{c.tax_number || '-'}</td>
                  <td>{c.vat_number || '-'}</td>
                  <td>{c.email || c.contact_person || '-'}</td>
                  <td>{c.phone || c.mobile || '-'}</td>
                  <td>{getInvoiceCount(c.id)}</td>
                  <td>
                    <Link to={`/clients/${c.id}`} className="btn btn-secondary btn-sm">Open</Link>
                    <button className="btn btn-danger btn-sm" style={{ marginLeft: 4 }} onClick={() => handleDelete(c.id)}>X</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="client-compact-list">
          {filtered.map((c: any) => (
            <Link to={`/clients/${c.id}`} key={c.id} className="client-compact-item">
              <span className="compact-code">{c.client_code || '-'}</span>
              <span className="compact-name">{c.name}</span>
              <span className="compact-tic">{c.tax_number || '-'}</span>
              <span className="compact-count">{getInvoiceCount(c.id)} inv</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
