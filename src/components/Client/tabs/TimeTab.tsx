import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';

const BILLABLE_SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;
const INTERNAL_SERVICES = [
  'Internal Admin', 'Training', 'Annual Leave',
  'Sick Leave', 'Public Holiday', 'Other Internal',
] as const;
const ALL_SERVICES = [...BILLABLE_SERVICES, ...INTERNAL_SERVICES] as const;
type Service = typeof ALL_SERVICES[number];
const isBillableService = (s: string) => (BILLABLE_SERVICES as readonly string[]).includes(s);

type TimeEntry = {
  id: number;
  user_id: string;
  entry_date: string;
  minutes: number;
  service: Service;
  description: string | null;
  billable: boolean;
  rate_snapshot: number | null;
  approval_status: 'draft' | 'approved';
  approved_by: string | null;
  approved_at: string | null;
  billing_status: 'unbilled' | 'written_off' | 'deferred' | 'invoiced';
  write_off_reason: string | null;
  invoice_id: number | null;
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries]       = useState<TimeEntry[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  // Billing-status filter (defaults to "All")
  const [fBilling, setFBilling] = useState<string>('');

  // Bulk-selection state used by the "Mark as…" actions
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelected = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Quick log
  const [logOpen, setLogOpen] = useState(false);
  const [form, setForm]       = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    service: 'Bookkeeping' as Service,
    minutes: 60,
    description: '',
    billable: true,
  });
  const setService = (s: Service) => setForm(prev => ({
    ...prev, service: s, billable: isBillableService(s) ? prev.billable : false,
  }));

  const load = async () => {
    try {
      const [data, users] = await Promise.all([
        api.getTimeEntries({
          client_id: clientId,
          billing_status: (fBilling || undefined) as any,
        }),
        api.getUsers(),
      ]);
      setEntries(data as TimeEntry[]);
      setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
      // Drop selection of rows that aren't in the latest result
      const visibleIds = new Set((data as TimeEntry[]).map(e => e.id));
      setSelected(prev => new Set(Array.from(prev).filter(id => visibleIds.has(id))));
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
  }, [clientId, fBilling]);

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

  // Create a draft invoice for this client and pre-populate it with the
  // selected time entries as line items. Only approved+unbilled+billable
  // entries are eligible (the selection logic already enforces that).
  const handleCreateInvoiceFromSelected = async () => {
    if (selected.size === 0) { alert('No entries selected'); return; }
    const selectedRows = entries.filter(e => selected.has(e.id));
    const ineligible = selectedRows.filter(e =>
      e.approval_status !== 'approved' || e.billing_status !== 'unbilled' || !e.billable
    );
    if (ineligible.length > 0) {
      alert(`${ineligible.length} selected entr${ineligible.length === 1 ? 'y' : 'ies'} can't be invoiced (must be approved + unbilled + billable).`);
      return;
    }
    if (!confirm(`Create a draft invoice for ${selectedRows.length} time entr${selectedRows.length === 1 ? 'y' : 'ies'}?`)) return;
    try {
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const { id: invoiceId } = await api.createClientInvoice({ client_id: clientId });
      let lineNo = 1;
      for (const e of selectedRows) {
        const hours = Number(e.minutes) / 60;
        const rate  = Number(e.rate_snapshot || 0);
        await api.addInvoiceLine(invoiceId, {
          line_no:       lineNo++,
          line_type:     'time',
          description:   `${e.entry_date} · ${e.service}${e.description ? ' · ' + e.description : ''}`,
          quantity:      round2(hours),
          unit_price:    round2(rate),
          amount:        round2(hours * rate),
          vatable:       true,
          time_entry_id: e.id,
        });
      }
      navigate(`/billing/${invoiceId}`);
    } catch (err: any) {
      alert('Create invoice failed: ' + err.message);
    }
  };

  const handleBulkStatus = async (status: 'unbilled' | 'written_off' | 'deferred') => {
    if (selected.size === 0) { alert('No entries selected'); return; }
    let reason: string | undefined;
    if (status === 'written_off') {
      const r = prompt(`Reason for writing off ${selected.size} entr${selected.size === 1 ? 'y' : 'ies'}? (optional)`);
      if (r === null) return;   // user pressed Cancel
      reason = r.trim() || undefined;
    } else {
      const labels = { deferred: 'defer to a later invoice', unbilled: 'mark back to unbilled' };
      if (!confirm(`${labels[status][0].toUpperCase() + labels[status].slice(1)} for ${selected.size} entr${selected.size === 1 ? 'y' : 'ies'}?`)) return;
    }
    try {
      const n = await api.setTimeEntriesBillingStatus(Array.from(selected), status, reason);
      alert(`Updated ${n} entries.`);
      setSelected(new Set());
      await load();
    } catch (err: any) {
      alert('Update failed: ' + err.message);
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
      const byService = ALL_SERVICES.map(svc => ({
        service: svc as string,
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => {
            window.open(`/timesheet/print?client=${clientId}`, '_blank');
          }}>🖨 Print</button>
          <button className="btn btn-primary btn-sm" onClick={() => setLogOpen(o => !o)}>
            {logOpen ? 'Cancel' : '+ Log time'}
          </button>
        </div>
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
              <select className="form-input" value={form.service} onChange={e => setService(e.target.value as Service)}>
                <optgroup label="Billable (charged to client)">
                  {BILLABLE_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
                <optgroup label="Internal (not charged)">
                  {INTERNAL_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
                </optgroup>
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
                <input
                  type="checkbox"
                  checked={form.billable}
                  disabled={!isBillableService(form.service)}
                  onChange={e => setForm({ ...form, billable: e.target.checked })}
                />
                Billable
                {!isBillableService(form.service) && (
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>(internal service)</span>
                )}
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

      {/* Status filter + bulk action bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: '#475569' }}>Filter:</label>
          <select className="form-input" style={{ width: 160 }} value={fBilling} onChange={e => setFBilling(e.target.value)}>
            <option value="">All entries</option>
            <option value="unbilled">Unbilled</option>
            <option value="written_off">Written off</option>
            <option value="deferred">Deferred</option>
            <option value="invoiced">Invoiced</option>
          </select>
        </div>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
            <span style={{ fontSize: 13, color: '#475569' }}>{selected.size} selected:</span>
            <button className="btn btn-primary btn-sm" onClick={handleCreateInvoiceFromSelected}>📄 Create invoice</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkStatus('written_off')}>Write off</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkStatus('deferred')}>Defer</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkStatus('unbilled')}>Mark unbilled</button>
            <button className="btn btn-link btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <p>No time logged for this client {fBilling ? `with status "${fBilling}"` : 'yet'}.</p>
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
                      <th style={{ width: 30 }}></th>
                      <th>Date</th>
                      <th>Staff</th>
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
                    {g.rows.map(e => {
                      const v = (e.billable && e.rate_snapshot != null)
                        ? `€${((e.minutes / 60) * Number(e.rate_snapshot)).toFixed(2)}`
                        : '—';
                      const isLocked =
                        e.approval_status === 'approved' &&
                        e.approved_by !== user?.id &&
                        user?.role !== 'owner';
                      const isInvoiced = e.billing_status === 'invoiced' || e.invoice_id != null;
                      // Selectable when billable, not invoiced — these are the
                      // candidates the write-off / defer actions apply to.
                      const isSelectable = e.billable && !isInvoiced;
                      return (
                        <tr key={e.id} style={isLocked ? { background: '#f8fafc' } : undefined}>
                          <td>
                            {isSelectable && (
                              <input
                                type="checkbox"
                                checked={selected.has(e.id)}
                                onChange={() => toggleSelected(e.id)}
                              />
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{e.entry_date}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{staffName(e.user_id)}</td>
                          <td>{e.service}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatMinutes(e.minutes)}</td>
                          <td>{e.description || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                          <td>{e.billable ? '✓' : '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{v}</td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                            {e.approval_status === 'approved' && (
                              <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 4, marginRight: 4 }}>🔒</span>
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
                            {isLocked || isInvoiced ? (
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>Locked</span>
                            ) : (
                              <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e.id)}>×</button>
                            )}
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
