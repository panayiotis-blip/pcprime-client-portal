import { useEffect, useState } from 'react';
import { api } from '../../../services/api';

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
  id: number; client_id: number; service_id: number; enabled: boolean; notes: string | null;
};
type Override = {
  id: number; client_service_id: number; service_stage_id: number;
  day_of_month: number | null; use_last_day: boolean | null; skip: boolean;
};

export default function ClientServicesTab({ clientId }: { clientId: number }) {
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [clientServices, setClientServices] = useState<ClientService[]>([]);
  const [overrides, setOverrides] = useState<Record<number, Override[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  if (loading) {
    return <div className="client-tab-content" style={{ padding: 16 }}><p>Loading services…</p></div>;
  }

  // Helper — find the current override for a stage (if any).
  const getOverride = (csId: number, stageId: number): Override | undefined =>
    (overrides[csId] || []).find(o => o.service_stage_id === stageId);

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Services</h3>
        <p style={{ fontSize: 13, color: '#5a6478', margin: '4px 0 16px' }}>
          Tick the services we provide to this client. Each enabled service unfolds its workflow stages
          so you can adjust dates from the firm defaults (e.g. payroll info request on a different day).
          When a stage fires, an internal task is created and an email is queued for sending.
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
      </div>
    </div>
  );
}
