import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import MessageThread from '../Client/MessageThread';
import ThreadList from '../Client/ThreadList';

// Staff inbox: clients with conversations → that client's topics → the thread.
export default function MessagesInbox() {
  const [inbox, setInbox]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient]   = useState<number | null>(null);
  const [thread, setThread]   = useState<any | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = async () => {
    try { setInbox(await api.getMessageInbox()); }
    catch (err: any) { alert('Failed to load inbox: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [refresh]);

  const name = (r: any) => `${r.client_code ? r.client_code + ' — ' : ''}${r.client_name}`;
  const pickClient = (id: number) => { setClient(id); setThread(null); };

  const toggleStatus = async () => {
    if (!thread) return;
    const next = thread.status === 'closed' ? 'open' : 'closed';
    try { await api.setThreadStatus(thread.id, next); setThread({ ...thread, status: next }); setRefresh(n => n + 1); }
    catch (err: any) { alert(err.message); }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>Messages</h2></div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 280px 1fr', gap: 12, alignItems: 'start' }}>
        {/* Clients */}
        <div className="card" style={{ maxHeight: 560, overflowY: 'auto', padding: 0 }}>
          {loading ? (
            <div className="loading-screen">Loading…</div>
          ) : inbox.length === 0 ? (
            <p style={{ padding: 12, color: '#64748b', margin: 0 }}>No messages yet.</p>
          ) : inbox.map(row => (
            <button
              key={row.client_id} type="button" onClick={() => pickClient(row.client_id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                borderBottom: '1px solid #f1f5f9', padding: '10px 12px', cursor: 'pointer',
                background: client === row.client_id ? '#eef2ff' : 'white',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{name(row)}</strong>
                {row.unread > 0 && (
                  <span style={{ background: '#b91c1c', color: 'white', borderRadius: 10, fontSize: 11, padding: '0 6px' }}>{row.unread}</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.last_body}</div>
            </button>
          ))}
        </div>

        {/* Topics for the selected client */}
        <div className="card" style={{ padding: 0, height: 560, overflow: 'hidden' }}>
          {client ? (
            <ThreadList clientId={client} selectedId={thread?.id ?? null} onSelect={(_id, t) => setThread(t)} refreshSignal={refresh} />
          ) : (
            <p style={{ padding: 12, color: '#64748b', margin: 0, fontSize: 13 }}>Select a client.</p>
          )}
        </div>

        {/* Selected thread */}
        <div className="card" style={{ minHeight: 320 }}>
          {thread && client ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>{thread.subject}{thread.status === 'closed' && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}> · closed</span>}</h3>
                <button className="btn btn-secondary btn-sm" onClick={toggleStatus}>{thread.status === 'closed' ? 'Reopen' : 'Mark closed'}</button>
              </div>
              <MessageThread threadId={thread.id} clientId={client} viewerIsStaff onActivity={() => setRefresh(n => n + 1)} />
            </>
          ) : (
            <div className="empty-state"><p>{client ? 'Select a topic to read and reply.' : 'Select a client, then a topic.'}</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
