import { useEffect, useState } from 'react';
import { api, type TimesheetService } from '../../services/api';

// The services people book time against. Until migration 185 this was a CHECK
// constraint copied into four React files, so adding one meant a migration and
// a deploy — and the copies had already drifted apart.
//
// Billable services carry an hourly rate and can be charged to a client.
// Non-billable ones — leave, training, office admin — are recorded the same way
// so the day adds up, but never reach an invoice and have no rate.
//
// Renaming is safe: the label is the key with ON UPDATE CASCADE behind it, so
// every historic entry follows the new name instead of being orphaned.
export default function TimesheetServicesEditor({
  rateInputs, setRateInputs, canEdit, editing,
}: {
  rateInputs: Record<string, string>;
  setRateInputs: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  canEdit: boolean;
  editing: boolean;
}) {
  const [rows, setRows] = useState<TimesheetService[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newBillable, setNewBillable] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.listTimesheetServices({ includeInactive: true })); }
    catch (e: any) { alert('Could not load services: ' + e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const label = newLabel.trim();
    if (!label) return;
    if (rows.some(r => r.label.toLowerCase() === label.toLowerCase())) {
      alert('There is already a service with that name.'); return;
    }
    setBusy(true);
    try {
      const maxOrd = rows.filter(r => r.billable === newBillable).reduce((m, r) => Math.max(m, r.ordinal), 0);
      await api.createTimesheetService({ label, billable: newBillable, ordinal: maxOrd + 10 });
      setNewLabel(''); await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const patch = async (label: string, p: Partial<TimesheetService>) => {
    setBusy(true);
    try { await api.updateTimesheetService(label, p); await load(); }
    catch (e: any) { alert(e.message); await load(); } finally { setBusy(false); }
  };

  const rename = async (row: TimesheetService) => {
    const next = prompt(
      `Rename "${row.label}" to:\n\nEvery time entry recorded against it follows the new name.`,
      row.label,
    );
    if (next === null) return;
    const label = next.trim();
    if (!label || label === row.label) return;
    if (rows.some(r => r.label.toLowerCase() === label.toLowerCase())) {
      alert('There is already a service with that name.'); return;
    }
    setBusy(true);
    try {
      await api.updateTimesheetService(row.label, { label });
      // The rate map is keyed by name, so it has to follow the rename too.
      setRateInputs(prev => {
        const nextMap = { ...prev };
        if (row.label in nextMap) { nextMap[label] = nextMap[row.label]; delete nextMap[row.label]; }
        return nextMap;
      });
      await load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const remove = async (row: TimesheetService) => {
    if (!confirm(`Delete "${row.label}"?\n\nOnly possible if no time has ever been booked to it. Otherwise retire it by unticking "In use".`)) return;
    setBusy(true);
    try { await api.deleteTimesheetService(row.label); await load(); }
    catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  if (loading) return <p style={{ color: '#64748b' }}>Loading services…</p>;

  const disabled = !canEdit || !editing || busy;
  const billable = rows.filter(r => r.billable);
  const internal = rows.filter(r => !r.billable);

  const table = (list: TimesheetService[], showRate: boolean) => (
    <table className="data-table" style={{ width: '100%', marginBottom: 8 }}>
      <thead>
        <tr>
          <th>Service</th>
          {showRate && <th style={{ width: 130 }}>Rate (€/hour)</th>}
          <th style={{ width: 80 }}>In use</th>
          <th style={{ width: 150 }}></th>
        </tr>
      </thead>
      <tbody>
        {list.map(r => (
          <tr key={r.label} style={r.active ? undefined : { opacity: 0.55 }}>
            <td>{r.label}</td>
            {showRate && (
              <td>
                <input
                  type="number" step="0.01" min="0" className="form-input"
                  value={rateInputs[r.label] ?? ''}
                  onChange={e => setRateInputs(prev => ({ ...prev, [r.label]: e.target.value }))}
                  disabled={!canEdit || !editing}
                  placeholder="—"
                />
              </td>
            )}
            <td>
              <input
                type="checkbox" checked={r.active} disabled={disabled}
                onChange={e => patch(r.label, { active: e.target.checked })}
                title={r.active ? 'Showing in the timesheet picker' : 'Retired — hidden from the picker, past entries unchanged'}
              />
            </td>
            <td>
              <button className="btn btn-sm btn-secondary" disabled={disabled} onClick={() => rename(r)}>Rename</button>{' '}
              <button className="btn btn-sm btn-secondary" disabled={disabled} onClick={() => remove(r)}>Delete</button>
            </td>
          </tr>
        ))}
        {!list.length && <tr><td colSpan={showRate ? 4 : 3} style={{ color: '#64748b' }}>None yet.</td></tr>}
      </tbody>
    </table>
  );

  return (
    <>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Rates apply to every staff member unless overridden on the Users page. Leave a rate
        blank to skip it. New time entries snapshot the rate as they are saved, so historical
        figures don't move when you change one here.
      </p>

      <h4 style={{ margin: '12px 0 4px' }}>Billable</h4>
      {table(billable, true)}

      <h4 style={{ margin: '16px 0 4px' }}>Non-billable — internal &amp; office</h4>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 6px' }}>
        Recorded so the working day adds up, never charged to a client, so no rate.
      </p>
      {table(internal, false)}

      {canEdit && editing && (
        <div className="form-row" style={{ alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Add a service</label>
            <input
              className="form-input" value={newLabel} placeholder="e.g. Advisory"
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            />
          </div>
          <div className="form-group">
            <label>
              <input type="checkbox" checked={newBillable} onChange={e => setNewBillable(e.target.checked)} />{' '}
              Billable
            </label>
          </div>
          <button className="btn btn-secondary" onClick={add} disabled={busy || !newLabel.trim()}>Add</button>
        </div>
      )}
      <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
        Changes to the list itself save immediately. Rates save with the <b>Save</b> button at the top.
      </p>
    </>
  );
}
