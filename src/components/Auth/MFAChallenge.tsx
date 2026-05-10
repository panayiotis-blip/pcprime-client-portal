import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth, TRUSTED_DEVICE_TOKEN_KEY } from '../../context/AuthContext';

const TRUST_DAYS = 30;

// Best-effort device label from the user-agent. Stored alongside the token
// so the user can recognise which device a trust came from in the Security
// page (e.g. "Chrome on Windows").
function deriveDeviceLabel(): string {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (/Edg\//.test(ua))                              browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua))                     browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/Windows NT/.test(ua))             os = 'Windows';
  else if (/Mac OS X/.test(ua))          os = 'macOS';
  else if (/Android/.test(ua))           os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua))  os = 'iOS';
  else if (/Linux/.test(ua))             os = 'Linux';

  return `${browser} on ${os}`;
}

// Shown after a successful password sign-in when the user has MFA enrolled
// but the session is still at aal1 AND the device is not trusted.
export default function MFAChallenge() {
  const { user, refreshMfa, logout } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const factors = await api.listMfaFactors() as any;
        const verified = (factors?.totp || []).find((f: any) => f.status === 'verified');
        if (!verified) {
          setError('No verified authenticator factor found. Please contact an administrator.');
          setLoading(false);
          return;
        }
        const ch = await api.challengeMfa(verified.id);
        if (cancelled) return;
        setFactorId(verified.id);
        setChallengeId(ch.id);
      } catch (err: any) {
        setError(err.message || 'Failed to start MFA challenge');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator'); return; }
    setVerifying(true);
    setError('');
    try {
      await api.verifyMfa(factorId, challengeId, code);
      // If the user opted in, register this device as trusted BEFORE refreshing
      // MFA state — so loadMfa picks up the new token immediately.
      if (trustDevice) {
        try {
          const token = await api.trustThisDevice(deriveDeviceLabel(), navigator.userAgent, TRUST_DAYS);
          localStorage.setItem(TRUSTED_DEVICE_TOKEN_KEY, token);
        } catch (err: any) {
          // Non-fatal: still proceed into the app. The user just won't be trusted next time.
          console.warn('Could not register trusted device:', err?.message || err);
        }
      }
      await refreshMfa();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setCode('');
      try {
        const ch = await api.challengeMfa(factorId);
        setChallengeId(ch.id);
      } catch {}
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h2>Two-factor authentication</h2>
          <p>Enter the 6-digit code from your authenticator app for <strong>{user?.email}</strong>.</p>
        </div>
        {loading ? (
          <p>Starting challenge…</p>
        ) : error && !challengeId ? (
          <>
            <div className="login-error">{error}</div>
            <button className="btn btn-secondary login-btn" onClick={() => logout()}>Sign out</button>
          </>
        ) : (
          <form onSubmit={handleVerify}>
            {error && <div className="login-error">{error}</div>}
            <div className="form-group">
              <label>6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                autoComplete="one-time-code"
                className="form-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', fontSize: 14, color: '#475569' }}>
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              <span>Trust this device for {TRUST_DAYS} days (skip this prompt next time)</span>
            </label>
            <button type="submit" className="btn btn-primary login-btn" disabled={verifying || code.length !== 6}>
              {verifying ? 'Verifying…' : 'Verify'}
            </button>
            <button type="button" className="btn login-btn" onClick={() => logout()} style={{ marginTop: 8, background: 'transparent', border: '1px solid #ccc' }}>
              Cancel and sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
