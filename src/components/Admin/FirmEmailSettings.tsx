import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

// Firm sending identity (info@primeandcalculate.com). All client-facing mail in
// the portal goes out through this single shared account, so the firm presents
// one consistent address and replies land in the shared Inbox. Backed by the
// admin_*_firm_email_settings RPCs (migration 117); password encrypted at rest.

export default function FirmEmailSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [smtpHost, setSmtpHost]     = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort]     = useState<number>(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser]     = useState('info@primeandcalculate.com');
  const [fromName, setFromName]     = useState('PC Prime & Calculate Consultants Ltd');
  const [isActive, setIsActive]     = useState(true);
  const [password, setPassword]     = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const row = await api.adminGetFirmEmailSettings();
      if (row) {
        setSmtpHost(row.smtp_host || 'smtp.gmail.com');
        setSmtpPort(row.smtp_port ?? 587);
        setSmtpSecure(!!row.smtp_secure);
        if (row.smtp_user) setSmtpUser(row.smtp_user);
        setFromName(row.from_name || '');
        setIsActive(row.is_active);
        setHasPassword(row.has_password);
        setSignatureHtml(row.signature_html || '');
        setSignatureText(row.signature_text || '');
      }
    } catch (e: any) {
      setStatus({ kind: 'err', text: 'Could not load: ' + e.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!smtpUser.trim()) { setStatus({ kind: 'err', text: 'The firm email address is required.' }); return; }
    setSaving(true);
    setStatus(null);
    try {
      await api.adminSaveFirmEmailSettings({
        smtp_host: smtpHost, smtp_port: smtpPort, smtp_secure: smtpSecure,
        smtp_user: smtpUser.trim(), from_name: fromName.trim() || null, is_active: isActive,
        signature_html: signatureHtml.trim() || null, signature_text: signatureText.trim() || null,
      });
      if (password) { await api.adminSetFirmEmailPassword(password); setHasPassword(true); setPassword(''); }
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (e: any) {
      setStatus({ kind: 'err', text: 'Save failed: ' + e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!hasPassword) { setStatus({ kind: 'err', text: 'Save the app password first, then send a test.' }); return; }
    setTesting(true);
    setStatus(null);
    try {
      await api.sendViaOutlook({
        from_firm: true,
        to: smtpUser.trim(),
        subject: 'Test email from the firm account',
        body:
          'This is a test sent through the firm email account (info@) from the PC Prime portal.\n' +
          'If you can read this, client-facing mail will go out from this address.\n\n' +
          'Sent: ' + new Date().toLocaleString('en-GB') + '\n',
      });
      setStatus({ kind: 'ok', text: `Test sent from ${smtpUser.trim()} to itself — check the info@ inbox (or the shared Inbox once connected).` });
    } catch (e: any) {
      setStatus({ kind: 'err', text: 'Test failed: ' + e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/" className="btn btn-link btn-sm" style={{ padding: 0 }}>← Back to dashboard</Link>
      </div>
      <h2 style={{ marginTop: 0, color: '#1a365d' }}>Firm Email — info@</h2>
      <p style={{ color: '#64748b', fontSize: '0.92em' }}>
        The shared account all client-facing mail is sent from (statements, engagement letters,
        document emails, bulk sends). One firm identity; replies come back to the shared Inbox.
        Credentials are encrypted at rest.
      </p>

      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, padding: '8px 10px', marginBottom: 14, fontSize: 12.5, color: '#1e40af' }}>
        This is a Gmail/Google Workspace mailbox, so it needs a 16-character <strong>app password</strong>
        (2-Step Verification must be on for info@). Create it at{' '}
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>{' '}
        while signed in as info@, and paste it below.
      </div>

      {loading ? <p>Loading…</p> : (
        <div className="card" style={{ padding: 16 }}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Firm email address *</label>
              <input type="email" className="form-input" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="info@primeandcalculate.com" autoComplete="off" />
              <small style={{ color: '#64748b', fontSize: '0.78em' }}>The SMTP login and the "From" address on all firm mail.</small>
            </div>
            <div className="form-group full-width">
              <label>App password {hasPassword && <span style={{ color: '#15803d', fontSize: '0.82em' }}>· already configured</span>}</label>
              <input type="password" className="form-input" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={hasPassword ? '••••••••••••••••  (leave blank to keep current)' : 'Paste the 16-character app password'} autoComplete="new-password" />
            </div>
            <div className="form-group">
              <label>Display name</label>
              <input type="text" className="form-input" value={fromName} onChange={e => setFromName(e.target.value)} placeholder="PC Prime & Calculate Consultants Ltd" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                Active (send firm mail through this account)
              </label>
            </div>
            <div className="form-group full-width">
              <details>
                <summary style={{ cursor: 'pointer', color: '#64748b', fontSize: '0.85em' }}>Advanced — SMTP server settings</summary>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                  <div><label style={{ fontSize: '0.78em' }}>Host</label><input type="text" className="form-input form-input-sm" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} /></div>
                  <div><label style={{ fontSize: '0.78em' }}>Port</label><input type="number" className="form-input form-input-sm" value={smtpPort} onChange={e => setSmtpPort(parseInt(e.target.value, 10) || 587)} /></div>
                  <div>
                    <label style={{ fontSize: '0.78em', display: 'block' }}>Security</label>
                    <select className="form-input form-input-sm" value={smtpSecure ? 'ssl' : 'starttls'} onChange={e => setSmtpSecure(e.target.value === 'ssl')}>
                      <option value="starttls">STARTTLS (587)</option>
                      <option value="ssl">SSL/TLS (465)</option>
                    </select>
                  </div>
                </div>
              </details>
            </div>
            <div className="form-group full-width">
              <label>HTML signature (optional)</label>
              <textarea className="form-input" rows={4} value={signatureHtml} onChange={e => setSignatureHtml(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} placeholder={'<div><strong>PC Prime & Calculate Consultants Ltd</strong><br>+357 ... · info@primeandcalculate.com</div>'} />
            </div>
            <div className="form-group full-width">
              <label>Plain-text signature (optional)</label>
              <textarea className="form-input" rows={3} value={signatureText} onChange={e => setSignatureText(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} placeholder={'PC Prime & Calculate Consultants Ltd\n+357 ... | info@primeandcalculate.com'} />
            </div>
          </div>

          {status && (
            <div style={{
              marginTop: 12, padding: '8px 10px', borderRadius: 4, fontSize: '0.88em', whiteSpace: 'pre-wrap',
              background: status.kind === 'ok' ? '#dcfce7' : '#fee2e2',
              color: status.kind === 'ok' ? '#15803d' : '#b91c1c',
              border: `1px solid ${status.kind === 'ok' ? '#86efac' : '#fca5a5'}`,
            }}>{status.text}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16, gap: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={handleSendTest} disabled={saving || testing || !hasPassword}>
              {testing ? 'Sending…' : '✉ Send test'}
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
