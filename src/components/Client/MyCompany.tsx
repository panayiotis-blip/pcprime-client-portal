import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Client's own invoicing identity — the details + logo that appear on the
// invoices/receipts they issue to their customers. Seeded from the firm's
// record, fully editable.
export default function MyCompany() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [form, setForm]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try { const p = await api.getCompanyProfile(clientId); if (!cancelled) setForm(p); }
      catch (err: any) { if (!cancelled) alert('Failed to load: ' + err.message); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      await api.saveCompanyProfile(clientId, form);
      setForm(await api.getCompanyProfile(clientId));
      alert('Saved.');
    } catch (err: any) { alert('Save failed: ' + err.message); }
    finally { setSaving(false); }
  };

  const onLogo = async (file: File) => {
    if (!clientId) return;
    setUploading(true);
    try {
      const url = await api.uploadClientLogo(clientId, file);
      await api.saveCompanyProfile(clientId, { ...form, logo_url: url });
      set('logo_url', url);
    } catch (err: any) { alert('Logo upload failed: ' + err.message); }
    finally { setUploading(false); }
  };

  if (!clientId) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;
  if (loading || !form) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>My Company</h2>
        <div className="dashboard-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        These details appear on the invoices and receipts you issue to your customers.
        Pre-filled from our records — edit anything you need.
      </p>

      <div className="card" style={{ maxWidth: 760 }}>
        <div className="form-group">
          <label>Logo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {form.logo_url
              ? <img src={form.logo_url} alt="Company logo" style={{ maxHeight: 60, maxWidth: 180, border: '1px solid #e2e8f0', borderRadius: 4 }} />
              : <span style={{ color: '#94a3b8' }}>No logo yet</span>}
            <label className="btn btn-secondary btn-sm" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
              {uploading ? 'Uploading…' : (form.logo_url ? 'Replace logo' : 'Upload logo')}
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) onLogo(f); }} />
            </label>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group full-width">
            <label>Business name</label>
            <input className="form-input" value={form.business_name || ''} onChange={e => set('business_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>VAT number</label>
            <input className="form-input" value={form.vat_number || ''} onChange={e => set('vat_number', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Registration number</label>
            <input className="form-input" value={form.registration_number || ''} onChange={e => set('registration_number', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input className="form-input" value={form.phone || ''} onChange={e => set('phone', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="form-input" value={form.email || ''} onChange={e => set('email', e.target.value)} />
          </div>
          <div className="form-group full-width">
            <label>Address</label>
            <textarea className="form-input" rows={3} value={form.address || ''} onChange={e => set('address', e.target.value)} />
          </div>
          <div className="form-group full-width">
            <label>Invoice footer (optional)</label>
            <input className="form-input" value={form.footer || ''} onChange={e => set('footer', e.target.value)}
              placeholder="e.g. payment terms or bank details shown on your invoices" />
          </div>
        </div>
      </div>
    </div>
  );
}
