import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { getClientApp } from '../../services/clientApps';
import ClientAppHost from './ClientAppHost';
import { PanelSkeleton } from '../ui';

// Client-side host for an app (route /my-apps/:appKey). Resolves which of the
// user's clients has this app enabled (RLS-narrowed) and embeds it.

export default function MyClientApp() {
  const { appKey = '' } = useParams();
  const app = getClientApp(appKey);
  const [clientId, setClientId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getMyClientApps()
      .then(rows => {
        const row = rows.find(r => r.app_key === appKey);
        setClientId(row ? row.client_id : null);
      })
      .catch(() => setClientId(null))
      .finally(() => setLoading(false));
  }, [appKey]);

  return (
    <div className="dashboard" style={{ padding: '0.75rem 1rem' }}>
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0 }}>{app?.icon} {app?.label || 'App'}</h2>
      </div>
      {loading ? (
        <PanelSkeleton rows={8} />
      ) : !app ? (
        <div className="empty-state"><p>Unknown app.</p></div>
      ) : clientId == null ? (
        <div className="empty-state"><p>This app isn't enabled for your account.</p></div>
      ) : (
        <ClientAppHost clientId={clientId} appKey={appKey} />
      )}
    </div>
  );
}
