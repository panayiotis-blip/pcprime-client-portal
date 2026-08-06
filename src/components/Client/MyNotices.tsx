import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// What the client sees: notices the firm has published to them. Opening one
// records that they saw it, so the firm can tell who still needs chasing on a
// deadline — recorded once, on first open, not as a running count.
//
// Written advice for this client alone is not here: that arrives as a document
// under Reports, where only they can reach it.

type Notice = {
  id: number; title: string; body: string | null; category: string | null;
  file_name: string | null; storage_path: string | null; published_at: string;
};

export default function MyNotices() {
  const { user } = useAuth();
  const clientId = (user as any)?.client_id as number | undefined;
  const [list, setList] = useState<Notice[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getMyNotices()
      .then(rows => setList(rows as Notice[]))
      .catch(e => { setErr(e?.message || 'Could not load notices.'); setList([]); });
  }, []);

  // Opening it is the receipt. Failing to record one must not stop them reading.
  const toggle = async (n: Notice) => {
    const opening = open !== n.id;
    setOpen(opening ? n.id : null);
    if (opening && clientId && !seen.has(n.id)) {
      setSeen(s => new Set(s).add(n.id));
      try { await api.markNoticeRead(n.id, clientId); } catch { /* reading matters more */ }
    }
  };

  const openFile = async (n: Notice) => {
    try { window.open(await api.noticeFileUrl(n.storage_path!), '_blank', 'noopener,noreferrer'); }
    catch (e: any) { alert(e?.message || 'Could not open the attachment.'); }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>Notices</h2></div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 14px' }}>
        Announcements from your accountant — deadlines, changes, anything you should know.
      </p>

      {err && <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>}
      {list === null ? <PanelSkeleton rows={3} /> : list.length === 0 ? (
        <div className="empty-state"><p>Nothing at the moment.</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map(n => (
            <div key={n.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <button onClick={() => toggle(n)}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>📢</span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, color: '#1a365d' }}>{n.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#94a3b8' }}>
                    {n.category ? n.category + ' · ' : ''}{new Date(n.published_at).toLocaleDateString()}
                  </span>
                </span>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>{open === n.id ? '▾' : '▸'}</span>
              </button>
              {open === n.id && (
                <div style={{ padding: '0 14px 14px 42px', fontSize: 13.5, color: '#334155', lineHeight: 1.65 }}>
                  {n.body && <div style={{ whiteSpace: 'pre-line' }}>{n.body}</div>}
                  {n.storage_path && (
                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => openFile(n)}>
                      📎 {n.file_name || 'Open attachment'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
