import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import ClientDocuments from './ClientDocuments';

export default function DocumentsPage() {
  const { user } = useAuth();
  const { clients } = useApp();
  const [selectedClientId, setSelectedClientId] = useState<number>(0);

  // Client users see their own documents directly
  if (user?.role === 'client' && user.client_id) {
    return (
      <div className="documents-page">
        <h2>My Documents</h2>
        <ClientDocuments clientId={user.client_id} />
      </div>
    );
  }

  // Admin — pick a client first
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

  return (
    <div className="documents-page">
      <h2>Documents</h2>
      <p style={{ marginBottom: 20, color: 'var(--text-secondary)' }}>Select a client to view or upload their documents:</p>
      {clients.length === 0 ? (
        <div className="empty-state">
          <p>No clients yet.</p>
          <Link to="/clients" className="btn btn-primary">Add a Client</Link>
        </div>
      ) : (
        <div className="dashboard-clients-grid">
          {clients.map((c: any) => (
            <div key={c.id} className="dashboard-client-card" onClick={() => setSelectedClientId(c.id)} style={{ cursor: 'pointer' }}>
              <div className="dc-card-header">
                <h3>{c.name}</h3>
                {c.trading_name && <p className="dc-trading">{c.trading_name}</p>}
              </div>
              <div className="dc-card-footer"><span>View Documents →</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
