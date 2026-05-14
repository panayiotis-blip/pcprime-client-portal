import type { ClientAddress } from '../../services/api';

// Reusable address block — used by ContactsTab for the 2-3 typed addresses
// per client (registered / trading / postal / home). Owns no state; pure
// controlled component fed by the parent.

type Props = {
  editing: boolean;
  value: Partial<ClientAddress>;
  onChange: (patch: Partial<ClientAddress>) => void;
  title: string;
  // The primary address (registered for companies, home for individuals)
  // that this block can optionally link to. When null, the linked-checkbox is hidden.
  primaryAddress?: Partial<ClientAddress> | null;
  primaryLabel?: string;     // e.g. "Same as Registered"
};

const fmtMultiline = (a: Partial<ClientAddress>) => {
  const lines = [
    a.line1, a.line2,
    [a.postal_code, a.city].filter(Boolean).join(' '),
    a.country,
  ].filter(Boolean) as string[];
  return lines.length === 0 ? '—' : lines.join('\n');
};

export default function AddressBlock({
  editing, value, onChange, title, primaryAddress, primaryLabel,
}: Props) {
  const linked = !!value.is_linked_to_registered && !!primaryAddress;

  // While linked, display the primary address's values regardless of what's
  // stored — the parent flushes the snapshot to this row on save so the DB
  // mirrors the link state.
  const display = linked && primaryAddress ? primaryAddress : value;

  return (
    <div className="form-section" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {primaryAddress && editing && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
            <input
              type="checkbox"
              checked={linked}
              onChange={e => onChange({ is_linked_to_registered: e.target.checked })}
            />
            {primaryLabel || 'Same as primary'}
          </label>
        )}
      </div>

      {editing ? (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-group full-width">
            <label>Address line 1</label>
            <input
              type="text" className="form-input"
              value={display.line1 || ''}
              onChange={e => onChange({ line1: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group full-width">
            <label>Address line 2</label>
            <input
              type="text" className="form-input"
              value={display.line2 || ''}
              onChange={e => onChange({ line2: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group">
            <label>City</label>
            <input
              type="text" className="form-input"
              value={display.city || ''}
              onChange={e => onChange({ city: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group">
            <label>Postal code</label>
            <input
              type="text" className="form-input"
              value={display.postal_code || ''}
              onChange={e => onChange({ postal_code: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group">
            <label>Country</label>
            <input
              type="text" className="form-input"
              value={display.country || ''}
              onChange={e => onChange({ country: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group full-width">
            <label>Notes</label>
            <textarea
              className="form-input" rows={2}
              value={display.notes || ''}
              onChange={e => onChange({ notes: e.target.value })}
              disabled={linked}
            />
          </div>
        </div>
      ) : (
        <p className="field-value" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
          {fmtMultiline(display)}
          {display.notes ? <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 4 }}>{display.notes}</span> : null}
        </p>
      )}
    </div>
  );
}
