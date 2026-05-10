import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth, TRUSTED_DEVICE_TOKEN_KEY } from '../../context/AuthContext';
import MFAEnrollment from '../Auth/MFAEnrollment';

export default function Security() {
  const { user, mfa, refreshMfa } = useAuth();
  const [factors, setFactors] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [data, dev] = await Promise.all([
        api.listMfaFactors() as any,
        api.listMyTrustedDevices(user.id),
      ]);
      setFactors(data?.totp || []);
      setDevices(dev as any[]);
    } catch (err: any) {
      alert('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const handleDisenroll = async (factorId: string, name: string) => {
    if (!confirm(
      `Remove "${name}"? You will be signed in without two-factor protection until you enroll again. ` +
      'Make sure you really want this.'
    )) return;
    try {
      await api.unenrollMfa(factorId);
      await load();
      await refreshMfa();
    } catch (err: any) {
      alert('Disenroll failed: ' + err.message);
    }
  };

  const onEnrollComplete = async () => {
    setEnrolling(false);
    await load();
    await refreshMfa();
  };

  const handleRevokeDevice = async (id: string, label: string) => {
    if (!confirm(`Revoke trusted device "${label}"? Next sign-in from that device will require the 6-digit code.`)) return;
    try {
      await api.revokeTrustedDevice(id);
      // If we just revoked the device we're currently on, drop the local token
      // so verifyTrustedDevice doesn't keep returning false against a dead row.
      // (Best-effort — we can't tell server-side which row matches local storage.)
      await load();
      await refreshMfa();
    } catch (err: any) {
      alert('Revoke failed: ' + err.message);
    }
  };

  const handleRevokeThisDevice = async () => {
    if (!confirm('Stop trusting this device? You will be asked for the 6-digit code on your next sign-in.')) return;
    // Remove the local token, then revoke on server (requires lookup by hash —
    // simplest: just clear local; server row stays but is unusable here).
    localStorage.removeItem(TRUSTED_DEVICE_TOKEN_KEY);
    await refreshMfa();
    alert('This device is no longer trusted on this browser. To revoke the server-side record, find it below and click Revoke.');
  };

  const verified = factors.filter(f => f.status === 'verified');
  const isThisDeviceTrusted = mfa.trusted_device_validated;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Security</h2>
      </div>

      <div className="form-section">
        <h3 style={{ marginTop: 0 }}>Two-factor authentication (TOTP)</h3>
        <p style={{ color: '#475569', marginTop: 4 }}>
          Signed in as <strong>{user?.email}</strong>.
        </p>

        {mfa.enrolled ? (
          <p style={{ color: '#0a7' }}>✓ Two-factor authentication is enabled on your account.</p>
        ) : (
          <p style={{ color: '#b45309' }}>⚠ Two-factor authentication is not enabled. We strongly recommend enabling it.</p>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            {verified.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong>Active authenticator factors:</strong>
                <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                  {verified.map(f => (
                    <li key={f.id} style={{ marginBottom: 6 }}>
                      {f.friendly_name || f.factor_type} — added {f.created_at?.slice(0, 10)}
                      <button
                        className="btn btn-link btn-sm"
                        style={{ marginLeft: 12 }}
                        onClick={() => handleDisenroll(f.id, f.friendly_name || 'this factor')}
                      >Remove</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!enrolling && verified.length === 0 && (
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setEnrolling(true)}>
                Enroll authenticator app
              </button>
            )}

            {enrolling && (
              <div style={{ marginTop: 16 }}>
                <MFAEnrollment
                  onComplete={onEnrollComplete}
                  onCancel={() => setEnrolling(false)}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="form-section" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Trusted devices</h3>
        <p style={{ color: '#475569', marginTop: 4 }}>
          Devices you've marked as trusted skip the 6-digit prompt at sign-in
          and use a longer inactivity timeout (8 hours instead of 1). Trust
          expires after 30 days.
        </p>

        {isThisDeviceTrusted && (
          <div style={{ padding: '8px 12px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            ✓ This browser is currently a trusted device.
            <button className="btn btn-link btn-sm" style={{ marginLeft: 8 }} onClick={handleRevokeThisDevice}>
              Stop trusting this device
            </button>
          </div>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : devices.length === 0 ? (
          <p style={{ color: '#64748b' }}>No trusted devices yet.</p>
        ) : (
          <table className="compliance-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Device</th>
                <th>Trusted on</th>
                <th>Expires</th>
                <th>Last used</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id}>
                  <td>{d.device_label || <em>Unknown</em>}</td>
                  <td>{d.created_at?.slice(0, 10)}</td>
                  <td>{d.expires_at?.slice(0, 10)}</td>
                  <td>{d.last_used_at ? d.last_used_at.slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>
                    <button className="btn btn-link btn-sm" onClick={() => handleRevokeDevice(d.id, d.device_label || 'this device')}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
