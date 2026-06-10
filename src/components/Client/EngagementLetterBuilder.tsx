import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import {
  generateEngagementLetterPdf,
  fetchLogoDataUrl,
  DEFAULT_INTRO,
  DEFAULT_TERMS,
  DEFAULT_COVER,
  type LetterService,
} from '../../services/engagementLetterPdf';

type Props = {
  clientId: number;
  client: any;
  letterId?: number;
  onClose: () => void;
  onSaved: () => void;
};

type ServiceDef = { id: number; key: string; label: string };
type Deliverable = { id: number; service_id: number; ordinal: number; label: string; description: string | null };

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

  const [services, setServices] = useState<ServiceDef[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [firm, setFirm] = useState<any>({});
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  // Letter state
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<string>('draft');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [engagementType, setEngagementType] = useState<'annual' | 'one_off'>('annual');
  const [chosen, setChosen] = useState<LetterService[]>([]);
  const [feeMode, setFeeMode] = useState<'flat' | 'per_service'>('flat');
  const [annualEstimate, setAnnualEstimate] = useState<number>(0);
  const [engagementLeader, setEngagementLeader] = useState('');
  const [hourlyDirector, setHourlyDirector] = useState<number | ''>('');
  const [hourlyManager, setHourlyManager]   = useState<number | ''>('');
  const [hourlySupport, setHourlySupport]   = useState<number | ''>('');
  const [discountPct, setDiscountPct]       = useState<number | ''>('');
  const [minMonthlyFee, setMinMonthlyFee]   = useState<number | ''>('');
  const [reviewNoticeDays, setReviewNoticeDays] = useState<number | ''>(30);
  const [coverLetterText, setCoverLetterText] = useState(DEFAULT_COVER);
  const [introText, setIntroText] = useState(DEFAULT_INTRO);
  const [termsText, setTermsText] = useState(DEFAULT_TERMS);
  const [notes, setNotes] = useState('');
  const [currency] = useState('EUR');
  const [sendToEmail, setSendToEmail] = useState('');
  const [showSendForm, setShowSendForm] = useState(false);

  // Derived totals
  const perServiceTotal = useMemo(
    () => chosen.reduce((s, x) => s + (Number(x.annual_fee) || 0), 0),
    [chosen],
  );
  const monthlyFromAnnual = useMemo(() => (Number(annualEstimate) || 0) / 12, [annualEstimate]);
  const totalAnnualFee = feeMode === 'flat' ? Number(annualEstimate) || 0 : perServiceTotal;

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const [svcs, delivs, settings] = await Promise.all([
          api.getServiceDefinitions(),
          api.getServiceDeliverables(),
          api.getCompanySettings().catch(() => null),
        ]);
        setServices(svcs as ServiceDef[]);
        setDeliverables(delivs as Deliverable[]);
        setFirm(settings || {});

        // Fetch logo if the firm has one
        if (settings?.logo_url) {
          fetchLogoDataUrl(settings.logo_url).then(setLogoDataUrl);
        }

        if (isEditing && letterId != null) {
          const row = await api.getEngagementLetter(letterId);
          if (row) {
            setVersion(row.version);
            setStatus(row.status);
            setEffectiveFrom(row.effective_from || '');
            setEffectiveTo(row.effective_to || '');
            setChosen(Array.isArray(row.services) ? row.services : []);
            setEngagementType((row.engagement_type || 'annual') as 'annual' | 'one_off');
            setFeeMode((row.fee_mode || 'flat') as 'flat' | 'per_service');
            setAnnualEstimate(Number(row.annual_estimate) || 0);
            setEngagementLeader(row.engagement_leader || settings?.engagement_leader_default || '');
            setHourlyDirector(row.hourly_rate_director ?? settings?.hourly_rate_director ?? '');
            setHourlyManager(row.hourly_rate_manager ?? settings?.hourly_rate_manager ?? '');
            setHourlySupport(row.hourly_rate_support ?? settings?.hourly_rate_support ?? '');
            setDiscountPct(row.discount_percent ?? settings?.default_discount_percent ?? '');
            setMinMonthlyFee(row.min_monthly_fee ?? settings?.default_min_monthly_fee ?? '');
            setReviewNoticeDays(row.annual_review_notice_days ?? 30);
            setCoverLetterText(row.cover_letter_text || settings?.default_cover_letter_text || DEFAULT_COVER);
            setIntroText(row.intro_text || settings?.default_sow_intro_text || DEFAULT_INTRO);
            setTermsText(row.terms_text || settings?.default_terms_text || DEFAULT_TERMS);
            setNotes(row.notes || '');
            const clientEmail = Array.isArray(client?.email) ? client.email[0] : client?.email;
            setSendToEmail(clientEmail || '');
          }
        } else {
          // New draft — pre-fill from firm defaults.
          const nextV = await api.getNextEngagementLetterVersion(clientId);
          setVersion(nextV);
          const today = new Date();
          const todayIso = today.toISOString().slice(0, 10);
          const oneYearLater = new Date(today);
          oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
          setEffectiveFrom(todayIso);
          setEffectiveTo(oneYearLater.toISOString().slice(0, 10));
          setEngagementLeader(settings?.engagement_leader_default || '');
          setHourlyDirector(settings?.hourly_rate_director ?? '');
          setHourlyManager(settings?.hourly_rate_manager ?? '');
          setHourlySupport(settings?.hourly_rate_support ?? '');
          setDiscountPct(settings?.default_discount_percent ?? '');
          setMinMonthlyFee(settings?.default_min_monthly_fee ?? '');
          setCoverLetterText(settings?.default_cover_letter_text || DEFAULT_COVER);
          setIntroText(settings?.default_sow_intro_text || DEFAULT_INTRO);
          setTermsText(settings?.default_terms_text || DEFAULT_TERMS);
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
        // Default-select every deliverable for this service — the user can
        // untick anything they want to exclude.
        const defaultDelivs = deliverables
          .filter(d => d.service_id === svc.id)
          .map(d => ({ label: d.label }));
        return [...prev, {
          service_id: svc.id, service_key: svc.key, service_label: svc.label,
          annual_fee: 0, scope_notes: '',
          deliverables: defaultDelivs,
        } as any];
      }
      return prev.filter(p => p.service_id !== svc.id);
    });
  };

  // Toggle an individual deliverable for a chosen service. The letter
  // snapshots only the labels, so we operate on the deliverables array.
  const toggleDeliverable = (svcIdx: number, label: string, checked: boolean) => {
    setChosen(prev => prev.map((s, i) => {
      if (i !== svcIdx) return s;
      const current: Array<{ label: string }> = (s as any).deliverables || [];
      const next = checked
        ? (current.find(d => d.label === label) ? current : [...current, { label }])
        : current.filter(d => d.label !== label);
      return { ...s, deliverables: next } as any;
    }));
  };

  const updateChosen = (idx: number, patch: Partial<LetterService>) => {
    setChosen(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

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
    firm: { ...firm, logo_data_url: logoDataUrl },
    version,
    effective_from: effectiveFrom || null,
    effective_to: effectiveTo || null,
    engagement_type: engagementType,
    fee_mode: feeMode,
    annual_estimate: feeMode === 'flat' ? (Number(annualEstimate) || 0) : null,
    services: chosen,
    hourly_rate_director: hourlyDirector === '' ? null : Number(hourlyDirector),
    hourly_rate_manager:  hourlyManager === '' ? null : Number(hourlyManager),
    hourly_rate_support:  hourlySupport === '' ? null : Number(hourlySupport),
    discount_percent:     discountPct === '' ? null : Number(discountPct),
    min_monthly_fee:      minMonthlyFee === '' ? null : Number(minMonthlyFee),
    annual_review_notice_days: reviewNoticeDays === '' ? null : Number(reviewNoticeDays),
    currency,
    engagement_leader: engagementLeader,
    cover_letter_text: coverLetterText,
    intro_text: introText,
    terms_text: termsText,
  });

  const handlePreview = () => generateEngagementLetterPdf(buildPdfData(), 'save');

  const buildPayload = () => ({
    version,
    effective_from: effectiveFrom || null,
    effective_to: effectiveTo || null,
    engagement_type: engagementType,
    services: chosen,
    fee_mode: feeMode,
    annual_estimate: feeMode === 'flat' ? (Number(annualEstimate) || 0) : null,
    total_annual_fee: totalAnnualFee,
    currency,
    engagement_leader: engagementLeader || null,
    hourly_rate_director: hourlyDirector === '' ? null : Number(hourlyDirector),
    hourly_rate_manager:  hourlyManager === '' ? null : Number(hourlyManager),
    hourly_rate_support:  hourlySupport === '' ? null : Number(hourlySupport),
    discount_percent:     discountPct === '' ? null : Number(discountPct),
    min_monthly_fee:      minMonthlyFee === '' ? null : Number(minMonthlyFee),
    annual_review_notice_days: reviewNoticeDays === '' ? null : Number(reviewNoticeDays),
    cover_letter_text: coverLetterText || null,
    intro_text: introText || null,
    terms_text: termsText || null,
    notes: notes || null,
  });

  const handleSaveDraft = async () => {
    if (chosen.length === 0) { alert('Pick at least one service first.'); return; }
    setSaving(true);
    try {
      if (isEditing && letterId != null) {
        await api.updateEngagementLetter(letterId, buildPayload());
      } else {
        // Same anti-collision pattern as send — fetch the version fresh in case
        // a prior failed attempt left a draft at the cached version number.
        let attempts = 3;
        let saved = false;
        let lastErr: any = null;
        while (attempts-- > 0) {
          try {
            const freshV = await api.getNextEngagementLetterVersion(clientId);
            await api.createEngagementLetter(clientId, { ...buildPayload(), version: freshV });
            setVersion(freshV);
            saved = true;
            break;
          } catch (err: any) {
            lastErr = err;
            if (!String(err?.message || '').toLowerCase().includes('duplicate key')) break;
          }
        }
        if (!saved) throw lastErr || new Error('Could not allocate a version number for this letter.');
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
      let id = letterId;
      if (id == null) {
        // Re-fetch the next version right before insert — a prior failed-send
        // attempt may have left a draft at the current `version`, which would
        // collide with the unique(client_id, version) constraint. Up to 3
        // tries to absorb a concurrent-create race.
        let attempts = 3;
        let lastErr: any = null;
        while (attempts-- > 0) {
          try {
            const freshV = await api.getNextEngagementLetterVersion(clientId);
            const created = await api.createEngagementLetter(clientId, { ...buildPayload(), version: freshV });
            id = created.id;
            setVersion(freshV);
            break;
          } catch (err: any) {
            lastErr = err;
            if (!String(err?.message || '').toLowerCase().includes('duplicate key')) break;
          }
        }
        if (id == null) throw lastErr || new Error('Could not allocate a version number for this letter.');
      } else if (editable) {
        await api.updateEngagementLetter(id, buildPayload());
      }
      const buf = generateEngagementLetterPdf(buildPdfData(), 'arraybuffer') as ArrayBuffer;
      const b64 = arrayBufferToBase64(buf);
      const filename = `engagement-letter-${(client?.name || 'client').replace(/[^\w-]+/g, '_')}-v${version}.pdf`;
      // Ensure an accept_token exists so the email can include a public link
      // the client can click to accept without reading attachments.
      const token = await api.ensureEngagementLetterToken(id!);
      const acceptUrl = `${window.location.origin}/accept-engagement/${token}`;
      await api.sendViaOutlook({
        to: sendToEmail.trim(),
        subject: `Engagement Letter — ${firm?.name || 'Our firm'} — v${version}`,
        body:
          `Please find attached our engagement letter for your acceptance.\n\n` +
          `To accept online, click here:\n${acceptUrl}\n\n` +
          `Or reply to this email with the word "ACCEPTED" to confirm.\n\n` +
          `Kind regards,\n${firm?.name || ''}`,
        html:
          `<p>Dear ${client?.name || 'client'},</p>` +
          `<p>Please find attached our engagement letter for your acceptance.</p>` +
          `<p style="margin: 18px 0;">` +
          `<a href="${acceptUrl}" style="background:#1a365d;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;font-weight:600;">View and accept online</a>` +
          `</p>` +
          `<p style="color:#64748b;font-size:13px;">Alternatively, reply to this email with the word <strong>"ACCEPTED"</strong>.</p>` +
          `<p>Kind regards,<br>${firm?.name || ''}</p>`,
        attachments: [{ filename, contentBase64: b64, contentType: 'application/pdf' }],
      });
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

  const numInput = (v: number | '', setter: (n: number | '') => void, width = 110) => (
    <input type="number" min={0} step={1} value={v} onChange={(e) => setter(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
      disabled={!editable} className="form-input" style={{ width, padding: '3px 6px', fontSize: 13, textAlign: 'right' }} />
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 8, padding: 20, width: '100%', maxWidth: 880,
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
            {/* Engagement type — controls fee wording + monthly-billing language */}
            <div style={{ marginBottom: 10, padding: '8px 12px', background: engagementType === 'one_off' ? '#fef3c7' : '#eef2ff', border: '1px solid ' + (engagementType === 'one_off' ? '#fbbf24' : '#a5b4fc'), borderRadius: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#1a365d', marginBottom: 4 }}>Engagement type</div>
              <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: editable ? 'pointer' : 'default' }}>
                  <input type="radio" checked={engagementType === 'annual'} onChange={() => setEngagementType('annual')} disabled={!editable} />
                  Annual / recurring (billed monthly)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: editable ? 'pointer' : 'default' }}>
                  <input type="radio" checked={engagementType === 'one_off'} onChange={() => setEngagementType('one_off')} disabled={!editable} />
                  One-off project / brief
                </label>
              </div>
              <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
                {engagementType === 'one_off'
                  ? 'A defined piece of work. The letter speaks of a "Project fee" invoiced on completion, with no monthly billing or annual rate-review language.'
                  : 'A recurring retainer. The letter speaks of an "Annual estimate" billed monthly, with the standard annual rate-review notice.'}
              </p>
            </div>

            {/* Effective dates + engagement leader */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {engagementType === 'one_off' ? 'Project start' : 'Effective from'}
                </label>
                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!editable} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {engagementType === 'one_off' ? 'Expected completion' : 'Effective to'}
                </label>
                <input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!editable} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Engagement Leader</label>
                <input type="text" value={engagementLeader} onChange={(e) => setEngagementLeader(e.target.value)} className="form-input" style={{ width: '100%' }} disabled={!editable} placeholder="e.g. Mr. Panayiotis Savva" />
              </div>
            </div>

            {/* Service selection */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Services covered
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
                        {isChosen && feeMode === 'per_service' && (
                          <>
                            <span style={{ fontSize: 11, color: '#64748b' }}>Annual fee €</span>
                            <input
                              type="number" min={0} step={1}
                              value={item!.annual_fee ?? 0}
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
                        <>
                          {/* Deliverables checklist — sub-bullets that go on
                              the PDF under this service. Default all on. */}
                          {(() => {
                            const svcDelivs = deliverables.filter(d => d.service_id === svc.id);
                            if (svcDelivs.length === 0) return null;
                            const selected: Array<{ label: string }> = (item as any).deliverables || [];
                            const isOn = (label: string) => !!selected.find(d => d.label === label);
                            return (
                              <div style={{ marginTop: 6, marginLeft: 24, padding: '6px 8px', background: '#fafbfc', borderRadius: 4, border: '1px solid #f1f5f9' }}>
                                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Deliverables included (tick to include on the letter)</div>
                                {svcDelivs.map(d => (
                                  <label key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, padding: '2px 0', cursor: editable ? 'pointer' : 'default' }} title={d.description || ''}>
                                    <input type="checkbox" checked={isOn(d.label)} onChange={(e) => toggleDeliverable(idx, d.label, e.target.checked)} disabled={!editable} style={{ marginTop: 2 }} />
                                    <span>
                                      <span style={{ color: '#1a365d' }}>{d.label}</span>
                                      {d.description && <span style={{ color: '#94a3b8', display: 'block', fontSize: 11 }}>{d.description}</span>}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            );
                          })()}
                          <textarea
                            value={item!.scope_notes || ''}
                            onChange={(e) => updateChosen(idx, { scope_notes: e.target.value })}
                            disabled={!editable}
                            rows={2}
                            placeholder="Additional scope notes for this service (optional)…"
                            className="form-input"
                            style={{ width: '100%', marginTop: 6, fontSize: 13 }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Fee model — radios + relevant inputs */}
            <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#1a365d', marginBottom: 6 }}>Fee model</div>
              <div style={{ display: 'flex', gap: 18, marginBottom: 8, fontSize: 13 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: editable ? 'pointer' : 'default' }}>
                  <input type="radio" checked={feeMode === 'flat'} onChange={() => setFeeMode('flat')} disabled={!editable} />
                  Flat annual fee (billed monthly)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: editable ? 'pointer' : 'default' }}>
                  <input type="radio" checked={feeMode === 'per_service'} onChange={() => setFeeMode('per_service')} disabled={!editable} />
                  Per-service annual fee
                </label>
              </div>
              {feeMode === 'flat' ? (
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <label style={{ fontSize: 13, color: '#475569' }}>
                    {engagementType === 'one_off' ? 'Project fee €' : 'Annual estimate €'}
                  </label>
                  {numInput(annualEstimate, (v) => setAnnualEstimate(typeof v === 'number' ? v : 0), 140)}
                  {engagementType === 'annual' && (
                    <span style={{ fontSize: 13, color: '#64748b' }}>
                      = {currency} {monthlyFromAnnual.toFixed(2)} / month
                    </span>
                  )}
                  {engagementType === 'one_off' && (
                    <span style={{ fontSize: 13, color: '#64748b' }}>invoiced on completion</span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#475569' }}>
                  Total per-service fees: <strong style={{ color: '#1a365d' }}>€{perServiceTotal.toFixed(2)}/year</strong> (each service has its own fee input above)
                </div>
              )}

              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Director €/hr</label>
                  {numInput(hourlyDirector, setHourlyDirector, '100%' as any)}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Manager €/hr</label>
                  {numInput(hourlyManager, setHourlyManager, '100%' as any)}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Support €/hr</label>
                  {numInput(hourlySupport, setHourlySupport, '100%' as any)}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Discount %</label>
                  {numInput(discountPct, setDiscountPct, '100%' as any)}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block' }}>Min monthly €</label>
                  {numInput(minMonthlyFee, setMinMonthlyFee, '100%' as any)}
                </div>
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>
                Hourly rates apply to out-of-scope work. Defaults pulled from Company Settings.
              </p>
            </div>

            {/* Cover letter body */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Cover letter body (page 1) — supports {`{{client_name}}`} and {`{{engagement_leader}}`}
              </label>
              <textarea value={coverLetterText} onChange={(e) => setCoverLetterText(e.target.value)} rows={6} disabled={!editable}
                className="form-input" style={{ width: '100%', fontSize: 13 }} />
            </div>

            {/* SOW intro */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Statement of Work — intro</label>
              <textarea value={introText} onChange={(e) => setIntroText(e.target.value)} rows={3} disabled={!editable}
                className="form-input" style={{ width: '100%', fontSize: 13 }} />
            </div>

            {/* Terms */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Terms (full text)</label>
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
                  Sent via your email account (configure in Settings → Email). PDF attached.
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
