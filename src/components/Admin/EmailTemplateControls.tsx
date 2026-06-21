import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { EMAIL_TEMPLATES, customToTemplate, fillStaticPlaceholders } from './emailTemplates';
import type { EmailTemplate, CustomTemplateRow } from './emailTemplates';

// Shared template picker + manager for the email composers. Merges the built-in
// templates with the firm's own (DB) templates, lets staff pick one to pre-fill,
// and add/edit/delete their own. Used by Bulk Email and Request Tax Info.

interface Props {
  onApply: (subject: string, body: string) => void;
  hasContent: boolean; // confirm before overwriting non-empty content
}

export default function EmailTemplateControls({ onApply, hasContent }: Props) {
  const [custom, setCustom] = useState<CustomTemplateRow[]>([]);
  const [sel, setSel] = useState('blank');
  const [manage, setManage] = useState(false);

  const load = () => api.listEmailTemplates().then((d) => setCustom(d as CustomTemplateRow[])).catch(() => {});
  useEffect(() => { load(); }, []);

  const all: EmailTemplate[] = useMemo(
    () => [...EMAIL_TEMPLATES, ...custom.map(customToTemplate)],
    [custom],
  );
  const categories = useMemo(() => Array.from(new Set(all.map((t) => t.category))), [all]);

  const pick = (id: string) => {
    setSel(id);
    const t = all.find((x) => x.id === id);
    if (!t) return;
    if (hasContent && id !== 'blank' && !window.confirm('Replace the current subject and message with this template?')) return;
    onApply(fillStaticPlaceholders(t.subject), fillStaticPlaceholders(t.body));
  };

  return (
    <div className="form-group full-width">
      <label>Email type / template</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select className="form-input" value={sel} onChange={(e) => pick(e.target.value)} style={{ flex: 1 }}>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {all.filter((t) => t.category === cat).map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setManage(true)}>Manage…</button>
      </div>
      <small style={{ color: '#64748b', fontSize: '0.78em' }}>Pick a template to pre-fill, then edit freely. Use “Manage…” to add your own.</small>

      {manage && <TemplateManager rows={custom} onClose={() => setManage(false)} onChanged={load} />}
    </div>
  );
}

function TemplateManager({ rows, onClose, onChanged }: { rows: CustomTemplateRow[]; onClose: () => void; onChanged: () => void }) {
  const blank = { id: 0, name: '', category: 'My templates', subject: '', body: '' };
  const [edit, setEdit] = useState<CustomTemplateRow>(blank);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!edit.name.trim()) { alert('Give the template a name.'); return; }
    setBusy(true);
    try {
      if (edit.id) await api.updateEmailTemplate(edit.id, { name: edit.name, category: edit.category, subject: edit.subject, body: edit.body });
      else await api.createEmailTemplate({ name: edit.name, category: edit.category, subject: edit.subject, body: edit.body });
      setEdit(blank); onChanged();
    } catch (e: any) { alert('Save failed: ' + e.message); } finally { setBusy(false); }
  };
  const del = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    try { await api.deleteEmailTemplate(id); onChanged(); if (edit.id === id) setEdit(blank); } catch (e: any) { alert(e.message); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: 24, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 20, width: '100%', maxWidth: 760 }}>
        <h3 style={{ marginTop: 0, color: '#1a365d' }}>Manage my templates</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 16 }}>
          <div>
            <button className="btn btn-link btn-sm" style={{ padding: 0 }} onClick={() => setEdit(blank)}>+ New template</button>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 6 }}>
              {rows.length === 0 ? <div style={{ padding: 10, color: '#94a3b8', fontSize: 13 }}>No custom templates yet.</div> :
                rows.map((r) => (
                  <div key={r.id} style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 13, display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
                    onClick={() => setEdit(r)}>
                    <span><strong>{r.name}</strong><br /><span style={{ color: '#94a3b8' }}>{r.category}</span></span>
                    <button onClick={(e) => { e.stopPropagation(); del(r.id); }} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="form-input" placeholder="Template name (e.g. Payroll information)" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <input className="form-input" placeholder="Category (e.g. Payroll)" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
            <input className="form-input" placeholder="Subject ({name}, {year}, {month})" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
            <textarea className="form-input" rows={8} placeholder="Message body — use {name} for the client's name" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} style={{ resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>{edit.id ? 'Save changes' : 'Add template'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
