import { useState, useEffect } from 'react';
import { api, roleLabel, hasPermission, isStaffRole } from '../../services/api';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import UserPermissionsEditor from './UserPermissionsEditor';
import StaffServiceRatesEditor from './StaffServiceRatesEditor';
import UserEmailEditor from './UserEmailEditor';
import SearchableSelect from '../common/SearchableSelect';

export default function UserManagement() {
  const { user: currentUser } = useAuth();

  // Page-level guard. The admin-users edge function ALSO blocks non-owners
  // server-side; this is just a friendlier UX.
  if (!hasPermission(currentUser, 'users.read')) {
    return (
      <div className="dashboard">
        <div className="dashboard-header"><h2>Users</h2></div>
        <div className="empty-state">
          <p>User management requires the <code>users.read</code> permission.</p>
        </div>
      </div>
    );
  }
  const { clients } = useApp();
  const { runWith } = useMFAStepUp();
  const [users, setUsers] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  // copy_from_user_id: when set, the new user inherits the source user's role,
  // linked clients, hourly rate, per-service rates, and permission overrides.
  // copy_perms / copy_rates / copy_clients: opt-out toggles in case the user
  // wants to copy some but not all carry-over data.
  const [form, setForm] = useState<any>({
    email: '', username: '', password: '', display_name: '',
    role: 'client', client_ids: [] as number[],
    hourly_rate: '',
    copy_from_user_id: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [changePasswordId, setChangePasswordId] = useState<string | null>(null);
  const [permsForUser, setPermsForUser] = useState<{ id: string; name: string } | null>(null);
  const [ratesForUser, setRatesForUser] = useState<{ id: string; name: string } | null>(null);
  // Email (SMTP) setup editor target. pendingRates chains the rates editor open
  // after the email editor is closed, so creating a new staff member walks
  // through email → rates without the two modals overlapping.
  const [emailForUser, setEmailForUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [pendingRates, setPendingRates] = useState<{ id: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const canEditRoles = hasPermission(currentUser, 'roles.write');
  const [myPassword, setMyPassword] = useState('');
  const [myPasswordConfirm, setMyPasswordConfirm] = useState('');
  const [showMyPassword, setShowMyPassword] = useState(false);

  const load = async () => { try { setUsers(await api.getUsers()); } catch {} };
  useEffect(() => { load(); }, []);

  // Pre-fill the Add User form from an existing user. Only carries fields that
  // are safe to copy — not email/username/password/display_name.
  const applyCopyFromUser = (sourceId: string) => {
    setForm((p: any) => ({ ...p, copy_from_user_id: sourceId }));
    if (!sourceId) return;
    const src = users.find(u => u.id === sourceId);
    if (!src) return;
    setForm((p: any) => ({
      ...p,
      role: src.role || p.role,
      client_ids: Array.isArray(src.client_ids) ? [...src.client_ids] : [],
      hourly_rate: src.hourly_rate != null ? String(src.hourly_rate) : '',
    }));
  };

  const handleAdd = async () => {
    if (!form.email || !form.password || !form.display_name) { alert('Email, password and display name are required'); return; }
    const wasStaff = isStaffRole(form);
    const newDisplayName = form.display_name;
    const newEmail = form.email;
    const sourceId = form.copy_from_user_id || '';
    try {
      await runWith(() => api.createUser({
        email: form.email, password: form.password,
        username: form.username || form.email.split('@')[0],
        display_name: form.display_name,
        role: form.role, client_ids: form.role === 'client' ? form.client_ids : [],
      }));
      // Reset form
      setForm({
        email: '', username: '', password: '', display_name: '',
        role: 'client', client_ids: [],
        hourly_rate: '',
        copy_from_user_id: '',
      });
      setShowAdd(false);

      // Resolve the new user's id by display_name / username match — the create
      // call goes through an edge function and doesn't return the row directly.
      const fresh = await api.getUsers();
      setUsers(fresh);
      const newRow = (fresh as any[]).find(
        u => u.display_name === newDisplayName || u.username === newEmail.split('@')[0],
      );

      // Persist the hourly_rate the user entered (also carries over if copied)
      if (newRow && wasStaff && form.hourly_rate !== '' && !isNaN(Number(form.hourly_rate))) {
        try { await api.updateUserHourlyRate(newRow.id, Number(form.hourly_rate)); } catch {}
      }

      // Copy permission overrides + per-service rates from the source user
      if (newRow && sourceId) {
        try {
          const perms = await api.getUserPermissions(sourceId);
          for (const p of perms) {
            if (p.override !== null && p.override !== undefined) {
              await api.setUserPermission(newRow.id, p.permission, p.override);
            }
          }
        } catch (err: any) {
          alert('User created, but copying permissions failed: ' + err.message);
        }
        if (wasStaff) {
          try {
            const rates = await api.getStaffServiceRates(sourceId);
            for (const r of rates) {
              await api.setStaffServiceRate(newRow.id, r.service, r.rate);
            }
          } catch (err: any) {
            alert('User created, but copying service rates failed: ' + err.message);
          }
        }
        await load();
      }

      // Step 2 — for newly-added staff, auto-open the email setup first (so you
      // can configure their SMTP straight away), then chain to the service-rates
      // editor when it closes. Skip clients (no email setup / no charge rates).
      if (newRow && wasStaff) {
        setEmailForUser({ id: newRow.id, name: newRow.display_name || newRow.username, email: newEmail });
        setPendingRates({ id: newRow.id, name: newRow.display_name || newRow.username });
      }
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert(err.message);
    }
  };

  const handleEdit = (u: any) => {
    setEditingId(u.id);
    setEditForm({
      display_name: u.display_name,
      active: u.active,
      client_ids: u.client_ids || [],
      hourly_rate: u.hourly_rate ?? '',
    });
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await api.updateUser(id, editForm);
      // hourly_rate is on profiles directly; persist via the timesheet helper.
      // Empty string clears the rate (null).
      const rateRaw = editForm.hourly_rate;
      const rate =
        rateRaw === '' || rateRaw === null || rateRaw === undefined
          ? null
          : Number(rateRaw);
      if (rate === null || !isNaN(rate)) {
        await api.updateUserHourlyRate(id, rate);
      }
      setEditingId(null);
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (u: any) => {
    if (!confirm(`Delete user "${u.display_name}" (${u.username})? This cannot be undone.`)) return;
    try {
      await runWith(() => api.deleteUser(u.id));
      await load();
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert(err.message);
    }
  };

  const handleChangePassword = async (userId: string) => {
    if (!newPassword) return;
    try {
      await runWith(() => api.resetUserPassword(userId, newPassword));
      setNewPassword(''); setChangePasswordId(null);
      alert('Password changed.');
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert(err.message);
    }
  };

  const handleChangeMyPassword = async () => {
    if (!myPassword || myPassword !== myPasswordConfirm) { alert('Passwords do not match'); return; }
    try {
      const { error } = await supabase.auth.updateUser({ password: myPassword });
      if (error) throw error;
      setMyPassword(''); setMyPasswordConfirm(''); setShowMyPassword(false);
      alert('Your password has been changed.');
    } catch (err: any) { alert(err.message); }
  };

  const clientOptions = clients.map((c: any) => ({ value: c.id, label: c.name, sublabel: c.client_code || c.tax_number || '' }));
  const clientNamesFor = (ids: number[] | undefined) => (ids || []).map(id => clients.find((c: any) => c.id === id)?.name).filter(Boolean).join(', ') || '-';

  return (
    <div className="user-management">
      <h2>User Management</h2>

      {/* Change my password */}
      <div className="form-section">
        <div className="section-header">
          <h3>My Account</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowMyPassword(!showMyPassword)}>
            {showMyPassword ? 'Cancel' : 'Change My Password'}
          </button>
        </div>
        <p>Logged in as: <strong>{currentUser?.display_name}</strong> ({currentUser?.username})</p>
        {showMyPassword && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="form-group"><label>New Password</label><input type="password" value={myPassword} onChange={(e) => setMyPassword(e.target.value)} className="form-input" /></div>
            <div className="form-group"><label>Confirm Password</label><input type="password" value={myPasswordConfirm} onChange={(e) => setMyPasswordConfirm(e.target.value)} className="form-input" /></div>
            <div className="form-group"><label>&nbsp;</label><button className="btn btn-primary" onClick={handleChangeMyPassword}>Update Password</button></div>
          </div>
        )}
      </div>

      {/* Add user */}
      <div className="list-header">
        <h3>Users ({users.length})</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : '+ Add User'}</button>
      </div>

      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          {/* Copy-from-user dropdown (optional) */}
          <div className="form-group full-width" style={{ marginBottom: 12 }}>
            <label>Copy settings from existing user (optional)</label>
            <SearchableSelect
              value={form.copy_from_user_id || ''}
              options={users.map((u: any) => ({
                value: u.id,
                label: u.display_name || u.username,
                sublabel: `${roleLabel(u.role)}${u.role === 'client' ? '' : (u.hourly_rate != null ? ` · €${Number(u.hourly_rate).toFixed(2)}/h` : '')}`,
              }))}
              onChange={(v) => applyCopyFromUser(String(v))}
              placeholder="-- Don't copy --"
              allowClear
            />
            {form.copy_from_user_id && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                Role, linked clients, hourly rate, per-service rates and permission overrides will be copied. You still need to enter a new email, password and display name.
              </p>
            )}
          </div>

          <div className="form-grid">
            <div className="form-group"><label>Display Name *</label><input type="text" value={form.display_name} onChange={(e) => setForm((p: any) => ({ ...p, display_name: e.target.value }))} className="form-input" /></div>
            <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={(e) => setForm((p: any) => ({ ...p, email: e.target.value }))} className="form-input" placeholder="user@example.com" /></div>
            <div className="form-group"><label>Username</label><input type="text" value={form.username} onChange={(e) => setForm((p: any) => ({ ...p, username: e.target.value }))} className="form-input" placeholder="optional — defaults to email prefix" /></div>
            <div className="form-group"><label>Password *</label><input type="text" value={form.password} onChange={(e) => setForm((p: any) => ({ ...p, password: e.target.value }))} className="form-input" /></div>
            <div className="form-group">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm((p: any) => ({ ...p, role: e.target.value }))} className="form-input">
                <option value="admin">Admin (Staff)</option>
                <option value="client">Client</option>
              </select>
            </div>
            {isStaffRole(form) && (
              <div className="form-group">
                <label>Hourly Rate (€/h)</label>
                <input
                  type="number" step="0.01" min="0"
                  className="form-input"
                  value={form.hourly_rate || ''}
                  onChange={(e) => setForm((p: any) => ({ ...p, hourly_rate: e.target.value }))}
                  placeholder="Default fallback (use Rates for per-service)"
                />
              </div>
            )}
            {form.role === 'client' && (
              <div className="form-group full-width">
                <label>Linked clients</label>
                {/* Selected chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6, minHeight: 28 }}>
                  {form.client_ids.length === 0 ? (
                    <span style={{ color: '#94a3b8', fontSize: 13, lineHeight: '28px' }}>No clients linked yet.</span>
                  ) : (
                    form.client_ids.map((id: number) => {
                      const c = clients.find((x: any) => x.id === id);
                      if (!c) return null;
                      return (
                        <span key={id} className="client-chip active" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {c.client_code && <span style={{ color: '#cbd5e1' }}>{c.client_code}</span>} {c.name}
                          <button
                            type="button"
                            onClick={() => setForm((p: any) => ({ ...p, client_ids: p.client_ids.filter((x: number) => x !== id) }))}
                            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                            aria-label="Remove"
                          >×</button>
                        </span>
                      );
                    })
                  )}
                </div>
                {/* Search dropdown — only shows clients not already linked */}
                <SearchableSelect
                  value=""
                  options={clientOptions.filter(o => !form.client_ids.includes(Number(o.value)))}
                  onChange={(v) => {
                    const n = Number(v);
                    if (!n) return;
                    setForm((p: any) => p.client_ids.includes(n) ? p : ({ ...p, client_ids: [...p.client_ids, n] }));
                  }}
                  placeholder="Search and add a client..."
                />
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} style={{ marginTop: 12 }}>Create User</button>
        </div>
      )}

      {permsForUser && (
        <UserPermissionsEditor
          userId={permsForUser.id}
          userName={permsForUser.name}
          onClose={() => setPermsForUser(null)}
        />
      )}

      {ratesForUser && (
        <StaffServiceRatesEditor
          userId={ratesForUser.id}
          userName={ratesForUser.name}
          onClose={() => { setRatesForUser(null); load(); }}
        />
      )}

      {emailForUser && (
        <UserEmailEditor
          userId={emailForUser.id}
          userName={emailForUser.name}
          defaultEmail={emailForUser.email}
          onClose={() => {
            setEmailForUser(null);
            // Chain into the rates editor if we just created a staff member.
            if (pendingRates) { setRatesForUser(pendingRates); setPendingRates(null); }
          }}
        />
      )}

      {/* User list */}
      <div className="export-table-wrapper">
        <table className="export-table">
          <thead>
            <tr><th>Name</th><th>Username</th><th>Role</th><th>Clients</th><th>Hourly Rate</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u: any) => {
              const isEditing = editingId === u.id;
              return (
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                  <td>
                    {isEditing ? (
                      <input type="text" value={editForm.display_name} onChange={(e) => setEditForm((f: any) => ({ ...f, display_name: e.target.value }))} className="form-input" />
                    ) : (
                      <strong>{u.display_name}</strong>
                    )}
                  </td>
                  <td>{u.username}</td>
                  <td><span className={`status-badge ${u.role === 'client' ? 'status-reviewed' : 'status-exported'}`}>{roleLabel(u.role)}</span></td>
                  <td>
                    {isEditing && u.role === 'client' ? (
                      <div style={{ maxWidth: 400 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6, minHeight: 24 }}>
                          {(editForm.client_ids || []).length === 0 ? (
                            <span style={{ color: '#94a3b8', fontSize: 12 }}>None linked</span>
                          ) : (
                            (editForm.client_ids || []).map((id: number) => {
                              const c = clients.find((x: any) => x.id === id);
                              if (!c) return null;
                              return (
                                <span key={id} className="client-chip active" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '2px 8px' }}>
                                  {c.name}
                                  <button
                                    type="button"
                                    onClick={() => setEditForm((f: any) => ({ ...f, client_ids: (f.client_ids || []).filter((x: number) => x !== id) }))}
                                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
                                  >×</button>
                                </span>
                              );
                            })
                          )}
                        </div>
                        <SearchableSelect
                          value=""
                          options={clientOptions.filter(o => !(editForm.client_ids || []).includes(Number(o.value)))}
                          onChange={(v) => {
                            const n = Number(v);
                            if (!n) return;
                            setEditForm((f: any) => (f.client_ids || []).includes(n) ? f : ({ ...f, client_ids: [...(f.client_ids || []), n] }));
                          }}
                          placeholder="Search and add a client..."
                        />
                      </div>
                    ) : (
                      <span style={{ fontSize: 13 }}>{clientNamesFor(u.client_ids)}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {u.role === 'client' ? (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    ) : isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input"
                        style={{ width: 90 }}
                        value={editForm.hourly_rate ?? ''}
                        onChange={(e) => setEditForm((f: any) => ({ ...f, hourly_rate: e.target.value }))}
                        placeholder="€/h"
                      />
                    ) : (
                      u.hourly_rate != null
                        ? <span>€{Number(u.hourly_rate).toFixed(2)}/h</span>
                        : <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select value={editForm.active ? '1' : '0'} onChange={(e) => setEditForm((f: any) => ({ ...f, active: e.target.value === '1' }))} className="form-input" style={{ width: 110 }}>
                        <option value="1">Active</option>
                        <option value="0">Inactive</option>
                      </select>
                    ) : (
                      <span className={`status-badge ${u.active ? 'status-reviewed' : 'status-draft'}`}>{u.active ? 'Active' : 'Inactive'}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(u.id)}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : changePasswordId === u.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="form-input" placeholder="New password" style={{ width: 130 }} />
                        <button className="btn btn-primary btn-sm" onClick={() => handleChangePassword(u.id)}>Set</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setChangePasswordId(null)}>X</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(u)}>Edit</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setChangePasswordId(u.id)}>🔑</button>
                        {isStaffRole(u) && (
                          <button className="btn btn-secondary btn-sm" onClick={() => setRatesForUser({ id: u.id, name: u.display_name || u.username })}>Rates</button>
                        )}
                        {isStaffRole(u) && (
                          <button className="btn btn-secondary btn-sm" onClick={() => setEmailForUser({ id: u.id, name: u.display_name || u.username, email: '' })}>Email</button>
                        )}
                        {canEditRoles && (
                          <button className="btn btn-secondary btn-sm" onClick={() => setPermsForUser({ id: u.id, name: u.display_name || u.username })}>Perms</button>
                        )}
                        {u.id !== currentUser?.id && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}>Delete</button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
