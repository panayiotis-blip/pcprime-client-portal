import { useEffect, useState, useRef } from 'react';
import { api, isSupervisorOrHigher } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import DocumentCategories from './DocumentCategories';
import FolderTemplates from './FolderTemplates';
import ClientCategories from './ClientCategories';
import Cities from './Cities';
import Maintenance from './Maintenance';
import PrintLetterhead from '../shared/PrintLetterhead';
import { Link } from 'react-router-dom';
import CollapsibleSection from './CollapsibleSection';
import PlatformSitesSection from './PlatformSitesSection';
import { DEFAULT_SERVICES, DEFAULT_COPY, type LandingService } from '../Public/landingDefaults';

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

// Landing-page copy fields (stored in the landing_copy jsonb blob), grouped
// for the editor. `area` = 'text' renders a textarea, otherwise a single line.
const LANDING_COPY_GROUPS: { title: string; fields: { key: string; label: string; area?: boolean }[] }[] = [
  {
    title: 'Top navigation',
    fields: [
      { key: 'nav_about', label: 'About link' },
      { key: 'nav_services', label: 'Services link' },
      { key: 'nav_contact', label: 'Contact link' },
      { key: 'nav_portal', label: 'Portal button' },
    ],
  },
  {
    title: 'External links (Blog / News) — full URL to your website; leave blank to hide',
    fields: [
      { key: 'home_url', label: 'Website home URL (logo click)' },
      { key: 'nav_blog', label: 'Blog label' },
      { key: 'blog_url', label: 'Blog URL' },
      { key: 'nav_news', label: 'News label' },
      { key: 'news_url', label: 'News URL' },
    ],
  },
  {
    title: 'Hero buttons',
    fields: [
      { key: 'cta_login_title', label: 'Portal card — title' },
      { key: 'cta_login_sub', label: 'Portal card — subtitle' },
      { key: 'cta_tax_title', label: 'Tax card — title' },
      { key: 'cta_tax_sub', label: 'Tax card — subtitle' },
    ],
  },
  {
    title: 'Section headings',
    fields: [
      { key: 'about_heading', label: 'About heading' },
      { key: 'services_heading', label: 'Services heading' },
    ],
  },
  {
    title: '“Become a client” strip (new visitors) — URL blank = in-app request-an-account (/signup)',
    fields: [
      { key: 'become_heading', label: 'Heading' },
      { key: 'become_button', label: 'Button label' },
      { key: 'become_url', label: 'Button URL (optional)' },
      { key: 'become_text', label: 'Text', area: true },
    ],
  },
  {
    title: 'Portal-promo strip (existing clients)',
    fields: [
      { key: 'promo_heading', label: 'Heading' },
      { key: 'promo_button', label: 'Button label' },
      { key: 'promo_text', label: 'Text', area: true },
    ],
  },
  {
    title: 'Footer',
    fields: [
      { key: 'footer_contact_heading', label: 'Contact column heading' },
      { key: 'footer_office_heading', label: 'Office column heading' },
      { key: 'footer_connect_heading', label: 'Connect column heading' },
      { key: 'hours_line1', label: 'Office hours line 1' },
      { key: 'hours_line2', label: 'Office hours line 2' },
    ],
  },
];

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
  const heroInputRef = useRef<HTMLInputElement>(null);
  const landingLogoInputRef = useRef<HTMLInputElement>(null);
  const aboutInputRef = useRef<HTMLInputElement>(null);
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
        letterhead_logo_position:     form.letterhead_logo_position || 'logo_right',
        letterhead_logo_height:       form.letterhead_logo_height || 'medium',
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
        // Public landing page content (migration 139)
        landing_logo_url:          form.landing_logo_url || null,
        landing_headline:          form.landing_headline || null,
        landing_subtext:           form.landing_subtext || null,
        landing_about:             form.landing_about || null,
        landing_hero_image_url:    form.landing_hero_image_url || null,
        landing_about_image_url:   form.landing_about_image_url || null,
        // Service cards + social links (migration 140). Only keep rows that
        // have some content, so an all-blank row doesn't render an empty card.
        landing_services: (Array.isArray(form.landing_services) ? form.landing_services : [])
          .map((s: LandingService) => ({ title: (s.title || '').trim(), text: (s.text || '').trim() }))
          .filter((s: LandingService) => s.title || s.text),
        facebook_url:              form.facebook_url || null,
        instagram_url:             form.instagram_url || null,
        linkedin_url:              form.linkedin_url || null,
        landing_copy:              (form.landing_copy && typeof form.landing_copy === 'object') ? form.landing_copy : {},
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

  const handleHeroUpload = async (file: File) => {
    if (!canEdit) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5 MB'); return; }
    setUploading(true);
    try {
      const url = await api.uploadLandingHeroImage(file);
      await api.updateCompanySettings({ landing_hero_image_url: url });
      setForm((prev: any) => ({ ...prev, landing_hero_image_url: url }));
    } catch (err: any) {
      alert('Image upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (heroInputRef.current) heroInputRef.current.value = '';
    }
  };

  const handleLandingLogoUpload = async (file: File) => {
    if (!canEdit) return;
    if (file.size > 5 * 1024 * 1024) { alert('Logo must be under 5 MB'); return; }
    setUploading(true);
    try {
      const url = await api.uploadLandingLogo(file);
      await api.updateCompanySettings({ landing_logo_url: url });
      setForm((prev: any) => ({ ...prev, landing_logo_url: url }));
    } catch (err: any) {
      alert('Logo upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (landingLogoInputRef.current) landingLogoInputRef.current.value = '';
    }
  };

  const handleAboutUpload = async (file: File) => {
    if (!canEdit) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5 MB'); return; }
    setUploading(true);
    try {
      const url = await api.uploadLandingAboutImage(file);
      await api.updateCompanySettings({ landing_about_image_url: url });
      setForm((prev: any) => ({ ...prev, landing_about_image_url: url }));
    } catch (err: any) {
      alert('Image upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (aboutInputRef.current) aboutInputRef.current.value = '';
    }
  };

  // Service cards (migration 140). Before anything is saved the stored value
  // is an empty array, so we start the editor from the built-in defaults.
  const baseServices = (): LandingService[] =>
    (Array.isArray(form?.landing_services) && form.landing_services.length
      ? form.landing_services
      : DEFAULT_SERVICES).map((s: LandingService) => ({ title: s.title || '', text: s.text || '' }));
  const setServices = (next: LandingService[]) =>
    setForm((prev: any) => ({ ...prev, landing_services: next }));
  const updateService = (i: number, key: keyof LandingService, value: string) => {
    const next = baseServices(); next[i] = { ...next[i], [key]: value }; setServices(next);
  };
  const addService = () => setServices([...baseServices(), { title: '', text: '' }]);
  const removeService = (i: number) => {
    const next = baseServices(); next.splice(i, 1); setServices(next);
  };

  // Landing copy blob (nav labels, headings, promo, footer, alignment — migration 142).
  const copyBlob = (): Record<string, string> =>
    (form?.landing_copy && typeof form.landing_copy === 'object') ? form.landing_copy : {};
  const copyVal = (k: string): string => {
    const v = copyBlob()[k];
    return v == null ? '' : String(v);
  };
  const setCopy = (k: string, value: string) =>
    setForm((prev: any) => ({ ...prev, landing_copy: { ...copyBlob(), [k]: value } }));

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

        {/* Letterhead layout — how the logo and name lock up on printed docs */}
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="form-group">
            <label>Logo layout on printed documents</label>
            <select
              className="form-input"
              value={form.letterhead_logo_position || 'logo_right'}
              onChange={e => handleChange('letterhead_logo_position', e.target.value)}
              disabled={!canEdit}
            >
              <option value="logo_right">Logo to the right of the name</option>
              <option value="logo_left">Logo to the left of the name</option>
              <option value="logo_above">Logo above the name</option>
              <option value="name_only">Company name only (no logo)</option>
              <option value="logo_only">Logo only (no name)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Logo size</label>
            <select
              className="form-input"
              value={form.letterhead_logo_height || 'medium'}
              onChange={e => handleChange('letterhead_logo_height', e.target.value)}
              disabled={!canEdit}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>Preview</label>
          <div
            style={{
              marginTop: 4, padding: 16, border: '1px solid var(--border)', borderRadius: 8,
              background: '#fff',
              // Preview reflects the chosen brand colour for the name.
              ['--brand-primary' as any]: form.brand_primary_colour || '#1a2e4a',
            }}
          >
            <PrintLetterhead
              name={form.name || form.legal_name || 'Company name'}
              logoUrl={form.logo_url}
              position={form.letterhead_logo_position || 'logo_right'}
              height={form.letterhead_logo_height || 'medium'}
              meta={<div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Address · phone · email — shown under the lockup on each document</div>}
            />
          </div>
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

      {/* Public landing page (migration 139) */}
      <div className="form-section">
        <h3>Landing page</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>
          Controls the public home page at your site's address (the page visitors see before signing in).
          Leave a field blank to use the built-in default text.
        </p>

        {/* Website logo — separate from the app/print logo above */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '0 0 6px' }}>Website logo</label>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>
          Shown in the landing-page header. Independent of the app / letterhead logo — use whichever logo suits your website.
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{
            width: 240, height: 100, border: '1px dashed var(--border)', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', overflow: 'hidden',
          }}>
            {form.landing_logo_url ? (
              <img src={form.landing_logo_url} alt="Website logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
              <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 8 }}>
                Using the default app logo
              </span>
            )}
          </div>
          {canEdit && (
            <div>
              <input
                ref={landingLogoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLandingLogoUpload(f); }}
                style={{ display: 'block', marginBottom: 8 }}
                disabled={uploading}
              />
              <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>
                PNG / JPG / SVG / WebP, under 5 MB. Leave unset to use the app's default logo.
              </p>
              {form.landing_logo_url && (
                <button
                  type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                  onClick={async () => {
                    if (!confirm('Remove the website logo and fall back to the default?')) return;
                    await api.updateCompanySettings({ landing_logo_url: null });
                    setForm((prev: any) => ({ ...prev, landing_logo_url: null }));
                  }}
                >
                  Remove website logo
                </button>
              )}
            </div>
          )}
        </div>

        <div className="form-group" style={{ marginTop: 16 }}>
          <label>Hero headline</label>
          <input
            type="text" className="form-input"
            value={form.landing_headline || ''}
            onChange={e => handleChange('landing_headline', e.target.value)}
            disabled={!canEdit}
            placeholder="Professional Accounting, Tax & Business Consultancy Services"
          />
        </div>

        <div className="form-group">
          <label>Hero sub-text</label>
          <textarea
            className="form-input" rows={3}
            value={form.landing_subtext || ''}
            onChange={e => handleChange('landing_subtext', e.target.value)}
            disabled={!canEdit}
            placeholder="A short sentence or two introducing the firm…"
          />
        </div>

        <div className="form-group">
          <label>About section</label>
          <textarea
            className="form-input" rows={5}
            value={form.landing_about || ''}
            onChange={e => handleChange('landing_about', e.target.value)}
            disabled={!canEdit}
            placeholder={'First paragraph…\n\nLeave a blank line to start a new paragraph.'}
          />
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
            Separate paragraphs with a blank line.
          </p>
        </div>

        {/* Hero photo */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '8px 0 6px' }}>Hero photo</label>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{
            width: 240, height: 160, border: '1px dashed var(--border)', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#f8fafc', overflow: 'hidden',
          }}>
            {form.landing_hero_image_url ? (
              <img src={form.landing_hero_image_url} alt="Hero" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 8 }}>
                No photo — a centred text hero is shown
              </span>
            )}
          </div>
          {canEdit && (
            <div>
              <input
                ref={heroInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleHeroUpload(f);
                }}
                style={{ display: 'block', marginBottom: 8 }}
                disabled={uploading}
              />
              <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>
                JPG / PNG / WebP, under 5 MB. A landscape photo (roughly 4:3) works best.
                When set, the hero shows your text on the left and the photo on the right.
              </p>
              {form.landing_hero_image_url && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    if (!confirm('Remove the hero photo?')) return;
                    await api.updateCompanySettings({ landing_hero_image_url: null });
                    setForm((prev: any) => ({ ...prev, landing_hero_image_url: null }));
                  }}
                >
                  Remove photo
                </button>
              )}
            </div>
          )}
        </div>

        {/* About-section photo */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '20px 0 6px' }}>About-section photo</label>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>
          A second photo, shown to the right of the “About our company” text as a framed block. Leave unset for a plain centred About section.
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{
            width: 240, height: 160, border: '1px dashed var(--border)', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', overflow: 'hidden',
          }}>
            {form.landing_about_image_url ? (
              <img src={form.landing_about_image_url} alt="About" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 8 }}>No photo</span>
            )}
          </div>
          {canEdit && (
            <div>
              <input
                ref={aboutInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAboutUpload(f); }}
                style={{ display: 'block', marginBottom: 8 }}
                disabled={uploading}
              />
              <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>
                JPG / PNG / WebP, under 5 MB. A landscape photo (roughly 4:3) works best.
              </p>
              {form.landing_about_image_url && (
                <button
                  type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}
                  onClick={async () => {
                    if (!confirm('Remove the About-section photo?')) return;
                    await api.updateCompanySettings({ landing_about_image_url: null });
                    setForm((prev: any) => ({ ...prev, landing_about_image_url: null }));
                  }}
                >
                  Remove photo
                </button>
              )}
            </div>
          )}
        </div>

        {/* Service cards */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '20px 0 6px' }}>Service cards</label>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>
          The cards shown under “Our Services”. Add, remove or reorder by editing the rows below.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {baseServices().map((s, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, alignItems: 'start',
              padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: '#f8fafc',
            }}>
              <input
                type="text" className="form-input" placeholder="Title"
                value={s.title} onChange={e => updateService(i, 'title', e.target.value)}
                disabled={!canEdit}
              />
              <textarea
                className="form-input" rows={2} placeholder="Short description"
                value={s.text} onChange={e => updateService(i, 'text', e.target.value)}
                disabled={!canEdit}
              />
              {canEdit && (
                <button
                  type="button" className="btn btn-secondary btn-sm"
                  onClick={() => removeService(i)} title="Remove this card"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={addService}>
            + Add service card
          </button>
        )}

        {/* Social links */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '20px 0 6px' }}>Social links</label>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>
          Full URLs. Leave a field blank to hide that link (Facebook &amp; Instagram fall back to your current profiles).
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label>Facebook URL</label>
            <input type="url" className="form-input" value={form.facebook_url || ''} onChange={e => handleChange('facebook_url', e.target.value)} disabled={!canEdit} placeholder="https://www.facebook.com/…" />
          </div>
          <div className="form-group">
            <label>Instagram URL</label>
            <input type="url" className="form-input" value={form.instagram_url || ''} onChange={e => handleChange('instagram_url', e.target.value)} disabled={!canEdit} placeholder="https://www.instagram.com/…" />
          </div>
          <div className="form-group">
            <label>LinkedIn URL</label>
            <input type="url" className="form-input" value={form.linkedin_url || ''} onChange={e => handleChange('linkedin_url', e.target.value)} disabled={!canEdit} placeholder="https://www.linkedin.com/company/…" />
          </div>
        </div>

        {/* Heading alignment */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '20px 0 6px' }}>Heading alignment</label>
        <div className="form-group" style={{ maxWidth: 280 }}>
          <select
            className="form-input"
            value={copyVal('heading_align') || DEFAULT_COPY.heading_align}
            onChange={e => setCopy('heading_align', e.target.value)}
            disabled={!canEdit}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
            Aligns the section headings and the gold underline beneath them.
          </p>
        </div>

        {/* All remaining editable text */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', margin: '20px 0 4px' }}>Page text &amp; labels</label>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
          Every other piece of text on the landing page. Leave a field blank to use the built-in wording.
        </p>
        {LANDING_COPY_GROUPS.map(group => (
          <div key={group.title} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: '0 0 6px' }}>{group.title}</div>
            <div className="form-grid">
              {group.fields.map(f => (
                <div className="form-group" key={f.key} style={f.area ? { gridColumn: '1 / -1' } : undefined}>
                  <label>{f.label}</label>
                  {f.area ? (
                    <textarea
                      className="form-input" rows={2}
                      value={copyVal(f.key)} onChange={e => setCopy(f.key, e.target.value)}
                      disabled={!canEdit} placeholder={DEFAULT_COPY[f.key] || ''}
                    />
                  ) : (
                    <input
                      type="text" className="form-input"
                      value={copyVal(f.key)} onChange={e => setCopy(f.key, e.target.value)}
                      disabled={!canEdit} placeholder={DEFAULT_COPY[f.key] || ''}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <p style={{ fontSize: 11, color: '#64748b', margin: '14px 0 0' }}>
          The landing page also uses your logo, and the contact details (email, phone, address)
          from the sections below — edit those there.
        </p>
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

      <CollapsibleSection title="Email — outbound from the app">
        <p style={{ fontSize: 13, color: '#5a6478', marginTop: 0 }}>
          The app sends outbound email (engagement letters, payment / filing
          reminders, PDF-by-email from the client list, test sends) through
          each user's own email account. Supports Microsoft 365 / Outlook,
          Google Workspace / Gmail, and any custom SMTP server. Emails go
          FROM that individual so replies land in their inbox.
        </p>
        <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 4, padding: 12 }}>
          <strong style={{ fontSize: 13, color: '#1a365d' }}>Where to set it up</strong>
          <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#475569' }}>
            Each user goes to <strong>Settings → Email</strong>, picks their provider
            (Outlook / Gmail / Custom), enters their email address and an app password.
            Provider-specific app-password setup instructions are shown on that page.
            There's a "Send test email" button to verify it's working before relying on
            it for real sends.
          </p>
          <Link to="/settings/email" className="btn btn-secondary btn-sm">
            ✉ Open my Email Settings
          </Link>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, marginBottom: 0 }}>
          The Edge Function <code>send-via-outlook</code> must be deployed to your
          Supabase project for any outbound email to work. If sends start failing
          with "Edge Function not found", redeploy it from
          <code> supabase/functions/send-via-outlook/index.ts</code>.
        </p>
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
