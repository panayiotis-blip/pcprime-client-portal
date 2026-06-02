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

// Storage folder names — master list of system folders every client gets.
// v2 (migration 092) supports add + delete (safety checks DB-side) in
// addition to v1's rename + active toggle. category_key stays fixed.
export default function FolderTemplates() {
  const { user } = useAuth();
  const canEdit = !!user && (user.role === 'owner' || user.role === 'supervisor');
  const [rows, setRows]       = useState<Tpl[]>([]);
  const [drafts, setDrafts]   = useState<Record<number, string>>({});
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // "Add folder" form
  const [adding, setAdding]     = useState(false);
  const [newName, setNewName]   = useState('');
  const [newParent, setNewParent] = useState<string>(''); // '' = top-level
  const [addBusy, setAddBusy]   = useState(false);

  const load = async () => {
    try { setRows(await api.getFolderTemplates() as Tpl[]); }
    catch (err: any) { alert('Failed to load: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setDraft = (id: number, v: string) => setDrafts(d => ({ ...d, [id]: v }));

  const save = async (t: Tpl) => {
    const name = (drafts[t.id] ?? t.name).trim();
    if (!name || name === t.name) return;
    setBusyId(t.id);
    try {
      await api.renameFolderTemplate(t.id, name);
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

  const remove = async (t: Tpl) => {
    if (!confirm(`Delete "${t.name}" from every client?\n\nBlocked if any file is filed there or if a Document Category targets it.`)) return;
    setBusyId(t.id);
    try { await api.deleteFolderTemplate(t.id); await load(); }
    catch (err: any) { alert(err.message); }
    finally { setBusyId(null); }
  };

  const submitAdd = async () => {
    const name = newName.trim();
    if (!name) { alert('Name is empty.'); return; }
    setAddBusy(true);
    try {
      await api.addFolderTemplate(name, newParent || null, 999);
      setNewName(''); setNewParent(''); setAdding(false);
      await load();
    } catch (err: any) { alert(err.message); }
    finally { setAddBusy(false); }
  };

  const top   = rows.filter(r => !r.parent_key);
  const subOf = (k: string) => rows.filter(r => r.parent_key === k);

  return (
    <CollapsibleSection title="Storage folder names">
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Master list of the system folders every client has under <strong>Documents</strong>.
        Renaming or adding here propagates to every client immediately. Deleting
        is blocked if a file is filed there or a Document Category points at it.
      </p>

      {canEdit && (
        <div style={{ marginBottom: 12 }}>
          {!adding ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add folder</button>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 10, border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc' }}>
              <input
                className="form-input"
                placeholder="New folder name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ flex: 1, minWidth: 180 }}
                disabled={addBusy}
              />
              <select className="form-input" value={newParent} onChange={e => setNewParent(e.target.value)} disabled={addBusy} style={{ minWidth: 180 }}>
                <option value="">Top-level (no parent)</option>
                {top.map(t => (
                  <option key={t.category_key} value={t.category_key}>↳ inside "{t.name}"</option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={submitAdd} disabled={addBusy || !newName.trim()}>{addBusy ? '…' : 'Add'}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(false); setNewName(''); setNewParent(''); }} disabled={addBusy}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : rows.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>The folder_template table is empty — run migration 091.</p>
      ) : (
        <table className="export-table">
          <thead><tr><th>Folder</th><th>Internal key</th><th style={{ textAlign: 'center' }}>Active</th><th></th></tr></thead>
          <tbody>
            {top.map(t => (
              <FolderRow
                key={t.id} t={t}
                drafts={drafts} setDraft={setDraft}
                save={save} toggleActive={toggleActive} remove={remove}
                busy={busyId === t.id} canEdit={canEdit} indent={0}
                subs={subOf(t.category_key)}
                busyId={busyId}
              />
            ))}
          </tbody>
        </table>
      )}
    </CollapsibleSection>
  );
}

function FolderRow({ t, drafts, setDraft, save, toggleActive, remove, busy, canEdit, indent, subs, busyId }: any) {
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
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn btn-primary btn-sm" disabled={!canEdit || busy || !dirty} onClick={() => save(t)}>{busy ? '…' : 'Save'}</button>
          {' '}
          <button className="btn btn-secondary btn-sm" style={{ color: '#b91c1c' }} disabled={!canEdit || busy} onClick={() => remove(t)} title="Delete">🗑</button>
        </td>
      </tr>
      {subs.map((s: Tpl) => (
        <FolderRow
          key={s.id} t={s}
          drafts={drafts} setDraft={setDraft}
          save={save} toggleActive={toggleActive} remove={remove}
          busy={busyId === s.id} canEdit={canEdit} indent={indent + 1}
          subs={[]}
          busyId={busyId}
        />
      ))}
    </>
  );
}
