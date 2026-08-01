import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, isStaffRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getClientApp, loadAppTemplates } from '../../services/clientApps';
import ClientAppHost from '../Client/ClientAppHost';

// Staff apps launcher (/apps) — the blank, chrome-free screen the firm lands on
// when it signs in at /app. It lists every app in use across ALL clients,
// grouped BY APP: one tile per app, and where several clients use that app, a
// dropdown to pick which one to open. Adding a new app to clients makes it
// appear here on its own; no per-client hunting.
//
// This is the STAFF view. Clients keep the view they already had: ClientEntry
// shows only the apps their own grants cover. Non-staff who land here are sent
// back there. Because the route sits inside the authed portal tree, the usual
// gates still apply first — staff pass the authenticator challenge before they
// ever reach this screen.

type Row = { client_id: number; client_name: string | null; app_key: string };
type Opened = { appKey: string; clientId: number };

export default function AppsLauncher() {
  const { user } = useAuth();
  const staff = isStaffRole(user);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [logos, setLogos] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [opened, setOpened] = useState<Opened | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!staff) return;
    let alive = true;
    (async () => {
      try {
        await loadAppTemplates();
        const apps = await api.getMyClientApps();
        if (!alive) return;
        setRows(apps);
        const ids = [...new Set(apps.map(a => a.client_id))];
        try { const l = await api.getClientLogos(ids); if (alive) setLogos(l); } catch { /* logos are optional */ }
      } catch (e: any) {
        if (alive) { setErr(e?.message || 'Could not load the apps.'); setRows([]); }
      }
    })();
    return () => { alive = false; };
  }, [staff]);

  // app_key → the clients that have it, by name.
  const byApp = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows || []) {
      const list = m.get(r.app_key) || [];
      list.push(r);
      m.set(r.app_key, list);
    }
    for (const list of m.values()) list.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
    return [...m.entries()].sort((a, b) =>
      (getClientApp(a[0])?.label || a[0]).localeCompare(getClientApp(b[0])?.label || b[0]));
  }, [rows]);

  if (!staff) return <Navigate to="/" replace />;

  if (opened) {
    const app = getClientApp(opened.appKey);
    const client = (rows || []).find(r => r.client_id === opened.clientId && r.app_key === opened.appKey);
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid #e2e8f0', flex: '0 0 auto' }}>
          <button onClick={() => setOpened(null)} style={linkBtn}>← All apps</button>
          <span style={{ fontWeight: 700, color: '#1a365d' }}>{app?.icon} {app?.label || opened.appKey}</span>
          {client?.client_name && <span style={{ color: '#64748b', fontSize: 13 }}>· {client.client_name}</span>}
          <span style={{ marginLeft: 'auto' }}><button onClick={() => api.logout()} style={linkBtn}>Log out</button></span>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: '0 12px 8px' }}>
          <ClientAppHost clientId={opened.clientId} appKey={opened.appKey} fullScreen roleOverride="admin" />
        </div>
      </div>
    );
  }

  if (rows === null) return <div className="loading-screen">Loading…</div>;

  const name = (user as any)?.full_name || (user as any)?.display_name || (user as any)?.email || '';

  return (
    <div style={pageStyle}>
      <div style={{ width: 'min(900px,94vw)' }}>
        <h1 style={{ color: '#fff', textAlign: 'center', fontSize: 24, margin: '0 0 4px' }}>Client Apps</h1>
        <p style={{ color: '#c7d2fe', textAlign: 'center', margin: '0 0 24px', fontSize: 14 }}>
          {name ? `${name} — pick an app, then the client to open it for.` : 'Pick an app, then the client to open it for.'}
        </p>

        {err && <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#9f1239', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        {byApp.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center', color: '#475569', fontSize: 14 }}>
            No client has an app assigned yet. Assign one from a client's <strong>Apps</strong> tab.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
            {byApp.map(([appKey, clients]) => {
              const app = getClientApp(appKey);
              const only = clients.length === 1 ? clients[0] : null;
              const chosenId = picked[appKey] ?? only?.client_id ?? clients[0].client_id;
              const logo = logos[chosenId];
              return (
                <div key={appKey} style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {logo
                      ? <img src={logo} alt="" style={{ width: 38, height: 38, objectFit: 'contain', borderRadius: 8 }} />
                      : <span style={{ fontSize: 30 }}>{app?.icon || '📦'}</span>}
                    <div>
                      <strong style={{ color: '#0f172a', fontSize: 15 }}>{app?.label || appKey}</strong>
                      <div style={{ color: '#94a3b8', fontSize: 12 }}>
                        {clients.length === 1 ? '1 client' : `${clients.length} clients`}
                      </div>
                    </div>
                  </div>

                  {app?.description && <p style={{ color: '#64748b', fontSize: 12.5, margin: '10px 0 0' }}>{app.description}</p>}

                  {only ? (
                    <div style={{ color: '#475569', fontSize: 13, marginTop: 12 }}>{only.client_name || `Client #${only.client_id}`}</div>
                  ) : (
                    <select className="form-input" style={{ marginTop: 12, width: '100%', fontSize: 13 }}
                      value={chosenId} onChange={e => setPicked(p => ({ ...p, [appKey]: Number(e.target.value) }))}>
                      {clients.map(c => (
                        <option key={c.client_id} value={c.client_id}>{c.client_name || `Client #${c.client_id}`}</option>
                      ))}
                    </select>
                  )}

                  <button onClick={() => setOpened({ appKey, clientId: chosenId })}
                    style={{ marginTop: 12, width: '100%', padding: 10, borderRadius: 8, border: 'none', background: '#1e2a78', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    Open
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 22, display: 'flex', gap: 18, justifyContent: 'center' }}>
          <a href="/" style={{ ...linkBtn, color: '#c7d2fe', textDecoration: 'none' }}>Go to the portal →</a>
          <button onClick={() => api.logout()} style={{ ...linkBtn, color: '#c7d2fe' }}>Log out</button>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'linear-gradient(120deg,#141f66,#28348a)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' };
const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', background: '#fff', border: 0, borderRadius: 14, padding: 18, boxShadow: '0 6px 18px rgba(0,0,0,.12)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 0, color: '#9b861f', fontSize: 13, cursor: 'pointer', padding: 0 };
