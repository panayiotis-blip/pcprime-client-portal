import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function LoginPage() {
  const { login, sendMagicLink } = useAuth();
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

  const handleMagicLink = async () => {
    if (!email) { setError('Enter your email first'); return; }
    setError(''); setInfo(''); setLoading(true);
    try {
      await sendMagicLink(email);
      setInfo('Magic link sent — check your inbox.');
    } catch (err: any) {
      setError(err.message || 'Could not send magic link');
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
            style={{ maxWidth: 520, width: '100%', height: 'auto', display: 'block', margin: '0 auto 12px' }}
          />
          <p>Client Portal</p>
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
              placeholder="— or leave blank to use a magic link"
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={loading || !email || !password}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <button
            type="button" onClick={handleMagicLink}
            className="btn login-btn"
            style={{ marginTop: 8, background: 'transparent', border: '1px solid #ccc' }}
            disabled={loading || !email}
          >
            Email me a magic link instead
          </button>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Link to="/signup" style={{ color: '#9b861f', fontSize: 14, textDecoration: 'none' }}>
            New client? Apply for an account
          </Link>
          <Link to="/" style={{ color: '#9b861f', fontSize: 14, textDecoration: 'none' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
