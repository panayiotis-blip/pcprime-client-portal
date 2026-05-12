import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, hasPermission } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type Alert = {
  id: number;
  triggered_at: string;
  severity: 'info' | 'warning' | 'critical';
  kind: string;
  summary: string;
  evidence: any;
};

const SEVERITY_STYLE: Record<Alert['severity'], { bg: string; border: string; color: string; icon: string }> = {
  info:     { bg: '#dbeafe', border: '#3b82f6', color: '#1e3a8a', icon: 'ℹ️' },
  warning:  { bg: '#fef3c7', border: '#f59e0b', color: '#78350f', icon: '⚠️' },
  critical: { bg: '#fee2e2', border: '#dc2626', color: '#7f1d1d', icon: '🚨' },
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function SecurityAlertsBanner() {
  const { user } = useAuth();
  const canSee = hasPermission(user, 'audit.read');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const load = async () => {
    try {
      const data = await api.getAuditAlerts({ open_only: true, limit: 10 });
      setAlerts(data as Alert[]);
    } catch {
      // Silent fail — alerts banner shouldn't break the dashboard
    }
  };

  useEffect(() => {
    if (!canSee) return;
    load();
    // Poll every 60s so newly-fired alerts show up without a refresh
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [canSee]);

  const handleAcknowledge = async (alertId: number) => {
    try {
      await api.acknowledgeAuditAlert(alertId);
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (err: any) {
      alert('Failed to acknowledge: ' + err.message);
    }
  };

  if (!canSee || alerts.length === 0) return null;

  // Worst-severity styling drives the banner colour
  const worst = alerts.reduce<Alert['severity']>((acc, a) => {
    if (a.severity === 'critical') return 'critical';
    if (a.severity === 'warning' && acc !== 'critical') return 'warning';
    return acc;
  }, 'info');
  const style = SEVERITY_STYLE[worst];

  return (
    <div style={{
      padding: '14px 16px', marginBottom: 16,
      background: style.bg, border: `1px solid ${style.border}`,
      borderLeft: `4px solid ${style.border}`,
      borderRadius: 8, color: style.color,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
      }}>
        <strong style={{ fontSize: 15 }}>
          {style.icon} {alerts.length} security alert{alerts.length === 1 ? '' : 's'} need{alerts.length === 1 ? 's' : ''} your review
        </strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-sm"
            onClick={() => setCollapsed(c => !c)}
            style={{ background: 'transparent', border: `1px solid ${style.border}`, color: style.color }}
          >
            {collapsed ? 'Show details' : 'Hide details'}
          </button>
          <Link to="/audit" className="btn btn-sm" style={{ background: style.border, color: 'white' }}>
            Open audit log
          </Link>
        </div>
      </div>

      {!collapsed && (
        <ul style={{ margin: '10px 0 0 0', padding: 0, listStyle: 'none' }}>
          {alerts.map(a => {
            const aStyle = SEVERITY_STYLE[a.severity];
            return (
              <li key={a.id} style={{
                padding: '8px 10px', marginTop: 6,
                background: 'rgba(255,255,255,0.6)',
                borderLeft: `3px solid ${aStyle.border}`, borderRadius: 4,
                display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>
                    <span style={{ marginRight: 6 }}>{aStyle.icon}</span>
                    {a.summary}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {fmtTime(a.triggered_at)} · {a.kind} · {a.severity}
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => handleAcknowledge(a.id)}
                  title="Mark as reviewed — removes from this banner"
                  style={{ background: '#0f172a', color: 'white', whiteSpace: 'nowrap' }}
                >
                  Mark reviewed
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
