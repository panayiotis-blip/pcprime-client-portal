import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

interface Props {
  client: any;
  form: any;
  isDirty: boolean;
  isSaving: boolean;
  canEdit: boolean;          // form-edit (requires active client)
  canToggleActive: boolean;  // toggle the active/inactive switch (works on inactive too)
  prevClientId: number | null;
  nextClientId: number | null;
  onSave: () => void;
  onClear: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onToggleActive: () => void;
  onChangeStatus: (status: string) => void;
}

const CLIENT_STATUSES: { value: string; label: string }[] = [
  { value: 'active',             label: 'Active' },
  { value: 'liquidated_dormant', label: 'Liquidated / Dormant' },
  { value: 'deceased',           label: 'Deceased' },
  { value: 'old_client',         label: 'Old Client' },
  { value: 'defence_tax_only',   label: 'Defence Tax Only' },
  { value: 'internal',           label: 'Internal' },
];

// Statuses that are "definitive" — flipping the toggle back to Active asks for confirmation
const DEFINITIVE_INACTIVE = new Set(['deceased', 'liquidated_dormant']);
export { CLIENT_STATUSES, DEFINITIVE_INACTIVE };

// BTMS-style header band: client name + tax-office name, code badge,
// active/inactive switch, and the toolbar of action buttons.
// Pure-presentation — all behaviour passed in as props.
export default function ClientHeader({
  client, form, isDirty, isSaving, canEdit, canToggleActive,
  prevClientId, nextClientId,
  onSave, onClear, onDelete, onCopy, onToggleActive, onChangeStatus,
}: Props) {
  const navigate = useNavigate();
  const [findOpen, setFindOpen] = useState(false);
  const isActive = client.is_active !== false;

  return (
    <div className="client-header-band">
      <div className="chb-main">
        <div className="chb-identity">
          <div className="chb-name">{form.name || client.name || '—'}</div>
          {(form.name_tax_office || client.name_tax_office) && (
            <div className="chb-name-tax">{form.name_tax_office || client.name_tax_office}</div>
          )}
        </div>

        <div className="chb-meta">
          {client.client_code && (
            <span className="chb-code-badge">{client.client_code}</span>
          )}
          <label className={`chb-active-switch ${isActive ? 'active' : 'inactive'}`} title={canToggleActive ? 'Toggle active/inactive' : 'Read-only'}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={onToggleActive}
              disabled={!canToggleActive}
            />
            <span className="chb-active-label">{isActive ? '● Active' : '○ Inactive'}</span>
          </label>
          {canToggleActive && (
            <select
              className="form-input form-input-sm chb-status-select"
              value={form.client_status || client.client_status || 'active'}
              onChange={(e) => onChangeStatus(e.target.value)}
              title="Detailed client status — drives the Active/Inactive toggle"
            >
              {CLIENT_STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {!isActive && (
        <div className="chb-inactive-banner">⚠ INACTIVE — read-only</div>
      )}

      <div className="chb-actions">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/clients')} title="Back to client list (close)">
          ⤺ Close
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => prevClientId && navigate(`/clients/${prevClientId}`)}
          disabled={!prevClientId || isDirty}
          title={isDirty ? 'Save changes before navigating' : 'Previous client'}
        >
          ◀ Prev
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => nextClientId && navigate(`/clients/${nextClientId}`)}
          disabled={!nextClientId || isDirty}
          title={isDirty ? 'Save changes before navigating' : 'Next client'}
        >
          Next ▶
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/clients')}>
          🔍 Find
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/clients?new=1')}>
          ＋ New
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCopy} disabled={!canEdit} title="Duplicate this client as a new record">
          ⎘ Copy
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onClear} disabled={!isDirty || !canEdit} title="Discard unsaved changes">
          ✕ Clear
        </button>
        <a
          href={`/clients/${client.id}/print`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm"
          title="Open print-friendly client card"
        >
          🖨 Print
        </a>
        <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={!canEdit}>
          🗑 Delete
        </button>
        <button
          className={`btn btn-primary btn-sm ${isDirty ? 'chb-save-dirty' : ''}`}
          onClick={onSave}
          disabled={!isDirty || !canToggleActive || isSaving}
          title={isDirty ? 'Save unsaved changes' : 'No changes to save'}
        >
          {isSaving ? 'Saving…' : isDirty ? '● Save' : 'Save'}
        </button>
      </div>
    </div>
  );
}
