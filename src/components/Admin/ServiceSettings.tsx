import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

// Admin page at /settings/services — supervisor-only. Lets the firm:
//   • see the service catalogue (read-only for now; row inserts are seed-time
//     migrations to keep the keys stable for the scheduler)
//   • adjust the firm-default day-of-month for each stage
//   • edit the email subject + body sent on each stage
//   • toggle whether a stage sends email / creates a task

type ServiceDef = {
  id: number; key: string; label: string; description: string | null; enabled: boolean;
};
type Stage = {
  id: number; service_id: number; ordinal: number; key: string; label: string;
  cadence: string;
  default_day_of_month: number | null;
  default_use_last_day: boolean;
  sends_email: boolean; creates_task: boolean;
  task_priority: string;
};
type Template = {
  id: number; service_stage_id: number; subject: string; body: string;
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
  const [templates, setTemplates] = useState<Record<number, Template>>({});
  const [loading, setLoading] = useState(true);
  const [editingStage, setEditingStage] = useState<number | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [svcs, stgs, tpls] = await Promise.all([
        api.getServiceDefinitions(),
        api.getServiceStages(),
        api.getServiceEmailTemplates(),
      ]);
      setServices(svcs as ServiceDef[]);
      setStages(stgs as Stage[]);
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

  return (
    <div style={{ padding: '1rem 1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={{ color: '#1a365d', margin: 0 }}>Service Settings</h2>
        <Link to="/" style={{ fontSize: 13, color: '#1e40af' }}>← Back to dashboard</Link>
      </div>
      <p style={{ color: '#5a6478', fontSize: 14 }}>
        Firm-wide defaults for each service stage. Per-client overrides are set on the client's <strong>Services</strong> tab.
        Email templates use these merge fields: <code>{`{{client_name}} {{month_name}} {{period_label}} {{firm_name}} {{firm_email}}`}</code>
      </p>

      {loading ? <p>Loading…</p> : services.map(svc => {
        const stagesForSvc = stages.filter(s => s.service_id === svc.id).sort((a, b) => a.ordinal - b.ordinal);
        return (
          <div key={svc.id} style={{ marginTop: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
              <strong style={{ color: '#1a365d' }}>{svc.label}</strong>
              {svc.description && <span style={{ color: '#64748b', fontSize: 13, marginLeft: 12 }}>{svc.description}</span>}
            </div>

            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left', background: '#fafbfc' }}>
                  <th style={{ padding: '6px 10px', fontWeight: 500 }}>Stage</th>
                  <th style={{ padding: '6px 10px', fontWeight: 500, width: 100 }}>Cadence</th>
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
                    <td style={{ padding: '8px 10px', color: '#64748b', textTransform: 'capitalize' }}>{stage.cadence}</td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

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
