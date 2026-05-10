import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

interface Props {
  preSelectedTaskId?: number | null;
  preSelectedClientId?: number | null;
  // For "edit existing call" use case — pass an existing log row
  editingId?: number | null;
  initial?: Partial<FormState>;
  onClose: () => void;
  onSaved?: () => void;
}

type FormState = {
  client_id:     string;
  staff_id:      string;
  direction:     'inbound' | 'outbound';
  contact_name:  string;
  contact_phone: string;
  call_at:       string;
  duration_min:  string;
  notes:         string;
  task_id:       string;
};

const toLocalInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function LogCallModal({
  preSelectedTaskId, preSelectedClientId, editingId, initial, onClose, onSaved,
}: Props) {
  const { user } = useAuth();
  const { clients } = useApp();
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [openTasks, setOpenTasks]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  const [form, setForm] = useState<FormState>({
    client_id:     preSelectedClientId ? String(preSelectedClientId) : '',
    staff_id:      user?.id || '',
    direction:     'outbound',  // logging-from-task is usually a callback
    contact_name:  '',
    contact_phone: '',
    call_at:       toLocalInput(new Date().toISOString()),
    duration_min:  '',
    notes:         '',
    task_id:       preSelectedTaskId ? String(preSelectedTaskId) : '',
    ...(initial as any || {}),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [users, tasks] = await Promise.all([
          api.getUsers(),
          api.getStaffTasks({}),
        ]);
        if (cancelled) return;
        setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
        // Show only OPEN-ish tasks in the picker (anything you might still be calling about)
        setOpenTasks((tasks as any[]).filter(t => t.status !== 'done' && t.status !== 'cancelled'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    if (!form.contact_name.trim() && !form.contact_phone.trim()) {
      alert('Provide a name or phone number for the call'); return;
    }
    setSaving(true);
    try {
      const dur = form.duration_min === '' ? null : parseInt(form.duration_min, 10);
      const payload = {
        client_id:     form.client_id ? Number(form.client_id) : null,
        staff_id:      form.staff_id || null,
        direction:     form.direction,
        contact_name:  form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        call_at:       new Date(form.call_at).toISOString(),
        duration_min:  Number.isNaN(dur as number) ? null : dur,
        notes:         form.notes.trim() || null,
        task_id:       form.task_id ? Number(form.task_id) : null,
      };
      if (editingId) {
        await api.updateCallLog(editingId, payload);
      } else {
        await api.createCallLog(payload);
      }
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const taskLabel = (t: any) => {
    const c = clients.find((x: any) => x.id === t.client_id);
    const cName = c ? `${c.client_code ? c.client_code + ' — ' : ''}${c.name}` : '';
    return `${t.title}${cName ? ` · ${cName}` : ''}`;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit call log' : 'Log a call'}</h3>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            <div className="form-grid">
              <div className="form-group">
                <label>Direction *</label>
                <select className="form-input" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value as any })}>
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </select>
              </div>
              <div className="form-group">
                <label>When *</label>
                <input type="datetime-local" className="form-input" value={form.call_at} onChange={e => setForm({ ...form, call_at: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Contact name</label>
                <input type="text" className="form-input" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" className="form-input" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Client (optional)</label>
                <select className="form-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">— None —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Staff handler</label>
                <select className="form-input" value={form.staff_id} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
                  <option value="">— None —</option>
                  {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Duration (minutes)</label>
                <input type="number" min={0} className="form-input" value={form.duration_min} onChange={e => setForm({ ...form, duration_min: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Linked task (optional)</label>
                <select className="form-input" value={form.task_id} onChange={e => setForm({ ...form, task_id: e.target.value })}>
                  <option value="">— None —</option>
                  {openTasks.map(t => <option key={t.id} value={t.id}>{taskLabel(t)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea className="form-input" rows={4} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="What was the call about?" />
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : (editingId ? 'Save changes' : 'Log call')}
          </button>
        </div>
      </div>
    </div>
  );
}
