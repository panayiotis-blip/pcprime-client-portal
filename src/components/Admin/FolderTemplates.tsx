import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import CollapsibleSection from './CollapsibleSection';

type Tpl = {
  id: number;
  category_key: string;
  name: string;
  parent_key: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
};

// Storage folder names — the master list of system folders each client gets.
// Renaming a row updates every existing client's matching folder in one step.
// The internal `category_key` is fixed (it drives storage paths + code
// lookups), so this is rename + active-toggle only.
export default function FolderTemplates() {
  const { user } = useAuth();
  const canEdit = !!user && (user.role === 'owner' || user.role === 'supervisor');
  const [rows, setRows]       = useState<Tpl[]>([]);
  const [drafts, setDrafts]   = useState<Record<number, string>>({});
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setRows(await api.getFolderTemplates() as Tpl[]); }
    catch (err: any) { alert('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setDraft = (id: number, v: string) => setDrafts(d => ({ ...d, [id]: v }));

  const save = async (t: Tpl) => {
    const newName = (drafts[t.id] ?? t.name).trim();
    if (!newName || newName === t.name) return;
    setBusyId(t.id);
    try {
      await api.renameFolderTemplate(t.id, newName);
      await load();
      setDrafts(d => { const { [t.id]: _, ...rest } = d; return rest; });
    } catch (err: any) { alert('Save failed: ' + err.message); }
    finally { setBusyId(null); }
  };

  const toggleActive = async (t: Tpl) => {
    setBusyId(t.id);
    try { await api.setFolderTemplateActive(t.id, !t.is_active); await load(); }
    catch (err: any) { alert(err.message); }
    finally { setBusyId(null); }
  };

  const top   = rows.filter(r => !r.parent_key);
  const subOf = (k: string) => rows.filter(r => r.parent_key === k);

  return (
    <CollapsibleSection title="Storage folder names">
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Master list of the system folders every client has under <strong>Documents</strong>.
        Renaming here propagates to every client immediately. The internal key
        and storage paths don't change — only the display name. Hiding a folder
        only affects <em>new</em> clients (existing folders stay).
      </p>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>The folder_template table is empty — run migration 091.</p>
      ) : (
        <table className="export-table">
          <thead><tr><th>Folder</th><th>Internal key</th><th style={{ textAlign: 'center' }}>Active</th><th></th></tr></thead>
          <tbody>
            {top.map(t => (
              <FolderRow key={t.id} t={t} drafts={drafts} setDraft={setDraft} save={save} toggleActive={toggleActive} busy={busyId === t.id} canEdit={canEdit} indent={0} subs={subOf(t.category_key)} subDrafts={drafts} />
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleSection>
  );
}

function FolderRow({ t, drafts, setDraft, save, toggleActive, busy, canEdit, indent, subs }: any) {
  const draft = drafts[t.id] ?? t.name;
  const dirty = draft.trim() !== t.name && draft.trim() !== '';
  return (
    <>
      <tr>
        <td style={{ paddingLeft: 8 + indent * 24 }}>
          <input type="text" className="form-input" value={draft} onChange={e => setDraft(t.id, e.target.value)} disabled={!canEdit || busy} style={{ width: '100%', maxWidth: 360 }} />
        </td>
        <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{t.category_key}</td>
        <td style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={t.is_active} onChange={() => toggleActive(t)} disabled={!canEdit || busy} />
        </td>
        <td style={{ textAlign: 'right' }}>
          <button className="btn btn-primary btn-sm" disabled={!canEdit || busy || !dirty} onClick={() => save(t)}>{busy ? '…' : 'Save'}</button>
        </td>
      </tr>
      {subs.map((s: Tpl) => (
        <FolderRow key={s.id} t={s} drafts={drafts} setDraft={setDraft} save={save} toggleActive={toggleActive} busy={busy} canEdit={canEdit} indent={indent + 1} subs={[]} />
      ))}
    </>
  );
}
