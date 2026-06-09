import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import {
  generateEngagementLetterPdf,
  DEFAULT_INTRO,
  DEFAULT_TERMS,
  type LetterService,
} from '../../services/engagementLetterPdf';

// Two-mode editor: 'new' creates a fresh draft (auto-versioned); 'edit'
// loads an existing draft and lets you change it. Sent / accepted /
// superseded letters open read-only.

type Props = {
  clientId: number;
  client: any;             // for the To: block on the PDF
  letterId?: number;       // if set: edit existing
  onClose: () => void;
  onSaved: () => void;
};

type ServiceDef = { id: number; key: string; label: string };

// PDF generation returns ArrayBuffer when mode='arraybuffer'; convert that
// to base64 (chunked to dodge "Maximum call stack" on bigger PDFs).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(binary);
}

export default function EngagementLetterBuilder({ clientId, client, letterId, onClose, onSaved }: Props) {
  const isEditing = letterId != null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Service catalogue from the Services tab.
  const [services, setServices] = useState<ServiceDef[]>([]);

  // The draft being edited.
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<string>('draft');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [chosen, setChosen] = useState<LetterService[]>([]);
  const [introText, setIntroText] = useState(DEFAULT_INTRO);
  const [termsText, setTermsText] = useState(DEFAULT_TERMS);
  const [notes, setNotes] = useState('');
  const [currency] = useState('EUR');
  // Firm details (for the PDF letterhead)
  const [firm, setFirm] = useState<any>({});
  // Send-modal state
  const [sendToEmail, setSendToEmail] = useState('');
  const [showSendForm, setShowSendForm] = useState(false);

  const totalFee = useMemo(
    () => chosen.reduce((sum, s) => sum + (Number(s.annual_fee) || 0), 0),
    [chosen],
  );

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [svcs, settings] = await Promise.all([
          api.getServiceDefinitions(),
          api.getCompanySettings().catch(() => null),
        ]);
        setServices(svcs as ServiceDef[]);
        setFirm(settings || {});

        if (isEditing && letterId != null) {
          const row = await api.getEngagementLetter(letterId);
          if (row) {
            setVersion(row.version);
            setStatus(row.status);
            setEffectiveFrom(row.effective_from || '');
            setEffectiveTo(row.effective_to || '');
            setChosen(Array.isArray(row.services) ? row.services : []);
            setIntroText(row.intro_text || DEFAULT_INTRO);
            setTermsText(row.terms_text || DEFAULT_TERMS);
            setNotes(row.notes || '');
            // Pre-fill the recipient field
            const clientEmail = Array.isArray(client?.email) ? client.email[0] : client?.email;
            setSendToEmail(clientEmail || '');
          }
        } else {
          // New draft — auto-version + default 12-month effective window.
          const nextV = await api.getNextEngagementLetterVersion(clientId);
          setVersion(nextV);
          const today = new Date();
          const todayIso = today.toISOString().slice(0, 10);
          const oneYearLater = new Date(today);
          oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
          setEffectiveFrom(todayIso);
          setEffectiveTo(oneYearLater.toISOString().slice(0, 10));
          const clientEmail = Array.isArray(client?.email) ? client.email[0] : client?.email;
          setSendToEmail(clientEmail || '');
        }
      } catch (err: any) {
        alert('Load failed: ' + (err?.message || String(err)));
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId, letterId]);

  const editable = !isEditing || status === 'draft';

  const toggleService = (svc: ServiceDef, checked: boolean) => {
    setChosen(prev => {
      if (checked) {
        if (prev.find(p => p.service_id === svc.id)) return prev;
        return [...prev, {
          service_id: svc.id, service_key: svc.key, service_label: svc.label,
          annual_fee: 0, scope_notes: '',
        }];
      }
      return prev.filter(p => p.service_id !== svc.id);
    });
  };

  const updateChosen = (idx: number, patch: Partial<LetterService>) => {
    setChosen(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  // PDF data — built fresh for every preview / send.
  const buildPdfData = () => ({
    client: {
      name: client?.name || '',
      legal_name: client?.legal_name || null,
      address: client?.address || null,
      city: client?.city || null,
      country: client?.country || null,
      tax_number: client?.tax_number || null,
      vat_number: client?.vat_number || null,
      registration_number: client?.registration_number || null,
      id_number: client?.id_number || null,
    },
    firm,
    version,
    effective_from: effectiveFrom || null,
    effective_to: effectiveTo || null,
    services: chosen,
    total_annual_fee: totalFee,
    currency,
    intro_text: introText,
    terms_text: termsText,
  });

  const handlePreview = () => generateEngagementLetterPdf(buildPdfData(), 'save');

  const buildPayload = () => ({
    version,
    effective_from: effectiveFrom || null,
    effective_to: effectiveTo || null,
    services: chosen,
    total_annual_fee: totalFee,
    currency,
    intro_text: introText,
    terms_text: termsText,
    notes: notes || null,
  });

  const handleSaveDraft = async () => {
    if (chosen.length === 0) { alert('Pick at least one service first.'); return; }
    setSaving(true);
    try {
      if (isEditing && letterId != null) {
        await api.updateEngagementLetter(letterId, buildPayload());
      } else {
        await api.createEngagementLetter(clientId, buildPayload());
      }
      onSaved();
      onClose();
    } catch (err: any) {
      alert('Save failed: ' + (err?.message || String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (chosen.length === 0) { alert('Pick at least one service first.'); return; }
    if (!sendToEmail.trim()) { alert('Enter a recipient email.'); return; }
    setSending(true);
    try {
      // 1. Persist the current draft (create or update).
      let id = letterId;
      if (id == null) {
        const created = await api.createEngagementLetter(clientId, buildPayload());
        id = created.id;
      } else if (editable) {
        await api.updateEngagementLetter(id, buildPayload());
      }
      // 2. Generate the PDF as base64 for the attachment.
      const buf = generateEngagementLetterPdf(buildPdfData(), 'arraybuffer') as ArrayBuffer;
      const b64 = arrayBufferToBase64(buf);
      const filename = `engagement-letter-${(client?.name || 'client').replace(/[^\w-]+/g, '_')}-v${version}.pdf`;
      // 3. Send via Outlook (caller's stored SMTP creds).
      await api.sendViaOutlook({
        to: sendToEmail.trim(),
        subject: `Engagement Letter — ${firm?.name || 'Our firm'} — v${version}`,
        body: `Please find attached our engagement letter for your acceptance. Reply with the word "ACCEPTED" to confirm.\n\nKind regards,\n${firm?.name || ''}`,
        html: `<p>Dear ${client?.name || 'client'},</p><p>Please find attached our engagement letter for your acceptance. Reply with the word <strong>"ACCEPTED"</strong> to confirm and we'll proceed.</p><p>Kind regards,<br>${firm?.name || ''}</p>`,
        attachments: [{ filename, contentBase64: b64, contentType: 'application/pdf' }],
      });
      // 4. Stamp as sent + supersede any prior sent/accepted versions.
      await api.markEngagementLetterSent(id!, sendToEmail.trim());
      await api.supersedePriorEngagementLetters(clientId, id!);
      alert('Engagement letter sent. Mark it Accepted from the list once the client confirms.');
      onSaved();
      onClose();
    } catch (err: any) {
      alert('Send failed: ' + (err?.message || String(err)));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 820,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <h3 style={{ margin: 0, color: '#1a365d' }}>
            {isEditing ? `Engagement Letter — v${version}` : 'New Engagement Letter'}
          </h3>
          <span style={{ fontSize: 12, color: '#64748b', textTransform: 'capitalize' }}>{status}</span>
        </div>
        {!editable && (
          <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', padding: '6px 10px', borderRadius: 4, fontSize: 13, color: '#92400e', marginBottom: 10 }}>
            This letter has been {status}. It's read-only — create a new version to make changes.
          </div>
        )}

        {loading ? <p>Loading…</p> : (
          <>
            {/* Effective dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Effective from</label>
                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!editable} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Effective to</label>
                <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!editable} />
              </div>
            </div>

            {/* Service selection + fees */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Services covered (tick + set annual fee)
              </label>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 4 }}>
                {services.map(svc => {
                  const idx = chosen.findIndex(c => c.service_id === svc.id);
                  const isChosen = idx >= 0;
                  const item = isChosen ? chosen[idx] : null;
                  return (
                    <div key={svc.id} style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: editable ? 'pointer' : 'default' }}>
                        <input type="checkbox" checked={isChosen} onChange={(e) => toggleService(svc, e.target.checked)} disabled={!editable} />
                        <span style={{ fontWeight: 600, color: '#1a365d', flex: 1 }}>{svc.label}</span>
                        {isChosen && (
                          <>
                            <span style={{ fontSize: 11, color: '#64748b' }}>Annual fee €</span>
                            <input
                              type="number" min={0} step={1}
                              value={item!.annual_fee}
                              onChange={(e) => updateChosen(idx, { annual_fee: parseFloat(e.target.value) || 0 })}
                              disabled={!editable}
                              className="form-input"
                              style={{ width: 110, padding: '3px 6px', fontSize: 13, textAlign: 'right' }}
                              onClick={(e) => e.preventDefault()}
                            />
                          </>
                        )}
                      </label>
                      {isChosen && (
                        <textarea
                          value={item!.scope_notes || ''}
                          onChange={(e) => updateChosen(idx, { scope_notes: e.target.value })}
                          disabled={!editable}
                          rows={2}
                          placeholder="Optional scope notes for this service…"
                          className="form-input"
                          style={{ width: '100%', marginTop: 6, fontSize: 13 }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 6, textAlign: 'right', fontSize: 14, color: '#1a365d' }}>
                <strong>Total annual fee: €{totalFee.toFixed(2)}</strong>
              </div>
            </div>

            {/* Intro */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Introduction</label>
              <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} rows={3} disabled={!editable}
                className="form-input" style={{ width: '100%', fontSize: 13 }} />
            </div>

            {/* Terms */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Terms (editable boilerplate)</label>
              <textarea value={termsText} onChange={(e) => setTermsText(e.target.value)} rows={10} disabled={!editable}
                className="form-input" style={{ width: '100%', fontSize: 12, fontFamily: 'inherit' }} />
            </div>

            {/* Internal notes */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Internal notes (not on the letter)</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={!editable}
                className="form-input" style={{ width: '100%', fontSize: 13 }} />
            </div>

            {showSendForm && editable && (
              <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: 10, borderRadius: 4, marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Send to email</label>
                <input type="email" value={sendToEmail} onChange={(e) => setSendToEmail(e.target.value)}
                  className="form-input" style={{ width: '100%' }} />
                <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
                  Sent via your Outlook account (configure in Settings → Email). PDF attached.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-secondary" onClick={handlePreview} disabled={chosen.length === 0}>
                👁 Preview PDF
              </button>
              {editable && !showSendForm && (
                <>
                  <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving || chosen.length === 0}>
                    {saving ? 'Saving…' : 'Save draft'}
                  </button>
                  <button className="btn btn-primary" onClick={() => setShowSendForm(true)} disabled={chosen.length === 0}>
                    📧 Send to client
                  </button>
                </>
              )}
              {editable && showSendForm && (
                <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
                  {sending ? 'Sending…' : 'Confirm send'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
