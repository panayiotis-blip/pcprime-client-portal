import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, isStaffRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getClientApp } from '../../services/clientApps';

// Standalone client-app entry at /app — the single firm-branded page every
// app-user goes through.
//
// App access Phase 5: this is now an EMAIL sign-in. The person signs in with
// their email/password (Supabase Auth) and lands at "/", where ClientEntry
// works out from their grants which app(s) they can open — one app goes
// straight there full-screen, several show the chooser.
//
// The old username login is kept underneath as a fallback while the firm moves
// each legacy client_app_users login over ("Move to email" in the client's Apps
// tab). It signs in through the public app-session function and runs the app in
// an iframe here, exactly as before. Once nothing is left on it, this fallback
// and the app-session login action both go.

type Session = { session: string; role: string; name: string; app_key: string; data: any };

export default function ClientAppPortal() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [sess, setSess] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [srcDoc, setSrcDoc] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mode, setMode] = useState<'email' | 'login' | 'register'>('email');
  const [reg, setReg] = useState({ client_name: '', full_name: '', email: '', phone: '', message: '' });
  const [regDone, setRegDone] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sessRef = useRef<Session | null>(null);
  const saveTimer = useRef<any>(null);
  useEffect(() => { sessRef.current = sess; }, [sess]);

  // Email sign-in — the current system. ClientEntry at "/" takes it from here.
  const signInEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setInfo('');
    try {
      await login(email.trim(), password);
      // Staff land on the apps launcher (every client's apps, grouped by app);
      // clients land at "/", where ClientEntry opens whatever they're granted.
      navigate('/apps', { replace: true });
    } catch (e: any) {
      setErr(e?.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setErr('Enter your email address first, then tap “Forgot password”.'); return; }
    setBusy(true); setErr(''); setInfo('');
    try {
      await api.sendPasswordReset(addr);
      setInfo(`We've emailed ${addr} a link to set a new password.`);
    } catch (e: any) {
      setErr(e?.message || 'Could not send the reset email.');
    } finally {
      setBusy(false);
    }
  };

  // Legacy username sign-in (being retired).
  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const s = await api.appLogin(username.trim(), password);
      const app = getClientApp(s.app_key);
      if (!app) { setErr('This app is not available.'); setBusy(false); return; }
      const html = await fetch(app.asset + 'index.html').then(r => r.text());
      setSrcDoc(html);
      setSess(s);
    } catch (e: any) {
      setErr(e?.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => { setSess(null); setSrcDoc(''); setPassword(''); setSaveState('idle'); };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.submitAppRequest({
        client_name: reg.client_name.trim(), full_name: reg.full_name.trim(),
        email: reg.email.trim(), phone: reg.phone.trim(), message: reg.message.trim(),
      });
      setRegDone(true);
    } catch (e: any) {
      setErr(e?.message || 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  // Bridge with the embedded app.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const m: any = e.data || {};
      const s = sessRef.current;
      if (!s) return;
      if (m.type === 'ready') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'init', data: s.data || {}, role: s.role, name: s.name, username: 'app' }, '*',
        );
      } else if (m.type === 'save') {
        setSaveState('saving');
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          try { await api.appSave(s.session, m.data); setSaveState('saved'); }
          catch { setSaveState('error'); }
        }, 400);
      } else if (m.type === 'logout') {
        signOut();
      } else if (m.type === 'mailto') {
        // App saved a PDF and wants a message opened for it — mailto only.
        const href = String(m.href || '');
        if (href.startsWith('mailto:')) window.location.href = href;
      } else if (m.type === 'users') {
        const win = iframeRef.current?.contentWindow;
        const reply = (payload: any) => win?.postMessage({ type: 'users:reply', reqId: m.reqId, ...payload }, '*');
        (async () => {
          try {
            const ses = s.session;
            if (m.op === 'list') reply({ ok: true, data: await api.appAdminListUsers(ses) });
            else if (m.op === 'create') { await api.appAdminCreateUser(ses, m.payload); reply({ ok: true }); }
            else if (m.op === 'update') { await api.appAdminUpdateUser(ses, m.id, m.payload); reply({ ok: true }); }
            else if (m.op === 'reset') { await api.appAdminResetUser(ses, m.id, m.payload.password); reply({ ok: true }); }
            else if (m.op === 'delete') { await api.appAdminDeleteUser(ses, m.id); reply({ ok: true }); }
          } catch (e: any) { reply({ ok: false, error: e?.message || 'Failed' }); }
        })();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ----- Signed in: the app, full-screen. No wrapper bar — the app's own
  // header already shows the user + Log out (its Log out posts 'logout' back
  // to us via the bridge, which calls signOut). saveState is unused here now;
  // the app's own "Updated" stamp reflects saves.
  if (sess && srcDoc) {
    return (
      <iframe ref={iframeRef} srcDoc={srcDoc} title="App"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }} />
    );
  }
  void saveState;

  // Already signed in with an email account — staff to the apps launcher,
  // everyone else to "/", where ClientEntry decides.
  if (user) return <Navigate to={isStaffRole(user) ? '/apps' : '/'} replace />;

  // ----- Login / register box -----
  const inputStyle: React.CSSProperties = { width: '100%', marginBottom: 10, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14 };
  const linkStyle: React.CSSProperties = { color: '#9b861f', fontSize: 13, textDecoration: 'none', cursor: 'pointer', background: 'none', border: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(120deg,#141f66,#28348a)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 30, width: 'min(420px,92vw)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>Client Apps</h2>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b' }}>PC Prime &amp; Calculate Consultants</p>
        {err && <div style={{ color: '#ef4444', fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
        {info && <div style={{ color: '#0a7', fontSize: 12.5, marginBottom: 8 }}>{info}</div>}

        {mode === 'email' ? (
          <form onSubmit={signInEmail}>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" autoComplete="email" style={inputStyle} />
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete="current-password" style={inputStyle} />
            <button type="submit" disabled={busy || !email.trim() || !password}
              style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', background: '#1e2a78', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div style={{ marginTop: 10 }}>
              <button type="button" onClick={forgotPassword} disabled={busy} style={linkStyle}>Forgot password?</button>
            </div>
          </form>
        ) : mode === 'login' ? (
          <form onSubmit={signIn}>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
              The old username login. If yours has been moved to email, sign in with your email instead.
            </p>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" autoComplete="username" style={inputStyle} />
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete="current-password" style={inputStyle} />
            <button type="submit" disabled={busy || !username.trim() || !password}
              style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', background: '#1e2a78', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : regDone ? (
          <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.6 }}>
            <p style={{ color: '#166534', fontWeight: 600 }}>✓ Request submitted.</p>
            <p style={{ color: '#475569' }}>Your accountant will review it. Once approved, you'll get an email to set your password — then you can sign in.</p>
            <button onClick={() => { setMode('email'); setRegDone(false); }} style={{ ...linkStyle, marginTop: 6 }}>← Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={submitRegister}>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>Request access by email — your accountant approves it, then you'll get an email to set your password.</p>
            <input value={reg.client_name} onChange={e => setReg(p => ({ ...p, client_name: e.target.value }))} placeholder="Client / company name *" style={inputStyle} />
            <input value={reg.full_name} onChange={e => setReg(p => ({ ...p, full_name: e.target.value }))} placeholder="Your full name" style={inputStyle} />
            <input value={reg.email} onChange={e => setReg(p => ({ ...p, email: e.target.value }))} type="email" placeholder="Email *" autoComplete="email" style={inputStyle} />
            <input value={reg.phone} onChange={e => setReg(p => ({ ...p, phone: e.target.value }))} placeholder="Phone" style={inputStyle} />
            <button type="submit" disabled={busy || !reg.client_name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email.trim())}
              style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', background: '#1e2a78', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              {busy ? 'Submitting…' : 'Request access'}
            </button>
          </form>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, borderTop: '1px solid #eef1f5', paddingTop: 14 }}>
          <Link to="/" style={linkStyle}>← Back to home</Link>
          {!regDone && (
            <button type="button" onClick={() => { setErr(''); setInfo(''); setMode(mode === 'register' ? 'email' : 'register'); }} style={linkStyle}>
              {mode === 'register' ? 'Have a login? Sign in →' : 'Register for access →'}
            </button>
          )}
        </div>

        {/* Fallback while the firm moves the last username logins to email. */}
        {mode !== 'register' && (
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <button type="button" onClick={() => { setErr(''); setInfo(''); setPassword(''); setMode(mode === 'login' ? 'email' : 'login'); }}
              style={{ ...linkStyle, color: '#94a3b8', fontSize: 12 }}>
              {mode === 'login' ? 'Sign in with your email instead' : 'Still using a username? Sign in here'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
