import { useEffect, useState } from 'react';
import { api, isSupervisorOrHigher } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { CLIENT_APPS } from '../../../services/clientApps';
import ClientAppHost from '../ClientAppHost';
import { PanelSkeleton } from '../../ui';

// Firm-side Apps tab in the client file. Lists the registry apps, lets a
// supervisor enable/disable each for this client, and opens an enabled app
// inline (embedded via ClientAppHost). The client's own users reach the same
// apps from their portal's Apps section.

export default function ClientAppsTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const canManage = isSupervisorOrHigher(user);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setLoading(true);
    api.getClientAppKeys(clientId)
      .then(keys => setEnabled(new Set(keys)))
      .catch(() => setEnabled(new Set()))
      .finally(() => setLoading(false));
  }, [clientId]);

  const toggle = async (key: string, next: boolean) => {
    setBusy(key);
    const snapshot = new Set(enabled);
    setEnabled(prev => { const s = new Set(prev); next ? s.add(key) : s.delete(key); return s; });
    if (!next && open === key) setOpen(null);
    try {
      await api.setClientApp(clientId, key, next);
    } catch (e: any) {
      setEnabled(snapshot);
      alert('Could not update: ' + (e?.message || e));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <PanelSkeleton rows={4} />;

  if (open) {
    const appDef = CLIENT_APPS.find(a => a.key === open);
    return (
      <div>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 8 }} onClick={() => setOpen(null)}>← Back to apps</button>
        <span style={{ marginLeft: 10, fontWeight: 600, color: '#1a365d' }}>{appDef?.icon} {appDef?.label}</span>
        <ClientAppHost clientId={clientId} appKey={open} />
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
        Apps available to this client. Enabled apps also appear in the client's own portal.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {CLIENT_APPS.map(app => {
          const on = enabled.has(app.key);
          return (
            <div key={app.key} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>{app.icon}</span>
                <strong style={{ color: '#1a365d' }}>{app.label}</strong>
                {on && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '1px 8px', borderRadius: 999 }}>Enabled</span>}
              </div>
              {app.description && <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 12px' }}>{app.description}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!on} onClick={() => setOpen(app.key)} title={on ? 'Open the app' : 'Enable it first'}>Open</button>
                {canManage && (
                  <button className="btn btn-secondary btn-sm" disabled={busy === app.key} onClick={() => toggle(app.key, !on)}>
                    {busy === app.key ? '…' : on ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
