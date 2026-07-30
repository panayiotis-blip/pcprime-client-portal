import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { getClientApp } from '../../services/clientApps';
import ClientAppHost from './ClientAppHost';

// Post-login entry for NON-STAFF users (App access Phase 3). Works out where a
// person can go from their single email login:
//   - Client Portal (if they're a portal client, i.e. role 'client'), and/or
//   - each app they hold a grant for (client_app_grants, migration 164).
// One destination → go straight there. Several → show a chooser. App-only users
// (role 'app_user') never touch the portal shell — they get the app full-screen.
// The choice is remembered for the browser session so a refresh doesn't re-ask;
// a fresh login (new session) asks again, and "Switch app" returns to the chooser.

type AppDest = { type: 'app'; appKey: string; clientId: number; role: string };
type PortalDest = { type: 'portal' };
type Dest = AppDest | PortalDest;

const CHOICE_KEY = 'pc_app_choice';
const readChoice = (): Dest | null => { try { const s = sessionStorage.getItem(CHOICE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const writeChoice = (d: Dest) => { try { sessionStorage.setItem(CHOICE_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
const clearChoice = () => { try { sessionStorage.removeItem(CHOICE_KEY); } catch { /* ignore */ } };
const doLogout = async () => { clearChoice(); await api.logout(); };

export default function ClientEntry({ portalElement }: { portalElement: ReactNode }) {
  const { user } = useAuth();
  const isPortalClient = (user as any)?.role === 'client';
  const [apps, setApps] = useState<AppDest[] | null>(null);
  const [choice, setChoice] = useState<Dest | null>(() => readChoice());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [appRows, grants] = await Promise.all([api.getMyClientApps(), api.getMyAppGrants()]);
        const roleFor = (clientId: number, appKey: string) =>
          grants.find(g => g.client_id === clientId && g.app_key === appKey)?.role;
        const list: AppDest[] = appRows.map(r => ({
          type: 'app', appKey: r.app_key, clientId: r.client_id,
          role: roleFor(r.client_id, r.app_key) ?? (isPortalClient ? 'editor' : 'admin'),
        }));
        if (alive) setApps(list);
      } catch { if (alive) setApps([]); }
    })();
    return () => { alive = false; };
  }, [isPortalClient]);

  const destinations: Dest[] = useMemo(() => {
    const d: Dest[] = [];
    if (isPortalClient) d.push({ type: 'portal' });
    if (apps) d.push(...apps);
    return d;
  }, [apps, isPortalClient]);

  if (apps === null) return <div className="loading-screen">Loading…</div>;

  // A remembered choice only counts if it still matches an available destination.
  const valid = !!choice && (choice.type === 'portal'
    ? destinations.some(d => d.type === 'portal')
    : destinations.some(d => d.type === 'app' && d.appKey === (choice as AppDest).appKey && d.clientId === (choice as AppDest).clientId));
  const effective: Dest | null = (valid ? choice : null) ?? (destinations.length === 1 ? destinations[0] : null);

  if (destinations.length === 0) {
    return (
      <CenteredCard title="No access yet">
        <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6 }}>
          Your account doesn't have access to the portal or any app yet. Please contact your accountant.
        </p>
        <div style={{ marginTop: 16 }}><button onClick={doLogout} style={linkBtn}>Log out</button></div>
      </CenteredCard>
    );
  }

  if (!effective) return <Chooser destinations={destinations} onPick={d => { writeChoice(d); setChoice(d); }} />;

  if (effective.type === 'portal') return <>{portalElement}</>;

  return <FullScreenApp dest={effective} canSwitch={destinations.length > 1} onSwitch={() => { clearChoice(); setChoice(null); }} />;
}

// ---- Chooser ----
function Chooser({ destinations, onPick }: { destinations: Dest[]; onPick: (d: Dest) => void }) {
  const { user } = useAuth();
  const name = (user as any)?.full_name || (user as any)?.display_name || (user as any)?.email || '';
  return (
    <div style={pageStyle}>
      <div style={{ width: 'min(680px,94vw)' }}>
        <h1 style={{ color: '#fff', textAlign: 'center', fontSize: 24, margin: '0 0 4px' }}>Welcome{name ? `, ${name}` : ''}</h1>
        <p style={{ color: '#c7d2fe', textAlign: 'center', margin: '0 0 24px', fontSize: 14 }}>Where would you like to go?</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
          {destinations.map((d, i) => {
            const app = d.type === 'app' ? getClientApp(d.appKey) : null;
            const icon = d.type === 'portal' ? '🏠' : (app?.icon || '📦');
            const label = d.type === 'portal' ? 'Client Portal' : (app?.label || (d as AppDest).appKey);
            const sub = d.type === 'portal' ? 'Your documents, invoices and reports' : (app?.description || 'Open app');
            return (
              <button key={i} onClick={() => onPick(d)} style={cardStyle}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,.18)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,.12)')}>
                <span style={{ fontSize: 34 }}>{icon}</span>
                <strong style={{ color: '#0f172a', fontSize: 16 }}>{label}</strong>
                <span style={{ color: '#64748b', fontSize: 12.5, textAlign: 'center' }}>{sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <button onClick={doLogout} style={{ ...linkBtn, color: '#c7d2fe' }}>Log out</button>
        </div>
      </div>
    </div>
  );
}

// ---- Full-screen app (app-only users, or a portal client who chose an app) ----
function FullScreenApp({ dest, canSwitch, onSwitch }: { dest: AppDest; canSwitch: boolean; onSwitch: () => void }) {
  const app = getClientApp(dest.appKey);
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid #e2e8f0', flex: '0 0 auto' }}>
        <span style={{ fontWeight: 700, color: '#1a365d' }}>{app?.icon} {app?.label || 'App'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
          {canSwitch && <button onClick={onSwitch} style={linkBtn}>Switch app</button>}
          <button onClick={doLogout} style={linkBtn}>Log out</button>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '0 12px 8px' }}>
        <ClientAppHost clientId={dest.clientId} appKey={dest.appKey} fullScreen roleOverride={dest.role} />
      </div>
    </div>
  );
}

function CenteredCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={pageStyle}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 30, width: 'min(440px,92vw)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 20, color: '#0f172a' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'linear-gradient(120deg,#141f66,#28348a)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto' };
const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: '#fff', border: 0, borderRadius: 14, padding: '24px 16px', cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,.12)', transition: 'box-shadow .15s' };
const linkBtn: React.CSSProperties = { background: 'none', border: 0, color: '#9b861f', fontSize: 13, cursor: 'pointer', padding: 0 };
