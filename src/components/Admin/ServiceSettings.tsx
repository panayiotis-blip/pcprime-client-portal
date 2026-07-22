import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { PanelSkeleton } from '../ui';

// Admin page at /settings/services — supervisor-only. Lets the firm:
//   • see the service catalogue (read-only for now; row inserts are seed-time
//     migrations to keep the keys stable for the scheduler)
//   • adjust the firm-default day-of-month for each stage
//   • edit the email subject + body sent on each stage
//   • toggle whether a stage sends email / creates a task

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
  task_priority: string;
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthsLabel(active: number[] | null): string {
  if (!active || active.length === 0 || active.length === 12) return 'every month';
  return active.slice().sort((a, b) => a - b).map(m => MONTH_SHORT[m - 1] || m).join(', ');
}
type Template = {
  id: number; service_stage_id: number; subject: string; body: string;
};
type Deliverable = {
  id: number; service_id: number; ordinal: number; label: string;
  description: string | null; enabled: boolean;
};

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const MERGE_FIELDS = [
  { token: '{{client_name}}',  hint: 'The client’s display name' },
  { token: '{{month_name}}',   hint: 'e.g. "June 2026"' },
  { token: '{{period_label}}', hint: 'e.g. "Q2 2026" / "FY 2026"' },
  { token: '{{firm_name}}',    hint: 'Your firm name (Company Settings)' },
  { token: '{{firm_email}}',   hint: 'Your firm’s contact email' },
];

export default function ServiceSettings() {
  const [services, setServices] = useState<ServiceDef[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [templates, setTemplates] = useState<Record<number, Template>>({});
  const [loading, setLoading] = useState(true);
  // Master–detail: the catalogue used to render every service fully expanded,
  // which on seven services was a wall of dense tables with nothing in focus.
  // One service is shown at a time now.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingStage, setEditingStage] = useState<number | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  // "Add stage" modal — open per service via the per-service action row.
  const [addStageForServiceId, setAddStageForServiceId] = useState<number | null>(null);
  const [newStage, setNewStage] = useState({
    key: '', label: '', cadence: 'monthly', day: '', last_day: false,
    months: '', priority: 'medium', sends_email: true, creates_task: true,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [svcs, stgs, dels, tpls] = await Promise.all([
        api.getServiceDefinitions(),
        api.getServiceStages(),
        api.getServiceDeliverables(),
        api.getServiceEmailTemplates(),
      ]);
      const svcList = svcs as ServiceDef[];
      setServices(svcList);
      // Keep the current selection across reloads; fall back to the first
      // service when nothing is selected or the selected one was deleted.
      setSelectedId(prev =>
        prev != null && svcList.some(s => s.id === prev) ? prev : (svcList[0]?.id ?? null),
      );
      setStages(stgs as Stage[]);
      setDeliverables(dels as Deliverable[]);
      const tplMap: Record<number, Template> = {};
      for (const t of tpls as Template[]) tplMap[t.service_stage_id] = t;
      setTemplates(tplMap);
    } catch (err: any) {
      alert('Failed to load: ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const updateStage = async (id: number, patch: any) => {
    try {
      await api.updateServiceStage(id, patch);
      await load();
    } catch (err: any) {
      alert('Failed: ' + (err?.message || String(err)));
    }
  };

  const startEdit = (stageId: number) => {
    const t = templates[stageId];
    setDraftSubject(t?.subject || '');
    setDraftBody(t?.body || '');
    setEditingStage(stageId);
  };

  const saveTemplate = async () => {
    if (editingStage == null) return;
    setSaving(true);
    try {
      await api.upsertServiceEmailTemplate(editingStage, draftSubject, draftBody);
      await load();
      setEditingStage(null);
    } catch (err: any) {
      alert('Save failed: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const insertMergeField = (token: string) => {
    setDraftBody(b => b + token);
  };

  // ---- Catalogue management ----
  const handleAddService = async () => {
    const label = prompt('New service — display label (e.g. "Audit"):');
    if (!label || !label.trim()) return;
    const keySuggest = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const key = prompt(`Internal key (no spaces, used in code). Default:`, keySuggest);
    if (!key || !key.trim()) return;
    const description = prompt('Short description (optional):') || '';
    try {
      await api.createServiceDefinition({
        key: key.trim(), label: label.trim(),
        description: description.trim() || null,
        ordinal: (services[services.length - 1]?.ordinal ?? 0) + 10,
      });
      await load();
    } catch (err: any) {
      alert('Create failed: ' + (err?.message || String(err)));
    }
  };

  const handleRenameService = async (svc: ServiceDef) => {
    const next = prompt('New label for service:', svc.label);
    if (!next || !next.trim() || next.trim() === svc.label) return;
    try {
      await api.updateServiceDefinition(svc.id, { label: next.trim() });
      await load();
    } catch (err: any) {
      alert('Rename failed: ' + (err?.message || String(err)));
    }
  };

  const handleDeleteService = async (svc: ServiceDef) => {
    if (!confirm(
      `Delete service "${svc.label}"?\n\n` +
      `This will cascade: all its stages, email templates, deliverables, ` +
      `per-client opt-ins (client_services), date overrides, and history (service_runs) ` +
      `will be removed. Linked staff tasks lose their service_stage_id link but stay in the list.`
    )) return;
    try {
      await api.deleteServiceDefinition(svc.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || String(err)));
    }
  };

  const openAddStage = (serviceId: number) => {
    setNewStage({
      key: '', label: '', cadence: 'monthly', day: '', last_day: false,
      months: '', priority: 'medium', sends_email: true, creates_task: true,
    });
    setAddStageForServiceId(serviceId);
  };
  const handleSaveNewStage = async () => {
    if (addStageForServiceId == null) return;
    if (!newStage.key.trim() || !newStage.label.trim()) { alert('Key and label are required.'); return; }
    const activeMonths = newStage.months.trim()
      ? newStage.months.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 12)
      : null;
    try {
      await api.createServiceStage({
        service_id: addStageForServiceId,
        key: newStage.key.trim(), label: newStage.label.trim(),
        cadence: newStage.cadence,
        default_day_of_month: newStage.last_day ? null : (newStage.day === '' ? null : Number(newStage.day)),
        default_use_last_day: newStage.last_day,
        active_months: activeMonths,
        sends_email: newStage.sends_email,
        creates_task: newStage.creates_task,
        task_priority: newStage.priority,
        ordinal: (stages.filter(s => s.service_id === addStageForServiceId).length + 1) * 10,
      });
      setAddStageForServiceId(null);
      await load();
    } catch (err: any) {
      alert('Create stage failed: ' + (err?.message || String(err)));
    }
  };

  const handleDeleteStage = async (stage: Stage) => {
    if (!confirm(
      `Delete stage "${stage.label}"?\n\n` +
      `The stage and its email template will be removed. Any service_runs / client overrides ` +
      `referencing it cascade out. Linked staff tasks keep their data but lose the link.`
    )) return;
    try {
      await api.deleteServiceStage(stage.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || String(err)));
    }
  };

  // Deliverables
  const handleAddDeliverable = async (serviceId: number) => {
    const label = prompt('Deliverable label (what we do):');
    if (!label || !label.trim()) return;
    const description = prompt('Short description (optional):') || '';
    try {
      await api.createServiceDeliverable({
        service_id: serviceId,
        label: label.trim(),
        description: description.trim() || null,
        ordinal: (deliverables.filter(d => d.service_id === serviceId).length + 1) * 10,
      });
      await load();
    } catch (err: any) {
      alert('Add failed: ' + (err?.message || String(err)));
    }
  };
  const handleEditDeliverable = async (d: Deliverable) => {
    const label = prompt('Label:', d.label);
    if (label == null) return;
    if (!label.trim()) { alert('Label is required.'); return; }
    const description = prompt('Description:', d.description || '');
    if (description == null) return;
    try {
      await api.updateServiceDeliverable(d.id, {
        label: label.trim(),
        description: description.trim() || null,
      });
      await load();
    } catch (err: any) {
      alert('Update failed: ' + (err?.message || String(err)));
    }
  };
  const handleDeleteDeliverable = async (d: Deliverable) => {
    if (!confirm(`Delete deliverable "${d.label}"?`)) return;
    try {
      await api.deleteServiceDeliverable(d.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || String(err)));
    }
  };

  return (
    <div style={{ padding: '1rem 1.5rem', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={{ color: '#1a365d', margin: 0 }}>Service Settings</h2>
        <Link to="/" style={{ fontSize: 13, color: '#1e40af' }}>← Back to dashboard</Link>
      </div>
      <p style={{ color: '#5a6478', fontSize: 14 }}>
        Firm-wide defaults for each service stage. Per-client overrides are set on the client's <strong>Services</strong> tab.
        Email templates use these merge fields: <code>{`{{client_name}} {{month_name}} {{period_label}} {{firm_name}} {{firm_email}}`}</code>
      </p>

      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={handleAddService}>+ Add Service</button>
      </div>

      {loading ? <PanelSkeleton rows={8} /> : services.length === 0 ? (
        <div className="empty-state">
          <p>No services in the catalogue yet. Add the first one above.</p>
        </div>
      ) : (
      <div className="svc-layout">
        <aside className="svc-list">
          {services.map(s => {
            const nStages = stages.filter(x => x.service_id === s.id).length;
            const nDelivs = deliverables.filter(d => d.service_id === s.id).length;
            return (
              <button
                key={s.id}
                type="button"
                className={`svc-list-item ${s.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(s.id)}
              >
                <span className="svc-list-label">{s.label}</span>
                <span className="svc-list-meta">
                  {nStages === 0 ? 'No stages' : `${nStages} stage${nStages === 1 ? '' : 's'}`}
                  {' · '}
                  {nDelivs === 0 ? 'no deliverables' : `${nDelivs} deliverable${nDelivs === 1 ? '' : 's'}`}
                </span>
              </button>
            );
          })}
        </aside>

        <div className="svc-detail">
      {services.filter(s => s.id === selectedId).map(svc => {
        const stagesForSvc = stages.filter(s => s.service_id === svc.id).sort((a, b) => a.ordinal - b.ordinal);
        return (
          <div key={svc.id} style={{ marginTop: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong style={{ color: '#1a365d' }}>{svc.label}</strong>
                {svc.description && <span style={{ color: '#64748b', fontSize: 13, marginLeft: 12 }}>{svc.description}</span>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openAddStage(svc.id)}>+ Stage</button>
                <button className="btn btn-link btn-sm" onClick={() => handleRenameService(svc)}>✎ Rename</button>
                <button className="btn btn-link btn-sm" onClick={() => handleDeleteService(svc)} style={{ color: '#b91c1c' }}>✕ Delete</button>
              </div>
            </div>

            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left', background: '#fafbfc' }}>
                  <th style={{ padding: '6px 10px', fontWeight: 500 }}>Stage</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 160 }}>Fires in</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 110 }}>Default day</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 80, textAlign: 'center' }}>Last day</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 70, textAlign: 'center' }}>Email</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 70, textAlign: 'center' }}>Task</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 100 }}>Priority</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {stagesForSvc.map(stage => (
                  <tr key={stage.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', color: '#1a365d', fontWeight: 500 }}>{stage.label}</td>
                    <td style={{ padding: '8px 10px', color: '#64748b', fontSize: 12 }}>{monthsLabel(stage.active_months)}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <input
                        type="number" min={1} max={31}
                        value={stage.default_day_of_month ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Math.min(31, Math.max(1, parseInt(e.target.value) || 1));
                          updateStage(stage.id, { default_day_of_month: v });
                        }}
                        disabled={stage.default_use_last_day}
                        className="form-input" style={{ width: 80, padding: '3px 6px', fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <input
                        type="checkbox" checked={stage.default_use_last_day}
                        onChange={(e) => updateStage(stage.id, { default_use_last_day: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <input
                        type="checkbox" checked={stage.sends_email}
                        onChange={(e) => updateStage(stage.id, { sends_email: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <input
                        type="checkbox" checked={stage.creates_task}
                        onChange={(e) => updateStage(stage.id, { creates_task: e.target.checked })}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <select
                        value={stage.task_priority}
                        onChange={(e) => updateStage(stage.id, { task_priority: e.target.value })}
                        className="form-input" style={{ padding: '3px 6px', fontSize: 13 }}
                      >
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(stage.id)}>
                        {templates[stage.id] ? '✎ Edit email' : '+ Add email'}
                      </button>
                      <button className="btn btn-link btn-sm" onClick={() => handleDeleteStage(stage)} style={{ color: '#b91c1c', marginLeft: 4 }} title="Delete stage">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Deliverables panel — what we do under this service, shown
                as sub-bullets on engagement letters. */}
            <div style={{ padding: '10px 14px', borderTop: '1px solid #f1f5f9', background: '#fafbfc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 13, color: '#1a365d' }}>Deliverables</strong>
                <button className="btn btn-secondary btn-sm" onClick={() => handleAddDeliverable(svc.id)}>+ Deliverable</button>
              </div>
              {(() => {
                const delivs = deliverables.filter(d => d.service_id === svc.id);
                if (delivs.length === 0) return <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>No deliverables. Add what we do under this service so it shows up on engagement letters.</p>;
                return (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {delivs.map(d => (
                      <li key={d.id} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#1a365d' }}>{d.label}</span>
                        {d.description && <span style={{ color: '#94a3b8', fontSize: 12 }}> — {d.description}</span>}
                        <button className="btn btn-link btn-sm" onClick={() => handleEditDeliverable(d)} style={{ marginLeft: 4 }}>edit</button>
                        <button className="btn btn-link btn-sm" onClick={() => handleDeleteDeliverable(d)} style={{ color: '#b91c1c' }}>×</button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
          </div>
        );
      })}
        </div>
      </div>
      )}

      {/* Add Stage modal */}
      {addStageForServiceId != null && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setAddStageForServiceId(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 560,
          }}>
            <h3 style={{ marginTop: 0, color: '#1a365d' }}>
              + Add stage to {services.find(s => s.id === addStageForServiceId)?.label}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Display label</label>
                <input type="text" value={newStage.label} onChange={(e) => setNewStage(s => ({ ...s, label: e.target.value }))} className="form-input" placeholder="e.g. Audit info request" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Key (no spaces)</label>
                <input type="text" value={newStage.key} onChange={(e) => setNewStage(s => ({ ...s, key: e.target.value }))} className="form-input" placeholder="e.g. audit_info_request" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Cadence</label>
                <select value={newStage.cadence} onChange={(e) => setNewStage(s => ({ ...s, cadence: e.target.value }))} className="form-input">
                  <option value="monthly">monthly</option>
                  <option value="quarterly">quarterly</option>
                  <option value="annual">annual</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Active months (e.g. 7,12)</label>
                <input type="text" value={newStage.months} onChange={(e) => setNewStage(s => ({ ...s, months: e.target.value }))} className="form-input" placeholder="blank = every month" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Default day of month</label>
                <input type="number" min={1} max={31} value={newStage.day} onChange={(e) => setNewStage(s => ({ ...s, day: e.target.value }))} disabled={newStage.last_day} className="form-input" />
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
                  <input type="checkbox" checked={newStage.last_day} onChange={(e) => setNewStage(s => ({ ...s, last_day: e.target.checked }))} />
                  Use last day of month
                </label>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Task priority</label>
                <select value={newStage.priority} onChange={(e) => setNewStage(s => ({ ...s, priority: e.target.value }))} className="form-input">
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 18 }}>
                  <input type="checkbox" checked={newStage.sends_email} onChange={(e) => setNewStage(s => ({ ...s, sends_email: e.target.checked }))} />
                  Sends email
                </label>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <input type="checkbox" checked={newStage.creates_task} onChange={(e) => setNewStage(s => ({ ...s, creates_task: e.target.checked }))} />
                  Creates task
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn btn-secondary" onClick={() => setAddStageForServiceId(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveNewStage}>Create stage</button>
            </div>
          </div>
        </div>
      )}

      {/* Email template editor — modal-ish overlay */}
      {editingStage != null && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setEditingStage(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}
          >
            <h3 style={{ marginTop: 0, color: '#1a365d' }}>
              Email template — {stages.find(s => s.id === editingStage)?.label}
            </h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subject</label>
              <input
                type="text" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)}
                className="form-input" style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 6 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Body (HTML)</label>
              <textarea
                value={draftBody} onChange={(e) => setDraftBody(e.target.value)}
                className="form-input" style={{ width: '100%', minHeight: 280, fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
            <div style={{ marginBottom: 12, fontSize: 12, color: '#64748b' }}>
              Insert merge field:{' '}
              {MERGE_FIELDS.map(m => (
                <button key={m.token} type="button" onClick={() => insertMergeField(m.token)}
                  title={m.hint}
                  style={{ marginRight: 6, padding: '2px 6px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 3, background: '#f1f5f9', cursor: 'pointer', fontFamily: 'monospace' }}>
                  {m.token}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditingStage(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTemplate} disabled={saving}>
                {saving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
