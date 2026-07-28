import { useEffect, useRef, useState } from 'react';
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
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ----- Signed in: full-screen app -----
  if (sess && srcDoc) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#f4f6f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: '#0f172a', color: '#fff', fontSize: 13 }}>
          <span style={{ opacity: 0.8 }}>Signed in as <strong style={{ color: '#fff' }}>{sess.name}</strong></span>
          <span style={{ marginLeft: 'auto', color: saveState === 'error' ? '#fca5a5' : '#94a3b8' }}>
            {saveState === 'saving' ? '● Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? '⚠ Save failed' : ''}
          </span>
          <button onClick={signOut} style={{ background: 'none', border: '1px solid #334155', color: '#f04e23', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>Sign out</button>
        </div>
        <iframe ref={iframeRef} srcDoc={srcDoc} title="App" style={{ flex: 1, width: '100%', border: 0 }} />
      </div>
    );
  }

  // ----- Login box -----
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(120deg,#141f66,#28348a)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={signIn} style={{ background: '#fff', borderRadius: 16, padding: 30, width: 'min(380px,92vw)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>Client Apps</h2>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b' }}>PC Prime &amp; Calculate Consultants — please sign in.</p>
        {err && <div style={{ color: '#ef4444', fontSize: 12.5, marginBottom: 8 }}>{err}</div>}
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" autoComplete="username"
          style={{ width: '100%', marginBottom: 10, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14 }} />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete="current-password"
          style={{ width: '100%', marginBottom: 10, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14 }} />
        <button type="submit" disabled={busy || !username.trim() || !password}
          style={{ width: '100%', padding: 11, borderRadius: 8, border: 'none', background: '#1e2a78', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
