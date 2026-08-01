import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getClientApp, loadAppTemplates } from '../../services/clientApps';
import { PanelSkeleton } from '../ui';

// Embeds a per-client app and bridges its data to Supabase (client_app_data,
// migration 161). Two render modes:
//  - BUILT-IN apps (public/<app>/): iframe srcdoc (sidesteps X-Frame-Options).
//  - UPLOADED templates (app_templates, mig 167): framed from the app-frame edge
//    function on the supabase.co origin, so the app carries its own headers (no
//    portal CSP) and any self-contained HTML — inline scripts included — runs.
//    (A blob/srcdoc frame would inherit the portal CSP and block inline scripts.)
//    Sandboxed (scripts only, no same-origin) for isolation.
// Either way it talks to the portal over postMessage: it posts "ready", we
// inject the document + the user's role/name; it posts "save", we upsert.

export default function ClientAppHost({ clientId, appKey, fullScreen, roleOverride }: { clientId: number; appKey: string; fullScreen?: boolean; roleOverride?: string }) {
  const { user } = useAuth();
  const app = getClientApp(appKey);

  const [doc, setDoc] = useState<any | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [mode, setMode] = useState<'srcdoc' | 'frame' | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<any>(null);
  const saveTimer = useRef<any>(null);

  // Grant-based callers (full-screen app users) pass their exact grant role;
  // otherwise fall back to the portal-role heuristic (client → editor, staff → admin).
  const appRole = roleOverride ?? ((user as any)?.role === 'client' ? 'editor' : 'admin');
  const appName = (user as any)?.display_name || (user as any)?.full_name || (user as any)?.username || (user as any)?.email || 'Staff';

  // Resolve the app shell: built-in → static index.html (srcdoc); uploaded
  // template → its HTML from the DB served via a blob URL.
  useEffect(() => {
    let alive = true;
    setMode(null); setSrcDoc(''); setFrameUrl(''); setErr('');
    (async () => {
      await loadAppTemplates();
      const a = getClientApp(appKey);
      if (a?.asset) {
        // Built-in app: static index.html served same-origin (CSP-clean) → srcdoc.
        try {
          const html = await fetch(a.asset + 'index.html').then(r => r.text());
          if (alive) { setSrcDoc(html); setMode('srcdoc'); }
        } catch (e: any) { if (alive) setErr('Could not load the app: ' + (e?.message || e)); }
      } else {
        // Uploaded template: framed from the same-origin /api/app-frame Vercel
        // function, which serves the app with no restrictive CSP/XFO (that path
        // is exempted from the portal headers), so its inline scripts run. A
        // blob/srcdoc frame would inherit the portal CSP and block them; Supabase
        // Functions/Storage force `default-src 'none'; sandbox`. (No app render in
        // local `vite` dev — /api runs only on Vercel.)
        // The iframe has no session, so it fetches by this allocation's variant
        // token (migrations 170-172): app-frame resolves it to this client's
        // customised copy, the version they were held on, or the shared
        // template. No token = no app; app HTML is not fetchable by key.
        let v = '';
        try { v = (await api.getClientAppVariant(clientId, appKey))?.variant_token || ''; } catch { /* handled below */ }
        if (alive) {
          if (!v) { setErr('This app is not available for this client.'); return; }
          setFrameUrl(`/api/app-frame?v=${encodeURIComponent(v)}`);
          setMode('frame');
        }
      }
    })();
    return () => { alive = false; };
  }, [appKey, clientId]);

  // Load this (client, app) document.
  useEffect(() => {
    setDocLoading(true);
    setSaveState('idle');
    api.getClientAppData(clientId, appKey)
      .then(r => setDoc(r?.data ?? {}))
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setDocLoading(false));
  }, [clientId, appKey]);

  useEffect(() => { docRef.current = doc; }, [doc]);

  // postMessage bridge with the embedded app.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const m: any = e.data || {};
      if (m.type === 'ready') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'init', data: docRef.current || {}, role: appRole, name: appName, username: (user as any)?.username || 'portal' },
          '*',
        );
      } else if (m.type === 'save') {
        setSaveState('saving');
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          try { await api.saveClientAppData(clientId, appKey, m.data); setSaveState('saved'); }
          catch { setSaveState('error'); }
        }, 300);
      } else if (m.type === 'users') {
        const win = iframeRef.current?.contentWindow;
        const reply = (payload: any) => win?.postMessage({ type: 'users:reply', reqId: m.reqId, ...payload }, '*');
        (async () => {
          try {
            if (m.op === 'list') reply({ ok: true, data: await api.listAppUsers(clientId, appKey) });
            else if (m.op === 'create') { await api.createAppUser({ client_id: clientId, app_key: appKey, ...m.payload }); reply({ ok: true }); }
            else if (m.op === 'update') { await api.updateAppUser(m.id, m.payload); reply({ ok: true }); }
            else if (m.op === 'reset') { await api.resetAppUserPassword(m.id, m.payload.password); reply({ ok: true }); }
            else if (m.op === 'delete') { await api.deleteAppUser(m.id); reply({ ok: true }); }
          } catch (e: any) { reply({ ok: false, error: e?.message || 'Failed' }); }
        })();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [appRole, appName, user, clientId, appKey]);

  const saveLabel = saveState === 'saving' ? '● Saving…'
    : saveState === 'saved' ? '✓ Saved'
    : saveState === 'error' ? '⚠ Save failed'
    : '';

  if (err) return <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>;
  if (docLoading || !mode) return <PanelSkeleton rows={8} />;

  const frameStyle: React.CSSProperties = fullScreen
    ? { flex: 1, minHeight: 0, width: '100%', border: 0, background: '#f4f6f9' }
    : { width: '100%', height: 'calc(100vh - 210px)', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f4f6f9' };

  return (
    <div style={fullScreen ? { height: '100%', display: 'flex', flexDirection: 'column' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, minHeight: 18 }}>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: saveState === 'error' ? '#b91c1c' : '#64748b' }}>{saveLabel}</span>
      </div>
      {mode === 'frame' ? (
        // Uploaded template: framed from supabase.co (own headers), sandboxed.
        <iframe
          key={`${clientId}:${appKey}:frame`}
          ref={iframeRef}
          src={frameUrl}
          title={app?.label || 'App'}
          sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-forms"
          style={frameStyle}
        />
      ) : (
        <iframe
          key={`${clientId}:${appKey}`}
          ref={iframeRef}
          srcDoc={srcDoc}
          title={app?.label || 'App'}
          style={frameStyle}
        />
      )}
    </div>
  );
}
