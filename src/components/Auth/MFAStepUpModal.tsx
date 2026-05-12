import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  onVerified: () => void;
  onCancel: () => void;
}

// Inline MFA step-up: shown when the user tries a sensitive op on an aal1
// session. They type the current 6-digit authenticator code; we run a
// Supabase MFA challenge/verify pair, which promotes the session to aal2.
// The caller (MFAStepUpContext) then retries the original action.
export default function MFAStepUpModal({ onVerified, onCancel }: Props) {
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: factors, error: lfErr } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (lfErr) { setError(lfErr.message); return; }
      const totp = factors.totp?.find(f => f.status === 'verified');
      if (!totp) {
        setError('No authenticator factor enrolled on this account. Sign out and sign in again normally.');
        return;
      }
      setFactorId(totp.id);

      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (cancelled) return;
      if (chErr) { setError(chErr.message); return; }
      setChallengeId(ch.id);
      setTimeout(() => inputRef.current?.focus(), 50);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerify = async () => {
    if (!factorId || !challengeId) return;
    if (code.length !== 6) { setError('Enter the 6-digit code'); return; }
    setVerifying(true);
    setError(null);
    try {
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code,
      });
      if (vErr) { setError(vErr.message); return; }
      // Make sure the freshly-aal2 session is loaded into the SDK's in-memory store.
      await supabase.auth.refreshSession();
      onVerified();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 24, width: '100%', maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>🔐 Verify it's really you</h3>
        <p style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
          This action requires a fresh MFA check. Open your authenticator app and enter the current 6-digit code.
        </p>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="one-time-code"
          className="form-input"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && challengeId) handleVerify(); }}
          placeholder="000000"
          style={{ textAlign: 'center', fontSize: 22, letterSpacing: 6, fontVariantNumeric: 'tabular-nums' }}
          disabled={verifying || !challengeId}
        />
        {error && <p style={{ color: '#b91c1c', fontSize: 13, margin: '8px 0 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={verifying}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleVerify}
            disabled={verifying || code.length !== 6 || !challengeId}
          >
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}
