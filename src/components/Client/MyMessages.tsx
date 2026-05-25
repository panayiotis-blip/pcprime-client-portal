import { useAuth } from '../../context/AuthContext';
import MessageThread from './MessageThread';

// Client-facing messaging screen — one conversation with the firm.
export default function MyMessages() {
  const { user } = useAuth();
  const clientId = user?.client_id;

  if (!clientId) return <div className="empty-state"><p>No client account is linked to your login.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header"><h2>Messages</h2></div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        Send a message to our team — replies appear here.
      </p>
      <div className="card">
        <MessageThread clientId={clientId} viewerIsStaff={false} />
      </div>
    </div>
  );
}
