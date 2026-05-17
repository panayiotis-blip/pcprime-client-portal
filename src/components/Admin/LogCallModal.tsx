import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

interface Props {
  preSelectedClientId?: number | null;
  // For "edit existing call" — pass an existing log row
  editingId?: number | null;
  initial?: Partial<FormState> & { task_id?: number | null; task_title?: string | null; task_recipient?: string | null };
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
  // For NEW inbound calls only — who the message is for. Drives staff_task creation.
  recipient_id:  string;
};

const toLocalInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function LogCallModal({
  preSelectedClientId, editingId, initial, onClose, onSaved,
}: Props) {
  const { user } = useAuth();
  const { clients } = useApp();
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  const initialDirection = (initial?.direction as any) || 'inbound';

  const [form, setForm] = useState<FormState>({
    client_id:     preSelectedClientId ? String(preSelectedClientId) : '',
    staff_id:      user?.id || '',
    direction:     initialDirection,
    contact_name:  '',
    contact_phone: '',
    call_at:       toLocalInput(new Date().toISOString()),
    duration_min:  '',
    notes:         '',
    // Default the message recipient to the current user — staff usually takes
    // a message for themselves or hand-picks; pre-filling is just a sane start.
    recipient_id:  user?.id || '',
    ...(initial as any || {}),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const users = await api.getUsers();
        if (cancelled) return;
        setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
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
    if (form.direction === 'inbound' && !editingId && !form.recipient_id) {
      alert('Pick who the message is for'); return;
    }
    setSaving(true);
    try {
      const dur = form.duration_min === '' ? null : parseInt(form.duration_min, 10);
      const callerLabel = form.contact_name.trim() || form.contact_phone.trim();
      const phoneInfo   = form.contact_phone.trim() ? ` (${form.contact_phone.trim()})` : '';

      let taskId: number | null = (initial as any)?.task_id ?? null;

      // For a NEW inbound call with a recipient set → create the return-call task first,
      // then link the call_log to it via task_id.
      if (form.direction === 'inbound' && !editingId && form.recipient_id) {
        const created = await api.createStaffTask({
          title:       `Return call: ${callerLabel}`,
          description: `From: ${callerLabel}${phoneInfo}${form.notes.trim() ? `\n\n${form.notes.trim()}` : ''}`,
          client_id:   form.client_id ? Number(form.client_id) : null,
          assigned_to: form.recipient_id,
          priority:    'medium',
          status:      'open',
          category:    'return_call',
        });
        taskId = created.id;
      }

      const payload = {
        client_id:     form.client_id ? Number(form.client_id) : null,
        staff_id:      form.staff_id || null,
        direction:     form.direction,
        contact_name:  form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        call_at:       new Date(form.call_at).toISOString(),
        duration_min:  Number.isNaN(dur as number) ? null : dur,
        notes:         form.notes.trim() || null,
        task_id:       taskId,
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

  const recipientName = (uid: string | null | undefined) => {
    if (!uid) return '—';
    const u = staffUsers.find(s => s.id === uid);
    return u?.display_name || u?.username || uid.slice(0, 8);
  };

  const isInbound = form.direction === 'inbound';

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
            {/* Direction comes FIRST so the recipient field can show/hide based on it */}
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
            </div>

            {/* The big new field — message recipient — only relevant for inbound calls */}
            {isInbound && !editingId && (
              <div className="form-group" style={{
                marginTop: 8, padding: 12, background: '#eef1f5',
                border: '1px solid var(--pc-border-strong)', borderRadius: 6,
              }}>
                <label style={{ fontWeight: 600, color: 'var(--pc-navy-2)' }}>📨 Message for *</label>
                <select
                  className="form-input"
                  value={form.recipient_id}
                  onChange={e => setForm({ ...form, recipient_id: e.target.value })}
                  style={{ marginTop: 4 }}
                >
                  <option value="">— Pick recipient —</option>
                  {staffUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: '#475569', margin: '6px 0 0 0' }}>
                  Saving will add a <strong>Return call</strong> task to {recipientName(form.recipient_id)}'s task list.
                </p>
              </div>
            )}

            {isInbound && editingId && (initial as any)?.task_id && (
              <div className="form-group" style={{
                marginTop: 8, padding: 10, background: '#f1f5f9',
                border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13,
              }}>
                Linked to return-call task: <strong>{(initial as any)?.task_title || `#${(initial as any).task_id}`}</strong>
              </div>
            )}

            <div className="form-grid" style={{ marginTop: 8 }}>
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
                <label>Handled by (staff)</label>
                <select className="form-input" value={form.staff_id} onChange={e => setForm({ ...form, staff_id: e.target.value })}>
                  <option value="">— None —</option>
                  {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Duration (minutes)</label>
                <input type="number" min={0} className="form-input" value={form.duration_min} onChange={e => setForm({ ...form, duration_min: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Notes / Message</label>
              <textarea className="form-input" rows={4} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={isInbound ? 'What did they say? What do they want?' : 'Notes about the call'} />
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
