import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getClientApp } from '../../services/clientApps';
import { PanelSkeleton } from '../ui';

// Embeds a CSP-clean per-client app (from public/<app>/) and bridges its data
// to Supabase (client_app_data, migration 161). The app is loaded via iframe
// srcdoc — which sidesteps the portal's X-Frame-Options: DENY — and talks to
// the portal over postMessage: it posts "ready", we inject the document +
// the portal user's role/name; it posts "save", we upsert (debounced).

export default function ClientAppHost({ clientId, appKey }: { clientId: number; appKey: string }) {
  const { user } = useAuth();
  const app = getClientApp(appKey);

  const [doc, setDoc] = useState<any | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [srcDoc, setSrcDoc] = useState('');
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<any>(null);
  const saveTimer = useRef<any>(null);

  const appRole = (user as any)?.role === 'client' ? 'editor' : 'admin';
  const appName = (user as any)?.display_name || (user as any)?.full_name || (user as any)?.username || (user as any)?.email || 'Staff';

  // Fetch the app shell once.
  useEffect(() => {
    if (!app) { setErr('Unknown app: ' + appKey); return; }
    fetch(app.asset + 'index.html')
      .then(r => r.text())
      .then(setSrcDoc)
      .catch(e => setErr('Could not load the app: ' + (e?.message || e)));
  }, [app, appKey]);

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
  if (docLoading || !srcDoc) return <PanelSkeleton rows={8} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, minHeight: 18 }}>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: saveState === 'error' ? '#b91c1c' : '#64748b' }}>{saveLabel}</span>
      </div>
      <iframe
        key={`${clientId}:${appKey}`}
        ref={iframeRef}
        srcDoc={srcDoc}
        title={app?.label || 'App'}
        style={{ width: '100%', height: 'calc(100vh - 210px)', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f4f6f9' }}
      />
    </div>
  );
}
