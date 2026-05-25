import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import MessageThread from '../Client/MessageThread';

// Staff inbox: list of clients with a conversation (+ unread count); open one
// to read and reply.
export default function MessagesInbox() {
  const [inbox, setInbox]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const load = async () => {
    try { setInbox(await api.getMessageInbox()); }
    catch (err: any) { alert('Failed to load inbox: ' + err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const selectedRow = inbox.find(i => i.client_id === selected);
  const name = (r: any) => `${r.client_code ? r.client_code + ' — ' : ''}${r.client_name}`;

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>Messages</h2></div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Conversation list */}
        <div className="card" style={{ maxHeight: 560, overflowY: 'auto', padding: 0 }}>
          {loading ? (
            <div className="loading-screen">Loading…</div>
          ) : inbox.length === 0 ? (
            <p style={{ padding: 12, color: '#64748b', margin: 0 }}>No messages yet.</p>
          ) : inbox.map(row => (
            <button
              key={row.client_id} type="button" onClick={() => setSelected(row.client_id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                borderBottom: '1px solid #f1f5f9', padding: '10px 12px', cursor: 'pointer',
                background: selected === row.client_id ? '#eef2ff' : 'white',
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

        {/* Selected thread */}
        <div className="card" style={{ minHeight: 320 }}>
          {selectedRow ? (
            <>
              <h3 style={{ marginTop: 0 }}>{name(selectedRow)}</h3>
              <MessageThread clientId={selectedRow.client_id} viewerIsStaff onActivity={load} />
            </>
          ) : (
            <div className="empty-state"><p>Select a conversation to read and reply.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
