import { useEffect, useMemo, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

// Billable services (charged to clients).
const BILLABLE_SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;
// Internal services (overhead, leave, training — never billed to a client).
// Picking one of these auto-clears the billable flag (the DB trigger also
// enforces this server-side).
const INTERNAL_SERVICES = [
  'Internal Admin', 'Training', 'Annual Leave',
  'Sick Leave', 'Public Holiday', 'Other Internal',
] as const;
const ALL_SERVICES = [...BILLABLE_SERVICES, ...INTERNAL_SERVICES] as const;
type Service = typeof ALL_SERVICES[number];

const isBillableService = (s: string) => (BILLABLE_SERVICES as readonly string[]).includes(s);

type ApprovalStatus = 'draft' | 'approved';
type BillingStatus = 'unbilled' | 'written_off' | 'deferred' | 'invoiced';

type TimeEntry = {
  id: number;
  user_id: string;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  entry_date: string;
  minutes: number;
  service: Service;
  description: string | null;
  billable: boolean;
  rate_snapshot: number | null;
  appointment_id: number | null;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  billing_status: BillingStatus;
  write_off_reason: string | null;
  invoice_id: number | null;
};

type ActiveTimer = {
  user_id: string;
  client_id: number | null;
  client_name: string | null;
  client_code: string | null;
  service: Service | null;
  description: string | null;
  appointment_id: number | null;
  billable: boolean;
  started_at: string;
};

// "YYYY-MM-DD" for the local-time date (avoids the UTC off-by-one near midnight)
const localDateIso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayIso = () => localDateIso(new Date());

const startOfWeek = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  // Monday as first day (matches the calendar)
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return localDateIso(d);
};

// Monday of the ISO-week containing iso (returns YYYY-MM-DD)
const mondayOf = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return localDateIso(d);
};
// Sunday (end of ISO week) of the date
const sundayOf = (iso: string) => {
  const d = new Date(mondayOf(iso) + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return localDateIso(d);
};

const formatMinutes = (m: number) => {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
};

const formatHHMMSS = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}`;
};

// Parse "1h 30m" / "1:30" / "90" into minutes
const parseDuration = (s: string): number | null => {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  // hh:mm
  const m1 = t.match(/^(\d+):(\d{1,2})$/);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]);
  // Xh Ym  or  Xh  or  Ym
  const m2 = t.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (m2 && (m2[1] || m2[2])) {
    const h = m2[1] ? parseFloat(m2[1]) : 0;
    const m = m2[2] ? parseInt(m2[2], 10) : 0;
    return Math.round(h * 60 + m);
  }
  // plain number → minutes
  const n = parseFloat(t);
  if (!isNaN(n) && n > 0) return Math.round(n);
  return null;
};

export default function Timesheet() {
  const { user } = useAuth();
  const { clients } = useApp();
  const canApprove = isSupervisorOrHigher(user);

  // 'entries' = standard timesheet view  ·  'review' = approval queue (supervisor only)
  const [mode, setMode] = useState<'entries' | 'review'>('entries');

  const [entries, setEntries]         = useState<TimeEntry[]>([]);
  const [staffUsers, setStaffUsers]   = useState<any[]>([]);
  const [timer, setTimer]             = useState<ActiveTimer | null>(null);
  const [timerNow, setTimerNow]       = useState<number>(Date.now());
  const [loading, setLoading]         = useState(true);

  // Filters — default to "me" + this week
  const [fStaff, setFStaff]     = useState<string>(user?.id || '');
  const [fClient, setFClient]   = useState<string>('');
  const [fService, setFService] = useState<string>('');
  const [fApproval, setFApproval] = useState<string>('');  // '', 'draft', 'approved'
  const [fBilling, setFBilling]   = useState<string>('');  // '', 'unbilled', 'written_off', 'deferred', 'invoiced'
  const [fFrom, setFFrom]       = useState<string>(startOfWeek());
  const [fTo, setFTo]           = useState<string>(todayIso());

  // Quick-log form
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({
    entry_date: todayIso(),
    client_id: '',
    service: 'Bookkeeping' as Service,
    duration: '1h',
    description: '',
    billable: true,
  });
  const [saving, setSaving] = useState(false);

  // When the service changes, auto-toggle billable to match (non-billable
  // services are always billable=false). Mirrored on the DB trigger.
  const setLogService = (s: Service) => {
    setLogForm(prev => ({ ...prev, service: s, billable: isBillableService(s) ? prev.billable : false }));
  };

  // Timer-start form
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerForm, setTimerForm] = useState({
    client_id: '',
    service: 'Bookkeeping' as Service,
    description: '',
    billable: true,
  });
  const setTimerService = (s: Service) => {
    setTimerForm(prev => ({ ...prev, service: s, billable: isBillableService(s) ? prev.billable : false }));
  };

  // Selection state used by the Review queue to approve specific entries
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelected = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // Clear selection when entries refresh / mode changes
  useEffect(() => { setSelected(new Set()); }, [mode, entries.length]);

  // Edit row
  const [editId, setEditId]     = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  const loadEntries = async () => {
    try {
      const params: any = {};
      if (mode === 'review') {
        // Approval queue: all draft entries across all staff (unless a staff
        // is explicitly picked in the filter).
        params.approval_status = 'draft';
        if (fStaff) params.user_id = fStaff;
      } else {
        if (fStaff)    params.user_id         = fStaff;
        if (fApproval) params.approval_status = fApproval;
        if (fBilling)  params.billing_status  = fBilling;
      }
      if (fClient)  params.client_id = Number(fClient);
      if (fService) params.service   = fService;
      if (fFrom)    params.from = fFrom;
      if (fTo)      params.to   = fTo;
      const data = await api.getTimeEntries(params);
      setEntries(data as TimeEntry[]);
    } catch (err: any) {
      alert('Failed to load time entries: ' + err.message);
    }
  };

  const loadTimer = async () => {
    try {
      const t = await api.getActiveTimer();
      setTimer(t as ActiveTimer | null);
    } catch {
      // silent — timer is non-critical
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [users] = await Promise.all([
          api.getUsers(),
          loadTimer(),
        ]);
        if (cancelled) return;
        setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
        await loadEntries();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload entries when filters or mode change
  useEffect(() => { loadEntries(); /* eslint-disable-next-line */ }, [mode, fStaff, fClient, fService, fApproval, fBilling, fFrom, fTo]);

  // Tick the live timer banner every second
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const handleStartTimer = async () => {
    try {
      await api.startTimer({
        client_id:   timerForm.client_id ? Number(timerForm.client_id) : null,
        service:     timerForm.service,
        description: timerForm.description.trim() || null,
        billable:    timerForm.billable,
      });
      await loadTimer();
      setTimerOpen(false);
      setTimerForm({ client_id: '', service: 'Bookkeeping', description: '', billable: true });
    } catch (err: any) {
      alert('Failed to start timer: ' + err.message);
    }
  };

  const handleStopTimer = async () => {
    try {
      await api.stopTimer();
      await loadTimer();
      await loadEntries();
    } catch (err: any) {
      alert('Failed to stop timer: ' + err.message);
    }
  };

  const handleCancelTimer = async () => {
    if (!confirm('Discard the running timer without saving?')) return;
    try {
      await api.cancelTimer();
      await loadTimer();
    } catch (err: any) {
      alert('Failed to cancel timer: ' + err.message);
    }
  };

  const handleSaveLog = async () => {
    const minutes = parseDuration(logForm.duration);
    if (!minutes || minutes <= 0) {
      alert('Enter a valid duration, e.g. 1h, 30m, 1h 30m, 1:30, or 90.');
      return;
    }
    if (!logForm.service) { alert('Pick a service'); return; }
    setSaving(true);
    try {
      await api.createTimeEntry({
        entry_date:  logForm.entry_date,
        minutes,
        service:     logForm.service,
        description: logForm.description.trim() || null,
        client_id:   logForm.client_id ? Number(logForm.client_id) : null,
        billable:    logForm.billable,
      });
      setLogForm({
        entry_date: todayIso(),
        client_id: '',
        service: 'Bookkeeping',
        duration: '1h',
        description: '',
        billable: true,
      });
      await loadEntries();
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this time entry?')) return;
    try {
      await api.deleteTimeEntry(id);
      await loadEntries();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const startEdit = (e: TimeEntry) => {
    setEditId(e.id);
    setEditForm({
      entry_date: e.entry_date,
      minutes: e.minutes,
      service: e.service,
      description: e.description || '',
      client_id: e.client_id ? String(e.client_id) : '',
      billable: e.billable,
    });
  };

  const saveEdit = async (id: number) => {
    try {
      await api.updateTimeEntry(id, {
        entry_date:  editForm.entry_date,
        minutes:     Number(editForm.minutes),
        service:     editForm.service,
        description: editForm.description?.trim() || null,
        client_id:   editForm.client_id ? Number(editForm.client_id) : null,
        billable:    editForm.billable,
      });
      setEditId(null);
      await loadEntries();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    }
  };

  // Look up name by user_id for display in the staff column
  const staffName = (uid: string) => staffUsers.find(u => u.id === uid)?.display_name || '—';

  // Totals across visible entries
  const totals = useMemo(() => {
    const totalMin    = entries.reduce((s, e) => s + e.minutes, 0);
    const billableMin = entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
    const value       = entries
      .filter(e => e.billable && e.rate_snapshot != null)
      .reduce((s, e) => s + (e.minutes / 60) * Number(e.rate_snapshot), 0);
    const byService = ALL_SERVICES.map(svc => ({
      service: svc,
      minutes: entries.filter(e => e.service === svc).reduce((s, e) => s + e.minutes, 0),
    })).filter(b => b.minutes > 0);
    return { totalMin, billableMin, value, byService };
  }, [entries]);

  // Timer banner display
  const timerSeconds = timer ? Math.max(0, (timerNow - new Date(timer.started_at).getTime()) / 1000) : 0;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Timesheet</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canApprove && (
            <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <button
                className={mode === 'entries' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                style={{ borderRadius: 0 }}
                onClick={() => setMode('entries')}
              >Entries</button>
              <button
                className={mode === 'review' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                style={{ borderRadius: 0 }}
                onClick={() => setMode('review')}
              >Review queue</button>
            </div>
          )}
          {mode === 'entries' && !timer && (
            <button className="btn btn-secondary" onClick={() => setTimerOpen(o => !o)}>
              ⏱ {timerOpen ? 'Cancel' : 'Start timer'}
            </button>
          )}
          {mode === 'entries' && (
            <button className="btn btn-secondary" onClick={() => {
              const q = new URLSearchParams();
              if (fStaff)    q.set('staff',    fStaff);
              if (fClient)   q.set('client',   fClient);
              if (fService)  q.set('service',  fService);
              if (fFrom)     q.set('from',     fFrom);
              if (fTo)       q.set('to',       fTo);
              window.open('/timesheet/print?' + q.toString(), '_blank');
            }}>🖨 Print</button>
          )}
          {mode === 'entries' && (
            <button className="btn btn-primary" onClick={() => setLogOpen(o => !o)}>
              + Log time
            </button>
          )}
        </div>
      </div>

      {/* Active timer banner */}
      {timer && (
        <div style={{
          background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8,
          padding: '12px 16px', marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20 }}>⏱</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 18, fontFamily: 'monospace' }}>
                {formatHHMMSS(timerSeconds)}
              </div>
              <div style={{ fontSize: 13, color: '#475569' }}>
                {timer.client_name ? `${timer.client_code ? timer.client_code + ' — ' : ''}${timer.client_name}` : 'No client'}
                {' · '}{timer.service || 'No service'}
                {timer.description ? ` · ${timer.description}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleStopTimer}>Stop &amp; save</button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancelTimer}>Discard</button>
          </div>
        </div>
      )}

      {/* Start-timer form */}
      {!timer && timerOpen && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Client</label>
              <select className="form-input" value={timerForm.client_id} onChange={e => setTimerForm({ ...timerForm, client_id: e.target.value })}>
                <option value="">— None —</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Service</label>
              <select className="form-input" value={timerForm.service} onChange={e => setTimerService(e.target.value as Service)}>
                <optgroup label="Billable (charged to client)">
                  {BILLABLE_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
                <optgroup label="Internal (not charged)">
                  {INTERNAL_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="form-group full-width">
              <label>Description (optional)</label>
              <input type="text" className="form-input" value={timerForm.description} onChange={e => setTimerForm({ ...timerForm, description: e.target.value })} placeholder="What are you working on?" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                <input type="checkbox"
                  checked={timerForm.billable}
                  disabled={!isBillableService(timerForm.service)}
                  onChange={e => setTimerForm({ ...timerForm, billable: e.target.checked })}
                />
                Billable
                {!isBillableService(timerForm.service) && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>(internal service)</span>
                )}
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleStartTimer}>Start</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTimerOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Quick-log form */}
      {logOpen && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Date</label>
              <input type="date" className="form-input" value={logForm.entry_date} onChange={e => setLogForm({ ...logForm, entry_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Client</label>
              <select className="form-input" value={logForm.client_id} onChange={e => setLogForm({ ...logForm, client_id: e.target.value })}>
                <option value="">— None —</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Service</label>
              <select className="form-input" value={logForm.service} onChange={e => setLogService(e.target.value as Service)}>
                <optgroup label="Billable (charged to client)">
                  {BILLABLE_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
                <optgroup label="Internal (not charged)">
                  {INTERNAL_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="form-group">
              <label>Duration</label>
              <input type="text" className="form-input" value={logForm.duration} onChange={e => setLogForm({ ...logForm, duration: e.target.value })} placeholder="1h 30m" />
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {['15m', '30m', '1h', '2h'].map(d => (
                  <button key={d} type="button" className="btn btn-secondary btn-sm" onClick={() => setLogForm({ ...logForm, duration: d })}>{d}</button>
                ))}
              </div>
            </div>
            <div className="form-group full-width">
              <label>Description</label>
              <input type="text" className="form-input" value={logForm.description} onChange={e => setLogForm({ ...logForm, description: e.target.value })} placeholder="What did you do?" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                <input
                  type="checkbox"
                  checked={logForm.billable}
                  disabled={!isBillableService(logForm.service)}
                  onChange={e => setLogForm({ ...logForm, billable: e.target.checked })}
                />
                Billable
                {!isBillableService(logForm.service) && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>(internal service)</span>
                )}
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveLog} disabled={saving}>
              {saving ? 'Saving…' : 'Save entry'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setLogOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="form-group">
            <label>From</label>
            <input type="date" className="form-input" value={fFrom} onChange={e => setFFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" className="form-input" value={fTo} onChange={e => setFTo(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Staff</label>
            <select className="form-input" value={fStaff} onChange={e => setFStaff(e.target.value)}>
              <option value="">All staff</option>
              {staffUsers.map(u => (
                <option key={u.id} value={u.id}>{u.display_name || u.username}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Client</label>
            <select className="form-input" value={fClient} onChange={e => setFClient(e.target.value)}>
              <option value="">All clients</option>
              {clients.map((c: any) => (
                <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Service</label>
            <select className="form-input" value={fService} onChange={e => setFService(e.target.value)}>
              <option value="">All services</option>
              <optgroup label="Billable">
                {BILLABLE_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Internal">
                {INTERNAL_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            </select>
          </div>
          {mode === 'entries' && (
            <>
              <div className="form-group">
                <label>Approval</label>
                <select className="form-input" value={fApproval} onChange={e => setFApproval(e.target.value)}>
                  <option value="">All</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved 🔒</option>
                </select>
              </div>
              <div className="form-group">
                <label>Billing</label>
                <select className="form-input" value={fBilling} onChange={e => setFBilling(e.target.value)}>
                  <option value="">All</option>
                  <option value="unbilled">Unbilled</option>
                  <option value="written_off">Written off</option>
                  <option value="deferred">Deferred</option>
                  <option value="invoiced">Invoiced</option>
                </select>
              </div>
            </>
          )}
          <div className="form-group">
            <label>&nbsp;</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => { setFFrom(startOfWeek()); setFTo(todayIso()); }}>This week</button>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                const d = new Date(); d.setDate(1);
                setFFrom(localDateIso(d)); setFTo(todayIso());
              }}>This month</button>
            </div>
          </div>
        </div>
      </div>

      {/* Totals bar (entries mode only) */}
      {mode === 'entries' && (
        <>
          <div className="stats-grid stats-grid-compact" style={{ marginBottom: 12 }}>
            <div className="stat-card stat-card-sm">
              <div className="stat-number">{formatMinutes(totals.totalMin)}</div>
              <div className="stat-label">Total time</div>
            </div>
            <div className="stat-card stat-card-sm">
              <div className="stat-number">{formatMinutes(totals.billableMin)}</div>
              <div className="stat-label">Billable</div>
            </div>
            <div className="stat-card stat-card-sm">
              <div className="stat-number">€{totals.value.toFixed(2)}</div>
              <div className="stat-label">Billable value</div>
            </div>
            <div className="stat-card stat-card-sm">
              <div className="stat-number">{entries.length}</div>
              <div className="stat-label">Entries</div>
            </div>
          </div>

          {/* Per-service breakdown */}
          {totals.byService.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
              {totals.byService.map(b => (
                <span key={b.service} style={{
                  background: '#f1f5f9', padding: '4px 10px', borderRadius: 999,
                }}>
                  {b.service}: <strong>{formatMinutes(b.minutes)}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* ===== Review queue (supervisor only) — grouped by staff + week ===== */}
      {mode === 'review' && (
        loading ? <div className="loading-screen">Loading…</div>
        : entries.length === 0 ? (
          <div className="empty-state"><p>No draft time entries to review.</p></div>
        ) : (() => {
          // Group entries by (user_id, mondayOf(entry_date))
          const groups = new Map<string, TimeEntry[]>();
          for (const e of entries) {
            const k = `${e.user_id}|${mondayOf(e.entry_date)}`;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(e);
          }
          const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
            // Most recent week first, then by staff name
            const [auid, aw] = a.split('|'); const [buid, bw] = b.split('|');
            if (bw !== aw) return bw.localeCompare(aw);
            return staffName(auid).localeCompare(staffName(buid));
          });

          const approveGroup = async (rows: TimeEntry[]) => {
            try {
              const n = await api.approveTimeEntries(rows.map(r => r.id));
              alert(`Approved ${n} entries.`);
              await loadEntries();
            } catch (err: any) {
              alert('Approve failed: ' + err.message);
            }
          };

          const approveSelectedInGroup = async (rows: TimeEntry[]) => {
            const ids = rows.filter(r => selected.has(r.id)).map(r => r.id);
            if (!ids.length) { alert('No rows selected'); return; }
            try {
              const n = await api.approveTimeEntries(ids);
              alert(`Approved ${n} entries.`);
              await loadEntries();
            } catch (err: any) {
              alert('Approve failed: ' + err.message);
            }
          };

          return (
            <div>
              {sortedKeys.map(k => {
                const rows = groups.get(k)!;
                const [uid, monday] = k.split('|');
                const sunday = sundayOf(monday);
                const totalMin = rows.reduce((s, r) => s + r.minutes, 0);
                const billable = rows.filter(r => r.billable).reduce((s, r) => s + r.minutes, 0);
                const allSelectedInGroup = rows.every(r => selected.has(r.id));
                return (
                  <div key={k} className="form-section" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong style={{ fontSize: 15 }}>{staffName(uid)}</strong>
                        {' · '}
                        <span style={{ color: '#475569' }}>Week of {monday} → {sunday}</span>
                        {' · '}
                        <span style={{ color: '#475569' }}>{formatMinutes(totalMin)} ({formatMinutes(billable)} billable)</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setSelected(prev => {
                              const next = new Set(prev);
                              if (allSelectedInGroup) {
                                rows.forEach(r => next.delete(r.id));
                              } else {
                                rows.forEach(r => next.add(r.id));
                              }
                              return next;
                            });
                          }}
                        >
                          {allSelectedInGroup ? 'Unselect all' : 'Select all'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => approveSelectedInGroup(rows)}>
                          Approve selected
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => approveGroup(rows)}>
                          ✓ Approve all in this group
                        </button>
                      </div>
                    </div>
                    <div className="export-table-wrapper" style={{ marginTop: 8 }}>
                      <table className="export-table">
                        <thead>
                          <tr>
                            <th style={{ width: 30 }}></th>
                            <th>Date</th>
                            <th>Client</th>
                            <th>Service</th>
                            <th>Duration</th>
                            <th>Description</th>
                            <th>Billable</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => (
                            <tr key={r.id}>
                              <td>
                                <input type="checkbox"
                                  checked={selected.has(r.id)}
                                  onChange={() => toggleSelected(r.id)}
                                />
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>{r.entry_date}</td>
                              <td>
                                {r.client_name
                                  ? <span>{r.client_code ? <span style={{ color: '#64748b' }}>{r.client_code} — </span> : null}{r.client_name}</span>
                                  : <span style={{ color: '#94a3b8' }}>—</span>}
                              </td>
                              <td>{r.service}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{formatMinutes(r.minutes)}</td>
                              <td>{r.description || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                              <td>{r.billable ? '✓' : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()
      )}

      {/* ===== Entries table (default mode) ===== */}
      {mode === 'entries' && (
        loading ? (
          <div className="loading-screen">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <p>No time entries match the current filters.</p>
          </div>
        ) : (
          <div className="export-table-wrapper">
            <table className="export-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Staff</th>
                  <th>Client</th>
                  <th>Service</th>
                  <th>Duration</th>
                  <th>Description</th>
                  <th>Billable</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const isEditing = editId === e.id;
                  // Lock logic mirrors the RLS policy: approved rows are read-only
                  // unless current user is the approver, or an owner.
                  const isLocked =
                    e.approval_status === 'approved' &&
                    e.approved_by !== user?.id &&
                    user?.role !== 'owner';
                  const value = (e.billable && e.rate_snapshot != null)
                    ? `€${((e.minutes / 60) * Number(e.rate_snapshot)).toFixed(2)}`
                    : '—';
                  return (
                    <tr key={e.id} style={isLocked ? { background: '#f8fafc' } : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <input type="date" className="form-input" value={editForm.entry_date} onChange={ev => setEditForm({ ...editForm, entry_date: ev.target.value })} />
                        ) : e.entry_date}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{staffName(e.user_id)}</td>
                      <td>
                        {isEditing ? (
                          <select className="form-input" value={editForm.client_id} onChange={ev => setEditForm({ ...editForm, client_id: ev.target.value })}>
                            <option value="">— None —</option>
                            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.client_code ? c.client_code + ' — ' : ''}{c.name}</option>)}
                          </select>
                        ) : (
                          e.client_name
                            ? <span>{e.client_code ? <span style={{ color: '#64748b' }}>{e.client_code} — </span> : null}{e.client_name}</span>
                            : <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <select className="form-input" value={editForm.service} onChange={ev => setEditForm({ ...editForm, service: ev.target.value })}>
                            <optgroup label="Billable">{BILLABLE_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                            <optgroup label="Internal">{INTERNAL_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
                          </select>
                        ) : e.service}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <input type="text" className="form-input" style={{ width: 80 }}
                            value={editForm.minutes}
                            onChange={ev => setEditForm({ ...editForm, minutes: ev.target.value })}
                            placeholder="minutes"
                          />
                        ) : formatMinutes(e.minutes)}
                      </td>
                      <td>
                        {isEditing ? (
                          <input type="text" className="form-input" value={editForm.description} onChange={ev => setEditForm({ ...editForm, description: ev.target.value })} />
                        ) : (e.description || <span style={{ color: '#94a3b8' }}>—</span>)}
                      </td>
                      <td>
                        {isEditing ? (
                          <input type="checkbox" checked={editForm.billable} onChange={ev => setEditForm({ ...editForm, billable: ev.target.checked })} />
                        ) : (e.billable ? '✓' : '—')}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{value}</td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                        {e.approval_status === 'approved' && (
                          <span title={`Approved by ${staffName(e.approved_by || '')}${e.approved_at ? ' on ' + new Date(e.approved_at).toLocaleDateString() : ''}`} style={{
                            background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 4, marginRight: 4,
                          }}>🔒 Approved</span>
                        )}
                        {e.billing_status === 'written_off' && (
                          <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 4 }}>Written off</span>
                        )}
                        {e.billing_status === 'deferred' && (
                          <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 4 }}>Deferred</span>
                        )}
                        {e.billing_status === 'invoiced' && (
                          <span style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: 4 }}>Invoiced</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-primary btn-sm" onClick={() => saveEdit(e.id)}>Save</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                          </div>
                        ) : isLocked ? (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>Locked</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => startEdit(e)}>Edit</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e.id)}>×</button>
                            {canApprove && e.approval_status === 'approved' && (
                              <button
                                className="btn btn-secondary btn-sm"
                                title="Unlock this approved entry"
                                onClick={async () => {
                                  if (!confirm('Unlock this approved entry so it can be edited?')) return;
                                  try {
                                    await api.unlockTimeEntries([e.id]);
                                    await loadEntries();
                                  } catch (err: any) { alert('Unlock failed: ' + err.message); }
                                }}
                              >Unlock</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
