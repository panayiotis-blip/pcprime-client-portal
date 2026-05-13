import { Field } from '../fieldContext';

// Tab 3: Tax & Registration — all the numbers and identifiers.
export default function TaxRegistrationTab() {
  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Tax &amp; VAT</h3>
        <div className="form-grid">
          <Field label="Tax Number (TIC)" field="tax_number" />
          <Field label="VAT Number" field="vat_number" />
          <Field label="Registration Number (HE)" field="registration_number" />
        </div>
      </div>

      <div className="form-section">
        <h3>Employment / SI</h3>
        <div className="form-grid">
          <Field label="Social Insurance Number" field="social_insurance_number" />
          <Field label="Employer Number (SI)" field="employer_number" />
          <Field label="Ergani Number" field="ergani_number" />
        </div>
      </div>

      <div className="form-section">
        <h3>Personal Identification</h3>
        <div className="form-grid">
          <Field label="ID Number" field="id_number" />
          <Field label="Passport Number" field="passport_number" />
          <Field label="Nationality" field="nationality" />
        </div>
      </div>
    </div>
  );
}
