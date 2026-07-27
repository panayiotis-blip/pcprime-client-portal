import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { visibleSections } from './clientIntakeSchema';
import type { IntakeField, IntakeSection } from './clientIntakeSchema';

// Public client onboarding / annual-refresh questionnaire (no auth).
// Loads its prefill via a token, lets the client complete comprehensive
// details (incl. employment & KYC/AML), and submits into the review queue.
// Account creation + 2FA is a later slice; this collects the data.

const C = {
  navy: '#1a365d', gold: '#9b861f', bg: '#f4f6f9', card: '#fff',
  border: '#d9dee6', text: '#1a2433', dim: '#5a6478',
};

// Greek email may arrive as text[]; show the first for editing.
const firstEmail = (v: any) => (Array.isArray(v) ? v[0] : v) || '';

// Attachment categories the client can label each uploaded file with.
const DOC_KINDS = [
  { value: 'id', label: 'ID card' },
  { value: 'passport', label: 'Passport' },
  { value: 'proof_of_address', label: 'Proof of address' },
  { value: 'tax_doc', label: 'Tax document' },
  { value: 'other', label: 'Other' },
];

type PendingFile = { id: string; file: File; kind: string };

export default function ClientIntakePage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<{ mode: string; status: string; firm_name?: string } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [onFile, setOnFile] = useState<Record<string, any>>({}); // current values we hold, for confirmation
  const [lists, setLists] = useState<Record<string, any[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploadMsg, setUploadMsg] = useState('');
  const [declareTrue, setDeclareTrue] = useState(false);
  const [privacyOk, setPrivacyOk] = useState(false);

  useEffect(() => {
    if (!token) { setError('Invalid link.'); setLoading(false); return; }
    api.getClientIntake(token)
      .then((row) => {
        if (!row) { setError('This link is invalid, has expired, or has already been completed.'); return; }
        if (row.status === 'submitted') { /* allow re-edit while pending review */ }
        const pf = row.prefill || {};
        setInfo({ mode: row.mode, status: row.status, firm_name: row.firm_name });
        const initial = {
          ...pf,
          email: firstEmail(pf.email),
          addr_line1: pf.address || '',
        };
        setForm(initial);
        setOnFile(initial); // snapshot of what we currently hold, for the "confirm" hint
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const sections = useMemo(() => visibleSections(form), [form]);
  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const getList = (k: string) => lists[k] || [];
  const addItem = (k: string) => setLists((p) => ({ ...p, [k]: [...(p[k] || []), {}] }));
  const removeItem = (k: string, i: number) =>
    setLists((p) => ({ ...p, [k]: (p[k] || []).filter((_, idx) => idx !== i) }));
  const setItem = (k: string, i: number, fk: string, v: any) =>
    setLists((p) => ({ ...p, [k]: (p[k] || []).map((it, idx) => (idx === i ? { ...it, [fk]: v } : it)) }));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: PendingFile[] = Array.from(list).map((file, i) => ({
      id: `${Date.now()}_${i}_${file.name}`, file, kind: 'other',
    }));
    setFiles((p) => [...p, ...next]);
  };
  const removeFile = (id: string) => setFiles((p) => p.filter((f) => f.id !== id));
  const setFileKind = (id: string, kind: string) =>
    setFiles((p) => p.map((f) => (f.id === id ? { ...f, kind } : f)));

  const submit = async () => {
    if (!token) return;
    if (!declareTrue || !privacyOk) {
      setError('Please confirm the declaration and privacy consent before submitting.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      // Upload attachments first — each is validated and appended to the
      // submission server-side. If one fails we stop so the client can retry
      // (nothing is submitted yet).
      for (let i = 0; i < files.length; i++) {
        setUploadMsg(`Uploading document ${i + 1} of ${files.length}…`);
        await api.uploadIntakeFile(token, files[i].file, files[i].kind);
      }
      setUploadMsg('');
      const payload = {
        ...form, ...lists,
        declaration_confirmed: true,
        privacy_accepted: true,
        consent_at: new Date().toISOString(),
        _submitted_at: new Date().toISOString(),
      };
      const res = await api.submitClientIntake(token, payload);
      if (!res.ok) { setError(res.error || 'Could not submit.'); return; }
      setDone(true);
    } catch (e: any) {
      setUploadMsg('');
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const field = (f: IntakeField, value: any, onChange: (v: any) => void, showOnFile = false) => {
    if (f.when && !f.when(form)) return null;
    const current = showOnFile ? onFile[f.key] : undefined;
    const hasOnFile = current !== undefined && current !== null && String(current).trim() !== '' && f.type !== 'checkbox';
    const common = {
      value: value ?? '',
      onChange: (e: any) => onChange(f.type === 'checkbox' ? e.target.checked : e.target.value),
      style: { width: '100%', padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14, fontFamily: 'inherit' as const },
    };
    return (
      <div key={f.key} style={{ flex: f.half ? '1 1 240px' : '1 1 100%', minWidth: 220 }}>
        {f.type !== 'checkbox' && (
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.dim, marginBottom: 4 }}>{f.label}</label>
        )}
        {f.type === 'select' ? (
          <select {...common}><option value="">— select —</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        ) : f.type === 'textarea' ? (
          <textarea {...common} rows={3} placeholder={f.placeholder} style={{ ...common.style, resize: 'vertical' }} />
        ) : f.type === 'checkbox' ? (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, padding: '6px 0' }}>
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
            {f.label}
          </label>
        ) : (
          <input {...common} type={f.type} placeholder={f.placeholder} />
        )}
        {hasOnFile && (
          <div style={{ fontSize: 11.5, color: C.gold, marginTop: 3 }}>On file: {String(current)} — please confirm or correct</div>
        )}
        {f.help && <div style={{ fontSize: 11.5, color: C.dim, marginTop: 3 }}>{f.help}</div>}
      </div>
    );
  };

  const section = (s: IntakeSection) => (
    <div key={s.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
      <h3 style={{ color: C.navy, margin: '0 0 2px', fontSize: 18 }}>{s.title}</h3>
      {s.description && <p style={{ color: C.dim, fontSize: 13, margin: '0 0 14px' }}>{s.description}</p>}
      {s.fields && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {s.fields.map((f) => field(f, form[f.key], (v) => set(f.key, v), info?.mode === 'refresh'))}
        </div>
      )}
      {s.repeatable && (
        <div>
          {getList(s.repeatable.listKey).map((item, i) => (
            <div key={i} style={{ border: `1px dashed ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 13, color: C.navy }}>{s.repeatable!.itemLabel} {i + 1}</strong>
                <button onClick={() => removeItem(s.repeatable!.listKey, i)}
                  style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13 }}>Remove</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {s.repeatable!.fields.map((f) => field(f, item[f.key], (v) => setItem(s.repeatable!.listKey, i, f.key, v)))}
              </div>
            </div>
          ))}
          <button onClick={() => addItem(s.repeatable!.listKey)}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: C.navy, fontWeight: 600 }}>
            {s.repeatable.addLabel}
          </button>
        </div>
      )}
    </div>
  );

  const shell = (children: any) => (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '24px 16px', fontFamily: 'system-ui, sans-serif', color: C.text }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>{children}</div>
    </div>
  );

  if (loading) return shell(<p style={{ textAlign: 'center', color: C.dim }}>Loading…</p>);
  if (error && !info) return shell(
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, textAlign: 'center' }}>
      <h2 style={{ color: C.navy }}>Link unavailable</h2>
      <p style={{ color: C.dim }}>{error}</p>
    </div>
  );
  if (done) return shell(
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 28, textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>✓</div>
      <h2 style={{ color: C.navy }}>Thank you</h2>
      <p style={{ color: C.dim }}>Your information has been sent to {info?.firm_name || 'us'}. We’ll review it and be in touch. You may close this page.</p>
    </div>
  );

  return shell(
    <>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ color: C.navy, margin: '0 0 4px', fontSize: 24 }}>
          {info?.mode === 'refresh' ? 'Update your details' : 'Client onboarding'}
        </h1>
        <p style={{ color: C.dim, fontSize: 14, margin: 0 }}>
          Please complete as much as you can for {info?.firm_name || 'your accountant'}. Anything you’re unsure of, leave blank and we’ll help.
        </p>
      </div>

      {info?.mode === 'refresh' && (
        <div style={{ background: 'rgba(155,134,31,0.10)', border: `1px solid ${C.gold}`, borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13.5, color: C.text }}>
          The fields below show <strong>the information we currently hold</strong> for you (marked “On file”).
          Please review each one, <strong>correct anything out of date</strong>, fill in what’s missing, and submit to confirm. Check your <strong>TIC</strong> and ID details carefully.
        </div>
      )}

      {sections.map(section)}

      {/* Documents / attachments — uploaded on submit via the intake-upload function */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
        <h3 style={{ color: C.navy, margin: '0 0 2px', fontSize: 18 }}>Documents</h3>
        <p style={{ color: C.dim, fontSize: 13, margin: '0 0 14px' }}>
          Please attach a copy of your ID or passport, and any other relevant documents
          (proof of address, tax letters…). PDF, JPG, PNG or HEIC, up to 10&nbsp;MB each.
        </p>

        {files.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {files.map((f) => (
              <div key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8 }}>
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file.name}</span>
                <span style={{ fontSize: 12, color: C.dim, whiteSpace: 'nowrap' }}>{(f.file.size / 1048576).toFixed(1)} MB</span>
                <select value={f.kind} onChange={(e) => setFileKind(f.id, e.target.value)}
                  style={{ padding: '6px 8px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13 }}>
                  {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <button type="button" onClick={() => removeFile(f.id)}
                  style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13 }}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <label style={{ display: 'inline-block', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: C.navy, fontWeight: 600 }}>
          + Add document(s)
          <input type="file" multiple accept=".pdf,image/png,image/jpeg,image/heic,image/heif"
            style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>

      {/* Declaration & consent — required before submitting */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 16 }}>
        <h3 style={{ color: C.navy, margin: '0 0 10px', fontSize: 18 }}>Declaration &amp; consent</h3>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, marginBottom: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={declareTrue} onChange={(e) => setDeclareTrue(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I confirm that the information I have provided is true, accurate and complete to the best of my knowledge, and I will inform {info?.firm_name || 'the firm'} of any changes.</span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={privacyOk} onChange={(e) => setPrivacyOk(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            I have read and understood the{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: C.gold, fontWeight: 600 }}>Privacy Notice</a>{' '}
            and consent to {info?.firm_name || 'the firm'} processing my personal data as described.
          </span>
        </label>
      </div>

      {error && <p style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p>}
      {uploadMsg && <p style={{ color: C.navy, fontSize: 13, textAlign: 'right' }}>{uploadMsg}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8, marginBottom: 40 }}>
        <button onClick={submit} disabled={submitting || !declareTrue || !privacyOk}
          style={{ background: C.navy, color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: submitting ? 'wait' : (!declareTrue || !privacyOk ? 'not-allowed' : 'pointer'), opacity: (submitting || !declareTrue || !privacyOk) ? 0.6 : 1 }}>
          {submitting ? 'Submitting…' : 'Submit my information'}
        </button>
      </div>
    </>
  );
}
