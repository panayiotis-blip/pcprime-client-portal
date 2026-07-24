import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { supabase } from '../../lib/supabase';

// Landing page for the password-reset email link. The Supabase client's
// detectSessionInUrl turns the recovery link into a session; we then let the
// user set a new password via updateUser.
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setError('The two passwords do not match.'); return; }
    setError(''); setSaving(true);
    try {
      await api.updateMyPassword(pw);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.message || 'Could not update the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img
            src="/logo.png"
            alt="PC Prime & Calculate Consultants Ltd"
            style={{ maxWidth: 520, width: '100%', height: 'auto', display: 'block', margin: '0 auto 12px' }}
          />
          <p>Set a new password</p>
        </div>

        {done ? (
          <div className="login-info" style={{ color: '#0a7', padding: 8, textAlign: 'center' }}>
            Password updated. Redirecting you to sign in…
          </div>
        ) : !ready ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: 14, padding: '12px 0' }}>
            Open this page from the reset link in your email. If you got here another way,{' '}
            <Link to="/login" style={{ color: '#9b861f' }}>request a new link</Link>.
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="login-error">{error}</div>}
            <div className="form-group">
              <label>New password</label>
              <input
                type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                className="form-input" autoFocus required placeholder="At least 8 characters"
              />
            </div>
            <div className="form-group">
              <label>Confirm new password</label>
              <input
                type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                className="form-input" required placeholder="Re-enter the password"
              />
            </div>
            <button type="submit" className="btn btn-primary login-btn" disabled={saving || !pw || !pw2}>
              {saving ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login" style={{ color: '#9b861f', fontSize: 14, textDecoration: 'none' }}>← Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
