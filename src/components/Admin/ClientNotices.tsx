import { useEffect, useMemo, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Clients → Notices. What the firm tells clients: a Tax Department deadline, a
// change of practice, an office closure. A notice is written here, published
// when it is ready, and appears in the client portal — with a record of who has
// opened it, so a deadline notice can be chased.
//
// Written advice for ONE client is not this screen: that goes on their own file
// under Reports, as "Advice / Letter", where only they can see it.

type Notice = {
  id: number; title: string; body: string | null; audience: 'all' | 'selected';
  category: string | null; file_name: string | null; storage_path: string | null;
  published_at: string | null; expires_at: string | null; created_at: string;
};

const CATEGORIES = ['Tax Department', 'VAT', 'Social Insurance', 'Practice', 'Other'];
const blank = () => ({ title: '', body: '', audience: 'all' as const, category: CATEGORIES[0], expires_at: '' });

export default function ClientNotices() {
  const { user } = useAuth();
  const { clients } = useApp();
  const canManage = isSupervisorOrHigher(user);
  const [list, setList] = useState<Notice[] | null>(null);
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);
  const [reads, setReads] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = () => {
    api.listNotices()
      .then(async (rows) => {
        setList(rows as Notice[]);
        // How many clients have opened each published notice.
        const counts: Record<number, number> = {};
        await Promise.all((rows as Notice[]).filter(n => n.published_at).map(async (n) => {
          try { counts[n.id] = (await api.getNoticeReads(n.id)).length; } catch { /* count is a nicety */ }
        }));
        setReads(counts);
      })
      .catch(() => setList([]));
  };
  useEffect(load, []);

  const realClients = useMemo(
    () => (clients as any[]).filter(c => c.client_category !== 'vendor_only'),
    [clients],
  );

  if (!canManage) return <div className="empty-state"><p>Notices are published by owners and supervisors.</p></div>;

  const publish = async (n: Notice) => {
    if (!confirm(`Publish "${n.title}"? Every client it is addressed to will see it next time they sign in.`)) return;
    setBusy(true); setNotice('');
    try { await api.saveNotice({ published_at: new Date().toISOString() }, n.id); setNotice('Published.'); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };
  const withdraw = async (n: Notice) => {
    if (!confirm(`Withdraw "${n.title}"? Clients will no longer see it. It stays here as a draft.`)) return;
    setBusy(true); setNotice('');
    try { await api.saveNotice({ published_at: null }, n.id); setNotice('Withdrawn — clients can no longer see it.'); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };
  const remove = async (n: Notice) => {
    if (!confirm(`Delete "${n.title}" for good? This cannot be undone.`)) return;
    try { await api.deleteNotice(n.id, n.storage_path); load(); }
    catch (e: any) { alert(e?.message || 'Failed'); }
  };
  const openFile = async (n: Notice) => {
    try { window.open(await api.noticeFileUrl(n.storage_path!), '_blank', 'noopener,noreferrer'); }
    catch (e: any) { alert(e?.message || 'Failed'); }
  };

  if (editing) {
    return <NoticeEditor
      notice={editing === 'new' ? null : editing}
      clients={realClients}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); load(); }}
    />;
  }

  return (
    <div className="dashboard" style={{ padding: '1rem 1.5rem' }}>
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Notices</h2>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Write a notice</button>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 16px' }}>
        What you want clients to know — a Tax Department deadline, a change at the practice. Published notices appear in the
        client portal, and you can see who has opened each one. Written advice for a single client goes on their own file,
        under <strong>Reports</strong>.
      </p>

      {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{notice}</div>}

      {list === null ? <PanelSkeleton rows={4} /> : list.length === 0 ? (
        <div className="empty-state"><p>No notices yet — write the first one above.</p></div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', background: '#f8fafc' }}>
                <th style={{ padding: '8px 12px' }}>Notice</th>
                <th style={{ padding: '8px 12px', width: 130 }}>Category</th>
                <th style={{ padding: '8px 12px', width: 120 }}>Goes to</th>
                <th style={{ padding: '8px 12px', width: 110 }}>Status</th>
                <th style={{ padding: '8px 12px', width: 90 }}>Opened</th>
                <th style={{ padding: '8px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {list.map(n => {
                const live = !!n.published_at && (!n.expires_at || new Date(n.expires_at) > new Date());
                const expired = !!n.published_at && !!n.expires_at && new Date(n.expires_at) <= new Date();
                return (
                  <tr key={n.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#1a365d' }}>{n.title}</div>
                      {n.file_name && (
                        <button className="btn btn-link btn-sm" style={{ padding: 0 }} onClick={() => openFile(n)}>📎 {n.file_name}</button>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{n.category || '—'}</td>
                    <td style={{ padding: '8px 12px' }}>{n.audience === 'all' ? 'All clients' : 'Selected'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {live ? <span style={{ color: '#166534', fontWeight: 600 }}>Published</span>
                        : expired ? <span style={{ color: '#b45309' }}>Expired</span>
                        : <span style={{ color: '#94a3b8' }}>Draft</span>}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{n.published_at ? (reads[n.id] ?? 0) : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-link btn-sm" onClick={() => setEditing(n)}>Edit</button>
                      {n.published_at
                        ? <button className="btn btn-link btn-sm" disabled={busy} onClick={() => withdraw(n)}>Withdraw</button>
                        : <button className="btn btn-link btn-sm" disabled={busy} onClick={() => publish(n)}>Publish</button>}
                      <button className="btn btn-link btn-sm" style={{ color: '#b91c1c' }} onClick={() => remove(n)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Write / edit one notice ----
function NoticeEditor({ notice, clients, onClose, onSaved }:
  { notice: Notice | null; clients: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() => notice ? {
    title: notice.title, body: notice.body || '', audience: notice.audience,
    category: notice.category || CATEGORIES[0], expires_at: notice.expires_at ? notice.expires_at.slice(0, 10) : '',
  } : blank());
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [readRows, setReadRows] = useState<Array<{ client_id: number; read_at: string }> | null>(null);

  useEffect(() => {
    if (!notice) return;
    api.getNoticeRecipients(notice.id).then(ids => setPicked(new Set(ids))).catch(() => {});
    if (notice.published_at) api.getNoticeReads(notice.id).then(setReadRows).catch(() => {});
  }, [notice]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients
      .filter(c => !q || `${c.name || ''} ${c.client_code || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .slice(0, 300);
  }, [clients, search]);

  const save = async () => {
    if (!f.title.trim()) { alert('Give the notice a title.'); return; }
    if (f.audience === 'selected' && picked.size === 0) { alert('Pick at least one client, or address it to all clients.'); return; }
    setSaving(true);
    try {
      const row: Record<string, any> = {
        title: f.title.trim(), body: f.body.trim() || null, audience: f.audience,
        category: f.category || null, expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null,
      };
      const id = await api.saveNotice(row, notice?.id);
      if (f.audience === 'selected') await api.setNoticeRecipients(id, [...picked]);
      else if (notice) await api.setNoticeRecipients(id, []);   // switched back to everyone
      if (file) {
        const path = await api.uploadNoticeFile(id, file);
        await api.saveNotice({ storage_path: path, file_name: file.name, mime_type: file.type || null }, id);
      }
      onSaved();
    } catch (e: any) { alert(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const nameOf = (id: number) => {
    const c = clients.find(x => x.id === id);
    return c ? `${c.client_code ? `[${c.client_code}] ` : ''}${c.name}` : `#${id}`;
  };

  return (
    <div className="dashboard" style={{ padding: '1rem 1.5rem' }}>
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>← Back to notices</button>
        <h2 style={{ margin: 0 }}>{notice ? 'Edit notice' : 'Write a notice'}</h2>
        {notice?.published_at && <span style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>Published — clients can see it</span>}
      </div>

      <div className="card" style={{ maxWidth: 760, marginTop: 12 }}>
        <div className="form-group">
          <label>Title</label>
          <input className="form-input" value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))}
            placeholder="e.g. Income tax return deadline — 31 July" />
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label>Category</label>
            <select className="form-input" value={f.category} onChange={e => setF(p => ({ ...p, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Stop showing after (optional)</label>
            <input type="date" className="form-input" value={f.expires_at} onChange={e => setF(p => ({ ...p, expires_at: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label>Notice</label>
          <textarea className="form-input" rows={6} value={f.body} onChange={e => setF(p => ({ ...p, body: e.target.value }))}
            placeholder="What the client needs to know, and anything they need to do." />
        </div>
        <div className="form-group">
          <label>Attachment (optional)</label>
          <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} />
          {notice?.file_name && !file && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Currently attached: {notice.file_name} — choosing a file replaces it.</div>}
        </div>

        <div className="form-group">
          <label>Goes to</label>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={f.audience === 'all'} onChange={() => setF(p => ({ ...p, audience: 'all' }))} /> All clients
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="radio" checked={f.audience === 'selected'} onChange={() => setF(p => ({ ...p, audience: 'selected' }))} /> Only the clients I pick
            </label>
          </div>
        </div>

        {f.audience === 'selected' && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginTop: 4 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{picked.size} client{picked.size === 1 ? '' : 's'} selected</div>
            <input className="form-input" placeholder="Search clients by name or code…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #f1f5f9', borderRadius: 6 }}>
              {shown.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
                  <input type="checkbox" checked={picked.has(c.id)}
                    onChange={() => setPicked(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                  <span>{c.client_code ? <span className="client-code-inline">{c.client_code}</span> : null}{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : (notice ? 'Save' : 'Save as draft')}</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {!notice && <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>Saved as a draft — publish it from the list when it is ready.</span>}
        </div>
      </div>

      {readRows && (
        <div className="card" style={{ maxWidth: 760, marginTop: 14 }}>
          <h3 style={{ marginTop: 0, fontSize: 15, color: '#1a365d' }}>Who has opened it — {readRows.length}</h3>
          {readRows.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Nobody yet.</p>
          ) : (
            <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
              {readRows.sort((a, b) => a.read_at.localeCompare(b.read_at)).map(r => (
                <div key={r.client_id} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ minWidth: 260 }}>{nameOf(r.client_id)}</span>
                  <span style={{ color: '#64748b' }}>{new Date(r.read_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
