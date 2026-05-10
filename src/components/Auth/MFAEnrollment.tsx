import { useEffect, useState } from 'react';
import { api } from '../../services/api';

interface Props {
  onComplete: () => void;   // called after successful verification
  onCancel:   () => void;
}

// Enrollment dialog. Calls supabase.auth.mfa.enroll, shows the QR code +
// secret, and asks the user to verify with the first 6-digit code.
export default function MFAEnrollment({ onComplete, onCancel }: Props) {
  const [factor, setFactor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const f = await api.enrollTotp();
        if (!cancelled) setFactor(f);
      } catch (err: any) {
        // If a factor is already enrolled but unverified from a previous attempt,
        // the API may reject. Try to recover by listing and using the unverified one.
        try {
          const list = await api.listMfaFactors() as any;
          const unverified = (list?.totp || []).find((f: any) => f.status === 'unverified');
          if (unverified) {
            // No public way to re-fetch the QR for an existing factor — disenroll and re-enroll.
            await api.unenrollMfa(unverified.id);
            const fresh = await api.enrollTotp();
            if (!cancelled) setFactor(fresh);
          } else {
            if (!cancelled) setError(err.message || 'Failed to start enrollment');
          }
        } catch (err2: any) {
          if (!cancelled) setError(err2.message || err.message || 'Failed to start enrollment');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCancel = async () => {
    // Roll back the unverified factor so we don't leave junk on the account.
    if (factor?.id) {
      try { await api.unenrollMfa(factor.id); } catch {}
    }
    onCancel();
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factor) return;
    if (code.length !== 6) { setError('Enter the 6-digit code from your app'); return; }
    setVerifying(true);
    setError('');
    try {
      await api.verifyMfaEnrollment(factor.id, code);
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Verification failed. Try the next code.');
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return <p>Preparing enrollment…</p>;
  if (error && !factor) {
    return (
      <div>
        <div className="login-error">{error}</div>
        <button className="btn btn-secondary" onClick={onCancel}>Close</button>
      </div>
    );
  }
  if (!factor) return null;

  return (
    <div className="form-section" style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Enroll authenticator app</h3>
      <ol style={{ paddingLeft: 18, marginTop: 0 }}>
        <li>Open your authenticator app (Google Authenticator, 1Password, Authy, Bitwarden…).</li>
        <li>Add a new entry by scanning the QR code below — or enter the secret manually.</li>
        <li>Type the 6-digit code your app shows below to confirm.</li>
      </ol>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap', margin: '16px 0' }}>
        <div style={{ background: 'white', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
          <img src={factor.totp?.qr_code} alt="MFA QR code" style={{ display: 'block', width: 200, height: 200 }} />
        </div>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Secret (manual entry):</div>
          <code style={{
            display: 'inline-block', background: '#fff', padding: '6px 10px',
            border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'monospace',
            wordBreak: 'break-all', fontSize: 14,
          }}>{factor.totp?.secret}</code>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
            Issuer: <strong>PC Prime Portal</strong>
          </div>
        </div>
      </div>

      <form onSubmit={handleVerify}>
        {error && <div className="login-error" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="form-group">
          <label>6-digit code from your app</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            className="form-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center', maxWidth: 200 }}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={verifying || code.length !== 6}>
          {verifying ? 'Verifying…' : 'Confirm enrollment'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleCancel} style={{ marginLeft: 8 }}>
          Cancel
        </button>
      </form>
    </div>
  );
}
