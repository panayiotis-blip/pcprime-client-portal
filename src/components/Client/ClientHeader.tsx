import { useNavigate } from 'react-router-dom';
import {
  X, ChevronLeft, ChevronRight, ChevronDown, Search, Plus, Copy, Undo2,
  Printer, Trash2, Save,
} from 'lucide-react';
import { Menu, type MenuItem } from '../ui';

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
  // Record-level actions owned by ClientDetail (invite, templates, statements).
  // They join the "More actions" menu instead of a second button strip.
  extraActions?: MenuItem[];
}

const CLIENT_STATUSES: { value: string; label: string }[] = [
  { value: 'active',             label: 'Active' },
  { value: 'liquidated_dormant', label: 'Liquidated / Dormant' },
  { value: 'deceased',           label: 'Deceased' },
  { value: 'old_client',         label: 'Old Client' },
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
  extraActions = [],
}: Props) {
  const navigate = useNavigate();
  const isActive = client.is_active !== false;

  // Header now shows ONLY one line: the legal name for companies, or
  // "First Surname" for individuals. The tax-office name + every other
  // detail lives on the tabs below — keep the header read-cleanly.
  const data = { ...client, ...form };
  const isIndividual = (data.client_type || 'company') === 'individual';
  const displayName = isIndividual
    ? [data.first_name, data.surname].filter(Boolean).join(' ').trim() || data.name || '—'
    : (data.legal_name || data.name || '—');

  return (
    <div className="client-header-band">
      <div className="chb-main">
        <div className="chb-identity">
          <div className="chb-name">{displayName}</div>
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
        {/* Navigation — leaving or moving between records */}
        <div className="chb-group">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/clients')} title="Back to client list (close)">
            <X size={14} /> Close
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => prevClientId && navigate(`/clients/${prevClientId}`)}
            disabled={!prevClientId || isDirty}
            title={isDirty ? 'Save changes before navigating' : 'Previous client'}
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => nextClientId && navigate(`/clients/${nextClientId}`)}
            disabled={!nextClientId || isDirty}
            title={isDirty ? 'Save changes before navigating' : 'Next client'}
          >
            Next <ChevronRight size={14} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/clients')} title="Search the client list">
            <Search size={14} /> Find
          </button>
        </div>

        <span className="chb-divider" aria-hidden="true" />

        {/* Record actions — everything that isn't save or delete */}
        <Menu
          label={<>More actions <ChevronDown size={14} /></>}
          align="left"
          items={[
            {
              key: 'new',
              label: 'New client',
              icon: <Plus size={14} />,
              onSelect: () => navigate('/clients?new=1'),
            },
            {
              key: 'copy',
              label: 'Copy',
              icon: <Copy size={14} />,
              onSelect: onCopy,
              disabled: !canEdit,
              title: 'Duplicate this client as a new record',
            },
            {
              key: 'clear',
              label: 'Clear',
              icon: <Undo2 size={14} />,
              onSelect: onClear,
              disabled: !isDirty || !canEdit,
              title: isDirty ? 'Discard unsaved changes' : 'No changes to discard',
            },
            {
              key: 'print',
              label: 'Print',
              icon: <Printer size={14} />,
              href: `/clients/${client.id}/print`,
              target: '_blank',
              title: 'Open print-friendly client card',
              separatorBefore: true,
            },
            ...extraActions,
          ]}
        />

        <span className="chb-spacer" />

        {/* Destructive / commit — the only filled buttons in this bar */}
        <div className="chb-group">
          <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={!canEdit}>
            <Trash2 size={14} /> Delete
          </button>
          <button
            className={`btn btn-primary btn-sm ${isDirty ? 'chb-save-dirty' : ''}`}
            onClick={onSave}
            disabled={!isDirty || !canToggleActive || isSaving}
            title={isDirty ? 'Save unsaved changes' : 'No changes to save'}
          >
            <Save size={14} /> {isSaving ? 'Saving…' : isDirty ? '● Save' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
