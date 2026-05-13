import { Field } from '../fieldContext';

// Tab 2: Contacts — address, phone, email, web.
export default function ContactsTab() {
  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Contact Person</h3>
        <div className="form-grid">
          <Field label="Contact Person" field="contact_person" />
          <Field label="Email" field="email" type="email" />
          <Field label="Phone" field="phone" />
          <Field label="Mobile" field="mobile" />
          <Field label="Fax" field="fax" />
          <Field label="Website" field="website" placeholder="https://..." />
        </div>
      </div>

      <div className="form-section">
        <h3>Registered Address</h3>
        <div className="form-grid">
          <Field label="Address" field="address" fullWidth />
          <Field label="City" field="city" />
          <Field label="Postal Code" field="postal_code" />
          <Field label="Country" field="country" />
        </div>
      </div>
    </div>
  );
}
