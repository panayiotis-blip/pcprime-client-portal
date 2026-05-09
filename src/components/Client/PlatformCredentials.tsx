import { useState, useEffect } from 'react';
import { api } from '../../services/api';

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

export default function PlatformCredentials({ clientId }: { clientId: number }) {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ platform: '', username: '', password: '', notes: '' });
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());

  const load = async () => { try { setCredentials(await api.getCredentials(clientId)); } catch {} };
  useEffect(() => { load(); }, [clientId]);

  const handleChange = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.platform.trim()) return;
    if (editId) {
      await api.updateCredential(clientId, editId, form);
    } else {
      await api.createCredential(clientId, form);
    }
    setForm({ platform: '', username: '', password: '', notes: '' });
    setShowAdd(false);
    setEditId(null);
    await load();
  };

  const handleEdit = (cred: any) => {
    setForm({ platform: cred.platform, username: cred.username, password: cred.password, notes: cred.notes });
    setEditId(cred.id);
    setShowAdd(true);
  };

  const handleDelete = async (credId: number) => {
    if (confirm('Delete these credentials?')) {
      await api.deleteCredential(clientId, credId);
      await load();
    }
  };

  const togglePassword = (id: number) => {
    setShowPasswords(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="platform-credentials">
      <div className="list-header">
        <h3>Platform Logins & Credentials</h3>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(!showAdd); setEditId(null); setForm({ platform: '', username: '', password: '', notes: '' }); }}>
          {showAdd ? 'Cancel' : '+ Add Credentials'}
        </button>
      </div>

      {showAdd && (
        <div className="cred-form card">
          <div className="form-grid">
            <div className="form-group">
              <label>Platform</label>
              <select value={form.platform} onChange={(e) => handleChange('platform', e.target.value)} className="form-input">
                <option value="">-- Select --</option>
                {DEFAULT_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {form.platform === 'Other' && (
                <input type="text" placeholder="Platform name" onChange={(e) => handleChange('platform', e.target.value)} className="form-input" style={{ marginTop: 6 }} />
              )}
            </div>
            <div className="form-group">
              <label>Username / Login ID</label>
              <input type="text" value={form.username} onChange={(e) => handleChange('username', e.target.value)} className="form-input" />
            </div>
            <div className="form-group">
              <label>Password / Code</label>
              <input type="text" value={form.password} onChange={(e) => handleChange('password', e.target.value)} className="form-input" />
            </div>
            <div className="form-group full-width">
              <label>Notes</label>
              <input type="text" value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} className="form-input" placeholder="e.g. 2FA method, recovery email, etc." />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleSave} style={{ marginTop: 12 }}>
            {editId ? 'Update' : 'Save'}
          </button>
        </div>
      )}

      {credentials.length === 0 ? (
        <div className="empty-state"><p>No platform credentials saved yet.</p></div>
      ) : (
        <div className="cred-list">
          {credentials.map((cred: any) => (
            <div key={cred.id} className="cred-card card">
              <div className="cred-card-header">
                <h4>{cred.platform}</h4>
                <div className="cred-card-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(cred)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(cred.id)}>Delete</button>
                </div>
              </div>
              <div className="cred-fields">
                <div className="cred-field">
                  <span className="cred-label">Username:</span>
                  <span className="cred-value">{cred.username || '-'}</span>
                  {cred.username && (
                    <button className="btn btn-link btn-sm" onClick={() => navigator.clipboard.writeText(cred.username)}>Copy</button>
                  )}
                </div>
                <div className="cred-field">
                  <span className="cred-label">Password:</span>
                  <span className="cred-value">
                    {showPasswords.has(cred.id) ? cred.password : '••••••••'}
                  </span>
                  <button className="btn btn-link btn-sm" onClick={() => togglePassword(cred.id)}>
                    {showPasswords.has(cred.id) ? 'Hide' : 'Show'}
                  </button>
                  {cred.password && (
                    <button className="btn btn-link btn-sm" onClick={() => navigator.clipboard.writeText(cred.password)}>Copy</button>
                  )}
                </div>
                {cred.notes && (
                  <div className="cred-field">
                    <span className="cred-label">Notes:</span>
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
