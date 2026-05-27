import MFAEnrollment from './MFAEnrollment';
import { useAuth } from '../../context/AuthContext';

// Shown to staff who have not yet enrolled an authenticator. Blocks the app
// until MFA is set up (or they sign out). On success, refreshMfa re-evaluates
// the gate in App and the portal loads.
export default function ForcedMfaSetup() {
  const { refreshMfa, logout } = useAuth();
  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h2>Set up two-factor authentication</h2>
      <p style={{ color: '#475569' }}>
        For security, all staff accounts must protect their login with an authenticator app.
        Please set it up now to continue. <strong>Cancelling will sign you out.</strong>
      </p>
      <div className="card">
        <MFAEnrollment onComplete={() => { void refreshMfa(); }} onCancel={() => { void logout(); }} />
      </div>
    </div>
  );
}
