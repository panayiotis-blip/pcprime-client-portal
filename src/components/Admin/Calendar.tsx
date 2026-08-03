import { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { api, isStaffRole } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../services/dates';
import SearchableSelect from '../common/SearchableSelect';
import { toClientOptions } from '../../services/clientOptions';

const TIMESHEET_SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;

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

// Snap a Date to the nearest N-minute boundary (default 15)
const roundToMinutes = (d: Date, mins = 15) => {
  const ms = mins * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
};

// Given a "YYYY-MM-DDTHH:mm" local string, add minutes and return the same format
const addMinutesLocal = (local: string, mins: number) => {
  if (!local) return '';
  const d = new Date(local);
  d.setMinutes(d.getMinutes() + mins);
  return toLocalInput(d.toISOString());
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
  // Track whether the user has manually edited the end time so changing start
  // doesn't overwrite a deliberately-chosen duration.
  const [endManuallyEdited, setEndManuallyEdited] = useState(false);

  // "Log time for this appointment" sub-form (only visible when editing an existing appointment)
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [logTimeForm, setLogTimeForm] = useState({ service: 'Meetings', description: '', billable: true });
  const [logTimeSaving, setLogTimeSaving] = useState(false);

  // "Send email notification" sub-form (only on a saved appointment)
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyExtra, setNotifyExtra] = useState('');
  const [notifySending, setNotifySending] = useState(false);

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
        setStaffUsers((users as any[]).filter(u => isStaffRole(u)));
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
    if (start) {
      const snapStart = roundToMinutes(start);
      f.starts_at = toLocalInput(snapStart.toISOString());
      // Default end to start + 1 hour (overridable by user)
      const endDefault = end ? roundToMinutes(end) : new Date(snapStart.getTime() + 60 * 60 * 1000);
      f.ends_at = toLocalInput(endDefault.toISOString());
    } else {
      // No date passed — default to "now" rounded to the next 15 min, ends an hour later
      const now = roundToMinutes(new Date(Date.now() + 15 * 60 * 1000));
      f.starts_at = toLocalInput(now.toISOString());
      const later = new Date(now.getTime() + 60 * 60 * 1000);
      f.ends_at = toLocalInput(later.toISOString());
    }
    f.all_day = allDay;
    setEndManuallyEdited(false);
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
    // Existing appointment — treat end as deliberately set so changing start
    // doesn't clobber it.
    setEndManuallyEdited(true);
    setLogTimeOpen(false);
    setLogTimeForm({ service: 'Meetings', description: a.title || '', billable: true });
    setShowModal(true);
  };

  // Create a time-sheet entry from the current appointment values. Duration is
  // derived from starts_at → ends_at.
  const handleLogTimeFromAppointment = async () => {
    if (!form.id) { alert('Save the appointment first'); return; }
    if (!form.client_id) { alert('Pick a client on the appointment before logging time'); return; }
    if (!form.starts_at || !form.ends_at) { alert('Start and end required to compute duration'); return; }
    const minutes = Math.max(1, Math.round((new Date(form.ends_at).getTime() - new Date(form.starts_at).getTime()) / 60000));
    setLogTimeSaving(true);
    try {
      await api.createTimeEntry({
        client_id:      Number(form.client_id),
        entry_date:     form.starts_at.slice(0, 10),
        minutes,
        service:        logTimeForm.service,
        description:    logTimeForm.description.trim() || form.title || null,
        billable:       logTimeForm.billable,
        appointment_id: form.id,
      });
      alert(`Logged ${minutes} minutes against this appointment.`);
      setLogTimeOpen(false);
    } catch (err: any) {
      alert('Log failed: ' + err.message);
    } finally {
      setLogTimeSaving(false);
    }
  };

  // When start changes, auto-fill end as start + 1 hour, unless the user
  // already changed the end themselves.
  const handleStartChange = (newStart: string) => {
    setForm(prev => {
      const next = { ...prev, starts_at: newStart };
      if (!endManuallyEdited && newStart) {
        next.ends_at = addMinutesLocal(newStart, 60);
      }
      return next;
    });
  };

  const handleEndChange = (newEnd: string) => {
    setEndManuallyEdited(true);
    setForm(prev => ({ ...prev, ends_at: newEnd }));
  };

  // Recipients for the appointment email — linked client's email(s) + extras.
  const splitEmails = (s: string) => s.split(/[;,]+/).map(x => x.trim()).filter(Boolean);
  const notifyClient = clients.find((c: any) => String(c.id) === form.client_id);
  const notifyRecipients = Array.from(new Set([
    ...(notifyClient?.email ? splitEmails(String(notifyClient.email)) : []),
    ...splitEmails(notifyExtra),
  ]));

  // Email the meeting details to the linked client + any extra recipients.
  const handleSendNotification = async () => {
    const to = notifyRecipients;
    if (to.length === 0) {
      alert('No recipient — the linked client has no email on file. Add a recipient below.');
      return;
    }
    const start = formatDateTime(form.starts_at, '');
    const end   = formatDateTime(form.ends_at, '');
    const subject = `Meeting: ${form.title}`;
    const html = [
      '<p>This is a notification for the following meeting:</p>',
      `<p style="font-size:15px"><strong>${form.title}</strong></p>`,
      `<p>When: ${start}${end ? ' &ndash; ' + end : ''}</p>`,
      form.location ? `<p>Where: ${form.location}</p>` : '',
      form.description ? `<p>${form.description}</p>` : '',
    ].filter(Boolean).join('\n');
    const text = `Meeting: ${form.title}\nWhen: ${start}${end ? ' - ' + end : ''}`
      + (form.location ? `\nWhere: ${form.location}` : '')
      + (form.description ? `\n\n${form.description}` : '');
    setNotifySending(true);
    // send-via-outlook sends one recipient per call, so fan out and collect
    // any per-recipient failures rather than aborting the whole batch.
    const sent: string[] = [];
    const fails: string[] = [];
    for (const recipient of to) {
      try {
        await api.sendViaOutlook({ from_firm: true, to: recipient, subject, body: text, html });
        sent.push(recipient);
      } catch (err: any) {
        fails.push(`${recipient}: ${err.message}`);
      }
    }
    setNotifySending(false);
    if (sent.length) {
      alert(
        `Notification sent to ${sent.join(', ')}.` +
        (fails.length ? `\n\nFailed:\n${fails.join('\n')}` : ''),
      );
      setNotifyOpen(false);
      setNotifyExtra('');
    } else {
      alert('Send failed:\n' + fails.join('\n'));
    }
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
              slotDuration="00:15:00"
              snapDuration="00:15:00"
              defaultTimedEventDuration="01:00:00"
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
                <input
                  type="datetime-local"
                  className="form-input"
                  step={900}
                  value={form.starts_at}
                  onChange={e => handleStartChange(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Ends *</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  step={900}
                  value={form.ends_at}
                  onChange={e => handleEndChange(e.target.value)}
                />
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
                <SearchableSelect
                  value={form.client_id}
                  options={toClientOptions(clients)}
                  onChange={v => setForm({ ...form, client_id: v ? String(v) : '' })}
                  placeholder="— None —"
                  allowClear
                />
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

            {/* Log time for this appointment (only available once saved) */}
            {form.id && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                {!logTimeOpen ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setLogTimeOpen(true)}>
                    ⏱ Log time for this appointment
                  </button>
                ) : (
                  <div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Service</label>
                        <select className="form-input" value={logTimeForm.service} onChange={e => setLogTimeForm({ ...logTimeForm, service: e.target.value })}>
                          {TIMESHEET_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                          <input type="checkbox" checked={logTimeForm.billable} onChange={e => setLogTimeForm({ ...logTimeForm, billable: e.target.checked })} />
                          Billable
                        </label>
                      </div>
                      <div className="form-group full-width">
                        <label>Description (defaults to appointment title)</label>
                        <input type="text" className="form-input" value={logTimeForm.description} onChange={e => setLogTimeForm({ ...logTimeForm, description: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={handleLogTimeFromAppointment} disabled={logTimeSaving}>
                        {logTimeSaving ? 'Saving…' : 'Log time'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setLogTimeOpen(false)}>Cancel</button>
                    </div>
                    <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0' }}>
                      Duration is taken from the appointment's start and end times.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Send email notification (only on a saved appointment) */}
            {form.id && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                {!notifyOpen ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setNotifyOpen(true)}>
                    ✉ Send email notification
                  </button>
                ) : (
                  <div>
                    <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
                      Emails the meeting details to the linked client
                      {form.client_id ? '' : ' (none linked — add a recipient below)'} plus any extra recipients.
                    </p>
                    <div className="form-group">
                      <label>Additional recipients (optional)</label>
                      <input
                        type="text" className="form-input" value={notifyExtra}
                        onChange={e => setNotifyExtra(e.target.value)}
                        placeholder="extra@example.com; another@example.com"
                      />
                    </div>
                    <p style={{ fontSize: 13, margin: '8px 0 0' }}>
                      <strong>Sending to:</strong>{' '}
                      {notifyRecipients.length > 0 ? (
                        notifyRecipients.join(', ')
                      ) : (
                        <span style={{ color: '#dc2626' }}>
                          nobody — the linked client has no email on file; add a recipient above
                        </span>
                      )}
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={handleSendNotification} disabled={notifySending}>
                        {notifySending ? 'Sending…' : 'Send notification'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setNotifyOpen(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
