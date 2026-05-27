import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { formatDateTime } from '../../services/dates';

// List of message topics for one client, used by both the client Messages
// screen and the staff inbox. Lets the viewer start a new topic and pick one.
export default function ThreadList({
  clientId, selectedId, onSelect, refreshSignal = 0,
}: {
  clientId: number;
  selectedId: number | null;
  onSelect: (id: number, thread?: any) => void;
  refreshSignal?: number;
}) {
  const [threads, setThreads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);

  const load = async () => {
    try { setThreads(await api.getClientThreads(clientId)); }
    catch (err: any) { alert('Failed to load topics: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { setLoading(true); load(); /* eslint-disable-next-line */ }, [clientId, refreshSignal]);

  const newTopic = async () => {
    const subject = prompt('New topic / subject:');
    if (!subject || !subject.trim()) return;
    setBusy(true);
    try {
      const id = await api.createMessageThread(clientId, subject.trim());
      await load();
      onSelect(id);
    } catch (err: any) { alert('Could not create topic: ' + err.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #f1f5f9' }}>
        <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={newTopic} disabled={busy}>
          {busy ? '…' : '+ New topic'}
        </button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {loading ? (
          <div className="loading-screen">Loading…</div>
        ) : threads.length === 0 ? (
          <p style={{ padding: 12, color: '#64748b', margin: 0, fontSize: 13 }}>No topics yet. Start one above.</p>
        ) : threads.map(t => (
          <button
            key={t.id} type="button" onClick={() => onSelect(t.id, t)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', border: 'none',
              borderBottom: '1px solid #f1f5f9', padding: '10px 12px', cursor: 'pointer',
              background: selectedId === t.id ? '#eef2ff' : 'white',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 13 }}>
                {t.subject}
                {t.status === 'closed' && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}> · closed</span>}
              </strong>
              {t.unread > 0 && (
                <span style={{ background: '#b91c1c', color: 'white', borderRadius: 10, fontSize: 11, padding: '0 6px' }}>{t.unread}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.last_body || 'No messages yet'}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{formatDateTime(t.last_at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
