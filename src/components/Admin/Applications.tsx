import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const statusBadge = (s: string) => ({
  pending: { bg: '#fef9c3', fg: '#854d0e' }, approved: { bg: '#dcfce7', fg: '#166534' }, rejected: { bg: '#fee2e2', fg: '#991b1b' },
}[s] || { bg: '#f1f5f9', fg: '#475569' });

// Staff review of self-signup applications. Approve creates the client + sends
// the portal invite via the existing flow; reject records a reason.
export default function Applications() {
  const { user } = useAuth();
  const [rows, setRows]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fStatus, setFStatus] = useState('pending');
  const [busyId, setBusyId]   = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.getApplications(fStatus || undefined)); }
    catch (err: any) { alert('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fStatus]);

  const approve = async (a: any) => {
    if (!confirm(`Approve "${a.business_name}"?\n\nThis creates a client record and emails ${a.email} a portal invite.`)) return;
    setBusyId(a.id);
    try {
      const { code } = await api.getNextClientCode(a.business_name);
      const { id } = await api.createClient({
        client_code: code,
        name: a.business_name,
        tax_number: a.vat_number || null,
        phone: a.phone || null,
        email: a.email ? [a.email] : null,
        client_status: 'active', is_active: true, status: 'active',
        notes: `Self-signup application.\nType: ${a.business_type || '-'}\nReg no: ${a.registration_number || '-'}\n`
          + `Address: ${a.address || '-'}\nServices: ${a.services_wanted || '-'}${a.notes ? '\nNotes: ' + a.notes : ''}`,
      });
      await api.inviteClient({ email: a.email, full_name: a.contact_person || a.business_name, client_id: id });
      await api.updateApplication(a.id, {
        status: 'approved', created_client_id: id, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(),
      });
      alert(`Approved. Client ${code} created and an invite sent to ${a.email}.`);
      await load();
    } catch (err: any) { alert('Approve failed: ' + err.message); }
    finally { setBusyId(null); }
  };

  const reject = async (a: any) => {
    const reason = prompt('Reason for rejection (optional, kept internal):');
    if (reason === null) return;
    setBusyId(a.id);
    try {
      await api.updateApplication(a.id, {
        status: 'rejected', review_notes: reason || null, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(),
      });
      await load();
    } catch (err: any) { alert('Reject failed: ' + err.message); }
    finally { setBusyId(null); }
  };

  const field = (label: string, value: any) => value ? (
    <div style={{ fontSize: 13 }}><span style={{ color: '#64748b' }}>{label}:</span> {value}</div>
  ) : null;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Portal Applications</h2>
        <div className="dashboard-actions">
          <select className="form-input" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state"><p>No applications.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(a => {
            const b = statusBadge(a.status);
            return (
              <div key={a.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 15 }}>{a.business_name}</strong>
                      <span style={{ background: b.bg, color: b.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, textTransform: 'capitalize' }}>{a.status}</span>
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>{fmtDate(a.created_at)}</span>
                    </div>
                    <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px' }}>
                      {field('Type', a.business_type)}
                      {field('Contact', a.contact_person)}
                      {field('Email', a.email)}
                      {field('Phone', a.phone)}
                      {field('VAT', a.vat_number)}
                      {field('Reg no', a.registration_number)}
                      {field('Address', a.address)}
                      {field('Services', a.services_wanted)}
                      {field('Notes', a.notes)}
                      {a.status === 'rejected' && field('Reject reason', a.review_notes)}
                    </div>
                  </div>
                  {a.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => reject(a)} disabled={busyId === a.id}>Reject</button>
                      <button className="btn btn-primary btn-sm" onClick={() => approve(a)} disabled={busyId === a.id}>{busyId === a.id ? 'Working…' : 'Approve'}</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
