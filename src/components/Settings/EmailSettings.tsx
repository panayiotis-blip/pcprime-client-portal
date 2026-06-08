import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

type SmtpRow = {
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  from_name: string | null;
  is_active: boolean;
  has_password: boolean;
  last_used_at: string | null;
  last_error: string | null;
  updated_at: string;
};

const PRESET_OUTLOOK = {
  smtp_host: 'smtp.office365.com',
  smtp_port: 587,
  smtp_secure: false, // STARTTLS on 587
};

export default function EmailSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smtpHost, setSmtpHost] = useState(PRESET_OUTLOOK.smtp_host);
  const [smtpPort, setSmtpPort] = useState<number>(PRESET_OUTLOOK.smtp_port);
  const [smtpSecure, setSmtpSecure] = useState(PRESET_OUTLOOK.smtp_secure);
  const [smtpUser, setSmtpUser] = useState('');
  const [fromName, setFromName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const row = (await api.getMySmtpSettings()) as SmtpRow | null;
      if (row) {
        setSmtpHost(row.smtp_host);
        setSmtpPort(row.smtp_port);
        setSmtpSecure(row.smtp_secure);
        setSmtpUser(row.smtp_user);
        setFromName(row.from_name || '');
        setIsActive(row.is_active);
        setHasPassword(row.has_password);
        setLastUsedAt(row.last_used_at);
        setLastError(row.last_error);
      }
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Could not load settings: ' + e.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!smtpUser.trim()) {
      setStatusMsg({ kind: 'err', text: 'Outlook email is required.' });
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      // First upsert the non-secret fields. This also creates the row if it
      // doesn't exist yet — required before setMySmtpPassword can update
      // the password_enc column.
      await api.saveMySmtpSettings({
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_secure: smtpSecure,
        smtp_user: smtpUser.trim(),
        from_name: fromName.trim() || null,
        is_active: isActive,
      });
      // Only update the password if the user typed a new one. Leaving it
      // blank keeps the existing encrypted value (useful when editing other
      // fields without re-entering the app password).
      if (password) {
        await api.setMySmtpPassword(password);
        setHasPassword(true);
        setPassword('');
      }
      setStatusMsg({ kind: 'ok', text: 'Saved.' });
      await load();
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Save failed: ' + e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remove your Outlook SMTP settings? You will need to re-enter them to send email from the app again.')) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      await api.deleteMySmtpSettings();
      setSmtpHost(PRESET_OUTLOOK.smtp_host);
      setSmtpPort(PRESET_OUTLOOK.smtp_port);
      setSmtpSecure(PRESET_OUTLOOK.smtp_secure);
      setSmtpUser('');
      setFromName('');
      setIsActive(true);
      setHasPassword(false);
      setLastUsedAt(null);
      setLastError(null);
      setStatusMsg({ kind: 'ok', text: 'Settings removed.' });
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Could not delete: ' + e.message });
    } finally {
      setSaving(false);
    }
  };

  const usePreset = () => {
    setSmtpHost(PRESET_OUTLOOK.smtp_host);
    setSmtpPort(PRESET_OUTLOOK.smtp_port);
    setSmtpSecure(PRESET_OUTLOOK.smtp_secure);
  };

  const handleSendTest = async () => {
    if (!hasPassword) {
      setStatusMsg({ kind: 'err', text: 'Save settings + app password first, then send a test.' });
      return;
    }
    setTesting(true);
    setStatusMsg(null);
    try {
      await api.sendViaOutlook({
        to: smtpUser.trim(),
        subject: 'Test email from PC Prime portal',
        body:
          'Hello,\n\n' +
          'This is a test message sent from the PC Prime client portal through your Outlook account.\n' +
          'If you can read this, the SMTP connection is working.\n\n' +
          'Sent: ' + new Date().toLocaleString('en-GB') + '\n',
      });
      setStatusMsg({ kind: 'ok', text: `Test email sent to ${smtpUser.trim()} — check your inbox.` });
      await load();
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Test send failed: ' + e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/" className="btn btn-link btn-sm" style={{ padding: 0 }}>← Back to dashboard</Link>
      </div>
      <h2 style={{ marginTop: 0, color: '#1a365d' }}>Email Settings — Outlook SMTP</h2>
      <p style={{ color: '#64748b', fontSize: '0.92em' }}>
        Connect your Outlook (Microsoft 365 or outlook.com) account so the app can send emails on your behalf —
        including the printed client lists and tax computations. Credentials are encrypted at rest with a Vault-stored key.
      </p>

      {/* App-password instructions */}
      <details style={{ background: '#fffbeb', border: '1px solid #f5e8b8', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#92670e' }}>📘 How to get an Outlook app password</summary>
        <ol style={{ fontSize: '0.88em', color: '#5a6478', marginTop: 8, paddingLeft: 22, lineHeight: 1.55 }}>
          <li>Sign in to <a href="https://account.microsoft.com/security" target="_blank" rel="noreferrer">account.microsoft.com/security</a> with your Outlook account.</li>
          <li>Enable two-step verification if it's not already on (Microsoft requires this for app passwords).</li>
          <li>Go to <strong>Advanced security options</strong> → <strong>App passwords</strong> → <strong>Create a new app password</strong>.</li>
          <li>Microsoft generates a 16-character password. Copy it into the field below — you won't see it again.</li>
          <li><strong>Microsoft 365 admins:</strong> SMTP AUTH must be enabled at the tenant level
            (Exchange admin → Mail flow → Authenticated SMTP). Some tenants disable it by default.</li>
        </ol>
      </details>

      {loading ? <p>Loading…</p> : (
        <div className="card" style={{ padding: 16 }}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Outlook email *</label>
              <input
                type="email"
                className="form-input"
                value={smtpUser}
                onChange={e => setSmtpUser(e.target.value)}
                placeholder="you@outlook.com or you@yourdomain.com"
                autoComplete="username"
              />
              <small style={{ color: '#64748b', fontSize: '0.78em' }}>
                Used as both the SMTP login and the "From" address on outgoing messages.
              </small>
            </div>

            <div className="form-group full-width">
              <label>App password {hasPassword && <span style={{ color: '#15803d', fontSize: '0.82em' }}>· already configured</span>}</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={hasPassword ? '••••••••••••••••  (leave blank to keep current)' : 'Paste the 16-character app password from Microsoft'}
                autoComplete="new-password"
              />
              <small style={{ color: '#64748b', fontSize: '0.78em' }}>
                Encrypted with pgcrypto + a Vault-stored key. Never stored in plaintext.
              </small>
            </div>

            <div className="form-group">
              <label>Display name (optional)</label>
              <input
                type="text"
                className="form-input"
                value={fromName}
                onChange={e => setFromName(e.target.value)}
                placeholder="e.g. PC Prime & Calculate Consultants Ltd"
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                Active (send emails through this account)
              </label>
            </div>

            <div className="form-group full-width">
              <details>
                <summary style={{ cursor: 'pointer', color: '#64748b', fontSize: '0.85em' }}>Advanced — SMTP server settings</summary>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.78em' }}>Host</label>
                    <input type="text" className="form-input form-input-sm" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78em' }}>Port</label>
                    <input type="number" className="form-input form-input-sm" value={smtpPort} onChange={e => setSmtpPort(parseInt(e.target.value, 10) || 587)} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78em', display: 'block' }}>Security</label>
                    <select className="form-input form-input-sm" value={smtpSecure ? 'ssl' : 'starttls'} onChange={e => setSmtpSecure(e.target.value === 'ssl')}>
                      <option value="starttls">STARTTLS (587)</option>
                      <option value="ssl">SSL/TLS (465)</option>
                    </select>
                  </div>
                </div>
                <button type="button" className="btn btn-link btn-sm" onClick={usePreset} style={{ padding: 0, marginTop: 4 }}>
                  Use Microsoft 365 defaults
                </button>
              </details>
            </div>
          </div>

          {statusMsg && (
            <div style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 4,
              fontSize: '0.88em',
              background: statusMsg.kind === 'ok' ? '#dcfce7' : '#fee2e2',
              color: statusMsg.kind === 'ok' ? '#15803d' : '#b91c1c',
              border: `1px solid ${statusMsg.kind === 'ok' ? '#86efac' : '#fca5a5'}`,
            }}>
              {statusMsg.text}
            </div>
          )}

          {lastError && (
            <div style={{ marginTop: 8, fontSize: '0.78em', color: '#b91c1c' }}>
              <strong>Last send error:</strong> {lastError}
            </div>
          )}
          {lastUsedAt && (
            <div style={{ marginTop: 4, fontSize: '0.78em', color: '#64748b' }}>
              Last successful send: {new Date(lastUsedAt).toLocaleString('en-GB')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-link btn-sm" onClick={handleDelete} disabled={saving || !hasPassword} style={{ color: '#b91c1c' }}>
              Remove settings
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSendTest}
                disabled={saving || testing || !hasPassword}
                title={hasPassword ? `Sends a test message to ${smtpUser || 'your address'}` : 'Save your app password first'}
              >
                {testing ? 'Sending…' : '✉ Send test email'}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '0.78em', color: '#64748b' }}>
            <strong>How sending works:</strong> click "✉ Send test email" to verify your settings — the portal calls
            the send-via-outlook Edge Function, which connects to <code>{smtpHost}:{smtpPort}</code> using these
            credentials and relays a message back to you. Once that round-trip works, the Email PDF buttons across
            the portal (Clients → Print List, Tax Returns, etc.) will go out the same way with attachments included.
          </div>
        </div>
      )}
    </div>
  );
}
