import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, hasPermission } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

type Client = {
  id: number;
  name: string;
  client_code: string | null;
  tax_number: string | null;
  trading_name: string | null;
  deleted_at: string;
};

export default function DeletedClients() {
  const { user } = useAuth();
  if (!hasPermission(user, 'clients.restore')) {
    return (
      <div className="dashboard">
        <div className="dashboard-header"><h2>Deleted Clients</h2></div>
        <div className="empty-state">
          <p>Restoring deleted clients is restricted to Owner and Supervisor roles.</p>
        </div>
      </div>
    );
  }
  const { refreshClients } = useApp();
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<Record<number, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.getDeletedClients() as Client[]);
    } catch (err: any) {
      alert('Failed to load deleted clients: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRestore = async (c: Client) => {
    if (!confirm(`Restore client "${c.name}"?`)) return;
    setRestoring(s => ({ ...s, [c.id]: true }));
    try {
      await api.restoreClient(c.id);
      // Refresh both this page and the global client list
      await Promise.all([load(), refreshClients()]);
    } catch (err: any) {
      alert('Restore failed: ' + err.message);
    } finally {
      setRestoring(s => ({ ...s, [c.id]: false }));
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Deleted Clients</h2>
        <div className="dashboard-actions">
          <Link to="/clients" className="btn btn-secondary">← Back to Clients</Link>
        </div>
      </div>

      <div style={{
        padding: '8px 12px', marginBottom: 16,
        background: '#f1f5f9', border: '1px solid var(--border)',
        borderRadius: 6, fontSize: 13, color: '#475569',
      }}>
        Soft-deleted clients are hidden from the rest of the app but their data
        (invoices, documents, compliance tasks) is preserved. Restoring brings
        the client back as if nothing happened.
      </div>

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No deleted clients.</p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Trading name</th>
                <th>Tax number</th>
                <th>Deleted</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    {c.client_code && <span className="client-code-inline">{c.client_code}</span>}
                    {c.name}
                  </td>
                  <td>{c.trading_name || '—'}</td>
                  <td>{c.tax_number || '—'}</td>
                  <td>{c.deleted_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!!restoring[c.id]}
                      onClick={() => handleRestore(c)}
                    >
                      {restoring[c.id] ? 'Restoring…' : 'Restore'}
                    </button>
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
