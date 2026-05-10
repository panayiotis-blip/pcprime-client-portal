import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import MFAEnrollment from '../Auth/MFAEnrollment';

export default function Security() {
  const { user, mfa, refreshMfa } = useAuth();
  const [factors, setFactors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listMfaFactors() as any;
      setFactors(data?.totp || []);
    } catch (err: any) {
      alert('Failed to load MFA factors: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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

  const verified = factors.filter(f => f.status === 'verified');

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
    </div>
  );
}
