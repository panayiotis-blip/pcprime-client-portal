import { useEffect, useState } from 'react';
import { Field, useFieldCtx } from '../fieldContext';
import { EmailLinks, isValidEmailList } from '../../shared/MultiEmail';
import { api, type ClientAddress } from '../../../services/api';
import AddressBlock from '../AddressBlock';

// Tab 2: Contacts — contact person + structured addresses (UI polish part 5).
// Single legacy `clients.address` field replaced by per-type rows in
// `client_addresses`. Companies see Registered / Trading / Postal; individuals
// see Home / Postal.

type AddressType = 'registered' | 'trading' | 'postal' | 'home';

type Draft = Partial<ClientAddress> & { _dirty?: boolean };

const isCompanyLike = (cat: string) =>
  cat === 'company' || cat === 'partnership' || cat === 'sole_trader';

export default function ContactsTab() {
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

  useEffect(() => {
    api.getCities()
      .then(rows => setCities((rows as any[]).map(r => r.name)))
      .catch(() => {});
  }, []);

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
              line1: primary.line1, line2: primary.line2,
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
              />
            );
          })}
          {editing && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveAddresses}
                disabled={!anyDirty || saving}
              >
                {saving ? 'Saving addresses…' : 'Save addresses'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
