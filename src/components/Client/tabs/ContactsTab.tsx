import { Field, useFieldCtx } from '../fieldContext';
import { EmailLinks, isValidEmailList } from '../../shared/MultiEmail';

// Tab 2: Contacts — address, phone, email, web.
// Email is special: real client records often have multiple addresses
// (owner + accountant + reception). We accept ';' or ',' separators.
export default function ContactsTab() {
  const { editing, form, client, onChange } = useFieldCtx();
  const emailValue = (editing ? form.email : client.email) || '';
  const emailLooksOk = isValidEmailList(emailValue);

  return (
    <div className="client-tab-content">
      <div className="form-section">
        <h3>Contact Person</h3>
        <div className="form-grid">
          <Field label="Contact Person" field="contact_person" />
          <div className="form-group">
            <label>Email</label>
            {editing ? (
              <>
                <input
                  type="text"
                  value={form.email || ''}
                  onChange={(e) => onChange('email', e.target.value)}
                  className="form-input"
                  placeholder="one@x.com; another@y.com"
                  style={emailLooksOk ? undefined : { borderColor: '#dc2626' }}
                />
                <p style={{ fontSize: 11, color: emailLooksOk ? '#64748b' : '#dc2626', margin: '4px 0 0 0' }}>
                  {emailLooksOk
                    ? 'Multiple addresses separated by ; or ,'
                    : 'One or more addresses look invalid'}
                </p>
              </>
            ) : (
              <p className="field-value"><EmailLinks value={client.email} /></p>
            )}
          </div>
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
