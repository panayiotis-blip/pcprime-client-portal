import { useEffect, useState } from 'react';
import { api } from '../../services/api';

type Row = {
  permission: string;
  granted_by_default: boolean;
  override: boolean | null;
};

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
}

// Per-user permissions editor. Lists every known permission with its role
// default and any per-user override. Owner toggles via Default / Grant / Revoke.
// Saves are immediate (no separate Save button).
export default function UserPermissionsEditor({ userId, userName, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getUserPermissions(userId);
      setRows(data);
    } catch (err: any) {
      alert('Failed to load permissions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

  const setOverride = async (perm: string, granted: boolean | null) => {
    setBusy(b => ({ ...b, [perm]: true }));
    try {
      await api.setUserPermission(userId, perm, granted);
      setRows(rs => rs.map(r => r.permission === perm ? { ...r, override: granted } : r));
    } catch (err: any) {
      alert('Failed to update: ' + err.message);
    } finally {
      setBusy(b => ({ ...b, [perm]: false }));
    }
  };

  const effective = (r: Row) => (r.override === null ? r.granted_by_default : r.override);

  return (
    <div className="form-section" style={{ marginTop: 16, padding: 12, background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Permissions — {userName}</h3>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 12px 0' }}>
        Each permission has a default from the user's role. Click <strong>Grant</strong> or <strong>Revoke</strong> to
        override the default for this user only, or <strong>Default</strong> to remove the override. Changes save immediately;
        the user sees them at their next login.
      </p>
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No permissions defined for this user.</p>
      ) : (
        <div className="compliance-table-wrapper">
          <table className="compliance-table">
            <thead>
              <tr>
                <th>Permission</th>
                <th style={{ width: 90,  textAlign: 'center' }}>Default</th>
                <th style={{ width: 130, textAlign: 'center' }}>Effective</th>
                <th style={{ width: 260 }}>Override</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.permission}>
                  <td><code>{r.permission}</code></td>
                  <td style={{ textAlign: 'center' }}>{r.granted_by_default ? '✓' : '✗'}</td>
                  <td style={{ textAlign: 'center', fontWeight: r.override !== null ? 600 : 400 }}>
                    {effective(r) ? '✓' : '✗'}
                    {r.override !== null && (
                      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>
                        ({r.override ? 'granted' : 'revoked'})
                      </span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      className={`btn btn-sm ${r.override === null ? 'btn-primary' : 'btn-secondary'}`}
                      disabled={busy[r.permission]}
                      onClick={() => setOverride(r.permission, null)}
                    >Default</button>
                    <button
                      className={`btn btn-sm ${r.override === true ? 'btn-primary' : 'btn-secondary'}`}
                      disabled={busy[r.permission]}
                      style={{ marginLeft: 4 }}
                      onClick={() => setOverride(r.permission, true)}
                    >Grant</button>
                    <button
                      className={`btn btn-sm ${r.override === false ? 'btn-primary' : 'btn-secondary'}`}
                      disabled={busy[r.permission]}
                      style={{ marginLeft: 4 }}
                      onClick={() => setOverride(r.permission, false)}
                    >Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
