import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button } from '../ui';

const EMPTY = {
  name: '', contact_person: '', email: '', phone: '', vat_number: '', address: '', notes: '', active: true,
};

// The client's own customer list (basis for the invoices they'll issue).
export default function MyCustomers() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy]       = useState(false);

  const load = async () => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    try { setRows(await api.getCustomers(clientId)); }
    catch (err: any) { alert('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);

  const f = (k: string, v: any) => setEditing((e: any) => ({ ...e, [k]: v }));

  const save = async () => {
    if (!editing?.name?.trim()) { alert('A customer name is required.'); return; }
    setBusy(true);
    try {
      await api.saveCustomer({ ...editing, owner_client_id: clientId!, name: editing.name.trim() });
      setEditing(null);
      await load();
    } catch (err: any) { alert('Save failed: ' + err.message); }
    finally { setBusy(false); }
  };

  const remove = async (c: any) => {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    try { await api.deleteCustomer(c.id); await load(); }
    catch (err: any) { alert('Delete failed: ' + err.message); }
  };

  if (!clientId) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Customers</h2>
        <div className="dashboard-actions">
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>+ New Customer</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No customers yet — add your first one.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>VAT</th>
                <th style={{ textAlign: 'center' }}>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} style={c.active ? undefined : { opacity: 0.55 }}>
                  <td>{c.name}</td>
                  <td>{c.contact_person || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.vat_number || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{c.active ? '✓' : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ ...c })}>Edit</Button>{' '}
                    <Button size="sm" variant="ghost" onClick={() => remove(c)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => { if (!busy) setEditing(null); }}
        title={editing?.id ? 'Edit Customer' : 'New Customer'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        {editing && (
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Name *</label>
              <input className="form-input" value={editing.name} onChange={e => f('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Contact person</label>
              <input className="form-input" value={editing.contact_person || ''} onChange={e => f('contact_person', e.target.value)} />
            </div>
            <div className="form-group">
              <label>VAT number</label>
              <input className="form-input" value={editing.vat_number || ''} onChange={e => f('vat_number', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" value={editing.email || ''} onChange={e => f('email', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input className="form-input" value={editing.phone || ''} onChange={e => f('phone', e.target.value)} />
            </div>
            <div className="form-group full-width">
              <label>Address</label>
              <textarea className="form-input" rows={2} value={editing.address || ''} onChange={e => f('address', e.target.value)} />
            </div>
            <div className="form-group full-width">
              <label>Notes</label>
              <input className="form-input" value={editing.notes || ''} onChange={e => f('notes', e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={editing.active} onChange={e => f('active', e.target.checked)} />
              Active
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
