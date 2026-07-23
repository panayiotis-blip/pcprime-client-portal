import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useViewPreferences } from '../../context/ViewPreferencesContext';
import { api, isStaffRole } from '../../services/api';
import ViewToggle from '../shared/ViewToggle';

type SortKey = 'invoice_number' | 'vendor_name' | 'invoice_date' | 'total_amount' | 'status';
type SortDir = 'asc' | 'desc';

interface InvoiceListProps {
  clientId?: number;
}

export default function InvoiceList({ clientId: propClientId }: InvoiceListProps) {
  const { invoices, clients, refreshInvoices } = useApp();
  const { user } = useAuth();
  const { getMode, setMode } = useViewPreferences();
  const [selectedClientId, setSelectedClientId] = useState<number>(propClientId || (user?.role === 'client' ? user.client_id! : 0));
  const [searchTerm, setSearchTerm] = useState('');
  const viewMode = getMode('invoices', 'list');

  // Column sort state for List view
  const [sortKey, setSortKey] = useState<SortKey>('invoice_date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

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

  const sortedFiltered = [...matchedFiltered].sort((a: any, b: any) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'total_amount') {
      return dir * ((a.total_amount || 0) - (b.total_amount || 0));
    }
    const av = String(a[sortKey] || '').toLowerCase();
    const bv = String(b[sortKey] || '').toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  const getClientName = (cId: number) => clients.find((c: any) => c.id === cId)?.name || 'Unknown';

  const handleDelete = async (id: number) => {
    if (confirm('Delete this invoice?')) {
      await api.deleteInvoice(id);
      await refreshInvoices();
    }
  };

  const unExport = async (inv: any) => {
    // updateInvoice REPLACES the invoice's journal_lines with whatever we pass,
    // so we must send them back. The context list no longer carries lines (kept
    // out of the boot payload) — fetch the full invoice so un-export can't wipe
    // them by sending an empty array.
    const full = await api.getInvoice(inv.id);
    await api.updateInvoice(inv.id, {
      ...inv, status: 'draft',
      journal_lines: (full.journal_lines || []).map((l: any) => ({
        debit_account: l.debit_account, credit_account: l.credit_account, amount: l.amount,
        vat_code: l.vat_code, vat_amount: l.vat_amount, details: l.details,
        t_analysis_1: l.t_analysis_1, t_analysis_2: l.t_analysis_2, t_analysis_3: l.t_analysis_3,
        t_analysis_4: l.t_analysis_4, t_analysis_5: l.t_analysis_5,
      })),
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
        <ViewToggle value={viewMode} onChange={(m) => setMode('invoices', m)} />
      </div>

      {matchedFiltered.length === 0 ? (
        <div className="empty-state">
          <p>{filtered.length === 0 ? 'No invoices yet for this client.' : 'No invoices match your search.'}</p>
          {filtered.length === 0 && <Link to="/scan" className="btn btn-primary">Scan Documents</Link>}
        </div>
      ) : viewMode === 'grid' ? (
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
      ) : viewMode === 'compact' ? (
        <div className="invoice-cards invoice-cards-compact">
          {matchedFiltered.map((inv: any) => (
            <Link key={inv.id} to={`/invoices/${inv.id}`} className="invoice-card invoice-card-compact">
              <div className="card-header">
                <span className="invoice-number">{inv.invoice_number || 'No #'}</span>
                <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
              </div>
              <div className="card-body">
                <p className="vendor">{inv.vendor_name || '—'}</p>
                <p className="amount">{fmtAmount(inv)}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table sortable-table">
            <thead>
              <tr>
                <th>Journal</th>
                <th className="sortable" onClick={() => onSort('invoice_number')}>Number{sortIndicator('invoice_number')}</th>
                <th className="sortable" onClick={() => onSort('vendor_name')}>Vendor{sortIndicator('vendor_name')}</th>
                {!embedded && <th>Client</th>}
                <th className="sortable" onClick={() => onSort('invoice_date')}>Date{sortIndicator('invoice_date')}</th>
                <th>Batch</th>
                <th className="sortable" style={{ textAlign: 'right' }} onClick={() => onSort('total_amount')}>Amount{sortIndicator('total_amount')}</th>
                <th className="sortable" onClick={() => onSort('status')}>Status{sortIndicator('status')}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((inv: any) => (
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
      )}
    </div>
  );
}
