import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useMFAStepUp, MFA_CANCELLED } from '../../context/MFAStepUpContext';
import { api, isStaffRole, hasPermission, isSupervisorOrHigher } from '../../services/api';

import { FieldCtx } from './fieldContext';
import ClientHeader from './ClientHeader';
import { Modal, Button } from '../ui';

import ClientInfoTab from './tabs/ClientInfoTab';
import ContactsTab from './tabs/ContactsTab';
import TaxRegistrationTab from './tabs/TaxRegistrationTab';
import DirectorsTab from './tabs/DirectorsTab';
import ComplianceTab from './tabs/ComplianceTab';
import NotesTab from './tabs/NotesTab';
import AuditTab from './tabs/AuditTab';

import InvoiceList from '../Invoice/InvoiceList';
import ChartOfAccounts from './ChartOfAccounts';
import ClientDocuments from '../Documents/ClientDocuments';
import VendorPatterns from './VendorPatterns';
import PlatformCredentials from './PlatformCredentials';
import KYCPanel from './KYCPanel';
import ClientEmails from './ClientEmails';
import TaxFilingsTab from './tabs/TaxFilingsTab';
import TimeTab from './tabs/TimeTab';
import FinancialsTab from './tabs/FinancialsTab';
import ClientBillingTab from './tabs/ClientBillingTab';
import ClientReportsTab from './ClientReportsTab';
// ClientTaxReturnTab is no longer a standalone tab — the editor lives inside TaxFilingsTab now.
// Import kept commented out for reference; safe to delete the file in a future cleanup pass.
// import ClientTaxReturnTab from './tabs/ClientTaxReturnTab';
import ApplyTaskTemplateModal from '../Admin/ApplyTaskTemplateModal';

type TabKey =
  | 'info' | 'contacts' | 'tax'
  | 'kyc' | 'directors' | 'credentials'
  | 'documents' | 'invoices' | 'financials' | 'customer_billing' | 'reports'
  | 'compliance' | 'tax_filings' | 'emails'
  | 'time'
  | 'notes' | 'audit'
  | 'accounts' | 'patterns';

const PRIMARY_TABS: { key: TabKey; label: string }[] = [
  { key: 'info',        label: 'Client Info' },
  { key: 'contacts',    label: 'Contacts' },
  { key: 'tax',         label: 'Registrations' },
  { key: 'kyc',         label: 'KYC' },
  { key: 'directors',   label: 'Directors' },
  { key: 'credentials', label: 'Credentials' },
  { key: 'documents',   label: 'Documents' },
  { key: 'invoices',    label: 'Invoices' },
  { key: 'financials',  label: 'Financials' },
  { key: 'customer_billing', label: 'Customer Billing' },
  { key: 'reports',     label: 'Reports' },
  { key: 'compliance',  label: 'Compliance' },
  { key: 'tax_filings', label: 'Tax Filings' },
  { key: 'emails',      label: 'Emails' },
  { key: 'time',        label: 'Time' },
  { key: 'notes',       label: 'Notes' },
  { key: 'audit',       label: 'Audit' },
];

const MORE_TABS: { key: TabKey; label: string }[] = [
  { key: 'accounts',    label: 'Chart of Accounts' },
  { key: 'patterns',    label: 'Vendor Patterns' },
];

// Shallow compare to detect dirty form
function isFormDirty(form: any, client: any): boolean {
  if (!client) return false;
  for (const k of Object.keys(form)) {
    const f = form[k];
    const c = client[k];
    // Coerce nullish to empty for comparison so '' and null are equal
    const fNorm = (f === null || f === undefined) ? '' : f;
    const cNorm = (c === null || c === undefined) ? '' : c;
    if (String(fNorm) !== String(cNorm)) return true;
  }
  return false;
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { clients, refreshClients, invoices } = useApp();
  const { user } = useAuth();
  const { runWith } = useMFAStepUp();

  const isAdmin = isStaffRole(user);
  // Deleting a client is a supervisor-or-higher action AND requires the
  // clients.delete permission. Edit / add / view remain open to all staff.
  const canDelete       = isSupervisorOrHigher(user) && hasPermission(user, 'clients.delete');
  const canInviteUsers  = hasPermission(user, 'users.write');
  const canEditClient   = hasPermission(user, 'clients.write');

  const [client, setClient] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [tab, setTab] = useState<TabKey>('info');
  const [moreOpen, setMoreOpen] = useState(false);

  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '' });
  const [inviting, setInviting] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const clientId = parseInt(id || '0');
  const isActive = client?.is_active !== false;
  // canToggleActive is the broad "can manage this client" perm — used for the
  // active/inactive switch and Save button. It does NOT depend on is_active,
  // otherwise an inactive client could never be reactivated.
  const canToggleActive = isAdmin && canEditClient;
  // editable is the form-fields gate — additionally requires the client to be active.
  const editable = canToggleActive && isActive;

  const loadClient = async () => {
    try {
      setLoadError(null);
      const data = await api.getClient(clientId);
      setClient(data);
      setForm(data || {});
    } catch (err: any) {
      // Distinguish "not found" from other errors so the UI doesn't hang
      const msg = String(err?.message || err);
      if (msg.includes('no rows') || msg.includes('PGRST116') || msg.includes('Results contain 0 rows')) {
        setLoadError('not_found');
      } else {
        setLoadError(msg);
      }
      setClient(null);
    } finally {
      setLoadedOnce(true);
    }
  };

  useEffect(() => { loadClient(); /* eslint-disable-next-line */ }, [id]);

  const handleChange = (field: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [field]: value }));
  };

  // Prev / Next by client_code order across all live clients
  const { prevClientId, nextClientId } = useMemo(() => {
    if (!clients || !client) return { prevClientId: null, nextClientId: null };
    const sorted = [...clients].sort((a: any, b: any) => (a.client_code || '').localeCompare(b.client_code || ''));
    const idx = sorted.findIndex(c => c.id === client.id);
    if (idx === -1) return { prevClientId: null, nextClientId: null };
    return {
      prevClientId: idx > 0 ? sorted[idx - 1].id : null,
      nextClientId: idx < sorted.length - 1 ? sorted[idx + 1].id : null,
    };
  }, [clients, client]);

  const isDirty = useMemo(() => isFormDirty(form, client), [form, client]);

  const handleSave = async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      if (isAdmin) {
        await api.updateClient(clientId, form);
      } else {
        await api.selfUpdateClient(clientId, form);
      }
      await refreshClients();
      await loadClient();
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    if (!isDirty) return;
    if (!confirm('Discard unsaved changes?')) return;
    setForm(client);
  };

  const handleToggleActive = () => {
    if (!canToggleActive) return;
    handleChange('is_active', !(form.is_active !== false));
  };

  const handleChangeStatus = (status: string) => {
    if (!canToggleActive) return;
    // If user picks a non-active status, also flip the toggle. The SQL trigger
    // would do this server-side, but we mirror it client-side so the toggle
    // updates immediately for visual feedback.
    handleChange('client_status', status);
    handleChange('is_active', status === 'active');
  };

  const handleDelete = async () => {
    if (!canDelete) { alert('You do not have permission to delete clients.'); return; }
    const count = invoices.filter((i: any) => i.client_id === clientId).length;
    const detail = count > 0 ? ` (${count} invoice${count === 1 ? '' : 's'} on file)` : '';
    const msg =
      `Hide "${client?.name || 'this client'}"${detail}?\n\n` +
      `The client is removed from the active list, but invoices, documents, ` +
      `compliance tasks, and credentials are preserved. You can restore the ` +
      `client at any time from Clients → Deleted.`;
    if (!confirm(msg)) return;
    try {
      await runWith(() => api.deleteClient(clientId));
      // Stay in the browsing flow — advance to the next client (or the
      // previous), only falling back to the list if this was the last one.
      const goTo = nextClientId ?? prevClientId;
      await refreshClients();
      navigate(goTo ? `/clients/${goTo}` : '/clients');
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Delete failed: ' + err.message);
    }
  };

  const handleCopy = async () => {
    if (!editable) return;
    if (!confirm(`Create a new client copied from "${client.name}"?`)) return;
    try {
      const copy: any = { ...form };
      // Strip identifying / unique fields so the new record gets fresh values
      delete copy.id;
      delete copy.client_code;     // auto-generated by trigger
      delete copy.unique_email;    // auto-generated by trigger
      delete copy.created_at;
      delete copy.updated_at;
      delete copy.deleted_at;
      delete copy.bulk_import_batch_id;
      copy.name = (form.name || '') + ' (copy)';
      const result = await api.createClient(copy);
      await refreshClients();
      navigate(`/clients/${result.id}`);
    } catch (err: any) {
      alert('Copy failed: ' + err.message);
    }
  };

  const openInvite = () => {
    setInviteForm({
      email: client?.email || '',
      full_name: client?.director_name || client?.name || '',
    });
    setShowInvite(true);
  };

  const handleSendInvite = async () => {
    if (!inviteForm.email.trim()) { alert('Email is required'); return; }
    setInviting(true);
    try {
      await runWith(() => api.inviteClient({
        email: inviteForm.email.trim(),
        full_name: inviteForm.full_name.trim() || undefined,
        client_id: clientId,
      }));
      alert(`Invite sent to ${inviteForm.email}. They'll get an email with a one-time link to set up their account.`);
      setShowInvite(false);
    } catch (err: any) {
      if (err.message !== MFA_CANCELLED) alert('Invite failed: ' + err.message);
    } finally {
      setInviting(false);
    }
  };

  const copyUniqueEmail = async () => {
    if (!client?.unique_email) return;
    try {
      await navigator.clipboard.writeText(client.unique_email);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 1500);
    } catch {
      alert('Copy failed — your browser blocked clipboard access.');
    }
  };

  if (!loadedOnce) return <div className="loading-screen">Loading...</div>;

  if (!client) {
    return (
      <div className="dashboard">
        <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Client #{clientId}</h2>
          <button className="btn btn-secondary" onClick={() => navigate('/clients')}>← Back to Clients</button>
        </div>
        <div className="empty-state" style={{ marginTop: 16 }}>
          {loadError === 'not_found' ? (
            <>
              <p>This client record doesn't exist (or has been hard-deleted).</p>
              <p style={{ fontSize: 13, color: '#64748b' }}>
                If it was soft-deleted you'll find it under <strong>Clients → Deleted</strong>. Otherwise the record is permanently gone — any tax filings, credentials, or other data pointing here are orphans.
              </p>
            </>
          ) : loadError ? (
            <p style={{ color: '#b91c1c' }}>Failed to load: {loadError}</p>
          ) : (
            <p>Client not available.</p>
          )}
        </div>
      </div>
    );
  }

  const ctxValue = { editing: editable, form, client, onChange: handleChange };

  return (
    <FieldCtx.Provider value={ctxValue}>
    <div className="client-detail-v2">
      <ClientHeader
        client={client}
        form={form}
        isDirty={isDirty}
        isSaving={saving}
        canEdit={editable}
        canToggleActive={canToggleActive}
        prevClientId={prevClientId}
        nextClientId={nextClientId}
        onSave={handleSave}
        onClear={handleClear}
        onDelete={handleDelete}
        onCopy={handleCopy}
        onToggleActive={handleToggleActive}
        onChangeStatus={handleChangeStatus}
      />

      {/* Quick-action strip (not part of the BTMS-style toolbar) */}
      <div className="cd-quick-strip">
        {canInviteUsers && (
          <button className="btn btn-secondary btn-sm" onClick={openInvite}>
            ✉️ Invite to portal
          </button>
        )}
        {isAdmin && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowApplyTemplate(true)}>
            📋 Apply task template
          </button>
        )}
        {isAdmin && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => window.open(`/billing/statement/${clientId}/print`, '_blank')}
          >
            📄 Print statement
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => window.open(`/clients/${clientId}/print`, '_blank')}
          title="Open a printable card with the client's full profile"
        >
          🖨 Print Client
        </button>
      </div>

      {/* Unique-email banner hidden until Email Integration (Task 5 / CloudMailin) is live.
          Re-enable by reverting this block once the inbound webhook is configured. */}
      {false && client.unique_email && (
        <div className="unique-email-banner">
          <div className="ueb-content">
            <div className="ueb-label">📧 Client's portal capture email</div>
            <div className="ueb-address">{client.unique_email}</div>
            <div className="ueb-hint">BCC or forward emails here to capture them in the Emails tab.</div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyUniqueEmail} title="Copy to clipboard">
            {copiedEmail ? '✓ Copied' : '⧉ Copy'}
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div className="cd-tabbar">
        {PRIMARY_TABS.map(t => (
          <button
            key={t.key}
            className={`cd-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <div className="cd-more-wrap">
          <button
            className={`cd-tab cd-tab-more ${MORE_TABS.some(t => t.key === tab) ? 'active' : ''}`}
            onClick={() => setMoreOpen(o => !o)}
          >
            More ▾
          </button>
          {moreOpen && (
            <div className="cd-more-menu" onMouseLeave={() => setMoreOpen(false)}>
              {MORE_TABS.map(t => (
                <button
                  key={t.key}
                  className={`cd-more-item ${tab === t.key ? 'active' : ''}`}
                  onClick={() => { setTab(t.key); setMoreOpen(false); }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="cd-tab-pane">
        {tab === 'info'        && <ClientInfoTab />}
        {tab === 'contacts'    && <ContactsTab />}
        {tab === 'tax'         && <TaxRegistrationTab />}
        {tab === 'kyc'         && <KYCPanel clientId={clientId} onRefresh={loadClient} />}
        {tab === 'directors'   && <DirectorsTab clientId={clientId} canEdit={editable} />}
        {tab === 'credentials' && <PlatformCredentials clientId={clientId} />}
        {tab === 'documents'   && <ClientDocuments clientId={clientId} />}
        {tab === 'invoices'    && <InvoiceList clientId={clientId} />}
        {tab === 'financials'  && <FinancialsTab clientId={clientId} />}
        {tab === 'customer_billing' && <ClientBillingTab clientId={clientId} />}
        {tab === 'reports'     && <ClientReportsTab clientId={clientId} />}
        {tab === 'compliance'  && <ComplianceTab clientId={clientId} />}
        {tab === 'tax_filings' && <TaxFilingsTab clientId={clientId} canEdit={editable} clientName={client.name} client={client} />}
        {tab === 'emails'      && <ClientEmails clientId={clientId} />}
        {tab === 'time'        && <TimeTab clientId={clientId} clientName={client.name} />}
        {tab === 'notes'       && <NotesTab />}
        {tab === 'audit'       && <AuditTab clientId={clientId} />}
        {tab === 'accounts'    && <ChartOfAccounts clientId={clientId} />}
        {tab === 'patterns'    && <VendorPatterns clientId={clientId} />}
      </div>

      {showApplyTemplate && (
        <ApplyTaskTemplateModal
          preSelectedClientId={clientId}
          onClose={() => setShowApplyTemplate(false)}
          onApplied={(n) => alert(`Created ${n} task(s) for ${client.name}.`)}
        />
      )}

      <Modal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        title={`Invite ${client?.name || ''} to the portal`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowInvite(false)} disabled={inviting}>Cancel</Button>
            <Button variant="primary" onClick={handleSendInvite} disabled={inviting}>
              {inviting ? 'Sending…' : 'Send invite'}
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--pc-text-2)', marginBottom: 16 }}>
          They'll get an email with a one-time link. Clicking it signs them in;
          they then set their own password on the Security page.
        </p>
        <div className="form-group">
          <label>Email *</label>
          <input
            type="email"
            className="form-input"
            value={inviteForm.email}
            onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
            placeholder="client@example.com"
            autoFocus
          />
        </div>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Full name (optional)</label>
          <input
            type="text"
            className="form-input"
            value={inviteForm.full_name}
            onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
          />
        </div>
      </Modal>
    </div>
    </FieldCtx.Provider>
  );
}
