import { useState, useEffect, createContext, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api, isStaffRole, hasPermission } from '../../services/api';
import InvoiceList from '../Invoice/InvoiceList';
import ChartOfAccounts from './ChartOfAccounts';
import ClientDocuments from '../Documents/ClientDocuments';
import VendorPatterns from './VendorPatterns';
import PlatformCredentials from './PlatformCredentials';
import KYCPanel from './KYCPanel';

// FieldCtx + Field are defined OUTSIDE ClientDetail on purpose.
// Defining a component inside another component creates a new
// component identity on every render, which causes React to
// unmount and remount the inputs — and you lose focus after every
// keystroke. Hoisting Field out and pulling shared state from
// context fixes that without changing the call sites below.
const FieldCtx = createContext<{
  editing: boolean;
  form: any;
  client: any;
  onChange: (field: string, value: string) => void;
}>({ editing: false, form: {}, client: {}, onChange: () => {} });

function Field({ label, field, type = 'text', options }:
  { label: string; field: string; type?: string; options?: string[] }) {
  const { editing, form, client, onChange } = useContext(FieldCtx);
  return (
    <div className="form-group">
      <label>{label}</label>
      {editing ? (
        options ? (
          <select value={form[field] || ''} onChange={(e) => onChange(field, e.target.value)} className="form-input">
            <option value="">--</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : type === 'textarea' ? (
          <textarea value={form[field] || ''} onChange={(e) => onChange(field, e.target.value)} className="form-input" rows={3} />
        ) : (
          <input type={type} value={form[field] || ''} onChange={(e) => onChange(field, e.target.value)} className="form-input" />
        )
      ) : (
        <p className="field-value">{client[field] || '-'}</p>
      )}
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { clients, refreshClients, invoices } = useApp();
  const { user } = useAuth();
  const isAdmin = isStaffRole(user);
  const canDelete = hasPermission(user, 'clients.delete');
  const canSeeCredentials = hasPermission(user, 'credentials.read');
  const [tab, setTab] = useState<'info' | 'invoices' | 'documents' | 'accounts' | 'patterns' | 'credentials' | 'kyc'>('info');
  const [client, setClient] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const clientId = parseInt(id || '0');

  const loadClient = async () => {
    try {
      const data = await api.getClient(clientId);
      setClient(data);
      setForm(data);
    } catch {}
  };

  useEffect(() => { loadClient(); }, [id]);

  const handleChange = (field: string, value: string) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleDelete = async () => {
    const count = invoices.filter((i: any) => i.client_id === clientId).length;
    const msg = count > 0
      ? `This client has ${count} invoice(s). Deleting will remove them and all documents, credentials, and accounts for this client. Continue?`
      : 'Delete this client and all their data?';
    if (!confirm(msg)) return;
    try {
      await api.deleteClient(clientId);
      await refreshClients();
      navigate('/clients');
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Clients can only self-update basic info; admins can update everything
      if (isAdmin) {
        await api.updateClient(clientId, form);
      } else {
        await api.selfUpdateClient(clientId, form);
      }
      await refreshClients();
      await loadClient();
      setEditing(false);
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!client) return <div className="loading-screen">Loading...</div>;

  const tabs = [
    { key: 'info', label: 'Client Info' },
    { key: 'kyc', label: 'KYC' },
    { key: 'invoices', label: 'Invoices' },
    { key: 'documents', label: 'Documents' },
    { key: 'accounts', label: 'Chart of Accounts' },
    { key: 'patterns', label: 'Vendor Patterns' },
    ...(canSeeCredentials ? [{ key: 'credentials', label: 'Platform Logins' }] : []),
  ];

  return (
    <div className="client-detail">
      <div className="client-detail-header">
        <div>
          <h2>
            {client.client_code && <span className="client-code-inline">{client.client_code}</span>}
            {client.name}
          </h2>
          {client.trading_name && <p className="trading-name">{client.trading_name}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`status-badge status-${client.status === 'active' ? 'reviewed' : 'draft'}`}>{client.status || 'active'}</span>
          {canDelete && <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete Client</button>}
        </div>
      </div>

      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key as any)}>{t.label}</button>
        ))}
      </div>

      {tab === 'info' && (
        <FieldCtx.Provider value={{ editing, form, client, onChange: handleChange }}>
        <div className="client-info-full">
          <div className="info-actions">
            {editing ? (
              <>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
                <button className="btn btn-secondary" onClick={() => { setEditing(false); setForm(client); }}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => setEditing(true)}>Edit Client</button>
            )}
          </div>

          <div className="form-section">
            <h3>Company / Individual</h3>
            <div className="form-grid">
              <Field label="Client Code" field="client_code" />
              <Field label="Legal Name" field="name" />
              <Field label="Trading Name" field="trading_name" />
              <Field label="Business Type" field="business_type" options={['Sole Trader', 'Limited Company', 'Partnership', 'Self-Employed', 'Non-Profit', 'Trust', 'Other']} />
              <Field label="Status" field="status" options={['active', 'inactive', 'suspended']} />
              <Field label="Registration Number (HE)" field="registration_number" />
              <Field label="Director Name" field="director_name" />
              <Field label="Incorporation Date" field="incorporation_date" type="date" />
              <Field label="Financial Year End" field="financial_year_end" />
              <Field label="Services" field="services" />
              <Field label="Monthly Fee" field="monthly_fee" />
            </div>
          </div>

          <div className="form-section">
            <h3>Tax & Government IDs</h3>
            <div className="form-grid">
              <Field label="Tax Number (TIC)" field="tax_number" />
              <Field label="VAT Number" field="vat_number" />
              <div className="form-group">
                <label>VAT Registered</label>
                {editing ? (
                  <select
                    value={form.vat_registered ? 'yes' : 'no'}
                    onChange={(e) => setForm((p: any) => ({ ...p, vat_registered: e.target.value === 'yes' }))}
                    className="form-input"
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                ) : (
                  <p className="field-value">{client.vat_registered ? 'Yes' : 'No'}</p>
                )}
              </div>
              <div className="form-group">
                <label>VAT Period Group (Cyprus)</label>
                {editing ? (
                  <select
                    value={form.vat_period_group ?? ''}
                    onChange={(e) => setForm((p: any) => ({ ...p, vat_period_group: e.target.value === '' ? null : Number(e.target.value) }))}
                    className="form-input"
                    disabled={!form.vat_registered}
                  >
                    <option value="">--</option>
                    <option value="1">Group 1 — Jan/Apr/Jul/Oct</option>
                    <option value="2">Group 2 — Feb/May/Aug/Nov</option>
                    <option value="3">Group 3 — Mar/Jun/Sep/Dec</option>
                  </select>
                ) : (
                  <p className="field-value">
                    {client.vat_period_group ? `Group ${client.vat_period_group}` : '-'}
                  </p>
                )}
              </div>
              <Field label="Social Insurance Number" field="social_insurance_number" />
              <Field label="Employer Number (SI)" field="employer_number" />
              <Field label="Ergani Number" field="ergani_number" />
              <Field label="ID Number" field="id_number" />
              <Field label="Passport Number" field="passport_number" />
              <Field label="Date of Birth" field="date_of_birth" type="date" />
              <Field label="Nationality" field="nationality" />
            </div>
          </div>

          <div className="form-section">
            <h3>Contact Details</h3>
            <div className="form-grid">
              <Field label="Contact Person" field="contact_person" />
              <Field label="Email" field="email" type="email" />
              <Field label="Phone" field="phone" />
              <Field label="Mobile" field="mobile" />
              <Field label="Website" field="website" />
            </div>
          </div>

          <div className="form-section">
            <h3>Address</h3>
            <div className="form-grid">
              <Field label="Address" field="address" />
              <Field label="City" field="city" />
              <Field label="Postal Code" field="postal_code" />
              <Field label="Country" field="country" />
            </div>
          </div>

          <div className="form-section">
            <h3>Notes</h3>
            <Field label="" field="notes" type="textarea" />
          </div>
        </div>
        </FieldCtx.Provider>
      )}

      {tab === 'invoices' && <InvoiceList clientId={clientId} />}
      {tab === 'documents' && <ClientDocuments clientId={clientId} />}
      {tab === 'accounts' && <ChartOfAccounts clientId={clientId} />}
      {tab === 'patterns' && <VendorPatterns clientId={clientId} />}
      {tab === 'credentials' && <PlatformCredentials clientId={clientId} />}
      {tab === 'kyc' && <KYCPanel clientId={clientId} onRefresh={loadClient} />}
    </div>
  );
}
