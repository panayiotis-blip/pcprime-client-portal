import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

interface Props {
  onClose: () => void;
  onSaved?: (taskId: number) => void;
}

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;

// Captures a phone message and turns it into a staff_task assigned to the
// recipient, so the message becomes actionable in the Tasks list.
export default function LogMessageModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { clients } = useApp();
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [from, setFrom]           = useState('');
  const [phone, setPhone]         = useState('');
  const [forUser, setForUser]     = useState<string>(user?.id || '');
  const [clientId, setClientId]   = useState<string>('');
  const [message, setMessage]     = useState('');
  const [priority, setPriority]   = useState<typeof PRIORITY_OPTIONS[number]>('medium');

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
    if (!from.trim() && !phone.trim()) { alert('Caller name or phone required'); return; }
    if (!message.trim()) { alert('Message required'); return; }
    setSaving(true);
    try {
      const callerLabel = from.trim() || phone.trim();
      const phoneInfo   = phone.trim() ? ` (${phone.trim()})` : '';
      const r = await api.createStaffTask({
        title:       `Return call: ${callerLabel}`,
        description: `From: ${callerLabel}${phoneInfo}\n\n${message.trim()}`,
        client_id:   clientId ? Number(clientId) : null,
        assigned_to: forUser || null,
        priority,
        status:      'open',
        category:    'return_call',
      });
      if (onSaved) onSaved(r.id);
      onClose();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Log a phone message</h3>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 12px 0' }}>
          Saves as a task in the recipient's list so they pick it up next time they're on the Tasks page.
        </p>

        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            <div className="form-grid">
              <div className="form-group">
                <label>From (caller name)</label>
                <input type="text" className="form-input" value={from} onChange={e => setFrom(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label>Phone number</label>
                <input type="tel" className="form-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+357 99 ..." />
              </div>
              <div className="form-group">
                <label>For (recipient) *</label>
                <select className="form-input" value={forUser} onChange={e => setForUser(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>About client (optional)</label>
                <select className="form-input" value={clientId} onChange={e => setClientId(e.target.value)}>
                  <option value="">— None —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select className="form-input" value={priority} onChange={e => setPriority(e.target.value as any)}>
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Message *</label>
              <textarea className="form-input" rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="What did they say?" />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save as task'}
          </button>
        </div>
      </div>
    </div>
  );
}
