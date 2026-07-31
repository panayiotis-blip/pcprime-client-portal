import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { getClientApp } from '../../services/clientApps';

// Standalone client-app entry at /app — the single firm-branded page every
// app-user goes through. They sign in at the app's own login box; the username
// resolves which client + app to open; then the app runs full-screen (no
// portal chrome). Auth + data go through the public app-session function; data
// lives in our Supabase.

type Session = { session: string; role: string; name: string; app_key: string; data: any };

export default function ClientAppPortal() {
  const [sess, setSess] = useState<Session | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [srcDoc, setSrcDoc] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [reg, setReg] = useState({ client_name: '', full_name: '', email: '', phone: '', message: '' });
  const [regDone, setRegDone] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sessRef = useRef<Session | null>(null);
  const saveTimer = useRef<any>(null);
  useEffect(() => { sessRef.current = sess; }, [sess]);

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

  // ----- Login / register box -----
  const inputStyle: React.CSSProperties = { width: '100%', marginBottom: 10, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14 };
  const linkStyle: React.CSSProperties = { color: '#9b861f', fontSize: 13, textDecoration: 'none', cursor: 'pointer', background: 'none', border: 'none' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(120deg,#141f66,#28348a)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 30, width: 'min(420px,92vw)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>Client Apps</h2>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b' }}>PC Prime &amp; Calculate Consultants</p>
        {err && <div style={{ color: '#ef4444', fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

        {mode === 'login' ? (
          <form onSubmit={signIn}>
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
            <button onClick={() => { setMode('login'); setRegDone(false); }} style={{ ...linkStyle, marginTop: 6 }}>← Back to sign in</button>
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
            <button type="button" onClick={() => { setErr(''); setMode(mode === 'login' ? 'register' : 'login'); }} style={linkStyle}>
              {mode === 'login' ? 'Register for access →' : 'Have a login? Sign in →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
