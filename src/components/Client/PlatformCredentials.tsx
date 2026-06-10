import { useState, useEffect } from 'react';
import { api, hasPermission } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';

type PlatformSite = {
  id: number;
  name: string;
  url: string | null;
  notes: string | null;
  ordinal: number;
  enabled: boolean;
};

type Cred = {
  id: number;
  client_id: number;
  platform: string;
  platform_site_id: number | null;
  url: string | null;
  username: string;
  notes: string;
  has_password: boolean;
  site_name: string | null;
  site_url: string | null;
  effective_url: string | null;
};

type FormState = {
  platform_site_id: number | null;  // when null, use free-text platform + url
  platform: string;
  url: string;
  username: string;
  password: string; // empty when editing means "do not change"
  notes: string;
};

const blankForm: FormState = { platform_site_id: null, platform: '', url: '', username: '', password: '', notes: '' };

export default function PlatformCredentials({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const { runWith } = useMFAStepUp();
  const canReveal = hasPermission(user, 'credentials.reveal');
  const canWrite  = hasPermission(user, 'credentials.write');
  const [credentials, setCredentials] = useState<Cred[]>([]);
  const [sites, setSites] = useState<PlatformSite[]>([]);
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
    try {
      const [creds, siteList] = await Promise.all([
        api.getCredentials(clientId),
        api.getPlatformSites().catch(() => []),
      ]);
      setCredentials(creds as Cred[]);
      setSites((siteList as PlatformSite[]).filter(s => s.enabled));
    }
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
    setForm({
      platform_site_id: cred.platform_site_id,
      platform: cred.platform,
      url: cred.url || '',
      username: cred.username,
      password: '',
      notes: cred.notes,
    });
    setShowAdd(true);
  };

  const handleSave = async () => {
    const platformName = form.platform_site_id != null
      ? (sites.find(s => s.id === form.platform_site_id)?.name || form.platform)
      : form.platform;
    if (!platformName.trim()) { alert('Platform is required'); return; }
    setSaving(true);
    try {
      const payload: any = {
        platform: platformName,
        platform_site_id: form.platform_site_id,
        url: form.url || null,
        username: form.username,
        notes: form.notes,
      };
      if (editId) {
        if (form.password) payload.password = form.password;
        await api.updateCredential(clientId, editId, payload);
      } else {
        if (form.password) payload.password = form.password;
        await api.createCredential(clientId, payload);
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
      const pwd = await runWith(() => api.getCredentialPassword(credId));
      setRevealed(r => ({ ...r, [credId]: pwd }));
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Reveal failed: ' + err.message);
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

  // One-click "quick login" — opens the platform URL in a new tab AND
  // copies the (decrypted) password to the clipboard so the user just
  // pastes into the platform's password field. The reveal still goes
  // through MFA step-up + audit log just like the manual Reveal button.
  const quickLogin = async (cred: Cred) => {
    if (!cred.effective_url) { alert('No URL set for this platform. Add one in Company Settings → Platform Sites, or in this credential.'); return; }
    if (!canReveal) { alert('You do not have permission to reveal passwords.'); return; }
    if (!cred.has_password) { alert('No password stored for this credential.'); return; }
    setRevealing(r => ({ ...r, [cred.id]: true }));
    try {
      const pwd = await runWith(() => api.getCredentialPassword(cred.id));
      await copy(pwd);
      // Open the platform AFTER the password is on the clipboard so the
      // new tab takes focus and the user can paste straight away.
      window.open(cred.effective_url, '_blank', 'noopener,noreferrer');
      // Brief toast-style notification — alert is heavy-handed but reliable
      // across browsers. Could be swapped for a non-blocking toast later.
      // Use setTimeout so the new tab opens before the alert blocks.
      setTimeout(() => alert(`Password copied to clipboard.\nPaste with Ctrl+V (or ⌘+V) in the password field${cred.username ? `.\nUsername: ${cred.username}` : ''}`), 200);
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Quick login failed: ' + err.message);
    } finally {
      setRevealing(r => ({ ...r, [cred.id]: false }));
    }
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
              <select
                value={form.platform_site_id ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    setForm(prev => ({ ...prev, platform_site_id: null, platform: '', url: '' }));
                  } else {
                    const id = parseInt(v);
                    const s = sites.find(x => x.id === id);
                    setForm(prev => ({
                      ...prev,
                      platform_site_id: id,
                      platform: s?.name || '',
                      // Pre-fill URL from the site, but the field remains editable
                      // so banks (where the URL varies per client) can be overridden.
                      url: s?.url || prev.url,
                    }));
                  }
                }}
                className="form-input"
              >
                <option value="">-- Select platform --</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {form.platform_site_id == null && (
                <input type="text" placeholder="Or type a custom name…" value={form.platform}
                  onChange={(e) => handleChange('platform', e.target.value)}
                  className="form-input" style={{ marginTop: 6 }} />
              )}
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                Manage the platform list in <strong>Company Settings → Platform Sites</strong>.
              </p>
            </div>
            <div className="form-group">
              <label>URL</label>
              <input type="url" value={form.url}
                onChange={(e) => handleChange('url' as any, e.target.value)}
                className="form-input" placeholder="https://…" />
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                Pre-filled from the platform when picked. Override for per-client portals (e.g. specific bank branches).
              </p>
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
              <div className="cred-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0 }}>{cred.platform}</h4>
                  {cred.effective_url && (
                    <a href={cred.effective_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#1e40af' }}
                      title={cred.effective_url}>
                      {(() => { try { return new URL(cred.effective_url).hostname; } catch { return cred.effective_url; } })()}
                    </a>
                  )}
                </div>
                <div className="cred-card-actions">
                  {cred.effective_url && cred.has_password && canReveal && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => quickLogin(cred)}
                      disabled={!!revealing[cred.id]}
                      title="Opens the platform in a new tab AND copies the password to your clipboard"
                    >
                      🔑 {revealing[cred.id] ? 'Working…' : 'Quick login'}
                    </button>
                  )}
                  {cred.effective_url && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => window.open(cred.effective_url!, '_blank', 'noopener,noreferrer')}
                      style={{ marginLeft: 6 }}
                      title="Just open the URL, no password copy"
                    >
                      🌐 Open
                    </button>
                  )}
                  {canWrite && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(cred)} style={{ marginLeft: 6 }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(cred.id)} style={{ marginLeft: 6 }}>Delete</button>
                    </>
                  )}
                </div>
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
