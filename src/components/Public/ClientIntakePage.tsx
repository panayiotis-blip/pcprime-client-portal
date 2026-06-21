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

  const submit = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const payload = { ...form, ...lists, _submitted_at: new Date().toISOString() };
      const res = await api.submitClientIntake(token, payload);
      if (!res.ok) { setError(res.error || 'Could not submit.'); return; }
      setDone(true);
    } catch (e: any) {
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

      {error && <p style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8, marginBottom: 40 }}>
        <button onClick={submit} disabled={submitting}
          style={{ background: C.navy, color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Submitting…' : 'Submit my information'}
        </button>
      </div>
    </>
  );
}
