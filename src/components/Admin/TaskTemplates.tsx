import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher, isStaffRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;

type Item = {
  id: number;
  template_id: number;
  ordinal: number;
  title: string;
  description: string | null;
  default_priority: 'low' | 'medium' | 'high' | 'urgent';
  days_offset: number | null;
  default_assignee: string | null;
};

type Template = {
  id: number;
  name: string;
  description: string | null;
  items: Item[];
};

const blankNewItem = () => ({
  title: '', description: '', default_priority: 'medium' as Item['default_priority'],
  days_offset: '' as string, default_assignee: '',
});

export default function TaskTemplates() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);
  const [templates, setTemplates]   = useState<any[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);

  // Editor state — set when a template is open for editing items
  const [openTpl, setOpenTpl] = useState<Template | null>(null);
  const [openLoading, setOpenLoading] = useState(false);

  // New-template form
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // New-item form (within an open template)
  const [newItem, setNewItem] = useState(blankNewItem());

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const [tpls, users] = await Promise.all([api.getTaskTemplates(), api.getUsers()]);
      setTemplates(tpls as any[]);
      setStaffUsers((users as any[]).filter(u => isStaffRole(u)));
    } catch (err: any) {
      alert('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadTemplates(); }, []);

  const openTemplate = async (id: number) => {
    setOpenLoading(true);
    try {
      const data = await api.getTaskTemplate(id);
      setOpenTpl(data as Template);
    } catch (err: any) {
      alert('Failed to load template: ' + err.message);
    } finally {
      setOpenLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) { alert('Name required'); return; }
    try {
      await api.createTaskTemplate({ name: newName.trim(), description: newDesc.trim() || undefined });
      setNewName(''); setNewDesc(''); setShowNew(false);
      await loadTemplates();
    } catch (err: any) {
      alert('Create failed: ' + err.message);
    }
  };

  const handleDeleteTemplate = async (t: any) => {
    if (!confirm(`Delete template "${t.name}"? Existing tasks created from it are NOT affected.`)) return;
    try {
      await api.deleteTaskTemplate(t.id);
      if (openTpl?.id === t.id) setOpenTpl(null);
      await loadTemplates();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleRenameTemplate = async (t: any) => {
    const next = prompt('New name:', t.name);
    if (!next || !next.trim() || next.trim() === t.name) return;
    try {
      await api.updateTaskTemplate(t.id, { name: next.trim() });
      await loadTemplates();
      if (openTpl && openTpl.id === t.id) setOpenTpl({ ...openTpl, name: next.trim() });
    } catch (err: any) {
      alert('Rename failed: ' + err.message);
    }
  };

  const handleAddItem = async () => {
    if (!openTpl) return;
    if (!newItem.title.trim()) { alert('Title required'); return; }
    try {
      const days = newItem.days_offset === '' ? null : parseInt(newItem.days_offset, 10);
      await api.createTaskTemplateItem(openTpl.id, {
        title: newItem.title.trim(),
        description: newItem.description.trim() || null,
        default_priority: newItem.default_priority,
        days_offset: Number.isNaN(days as number) ? null : days,
        default_assignee: newItem.default_assignee || null,
        ordinal: openTpl.items.length,
      });
      setNewItem(blankNewItem());
      await openTemplate(openTpl.id);
      await loadTemplates(); // refresh count
    } catch (err: any) {
      alert('Add item failed: ' + err.message);
    }
  };

  const handleUpdateItem = async (item: Item, patch: Partial<Item>) => {
    try {
      await api.updateTaskTemplateItem(item.id, patch);
      setOpenTpl(prev => prev && {
        ...prev,
        items: prev.items.map(i => i.id === item.id ? { ...i, ...patch } as Item : i),
      });
    } catch (err: any) {
      alert('Update failed: ' + err.message);
    }
  };

  const handleDeleteItem = async (item: Item) => {
    if (!confirm(`Remove item "${item.title}" from this template?`)) return;
    try {
      await api.deleteTaskTemplateItem(item.id);
      await openTemplate(openTpl!.id);
      await loadTemplates();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const assigneeName = (uid: string | null) => {
    if (!uid) return '—';
    const u = staffUsers.find(s => s.id === uid);
    return u?.display_name || u?.username || uid.slice(0, 8);
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Task Templates</h2>
        {canEdit && (
          <div className="dashboard-actions">
            <button className="btn btn-primary" onClick={() => setShowNew(s => !s)}>
              {showNew ? 'Cancel' : '+ New Template'}
            </button>
          </div>
        )}
      </div>

      {!canEdit && (
        <div style={{ padding: 12, background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: '#475569', marginBottom: 16 }}>
          You can view and apply templates. Editing is restricted to Owner / Supervisor.
        </div>
      )}

      {showNew && (
        <div className="form-section" style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>New template</h3>
          <div className="form-group">
            <label>Name *</label>
            <input type="text" className="form-input" value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="e.g. New client onboarding" />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea className="form-input" rows={2} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional" />
          </div>
          <button className="btn btn-primary" onClick={handleCreate}>Create</button>
          <button className="btn btn-secondary" onClick={() => { setShowNew(false); setNewName(''); setNewDesc(''); }} style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      )}

      {loading ? (
        <div className="loading-screen">Loading...</div>
      ) : templates.length === 0 ? (
        <div className="empty-state">
          <p>No templates yet.</p>
          {canEdit && <p>Click <strong>+ New Template</strong> to create one.</p>}
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th style={{ width: 280 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.description || <em style={{ color: '#94a3b8' }}>—</em>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => openTemplate(t.id)}>Edit items</button>
                    {canEdit && (
                      <>
                        <button className="btn btn-link btn-sm" style={{ marginLeft: 6 }} onClick={() => handleRenameTemplate(t)}>Rename</button>
                        <button className="btn btn-link btn-sm" style={{ marginLeft: 6 }} onClick={() => handleDeleteTemplate(t)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openTpl && (
        <div className="form-section" style={{ marginTop: 24, padding: 16, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{openTpl.name} — items</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => setOpenTpl(null)}>Close</button>
          </div>
          {openLoading ? <p>Loading…</p> : (
            <>
              {openTpl.items.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>No items yet — add one below.</p>
              ) : (
                <table className="compliance-table" style={{ marginBottom: 12 }}>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th style={{ width: 110 }}>Priority</th>
                      <th style={{ width: 110 }}>Days from apply</th>
                      <th style={{ width: 180 }}>Default assignee</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTpl.items.map(item => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="text"
                            className="form-input form-input-sm"
                            defaultValue={item.title}
                            disabled={!canEdit}
                            onBlur={e => e.target.value !== item.title && handleUpdateItem(item, { title: e.target.value })}
                          />
                          {item.description && (
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{item.description}</div>
                          )}
                        </td>
                        <td>
                          <select
                            className="form-input form-input-sm"
                            value={item.default_priority}
                            disabled={!canEdit}
                            onChange={e => handleUpdateItem(item, { default_priority: e.target.value as any })}
                          >
                            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-input form-input-sm"
                            defaultValue={item.days_offset ?? ''}
                            disabled={!canEdit}
                            onBlur={e => {
                              const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              const nextVal = Number.isNaN(v as number) ? null : v;
                              if (nextVal !== item.days_offset) handleUpdateItem(item, { days_offset: nextVal });
                            }}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <select
                            className="form-input form-input-sm"
                            value={item.default_assignee || ''}
                            disabled={!canEdit}
                            onChange={e => handleUpdateItem(item, { default_assignee: e.target.value || null })}
                          >
                            <option value="">— Unassigned —</option>
                            {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                          </select>
                        </td>
                        <td>
                          {canEdit && (
                            <button className="btn btn-link btn-sm" onClick={() => handleDeleteItem(item)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {canEdit && (
                <div style={{ background: 'white', padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
                  <h4 style={{ marginTop: 0, fontSize: 13 }}>Add item</h4>
                  <div className="form-grid">
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Title *</label>
                      <input type="text" className="form-input" value={newItem.title} onChange={e => setNewItem({ ...newItem, title: e.target.value })} placeholder="e.g. Send welcome email" />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Description</label>
                      <input type="text" className="form-input" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} placeholder="Optional" />
                    </div>
                    <div className="form-group">
                      <label>Priority</label>
                      <select className="form-input" value={newItem.default_priority} onChange={e => setNewItem({ ...newItem, default_priority: e.target.value as any })}>
                        {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Days from apply</label>
                      <input type="number" className="form-input" value={newItem.days_offset} onChange={e => setNewItem({ ...newItem, days_offset: e.target.value })} placeholder="e.g. 7" />
                    </div>
                    <div className="form-group">
                      <label>Default assignee</label>
                      <select className="form-input" value={newItem.default_assignee} onChange={e => setNewItem({ ...newItem, default_assignee: e.target.value })}>
                        <option value="">— Unassigned —</option>
                        {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={handleAddItem} style={{ marginTop: 8 }}>Add item</button>
                </div>
              )}

              {/* Read-only fallback note */}
              {!canEdit && openTpl.items.length > 0 && (
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                  Default assignee shown above: <strong>{assigneeName(null)}</strong> means unassigned. (Read-only view — Supervisor / Owner can edit.)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
