import { useState, useEffect } from 'react';
import { api, roleLabel } from '../../services/api';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { clients } = useApp();
  const [users, setUsers] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<any>({ email: '', username: '', password: '', display_name: '', role: 'client', client_ids: [] as number[] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [changePasswordId, setChangePasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [myPassword, setMyPassword] = useState('');
  const [myPasswordConfirm, setMyPasswordConfirm] = useState('');
  const [showMyPassword, setShowMyPassword] = useState(false);

  const load = async () => { try { setUsers(await api.getUsers()); } catch {} };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!form.email || !form.password || !form.display_name) { alert('Email, password and display name are required'); return; }
    try {
      await api.createUser({
        email: form.email, password: form.password,
        username: form.username || form.email.split('@')[0],
        display_name: form.display_name,
        role: form.role, client_ids: form.role === 'client' ? form.client_ids : [],
      });
      setForm({ email: '', username: '', password: '', display_name: '', role: 'client', client_ids: [] });
      setShowAdd(false);
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handleEdit = (u: any) => {
    setEditingId(u.id);
    setEditForm({ display_name: u.display_name, active: u.active, client_ids: u.client_ids || [] });
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await api.updateUser(id, editForm);
      setEditingId(null);
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handleDelete = async (u: any) => {
    if (!confirm(`Delete user "${u.display_name}" (${u.username})? This cannot be undone.`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (err: any) { alert(err.message); }
  };

  const handleChangePassword = async (userId: string) => {
    if (!newPassword) return;
    try {
      await api.resetUserPassword(userId, newPassword);
      setNewPassword(''); setChangePasswordId(null);
      alert('Password changed.');
    } catch (err: any) { alert(err.message); }
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

  const toggleClientId = (arr: number[], id: number) => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];

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
            {form.role === 'client' && (
              <div className="form-group full-width">
                <label>Link to Client(s)</label>
                <div className="client-chips">
                  {clients.map((c: any) => (
                    <span
                      key={c.id}
                      className={`client-chip ${form.client_ids.includes(c.id) ? 'active' : ''}`}
                      onClick={() => setForm((p: any) => ({ ...p, client_ids: toggleClientId(p.client_ids, c.id) }))}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Click to toggle. You can assign multiple clients to one user.</p>
              </div>
            )}
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} style={{ marginTop: 12 }}>Create User</button>
        </div>
      )}

      {/* User list */}
      <div className="export-table-wrapper">
        <table className="export-table">
          <thead>
            <tr><th>Name</th><th>Username</th><th>Role</th><th>Clients</th><th>Status</th><th>Actions</th></tr>
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
                      <div className="client-chips" style={{ maxWidth: 400 }}>
                        {clients.map((c: any) => (
                          <span
                            key={c.id}
                            className={`client-chip ${editForm.client_ids?.includes(c.id) ? 'active' : ''}`}
                            onClick={() => setEditForm((f: any) => ({ ...f, client_ids: toggleClientId(f.client_ids || [], c.id) }))}
                            style={{ fontSize: 12, padding: '4px 10px' }}
                          >
                            {c.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 13 }}>{clientNamesFor(u.client_ids)}</span>
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
