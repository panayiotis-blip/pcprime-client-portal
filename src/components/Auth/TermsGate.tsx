import { useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { CURRENT_TOS_VERSION, TermsContent } from './terms';

// Full-screen gate shown until the user accepts the current Terms. On accept,
// refreshUser re-evaluates the gate in App and the portal loads.
export default function TermsGate() {
  const { refreshUser, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try { await api.acceptTos(CURRENT_TOS_VERSION); await refreshUser(); }
    catch (err: any) { alert('Could not record acceptance: ' + err.message); setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px' }}>
      <h2>Terms of Service</h2>
      <p style={{ color: '#475569' }}>Please review and accept to continue.</p>
      <div className="card" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        <TermsContent />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 8 }}>
        <button className="btn btn-link" onClick={() => { void logout(); }} disabled={busy}>Decline &amp; sign out</button>
        <button className="btn btn-primary" onClick={accept} disabled={busy}>{busy ? 'Saving…' : 'I accept'}</button>
      </div>
    </div>
  );
}
