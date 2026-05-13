import { useEffect, useState } from 'react';
import { api, hasPermission } from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';

interface Props { clientId: number; }

type AuditEntry = {
  id: number;
  ts: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: any;
};

const fmtTs = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Tab 11: Audit — entries from the audit log that reference this client.
// Gated on audit.read. Falls back to a friendly message if user lacks the perm.
export default function AuditTab({ clientId }: Props) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const canSee = hasPermission(user, 'audit.read');

  useEffect(() => {
    if (!canSee) return;
    let mounted = true;
    (async () => {
      try {
        // Pull all clients-targeted entries, then filter to this client_id by
        // string match (audit_log.target_id is text).
        const all = await api.getAuditLog({ target_type: 'clients', limit: 200 });
        if (!mounted) return;
        const filtered = (all as AuditEntry[]).filter(e => e.target_id === String(clientId));
        setEntries(filtered);
      } catch {
        setEntries([]);
      }
    })();
    return () => { mounted = false; };
  }, [canSee, clientId]);

  if (!canSee) {
    return (
      <div className="client-tab-content">
        <div className="empty-state">
          <p>Audit log access requires the <code>audit.read</code> permission.</p>
        </div>
      </div>
    );
  }

  if (entries === null) return <div className="loading-screen">Loading…</div>;

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Audit history ({entries.length})</h3>
        {entries.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>No audit entries reference this client yet.</p>
        ) : (
          <div className="compliance-table-wrapper">
            <table className="compliance-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(e.ts)}</td>
                    <td>{e.actor_email || '—'}</td>
                    <td><code>{e.action}</code></td>
                    <td style={{ maxWidth: 360 }}>
                      {e.summary ? (
                        <details>
                          <summary style={{ cursor: 'pointer', fontSize: 11, color: '#475569' }}>view</summary>
                          <pre style={{ fontSize: 10, margin: '4px 0 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {JSON.stringify(e.summary, null, 2)}
                          </pre>
                        </details>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
