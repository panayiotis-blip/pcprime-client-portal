import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button, FormField, Input } from '../ui';
import CollapsibleSection from './CollapsibleSection';

// Company Settings → Cities admin.
// Manages the cities master list that drives the city dropdown on client
// addresses. Owner-only; RLS enforces it server-side too.

type City = {
  id: number;
  name: string;
  is_active: boolean;
};

export default function Cities() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  // null = closed · 'new' = adding · number = editing that id
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setCities(await api.getAllCities() as City[]);
    } catch {
      setCities([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setName(''); setActive(true); setEditingId('new'); };
  const openEdit = (c: City) => { setName(c.name); setActive(c.is_active); setEditingId(c.id); };

  const handleSave = async () => {
    if (!name.trim()) { alert('City name is required.'); return; }
    setBusy(true);
    try {
      if (editingId === 'new') {
        if (cities.some((c) => c.name.toLowerCase() === name.trim().toLowerCase())) {
          alert('That city already exists.'); setBusy(false); return;
        }
        await api.createCity({ name: name.trim(), is_active: active });
      } else if (typeof editingId === 'number') {
        await api.updateCity(editingId, { name: name.trim(), is_active: active });
      }
      setEditingId(null);
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (c: City) => {
    if (!confirm(`Delete "${c.name}"? Clients already set to this city keep the value.`)) return;
    try {
      await api.deleteCity(c.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <CollapsibleSection
      title="Cities"
      headerRight={isOwner && (
        <Button size="sm" leftIcon={<Plus size={15} />} onClick={openNew}>Add City</Button>
      )}
    >
      <p style={{ fontSize: 13, color: 'var(--pc-text-2)', margin: '6px 0 12px' }}>
        The cities offered in the dropdown when entering a client address.
        {!isOwner && ' Only owners can edit this list.'}
      </p>

      {loading ? (
        <p style={{ color: 'var(--pc-text-3)' }}>Loading…</p>
      ) : cities.length === 0 ? (
        <p style={{ color: 'var(--pc-text-3)' }}>No cities yet.</p>
      ) : (
        <table className="export-table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ textAlign: 'center' }}>Active</th>
              {isOwner && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {cities.map((c) => (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.55 }}>
                <td><strong>{c.name}</strong></td>
                <td style={{ textAlign: 'center' }}>{c.is_active ? '✓' : '—'}</td>
                {isOwner && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Delete"
                      onClick={() => handleDelete(c)}>
                      <Trash2 size={15} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        title={editingId === 'new' ? 'Add City' : 'Edit City'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="City name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Limassol"
              autoFocus
            />
          </FormField>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active — appears in the city dropdown
          </label>
        </div>
      </Modal>
    </CollapsibleSection>
  );
}
