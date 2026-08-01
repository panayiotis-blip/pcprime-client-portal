import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { allClientApps, getClientApp, loadAppTemplates } from '../../../services/clientApps';
import ClientAppHost from '../ClientAppHost';
import { PanelSkeleton } from '../../ui';

// Firm-side Apps tab in the client file. Shows only the apps ASSIGNED to this
// client (so an app appears only where it belongs), lets a supervisor add /
// remove apps and manage each app's own logins (app-only users), and opens an
// app inline. App users sign in separately at /app.

type AppUser = { id: number; username: string; name: string | null; role: string; active: boolean; last_login_at: string | null; migrated_at: string | null; migrated_email: string | null };
const ROLES = ['admin', 'editor', 'viewer'];

export default function ClientAppsTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const canManage = isSupervisorOrHigher(user);
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ mode: 'list' } | { mode: 'open'; key: string } | { mode: 'users'; key: string } | { mode: 'grants'; key: string } | { mode: 'version'; key: string }>({ mode: 'list' });
  const [busy, setBusy] = useState('');

  const loadKeys = () => {
    setLoading(true);
    Promise.all([loadAppTemplates(), api.getClientAppKeys(clientId)])
      .then(([, k]) => setKeys(k)).catch(() => setKeys([])).finally(() => setLoading(false));
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
  if (view.mode === 'grants') {
    return <AppGrantsPanel clientId={clientId} appKey={view.key} canManage={canManage} onBack={() => setView({ mode: 'list' })} />;
  }
  if (view.mode === 'version') {
    return <AppVersionPanel clientId={clientId} appKey={view.key} canManage={canManage} onBack={() => setView({ mode: 'list' })} />;
  }
  if (view.mode === 'users') {
    return <AppUsersPanel clientId={clientId} appKey={view.key} canManage={canManage} onBack={() => setView({ mode: 'list' })} />;
  }

  const enabled = allClientApps().filter(a => keys.includes(a.key));
  // Restricted apps (built for one client) aren't offered in the picker.
  const available = allClientApps().filter(a => !keys.includes(a.key) && !a.restricted);

  return (
    <div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
        Apps assigned to this client. Use <strong>Access</strong> to grant people by email — they sign in with their email and
        set their own password. (<strong>App users (old)</strong> is the legacy username login, kept until everyone is moved over.)
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
                <button className="btn btn-secondary btn-sm" onClick={() => setView({ mode: 'grants', key: app.key })}>Access</button>
                {app.source === 'template' && <button className="btn btn-secondary btn-sm" onClick={() => setView({ mode: 'version', key: app.key })}>Version</button>}
                <button className="btn btn-secondary btn-sm" style={{ color: '#94a3b8' }} onClick={() => setView({ mode: 'users', key: app.key })}>App users (old)</button>
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
  const [notice, setNotice] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    api.listAppUsers(clientId, appKey).then(u => setUsers(u as AppUser[])).catch(e => setErr(e?.message || String(e))).finally(() => setLoading(false));
  };
  useEffect(load, [clientId, appKey]);

  const setRole = async (u: AppUser, role: string) => { try { await api.updateAppUser(u.id, { role }); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const toggleActive = async (u: AppUser) => { try { await api.updateAppUser(u.id, { active: !u.active }); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const resetPw = async (u: AppUser) => { const p = prompt(`New password for ${u.username} (min 6 chars):`); if (!p) return; try { await api.resetAppUserPassword(u.id, p); alert('Password updated.'); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const del = async (u: AppUser) => { if (!confirm(`Delete app user ${u.username}?`)) return; try { await api.deleteAppUser(u.id); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  // Phase 5: hand this login over to an email account, keeping its app + role.
  const moveToEmail = async (u: AppUser) => {
    const email = prompt(`Move "${u.username}" to an email login.\n\nEmail address for ${u.name || u.username}:`);
    if (email == null) return;
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { alert('Please enter a valid email address.'); return; }
    if (!confirm(`Give ${addr} ${u.role} access to this app and disable the username "${u.username}"?`)) return;
    setNotice('');
    try {
      const r = await api.migrateAppUserToEmail(u.id, addr, u.role);
      setNotice(r.invited
        ? `${u.username} moved to ${addr}. An invite email was sent so they can set their own password — the old username no longer works.`
        : `${u.username} moved to ${addr} (existing account — they sign in with their current password). The old username no longer works.`);
      load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
  };

  const remaining = users.filter(u => !u.migrated_at).length;

  return (
    <div>
      <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to apps</button>
      <h3 style={{ color: '#1a365d', margin: '12px 0 4px' }}>{app?.icon} {app?.label} — App users (old username logins)</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        These are the old username logins, being retired. Use <strong>Move to email</strong> on each one: the person keeps this app
        and role but signs in with their email, and the username stops working. New access is granted from the <strong>Access</strong> panel.
      </p>
      <div style={{ background: remaining ? '#fffbeb' : '#ecfdf5', border: `1px solid ${remaining ? '#fde68a' : '#a7f3d0'}`, color: remaining ? '#92400e' : '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
        {remaining
          ? `${remaining} login${remaining === 1 ? '' : 's'} still on the old username system for this app.`
          : 'Nothing left on the old username system for this app.'}
      </div>

      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{notice}</div>}
      {err && <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>}
      {loading ? <PanelSkeleton rows={3} /> : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                <th style={{ padding: '8px 12px' }}>Username</th><th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px', width: 120 }}>Role</th><th style={{ padding: '8px 12px', width: 200 }}>Status</th>
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
                    <select className="form-input" style={{ padding: '2px 6px', fontSize: 13 }} value={u.role} disabled={!canManage || !!u.migrated_at} onChange={e => setRole(u, e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {u.migrated_at
                      ? <span style={{ color: '#065f46' }}>✓ Moved to {u.migrated_email || 'email'}</span>
                      : (u.active ? 'Active' : 'Disabled')}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {canManage && (u.migrated_at ? (
                      <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => del(u)}>Delete</button>
                    ) : <>
                      <button className="btn btn-link btn-sm" onClick={() => moveToEmail(u)}>Move to email</button>
                      <button className="btn btn-link btn-sm" onClick={() => resetPw(u)}>Reset password</button>
                      <button className="btn btn-link btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                      <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => del(u)}>Delete</button>
                    </>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No "add app user" form any more — new people are added by email in the
          Access panel, which is the system this one is being retired into. */}
    </div>
  );
}

// Which copy of an uploaded app THIS client runs (migration 170): the shared
// template, a version they were held on, or one customised for them. This is
// also where a held/customised client is deliberately brought back onto the
// shared app — shared edits never reach them on their own.
function AppVersionPanel({ clientId, appKey, canManage, onBack }: { clientId: number; appKey: string; canManage: boolean; onBack: () => void }) {
  const app = getClientApp(appKey);
  const [v, setV] = useState<Awaited<ReturnType<typeof api.getClientAppVariant>> | null>(null);
  const [sharedVersion, setSharedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true); setErr('');
    Promise.all([api.getClientAppVariant(clientId, appKey), api.getTemplateRollout(appKey)])
      .then(([variant, rollout]) => { setV(variant); setSharedVersion(rollout.version); })
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [clientId, appKey]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    let html = '';
    try { html = await file.text(); } catch { alert('Could not read that file.'); return; }
    if (!html.trim()) { alert('That file is empty.'); return; }
    setBusy(true); setNotice('');
    try {
      await api.customiseClientApp(clientId, appKey, html);
      setNotice(`This client now runs their own copy of the app (${file.name}). Shared edits no longer reach them.`);
      load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!confirm('Put this client back on the shared app? Their customised copy is discarded — their saved data is untouched.')) return;
    setBusy(true); setNotice('');
    try {
      await api.resetClientAppToShared(clientId, appKey);
      setNotice(`Back on the shared app (v${sharedVersion ?? '?'}).`);
      load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  const state = !v ? 'none' : v.customised ? 'customised' : v.pinned ? 'pinned' : 'shared';

  return (
    <div>
      <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to apps</button>
      <h3 style={{ color: '#1a365d', margin: '12px 0 4px' }}>{app?.icon} {app?.label} — Version</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
        Which copy of the app this client runs. Give them their own copy to change the app for them alone — from then on
        edits to the shared template skip them until you put them back.
      </p>

      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{notice}</div>}
      {err && <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>}

      {loading ? <PanelSkeleton rows={2} /> : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, maxWidth: 640 }}>
          <div style={{ fontSize: 14, color: '#0f172a' }}>
            {state === 'customised' && <><strong style={{ color: '#7c3aed' }}>Customised for this client.</strong> They run their own copy, not the shared app.</>}
            {state === 'pinned' && <><strong style={{ color: '#b45309' }}>Held on v{v!.pinned_version ?? '?'}.</strong> The shared app has moved on to v{sharedVersion ?? '?'}; this client stayed where they were.</>}
            {state === 'shared' && <><strong style={{ color: '#166534' }}>On the shared app (v{sharedVersion ?? '?'}).</strong> They pick up every edit you push to it.</>}
            {state === 'none' && <span style={{ color: '#94a3b8' }}>This app isn't allocated to the client.</span>}
          </div>
          {v?.variant_at && (state === 'customised' || state === 'pinned') && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Since {new Date(v.variant_at).toLocaleDateString()}</div>
          )}

          {canManage && state !== 'none' && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>
                {state === 'customised' ? 'Replace their copy' : 'Customise for this client'}<br />
                <input type="file" accept=".html,text/html" disabled={busy} onChange={e => upload(e.target.files?.[0])} />
              </label>
              {state !== 'shared' && (
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={reset}>
                  Put back on the shared app{sharedVersion ? ` (v${sharedVersion})` : ''}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type AppGrant = { id: number; user_id: string; email: string; name: string; app_key: string; role: string; active: boolean; created_at: string };

// Email-based app access (migration 164, app-grants-admin fn). Grant a person by
// email: existing accounts (portal clients / staff) are reused, new ones are
// invited to set their own password. One person can hold grants for several apps.
function AppGrantsPanel({ clientId, appKey, canManage, onBack }: { clientId: number; appKey: string; canManage: boolean; onBack: () => void }) {
  const app = getClientApp(appKey);
  const [grants, setGrants] = useState<AppGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ email: '', name: '', role: 'editor' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true); setErr('');
    api.listAppGrants(clientId, appKey).then(g => setGrants(g as AppGrant[])).catch(e => setErr(e?.message || String(e))).finally(() => setLoading(false));
  };
  useEffect(load, [clientId, appKey]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setNotice('');
    try {
      const r = await api.grantAppAccess({ client_id: clientId, app_key: appKey, email: form.email.trim(), name: form.name.trim(), role: form.role });
      setNotice(r.invited
        ? `Access granted. An invite email was sent to ${form.email.trim()} to set a password.`
        : `Access granted to ${form.email.trim()} (existing account — they use their current password).`);
      setForm({ email: '', name: '', role: 'editor' });
      load();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };
  const setRole = async (g: AppGrant, role: string) => { try { await api.setAppGrantRole(g.id, role); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const toggleActive = async (g: AppGrant) => { try { await api.setAppGrantActive(g.id, !g.active); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const revoke = async (g: AppGrant) => { if (!confirm(`Revoke ${g.email}'s access to this app? Their account stays; only this app grant is removed.`)) return; try { await api.revokeAppGrant(g.id); load(); } catch (e: any) { alert(e?.message || 'Failed'); } };
  const sendReset = async (g: AppGrant) => {
    if (!g.email) { alert('No email on file for this person.'); return; }
    setNotice('');
    try { await api.sendPasswordReset(g.email); setNotice(`Password reset link sent to ${g.email} — they set their own new password.`); }
    catch (e: any) { alert(e?.message || 'Failed'); }
  };
  const setPw = async (g: AppGrant) => {
    const p = prompt(`Set a new password for ${g.email} (min 6 characters):`);
    if (p == null) return;
    if (p.length < 6) { alert('Password must be at least 6 characters.'); return; }
    setNotice('');
    try { await api.setAppUserPassword(g.user_id, clientId, p); setNotice(`Password updated for ${g.email}.`); }
    catch (e: any) { alert(e?.message || 'Failed'); }
  };

  return (
    <div>
      <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to apps</button>
      <h3 style={{ color: '#1a365d', margin: '12px 0 4px' }}>{app?.icon} {app?.label} — Access</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
        People who can open this app, by email. New emails get an invite to set their own password; existing accounts (portal
        clients or staff) are reused — one login, and they pick this app after signing in. Roles: <strong>admin/editor</strong> can edit, <strong>viewer</strong> is read-only.
      </p>

      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{notice}</div>}
      {err && <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>}
      {loading ? <PanelSkeleton rows={3} /> : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                <th style={{ padding: '8px 12px' }}>Email</th><th style={{ padding: '8px 12px' }}>Name</th>
                <th style={{ padding: '8px 12px', width: 120 }}>Role</th><th style={{ padding: '8px 12px', width: 90 }}>Status</th>
                <th style={{ padding: '8px 12px', width: 120 }}>Granted</th><th style={{ padding: '8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 16, color: '#94a3b8', textAlign: 'center' }}>No one has access yet.</td></tr>
              ) : grants.map(g => (
                <tr key={g.id} style={{ borderTop: '1px solid #f1f5f9', opacity: g.active ? 1 : 0.55 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1a365d' }}>{g.email || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{g.name || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <select className="form-input" style={{ padding: '2px 6px', fontSize: 13 }} value={g.role} disabled={!canManage} onChange={e => setRole(g, e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{g.active ? 'Active' : 'Suspended'}</td>
                  <td style={{ padding: '8px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>{g.created_at ? new Date(g.created_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {canManage && <>
                      <button className="btn btn-link btn-sm" onClick={() => sendReset(g)}>Reset link</button>
                      <button className="btn btn-link btn-sm" onClick={() => setPw(g)}>Set pw</button>
                      <button className="btn btn-link btn-sm" onClick={() => toggleActive(g)}>{g.active ? 'Suspend' : 'Restore'}</button>
                      <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => revoke(g)}>Revoke</button>
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a365d', marginBottom: 10 }}>Grant access by email</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 12, color: '#64748b' }}>Email<br />
              <input className="form-input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="person@example.com" required style={{ minWidth: 220 }} /></label>
            <label style={{ fontSize: 12, color: '#64748b' }}>Name<br />
              <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name (new accounts)" style={{ minWidth: 170 }} /></label>
            <label style={{ fontSize: 12, color: '#64748b' }}>Role<br />
              <select className="form-input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
            <button className="btn btn-primary" type="submit" disabled={saving || !form.email.trim()}>{saving ? 'Granting…' : 'Grant access'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
