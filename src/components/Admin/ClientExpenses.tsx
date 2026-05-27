import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const fmtDate = (iso: string | null) => iso || '—';
const statusBadge = (s: string) => ({
  submitted: { bg: '#fef9c3', fg: '#854d0e' }, allocated: { bg: '#dcfce7', fg: '#166534' }, rejected: { bg: '#fee2e2', fg: '#991b1b' },
}[s] || { bg: '#f1f5f9', fg: '#475569' });

// Back-office queue of client-submitted expenses to review & allocate.
export default function ClientExpenses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fStatus, setFStatus] = useState('submitted');
  const [busyId, setBusyId]   = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.getClientExpenses(fStatus ? { status: fStatus } : undefined)); }
    catch (err: any) { alert('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus]);

  const viewFile = async (path: string) => {
    if (!path) return;
    try { window.open(await api.expenseFileUrl(path), '_blank'); } catch (err: any) { alert(err.message); }
  };

  const reject = async (e: any) => {
    const notes = prompt('Reason for rejection:');
    if (notes === null) return;
    setBusyId(e.id);
    try {
      await api.updateExpense(e.id, { status: 'rejected', allocation_notes: notes || null, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString() });
      await load();
    } catch (err: any) { alert('Failed: ' + err.message); }
    finally { setBusyId(null); }
  };

  // Allocate = open the scanned-document editor prefilled from this expense and
  // its uploaded file, so staff assign journal lines as if they had scanned it.
  // The editor marks the expense allocated + linked once the invoice is saved.
  const allocate = async (e: any) => {
    setBusyId(e.id);
    try {
      const fileUrl = e.storage_path ? await api.expenseFileUrl(e.storage_path) : null;
      navigate('/invoices/new', {
        state: {
          clientId: e.owner_client_id,
          journalCode: 'JV',
          parsed: {
            invoiceNumber: '',
            vendorName: e.vendor_name || '',
            invoiceDate: e.expense_date || '',
            totalAmount: Number(e.amount || 0),
            taxAmount: Number(e.vat_amount || 0),
            currency: e.currency || '',
          },
          fromExpense: { id: e.id, fileUrl, fileName: e.file_name, fileMime: e.mime_type },
        },
      });
    } catch (err: any) { alert('Could not open: ' + err.message); setBusyId(null); }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Client Expenses</h2>
        <div className="dashboard-actions">
          <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="submitted">Submitted</option>
            <option value="allocated">Allocated</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No expenses.</p></div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Client</th><th>Date</th><th>Supplier</th><th>Type</th><th>Project</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>VAT</th>
                <th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => {
                const b = statusBadge(e.status);
                return (
                  <tr key={e.id}>
                    <td>{e.client_code ? e.client_code + ' — ' : ''}{e.client_name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.expense_date)}</td>
                    <td>{e.vendor_name || '—'}</td>
                    <td>{e.expense_type || '—'}</td>
                    <td>{e.project_code || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{e.amount != null ? '€' + Number(e.amount).toFixed(2) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{e.vat_amount != null ? '€' + Number(e.vat_amount).toFixed(2) : '—'}</td>
                    <td><span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{e.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {e.storage_path && <button className="btn btn-secondary btn-sm" onClick={() => viewFile(e.storage_path)}>View</button>}{' '}
                      {e.status === 'submitted' && (
                        <>
                          <button className="btn btn-primary btn-sm" disabled={busyId === e.id} onClick={() => allocate(e)}>Allocate</button>{' '}
                          <button className="btn btn-secondary btn-sm" disabled={busyId === e.id} onClick={() => reject(e)}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
