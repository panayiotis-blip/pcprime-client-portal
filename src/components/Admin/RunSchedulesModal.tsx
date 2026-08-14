import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

// Two-step modal for triggering the client-services scheduler.
//   Step 1 — pick date + service filter + (optional) client filter.
//            Hit Preview to see what would fire.
//   Step 2 — confirm and run, or go back and adjust.
//
// Anything already fired this month is shown greyed out so the user can
// confirm the scheduler is idempotent before committing.

type PreviewRow = {
  client_id: number;
  client_name: string;
  service_label: string;
  stage_label: string;
  scheduled_date: string;
  would_send_email: boolean;
  would_create_task: boolean;
  already_fired: boolean;
};

type ServiceDef = { id: number; key: string; label: string };

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Last day of the given month, as an ISO date. */
function monthEndIso(year: number, month: number): string {
  const d = new Date(year, month, 0); // day 0 of next month = last of this one
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RunSchedulesModal({
  onClose, onRan,
}: {
  onClose: () => void;
  onRan: (result: { created_runs: number; created_tasks: number }) => void;
}) {
  const { clients } = useApp();
  const [services, setServices] = useState<ServiceDef[]>([]);
  // One month per run, and the picker says so. It used to take a free date
  // labelled "fires stages whose computed date is ≤ this date", which was not
  // true: run_client_service_schedules reads only the year and month out of
  // p_run_date and ignores the day. A month end is passed for tidiness.
  const now = new Date();
  const [runYear, setRunYear] = useState<number>(now.getFullYear());
  const [runMonth, setRunMonth] = useState<number>(now.getMonth() + 1);
  const runDate = monthEndIso(runYear, runMonth);
  const [serviceId, setServiceId] = useState<number>(0); // 0 = All
  const [clientFilter, setClientFilter] = useState<'all' | 'pick'>('all');
  const [pickedClientIds, setPickedClientIds] = useState<Set<number>>(new Set());
  const [clientSearch, setClientSearch] = useState('');

  const [step, setStep] = useState<1 | 2>(1);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  // Shown in the modal rather than thrown at a native alert(), which blocks
  // the page until somebody clicks it — including any automation driving this
  // screen, which then looks like a hang rather than a failure.
  const [error, setError] = useState('');

  useEffect(() => {
    api.getServiceDefinitions().then(rows => setServices(rows as ServiceDef[])).catch(() => {});
  }, []);

  const handlePreview = async () => {
    setPreviewing(true);
    setError('');
    try {
      const rows = await api.previewDueServiceSchedules({
        runDate,
        serviceId: serviceId || null,
        clientIds: clientFilter === 'pick' && pickedClientIds.size > 0 ? Array.from(pickedClientIds) : null,
      });
      setPreview(rows);
      setStep(2);
    } catch (err: any) {
      setError('Preview failed: ' + (err?.message || String(err)));
    } finally {
      setPreviewing(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setError('');
    try {
      const r = await api.runDueServiceSchedules({
        runDate,
        serviceId: serviceId || null,
        clientIds: clientFilter === 'pick' && pickedClientIds.size > 0 ? Array.from(pickedClientIds) : null,
      });
      onRan(r);
      onClose();
    } catch (err: any) {
      setError('Run failed: ' + (err?.message || String(err)));
    } finally {
      setRunning(false);
    }
  };

  const toggleClient = (id: number) => {
    setPickedClientIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Search filter for the client picker (only used when clientFilter='pick').
  const filteredClients = (clients as any[])
    .filter(c => !clientSearch || (c.name || '').toLowerCase().includes(clientSearch.toLowerCase())
                              || (c.client_code || '').toLowerCase().includes(clientSearch.toLowerCase()))
    .slice(0, 200);

  const newRows = (preview || []).filter(r => !r.already_fired);
  const skippedRows = (preview || []).filter(r => r.already_fired);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 820, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h3 style={{ marginTop: 0, color: '#1a365d', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          Run client-service schedules
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>Step {step} of 2</span>
        </h3>

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
            borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {step === 1 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Generate for month</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))} className="form-input" style={{ flex: 1 }}>
                    {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
                  </select>
                  <select value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="form-input" style={{ width: 100 }}>
                    {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
                  Every stage that falls in {MONTH_NAMES[runMonth - 1]} {runYear}, whole month, whatever
                  today's date is. Due dates can still land later — each stage adds its own due-month
                  offset.
                </p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Service</label>
                <select value={serviceId} onChange={(e) => setServiceId(parseInt(e.target.value) || 0)} className="form-input" style={{ width: '100%' }}>
                  <option value={0}>All services</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
                  Restrict the run to one service (e.g. only Payroll).
                </p>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Clients</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" checked={clientFilter === 'all'} onChange={() => setClientFilter('all')} />
                  All enabled clients
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="radio" checked={clientFilter === 'pick'} onChange={() => setClientFilter('pick')} />
                  Pick specific clients ({pickedClientIds.size})
                </label>
              </div>
              {clientFilter === 'pick' && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: 8, background: '#f8fafc' }}>
                  <input type="text" placeholder="Search clients…" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} className="form-input" style={{ width: '100%', marginBottom: 6 }} />
                  <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 13 }}>
                    {filteredClients.map(c => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={pickedClientIds.has(c.id)} onChange={() => toggleClient(c.id)} />
                        <span style={{ fontFamily: 'monospace', color: '#64748b', minWidth: 80 }}>{c.client_code || '-'}</span>
                        <span>{c.name}</span>
                      </label>
                    ))}
                    {filteredClients.length === 0 && <p style={{ color: '#94a3b8' }}>No matches.</p>}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePreview} disabled={previewing}>
                {previewing ? 'Loading preview…' : 'Preview →'}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ marginBottom: 8, fontSize: 13, color: '#5a6478' }}>
              <strong>{newRows.length}</strong> new firing(s) will be created
              {skippedRows.length > 0 && (
                <> · <span style={{ color: '#94a3b8' }}>{skippedRows.length} already fired this month (will be skipped)</span></>
              )}
            </div>

            {newRows.length === 0 && skippedRows.length === 0 ? (
              <p style={{ padding: 16, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 4 }}>
                Nothing matches these filters for this date.
              </p>
            ) : (
              <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9' }}>
                    <tr style={{ color: '#475569', textAlign: 'left' }}>
                      <th style={{ padding: '6px 10px', fontWeight: 500 }}>Client</th>
                      <th style={{ padding: '6px 10px', fontWeight: 500 }}>Service · Stage</th>
                      <th style={{ padding: '6px 10px', fontWeight: 500, width: 110 }}>Date</th>
                      <th style={{ padding: '6px 10px', fontWeight: 500, width: 110, textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview || []).map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f1f5f9', opacity: r.already_fired ? 0.5 : 1 }}>
                        <td style={{ padding: '6px 10px', color: '#1a365d' }}>{r.client_name}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ color: '#64748b' }}>{r.service_label} · </span>{r.stage_label}
                        </td>
                        <td style={{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.scheduled_date}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center', fontSize: 11 }}>
                          {r.already_fired
                            ? <span style={{ color: '#94a3b8' }}>skip (done)</span>
                            : (
                              <>
                                {r.would_create_task && <span style={{ background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: 3, marginRight: 4 }}>task</span>}
                                {r.would_send_email && <span style={{ background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: 3 }}>email</span>}
                              </>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => { setStep(1); setPreview(null); }}>← Back</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={handleRun} disabled={running || newRows.length === 0}>
                  {running ? 'Running…' : `Run ${newRows.length} firing(s)`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
