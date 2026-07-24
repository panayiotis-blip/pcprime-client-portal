import { useEffect, useState } from 'react';
import { Field, useFieldCtx } from '../fieldContext';
import { EmailLinks, isValidEmailList } from '../../shared/MultiEmail';
import { api, type ClientAddress, type SavedAddress } from '../../../services/api';
import AddressBlock from '../AddressBlock';
import { PanelSkeleton } from '../../ui';

// Tab 2: Contacts — contact person + structured addresses (UI polish part 5).
// Single legacy `clients.address` field replaced by per-type rows in
// `client_addresses`. Companies see Registered / Trading / Postal; individuals
// see Home / Postal.

type AddressType = 'registered' | 'trading' | 'postal' | 'home';

type Draft = Partial<ClientAddress> & { _dirty?: boolean };

const isCompanyLike = (cat: string) =>
  cat === 'company' || cat === 'partnership' || cat === 'sole_trader';

type ContactsTabProps = {
  /** Hand the address saver to ClientDetail so the header Save commits it too. */
  registerSave?: (fn: (() => Promise<void>) | null) => void;
  /** Report unsaved address edits so the header Save can enable itself. */
  onDirtyChange?: (dirty: boolean) => void;
};

export default function ContactsTab({ registerSave, onDirtyChange }: ContactsTabProps = {}) {
  const { editing, form, client, onChange } = useFieldCtx();
  const emailValue = (editing ? form.email : client.email) || '';
  const emailLooksOk = isValidEmailList(emailValue);

  const cat = (client?.client_category || '') as string;
  const companyLike = isCompanyLike(cat);

  // Address types shown for this client
  const types: AddressType[] = companyLike
    ? ['registered', 'trading', 'postal']
    : ['home', 'postal'];
  const primaryType: AddressType = companyLike ? 'registered' : 'home';

  const [drafts, setDrafts] = useState<Record<AddressType, Draft>>({} as any);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [cities, setCities]   = useState<string[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  const loadSaved = () => api.getSavedAddresses().then(setSavedAddresses).catch(() => {});

  useEffect(() => {
    api.getCities()
      .then(rows => setCities((rows as any[]).map(r => r.name)))
      .catch(() => {});
    loadSaved();
  }, []);

  // Save the current values of an address block to the reusable book.
  const handleSaveToBook = async (values: Partial<ClientAddress>) => {
    const suggested = values.line1 || values.city || 'Saved address';
    const label = window.prompt('Save this address to the address book as:', suggested);
    if (label == null) return;
    const trimmed = label.trim();
    if (!trimmed) { alert('Please enter a label for the saved address.'); return; }
    try {
      await api.createSavedAddress({
        label: trimmed,
        line1: values.line1, line2: values.line2, line3: values.line3, office: values.office,
        city: values.city, postal_code: values.postal_code, country: values.country, notes: values.notes,
      });
      await loadSaved();
      alert('Address saved to the address book — you can now reuse it on other clients.');
    } catch (err: any) {
      alert('Could not save the address: ' + err.message);
    }
  };

  const load = async () => {
    if (!client?.id) return;
    setLoading(true);
    try {
      const rows = await api.getClientAddresses(client.id);
      const map: Record<AddressType, Draft> = {} as any;
      for (const t of types) {
        const row = rows.find(r => r.address_type === t);
        map[t] = row || { client_id: client.id, address_type: t, country: 'Cyprus' };
      }
      setDrafts(map);
    } catch (err: any) {
      // Non-fatal; render empty blocks
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [client?.id]);

  const patchAddress = (type: AddressType, patch: Partial<ClientAddress>) => {
    setDrafts(prev => ({
      ...prev,
      [type]: { ...(prev[type] || { client_id: client.id, address_type: type }), ...patch, _dirty: true },
    }));
  };

  const handleSaveAddresses = async () => {
    if (!client?.id) return;
    setSaving(true);
    try {
      const primary = drafts[primaryType] || {};
      for (const t of types) {
        const d = drafts[t];
        if (!d?._dirty) continue;
        // If linked, snapshot the primary's values into this row at save time
        const payload: any = d.is_linked_to_registered && t !== primaryType
          ? {
              ...d,
              line1: primary.line1, line2: primary.line2, line3: primary.line3,
              office: primary.office,
              city: primary.city, postal_code: primary.postal_code,
              country: primary.country, notes: primary.notes,
            }
          : d;
        await api.upsertClientAddress({
          id: d.id,
          client_id: client.id,
          address_type: t,
          line1: payload.line1,
          line2: payload.line2,
          line3: payload.line3,
          office: payload.office,
          city: payload.city,
          postal_code: payload.postal_code,
          country: payload.country,
          notes: payload.notes,
          is_linked_to_registered: !!d.is_linked_to_registered && t !== primaryType,
        });
      }
      await load();
    } catch (err: any) {
      alert('Failed to save addresses: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const anyDirty = Object.values(drafts).some(d => d?._dirty);

  // Addresses used to have their own Save button, separate from the header's.
  // Editing an address and pressing the header Save silently did nothing — the
  // changes looked saved but weren't. The tab now hands its saver up so ONE
  // Save commits everything. Registered on every render so the closure always
  // sees the current drafts; cleared on unmount so a stale saver can't fire.
  useEffect(() => {
    registerSave?.(handleSaveAddresses);
    return () => registerSave?.(null);
  });

  useEffect(() => { onDirtyChange?.(anyDirty); }, [anyDirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  // `loading` was already tracked here but never rendered, so the tab flashed
  // an empty form until the addresses arrived.
  if (loading) return <div className="client-tab-content"><PanelSkeleton /></div>;

  return (
    <div className="client-tab-content">
      {/* Contact details — still on clients table, edited via FieldCtx */}
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
          <Field label="Phone"   field="phone" />
          <Field label="Mobile"  field="mobile" />
          <Field label="Fax"     field="fax" />
          <Field label="Website" field="website" placeholder="https://..." />
        </div>
      </div>

      {/* Structured addresses — stored in client_addresses table.
          Saved independently via the button below since the FieldCtx pattern
          only covers `clients` columns. */}
      {loading ? (
        <div className="form-section"><p style={{ color: '#94a3b8' }}>Loading addresses…</p></div>
      ) : (
        <>
          {types.map(t => {
            const titles: Record<AddressType, string> = {
              registered: 'Registered Office',
              trading:    'Trading / Physical Address',
              postal:     'Postal Address',
              home:       'Home / Primary Address',
            };
            const isPrimary = t === primaryType;
            return (
              <AddressBlock
                key={t}
                editing={editing}
                title={titles[t]}
                value={drafts[t] || {}}
                onChange={p => patchAddress(t, p)}
                cities={cities}
                primaryAddress={isPrimary ? null : drafts[primaryType]}
                primaryLabel={`Same as ${titles[primaryType]}`}
                savedAddresses={savedAddresses}
                onSaveToBook={handleSaveToBook}
              />
            );
          })}
          {/* No Save button here on purpose — the header Save commits addresses
              along with the rest of the record. A second one caused edits to be
              lost when the header Save was pressed instead. */}
          {editing && anyDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, fontSize: 12, color: '#5a6478' }}>
              {saving ? 'Saving addresses…' : 'Unsaved address changes — use Save in the toolbar above.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
