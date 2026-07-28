import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { CLIENT_APPS, getClientApp } from '../../../services/clientApps';
import ClientAppHost from '../ClientAppHost';
import { PanelSkeleton } from '../../ui';

// Firm-side Apps tab in the client file. Shows only the apps ASSIGNED to this
// client (so an app appears only where it belongs), lets a supervisor add /
// remove apps and manage each app's own logins (app-only users), and opens an
// app inline. App users sign in separately at /app.

type AppUser = { id: number; username: string; name: string | null; role: string; active: boolean; last_login_at: string | null };
const ROLES = ['admin', 'editor', 'viewer'];

export default function ClientAppsTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const canManage = isSupervisorOrHigher(user);
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'open'; key: string } | { mode: 'users'; key: string }>({ mode: 'list' });
  const [busy, setBusy] = useState('');

  const loadKeys = () => {
    setLoading(true);
    api.getClientAppKeys(clientId).then(k => setKeys(k)).catch(() => setKeys([])).finally(() => setLoading(false));
  };
  useEffect(loadKeys, [clientId]);

  const addApp = async (key: string) => {
    setBusy(key);
    try { await api.setClientApp(clientId, key, true); loadKeys(); }
    catch (e: any) { alert('Failed: ' + (e?.message || e)); }
    finally { setBusy(''); }
  };
  const removeApp = async (key: string) => {
    if (!confirm(`Remove this app from the client? Its data and app users stay, but no one can open it until re-added.`)) return;
    setBusy(key);
    try { await api.setClientApp(clientId, key, false); loadKeys(); }
    catch (e: any) { alert('Failed: ' + (e?.message || e)); }
    finally { setBusy(''); }
  };

  if (loading) return <PanelSkeleton rows={4} />;

  if (view.mode === 'open') {
    const app = getClientApp(view.key);
    return (
      <div>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }} onClick={() => setView({ mode: 'list' })}>← Back to apps</button>
        <span style={{ marginLeft: 10, fontWeight: 600, color: '#1a365d' }}>{app?.icon} {app?.label}</span>
        <ClientAppHost clientId={clientId} appKey={view.key} />
      </div>
    );
  }
  if (view.mode === 'users') {
    return <AppUsersPanel clientId={clientId} appKey={view.key} canManage={canManage} onBack={() => setView({ mode: 'list' })} />;
  }

  const enabled = CLIENT_APPS.filter(a => keys.includes(a.key));
  // Restricted apps (built for one client) aren't offered in the picker.
  const available = CLIENT_APPS.filter(a => !keys.includes(a.key) && !a.restricted);

  return (
    <div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
        Apps assigned to this client. App users sign in at <code>/app</code> with the logins you set here.
      </p>
      {enabled.length === 0 ? (
        <div className="empty-state"><p>No apps assigned to this client yet.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
          {enabled.map(app => (
            <div key={app.key} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>{app.icon}</span>
                <strong style={{ color: '#1a365d' }}>{app.label}</strong>
              </div>
              {app.description && <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 12px' }}>{app.description}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={() => setView({ mode: 'open', key: app.key })}>Open</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setView({ mode: 'users', key: app.key })}>App users</button>
                {canManage && <button className="btn btn-secondary btn-sm" style={{ color: '#b91c1c' }} disabled={busy === app.key} onClick={() => removeApp(app.key)}>Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && available.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Add an app</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {available.map(app => (
              <button key={app.key} className="btn btn-secondary btn-sm" disabled={busy === app.key} onClick={() => addApp(app.key)}>
                + {app.icon} {app.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AppUsersPanel({ clientId, appKey, canManage, onBack }: { clientId: number; appKey: string; canManage: boolean; onBack: () => void }) {
  const app = getClientApp(appKey);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ username: '', name: '', role: 'editor', password: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true); setErr('');
    api.listAppUsers(clientId, appKey).then(u => setUsers(u as AppUser[])).catch(e => setErr(e?.message || String(e))).finally(() => setLoading(false));
  };
  useEffect(load, [clientId, appKey]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createAppUser({ client_id: clientId, app_key: appKey, username: form.username.trim(), name: form.name.trim(), role: form.role, password: form.password });
      setForm({ username: '', name: '', role: 'editor', password: '' });
      load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };
  const setRole = async (u: AppUser, role: string) => { try { await api.updateAppUser(u.id, { role }); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const toggleActive = async (u: AppUser) => { try { await api.updateAppUser(u.id, { active: !u.active }); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const resetPw = async (u: AppUser) => { const p = prompt(`New password for ${u.username} (min 6 chars):`); if (!p) return; try { await api.resetAppUserPassword(u.id, p); alert('Password updated.'); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const del = async (u: AppUser) => { if (!confirm(`Delete app user ${u.username}?`)) return; try { await api.deleteAppUser(u.id); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };

  return (
    <div>
      <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to apps</button>
      <h3 style={{ color: '#1a365d', margin: '12px 0 4px' }}>{app?.icon} {app?.label} — App users</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
        These logins are separate from portal users. They sign in at <code>/app</code> and open only this app. Roles: <strong>admin/editor</strong> can edit, <strong>viewer</strong> is read-only.
      </p>

      {err && <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>}
      {loading ? <PanelSkeleton rows={3} /> : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                <th style={{ padding: '8px 12px' }}>Username</th><th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px', width: 120 }}>Role</th><th style={{ padding: '8px 12px', width: 90 }}>Status</th>
                <th style={{ padding: '8px 12px', width: 130 }}>Last login</th><th style={{ padding: '8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>No app users yet.</td></tr>
              ) : users.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid #f1f5f9', opacity: u.active ? 1 : 0.55 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1a365d' }}>{u.username}</td>
                  <td style={{ padding: '8px 12px' }}>{u.name || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <select className="form-input" style={{ padding: '2px 6px', fontSize: 13 }} value={u.role} disabled={!canManage} onChange={e => setRole(u, e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{u.active ? 'Active' : 'Disabled'}</td>
                  <td style={{ padding: '8px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {canManage && <>
                      <button className="btn btn-link btn-sm" onClick={() => resetPw(u)}>Reset password</button>
                      <button className="btn btn-link btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                      <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => del(u)}>Delete</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <form onSubmit={add} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a365d', marginBottom: 10 }}>Add app user</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 12, color: '#64748b' }}>Username<br />
              <input className="form-input" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} placeholder="e.g. greson_john" required style={{ minWidth: 160 }} /></label>
            <label style={{ fontSize: 12, color: '#64748b' }}>Name<br />
              <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" style={{ minWidth: 150 }} /></label>
            <label style={{ fontSize: 12, color: '#64748b' }}>Role<br />
              <select className="form-input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
            <label style={{ fontSize: 12, color: '#64748b' }}>Password<br />
              <input className="form-input" type="text" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="min 6 chars" required style={{ minWidth: 140 }} /></label>
            <button className="btn btn-primary" type="submit" disabled={saving || !form.username.trim() || form.password.length < 6}>{saving ? 'Adding…' : 'Add user'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
