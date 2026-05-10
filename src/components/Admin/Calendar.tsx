import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

// Pre-defined palette for owner colour-coding (cycled by index in staff list).
const OWNER_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

type Appointment = {
  id: number;
  owner_id: string;
  owner_name: string;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
};

type FormState = {
  id?: number;
  owner_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  client_id: string;
};

const blankForm = (defaultOwner: string): FormState => ({
  owner_id: defaultOwner,
  title: '',
  description: '',
  location: '',
  starts_at: '',
  ends_at: '',
  all_day: false,
  status: 'confirmed',
  client_id: '',
});

// Convert ISO timestamp to format usable by datetime-local input ("YYYY-MM-DDTHH:mm")
const toLocalInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Convert datetime-local input back to ISO string
const fromLocalInput = (local: string) => {
  if (!local) return '';
  return new Date(local).toISOString();
};

export default function Calendar() {
  const { user } = useAuth();
  const { clients } = useApp();
  const calendarRef = useRef<any>(null);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [staffUsers, setStaffUsers]     = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);

  const [filterOwner, setFilterOwner] = useState<string>(''); // '' = all staff

  // Edit/create modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(() => blankForm(user?.id || ''));
  const [saving, setSaving] = useState(false);

  // Build owner_id → color map
  const colorByOwner = useMemo(() => {
    const m = new Map<string, string>();
    staffUsers.forEach((u, i) => m.set(u.id, OWNER_COLORS[i % OWNER_COLORS.length]));
    return m;
  }, [staffUsers]);

  const loadAppointments = async () => {
    try {
      const params: any = {};
      if (filterOwner) params.owner_id = filterOwner;
      const data = await api.getAppointments(params);
      setAppointments(data as Appointment[]);
    } catch (err: any) {
      alert('Failed to load appointments: ' + err.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const users = await api.getUsers();
        if (cancelled) return;
        setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
        await loadAppointments();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload appointments when filter changes
  useEffect(() => { loadAppointments(); /* eslint-disable-next-line */ }, [filterOwner]);

  // Map appointments → FullCalendar events
  const events = useMemo(() => appointments.map(a => ({
    id: String(a.id),
    title: a.title + (a.client_name ? ` · ${a.client_name}` : ''),
    start: a.starts_at,
    end: a.ends_at,
    allDay: a.all_day,
    backgroundColor: colorByOwner.get(a.owner_id) || '#64748b',
    borderColor:     colorByOwner.get(a.owner_id) || '#64748b',
    extendedProps: { appointment: a },
  })), [appointments, colorByOwner]);

  const openNew = (start?: Date, end?: Date, allDay = false) => {
    const f = blankForm(user?.id || '');
    if (start) f.starts_at = toLocalInput(start.toISOString());
    if (end)   f.ends_at   = toLocalInput(end.toISOString());
    if (!start) {
      // No date passed — default to "now" rounded to the next hour, ends an hour later
      const now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      f.starts_at = toLocalInput(now.toISOString());
      const later = new Date(now); later.setHours(later.getHours() + 1);
      f.ends_at = toLocalInput(later.toISOString());
    }
    f.all_day = allDay;
    setForm(f);
    setShowModal(true);
  };

  const openEdit = (a: Appointment) => {
    setForm({
      id: a.id,
      owner_id:    a.owner_id,
      title:       a.title,
      description: a.description || '',
      location:    a.location || '',
      starts_at:   toLocalInput(a.starts_at),
      ends_at:     toLocalInput(a.ends_at),
      all_day:     a.all_day,
      status:      a.status,
      client_id:   a.client_id ? String(a.client_id) : '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { alert('Title is required'); return; }
    if (!form.starts_at || !form.ends_at) { alert('Start and end times required'); return; }
    if (new Date(form.ends_at) < new Date(form.starts_at)) { alert('End must be after start'); return; }
    setSaving(true);
    try {
      const payload = {
        owner_id:    form.owner_id,
        title:       form.title.trim(),
        description: form.description.trim() || null,
        location:    form.location.trim() || null,
        starts_at:   fromLocalInput(form.starts_at),
        ends_at:     fromLocalInput(form.ends_at),
        all_day:     form.all_day,
        status:      form.status,
        client_id:   form.client_id ? Number(form.client_id) : null,
      };
      if (form.id) {
        await api.updateAppointment(form.id, payload);
      } else {
        await api.createAppointment(payload);
      }
      setShowModal(false);
      await loadAppointments();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form.id) return;
    if (!confirm('Delete this appointment?')) return;
    try {
      await api.deleteAppointment(form.id);
      setShowModal(false);
      await loadAppointments();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  // Drag-and-drop reschedule
  const handleEventDrop = async (info: any) => {
    const a = info.event.extendedProps.appointment as Appointment;
    try {
      await api.updateAppointment(a.id, {
        starts_at: info.event.start.toISOString(),
        ends_at:   (info.event.end || info.event.start).toISOString(),
        all_day:   info.event.allDay,
      });
      await loadAppointments();
    } catch (err: any) {
      alert('Reschedule failed: ' + err.message);
      info.revert();
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Calendar</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="form-input" value={filterOwner} onChange={e => setFilterOwner(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">All staff diaries</option>
            <option value={user?.id || ''}>My calendar ({user?.display_name})</option>
            {staffUsers.filter(u => u.id !== user?.id).map(u => (
              <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => openNew()}>+ New appointment</button>
        </div>
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : (
        <>
          {/* Owner colour legend */}
          {!filterOwner && staffUsers.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '8px 0 12px 0', fontSize: 12 }}>
              {staffUsers.map(u => (
                <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                    background: colorByOwner.get(u.id),
                  }} />
                  {u.display_name || u.username}
                </span>
              ))}
            </div>
          )}

          <div style={{ background: 'white', padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left:   'prev,next today',
                center: 'title',
                right:  'dayGridMonth,timeGridWeek,timeGridDay',
              }}
              height="auto"
              firstDay={1} // Monday
              nowIndicator
              editable
              selectable
              selectMirror
              dayMaxEvents
              events={events}
              eventClick={(info) => openEdit(info.event.extendedProps.appointment as Appointment)}
              select={(info) => openNew(info.start, info.end, info.allDay)}
              eventDrop={handleEventDrop}
              eventResize={handleEventDrop}
            />
          </div>
        </>
      )}

      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
            <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit appointment' : 'New appointment'}</h3>
            <div className="form-group">
              <label>Title *</label>
              <input type="text" className="form-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus />
            </div>
            <div className="form-group">
              <label>Owner (whose diary)</label>
              <select className="form-input" value={form.owner_id} onChange={e => setForm({ ...form, owner_id: e.target.value })}>
                {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
              </select>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Starts *</label>
                <input type="datetime-local" className="form-input" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Ends *</label>
                <input type="datetime-local" className="form-input" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 14 }}>
              <input type="checkbox" checked={form.all_day} onChange={e => setForm({ ...form, all_day: e.target.checked })} />
              All-day event
            </label>
            <div className="form-grid">
              <div className="form-group">
                <label>Status</label>
                <select className="form-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })}>
                  <option value="confirmed">Confirmed</option>
                  <option value="tentative">Tentative</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="form-group">
                <label>Client (optional)</label>
                <select className="form-input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">— None —</option>
                  {clients.map((c: any) => <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Location</label>
              <input type="text" className="form-input" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Description / notes</label>
              <textarea className="form-input" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                {form.id && <button className="btn btn-danger" onClick={handleDelete}>Delete</button>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : (form.id ? 'Save changes' : 'Create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
