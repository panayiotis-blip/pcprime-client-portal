import { Field, useFieldCtx } from '../fieldContext';
import { VAT_CATEGORIES, MONTHS, vatPeriods } from '../../../services/vatCategories';

// Renamed from "Tax & Reg" to "Registrations" (UI polish part 6).
// Four panels with show/hide based on client_category. A panel that's normally
// hidden for a category still appears if it has any populated data (so legacy
// records aren't silently hidden).
const VAT_STATUSES = ['Regular', 'Reduced', 'Exempt', 'Not Registered'];

const isCompanyLike = (cat: string) =>
  cat === 'company' || cat === 'partnership' || cat === 'sole_trader';
const isIndividualLike = (cat: string) =>
  cat === 'individual' || cat === 'self_employed' || cat === 'deceased' ||
  cat === 'dormant'    || cat === 'prospective'   || cat === 'other';

// Read-only line showing the filing periods computed from a category +
// starting-month pair. Updates live while editing.
function VatPeriodsLine({ categoryField, monthField, label }: {
  categoryField: string;
  monthField: string;
  label: string;
}) {
  const { client, form, editing } = useFieldCtx();
  const data = editing ? { ...client, ...form } : client;
  const periods = vatPeriods(data?.[categoryField], data?.[monthField]);

  if (periods.length === 0) {
    if (editing && data?.[categoryField]) {
      return (
        <div className="form-group full-width">
          <label>{label}</label>
          <p className="field-value" style={{ color: 'var(--pc-text-2)' }}>
            Select a starting month to see the periods.
          </p>
        </div>
      );
    }
    return null;
  }
  return (
    <div className="form-group full-width">
      <label>{label}</label>
      <p className="field-value">{periods.join('   ·   ')}</p>
    </div>
  );
}

export default function TaxRegistrationTab() {
  const { client, form, editing } = useFieldCtx();
  const data = editing ? { ...client, ...form } : client;
  const cat = (data?.client_category || '') as string;

  // Whether each panel renders. Panels that are normally hidden still appear
  // if there's data in them — avoids stranding old records.
  const showCompany = isCompanyLike(cat) ||
    !!data?.registration_number || !!data?.incorporation_date || !!data?.year_end_date;
  const showSI = isCompanyLike(cat) || cat === 'self_employed' ||
    !!data?.social_insurance_number || !!data?.employer_number ||
    !!data?.ergani_number || !!data?.si_registration_date;
  const showPersonal = isIndividualLike(cat) ||
    !!data?.id_number || !!data?.passport_number ||
    !!data?.date_of_birth || !!data?.nationality;

  return (
    <div className="client-tab-content">
      {/* Panel 1 — Tax Registration (always shown) */}
      <div className="form-section">
        <h3>Tax Registration</h3>
        <div className="form-grid">
          <Field label="Tax Number (TIC)"      field="tax_number" />
          <Field label="VAT Number"            field="vat_number" />
          <Field label="VAT Status"            field="vat_status" options={VAT_STATUSES} />
          <Field label="VAT Registration Date" field="vat_registration_date" type="date" />
          <Field label="VAT Category"          field="vat_category" options={VAT_CATEGORIES} />
          <Field label="VAT Starting Month"    field="vat_start_month" options={MONTHS} />
          <VatPeriodsLine categoryField="vat_category" monthField="vat_start_month" label="VAT Periods" />
          <Field label="OSS VAT Category"      field="oss_vat_category" options={VAT_CATEGORIES} />
          <Field label="OSS Starting Month"    field="oss_vat_start_month" options={MONTHS} />
          <VatPeriodsLine categoryField="oss_vat_category" monthField="oss_vat_start_month" label="OSS VAT Periods" />
        </div>
      </div>

      {/* Panel 2 — Company Registration (companies / partnerships / sole traders) */}
      {showCompany && (
        <div className="form-section">
          <h3>Company Registration</h3>
          <div className="form-grid">
            <Field label="Registration Number (HE)" field="registration_number" />
            <Field label="Incorporation Date"       field="incorporation_date" type="date" />
            <Field label="Year End Date (DD/MM)"    field="year_end_date" placeholder="31/12" />
          </div>
        </div>
      )}

      {/* Panel 3 — Social Insurance (employers) */}
      {showSI && (
        <div className="form-section">
          <h3>Social Insurance</h3>
          <div className="form-grid">
            <Field label="Social Insurance Number" field="social_insurance_number" />
            <Field label="Employer Number (SI)"    field="employer_number" />
            <Field label="Ergani Number"           field="ergani_number" />
            <Field label="SI Registration Date"    field="si_registration_date" type="date" />
          </div>
        </div>
      )}

      {/* Panel 4 — Personal Identification (individuals) */}
      {showPersonal && (
        <div className="form-section">
          <h3>Personal Identification</h3>
          <div className="form-grid">
            <Field label="ID Number"        field="id_number" />
            <Field label="Passport Number"  field="passport_number" />
            <Field label="Date of Birth"    field="date_of_birth" type="date" />
            <Field label="Nationality"      field="nationality" />
          </div>
        </div>
      )}
    </div>
  );
}
