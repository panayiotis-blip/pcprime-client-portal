import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import LogMessageModal from './LogMessageModal';
import LogCallModal from './LogCallModal';

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
  task_id: number | null;
  task_title: string | null;
  task_status: string | null;
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

export default function PhoneLog() {
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

  // Modal state — null = closed; otherwise pass to LogCallModal
  const [callModal, setCallModal] = useState<{ editingId: number | null; initial: any } | null>(null);
  const [showMessage, setShowMessage] = useState(false);

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
      (l.client_name   || '').toLowerCase().includes(q) ||
      (l.task_title    || '').toLowerCase().includes(q)
    );
  }, [logs, search]);

  const staffName = (uid: string | null) => {
    if (!uid) return '—';
    const u = staffUsers.find(s => s.id === uid);
    return u?.display_name || u?.username || uid.slice(0, 8);
  };

  const startEdit = (l: CallLog) => {
    setCallModal({
      editingId: l.id,
      initial: {
        client_id:     l.client_id ? String(l.client_id) : '',
        staff_id:      l.staff_id || '',
        direction:     l.direction,
        contact_name:  l.contact_name || '',
        contact_phone: l.contact_phone || '',
        call_at:       toLocalInput(l.call_at),
        duration_min:  l.duration_min != null ? String(l.duration_min) : '',
        notes:         l.notes || '',
        task_id:       l.task_id ? String(l.task_id) : '',
      },
    });
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
          <button className="btn btn-primary" onClick={() => setCallModal({ editingId: null, initial: {} })} style={{ marginLeft: 6 }}>+ Log call</button>
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
          <input type="text" className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="contact, phone, notes, task…" />
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
                <th>Linked task</th>
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
                  <td>
                    {l.task_id ? (
                      <Link to="/tasks" style={{ fontSize: 13 }}>
                        {l.task_title}
                        {l.task_status && l.task_status !== 'open' && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}>({l.task_status})</span>
                        )}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={{ maxWidth: 280 }}>{l.notes ? <span style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>{l.notes}</span> : '—'}</td>
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

      {callModal && (
        <LogCallModal
          editingId={callModal.editingId}
          initial={callModal.initial}
          onClose={() => setCallModal(null)}
          onSaved={() => { setCallModal(null); reload(); }}
        />
      )}

      {showMessage && (
        <LogMessageModal
          onClose={() => setShowMessage(false)}
          onSaved={() => setShowMessage(false)}
        />
      )}
    </div>
  );
}
