import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

const EMPTY = {
  business_name: '', business_type: '', contact_person: '', email: '', phone: '',
  vat_number: '', registration_number: '', address: '', services_wanted: '', notes: '',
  terms_accepted: false,
};

// Public application form for prospective clients. Submitting creates a
// PENDING application — no account until the firm approves.
export default function SignupApplication() {
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const f = (k: string, v: any) => setForm(s => ({ ...s, [k]: v }));

  const submit = async () => {
    if (!form.business_name.trim() || !form.email.trim()) { alert('Business name and email are required.'); return; }
    if (!form.terms_accepted) { alert('Please accept the terms to apply.'); return; }
    setBusy(true);
    try { await api.submitApplication(form); setDone(true); }
    catch (err: any) { alert('Could not submit: ' + err.message); }
    finally { setBusy(false); }
  };

  const wrap: React.CSSProperties = { maxWidth: 640, margin: '40px auto', padding: '0 16px' };

  if (done) {
    return (
      <div style={wrap}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>Application received ✓</h2>
          <p style={{ color: '#475569' }}>
            Thank you. We'll review your application and email you at <strong>{form.email}</strong> with the next steps.
          </p>
          <Link to="/login" className="btn btn-secondary">Back to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h2>Apply for a portal account</h2>
      <p style={{ color: '#475569', fontSize: 14 }}>
        Tell us about your business. We review every application and will be in touch once approved.
      </p>
      <div className="card">
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Business name *</label>
            <input className="form-input" value={form.business_name} onChange={e => f('business_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Business type</label>
            <input className="form-input" value={form.business_type} onChange={e => f('business_type', e.target.value)} placeholder="e.g. Ltd company, sole trader" />
          </div>
          <div className="form-group">
            <label>Contact person</label>
            <input className="form-input" value={form.contact_person} onChange={e => f('contact_person', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input type="email" className="form-input" value={form.email} onChange={e => f('email', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input className="form-input" value={form.phone} onChange={e => f('phone', e.target.value)} />
          </div>
          <div className="form-group">
            <label>VAT number</label>
            <input className="form-input" value={form.vat_number} onChange={e => f('vat_number', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Registration number</label>
            <input className="form-input" value={form.registration_number} onChange={e => f('registration_number', e.target.value)} />
          </div>
          <div className="form-group full-width">
            <label>Address</label>
            <textarea className="form-input" rows={2} value={form.address} onChange={e => f('address', e.target.value)} />
          </div>
          <div className="form-group full-width">
            <label>Services you're interested in</label>
            <textarea className="form-input" rows={2} value={form.services_wanted} onChange={e => f('services_wanted', e.target.value)} placeholder="e.g. invoicing, bookkeeping, VAT, payroll" />
          </div>
          <div className="form-group full-width">
            <label>Anything else?</label>
            <textarea className="form-input" rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 8 }}>
          <input type="checkbox" checked={form.terms_accepted} onChange={e => f('terms_accepted', e.target.checked)} />
          I agree to the <Link to="/privacy">privacy notice</Link> and terms of use.
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <Link to="/login" style={{ fontSize: 13 }}>Already have an account? Log in</Link>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
        </div>
      </div>
    </div>
  );
}
