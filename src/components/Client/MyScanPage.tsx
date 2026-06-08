import { useAuth } from '../../context/AuthContext';
import ScannerPage from '../Scanner/ScannerPage';

// Client-portal entry point for the document scanner. Reuses the staff
// ScannerPage with the client picker hidden — every scan is filed against
// the logged-in client's own client_id (set on the auth user by the portal).
export default function MyScanPage() {
  const { user } = useAuth();
  const clientId = (user as any)?.client_id;

  if (!clientId) {
    return (
      <div className="client-tab-content" style={{ padding: '2rem 1rem', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{ marginTop: 0, color: '#1a365d' }}>Scan Document</h2>
        <div className="card" style={{ background: '#fffbeb', borderLeft: '4px solid #f59e0b', padding: '12px 16px' }}>
          <strong>No client linked to your account.</strong>
          <p style={{ marginTop: 6, color: '#5a6478', fontSize: 14 }}>
            Your user is not linked to a client record yet, so scans can't be filed. Please ask your firm to
            link your login to your client file.
          </p>
        </div>
      </div>
    );
  }

  return <ScannerPage lockedClientId={clientId} />;
}
