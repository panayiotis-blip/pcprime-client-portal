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
  // Signature builder fields.
  const [sig, setSig] = useState({
    name: '', title: '', firm: '', phone: '', mobile: '', email: '',
    website: '', address: '', tagline: '', logoUrl: '', logoWidth: 120,
  });
  const [logoBusy, setLogoBusy] = useState(false);

  const escHtml = (t: string) => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));

  // Build the professional "logo-left + gold divider" signature (email-safe
  // table layout, navy/gold brand). Empty fields are simply omitted.
  const buildSignatureHtml = (): string => {
    const NAVY = '#0d1b2e', GOLD = '#b8963e', MUTED = '#5a6478';
    const detail = (val: string, href?: string, label = '') =>
      val ? `<div style="margin:1px 0;">${label}${href ? `<a href="${href}" style="color:${NAVY};text-decoration:none;">${escHtml(val)}</a>` : escHtml(val)}</div>` : '';
    const site = sig.website ? (sig.website.startsWith('http') ? sig.website : `https://${sig.website}`) : '';
    const detailsCol =
      `<td style="border-left:2px solid ${GOLD};padding-left:16px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">` +
      (sig.name ? `<div style="font-size:15px;font-weight:bold;color:${NAVY};">${escHtml(sig.name)}</div>` : '') +
      (sig.title ? `<div style="color:${GOLD};font-weight:600;font-size:13px;">${escHtml(sig.title)}</div>` : '') +
      (sig.firm ? `<div style="color:${NAVY};font-size:13px;">${escHtml(sig.firm)}</div>` : '') +
      `<div style="height:6px;line-height:6px;">&nbsp;</div>` +
      detail(sig.phone, undefined, 'T&nbsp;') +
      detail(sig.mobile, undefined, 'M&nbsp;') +
      detail(sig.email, `mailto:${sig.email}`) +
      detail(sig.website, site) +
      (sig.address ? `<div style="margin-top:4px;color:${MUTED};font-size:12px;">${escHtml(sig.address)}</div>` : '') +
      (sig.tagline ? `<div style="margin-top:6px;color:${MUTED};font-size:11px;font-style:italic;">${escHtml(sig.tagline)}</div>` : '') +
      `</td>`;
    const logoCol = sig.logoUrl
      ? `<td style="padding-right:16px;vertical-align:top;"><img src="${escHtml(sig.logoUrl)}" alt="${escHtml(sig.firm || 'Logo')}" width="${sig.logoWidth || 120}" style="display:block;border:0;width:${sig.logoWidth || 120}px;height:auto;"></td>`
      : '';
    return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${NAVY};line-height:1.4;"><tr>${logoCol}${detailsCol}</tr></table>`;
  };

  const buildSignatureText = (): string => [
    sig.name, sig.title, sig.firm,
    [sig.phone && `T ${sig.phone}`, sig.mobile && `M ${sig.mobile}`].filter(Boolean).join('  |  '),
    sig.email, sig.website, sig.address,
  ].filter(Boolean).join('\n');

  const generateSignature = () => {
    if (!sig.name && !sig.firm) { setStatus({ kind: 'err', text: 'Add at least a name or firm name first.' }); return; }
    setSignatureHtml(buildSignatureHtml());
    setSignatureText(buildSignatureText());
    setStatus({ kind: 'ok', text: 'Signature generated — check the preview, then click Save Settings.' });
  };

  const useCompanyLogo = async () => {
    try {
      const cs = await api.getCompanySettings();
      if (cs?.logo_url) setSig(s => ({ ...s, logoUrl: cs.logo_url }));
      else setStatus({ kind: 'err', text: 'No logo set in Company Settings yet — upload one there or paste a URL here.' });
    } catch (e: any) { setStatus({ kind: 'err', text: e.message }); }
  };

  const uploadLogo = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setStatus({ kind: 'err', text: 'Logo must be under 5 MB.' }); return; }
    setLogoBusy(true);
    try {
      const url = await api.uploadCompanyLogo(file);
      setSig(s => ({ ...s, logoUrl: url }));
    } catch (e: any) {
      setStatus({ kind: 'err', text: 'Upload failed: ' + e.message });
    } finally { setLogoBusy(false); }
  };

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
        setSig(s => ({ ...s, firm: s.firm || row.from_name || '', email: s.email || row.smtp_user || '' }));
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
            <div className="form-group full-width" style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, background: '#fbfcfe' }}>
              <label style={{ fontWeight: 700, color: '#1a365d' }}>✨ Signature builder</label>
              <p style={{ fontSize: '0.78em', color: '#64748b', margin: '2px 0 10px' }}>
                Fill these in and click <strong>Generate</strong> — it builds a professional signature (logo + your navy/gold brand) into the HTML box below. Then click Save Settings.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label style={{ fontSize: '0.78em' }}>Full name</label><input className="form-input form-input-sm" value={sig.name} onChange={e => setSig(s => ({ ...s, name: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Title / role</label><input className="form-input form-input-sm" value={sig.title} onChange={e => setSig(s => ({ ...s, title: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Firm name</label><input className="form-input form-input-sm" value={sig.firm} onChange={e => setSig(s => ({ ...s, firm: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Phone</label><input className="form-input form-input-sm" value={sig.phone} onChange={e => setSig(s => ({ ...s, phone: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Mobile</label><input className="form-input form-input-sm" value={sig.mobile} onChange={e => setSig(s => ({ ...s, mobile: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Email</label><input className="form-input form-input-sm" value={sig.email} onChange={e => setSig(s => ({ ...s, email: e.target.value }))} /></div>
                <div><label style={{ fontSize: '0.78em' }}>Website</label><input className="form-input form-input-sm" value={sig.website} onChange={e => setSig(s => ({ ...s, website: e.target.value }))} placeholder="www.primeandcalculate.com" /></div>
                <div><label style={{ fontSize: '0.78em' }}>Office address</label><input className="form-input form-input-sm" value={sig.address} onChange={e => setSig(s => ({ ...s, address: e.target.value }))} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '0.78em' }}>Tagline / disclaimer (optional)</label><input className="form-input form-input-sm" value={sig.tagline} onChange={e => setSig(s => ({ ...s, tagline: e.target.value }))} /></div>
              </div>

              <div style={{ marginTop: 10, padding: 8, background: '#f1f5f9', borderRadius: 6 }}>
                <label style={{ fontSize: '0.78em', fontWeight: 600 }}>Logo</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <input className="form-input form-input-sm" style={{ flex: 1, minWidth: 200 }} placeholder="Paste a logo image URL, or use / upload →"
                    value={sig.logoUrl} onChange={e => setSig(s => ({ ...s, logoUrl: e.target.value }))} />
                  <button type="button" className="btn btn-secondary btn-sm" onClick={useCompanyLogo}>Use company logo</button>
                  <label className="btn btn-secondary btn-sm" style={{ margin: 0, cursor: 'pointer' }}>
                    {logoBusy ? 'Uploading…' : '⬆ Upload'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                  </label>
                  <span style={{ fontSize: '0.78em', color: '#64748b' }}>Width&nbsp;
                    <input type="number" className="form-input form-input-sm" style={{ width: 64, display: 'inline-block' }} value={sig.logoWidth} onChange={e => setSig(s => ({ ...s, logoWidth: parseInt(e.target.value, 10) || 120 }))} />&nbsp;px
                  </span>
                </div>
                {sig.logoUrl && <img src={sig.logoUrl} alt="logo preview" style={{ maxHeight: 48, marginTop: 8, display: 'block' }} />}
              </div>

              <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={generateSignature}>✨ Generate signature</button>

              {signatureHtml && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: '0.78em', color: '#64748b' }}>Preview</label>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, background: '#fff' }} dangerouslySetInnerHTML={{ __html: signatureHtml }} />
                </div>
              )}
            </div>
            <div className="form-group full-width">
              <label>HTML signature <span style={{ color: '#94a3b8', fontSize: '0.8em' }}>(generated above — edit here if needed)</span></label>
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
