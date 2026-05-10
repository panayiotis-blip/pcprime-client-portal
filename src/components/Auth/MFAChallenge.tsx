import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Shown after a successful password sign-in when the user has MFA enrolled
// but the session is still at aal1. Locks the rest of the app behind a
// 6-digit TOTP challenge.
export default function MFAChallenge() {
  const { user, refreshMfa, logout } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  // Look up the user's verified TOTP factor and start a challenge
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
      await refreshMfa();
      // Parent (AuthedApp) re-renders without the challenge gate
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setCode('');
      // Start a new challenge for the next attempt
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
