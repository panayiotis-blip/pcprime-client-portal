import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import LogMessageModal from './LogMessageModal';

type CallLog = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  staff_id: string | null;
  direction: 'inbound' | 'outbound';
  contact_name: string | null;
  contact_phone: string | null;
  call_at: string;
  duration_min: number | null;
  notes: string | null;
};

type FormState = {
  id?: number;
  client_id: string;
  staff_id: string;
  direction: 'inbound' | 'outbound';
  contact_name: string;
  contact_phone: string;
  call_at: string;          // datetime-local
  duration_min: string;     // string for the input
  notes: string;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toLocalInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const blankForm = (uid: string): FormState => ({
  client_id: '',
  staff_id: uid,
  direction: 'inbound',
  contact_name: '',
  contact_phone: '',
  call_at: toLocalInput(new Date().toISOString()),
  duration_min: '',
  notes: '',
});

export default function PhoneLog() {
  const { user } = useAuth();
  const { clients } = useApp();
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [fDirection, setFDirection] = useState<string>('');
  const [fClient,    setFClient]    = useState<string>('');
  const [fStaff,     setFStaff]     = useState<string>('');
  const [fFrom,      setFFrom]      = useState<string>('');
  const [fTo,        setFTo]        = useState<string>('');
  const [search,     setSearch]     = useState<string>('');

  // Modal
  const [showForm, setShowForm] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [form, setForm] = useState<FormState>(() => blankForm(user?.id || ''));
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (fDirection) params.direction = fDirection;
      if (fClient)    params.client_id = Number(fClient);
      if (fStaff)     params.staff_id  = fStaff;
      if (fFrom)      params.from = fFrom;
      if (fTo)        params.to   = fTo;
      const data = await api.getCallLogs(params);
      setLogs(data as CallLog[]);
    } catch (err: any) {
      alert('Failed to load call logs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const users = await api.getUsers();
        if (!cancelled) setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
      } catch {}
    })();
    reload();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, []);
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fDirection, fClient, fStaff, fFrom, fTo]);

  const visible = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.trim().toLowerCase();
    return logs.filter(l =>
      (l.contact_name  || '').toLowerCase().includes(q) ||
      (l.contact_phone || '').toLowerCase().includes(q) ||
      (l.notes         || '').toLowerCase().includes(q) ||
      (l.client_name   || '').toLowerCase().includes(q)
    );
  }, [logs, search]);

  const staffName = (uid: string | null) => {
    if (!uid) return '—';
    const u = staffUsers.find(s => s.id === uid);
    return u?.display_name || u?.username || uid.slice(0, 8);
  };

  const startNew = () => { setForm(blankForm(user?.id || '')); setShowForm(true); };

  const startEdit = (l: CallLog) => {
    setForm({
      id:            l.id,
      client_id:     l.client_id ? String(l.client_id) : '',
      staff_id:      l.staff_id || '',
      direction:     l.direction,
      contact_name:  l.contact_name || '',
      contact_phone: l.contact_phone || '',
      call_at:       toLocalInput(l.call_at),
      duration_min:  l.duration_min != null ? String(l.duration_min) : '',
      notes:         l.notes || '',
    });
    setShowForm(true);
  };

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
      };
      if (form.id) {
        await api.updateCallLog(form.id, payload);
      } else {
        await api.createCallLog(payload);
      }
      setShowForm(false);
      await reload();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (l: CallLog) => {
    if (!confirm(`Delete call log entry for ${l.contact_name || l.contact_phone || 'unknown'}?`)) return;
    try {
      await api.deleteCallLog(l.id);
      await reload();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Phone Log</h2>
        <div className="dashboard-actions">
          <button className="btn btn-secondary" onClick={() => setShowMessage(true)}>Log a message</button>
          <button className="btn btn-primary" onClick={startNew} style={{ marginLeft: 6 }}>+ Log call</button>
        </div>
      </div>

      <div className="filters-bar no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }}>
        <div className="form-group" style={{ minWidth: 140 }}>
          <label>Direction</label>
          <select className="form-input" value={fDirection} onChange={e => setFDirection(e.target.value)}>
            <option value="">All</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 200 }}>
          <label>Client</label>
          <select className="form-input" value={fClient} onChange={e => setFClient(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>Staff</label>
          <select className="form-input" value={fStaff} onChange={e => setFStaff(e.target.value)}>
            <option value="">All staff</option>
            {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>From</label>
          <input type="date" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div className="form-group">
          <label>To</label>
          <input type="date" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
          <label>Search</label>
          <input type="text" className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="contact, phone, notes…" />
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <p>No call logs match these filters.</p>
        </div>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>When</th>
                <th style={{ width: 90 }}>Direction</th>
                <th>Contact</th>
                <th>Client</th>
                <th>Staff</th>
                <th>Duration</th>
                <th>Notes</th>
                <th style={{ width: 90 }} className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(l => (
                <tr key={l.id}>
                  <td>{fmtTime(l.call_at)}</td>
                  <td>
                    <span className="status-badge" style={{
                      background: l.direction === 'inbound' ? '#dbeafe' : '#e0e7ff',
                      color: l.direction === 'inbound' ? '#1e40af' : '#3730a3',
                    }}>
                      {l.direction === 'inbound' ? '← In' : '→ Out'}
                    </span>
                  </td>
                  <td>
                    {l.contact_name && <div>{l.contact_name}</div>}
                    {l.contact_phone && <div style={{ fontSize: 12, color: '#64748b' }}>{l.contact_phone}</div>}
                  </td>
                  <td>{l.client_id ? <Link to={`/clients/${l.client_id}`}>{l.client_code ? l.client_code + ' — ' : ''}{l.client_name}</Link> : '—'}</td>
                  <td>{staffName(l.staff_id)}</td>
                  <td>{l.duration_min != null ? `${l.duration_min}m` : '—'}</td>
                  <td style={{ maxWidth: 300 }}>{l.notes ? <span style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{l.notes}</span> : '—'}</td>
                  <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(l)}>Edit</button>
                    <button className="btn btn-link btn-sm" onClick={() => handleDelete(l)} style={{ marginLeft: 4 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit call log' : 'Log a call'}</h3>
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
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea className="form-input" rows={4} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="What was the call about?" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : (form.id ? 'Save changes' : 'Log call')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMessage && (
        <LogMessageModal
          onClose={() => setShowMessage(false)}
          onSaved={() => { /* nothing to refresh on this page — message lives on Tasks */ }}
        />
      )}
    </div>
  );
}
