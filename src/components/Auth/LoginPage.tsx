import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { setError('Enter your email above first, then click "Forgot password?".'); return; }
    setError(''); setInfo(''); setLoading(true);
    try {
      await api.sendPasswordReset(email);
      setInfo('If an account exists for that email, a password-reset link is on its way — check your inbox.');
    } catch (err: any) {
      setError(err.message || 'Could not send the reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img
            src="/logo.png"
            alt="PC Prime & Calculate Consultants Ltd"
            style={{ maxWidth: 520, width: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
          />
        </div>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          {info && <div className="login-info" style={{ color: '#0a7', padding: 8, marginBottom: 8 }}>{info}</div>}
          <div className="form-group">
            <label>Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="form-input" autoFocus required
              placeholder="you@example.com"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              placeholder="Your password"
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={loading || !email || !password}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <div style={{ marginTop: 10, textAlign: 'center' }}>
            <button
              type="button" onClick={handleForgotPassword} disabled={loading}
              style={{ background: 'none', border: 'none', color: '#9b861f', fontSize: 14, cursor: 'pointer', padding: 0 }}
            >
              Forgot password?
            </button>
          </div>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #eef1f5', paddingTop: 14 }}>
          <Link to="/signup" style={{ color: '#9b861f', fontSize: 14, textDecoration: 'none' }}>
            New client? Request an account →
          </Link>
          <Link to="/app" style={{ color: '#9b861f', fontSize: 14, textDecoration: 'none' }}>
            Using a client app? Sign in here →
          </Link>
          <Link to="/" style={{ color: '#9b861f', fontSize: 14, textDecoration: 'none' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
