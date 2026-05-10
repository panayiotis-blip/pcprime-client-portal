import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api, isStaffRole } from '../../services/api';

type ViewMode = 'cards' | 'table' | 'list';

interface InvoiceListProps {
  clientId?: number;
}

export default function InvoiceList({ clientId: propClientId }: InvoiceListProps) {
  const { invoices, clients, refreshInvoices } = useApp();
  const { user } = useAuth();
  const [selectedClientId, setSelectedClientId] = useState<number>(propClientId || (user?.role === 'client' ? user.client_id! : 0));
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('invoices_view') as ViewMode) || 'list');
  const setView = (m: ViewMode) => { setViewMode(m); localStorage.setItem('invoices_view', m); };

  const embedded = !!propClientId;
  const effectiveClientId = embedded ? propClientId! : selectedClientId;

  const filtered = effectiveClientId
    ? invoices.filter((inv: any) => inv.client_id === effectiveClientId)
    : [];

  const matchedFiltered = filtered.filter((inv: any) => {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return (inv.invoice_number || '').toLowerCase().includes(t)
      || (inv.vendor_name || '').toLowerCase().includes(t)
      || (inv.batch_month || '').toLowerCase().includes(t)
      || (inv.status || '').toLowerCase().includes(t);
  });

  const getClientName = (cId: number) => clients.find((c: any) => c.id === cId)?.name || 'Unknown';

  const handleDelete = async (id: number) => {
    if (confirm('Delete this invoice?')) {
      await api.deleteInvoice(id);
      await refreshInvoices();
    }
  };

  const unExport = async (inv: any) => {
    await api.updateInvoice(inv.id, {
      ...inv, status: 'draft',
      journal_lines: inv.journal_lines?.map((l: any) => ({
        debit_account: l.debit_account, credit_account: l.credit_account, amount: l.amount,
        vat_code: l.vat_code, vat_amount: l.vat_amount, details: l.details,
        t_analysis_1: l.t_analysis_1, t_analysis_2: l.t_analysis_2, t_analysis_3: l.t_analysis_3,
        t_analysis_4: l.t_analysis_4, t_analysis_5: l.t_analysis_5,
      })) || []
    });
    await refreshInvoices();
  };

  const fmtAmount = (inv: any) =>
    `${inv.currency || ''} ${(inv.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`.trim();

  const searchedClients = clients.filter((c: any) => {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return (c.name || '').toLowerCase().includes(t)
      || (c.client_code || '').toLowerCase().includes(t)
      || (c.tax_number || '').toLowerCase().includes(t);
  });

  const invoiceCount = (cId: number) => invoices.filter((i: any) => i.client_id === cId).length;

  // --- Step 1: Client picker (admin only, when not embedded) ---
  if (!embedded && isStaffRole(user) && !selectedClientId) {
    return (
      <div className="invoice-list">
        <div className="list-header">
          <h2>Invoices — Select a Client</h2>
          <Link to="/scan" className="btn btn-primary">+ Scan New</Link>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Choose a client to view their invoices:</p>

        <input
          type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search clients..." className="form-input" style={{ marginBottom: 16, maxWidth: 400 }}
        />

        {clients.length === 0 ? (
          <div className="empty-state">
            <p>No clients yet.</p>
            <Link to="/clients" className="btn btn-primary">Add a Client</Link>
          </div>
        ) : (
          <div className="dashboard-clients-grid">
            {searchedClients.map((c: any) => {
              const count = invoiceCount(c.id);
              return (
                <div key={c.id} className="dashboard-client-card" onClick={() => setSelectedClientId(c.id)} style={{ cursor: 'pointer' }}>
                  <div className="dc-card-header">
                    {c.client_code && <span className="client-code-badge">{c.client_code}</span>}
                    <h3>{c.name}</h3>
                    {c.trading_name && <p className="dc-trading">{c.trading_name}</p>}
                  </div>
                  <div className="dc-card-info">
                    {c.tax_number && <p>TIC: {c.tax_number}</p>}
                    <p><strong>{count}</strong> scanned invoice{count !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="dc-card-footer">
                    <span>View Invoices →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // --- Step 2: Invoice list for selected client ---
  const currentClient = clients.find((c: any) => c.id === effectiveClientId);

  return (
    <div className="invoice-list">
      <div className="list-header">
        <div>
          {!embedded && isStaffRole(user) && (
            <button className="btn btn-link" onClick={() => setSelectedClientId(0)} style={{ padding: 0, marginBottom: 8 }}>
              ← Back to Clients
            </button>
          )}
          <h2>
            {currentClient && <span className="client-code-inline">{currentClient.client_code}</span>}
            {currentClient?.name || 'Invoices'}
          </h2>
        </div>
        <Link to="/scan" className="btn btn-primary">+ Scan New</Link>
      </div>

      {/* Search + View toggle */}
      <div className="client-toolbar">
        <input
          type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by number, vendor, batch, status..." className="form-input client-search"
        />
        <div className="view-toggle">
          <button className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Card view">▦ Cards</button>
          <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Table view">☰ Table</button>
          <button className={`view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setView('list')} title="Compact list">≡ List</button>
        </div>
      </div>

      {matchedFiltered.length === 0 ? (
        <div className="empty-state">
          <p>{filtered.length === 0 ? 'No invoices yet for this client.' : 'No invoices match your search.'}</p>
          {filtered.length === 0 && <Link to="/scan" className="btn btn-primary">Scan Invoices</Link>}
        </div>
      ) : viewMode === 'cards' ? (
        <div className="invoice-cards">
          {matchedFiltered.map((inv: any) => (
            <div key={inv.id} className="invoice-card">
              <div className="card-header">
                <span className="invoice-number">{inv.invoice_number || 'No number'}</span>
                <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
              </div>
              <div className="card-body">
                <p className="vendor">{inv.vendor_name || 'Unknown vendor'}</p>
                {!embedded && <p className="client">Client: {inv.client_name || getClientName(inv.client_id)}</p>}
                <p className="date">{inv.invoice_date}</p>
                {inv.batch_month && <p className="date">Batch: {inv.batch_month}</p>}
                <p className="amount">{fmtAmount(inv)}</p>
              </div>
              <div className="card-actions">
                <Link to={`/invoices/${inv.id}`} className="btn btn-secondary btn-sm">Edit</Link>
                {inv.status === 'exported' && (
                  <button className="btn btn-secondary btn-sm" onClick={() => unExport(inv)}>Un-export</button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(inv.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : viewMode === 'table' ? (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Journal</th>
                <th>Number</th>
                <th>Vendor</th>
                {!embedded && <th>Client</th>}
                <th>Date</th>
                <th>Batch</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {matchedFiltered.map((inv: any) => (
                <tr key={inv.id}>
                  <td><span className="status-badge">{inv.journal || 'JV'}</span></td>
                  <td><strong>{inv.invoice_number || '—'}</strong></td>
                  <td>{inv.vendor_name || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                  {!embedded && <td>{inv.client_name || getClientName(inv.client_id)}</td>}
                  <td>{inv.invoice_date || '—'}</td>
                  <td>{inv.batch_month || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAmount(inv)}</td>
                  <td><span className={`status-badge status-${inv.status}`}>{inv.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Link to={`/invoices/${inv.id}`} className="btn btn-secondary btn-sm">Edit</Link>
                      {inv.status === 'exported' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => unExport(inv)}>Un-export</button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(inv.id)}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // Compact list
        <div className="compact-list">
          {matchedFiltered.map((inv: any) => (
            <Link key={inv.id} to={`/invoices/${inv.id}`} className="compact-row">
              <span className="cl-badge">{inv.journal || 'JV'}</span>
              <span className="cl-strong">{inv.invoice_number || 'No number'}</span>
              <span className="cl-muted">{inv.vendor_name || '—'}</span>
              {!embedded && <span className="cl-muted">{inv.client_name || getClientName(inv.client_id)}</span>}
              <span className="cl-muted">{inv.invoice_date || '—'}</span>
              <span className="cl-amount">{fmtAmount(inv)}</span>
              <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
