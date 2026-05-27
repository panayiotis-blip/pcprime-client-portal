import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import MessageThread from './MessageThread';
import ThreadList from './ThreadList';

// Client-facing messaging — a list of topics with the firm, each its own thread.
export default function MyMessages() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [selected, setSelected] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);

  if (!clientId) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>Messages</h2></div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Start a topic for each thing you need — replies from our team appear in that topic.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'stretch' }}>
        <div className="card" style={{ padding: 0, maxHeight: 560, overflow: 'hidden' }}>
          <ThreadList clientId={clientId} selectedId={selected} onSelect={setSelected} refreshSignal={refresh} />
        </div>
        <div className="card" style={{ minHeight: 320 }}>
          {selected ? (
            <MessageThread threadId={selected} clientId={clientId} viewerIsStaff={false} onActivity={() => setRefresh(n => n + 1)} />
          ) : (
            <div className="empty-state"><p>Select a topic, or start a new one.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
