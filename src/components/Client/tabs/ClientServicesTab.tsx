import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isStaffRole } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';

// Services tab on the client detail page. Lists every service in the
// catalogue with a toggle. When enabled, the per-stage rows expand so the
// user can override the day-of-month for each stage (e.g. "send payroll
// info request on the 3rd, not the 1st"). Override null = use firm default.

type ServiceDef = {
  id: number; key: string; label: string; description: string | null;
  enabled: boolean; ordinal: number;
};
type Stage = {
  id: number; service_id: number; ordinal: number; key: string; label: string;
  cadence: string;
  default_day_of_month: number | null;
  default_use_last_day: boolean;
  active_months: number[] | null;
  sends_email: boolean; creates_task: boolean;
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthsLabel(active: number[] | null): string {
  if (!active || active.length === 0) return 'every month';
  if (active.length === 12) return 'every month';
  return active.slice().sort((a, b) => a - b).map(m => MONTH_SHORT[m - 1] || m).join(', ');
}
type ClientService = {
  id: number; client_id: number; service_id: number | null; enabled: boolean;
  notes: string | null; custom_label: string | null;
};
type Override = {
  id: number; client_service_id: number; service_stage_id: number;
  day_of_month: number | null; use_last_day: boolean | null; skip: boolean;
  active_months: number[] | null;
};

// Cyprus staggered VAT quarter groups → the months a client's VAT tasks FIRE
// (the month after each period ends). Set per client so staggered quarters work.
const VAT_QUARTERS: { key: string; label: string; months: number[] }[] = [
  { key: 'g1', label: 'Group 1 — periods end Mar/Jun/Sep/Dec (due 10 May, Aug, Nov, Feb)', months: [4, 7, 10, 1] },
  { key: 'g2', label: 'Group 2 — periods end Apr/Jul/Oct/Jan (due 10 Jun, Sep, Dec, Mar)', months: [5, 8, 11, 2] },
  { key: 'g3', label: 'Group 3 — periods end May/Aug/Nov/Feb (due 10 Jul, Oct, Jan, Apr)', months: [6, 9, 12, 3] },
];
const sameMonths = (a: number[] | null | undefined, b: number[]) =>
  !!a && a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

export default function ClientServicesTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [clientServices, setClientServices] = useState<ClientService[]>([]);
  const [overrides, setOverrides] = useState<Record<number, Override[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const canEdit = isStaffRole(user);

  const load = async () => {
    setLoading(true);
    try {
      const [svcs, stgs, cs] = await Promise.all([
        api.getServiceDefinitions(),
        api.getServiceStages(),
        api.getClientServices(clientId),
      ]);
      setServices(svcs as ServiceDef[]);
      setStages(stgs as Stage[]);
      setClientServices(cs as ClientService[]);

      // Pull overrides per client_service row in parallel.
      const ovByCs: Record<number, Override[]> = {};
      await Promise.all((cs as ClientService[]).map(async (row) => {
        const ov = await api.getClientStageOverrides(row.id);
        ovByCs[row.id] = ov as Override[];
      }));
      setOverrides(ovByCs);
    } catch (err: any) {
      alert('Failed to load services: ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [clientId]);

  const handleToggle = async (serviceId: number, next: boolean) => {
    setSavingKey('svc-' + serviceId);
    try {
      await api.toggleClientService(clientId, serviceId, next);
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    } finally {
      setSavingKey(null);
    }
  };

  const handleOverride = async (cs: ClientService, stage: Stage, patch: {
    day_of_month?: number | null; use_last_day?: boolean | null; skip?: boolean;
  }) => {
    setSavingKey(`ov-${cs.id}-${stage.id}`);
    try {
      await api.upsertStageOverride(cs.id, stage.id, patch);
      // Re-pull just this row's overrides so the panel reflects the change.
      const ov = await api.getClientStageOverrides(cs.id);
      setOverrides(prev => ({ ...prev, [cs.id]: ov as Override[] }));
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    } finally {
      setSavingKey(null);
    }
  };

  // Set this client's VAT quarter group — applies the fire-months to every
  // stage of the VAT service so tasks appear in the right months.
  const handleSetVatQuarter = async (cs: ClientService, stagesForSvc: Stage[], months: number[] | null) => {
    setSavingKey('vatq-' + cs.id);
    try {
      for (const st of stagesForSvc) {
        await api.upsertStageOverride(cs.id, st.id, { active_months: months });
      }
      const ov = await api.getClientStageOverrides(cs.id);
      setOverrides(prev => ({ ...prev, [cs.id]: ov as Override[] }));
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    } finally {
      setSavingKey(null);
    }
  };

  const addCustom = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    try {
      await api.addCustomClientService(clientId, label, newNotes.trim() || null);
      setNewLabel(''); setNewNotes('');
      await load();
    } catch (err: any) {
      alert('Failed to add service: ' + (err?.message || String(err)));
    } finally {
      setAdding(false);
    }
  };

  const removeCustom = async (cs: ClientService) => {
    if (!confirm(`Remove custom service “${cs.custom_label}” from this client?`)) return;
    try { await api.deleteClientService(cs.id); await load(); }
    catch (err: any) { alert('Failed: ' + (err?.message || String(err))); }
  };

  if (loading) {
    return <div className="client-tab-content" style={{ padding: 16 }}><p>Loading services…</p></div>;
  }

  // Custom (ad-hoc) services are client_services rows with no catalogue link.
  const customServices = clientServices.filter(c => c.service_id == null);

  // Helper — find the current override for a stage (if any).
  const getOverride = (csId: number, stageId: number): Override | undefined =>
    (overrides[csId] || []).find(o => o.service_stage_id === stageId);

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Services</h3>
          {/* The catalogue is firm-wide and carries stages, cadences and email
              automation, so a service can't just be typed in here — it's
              defined once in Service Settings and then ticked per client.
              This link exists because the list otherwise reads as closed. */}
          {isStaffRole(user) && (
            <Link to="/settings/services" className="btn btn-secondary btn-sm">
              ＋ Add / edit services
            </Link>
          )}
        </div>
        <p style={{ fontSize: 13, color: '#5a6478', margin: '4px 0 16px' }}>
          Tick the services we provide to this client. Each enabled service unfolds its workflow stages
          so you can adjust dates from the firm defaults (e.g. payroll info request on a different day).
          When a stage fires, an internal task is created and an email is queued for sending.
          Need a service that isn't listed? Add it in <Link to="/settings/services">Service Settings</Link> and it
          becomes available for every client.
        </p>

        {services.map(svc => {
          const cs = clientServices.find(c => c.service_id === svc.id);
          const isOn = !!cs?.enabled;
          const stagesForSvc = stages.filter(s => s.service_id === svc.id);

          return (
            <div key={svc.id} style={{
              border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10,
              background: isOn ? '#f8fafc' : '#ffffff',
            }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', cursor: 'pointer', userSelect: 'none',
              }}>
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={(e) => handleToggle(svc.id, e.target.checked)}
                  disabled={savingKey === 'svc-' + svc.id}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#1a365d' }}>{svc.label}</div>
                  {svc.description && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{svc.description}</div>
                  )}
                </div>
                {savingKey === 'svc-' + svc.id && <span style={{ fontSize: 12, color: '#94a3b8' }}>saving…</span>}
              </label>

              {svc.key === 'vat_return' && isOn && cs && (
                <div style={{ borderTop: '1px solid #e2e8f0', padding: '10px 14px' }}>
                  <label style={{ fontSize: 12.5, fontWeight: 600, color: '#1a365d' }}>VAT quarter group</label>
                  <select
                    className="form-input"
                    style={{ maxWidth: 520, marginTop: 4 }}
                    disabled={savingKey === 'vatq-' + cs.id}
                    value={(() => {
                      const m = (overrides[cs.id] || []).find(o => o.active_months)?.active_months;
                      return VAT_QUARTERS.find(q => sameMonths(m, q.months))?.key || '';
                    })()}
                    onChange={(e) => {
                      const q = VAT_QUARTERS.find(x => x.key === e.target.value);
                      handleSetVatQuarter(cs, stagesForSvc, q ? q.months : null);
                    }}
                  >
                    <option value="">— not set (no VAT tasks will be generated) —</option>
                    {VAT_QUARTERS.map(q => <option key={q.key} value={q.key}>{q.label}</option>)}
                  </select>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
                    Sets when this client's VAT return tasks appear — the month after each period ends
                    (e.g. Group 1: Apr–Jun period → task on 1 Jul, due 10 Aug).
                  </p>
                </div>
              )}

              {isOn && cs && stagesForSvc.length > 0 && (
                <div style={{ borderTop: '1px solid #e2e8f0', padding: '8px 14px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', margin: '6px 0' }}>
                    Stages — per-client overrides
                  </div>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#64748b', textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px', fontWeight: 500 }}>Stage</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 160 }}>Fires in</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 130 }}>Firm default</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 140 }}>This client's day</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 80, textAlign: 'center' }}>Last day</th>
                        <th style={{ padding: '4px 6px', fontWeight: 500, width: 80, textAlign: 'center' }}>Skip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stagesForSvc.map(stage => {
                        const ov = getOverride(cs.id, stage.id);
                        const defaultLabel = stage.default_use_last_day
                          ? 'last day'
                          : (stage.default_day_of_month ? `day ${stage.default_day_of_month}` : '—');
                        return (
                          <tr key={stage.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px', color: ov?.skip ? '#94a3b8' : '#1a365d', textDecoration: ov?.skip ? 'line-through' : 'none' }}>
                              {stage.label}
                            </td>
                            <td style={{ padding: '6px', color: '#64748b', fontSize: 12 }}>
                              {monthsLabel(stage.active_months)}
                            </td>
                            <td style={{ padding: '6px', color: '#64748b' }}>{defaultLabel}</td>
                            <td style={{ padding: '6px' }}>
                              <input
                                type="number" min={1} max={31}
                                value={ov?.day_of_month ?? ''}
                                placeholder={String(stage.default_day_of_month ?? '')}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? null : Math.min(31, Math.max(1, parseInt(e.target.value) || 1));
                                  handleOverride(cs, stage, { day_of_month: v });
                                }}
                                disabled={!!ov?.skip || ov?.use_last_day === true}
                                className="form-input"
                                style={{ width: 90, padding: '3px 8px', fontSize: 13 }}
                              />
                            </td>
                            <td style={{ padding: '6px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={ov?.use_last_day === true}
                                onChange={(e) => handleOverride(cs, stage, { use_last_day: e.target.checked ? true : null })}
                                disabled={!!ov?.skip}
                              />
                            </td>
                            <td style={{ padding: '6px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={!!ov?.skip}
                                onChange={(e) => handleOverride(cs, stage, { skip: e.target.checked })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                    Leave the day blank to use the firm default. Tick "Last day" to fire on the month's
                    last calendar day regardless of which day it is.
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {/* Custom (ad-hoc) services — specific to this client, no automation. */}
        <div style={{ marginTop: 20, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
          <h4 style={{ margin: '0 0 4px', color: '#1a365d' }}>Custom services</h4>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            One-off services specific to this client that aren't in the catalogue. Record-only —
            no automated stages, emails or tasks. For a service with automation, add it in{' '}
            <Link to="/settings/services">Service Settings</Link> instead.
          </p>

          {customServices.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {customServices.map(cs => (
                <div key={cs.id} style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
                  padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#1a365d' }}>{cs.custom_label}</div>
                    {cs.notes && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{cs.notes}</div>}
                  </div>
                  {canEdit && (
                    <button className="btn btn-secondary btn-sm" onClick={() => removeCustom(cs)}>Remove</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <input
                className="form-input" placeholder="Service name"
                value={newLabel} onChange={e => setNewLabel(e.target.value)}
                style={{ maxWidth: 240 }}
                onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
              />
              <input
                className="form-input" placeholder="Notes (optional)"
                value={newNotes} onChange={e => setNewNotes(e.target.value)}
                style={{ maxWidth: 280 }}
                onKeyDown={e => { if (e.key === 'Enter') addCustom(); }}
              />
              <button className="btn btn-primary btn-sm" onClick={addCustom} disabled={!newLabel.trim() || adding}>
                {adding ? 'Adding…' : '＋ Add service'}
              </button>
            </div>
          ) : customServices.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>None.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
