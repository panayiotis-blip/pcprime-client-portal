import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button } from '../ui';
import { formatDate } from '../../services/dates';

const fmtDate = (iso: string | null) => formatDate(iso, '—');
const eur = (n: number) => '€' + Number(n || 0).toFixed(2);
const statusBadge = (s: string) => ({
  draft: { bg: '#f1f5f9', fg: '#475569' }, issued: { bg: '#dbeafe', fg: '#1e40af' },
  paid: { bg: '#dcfce7', fg: '#166534' }, cancelled: { bg: '#fee2e2', fg: '#991b1b' },
}[s] || { bg: '#f1f5f9', fg: '#475569' });

// The client's sales invoices (to their own customers).
export default function SalesInvoices() {
  const { user } = useAuth();
  const owner = user?.client_id;
  const navigate = useNavigate();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fStatus, setFStatus] = useState('');
  const [pickOpen, setPickOpen]       = useState(false);
  const [customers, setCustomers]     = useState<any[]>([]);
  const [newCustomerId, setNewCustomerId] = useState('');
  const [creating, setCreating]       = useState(false);

  const load = async () => {
    if (!owner) { setLoading(false); return; }
    setLoading(true);
    try { setRows(await api.getCustomerInvoices(owner, fStatus ? { status: fStatus } : undefined)); }
    catch (err: any) { alert('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [owner, fStatus]);

  const openNew = async () => {
    if (!owner) return;
    try { setCustomers(await api.getCustomers(owner)); } catch { /* ignore */ }
    setNewCustomerId('');
    setPickOpen(true);
  };
  const createInvoice = async () => {
    if (!newCustomerId) { alert('Pick a customer.'); return; }
    setCreating(true);
    try {
      const { id } = await api.createCustomerInvoice({ owner_client_id: owner!, customer_id: Number(newCustomerId) });
      navigate(`/sales/${id}`);
    } catch (err: any) { alert('Create failed: ' + err.message); }
    finally { setCreating(false); }
  };

  if (!owner) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Sales Invoices</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button className="btn btn-primary" onClick={openNew}>+ New Invoice</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No invoices yet.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Number</th><th>Customer</th><th>Issue date</th><th>Due date</th>
                <th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(i => {
                const bd = statusBadge(i.status);
                return (
                  <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/sales/${i.id}`)}>
                    <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{i.invoice_number || '(draft)'}</td>
                    <td>{i.customer_name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.issue_date)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.due_date)}</td>
                    <td><span style={{ background: bd.bg, color: bd.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{i.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{eur(i.total_amount)}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); navigate(`/sales/${i.id}`); }}>Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={pickOpen}
        onClose={() => { if (!creating) setPickOpen(false); }}
        title="New invoice — pick a customer"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPickOpen(false)} disabled={creating}>Cancel</Button>
            <Button variant="primary" onClick={createInvoice} disabled={creating || !newCustomerId}>{creating ? 'Creating…' : 'Create draft'}</Button>
          </>
        }
      >
        {customers.length === 0 ? (
          <p style={{ color: '#64748b', margin: 0 }}>You have no customers yet. Add one under <strong>Customers</strong> first.</p>
        ) : (
          <div className="form-group">
            <label>Customer</label>
            <select className="form-input" value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)}>
              <option value="">Select a customer…</option>
              {customers.filter((c: any) => c.active).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </Modal>
    </div>
  );
}
