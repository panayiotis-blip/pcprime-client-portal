import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { formatDate } from '../../services/dates';

const RISK_LEVELS = ['Low', 'Medium', 'High'];
const KYC_STATUSES = ['pending', 'approved', 'expired', 'rejected'];

export default function KYCPanel({ clientId, onRefresh }: { clientId: number; onRefresh?: () => void }) {
  const [client, setClient] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try {
      const c = await api.getClient(clientId);
      setClient(c);
      setForm(c);
    } catch {}
  };

  useEffect(() => { load(); }, [clientId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateClient(clientId, form);
      await load();
      if (onRefresh) onRefresh();
      setEditing(false);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  if (!client) return <div>Loading...</div>;

  const today = new Date();
  const nextReview = client.kyc_next_review ? new Date(client.kyc_next_review) : null;
  const lastReviewed = client.kyc_last_reviewed ? new Date(client.kyc_last_reviewed) : null;
  const isExpired = nextReview && nextReview < today;
  const daysUntilReview = nextReview ? Math.ceil((nextReview.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

  const statusColor = (s: string) => {
    if (s === 'approved') return 'status-reviewed';
    if (s === 'expired' || s === 'rejected') return 'status-draft';
    return 'status-exported';
  };

  return (
    <div className="kyc-panel">
      <div className="list-header">
        <h3>KYC Compliance</h3>
        {editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); setForm(client); }}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Edit KYC</button>
        )}
      </div>

      {/* Status banner */}
      <div className="kyc-status-banner">
        <div className={`kyc-status-box kyc-${(client.kyc_status || 'pending').toLowerCase()}`}>
          <div className="kyc-label">Status</div>
          <div className="kyc-value">{(client.kyc_status || 'pending').toUpperCase()}</div>
        </div>
        <div className={`kyc-status-box kyc-risk-${(client.kyc_risk_level || 'low').toLowerCase()}`}>
          <div className="kyc-label">Risk Level</div>
          <div className="kyc-value">{client.kyc_risk_level || 'Not set'}</div>
        </div>
        <div className={`kyc-status-box ${isExpired ? 'kyc-rejected' : daysUntilReview !== null && daysUntilReview < 30 ? 'kyc-pending' : ''}`}>
          <div className="kyc-label">Next Review</div>
          <div className="kyc-value">
            {formatDate(nextReview, 'Not scheduled')}
            {daysUntilReview !== null && (
              <span style={{ fontSize: 11, display: 'block', fontWeight: 400 }}>
                {isExpired ? `OVERDUE by ${Math.abs(daysUntilReview)} days` : `in ${daysUntilReview} days`}
              </span>
            )}
          </div>
        </div>
        <div className="kyc-status-box">
          <div className="kyc-label">Last Reviewed</div>
          <div className="kyc-value">{formatDate(lastReviewed, 'Never')}</div>
        </div>
      </div>

      {/* Details */}
      <div className="form-section">
        <h4 style={{ marginBottom: 12 }}>Review Information</h4>
        <div className="form-grid">
          <div className="form-group">
            <label>KYC Status</label>
            {editing ? (
              <select value={form.kyc_status || 'pending'} onChange={(e) => setForm((p: any) => ({ ...p, kyc_status: e.target.value }))} className="form-input">
                {KYC_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : <p className="field-value">{client.kyc_status || '-'}</p>}
          </div>
          <div className="form-group">
            <label>Risk Level</label>
            {editing ? (
              <select value={form.kyc_risk_level || ''} onChange={(e) => setForm((p: any) => ({ ...p, kyc_risk_level: e.target.value }))} className="form-input">
                <option value="">--</option>
                {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : <p className="field-value">{client.kyc_risk_level || '-'}</p>}
          </div>
          <div className="form-group">
            <label>Last Reviewed</label>
            {editing ? (
              <input type="date" value={form.kyc_last_reviewed || ''} onChange={(e) => setForm((p: any) => ({ ...p, kyc_last_reviewed: e.target.value }))} className="form-input" />
            ) : <p className="field-value">{client.kyc_last_reviewed || '-'}</p>}
          </div>
          <div className="form-group">
            <label>Next Review Due</label>
            {editing ? (
              <input type="date" value={form.kyc_next_review || ''} onChange={(e) => setForm((p: any) => ({ ...p, kyc_next_review: e.target.value }))} className="form-input" />
            ) : <p className="field-value">{client.kyc_next_review || '-'}</p>}
          </div>
          <div className="form-group">
            <label>Politically Exposed Person (PEP)</label>
            {editing ? (
              <select value={form.kyc_pep_status || 'no'} onChange={(e) => setForm((p: any) => ({ ...p, kyc_pep_status: e.target.value }))} className="form-input">
                <option value="no">No</option>
                <option value="yes">Yes</option>
                <option value="unknown">Unknown / To check</option>
              </select>
            ) : <p className="field-value">{client.kyc_pep_status || 'no'}</p>}
          </div>
          <div className="form-group">
            <label>Source of Funds</label>
            {editing ? (
              <input type="text" value={form.kyc_source_of_funds || ''} onChange={(e) => setForm((p: any) => ({ ...p, kyc_source_of_funds: e.target.value }))} className="form-input" placeholder="e.g. Business income" />
            ) : <p className="field-value">{client.kyc_source_of_funds || '-'}</p>}
          </div>
          <div className="form-group full-width">
            <label>Beneficial Owner(s)</label>
            {editing ? (
              <input type="text" value={form.kyc_beneficial_owner || ''} onChange={(e) => setForm((p: any) => ({ ...p, kyc_beneficial_owner: e.target.value }))} className="form-input" placeholder="Names of UBOs" />
            ) : <p className="field-value">{client.kyc_beneficial_owner || '-'}</p>}
          </div>
          <div className="form-group full-width">
            <label>KYC Notes</label>
            {editing ? (
              <textarea value={form.kyc_notes || ''} onChange={(e) => setForm((p: any) => ({ ...p, kyc_notes: e.target.value }))} className="form-input" rows={4} />
            ) : <p className="field-value" style={{ whiteSpace: 'pre-wrap' }}>{client.kyc_notes || '-'}</p>}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        📁 Upload KYC documents (ID copies, proof of address, UBO forms, risk assessments) in the <strong>KYC Documents</strong> folder under the Documents tab.
      </p>
    </div>
  );
}
