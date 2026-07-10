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
  signature_html: string | null;
  signature_text: string | null;
  updated_at: string;
};

// Provider presets — host / port / SSL pre-fills. The send-via-outlook
// Edge Function is generic SMTP under the hood; the legacy function name
// is kept (renaming it would require redeployment) but the UI now speaks
// in terms of the underlying provider you actually have.
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

export default function EmailSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<Provider>('outlook');
  const [smtpHost, setSmtpHost] = useState(PRESETS.outlook.host);
  const [smtpPort, setSmtpPort] = useState<number>(PRESETS.outlook.port);
  const [smtpSecure, setSmtpSecure] = useState(PRESETS.outlook.secure);
  const [smtpUser, setSmtpUser] = useState('');
  const [fromName, setFromName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  // Signature — what gets appended to every outgoing email.
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureText, setSignatureText] = useState('');
  // Per-user signature builder — personal details per user; firm name/logo from
  // company_settings (never hardcoded).
  const [sig, setSig] = useState({
    name: '', subtitle: '', title: '', phone: '', mobile: '', email: '',
    website: '', firm: '', confidentiality: '', logoUrl: '', logoWidth: 120,
  });
  const [logoBusy, setLogoBusy] = useState(false);

  const escHtml = (t: string) => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

  // Generate a clean HTML signature with real <br> breaks and a grey
  // confidentiality notice. Empty fields are omitted.
  const buildSignatureHtml = (): string => {
    const NAVY = '#1a365d', MUTED = '#888';
    const A = 'font-family:Arial,Helvetica,sans-serif;';
    const site = sig.website ? (sig.website.startsWith('http') ? sig.website : `https://${sig.website}`) : '';
    const contact: string[] = [];
    if (sig.phone)   contact.push(`t: ${escHtml(sig.phone)}`);
    if (sig.mobile)  contact.push(`m: ${escHtml(sig.mobile)}`);
    if (sig.email)   contact.push(`e: <a href="mailto:${escHtml(sig.email)}" style="color:${NAVY};text-decoration:none;">${escHtml(sig.email)}</a>`);
    if (sig.website) contact.push(`w: <a href="${escHtml(site)}" style="color:${NAVY};text-decoration:none;">${escHtml(sig.website)}</a>`);
    const logo = sig.logoUrl ? `<img src="${escHtml(sig.logoUrl)}" alt="${escHtml(sig.firm || 'Logo')}" width="${sig.logoWidth || 120}" style="display:block;border:0;width:${sig.logoWidth || 120}px;height:auto;margin-bottom:8px;">` : '';
    return `<div style="${A}font-size:13px;color:${NAVY};line-height:1.5;">` +
      logo +
      (sig.name ? `<div style="font-weight:bold;font-size:15px;">${escHtml(sig.name)}</div>` : '') +
      (sig.subtitle ? `<div>${escHtml(sig.subtitle)}</div>` : '') +
      (sig.title ? `<div>${escHtml(sig.title)}</div>` : '') +
      (sig.firm ? `<div>${escHtml(sig.firm)}</div>` : '') +
      (contact.length ? `<div style="margin-top:6px;">${contact.join('<br>')}</div>` : '') +
      (sig.confidentiality ? `<div style="font-size:11px;color:${MUTED};margin-top:10px;line-height:1.4;">${escHtml(sig.confidentiality)}</div>` : '') +
      `</div>`;
  };

  const buildSignatureText = (): string => {
    const parts: string[] = [];
    for (const v of [sig.name, sig.subtitle, sig.title, sig.firm]) if (v) parts.push(v);
    const contact = [
      sig.phone && `t: ${sig.phone}`, sig.mobile && `m: ${sig.mobile}`,
      sig.email && `e: ${sig.email}`, sig.website && `w: ${sig.website}`,
    ].filter(Boolean);
    if (contact.length) parts.push(contact.join('\n'));
    if (sig.confidentiality) parts.push('\n' + sig.confidentiality);
    return parts.join('\n');
  };

  const generateSignature = () => {
    if (!sig.name && !sig.firm) { setStatusMsg({ kind: 'err', text: 'Add at least your name or the firm name first.' }); return; }
    setSignatureHtml(buildSignatureHtml());
    setSignatureText(buildSignatureText());
    setStatusMsg({ kind: 'ok', text: 'Signature generated — check the preview, then Save Settings.' });
  };

  const useCompanyLogo = async () => {
    try {
      const cs = await api.getCompanySettings();
      if (cs?.logo_url) setSig(s => ({ ...s, logoUrl: cs.logo_url }));
      else setStatusMsg({ kind: 'err', text: 'No firm logo in Company Settings yet — upload one there or paste a URL here.' });
    } catch (e: any) { setStatusMsg({ kind: 'err', text: e.message }); }
  };

  const uploadLogo = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setStatusMsg({ kind: 'err', text: 'Logo must be under 5 MB.' }); return; }
    setLogoBusy(true);
    try {
      const url = await api.uploadCompanyLogo(file);
      setSig(s => ({ ...s, logoUrl: url }));
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Upload failed: ' + e.message });
    } finally { setLogoBusy(false); }
  };

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
        setSignatureHtml(row.signature_html || '');
        setSignatureText(row.signature_text || '');
        setSig(s => ({ ...s, email: s.email || row.smtp_user || '' }));
        // Pick the right provider radio based on host so the instructions match.
        setProvider(detectProvider(row.smtp_host));
      }
    } catch (e: any) {
      setStatusMsg({ kind: 'err', text: 'Could not load settings: ' + e.message });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Firm name from company_settings (never hardcoded) to prefill the builder.
  useEffect(() => {
    api.getCompanySettings()
      .then(cs => setSig(s => ({ ...s, firm: s.firm || cs?.name || '' })))
      .catch(() => {});
  }, []);

  const handlePickProvider = (p: Provider) => {
    setProvider(p);
    if (p !== 'custom') {
      const preset = PRESETS[p];
      setSmtpHost(preset.host);
      setSmtpPort(preset.port);
      setSmtpSecure(preset.secure);
    }
  };

  const handleSave = async () => {
    if (!smtpUser.trim()) {
      setStatusMsg({ kind: 'err', text: 'Email address is required.' });
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      await api.saveMySmtpSettings({
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
    if (!confirm('Remove your email SMTP settings? You will need to re-enter them to send email from the app again.')) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      await api.deleteMySmtpSettings();
      const preset = PRESETS.outlook;
      setProvider('outlook');
      setSmtpHost(preset.host);
      setSmtpPort(preset.port);
      setSmtpSecure(preset.secure);
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
          'This is a test message sent from the PC Prime client portal through your email account.\n' +
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

  const providerLabels: Record<Provider, string> = {
    outlook: 'Microsoft 365 / Outlook',
    gmail:   'Google Workspace / Gmail',
    custom:  'Custom SMTP',
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/" className="btn btn-link btn-sm" style={{ padding: 0 }}>← Back to dashboard</Link>
      </div>
      <h2 style={{ marginTop: 0, color: '#1a365d' }}>Email Settings — SMTP</h2>
      <p style={{ color: '#64748b', fontSize: '0.92em' }}>
        Connect your email account so the app can send messages on your behalf —
        engagement letters, scheduler reminders, printed client lists, tax computations and more.
        Credentials are encrypted at rest with a Vault-stored key.
      </p>

      {/* Provider picker */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#1a365d', marginBottom: 8 }}>Email provider</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {(['outlook', 'gmail', 'custom'] as Provider[]).map(p => (
            <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="radio" checked={provider === p} onChange={() => handlePickProvider(p)} />
              {providerLabels[p]}
            </label>
          ))}
        </div>
      </div>

      {/* Provider-specific app-password instructions */}
      {provider === 'outlook' && (
        <details style={{ background: '#fffbeb', border: '1px solid #f5e8b8', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }} open>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#92670e' }}>📘 How to get a Microsoft app password</summary>
          <ol style={{ fontSize: '0.88em', color: '#5a6478', marginTop: 8, paddingLeft: 22, lineHeight: 1.55 }}>
            <li>Sign in to <a href="https://account.microsoft.com/security" target="_blank" rel="noreferrer">account.microsoft.com/security</a> with your Outlook account.</li>
            <li>Enable two-step verification if it's not already on (Microsoft requires this for app passwords).</li>
            <li>Go to <strong>Advanced security options</strong> → <strong>App passwords</strong> → <strong>Create a new app password</strong>.</li>
            <li>Microsoft generates a 16-character password. Paste it into the field below — you won't see it again.</li>
            <li><strong>Microsoft 365 tenant admins:</strong> SMTP AUTH must be enabled at the tenant level
              (Exchange admin → Mail flow → Authenticated SMTP). Some tenants disable it by default.</li>
          </ol>
        </details>
      )}
      {provider === 'gmail' && (
        <details style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }} open>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#1e40af' }}>📘 How to get a Google app password</summary>
          <ol style={{ fontSize: '0.88em', color: '#5a6478', marginTop: 8, paddingLeft: 22, lineHeight: 1.55 }}>
            <li>Sign in to your Google account at <a href="https://myaccount.google.com" target="_blank" rel="noreferrer">myaccount.google.com</a>.</li>
            <li>Go to <strong>Security</strong> and ensure <strong>2-Step Verification</strong> is ON. Google requires this before app passwords can be created.</li>
            <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>.</li>
            <li>Name it (e.g. <em>"PC Prime portal"</em>) and click <strong>Create</strong>. Google generates a 16-character code — paste it into the field below (no spaces).</li>
            <li><strong>Google Workspace admins:</strong> "Less secure app access" is gone — only app passwords with 2FA work for SMTP. If 2-Step Verification isn't allowed for your account by the admin, ask them to enable it.</li>
          </ol>
        </details>
      )}
      {provider === 'custom' && (
        <details style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 4, padding: '10px 12px', marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>📘 Custom SMTP server</summary>
          <p style={{ fontSize: '0.88em', color: '#5a6478', marginTop: 8, lineHeight: 1.55 }}>
            Enter the host, port and security mode for your SMTP server in the Advanced section below.
            Common ports: <strong>587</strong> with STARTTLS, or <strong>465</strong> with SSL/TLS. Username is usually the
            full email address; password is whatever credential your SMTP server expects (often an app password).
          </p>
        </details>
      )}

      {loading ? <p>Loading…</p> : (
        <div className="card" style={{ padding: 16 }}>
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Email address *</label>
              <input
                type="email"
                className="form-input"
                value={smtpUser}
                onChange={e => setSmtpUser(e.target.value)}
                placeholder={provider === 'gmail' ? 'you@gmail.com or you@firm.com' : 'you@outlook.com or you@yourdomain.com'}
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
                placeholder={hasPassword ? '••••••••••••••••  (leave blank to keep current)' : 'Paste the 16-character app password'}
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
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
                  Provider radio above auto-fills these. Pick "Custom SMTP" to edit freely.
                </p>
              </details>
            </div>
          </div>

          {/* Email signature — auto-appended by send-via-outlook to every
              outbound message. HTML version goes on rich-text emails (e.g.
              engagement letters); plain-text version goes on text-only
              messages and as the fallback for HTML-disabled clients. */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: 14, color: '#1a365d', margin: '0 0 4px' }}>Email signature</h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>
              Appended to every email you send through the app. Leave blank to send without a signature.
            </p>

            {/* Signature builder — personal details per user; firm name/logo from company_settings */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, background: '#fbfcfe', marginBottom: 12 }}>
              <label style={{ fontWeight: 700, color: '#1a365d' }}>✨ Signature builder</label>
              <p style={{ fontSize: '0.78em', color: '#64748b', margin: '2px 0 10px' }}>
                Fill these in and click <strong>Generate</strong> — it builds a clean signature (with a grey confidentiality notice) into the HTML box below, then click Save Settings.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label style={{ fontSize: '0.78em' }}>Full name</label><input className="form-input form-input-sm" value={sig.name} onChange={e => setSig(s => ({ ...s, name: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Line under name (optional)</label><input className="form-input form-input-sm" value={sig.subtitle} onChange={e => setSig(s => ({ ...s, subtitle: e.target.value }))} placeholder="e.g. (unsigned) electronic transmission" /></div>
                <div><label style={{ fontSize: '0.78em' }}>Title / qualification</label><input className="form-input form-input-sm" value={sig.title} onChange={e => setSig(s => ({ ...s, title: e.target.value }))} placeholder="e.g. Professional Accountant (SA)" /></div>
                <div><label style={{ fontSize: '0.78em' }}>Firm name</label><input className="form-input form-input-sm" value={sig.firm} onChange={e => setSig(s => ({ ...s, firm: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Phone (t:)</label><input className="form-input form-input-sm" value={sig.phone} onChange={e => setSig(s => ({ ...s, phone: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Mobile (m:)</label><input className="form-input form-input-sm" value={sig.mobile} onChange={e => setSig(s => ({ ...s, mobile: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Email (e:)</label><input className="form-input form-input-sm" value={sig.email} onChange={e => setSig(s => ({ ...s, email: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Website (w:)</label><input className="form-input form-input-sm" value={sig.website} onChange={e => setSig(s => ({ ...s, website: e.target.value }))} placeholder="www.firm.com" /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '0.78em' }}>Confidentiality notice (shown small &amp; grey, optional)</label><textarea className="form-input form-input-sm" rows={3} value={sig.confidentiality} onChange={e => setSig(s => ({ ...s, confidentiality: e.target.value }))} placeholder="CONFIDENTIALITY NOTICE: This email and any attachments are confidential…" /></div>
              </div>
              <div style={{ marginTop: 10, padding: 8, background: '#f1f5f9', borderRadius: 6 }}>
                <label style={{ fontSize: '0.78em', fontWeight: 600 }}>Logo (optional)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <input className="form-input form-input-sm" style={{ flex: 1, minWidth: 200 }} placeholder="Paste a logo URL, or use / upload →" value={sig.logoUrl} onChange={e => setSig(s => ({ ...s, logoUrl: e.target.value }))} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={useCompanyLogo}>Use company logo</button>
                  <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: 'pointer' }}>{logoBusy ? 'Uploading…' : '⬆ Upload'}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} /></label>
                  <span style={{ fontSize: '0.78em', color: '#64748b' }}>Width&nbsp;<input type="number" className="form-input form-input-sm" style={{ width: 64, display: 'inline-block' }} value={sig.logoWidth} onChange={e => setSig(s => ({ ...s, logoWidth: parseInt(e.target.value, 10) || 120 }))} />&nbsp;px</span>
                </div>
                {sig.logoUrl && <img src={sig.logoUrl} alt="logo preview" style={{ maxHeight: 44, marginTop: 8, display: 'block' }} />}
              </div>
              <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={generateSignature}>✨ Generate signature</button>
              {signatureHtml && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: '0.78em', color: '#64748b' }}>Preview</label>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, background: '#fff' }} dangerouslySetInnerHTML={{ __html: signatureHtml }} />
                </div>
              )}
            </div>

            <div className="form-grid">
              <div className="form-group full-width">
                <label>HTML signature (rich)</label>
                <textarea
                  className="form-input"
                  rows={6}
                  value={signatureHtml}
                  onChange={e => setSignatureHtml(e.target.value)}
                  placeholder={`<div style="color:#1a365d;">
  <strong>Your Name</strong><br>
  PC Prime & Calculate Consultants Ltd<br>
  +357 22 000 000 · you@firm.com<br>
  www.firm.com
</div>`}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                />
                <small style={{ color: '#64748b', fontSize: '0.78em' }}>
                  HTML allowed. The function inserts a thin grey rule above it on outbound mail.
                </small>
              </div>
              <div className="form-group full-width">
                <label>Plain-text fallback</label>
                <textarea
                  className="form-input"
                  rows={4}
                  value={signatureText}
                  onChange={e => setSignatureText(e.target.value)}
                  placeholder={`Your Name
PC Prime & Calculate Consultants Ltd
+357 22 000 000 | you@firm.com
www.firm.com`}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                />
                <small style={{ color: '#64748b', fontSize: '0.78em' }}>
                  Used by clients that don't render HTML, and as the bottom of plain-text emails.
                </small>
              </div>
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
              whiteSpace: 'pre-wrap',
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
            the <code>send-via-outlook</code> Edge Function (legacy name, works with any SMTP), which connects to{' '}
            <code>{smtpHost}:{smtpPort}</code> using these credentials and relays a message back to you.
            Once that round-trip works, the Email PDF and engagement-letter sends across the portal will go out the same way.
          </div>
        </div>
      )}
    </div>
  );
}
