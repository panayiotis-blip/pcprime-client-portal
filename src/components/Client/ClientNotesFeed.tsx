import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Timestamped notes feed for a client. Each note carries author, time,
// optional 'needs attention' flag, and may be promoted to a staff task
// via the inline form. The note keeps a chip showing the linked task(s)
// so the next person opening the file sees the trail.

type LinkedTask = {
  id: number;
  title: string;
  status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
};

type Note = {
  id: number;
  client_id: number;
  body: string;
  pinned: boolean;
  needs_attention: boolean;
  created_at: string;
  created_by: string | null;
  author_name: string | null;
  linked_tasks: LinkedTask[];
};

const STATUS_COLOUR: Record<string, { bg: string; fg: string; label: string }> = {
  open:        { bg: '#dbeafe', fg: '#1e40af', label: 'Open' },
  in_progress: { bg: '#fef3c7', fg: '#92400e', label: 'In progress' },
  blocked:     { bg: '#fee2e2', fg: '#b91c1c', label: 'Blocked' },
  done:        { bg: '#dcfce7', fg: '#166534', label: 'Done' },
  cancelled:   { bg: '#f1f5f9', fg: '#64748b', label: 'Cancelled' },
};

const fmtDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

export default function ClientNotesFeed({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // New-note form
  const [newBody, setNewBody] = useState('');
  const [newAttention, setNewAttention] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');

  // "Create task from note" inline form
  const [taskFromNoteId, setTaskFromNoteId] = useState<number | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [creatingTask, setCreatingTask] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.getClientNotes(clientId);
      setNotes(rows as Note[]);
    } catch (err: any) {
      alert('Failed to load notes: ' + (err?.message || String(err)));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [clientId]);

  const handleAdd = async () => {
    if (!newBody.trim()) return;
    setSaving(true);
    try {
      await api.createClientNote(clientId, { body: newBody.trim(), needs_attention: newAttention });
      setNewBody('');
      setNewAttention(false);
      await load();
    } catch (err: any) {
      alert('Failed to add note: ' + (err?.message || String(err)));
    } finally { setSaving(false); }
  };

  const handleTogglePin = async (n: Note) => {
    try {
      await api.updateClientNote(n.id, { pinned: !n.pinned });
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const handleToggleAttention = async (n: Note) => {
    try {
      await api.updateClientNote(n.id, { needs_attention: !n.needs_attention });
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const startEdit = (n: Note) => { setEditingId(n.id); setEditBody(n.body); };
  const cancelEdit = () => { setEditingId(null); setEditBody(''); };
  const saveEdit = async (n: Note) => {
    if (!editBody.trim()) return;
    try {
      await api.updateClientNote(n.id, { body: editBody.trim() });
      cancelEdit();
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const handleDelete = async (n: Note) => {
    if (!confirm('Delete this note? It will be hidden from the feed but kept in the audit log.')) return;
    try {
      await api.deleteClientNote(n.id);
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const openCreateTask = (n: Note) => {
    setTaskFromNoteId(n.id);
    // Default the task title to the first 80 chars of the note body.
    setTaskTitle((n.body || '').slice(0, 80));
    setTaskDue('');
    setTaskPriority(n.needs_attention ? 'high' : 'medium');
  };

  const submitCreateTask = async () => {
    if (taskFromNoteId == null) return;
    if (!taskTitle.trim()) { alert('Task title is required.'); return; }
    setCreatingTask(true);
    try {
      const note = notes.find(n => n.id === taskFromNoteId);
      await api.createTaskFromNote(taskFromNoteId, {
        title: taskTitle.trim(),
        client_id: clientId,
        description: note?.body || '',
        assigned_to: user?.id || null,
        due_date: taskDue || null,
        priority: taskPriority,
      });
      setTaskFromNoteId(null);
      setTaskTitle('');
      setTaskDue('');
      // Clearing the attention flag once a task exists is a sensible default —
      // the action's now tracked elsewhere.
      if (note?.needs_attention) {
        await api.updateClientNote(note.id, { needs_attention: false });
      }
      await load();
    } catch (err: any) {
      alert('Create task failed: ' + (err?.message || String(err)));
    } finally {
      setCreatingTask(false);
    }
  };

  return (
    <div>
      {/* Add new note */}
      <div style={{ padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 12 }}>
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Add a note — what just happened, what to remember, what to follow up on…"
          className="form-input"
          style={{ width: '100%', fontSize: 13, minHeight: 70 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
            <input type="checkbox" checked={newAttention} onChange={(e) => setNewAttention(e.target.checked)} />
            ⚠ Needs attention
          </label>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving || !newBody.trim()}>
            {saving ? 'Adding…' : '+ Add note'}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>
          No notes yet. Start with whatever you'd want a future-you (or a colleague) to know about this client.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map(n => (
            <div key={n.id} style={{
              padding: 12,
              background: n.needs_attention ? '#fff7ed' : '#fff',
              border: '1px solid ' + (n.needs_attention ? '#fdba74' : (n.pinned ? '#bfdbfe' : '#e2e8f0')),
              borderRadius: 6,
              borderLeft: '4px solid ' + (n.needs_attention ? '#f97316' : (n.pinned ? '#3b82f6' : '#e2e8f0')),
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11, color: '#64748b' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: '#1a365d' }}>{n.author_name || 'Staff'}</span>
                  <span title={n.created_at}>{fmtDateTime(n.created_at)}</span>
                  {n.pinned && <span style={{ background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>📌 Pinned</span>}
                  {n.needs_attention && <span style={{ background: '#fed7aa', color: '#9a3412', padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>⚠ Needs attention</span>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <button className="btn btn-link btn-sm" onClick={() => handleTogglePin(n)} style={{ padding: '0 4px' }}>{n.pinned ? 'Unpin' : 'Pin'}</button>
                  {!n.needs_attention && (
                    <button className="btn btn-link btn-sm" onClick={() => handleToggleAttention(n)} style={{ padding: '0 4px' }}>Mark attention</button>
                  )}
                  <button className="btn btn-link btn-sm" onClick={() => openCreateTask(n)} style={{ padding: '0 4px' }}>→ Task</button>
                  <button className="btn btn-link btn-sm" onClick={() => startEdit(n)} style={{ padding: '0 4px' }}>Edit</button>
                  <button className="btn btn-link btn-sm" onClick={() => handleDelete(n)} style={{ padding: '0 4px', color: '#b91c1c' }}>Delete</button>
                </div>
              </div>

              {editingId === n.id ? (
                <div>
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4} className="form-input" style={{ width: '100%', fontSize: 13 }} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(n)} disabled={!editBody.trim()}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1a365d', fontSize: 14 }}>{n.body}</div>
              )}

              {/* Linked task chips */}
              {n.linked_tasks && n.linked_tasks.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {n.linked_tasks.map(t => {
                    const c = STATUS_COLOUR[t.status] || STATUS_COLOUR.open;
                    return (
                      <span key={t.id} style={{
                        background: c.bg, color: c.fg,
                        padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600,
                      }} title={t.title}>
                        → Task #{t.id}: {t.title.length > 40 ? t.title.slice(0, 40) + '…' : t.title} · {c.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Inline task-creation form, shown for the active note */}
              {taskFromNoteId === n.id && (
                <div style={{ marginTop: 8, padding: 10, background: '#f1f5f9', borderRadius: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#1a365d', marginBottom: 6 }}>Create task from this note</div>
                  <input type="text" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="form-input" placeholder="Task title" style={{ width: '100%', fontSize: 13, marginBottom: 6 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b' }}>Due date</label>
                      <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="form-input" style={{ width: '100%', fontSize: 13 }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b' }}>Priority</label>
                      <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as any)} className="form-input" style={{ width: '100%', fontSize: 13 }}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setTaskFromNoteId(null)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={submitCreateTask} disabled={creatingTask || !taskTitle.trim()}>
                      {creatingTask ? 'Creating…' : 'Create task'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
