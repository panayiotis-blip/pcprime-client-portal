import { useEffect, useMemo, useState } from 'react';
import { api, type SavedAddress } from '../../services/api';
import { PanelSkeleton } from '../ui';

// Address Book — a firm-wide list of reusable saved addresses (migration 143/144),
// shown like the client list with an ADR-#### code per row. Entries can be
// created here or via a client's Contacts tab ("Save to book"); picking one on a
// client copies its text in (copy-on-use), so records stay independent.

type Draft = Partial<SavedAddress>;

const BLANK: Draft = { label: '', country: 'Cyprus' };

const fmtAddress = (a: SavedAddress) =>
  [a.office, a.line1, a.line2, a.line3, [a.postal_code, a.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

export default function AddressBook() {
  const [rows, setRows] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);   // open form (new or edit)
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.getSavedAddresses().then(setRows).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.code, r.label, r.line1, r.line2, r.line3, r.office, r.city, r.postal_code, r.country]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  const setField = (k: keyof SavedAddress, v: string) => setDraft(d => ({ ...(d || {}), [k]: v }));

  const save = async () => {
    if (!draft) return;
    if (!(draft.label || '').trim()) { alert('Please enter a label (a name for this address).'); return; }
    setSaving(true);
    try {
      if (draft.id) {
        await api.updateSavedAddress(draft.id, draft);
      } else {
        await api.createSavedAddress({ ...draft, label: (draft.label || '').trim() } as any);
      }
      setDraft(null);
      load();
    } catch (e: any) {
      alert('Could not save the address: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: SavedAddress) => {
    if (!confirm(`Delete saved address “${r.label}” (${r.code})?\n\nClients already using it keep their own copy — only the reusable entry is removed.`)) return;
    try { await api.deleteSavedAddress(r.id); load(); }
    catch (e: any) { alert('Delete failed: ' + e.message); }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Address Book</h2>
        <button className="btn btn-primary" onClick={() => setDraft({ ...BLANK })}>+ New address</button>
      </div>

      <p style={{ color: '#64748b', fontSize: 13, marginTop: -4 }}>
        Reusable addresses shared across clients. On a client's Contacts tab, pick one with
        “Use saved address…” to copy it in — each client keeps its own independent copy.
      </p>

      <div style={{ margin: '12px 0' }}>
        <input
          className="form-input"
          style={{ maxWidth: 360 }}
          placeholder="Search code, label, street, city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <PanelSkeleton />
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{rows.length === 0 ? 'No saved addresses yet.' : 'No addresses match your search.'}</p>
          {rows.length === 0 && (
            <button className="btn btn-primary" onClick={() => setDraft({ ...BLANK })}>+ Add the first address</button>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ whiteSpace: 'nowrap' }}>Code</th>
                <th>Label</th>
                <th>Address</th>
                <th>City</th>
                <th>Country</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.code || '—'}</td>
                  <td style={{ fontWeight: 600, color: '#1a365d' }}>{r.label}</td>
                  <td style={{ color: '#475569' }}>{fmtAddress(r) || '—'}</td>
                  <td>{r.city || '—'}</td>
                  <td>{r.country || '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDraft({ ...r })}>Edit</button>{' '}
                    <button className="btn btn-secondary btn-sm" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div
          onClick={() => !saving && setDraft(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, padding: 24, width: 'min(640px, 100%)', marginTop: 40, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}
          >
            <h3 style={{ marginTop: 0 }}>{draft.id ? `Edit ${draft.code || 'address'}` : 'New saved address'}</h3>
            <div className="form-grid">
              <div className="form-group full-width">
                <label>Label *</label>
                <input className="form-input" value={draft.label || ''} onChange={e => setField('label', e.target.value)} placeholder="e.g. Nicosia Tower, 3rd floor" autoFocus />
              </div>
              <div className="form-group full-width">
                <label>Address line 1</label>
                <input className="form-input" value={draft.line1 || ''} onChange={e => setField('line1', e.target.value)} />
              </div>
              <div className="form-group full-width">
                <label>Address line 2</label>
                <input className="form-input" value={draft.line2 || ''} onChange={e => setField('line2', e.target.value)} />
              </div>
              <div className="form-group full-width">
                <label>Address line 3</label>
                <input className="form-input" value={draft.line3 || ''} onChange={e => setField('line3', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Office / Building No.</label>
                <input className="form-input" value={draft.office || ''} onChange={e => setField('office', e.target.value)} />
              </div>
              <div className="form-group">
                <label>City / Town / Village</label>
                <input className="form-input" value={draft.city || ''} onChange={e => setField('city', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Postal code</label>
                <input className="form-input" value={draft.postal_code || ''} onChange={e => setField('postal_code', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Country</label>
                <input className="form-input" value={draft.country || ''} onChange={e => setField('country', e.target.value)} />
              </div>
              <div className="form-group full-width">
                <label>Notes</label>
                <textarea className="form-input" rows={2} value={draft.notes || ''} onChange={e => setField('notes', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
