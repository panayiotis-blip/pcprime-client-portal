import { Field } from '../fieldContext';

const CLIENT_CATEGORIES = [
  'company', 'partnership', 'individual', 'sole_trader',
  'self_employed', 'deceased', 'dormant', 'prospective', 'other',
];

const BUSINESS_TYPES = [
  'Limited Company', 'Sole Trader', 'Partnership', 'Self-Employed',
  'Non-Profit', 'Trust', 'Other',
];

const STATUSES = ['active', 'inactive', 'suspended'];

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
        </div>
      </div>

      <div className="form-section">
        <h3>Dates &amp; Period</h3>
        <div className="form-grid">
          <Field label="Incorporation Date" field="incorporation_date" type="date" />
          <Field label="Date of Birth" field="date_of_birth" type="date" />
          <Field label="Year End Date (DD/MM)" field="year_end_date" placeholder="31/12" />
          <Field label="Financial Year End" field="financial_year_end" placeholder="(legacy free-text)" />
          <Field label="VAT Period" field="vat_period" placeholder="1/4/7/10" />
          <Field label="Services" field="services" />
          <Field label="Monthly Fee" field="monthly_fee" type="number" />
        </div>
      </div>
    </div>
  );
}
