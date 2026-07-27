import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { generateEngagementLetterPdf, fetchLogoDataUrl } from '../../services/engagementLetterPdf';

// Public page rendered from /accept-engagement/:token. Anonymous —
// the only auth is the token in the URL. The page fetches a summary
// of the letter and offers two actions: download the PDF and accept
// with a typed signature.

type RpcLetter = any;

export default function EngagementAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [letter, setLetter] = useState<RpcLetter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setError('Missing token.'); setLoading(false); return; }
      try {
        const row = await api.getEngagementLetterByToken(token);
        if (cancelled) return;
        if (!row) { setError('Letter not found, or the link has expired.'); return; }
        setLetter(row);
        if (row.status === 'accepted') setAccepted(true);
      } catch (err: any) {
        if (!cancelled) setError('Failed to load: ' + (err?.message || String(err)));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Build the data the existing PDF generator expects from the RPC shape.
  const buildPdfData = async () => {
    if (!letter) return null;
    const logoDataUrl = letter.firm_logo_url
      ? await fetchLogoDataUrl(letter.firm_logo_url)
      : null;
    return {
      client: {
        name: letter.client_name || '',
        legal_name: letter.client_legal_name,
        address: letter.client_address,
        city: letter.client_city,
        country: letter.client_country,
        tax_number: letter.client_tax_number,
        vat_number: letter.client_vat_number,
        registration_number: letter.client_registration_number,
        id_number: letter.client_id_number,
      },
      firm: {
        name: letter.firm_name,
        legal_name: letter.firm_legal_name,
        registration_number: letter.firm_registration_number,
        tax_id: letter.firm_tax_id,
        vat_number: letter.firm_vat_number,
        address_line1: letter.firm_address_line1,
        address_line2: letter.firm_address_line2,
        city: letter.firm_city,
        postal_code: letter.firm_postal_code,
        country: letter.firm_country,
        phone: letter.firm_phone,
        email: letter.firm_email,
        website: letter.firm_website,
        iban: letter.firm_iban,
        bank_name: letter.firm_bank_name,
        logo_url: letter.firm_logo_url,
        logo_data_url: logoDataUrl,
        letterhead_logo_position: letter.firm_logo_position,
        letterhead_logo_height: letter.firm_logo_height,
      },
      version: letter.version,
      effective_from: letter.effective_from,
      effective_to: letter.effective_to,
      engagement_type: letter.engagement_type,
      fee_mode: letter.fee_mode,
      annual_estimate: letter.annual_estimate,
      services: Array.isArray(letter.services) ? letter.services : [],
      hourly_rate_director: letter.hourly_rate_director,
      hourly_rate_manager: letter.hourly_rate_manager,
      hourly_rate_support: letter.hourly_rate_support,
      discount_percent: letter.discount_percent,
      min_monthly_fee: letter.min_monthly_fee,
      annual_review_notice_days: letter.annual_review_notice_days,
      currency: letter.currency || 'EUR',
      engagement_leader: letter.engagement_leader,
      cover_letter_text: letter.cover_letter_text,
      intro_text: letter.intro_text,
      terms_text: letter.terms_text,
    };
  };

  const handleDownload = async () => {
    const data = await buildPdfData();
    if (data) generateEngagementLetterPdf(data, 'save');
  };

  const handleAccept = async () => {
    if (!signature.trim()) { alert('Please type your name.'); return; }
    if (!agreed) { alert('Please tick the confirmation box.'); return; }
    setSubmitting(true);
    try {
      const r = await api.acceptEngagementLetterByToken(token!, signature.trim());
      if (r.ok || r.already_accepted) {
        setAccepted(true);
      } else {
        alert('Accept failed: ' + (r.error || 'unknown'));
      }
    } catch (err: any) {
      alert('Accept failed: ' + (err?.message || String(err)));
    } finally { setSubmitting(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '20px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {loading ? (
          <p style={{ textAlign: 'center' }}>Loading…</p>
        ) : error ? (
          <div style={{ background: '#fff', padding: 28, borderRadius: 8, border: '1px solid #fecaca' }}>
            <h2 style={{ color: '#b91c1c', marginTop: 0 }}>Link not available</h2>
            <p style={{ color: '#475569' }}>{error}</p>
            <p style={{ fontSize: 13, color: '#64748b' }}>If you believe this is wrong, please reply to the email or contact your accountant.</p>
          </div>
        ) : letter ? (
          <div style={{ background: '#fff', padding: 28, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: 16, marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>Engagement letter</div>
                <h1 style={{ margin: '4px 0 0', color: '#1a365d', fontSize: 22 }}>{letter.firm_name || letter.firm_legal_name}</h1>
                <p style={{ margin: '4px 0 0', color: '#5a6478', fontSize: 13 }}>
                  Version {letter.version}{letter.engagement_type === 'one_off' ? ' · one-off project' : ' · annual engagement'}
                </p>
              </div>
              {letter.firm_logo_url && (
                <img src={letter.firm_logo_url} alt="" style={{ maxHeight: 48, maxWidth: 140, objectFit: 'contain' }} />
              )}
            </div>

            <div style={{ marginBottom: 18 }}>
              <p style={{ color: '#1a365d', margin: '0 0 4px', fontSize: 15 }}>
                Dear {letter.client_legal_name || letter.client_name},
              </p>
              <p style={{ color: '#5a6478', margin: 0, fontSize: 14 }}>
                We've prepared an engagement letter for your acceptance. Please download and review
                the full PDF, then either reply to the original email or accept online using the form below.
              </p>
            </div>

            <div style={{ background: '#f1f5f9', borderRadius: 6, padding: 16, marginBottom: 18 }}>
              <h3 style={{ marginTop: 0, color: '#1a365d', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Summary</h3>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#475569' }}>
                <strong>Period:</strong> {letter.effective_from || '—'} to {letter.effective_to || '—'}
              </p>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#475569' }}>
                <strong>Engagement leader:</strong> {letter.engagement_leader || '—'}
              </p>
              {letter.engagement_type === 'one_off'
                ? <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                    <strong>Project fee:</strong> €{Number(letter.annual_estimate || 0).toFixed(2)} (invoiced on completion)
                  </p>
                : <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                    <strong>Annual fee:</strong> €{Number(letter.annual_estimate || 0).toFixed(2)}{' '}
                    (≈ €{(Number(letter.annual_estimate || 0) / 12).toFixed(2)} per month)
                  </p>}
            </div>

            <button className="btn btn-secondary" onClick={handleDownload} style={{ marginBottom: 20 }}>
              ⬇ Download full PDF
            </button>

            {accepted ? (
              <div style={{ padding: 16, background: '#dcfce7', borderRadius: 6, border: '1px solid #86efac' }}>
                <h3 style={{ margin: '0 0 4px', color: '#166534' }}>✓ Accepted</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#15803d' }}>
                  This engagement letter has been accepted{letter.accepted_signature ? ` by ${letter.accepted_signature}` : ''}.
                  Thank you. We'll be in touch with next steps.
                </p>
              </div>
            ) : (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 18 }}>
                <h3 style={{ marginTop: 0, color: '#1a365d' }}>Accept online</h3>
                <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px' }}>
                  Type your full name to confirm you have read and accept the engagement letter
                  as set out in the PDF.
                </p>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#475569' }}>
                  Your full name
                </label>
                <input
                  type="text" value={signature} onChange={(e) => setSignature(e.target.value)}
                  className="form-input" style={{ width: '100%', fontSize: 15, marginBottom: 12 }}
                  placeholder="e.g. Maria Constantinou"
                />
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#475569', cursor: 'pointer', marginBottom: 16 }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>
                    I confirm that I have read the engagement letter and accept its terms on behalf
                    of <strong>{letter.client_legal_name || letter.client_name}</strong>.
                  </span>
                </label>
                <button className="btn btn-primary" onClick={handleAccept} disabled={submitting || !signature.trim() || !agreed}>
                  {submitting ? 'Submitting…' : 'Accept engagement'}
                </button>
              </div>
            )}

            <p style={{ marginTop: 28, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
              {letter.firm_legal_name || letter.firm_name}
              {letter.firm_email && <> · <a href={`mailto:${letter.firm_email}`} style={{ color: '#1e40af' }}>{letter.firm_email}</a></>}
              {letter.firm_phone && <> · {letter.firm_phone}</>}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
