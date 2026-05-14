import { useEffect, useState, useRef } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// Picklist mirrors the timesheet CHECK constraint. Keep in sync with
// migration 045 / Timesheet.tsx.
const SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;

export default function CompanySettings() {
  const { user } = useAuth();
  const canEdit = isSupervisorOrHigher(user);

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm]         = useState<any>(null);
  // default_service_rates is a jsonb map { service: rate }. We hold it as a
  // separate state so the input fields stay strings (allows clearing/typing).
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const data = await api.getCompanySettings();
      setForm(data);
      const defaults = (data?.default_service_rates || {}) as Record<string, number>;
      const inputs: Record<string, string> = {};
      for (const s of SERVICES) {
        inputs[s] = defaults[s] != null ? String(defaults[s]) : '';
      }
      setRateInputs(inputs);
    } catch (err: any) {
      alert('Failed to load company settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      // Build the rates jsonb — only include services with a non-empty value
      const rates: Record<string, number> = {};
      for (const s of SERVICES) {
        const v = rateInputs[s];
        if (v !== '' && v != null && !isNaN(Number(v))) {
          rates[s] = Number(v);
        }
      }
      await api.updateCompanySettings({
        name: form.name || null,
        legal_name: form.legal_name || null,
        registration_number: form.registration_number || null,
        tax_id: form.tax_id || null,
        vat_number: form.vat_number || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        postal_code: form.postal_code || null,
        country: form.country || null,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        iban: form.iban || null,
        bank_name: form.bank_name || null,
        tagline: form.tagline || null,
        report_footer: form.report_footer || null,
        default_service_rates: rates,
      });
      await load();
      alert('Company settings saved.');
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!canEdit) return;
    if (file.size > 5 * 1024 * 1024) { alert('Logo must be under 5 MB'); return; }
    setUploading(true);
    try {
      const url = await api.uploadCompanyLogo(file);
      await api.updateCompanySettings({ logo_url: url });
      setForm((prev: any) => ({ ...prev, logo_url: url }));
    } catch (err: any) {
      alert('Logo upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!form) return <div className="empty-state"><p>Could not load company settings.</p></div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Company Settings</h2>
      </div>

      {!canEdit && (
        <div className="empty-state" style={{ marginBottom: 12 }}>
          <p>You can view these settings, but only owners and supervisors can edit them.</p>
        </div>
      )}

      {/* Logo */}
      <div className="form-section">
        <h3>Logo &amp; brand</h3>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{
            width: 200, height: 100, border: '1px dashed var(--border)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc',
          }}>
            {form.logo_url ? (
              <img src={form.logo_url} alt="Company logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
              <span style={{ color: '#94a3b8', fontSize: 13 }}>No logo uploaded</span>
            )}
          </div>
          {canEdit && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleLogoUpload(f);
                }}
                style={{ display: 'block', marginBottom: 8 }}
                disabled={uploading}
              />
              <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>
                PNG / JPG / SVG / WebP, under 5 MB. Uploads replace the existing logo.
              </p>
              {form.logo_url && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    if (!confirm('Remove the current logo?')) return;
                    await api.updateCompanySettings({ logo_url: null });
                    setForm((prev: any) => ({ ...prev, logo_url: null }));
                  }}
                >
                  Remove logo
                </button>
              )}
            </div>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="form-group">
            <label>Display name (shown in app)</label>
            <input type="text" className="form-input" value={form.name || ''} onChange={e => handleChange('name', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Tagline</label>
            <input type="text" className="form-input" value={form.tagline || ''} onChange={e => handleChange('tagline', e.target.value)} disabled={!canEdit} placeholder="e.g. Strategic Calculations for Business Growth" />
          </div>
        </div>
      </div>

      {/* Legal */}
      <div className="form-section">
        <h3>Legal &amp; tax identifiers</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Legal name</label>
            <input type="text" className="form-input" value={form.legal_name || ''} onChange={e => handleChange('legal_name', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Registration number</label>
            <input type="text" className="form-input" value={form.registration_number || ''} onChange={e => handleChange('registration_number', e.target.value)} disabled={!canEdit} placeholder="HE12345" />
          </div>
          <div className="form-group">
            <label>Tax ID</label>
            <input type="text" className="form-input" value={form.tax_id || ''} onChange={e => handleChange('tax_id', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>VAT number</label>
            <input type="text" className="form-input" value={form.vat_number || ''} onChange={e => handleChange('vat_number', e.target.value)} disabled={!canEdit} />
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="form-section">
        <h3>Address</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Address line 1</label>
            <input type="text" className="form-input" value={form.address_line1 || ''} onChange={e => handleChange('address_line1', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Address line 2</label>
            <input type="text" className="form-input" value={form.address_line2 || ''} onChange={e => handleChange('address_line2', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>City</label>
            <input type="text" className="form-input" value={form.city || ''} onChange={e => handleChange('city', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Postal code</label>
            <input type="text" className="form-input" value={form.postal_code || ''} onChange={e => handleChange('postal_code', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Country</label>
            <input type="text" className="form-input" value={form.country || ''} onChange={e => handleChange('country', e.target.value)} disabled={!canEdit} placeholder="Cyprus" />
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="form-section">
        <h3>Contact</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Phone</label>
            <input type="text" className="form-input" value={form.phone || ''} onChange={e => handleChange('phone', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" className="form-input" value={form.email || ''} onChange={e => handleChange('email', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Website</label>
            <input type="text" className="form-input" value={form.website || ''} onChange={e => handleChange('website', e.target.value)} disabled={!canEdit} />
          </div>
        </div>
      </div>

      {/* Banking */}
      <div className="form-section">
        <h3>Banking</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>Bank name</label>
            <input type="text" className="form-input" value={form.bank_name || ''} onChange={e => handleChange('bank_name', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>IBAN</label>
            <input type="text" className="form-input" value={form.iban || ''} onChange={e => handleChange('iban', e.target.value)} disabled={!canEdit} />
          </div>
        </div>
      </div>

      {/* Default service rates */}
      <div className="form-section">
        <h3>Default service rates (€/hour)</h3>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
          These rates apply to every staff member unless overridden on the Users page.
          Leave blank to skip a service. New time entries snapshot the rate at insert
          time so historical figures don't change when you adjust these.
        </p>
        <div className="form-grid">
          {SERVICES.map(s => (
            <div className="form-group" key={s}>
              <label>{s}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input"
                value={rateInputs[s] ?? ''}
                onChange={e => setRateInputs(prev => ({ ...prev, [s]: e.target.value }))}
                disabled={!canEdit}
                placeholder="—"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Footer text */}
      <div className="form-section">
        <h3>Report / printable footer</h3>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
          Shown at the bottom of printable documents (timesheet, client card).
        </p>
        <textarea
          className="form-input"
          rows={2}
          value={form.report_footer || ''}
          onChange={e => handleChange('report_footer', e.target.value)}
          disabled={!canEdit}
          placeholder="This document contains confidential information. For internal use only."
        />
      </div>

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
}
