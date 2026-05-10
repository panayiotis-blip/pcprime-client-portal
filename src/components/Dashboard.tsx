import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { isStaffRole } from '../services/api';

export default function Dashboard() {
  const { invoices, clients } = useApp();
  const { user, mfa } = useAuth();
  const showMfaNag = isStaffRole(user) && !mfa.enrolled;

  if (user?.role === 'client') {
    // Client view — just show their stats
    const myInvoices = invoices;
    return (
      <div className="dashboard">
        <h2>My Dashboard</h2>
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-number">{myInvoices.length}</div><div className="stat-label">Invoices</div></div>
          <div className="stat-card stat-draft"><div className="stat-number">{myInvoices.filter((i: any) => i.status === 'draft').length}</div><div className="stat-label">Drafts</div></div>
          <div className="stat-card stat-reviewed"><div className="stat-number">{myInvoices.filter((i: any) => i.status === 'reviewed').length}</div><div className="stat-label">Reviewed</div></div>
          <div className="stat-card stat-exported"><div className="stat-number">{myInvoices.filter((i: any) => i.status === 'exported').length}</div><div className="stat-label">Exported</div></div>
        </div>
        <div className="quick-actions">
          <Link to="/documents" className="btn btn-primary btn-lg">Upload Documents</Link>
          <Link to="/invoices" className="btn btn-secondary btn-lg">View Invoices</Link>
        </div>
      </div>
    );
  }

  // Admin view — client grid
  const getClientStats = (clientId: number) => {
    const clientInvoices = invoices.filter((i: any) => i.client_id === clientId);
    return {
      total: clientInvoices.length,
      draft: clientInvoices.filter((i: any) => i.status === 'draft').length,
      reviewed: clientInvoices.filter((i: any) => i.status === 'reviewed').length,
      exported: clientInvoices.filter((i: any) => i.status === 'exported').length,
    };
  };

  return (
    <div className="dashboard">
      {showMfaNag && (
        <div style={{
          padding: '12px 16px',
          marginBottom: 16,
          background: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <strong>Two-factor authentication is not enabled.</strong>{' '}
            We strongly recommend enabling it on your account.
          </div>
          <Link to="/security" className="btn btn-primary btn-sm">Enable now</Link>
        </div>
      )}
      <div className="dashboard-header">
        <h2>Clients Overview</h2>
        <div className="dashboard-actions">
          <Link to="/scan" className="btn btn-primary">+ Scan Invoices</Link>
          <Link to="/clients" className="btn btn-secondary">Manage Clients</Link>
        </div>
      </div>

      {/* Global stats */}
      <div className="stats-grid">
        <div className="stat-card"><div className="stat-number">{clients.length}</div><div className="stat-label">Clients</div></div>
        <div className="stat-card"><div className="stat-number">{invoices.length}</div><div className="stat-label">Total Invoices</div></div>
        <div className="stat-card stat-draft"><div className="stat-number">{invoices.filter((i: any) => i.status === 'draft').length}</div><div className="stat-label">Drafts</div></div>
        <div className="stat-card stat-reviewed"><div className="stat-number">{invoices.filter((i: any) => i.status === 'reviewed').length}</div><div className="stat-label">Reviewed</div></div>
        <div className="stat-card stat-exported"><div className="stat-number">{invoices.filter((i: any) => i.status === 'exported').length}</div><div className="stat-label">Exported</div></div>
      </div>

      {/* Client cards grid */}
      <div className="section-header" style={{ marginTop: 24 }}>
        <h3>Clients ({clients.length})</h3>
      </div>

      {clients.length === 0 ? (
        <div className="empty-state">
          <p>No clients yet. Create one to get started.</p>
          <Link to="/clients" className="btn btn-primary">+ Add Client</Link>
        </div>
      ) : (
        <div className="dashboard-clients-grid">
          {clients.map((client: any) => {
            const stats = getClientStats(client.id);
            return (
              <Link to={`/clients/${client.id}`} key={client.id} className="dashboard-client-card">
                <div className="dc-card-header">
                  <h3>{client.name}</h3>
                  {client.trading_name && <p className="dc-trading">{client.trading_name}</p>}
                  <span className={`status-badge status-${client.status === 'active' ? 'reviewed' : 'draft'}`}>{client.status || 'active'}</span>
                </div>

                <div className="dc-card-stats">
                  <div className="dc-stat"><span className="dc-stat-num">{stats.total}</span><span className="dc-stat-label">Invoices</span></div>
                  <div className="dc-stat dc-draft"><span className="dc-stat-num">{stats.draft}</span><span className="dc-stat-label">Draft</span></div>
                  <div className="dc-stat dc-reviewed"><span className="dc-stat-num">{stats.reviewed}</span><span className="dc-stat-label">Review</span></div>
                  <div className="dc-stat dc-exported"><span className="dc-stat-num">{stats.exported}</span><span className="dc-stat-label">Exported</span></div>
                </div>

                <div className="dc-card-info">
                  {client.contact_person && <p>{client.contact_person}</p>}
                  {client.email && <p>{client.email}</p>}
                  {client.phone && <p>{client.phone}</p>}
                  {client.tax_number && <p>Tax: {client.tax_number}</p>}
                </div>

                <div className="dc-card-footer">
                  <span>View Details →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
