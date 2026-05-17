import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, hasPermission } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import { Modal, Button } from '../ui';

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
  const { runWith } = useMFAStepUp();
  const isOwner = user?.role === 'owner';
  const [rows, setRows] = useState<Client[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'list'>(
    () => (localStorage.getItem('deleted_clients_view') as 'table' | 'list') || 'table'
  );
  const setView = (m: 'table' | 'list') => { setViewMode(m); localStorage.setItem('deleted_clients_view', m); };
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<Record<number, boolean>>({});

  // Permanent-delete state
  const [delTarget, setDelTarget] = useState<Client | null>(null);
  const [delText, setDelText] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [busy, setBusy] = useState(false);

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
      await runWith(() => api.restoreClient(c.id));
      await Promise.all([load(), refreshClients()]);
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Restore failed: ' + err.message);
    } finally {
      setRestoring(s => ({ ...s, [c.id]: false }));
    }
  };

  // Per-row permanent delete.
  const handlePermanentDelete = async () => {
    if (!delTarget) return;
    setBusy(true);
    try {
      const res = await runWith(() => api.hardDeleteClients([delTarget.id]));
      setDelTarget(null);
      setDelText('');
      await Promise.all([load(), refreshClients()]);
      if (res.deleted === 0 && res.skipped?.length) {
        alert(`Not deleted — ${res.skipped[0]?.reason || 'unknown reason'}.`);
      }
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Permanent delete failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  // Bulk: permanently delete every soft-deleted client.
  const handleBulkDelete = async () => {
    setBusy(true);
    try {
      const res = await runWith(() => api.hardDeleteClients(rows.map(r => r.id)));
      setBulkOpen(false);
      setBulkText('');
      await Promise.all([load(), refreshClients()]);
      let msg = `Permanently deleted ${res.deleted} client${res.deleted === 1 ? '' : 's'}.`;
      if (res.skipped?.length) {
        msg += `\n\n${res.skipped.length} skipped:\n`
          + res.skipped.map((s: any) => `  • ${s.name || s.id}: ${s.reason}`).join('\n');
      }
      alert(msg);
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Bulk delete failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkPhrase = `DELETE ${rows.length}`;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Deleted Clients</h2>
        <div className="dashboard-actions">
          {isOwner && rows.length > 0 && (
            <Button variant="destructive" onClick={() => { setBulkText(''); setBulkOpen(true); }}>
              Empty Deleted Clients
            </Button>
          )}
          <div className="view-toggle">
            <button className={`view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Table view">☰ Table</button>
            <button className={`view-btn ${viewMode === 'list'  ? 'active' : ''}`} onClick={() => setView('list')}  title="Compact list">≡ List</button>
          </div>
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
        {isOwner && ' Permanent deletion removes the client and its data for good — and is blocked for clients that have sales invoices.'}
      </div>

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No deleted clients.</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="compact-list">
          {rows.map(c => (
            <div key={c.id} className="compact-row">
              <span className="cl-strong">{c.client_code ? `${c.client_code} — ` : ''}{c.name}</span>
              <span className="cl-muted">{c.tax_number || '—'}</span>
              <span className="cl-muted">deleted {c.deleted_at?.slice(0, 10)}</span>
              <button className="btn btn-primary btn-sm" disabled={!!restoring[c.id]} onClick={() => handleRestore(c)}>
                {restoring[c.id] ? 'Restoring…' : 'Restore'}
              </button>
              {isOwner && (
                <button className="btn btn-danger btn-sm" onClick={() => { setDelText(''); setDelTarget(c); }}>
                  Delete permanently
                </button>
              )}
            </div>
          ))}
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
                <th style={{ width: isOwner ? 240 : 120 }}>Actions</th>
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
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!!restoring[c.id]}
                        onClick={() => handleRestore(c)}
                      >
                        {restoring[c.id] ? 'Restoring…' : 'Restore'}
                      </button>
                      {isOwner && (
                        <button className="btn btn-danger btn-sm" onClick={() => { setDelText(''); setDelTarget(c); }}>
                          Delete permanently
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-row permanent delete — type the client name */}
      <Modal
        open={delTarget !== null}
        onClose={() => setDelTarget(null)}
        title="Permanently delete client"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDelTarget(null)} disabled={busy}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || delText.trim() !== (delTarget?.name || '')}
              onClick={handlePermanentDelete}
            >
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This permanently deletes <strong>{delTarget?.name}</strong> and its related data
          (addresses, directors, documents, credentials, compliance tasks). It
          <strong> cannot be undone</strong>. A client with sales invoices cannot be deleted.
        </p>
        <p style={{ fontSize: 13, color: 'var(--pc-text-2)' }}>
          Type the client name to confirm: <strong>{delTarget?.name}</strong>
        </p>
        <input
          className="form-input"
          value={delText}
          onChange={(e) => setDelText(e.target.value)}
          placeholder={delTarget?.name || ''}
          autoFocus
          style={{ width: '100%' }}
        />
      </Modal>

      {/* Bulk permanent delete — type "DELETE N" */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Empty Deleted Clients"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || bulkText.trim() !== bulkPhrase}
              onClick={handleBulkDelete}
            >
              {busy ? 'Deleting…' : 'Permanently delete all'}
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This permanently deletes <strong>all {rows.length}</strong> soft-deleted client
          {rows.length === 1 ? '' : 's'} and their related data. It <strong>cannot be undone</strong>.
          Clients with sales invoices are skipped and kept.
        </p>
        <p style={{ fontSize: 13, color: 'var(--pc-text-2)' }}>
          Type <strong>{bulkPhrase}</strong> to confirm:
        </p>
        <input
          className="form-input"
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={bulkPhrase}
          autoFocus
          style={{ width: '100%' }}
        />
      </Modal>
    </div>
  );
}
