import { Field, useFieldCtx } from '../fieldContext';

const CLIENT_CATEGORIES = [
  'company', 'partnership', 'individual', 'sole_trader',
  'self_employed', 'deceased', 'dormant', 'prospective', 'other',
  'vendor_only',
];

const BUSINESS_TYPES = [
  'Limited Company', 'Sole Trader', 'Partnership', 'Self-Employed',
  'Non-Profit', 'Trust', 'Other',
];

const STATUSES = ['active', 'inactive', 'suspended'];

// Inline tags input/display — array on read, comma-separated string on edit.
// FieldCtx's onChange happily takes any type; the API write-boundary splits
// on commas before persisting.
function TagsField() {
  const { editing, form, client, onChange } = useFieldCtx();
  const tagsValue = (editing ? form.tags : client.tags);
  const tagsArray: string[] = Array.isArray(tagsValue)
    ? tagsValue
    : (typeof tagsValue === 'string' ? tagsValue.split(/[,;]+/).map(s => s.trim()).filter(Boolean) : []);
  const tagsStringForEdit = typeof form.tags === 'string'
    ? form.tags
    : tagsArray.join(', ');

  return (
    <div className="form-group full-width">
      <label>Tags</label>
      {editing ? (
        <>
          <input
            type="text"
            className="form-input"
            value={tagsStringForEdit}
            onChange={(e) => onChange('tags', e.target.value)}
            placeholder="VIP, Audit Client, Late Payer (comma-separated)"
          />
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>Separate with commas or semicolons.</p>
        </>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0' }}>
          {tagsArray.length === 0 ? (
            <span style={{ color: '#94a3b8' }}>—</span>
          ) : tagsArray.map(t => (
            <span key={t} style={{
              background: '#eef1f5', color: 'var(--pc-navy-2)',
              padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
            }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Part 6B — "this client is also a vendor / supplier" toggle.
function VendorToggle() {
  const { editing, form, client, onChange } = useFieldCtx();
  const isVendor = (editing ? form.is_vendor : client.is_vendor) === true;
  return (
    <div className="form-group full-width">
      <label>Vendor / Supplier</label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: editing ? 'pointer' : 'default' }}>
        <input
          type="checkbox"
          checked={isVendor}
          disabled={!editing}
          onChange={(e) => onChange('is_vendor', e.target.checked)}
        />
        This client is also a vendor / supplier
      </label>
      <p style={{ fontSize: 11, color: 'var(--pc-text-2)', margin: '4px 0 0' }}>
        When ticked, the client appears in the vendor dropdown on Purchase Invoices.
      </p>
    </div>
  );
}

// Tab 1: Client Info — name, tax-office name, classification, status,
// dates. Splits out of the legacy monolithic Info tab.
export default function ClientInfoTab() {
  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Identification</h3>
        <div className="form-grid">
          <Field label="Client Code" field="client_code" />
          <Field label="Legal Name" field="name" />
          <Field label="Name as per Tax Office" field="name_tax_office" placeholder="Greek name as on tax returns" />
          <Field label="Trading Name" field="trading_name" />
        </div>
      </div>

      <div className="form-section">
        <h3>Classification</h3>
        <div className="form-grid">
          <Field label="Client Category" field="client_category" options={CLIENT_CATEGORIES} />
          <Field label="Business Type" field="business_type" options={BUSINESS_TYPES} />
          <Field label="Tax Return Type" field="tax_return_type" placeholder="e.g. Employee (04), Self-employed (21)" />
          <Field label="Status" field="status" options={STATUSES} />
          <VendorToggle />
        </div>
      </div>

      <div className="form-section">
        <h3>Engagement</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
          Incorporation date, year-end, VAT period and personal dates live in the <strong>Registrations</strong> tab.
        </p>
        <div className="form-grid">
          <Field label="Financial Year End" field="financial_year_end" placeholder="(legacy free-text)" />
          <Field label="Services" field="services" />
          <Field label="Monthly Fee" field="monthly_fee" type="number" />
        </div>
      </div>

      <div className="form-section">
        <h3>Tags</h3>
        <div className="form-grid">
          <TagsField />
        </div>
      </div>
    </div>
  );
}
