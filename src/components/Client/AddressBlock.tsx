import { useId } from 'react';
import type { ClientAddress } from '../../services/api';

// Reusable address block — used by ContactsTab for the 2-3 typed addresses
// per client (registered / trading / postal / home). Owns no state; pure
// controlled component fed by the parent.

type Props = {
  editing: boolean;
  value: Partial<ClientAddress>;
  onChange: (patch: Partial<ClientAddress>) => void;
  title: string;
  cities?: string[];
  // The primary address (registered for companies, home for individuals)
  // that this block can optionally link to. When null, the linked-checkbox is hidden.
  primaryAddress?: Partial<ClientAddress> | null;
  primaryLabel?: string;     // e.g. "Same as Registered"
};

const fmtMultiline = (a: Partial<ClientAddress>) => {
  const lines = [
    a.office, a.line1, a.line2, a.line3,
    [a.postal_code, a.city].filter(Boolean).join(' '),
    a.country,
  ].filter(Boolean) as string[];
  return lines.length === 0 ? '—' : lines.join('\n');
};

export default function AddressBlock({
  editing, value, onChange, title, cities = [], primaryAddress, primaryLabel,
}: Props) {
  const linked = !!value.is_linked_to_registered && !!primaryAddress;
  // Unique per instance — ContactsTab renders two or three of these at once.
  const cityListId = useId();

  // While linked, display the primary address's values regardless of what's
  // stored — the parent flushes the snapshot to this row on save so the DB
  // mirrors the link state.
  const display = linked && primaryAddress ? primaryAddress : value;

  // The city list is a Cyprus-only lookup, so it's offered as suggestions only
  // while the address is in Cyprus (or the country hasn't been filled in yet).
  // A foreign address gets a plain free-text box rather than irrelevant hints.
  const isCyprus = (() => {
    const c = (display.country || '').trim().toLowerCase();
    if (!c) return true;
    return ['cy', 'cyp', 'cyprus', 'κυπρος', 'κύπρος'].includes(c);
  })();
  const citySuggestions = isCyprus ? cities : [];

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
          <div className="form-group full-width">
            <label>Address line 3</label>
            <input
              type="text" className="form-input"
              value={display.line3 || ''}
              onChange={e => onChange({ line3: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group">
            <label>Office / Building No.</label>
            <input
              type="text" className="form-input"
              value={display.office || ''}
              onChange={e => onChange({ office: e.target.value })}
              disabled={linked}
            />
          </div>
          <div className="form-group">
            <label>City / Town / Village</label>
            {/* Free text with suggestions, not a closed list: Cyprus villages
                missing from the lookup — and any foreign city — must be
                typeable. The stored column has always been plain text. */}
            <input
              type="text" className="form-input"
              list={citySuggestions.length ? cityListId : undefined}
              value={display.city || ''}
              onChange={e => onChange({ city: e.target.value })}
              disabled={linked}
              placeholder={citySuggestions.length ? 'Type or pick from the list' : 'Type the city or town'}
              autoComplete="off"
            />
            {citySuggestions.length > 0 && (
              <datalist id={cityListId}>
                {citySuggestions.map(c => <option key={c} value={c} />)}
              </datalist>
            )}
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
