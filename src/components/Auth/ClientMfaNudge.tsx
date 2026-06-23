import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import MFAEnrollment from './MFAEnrollment';
import { useAuth } from '../../context/AuthContext';
import { isStaffRole } from '../../services/api';

// Non-blocking 2FA nudge for client-role users who haven't enrolled an
// authenticator yet. Unlike staff (who are hard-gated by ForcedMfaSetup),
// clients are only encouraged — they can set it up now or be reminded later.
// Mounted once at the app level; it self-gates on role / enrolment / snooze.

const SNOOZE_KEY = 'pcprime_mfa_nudge_snooze_until';
const SNOOZE_DAYS = 7;

function isSnoozed(): boolean {
  try {
    const until = localStorage.getItem(SNOOZE_KEY);
    return !!until && new Date(until).getTime() > Date.now();
  } catch {
    return false;
  }
}

export default function ClientMfaNudge() {
  const { user, mfa, refreshMfa } = useAuth();
  const location = useLocation();
  // null = not showing; 'prompt' = the nudge; 'enrolling' = QR/verify flow.
  const [mode, setMode] = useState<'prompt' | 'enrolling' | null>(null);

  const eligible =
    !!user &&
    !isStaffRole(user) &&                          // clients only — staff are hard-gated elsewhere
    !mfa.enrolled &&                               // nothing to nudge once they've enrolled
    !/\/print(\?|$)/.test(location.pathname) &&    // never over a print/screenshot view
    !isSnoozed();

  // Open the prompt once the user becomes eligible. Snoozing flips isSnoozed()
  // (and enrolling flips mfa.enrolled), so this won't re-open after dismissal.
  useEffect(() => {
    if (eligible && mode === null) setMode('prompt');
  }, [eligible, mode]);

  if (mode === null) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, new Date(Date.now() + SNOOZE_DAYS * 864e5).toISOString());
    } catch { /* ignore storage failures */ }
  };
  const remindLater = () => { snooze(); setMode(null); };
  // Snooze on completion too: refreshMfa() is async, so the snooze stops the
  // effect re-opening the prompt in the brief window before mfa.enrolled flips.
  const onEnrolled = () => { snooze(); void refreshMfa(); setMode(null); };

  return (
    <div
      onClick={() => { if (mode === 'prompt') remindLater(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        padding: 24, overflowY: 'auto',
      }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 24, maxWidth: 640, width: '100%', marginTop: 40 }}>
        {mode === 'prompt' ? (
          <>
            <h2 style={{ marginTop: 0, color: '#1a365d' }}>🔒 Protect your account with 2-step verification</h2>
            <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5 }}>
              Add a second layer of security to your portal login using a free authenticator app
              (Google Authenticator, 1Password, Authy…). It takes about a minute and means a
              password alone is never enough to reach your financial information.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={remindLater}>Remind me later</button>
              <button className="btn btn-primary" onClick={() => setMode('enrolling')}>Set up now</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0, color: '#1a365d' }}>Set up 2-step verification</h2>
            <MFAEnrollment
              onComplete={onEnrolled}
              onCancel={() => setMode('prompt')}
            />
          </>
        )}
      </div>
    </div>
  );
}
