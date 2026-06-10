import { useEffect, useState, useRef } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import DocumentCategories from './DocumentCategories';
import FolderTemplates from './FolderTemplates';
import ClientCategories from './ClientCategories';
import Cities from './Cities';
import Maintenance from './Maintenance';
import CollapsibleSection from './CollapsibleSection';
import PlatformSitesSection from './PlatformSitesSection';

// Picklist mirrors the timesheet CHECK constraint. Keep in sync with
// migration 045 / Timesheet.tsx.
const SERVICES = [
  'Bookkeeping', 'VAT', 'Payroll', 'Audit', 'Tax Returns',
  'Company Admin', 'Meetings', 'Other',
] as const;

// Brand colours — printed templates only. (UI Refinements Part B)
const BRAND_COLOURS = [
  { field: 'brand_primary_colour',         label: 'Primary brand colour',   def: '#0d1b2e' },
  { field: 'brand_secondary_colour',       label: 'Secondary brand colour', def: '#b8963e' },
  { field: 'letterhead_background_colour', label: 'Letterhead background',  def: '#ffffff' },
  { field: 'letterhead_text_colour',       label: 'Letterhead text',        def: '#0d1b2e' },
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
  const [editing, setEditing] = useState(false);

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
        brand_primary_colour:         form.brand_primary_colour || '#0d1b2e',
        brand_secondary_colour:       form.brand_secondary_colour || '#b8963e',
        letterhead_background_colour: form.letterhead_background_colour || '#ffffff',
        letterhead_text_colour:       form.letterhead_text_colour || '#0d1b2e',
        default_service_rates: rates,
        autoreply_enabled: form.autoreply_enabled ?? true,
        office_open_hour:  Number(form.office_open_hour ?? 8),
        office_close_hour: Number(form.office_close_hour ?? 17),
        office_days:       Array.isArray(form.office_days) ? form.office_days : [1, 2, 3, 4, 5],
        office_timezone:   form.office_timezone || 'Europe/Nicosia',
        autoreply_message: form.autoreply_message || null,
        // Engagement letter defaults (migration 105)
        engagement_leader_default: form.engagement_leader_default || null,
        hourly_rate_director:      form.hourly_rate_director === '' || form.hourly_rate_director == null ? null : Number(form.hourly_rate_director),
        hourly_rate_manager:       form.hourly_rate_manager  === '' || form.hourly_rate_manager  == null ? null : Number(form.hourly_rate_manager),
        hourly_rate_support:       form.hourly_rate_support  === '' || form.hourly_rate_support  == null ? null : Number(form.hourly_rate_support),
        default_discount_percent:  form.default_discount_percent === '' || form.default_discount_percent == null ? null : Number(form.default_discount_percent),
        default_min_monthly_fee:   form.default_min_monthly_fee  === '' || form.default_min_monthly_fee  == null ? null : Number(form.default_min_monthly_fee),
        default_cover_letter_text: form.default_cover_letter_text || null,
        default_sow_intro_text:    form.default_sow_intro_text || null,
        default_terms_text:        form.default_terms_text || null,
      });
      await load();
      setEditing(false);
      alert('Company settings saved.');
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    load();   // discard any unsaved changes
  };

  const resetBrandColours = () => {
    setForm((prev: any) => ({
      ...prev,
      brand_primary_colour: '#0d1b2e',
      brand_secondary_colour: '#b8963e',
      letterhead_background_colour: '#ffffff',
      letterhead_text_colour: '#0d1b2e',
    }));
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
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            {editing ? (
              <>
                <button className="btn btn-secondary" onClick={handleCancel} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit</button>
            )}
          </div>
        )}
      </div>

      {!canEdit && (
        <div className="empty-state" style={{ marginBottom: 12 }}>
          <p>You can view these settings, but only owners and supervisors can edit them.</p>
        </div>
      )}

      <fieldset disabled={!editing} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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

      {/* Client messaging — after-hours auto-reply */}
      <div className="form-section">
        <h3>Client messaging — after-hours auto-reply</h3>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
          When a client messages outside the hours below, the portal auto-acknowledges (at most once per client every 12 hours).
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={form.autoreply_enabled ?? true} onChange={e => handleChange('autoreply_enabled', e.target.checked)} disabled={!canEdit} />
          Send an after-hours auto-reply
        </label>
        <div className="form-grid">
          <div className="form-group">
            <label>Opens at (hour, 0–23)</label>
            <input type="number" min="0" max="23" className="form-input" value={form.office_open_hour ?? 8} onChange={e => handleChange('office_open_hour', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Closes at (hour, 0–23)</label>
            <input type="number" min="0" max="23" className="form-input" value={form.office_close_hour ?? 17} onChange={e => handleChange('office_close_hour', e.target.value)} disabled={!canEdit} />
          </div>
          <div className="form-group">
            <label>Timezone</label>
            <input type="text" className="form-input" value={form.office_timezone || 'Europe/Nicosia'} onChange={e => handleChange('office_timezone', e.target.value)} disabled={!canEdit} placeholder="Europe/Nicosia" />
          </div>
        </div>
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Working days</label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            {[{ n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 0, l: 'Sun' }].map(d => {
              const days: number[] = Array.isArray(form.office_days) ? form.office_days : [1, 2, 3, 4, 5];
              const on = days.includes(d.n);
              return (
                <label key={d.n} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canEdit}
                    onChange={() => handleChange('office_days', on ? days.filter(x => x !== d.n) : [...days, d.n].sort())}
                  />
                  {d.l}
                </label>
              );
            })}
          </div>
        </div>
        <div className="form-group" style={{ marginTop: 8 }}>
          <label>Auto-reply message</label>
          <textarea className="form-input" rows={3} value={form.autoreply_message || ''} onChange={e => handleChange('autoreply_message', e.target.value)} disabled={!canEdit} />
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
      <CollapsibleSection title="Default Service Rates (€/hour)">
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
      </CollapsibleSection>

      <CollapsibleSection title="Platform Sites (TaxisNet, Ergani, JCC, banks…)">
        <PlatformSitesSection canEdit={canEdit} />
      </CollapsibleSection>

      <CollapsibleSection title="Engagement Letter defaults">
        <p style={{ fontSize: 13, color: '#5a6478', marginTop: 0 }}>
          Pre-filled on every new engagement letter so the per-client form only needs the bits
          that actually change. Edit a letter to override any of these for one client.
          Cover letter and terms support <code>{`{{client_name}}`}</code> and{' '}
          <code>{`{{engagement_leader}}`}</code> merge fields.
        </p>

        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label>Engagement Leader name</label>
            <input
              type="text"
              className="form-input"
              value={form.engagement_leader_default || ''}
              onChange={(e) => handleChange('engagement_leader_default', e.target.value)}
              disabled={!editing || !canEdit}
              placeholder="e.g. Mr. Panayiotis Savva"
            />
          </div>
        </div>

        <h4 style={{ fontSize: 13, color: '#1a365d', margin: '12px 0 6px' }}>Standard hourly rates (€)</h4>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label>Director / hr</label>
            <input
              type="number" min={0} step={1}
              className="form-input"
              value={form.hourly_rate_director ?? ''}
              onChange={(e) => handleChange('hourly_rate_director', e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!editing || !canEdit}
            />
          </div>
          <div className="form-group">
            <label>Manager / hr</label>
            <input
              type="number" min={0} step={1}
              className="form-input"
              value={form.hourly_rate_manager ?? ''}
              onChange={(e) => handleChange('hourly_rate_manager', e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!editing || !canEdit}
            />
          </div>
          <div className="form-group">
            <label>Support Staff / hr</label>
            <input
              type="number" min={0} step={1}
              className="form-input"
              value={form.hourly_rate_support ?? ''}
              onChange={(e) => handleChange('hourly_rate_support', e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!editing || !canEdit}
            />
          </div>
          <div className="form-group">
            <label>Default discount %</label>
            <input
              type="number" min={0} max={100} step={1}
              className="form-input"
              value={form.default_discount_percent ?? ''}
              onChange={(e) => handleChange('default_discount_percent', e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!editing || !canEdit}
            />
          </div>
          <div className="form-group">
            <label>Minimum monthly fee (€)</label>
            <input
              type="number" min={0} step={1}
              className="form-input"
              value={form.default_min_monthly_fee ?? ''}
              onChange={(e) => handleChange('default_min_monthly_fee', e.target.value === '' ? '' : Number(e.target.value))}
              disabled={!editing || !canEdit}
            />
          </div>
        </div>

        <h4 style={{ fontSize: 13, color: '#1a365d', margin: '16px 0 6px' }}>Cover letter body (page 1)</h4>
        <textarea
          className="form-input"
          rows={6}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
          value={form.default_cover_letter_text || ''}
          onChange={(e) => handleChange('default_cover_letter_text', e.target.value)}
          disabled={!editing || !canEdit}
        />

        <h4 style={{ fontSize: 13, color: '#1a365d', margin: '16px 0 6px' }}>Statement of Work intro (page 2)</h4>
        <textarea
          className="form-input"
          rows={4}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
          value={form.default_sow_intro_text || ''}
          onChange={(e) => handleChange('default_sow_intro_text', e.target.value)}
          disabled={!editing || !canEdit}
        />

        <h4 style={{ fontSize: 13, color: '#1a365d', margin: '16px 0 6px' }}>Terms text (page 2)</h4>
        <textarea
          className="form-input"
          rows={12}
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 12 }}
          value={form.default_terms_text || ''}
          onChange={(e) => handleChange('default_terms_text', e.target.value)}
          disabled={!editing || !canEdit}
        />
      </CollapsibleSection>

      {/* Footer text */}
      <div className="form-section">
        <h3>Report / printable footer</h3>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
          Shown at the bottom of printable documents (timesheet, client card).
        </p>
        <textarea
          className="form-input"
          rows={5}
          style={{ width: '100%', resize: 'vertical' }}
          value={form.report_footer || ''}
          onChange={e => handleChange('report_footer', e.target.value)}
          disabled={!canEdit}
          placeholder="This document contains confidential information. For internal use only."
        />
      </div>

      {/* Brand & print colours */}
      <div className="form-section">
        <h3>Brand &amp; Print Colours</h3>
        <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
          These colours apply to <strong>printed templates only</strong> (client card, invoices,
          timesheet) — they do not affect the app's screen UI. Saved as part of company settings.
        </p>
        <div className="form-grid">
          {BRAND_COLOURS.map(bc => (
            <div className="form-group" key={bc.field}>
              <label>{bc.label}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={form[bc.field] || bc.def}
                  onChange={e => handleChange(bc.field, e.target.value)}
                  disabled={!canEdit}
                  style={{ width: 44, height: 32, padding: 0, border: '1px solid var(--pc-border)', borderRadius: 6 }}
                />
                <input
                  type="text"
                  className="form-input"
                  value={form[bc.field] || bc.def}
                  onChange={e => handleChange(bc.field, e.target.value)}
                  disabled={!canEdit}
                  style={{ width: 110, fontFamily: 'monospace' }}
                />
              </div>
            </div>
          ))}
        </div>
        {canEdit && (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={resetBrandColours}>
            Reset to defaults
          </button>
        )}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Letterhead preview
          </div>
          <div style={{
            border: '1px solid var(--pc-border)', borderRadius: 8, padding: 16, maxWidth: 440,
            background: form.letterhead_background_colour || '#ffffff',
            color: form.letterhead_text_colour || '#0d1b2e',
          }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: form.brand_primary_colour || '#0d1b2e' }}>
              {form.name || form.legal_name || 'Your Firm Name'}
            </div>
            <div style={{ fontSize: 11, fontStyle: 'italic', color: form.brand_secondary_colour || '#b8963e' }}>
              {form.tagline || 'Firm tagline'}
            </div>
            <div style={{ borderTop: `2px solid ${form.brand_secondary_colour || '#b8963e'}`, margin: '10px 0' }} />
            <div style={{ fontSize: 12 }}>Sample letterhead body text — printed documents use these colours.</div>
          </div>
        </div>
      </div>

      </fieldset>

      {/* Document Categories admin — self-contained, saves independently */}
      <DocumentCategories />

      {/* Storage folder names — master list, renames propagate to all clients */}
      <FolderTemplates />

      {/* Client Categories admin — self-contained, saves independently */}
      <ClientCategories />

      {/* Cities admin — self-contained, saves independently */}
      <Cities />

      {/* Maintenance tools — self-contained, leadership-only */}
      <Maintenance />
    </div>
  );
}
