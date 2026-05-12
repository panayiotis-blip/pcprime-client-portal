import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useViewPreferences } from '../../context/ViewPreferencesContext';
import ClientDocuments from './ClientDocuments';
import ViewToggle from '../shared/ViewToggle';

type SortKey = 'name' | 'client_code';
type SortDir = 'asc' | 'desc';

export default function DocumentsPage() {
  const { user } = useAuth();
  const { clients } = useApp();
  const { getMode, setMode } = useViewPreferences();
  const [selectedClientId, setSelectedClientId] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState('');
  const viewMode = getMode('documents', 'grid');

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // Client users see their own documents directly (no client picker)
  if (user?.role === 'client' && user.client_id) {
    return (
      <div className="documents-page">
        <h2>My Documents</h2>
        <ClientDocuments clientId={user.client_id} />
      </div>
    );
  }

  // Admin: once a client is picked, drill into their folder tree (view toggle
  // doesn't apply inside the tree — it only applies to the client-picker step).
  if (selectedClientId) {
    const client = clients.find((c: any) => c.id === selectedClientId);
    return (
      <div className="documents-page">
        <div className="documents-header">
          <button className="btn btn-link" onClick={() => setSelectedClientId(0)}>← Back to Clients</button>
          <h2>{client?.name} — Documents</h2>
        </div>
        <ClientDocuments clientId={selectedClientId} />
      </div>
    );
  }

  // Admin top level: client picker. This is where the view toggle lives.
  const filtered = clients.filter((c: any) => {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return (c.name || '').toLowerCase().includes(t)
      || (c.client_code || '').toLowerCase().includes(t)
      || (c.trading_name || '').toLowerCase().includes(t);
  });

  const sortedFiltered = [...filtered].sort((a: any, b: any) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const av = String(a[sortKey] || '').toLowerCase();
    const bv = String(b[sortKey] || '').toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  return (
    <div className="documents-page">
      <h2>Documents</h2>
      <p style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>Select a client to view or upload their documents:</p>

      {clients.length > 0 && (
        <div className="client-toolbar">
          <input
            type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search clients..." className="form-input client-search"
          />
          <ViewToggle value={viewMode} onChange={(m) => setMode('documents', m)} />
        </div>
      )}

      {clients.length === 0 ? (
        <div className="empty-state">
          <p>No clients yet.</p>
          <Link to="/clients" className="btn btn-primary">Add a Client</Link>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="dashboard-clients-grid">
          {filtered.map((c: any) => (
            <div key={c.id} className="dashboard-client-card" onClick={() => setSelectedClientId(c.id)} style={{ cursor: 'pointer' }}>
              <div className="dc-card-header">
                {c.client_code && <span className="client-code-badge">{c.client_code}</span>}
                <h3>{c.name}</h3>
                {c.trading_name && <p className="dc-trading">{c.trading_name}</p>}
              </div>
              <div className="dc-card-footer"><span>View Documents →</span></div>
            </div>
          ))}
        </div>
      ) : viewMode === 'compact' ? (
        <div className="dashboard-clients-grid client-cards-compact">
          {filtered.map((c: any) => (
            <div key={c.id} className="dashboard-client-card dashboard-client-card-compact" onClick={() => setSelectedClientId(c.id)} style={{ cursor: 'pointer' }}>
              <div className="dc-card-header">
                {c.client_code && <span className="client-code-badge">{c.client_code}</span>}
                <h3>{c.name}</h3>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table sortable-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => onSort('client_code')}>Code{sortIndicator('client_code')}</th>
                <th className="sortable" onClick={() => onSort('name')}>Name{sortIndicator('name')}</th>
                <th>Trading Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((c: any) => (
                <tr key={c.id} onClick={() => setSelectedClientId(c.id)} style={{ cursor: 'pointer' }}>
                  <td><strong>{c.client_code || '-'}</strong></td>
                  <td style={{ color: 'var(--primary)', fontWeight: 500 }}>{c.name}</td>
                  <td>{c.trading_name || '-'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="btn btn-secondary btn-sm">Open →</span>
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
