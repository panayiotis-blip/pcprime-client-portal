import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../services/api';

const SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;
type Service = typeof SERVICES[number];

type TimeEntry = {
  id: number;
  user_id: string;
  entry_date: string;
  minutes: number;
  service: Service;
  description: string | null;
  billable: boolean;
  rate_snapshot: number | null;
};

const formatMinutes = (m: number) => {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
};

// "2026-05" key for monthly grouping
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

export default function TimeTab({ clientId, clientName }: { clientId: number; clientName?: string }) {
  const [entries, setEntries]       = useState<TimeEntry[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  // Quick log
  const [logOpen, setLogOpen] = useState(false);
  const [form, setForm]       = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    service: 'Bookkeeping' as Service,
    minutes: 60,
    description: '',
    billable: true,
  });

  const load = async () => {
    try {
      const [data, users] = await Promise.all([
        api.getTimeEntries({ client_id: clientId }),
        api.getUsers(),
      ]);
      setEntries(data as TimeEntry[]);
      setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
    } catch (err: any) {
      alert('Failed to load time entries: ' + err.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const handleSave = async () => {
    if (!form.minutes || form.minutes <= 0) { alert('Enter a duration > 0 minutes'); return; }
    setSaving(true);
    try {
      await api.createTimeEntry({
        client_id:   clientId,
        entry_date:  form.entry_date,
        minutes:     Number(form.minutes),
        service:     form.service,
        description: form.description.trim() || null,
        billable:    form.billable,
      });
      setForm({
        entry_date: new Date().toISOString().slice(0, 10),
        service: 'Bookkeeping',
        minutes: 60,
        description: '',
        billable: true,
      });
      setLogOpen(false);
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this time entry?')) return;
    try {
      await api.deleteTimeEntry(id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const staffName = (uid: string) => staffUsers.find(u => u.id === uid)?.display_name || '—';

  // Group by month, then compute per-service totals
  const grouped = useMemo(() => {
    const byMonth = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const k = monthKey(e.entry_date);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k)!.push(e);
    }
    return Array.from(byMonth.entries()).map(([key, rows]) => {
      const totalMin    = rows.reduce((s, e) => s + e.minutes, 0);
      const billableMin = rows.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
      const value       = rows
        .filter(e => e.billable && e.rate_snapshot != null)
        .reduce((s, e) => s + (e.minutes / 60) * Number(e.rate_snapshot), 0);
      const byService = SERVICES.map(svc => ({
        service: svc,
        minutes: rows.filter(e => e.service === svc).reduce((s, e) => s + e.minutes, 0),
      })).filter(b => b.minutes > 0);
      return { key, rows, totalMin, billableMin, value, byService };
    });
  }, [entries]);

  const grandTotal    = entries.reduce((s, e) => s + e.minutes, 0);
  const grandBillable = entries.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
  const grandValue    = entries
    .filter(e => e.billable && e.rate_snapshot != null)
    .reduce((s, e) => s + (e.minutes / 60) * Number(e.rate_snapshot), 0);

  return (
    <div className="client-tab-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Time logged on {clientName || 'this client'}</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(o => !o)}>
          {logOpen ? 'Cancel' : '+ Log time'}
        </button>
      </div>

      {/* Grand totals */}
      <div className="stats-grid stats-grid-compact" style={{ marginBottom: 12 }}>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{formatMinutes(grandTotal)}</div>
          <div className="stat-label">Total time</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{formatMinutes(grandBillable)}</div>
          <div className="stat-label">Billable</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">€{grandValue.toFixed(2)}</div>
          <div className="stat-label">Billable value</div>
        </div>
        <div className="stat-card stat-card-sm">
          <div className="stat-number">{entries.length}</div>
          <div className="stat-label">Entries</div>
        </div>
      </div>

      {logOpen && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Date</label>
              <input type="date" className="form-input" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Service</label>
              <select className="form-input" value={form.service} onChange={e => setForm({ ...form, service: e.target.value as Service })}>
                {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Minutes</label>
              <input type="number" className="form-input" value={form.minutes} min={1} onChange={e => setForm({ ...form, minutes: Number(e.target.value) })} />
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {[15, 30, 60, 120].map(m => (
                  <button key={m} type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, minutes: m })}>{formatMinutes(m)}</button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
                <input type="checkbox" checked={form.billable} onChange={e => setForm({ ...form, billable: e.target.checked })} />
                Billable
              </label>
            </div>
            <div className="form-group full-width">
              <label>Description</label>
              <input type="text" className="form-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What did you do?" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save entry'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setLogOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <p>No time logged for this client yet.</p>
        </div>
      ) : (
        <div>
          {grouped.map(g => (
            <div key={g.key} className="form-section" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ margin: '0 0 8px' }}>{monthLabel(g.key)}</h4>
                <div style={{ fontSize: 13, color: '#475569' }}>
                  <strong>{formatMinutes(g.totalMin)}</strong>{' · '}
                  Billable: <strong>{formatMinutes(g.billableMin)}</strong>{' · '}
                  Value: <strong>€{g.value.toFixed(2)}</strong>
                </div>
              </div>
              {g.byService.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
                  {g.byService.map(b => (
                    <span key={b.service} style={{
                      background: '#f1f5f9', padding: '2px 8px', borderRadius: 999,
                    }}>
                      {b.service}: <strong>{formatMinutes(b.minutes)}</strong>
                    </span>
                  ))}
                </div>
              )}
              <div className="export-table-wrapper">
                <table className="export-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Staff</th>
                      <th>Service</th>
                      <th>Duration</th>
                      <th>Description</th>
                      <th>Billable</th>
                      <th>Value</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(e => {
                      const v = (e.billable && e.rate_snapshot != null)
                        ? `€${((e.minutes / 60) * Number(e.rate_snapshot)).toFixed(2)}`
                        : '—';
                      return (
                        <tr key={e.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{staffName(e.user_id)}</td>
                          <td>{e.service}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatMinutes(e.minutes)}</td>
                          <td>{e.description || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                          <td>{e.billable ? '✓' : '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{v}</td>
                          <td>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e.id)}>×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
