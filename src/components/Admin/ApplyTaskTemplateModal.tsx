import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

interface Props {
  preSelectedClientId?: number | null;
  onClose: () => void;
  onApplied?: (count: number) => void;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Modal: pick a template, pick a client (or use the pre-selected one),
// pick an apply date, optionally override assignee — then RPC creates the
// batch of staff_tasks.
export default function ApplyTaskTemplateModal({ preSelectedClientId, onClose, onApplied }: Props) {
  const { user } = useAuth();
  const { clients } = useApp();
  const [templates, setTemplates] = useState<any[]>([]);
  const [staffUsers, setStaffUsers] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [applying, setApplying] = useState(false);

  const [templateId, setTemplateId] = useState<string>('');
  const [clientId, setClientId]     = useState<string>(preSelectedClientId ? String(preSelectedClientId) : '');
  const [applyDate, setApplyDate]   = useState<string>(todayIso());
  const [assignee, setAssignee]     = useState<string>(user?.id || '');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tpls, users] = await Promise.all([api.getTaskTemplates(), api.getUsers()]);
        if (cancelled) return;
        setTemplates(tpls as any[]);
        setStaffUsers((users as any[]).filter(u => u.role !== 'client'));
      } catch (err: any) {
        alert('Failed to load templates: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleApply = async () => {
    if (!templateId) { alert('Pick a template'); return; }
    setApplying(true);
    try {
      const r = await api.applyTaskTemplate(Number(templateId), {
        client_id: clientId ? Number(clientId) : null,
        apply_date: applyDate || todayIso(),
        assignee:   assignee || null,
      });
      if (onApplied) onApplied(r.count);
      alert(`${r.count} task(s) created.`);
      onClose();
    } catch (err: any) {
      alert('Apply failed: ' + err.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        background: 'white', borderRadius: 8, padding: 20,
        width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto',
      }}>
        <h3 style={{ marginTop: 0 }}>Apply task template</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Creates a batch of tasks from a template. Each task's due date = apply date + the template item's days offset.
        </p>

        {loading ? (
          <p>Loading…</p>
        ) : templates.length === 0 ? (
          <div className="empty-state">
            <p>No templates yet. Create one on the Templates page.</p>
          </div>
        ) : (
          <>
            <div className="form-group">
              <label>Template *</label>
              <select className="form-input" value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">— Select a template —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Client (optional)</label>
              <select className="form-input" value={clientId} onChange={e => setClientId(e.target.value)} disabled={!!preSelectedClientId}>
                <option value="">— None —</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.client_code ? `${c.client_code} — ` : ''}{c.name}</option>
                ))}
              </select>
              {preSelectedClientId && (
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Pre-selected from this client's page.</p>
              )}
            </div>
            <div className="form-group">
              <label>Apply date</label>
              <input type="date" className="form-input" value={applyDate} onChange={e => setApplyDate(e.target.value)} />
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Each item's due date = this + the item's days offset.</p>
            </div>
            <div className="form-group">
              <label>Assign all tasks to (overrides per-item defaults)</label>
              <select className="form-input" value={assignee} onChange={e => setAssignee(e.target.value)}>
                <option value="">— Use per-item default —</option>
                {staffUsers.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
              </select>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={applying || loading || !templateId}>
            {applying ? 'Applying…' : 'Apply template'}
          </button>
        </div>
      </div>
    </div>
  );
}
