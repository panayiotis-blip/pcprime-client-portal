import { useEffect, useState } from 'react';
import { api, type SavedAddress } from '../../services/api';

// Management panel for the reusable address book (migration 143). Entries are
// created from a client's Contacts tab ("Save to book"); here they can be
// renamed or removed. Self-contained — loads and saves independently.

const fmt = (a: SavedAddress) =>
  [a.office, a.line1, a.line2, a.line3, [a.postal_code, a.city].filter(Boolean).join(' '), a.country]
    .filter(Boolean).join(', ');

export default function SavedAddresses() {
  const [rows, setRows] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getSavedAddresses().then(setRows).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const rename = async (r: SavedAddress) => {
    const label = window.prompt('Rename saved address:', r.label);
    if (label == null) return;
    const t = label.trim();
    if (!t) return;
    try { await api.updateSavedAddressLabel(r.id, t); await load(); }
    catch (e: any) { alert('Rename failed: ' + e.message); }
  };

  const remove = async (r: SavedAddress) => {
    if (!confirm(`Delete saved address “${r.label}”?\n\nClients already using it keep their own copy — only the reusable entry is removed.`)) return;
    try { await api.deleteSavedAddress(r.id); await load(); }
    catch (e: any) { alert('Delete failed: ' + e.message); }
  };

  return (
    <div className="form-section">
      <h3>Saved addresses</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        A reusable address book. Save an address from any client's Contacts tab (“Save to book”),
        then pick it when adding an address to another client. Reused addresses are copied, so
        editing one client's address never changes another.
      </p>
      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>
          No saved addresses yet. Use “Save to book” on a client's address to add one.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: '#f8fafc',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#1a365d' }}>{r.label}</div>
                <div style={{ fontSize: 13, color: '#64748b' }}>{fmt(r) || '—'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => rename(r)}>Rename</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(r)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
