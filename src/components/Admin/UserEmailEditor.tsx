import { useEffect, useState } from 'react';
import { api } from '../../services/api';

// Admin-facing per-user email (SMTP) setup. Mirrors Settings → Email but lets a
// user with users.write configure email FOR another staff member, via the
// admin_* SMTP RPCs (migration 115). The "Send test" button relays through that
// user's own account using send-via-outlook's as_user_id path.

type Provider = 'outlook' | 'gmail' | 'custom';
const PRESETS: Record<Exclude<Provider, 'custom'>, { host: string; port: number; secure: boolean }> = {
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  gmail:   { host: 'smtp.gmail.com',     port: 587, secure: false },
};
function detectProvider(host: string): Provider {
  const h = (host || '').toLowerCase();
  if (h.includes('office365') || h.includes('outlook.com')) return 'outlook';
  if (h.includes('gmail') || h.includes('googlemail')) return 'gmail';
  return 'custom';
}

type Props = {
  userId: string;
  userName: string;
  defaultEmail?: string;   // pre-fill the address for a brand-new setup
  onClose: () => void;
};

export default function UserEmailEditor({ userId, userName, defaultEmail, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  // Default to Gmail — the firm runs Google Workspace.
  const [provider, setProvider]     = useState<Provider>('gmail');
  const [smtpHost, setSmtpHost]     = useState(PRESETS.gmail.host);
  const [smtpPort, setSmtpPort]     = useState<number>(PRESETS.gmail.port);
  const [smtpSecure, setSmtpSecure] = useState(PRESETS.gmail.secure);
  const [smtpUser, setSmtpUser]     = useState(defaultEmail || '');
  const [fromName, setFromName]     = useState('');
  const [isActive, setIsActive]     = useState(true);
  const [password, setPassword]     = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [lastError, setLastError]   = useState<string | null>(null);
  const [statusMsg, setStatusMsg]   = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const row = await api.adminGetUserSmtpSettings(userId);
        if (cancelled) return;
        if (row) {
          setSmtpHost(row.smtp_host);
          setSmtpPort(row.smtp_port);
          setSmtpSecure(row.smtp_secure);
          setSmtpUser(row.smtp_user);
          setFromName(row.from_name || '');
          setIsActive(row.is_active);
          setHasPassword(row.has_password);
          setSignatureHtml(row.signature_html || '');
          setSignatureText(row.signature_text || '');
          setLastUsedAt(row.last_used_at);
          setLastError(row.last_error);
          setProvider(detectProvider(row.smtp_host));
        }
      } catch (e: any) {
        if (!cancelled) setStatusMsg({ kind: 'err', text: 'Could not load: ' + e.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const pickProvider = (p: Provider) => {
    setProvider(p);
    if (p !== 'custom') {
      setSmtpHost(PRESETS[p].host);
      setSmtpPort(PRESETS[p].port);
      setSmtpSecure(PRESETS[p].secure);
    }
  };

  const handleSave = async () => {
    if (!smtpUser.trim()) { setStatusMsg({ kind: 'err', text: 'Email address is required.' }); return; }
    setSaving(true);
    setStatusMsg(null);
    try {
      await api.adminSaveUserSmtpSettings(userId, {
        smtp_host: smtpHost,
        smtp_port: smtpPort,
        smtp_secure: smtpSecure,
        smtp_user: smtpUser.trim(),
        from_name: fromName.trim() || null,
        is_active: isActive,
        signature_html: signatureHtml.trim() || null,
        signature_text: signatureText.trim() || null,
      });
      if (password) {
        await api.adminSetUserSmtpPassword(userId, password);
        setHasPassword(true);
        setPassword('');
      }
      setStatusMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Save failed: ' + e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!hasPassword) { setStatusMsg({ kind: 'err', text: 'Save the app password first, then send a test.' }); return; }
    setTesting(true);
    setStatusMsg(null);
    try {
      await api.sendViaOutlook({
        as_user_id: userId,
        to: smtpUser.trim(),
        subject: 'Test email from PC Prime portal',
        body:
          `Hello ${userName},\n\n` +
          'This is a test message sent from the PC Prime client portal through your email account.\n' +
          'If you can read this, your SMTP connection is working.\n\n' +
          'Sent: ' + new Date().toLocaleString('en-GB') + '\n',
      });
      setStatusMsg({ kind: 'ok', text: `Test sent to ${smtpUser.trim()} — check that inbox.` });
      // Refresh last-used / last-error.
      const row = await api.adminGetUserSmtpSettings(userId);
      if (row) { setLastUsedAt(row.last_used_at); setLastError(row.last_error); }
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Test failed: ' + e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove ${userName}'s email settings? They won't be able to send mail from the app until re-entered.`)) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      await api.adminDeleteUserSmtpSettings(userId);
      setHasPassword(false);
      setPassword('');
      setLastUsedAt(null);
      setLastError(null);
      setStatusMsg({ kind: 'ok', text: 'Settings removed.' });
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Could not delete: ' + e.message });
    } finally {
      setSaving(false);
    }
  };

  const providerLabels: Record<Provider, string> = {
    outlook: 'Microsoft 365 / Outlook',
    gmail:   'Google Workspace / Gmail',
    custom:  'Custom SMTP',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 620, maxHeight: '92vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0, color: '#1a365d' }}>Email setup — {userName}</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 0 }}>
          Connect this staff member's email account so the portal can send on their behalf.
          The app password is encrypted at rest and never shown again.
        </p>

        {loading ? <p>Loading…</p> : (
          <>
            {/* Provider picker */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
              {(['gmail', 'outlook', 'custom'] as Provider[]).map(p => (
                <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" checked={provider === p} onChange={() => pickProvider(p)} />
                  {providerLabels[p]}
                </label>
              ))}
            </div>

            {provider === 'gmail' && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, padding: '8px 10px', marginBottom: 12, fontSize: 12.5, color: '#1e40af' }}>
                Gmail needs a 16-character <strong>app password</strong> (2-Step Verification must be on for that
                Google account). Create it at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a> and paste it below (no spaces).
              </div>
            )}

            <div className="form-grid">
              <div className="form-group full-width">
                <label>Email address *</label>
                <input type="email" className="form-input" value={smtpUser}
                  onChange={e => setSmtpUser(e.target.value)}
                  placeholder="user@primeandcalculate.com" autoComplete="off" />
                <small style={{ color: '#64748b', fontSize: '0.78em' }}>Used as both the SMTP login and the "From" address.</small>
              </div>

              <div className="form-group full-width">
                <label>App password {hasPassword && <span style={{ color: '#15803d', fontSize: '0.82em' }}>· already configured</span>}</label>
                <input type="password" className="form-input" value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={hasPassword ? '••••••••••••••••  (leave blank to keep current)' : 'Paste the 16-character app password'}
                  autoComplete="new-password" />
              </div>

              <div className="form-group">
                <label>Display name (optional)</label>
                <input type="text" className="form-input" value={fromName}
                  onChange={e => setFromName(e.target.value)} placeholder="e.g. Andreas — PC Prime" />
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
                  <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                  Active (send through this account)
                </label>
              </div>

              <div className="form-group full-width">
                <details open={provider === 'custom'}>
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
                </details>
              </div>

              <div className="form-group full-width">
                <label>HTML signature (optional)</label>
                <textarea className="form-input" rows={4} value={signatureHtml}
                  onChange={e => setSignatureHtml(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                  placeholder={'<div><strong>Name</strong><br>PC Prime & Calculate Consultants Ltd</div>'} />
              </div>
              <div className="form-group full-width">
                <label>Plain-text signature (optional)</label>
                <textarea className="form-input" rows={3} value={signatureText}
                  onChange={e => setSignatureText(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                  placeholder={'Name\nPC Prime & Calculate Consultants Ltd'} />
              </div>
            </div>

            {statusMsg && (
              <div style={{
                marginTop: 12, padding: '8px 10px', borderRadius: 4, fontSize: '0.88em', whiteSpace: 'pre-wrap',
                background: statusMsg.kind === 'ok' ? '#dcfce7' : '#fee2e2',
                color: statusMsg.kind === 'ok' ? '#15803d' : '#b91c1c',
                border: `1px solid ${statusMsg.kind === 'ok' ? '#86efac' : '#fca5a5'}`,
              }}>{statusMsg.text}</div>
            )}
            {lastError && <div style={{ marginTop: 8, fontSize: '0.78em', color: '#b91c1c' }}><strong>Last send error:</strong> {lastError}</div>}
            {lastUsedAt && <div style={{ marginTop: 4, fontSize: '0.78em', color: '#64748b' }}>Last successful send: {new Date(lastUsedAt).toLocaleString('en-GB')}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-link btn-sm" onClick={handleDelete} disabled={saving || !hasPassword} style={{ color: '#b91c1c' }}>
                Remove settings
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={handleSendTest} disabled={saving || testing || !hasPassword}
                  title={hasPassword ? `Sends a test to ${smtpUser || 'the address'}` : 'Save the app password first'}>
                  {testing ? 'Sending…' : '✉ Send test'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving || testing}>Close</button>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
