import { useState, useEffect } from 'react';
import { api, hasPermission } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const DEFAULT_PLATFORMS = [
  'TFA (Tax For All)',
  'Social Insurance',
  'Ergani',
  'CY Login',
  'JCC',
  'VAT (VIES)',
  'General Healthcare System (GESY)',
  'Bank Portal',
  'Other',
];

type Cred = {
  id: number;
  client_id: number;
  platform: string;
  username: string;
  notes: string;
  has_password: boolean;
};

type FormState = {
  platform: string;
  username: string;
  password: string; // empty when editing means "do not change"
  notes: string;
};

const blankForm: FormState = { platform: '', username: '', password: '', notes: '' };

export default function PlatformCredentials({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const canReveal = hasPermission(user, 'credentials.reveal');
  const canWrite  = hasPermission(user, 'credentials.write');
  const [credentials, setCredentials] = useState<Cred[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Map credId → revealed cleartext password. Cleared on Hide / page leave.
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [revealing, setRevealing] = useState<Record<number, boolean>>({});

  const load = async () => {
    setLoading(true);
    try { setCredentials(await api.getCredentials(clientId) as Cred[]); }
    catch (err: any) { alert('Failed to load credentials: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [clientId]);

  const handleChange = (field: keyof FormState, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const startAdd = () => {
    setEditId(null);
    setForm(blankForm);
    setShowAdd(true);
  };

  const startEdit = (cred: Cred) => {
    setEditId(cred.id);
    // Note: password is intentionally blank — we never load the cleartext into the form.
    setForm({ platform: cred.platform, username: cred.username, password: '', notes: cred.notes });
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!form.platform.trim()) { alert('Platform is required'); return; }
    setSaving(true);
    try {
      if (editId) {
        // Only send the password if the user actually typed one.
        const patch: any = { platform: form.platform, username: form.username, notes: form.notes };
        if (form.password) patch.password = form.password;
        await api.updateCredential(clientId, editId, patch);
      } else {
        await api.createCredential(clientId, form);
      }
      setForm(blankForm);
      setShowAdd(false);
      setEditId(null);
      // Clear any revealed values — they may have changed
      setRevealed({});
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (credId: number) => {
    if (!confirm('Delete this credential? The encrypted row will be removed permanently. This cannot be undone.')) return;
    try {
      await api.deleteCredential(clientId, credId);
      setRevealed(r => { const n = { ...r }; delete n[credId]; return n; });
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const reveal = async (credId: number) => {
    setRevealing(r => ({ ...r, [credId]: true }));
    try {
      const pwd = await api.getCredentialPassword(credId);
      setRevealed(r => ({ ...r, [credId]: pwd }));
    } catch (err: any) {
      alert('Reveal failed: ' + err.message);
    } finally {
      setRevealing(r => ({ ...r, [credId]: false }));
    }
  };

  const hide = (credId: number) => {
    setRevealed(r => { const n = { ...r }; delete n[credId]; return n; });
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); }
    catch { /* ignore */ }
  };

  return (
    <div className="platform-credentials">
      <div className="list-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Platform Logins & Credentials</h3>
        {canWrite && (
          <button className="btn btn-primary btn-sm" onClick={() => (showAdd ? (setShowAdd(false), setEditId(null), setForm(blankForm)) : startAdd())}>
            {showAdd ? 'Cancel' : '+ Add Credentials'}
          </button>
        )}
      </div>

      <div style={{
        marginTop: 8, padding: '8px 12px',
        background: '#fef3c7', border: '1px solid #fbbf24',
        borderRadius: 6, fontSize: 13,
      }}>
        Passwords are encrypted at rest. Every reveal is recorded in the <strong>Audit Log</strong>.
      </div>

      {showAdd && (
        <div className="cred-form card" style={{ marginTop: 12, padding: 12, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Platform</label>
              <select value={DEFAULT_PLATFORMS.includes(form.platform) ? form.platform : (form.platform ? 'Other' : '')}
                onChange={(e) => handleChange('platform', e.target.value === 'Other' ? '' : e.target.value)}
                className="form-input">
                <option value="">-- Select --</option>
                {DEFAULT_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {(!DEFAULT_PLATFORMS.includes(form.platform) || form.platform === '') && (
                <input type="text" placeholder="Platform name" value={form.platform}
                  onChange={(e) => handleChange('platform', e.target.value)}
                  className="form-input" style={{ marginTop: 6 }} />
              )}
            </div>
            <div className="form-group">
              <label>Username / Login ID</label>
              <input type="text" value={form.username} onChange={(e) => handleChange('username', e.target.value)} className="form-input" />
            </div>
            <div className="form-group">
              <label>Password / Code {editId && <small style={{ color: '#64748b' }}>(leave blank to keep current)</small>}</label>
              <input type="password" autoComplete="new-password"
                value={form.password} onChange={(e) => handleChange('password', e.target.value)}
                className="form-input" />
            </div>
            <div className="form-group full-width">
              <label>Notes</label>
              <input type="text" value={form.notes} onChange={(e) => handleChange('notes', e.target.value)}
                className="form-input" placeholder="e.g. 2FA method, recovery email, etc." />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving} style={{ marginTop: 12 }}>
            {saving ? 'Saving…' : (editId ? 'Update' : 'Save')}
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 12 }}>Loading…</p>
      ) : credentials.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}><p>No platform credentials saved yet.</p></div>
      ) : (
        <div className="cred-list" style={{ marginTop: 12 }}>
          {credentials.map(cred => (
            <div key={cred.id} className="cred-card card" style={{ padding: 12, marginBottom: 10 }}>
              <div className="cred-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>{cred.platform}</h4>
                {canWrite && (
                  <div className="cred-card-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(cred)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(cred.id)} style={{ marginLeft: 6 }}>Delete</button>
                  </div>
                )}
              </div>
              <div className="cred-fields">
                <div className="cred-field" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="cred-label" style={{ minWidth: 90, color: '#64748b' }}>Username:</span>
                  <span className="cred-value">{cred.username || '—'}</span>
                  {cred.username && (
                    <button className="btn btn-link btn-sm" onClick={() => copy(cred.username)}>Copy</button>
                  )}
                </div>
                <div className="cred-field" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="cred-label" style={{ minWidth: 90, color: '#64748b' }}>Password:</span>
                  <span className="cred-value" style={{ fontFamily: revealed[cred.id] ? 'monospace' : 'inherit' }}>
                    {!cred.has_password ? <em style={{ color: '#94a3b8' }}>(none set)</em>
                      : revealed[cred.id] != null ? revealed[cred.id]
                      : '••••••••'}
                  </span>
                  {cred.has_password && canReveal && (
                    revealed[cred.id] != null ? (
                      <>
                        <button className="btn btn-link btn-sm" onClick={() => copy(revealed[cred.id])}>Copy</button>
                        <button className="btn btn-link btn-sm" onClick={() => hide(cred.id)}>Hide</button>
                      </>
                    ) : (
                      <button className="btn btn-link btn-sm" disabled={!!revealing[cred.id]} onClick={() => reveal(cred.id)}>
                        {revealing[cred.id] ? 'Revealing…' : 'Reveal'}
                      </button>
                    )
                  )}
                </div>
                {cred.notes && (
                  <div className="cred-field" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span className="cred-label" style={{ minWidth: 90, color: '#64748b' }}>Notes:</span>
                    <span className="cred-value">{cred.notes}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
