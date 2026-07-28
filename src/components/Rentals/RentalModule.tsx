import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { PanelSkeleton } from '../ui';

// Property Rentals module. Embeds the ported rental app (public/rental-app,
// CSP-clean: external scripts, no inline handlers) via an iframe srcdoc — which
// sidesteps the portal's X-Frame-Options: DENY. Data flows over postMessage:
// on the app's "ready" we inject the client's Supabase document; on its "save"
// we upsert it back. Login is the portal's; the app runs with the portal
// user's identity + role.

type RentalClient = { id: number; name: string; client_code: string | null };

export default function RentalModule() {
  const { clientId: clientIdParam } = useParams();
  const { user } = useAuth();
  const [clients, setClients] = useState<RentalClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<any | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [srcDoc, setSrcDoc] = useState('');
  const [err, setErr] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<any>(null);
  const clientIdRef = useRef<number | null>(null);
  const saveTimer = useRef<any>(null);

  // Firm staff run as "admin"; a client's own users as "editor" (both can edit).
  const appRole = (user as any)?.role === 'client' ? 'editor' : 'admin';
  const appName = (user as any)?.display_name || (user as any)?.full_name || (user as any)?.username || (user as any)?.email || 'Staff';

  const selectedId = clientIdParam ? Number(clientIdParam) : (clients.length === 1 ? clients[0].id : null);
  const selected = clients.find(c => c.id === selectedId) || null;

  useEffect(() => {
    api.getRentalClients()
      .then(setClients)
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setLoading(false));
    // Fetch the app shell once (same-origin) to feed the iframe srcdoc.
    fetch('/rental-app/index.html')
      .then(r => r.text())
      .then(setSrcDoc)
      .catch(e => setErr('Could not load the rental app shell: ' + (e?.message || e)));
  }, []);

  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => { clientIdRef.current = selectedId; }, [selectedId]);

  // Load the selected client's document.
  useEffect(() => {
    if (!selectedId) { setDoc(null); return; }
    setDocLoading(true);
    setSaveState('idle');
    api.getRentalData(selectedId)
      .then(r => setDoc(r?.data ?? {}))
      .catch(e => setErr(e?.message || String(e)))
      .finally(() => setDocLoading(false));
  }, [selectedId]);

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
        const cid = clientIdRef.current;
        if (!cid) return;
        setSaveState('saving');
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          try { await api.saveRentalData(cid, m.data); setSaveState('saved'); }
          catch { setSaveState('error'); }
        }, 300);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [appRole, appName, user]);

  const saveLabel = saveState === 'saving' ? '● Saving…'
    : saveState === 'saved' ? '✓ Saved'
    : saveState === 'error' ? '⚠ Save failed'
    : '';

  return (
    <div className="dashboard" style={{ padding: '0.75rem 1rem' }}>
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>🏠 Property Rentals</h2>
        {selected && (
          <>
            <span style={{ color: '#64748b' }}>·</span>
            <strong style={{ color: '#1a365d' }}>{selected.name}</strong>
            {clients.length > 1 && <Link to="/rentals" style={{ fontSize: 13, color: '#1e40af' }}>← change</Link>}
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: saveState === 'error' ? '#b91c1c' : '#64748b' }}>{saveLabel}</span>
      </div>

      {loading ? (
        <PanelSkeleton rows={6} />
      ) : err ? (
        <div className="empty-state"><p style={{ color: '#b91c1c' }}>{err}</p></div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <p>The rental module isn't enabled for any client you can access.</p>
          <p style={{ fontSize: 13, color: '#64748b' }}>Enable it per client with <code>clients.rental_enabled = true</code>.</p>
        </div>
      ) : !selectedId ? (
        <div style={{ maxWidth: 480 }}>
          <p style={{ fontSize: 13, color: '#64748b' }}>Choose a client:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clients.map(c => (
              <Link key={c.id} to={`/rentals/${c.id}`} className="btn btn-secondary" style={{ textAlign: 'left' }}>
                {c.client_code ? <span className="client-code-inline">{c.client_code}</span> : null}{c.name}
              </Link>
            ))}
          </div>
        </div>
      ) : docLoading || !srcDoc ? (
        <PanelSkeleton rows={8} />
      ) : (
        <iframe
          key={selectedId}
          ref={iframeRef}
          srcDoc={srcDoc}
          title="Property Rentals"
          style={{ width: '100%', height: 'calc(100vh - 140px)', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f4f6f9' }}
        />
      )}
    </div>
  );
}
