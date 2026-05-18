import { useEffect, useState } from 'react';
import { Plus, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Modal, Button, FormField, Input } from '../ui';

// Company Settings → Client Categories admin.
// Manages the client_categories master list that drives the category
// dropdown on the client form and the Clients list filter. Owner-only;
// RLS enforces it server-side too. Built-in categories can be renamed or
// hidden but not deleted (a DB trigger blocks deletion).

type ClientCategory = {
  id: number;
  value: string;
  label: string;
  is_active: boolean;
  is_system: boolean;
  display_order: number;
};

// Derive a stable storage key from a label, e.g. "Charity / NGO" → "charity_ngo".
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export default function ClientCategories() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [cats, setCats] = useState<ClientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  // null = closed · 'new' = adding · number = editing that id
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [label, setLabel] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setCats(await api.getAllClientCategories() as ClientCategory[]);
    } catch {
      setCats([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setLabel(''); setActive(true); setEditingId('new'); };
  const openEdit = (c: ClientCategory) => {
    setLabel(c.label);
    setActive(c.is_active);
    setEditingId(c.id);
  };

  const handleSave = async () => {
    if (!label.trim()) { alert('Name is required.'); return; }
    setBusy(true);
    try {
      if (editingId === 'new') {
        const value = slugify(label);
        if (!value) { alert('Enter a name containing letters or numbers.'); setBusy(false); return; }
        if (cats.some((c) => c.value === value)) {
          alert('A category with a similar name already exists.'); setBusy(false); return;
        }
        const nextOrder = cats.length ? Math.max(...cats.map((c) => c.display_order)) + 1 : 1;
        await api.createClientCategory({
          value, label: label.trim(), is_active: active, is_system: false, display_order: nextOrder,
        });
      } else if (typeof editingId === 'number') {
        await api.updateClientCategory(editingId, { label: label.trim(), is_active: active });
      }
      setEditingId(null);
      await load();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (c: ClientCategory) => {
    if (c.is_system) return;
    if (!confirm(`Delete the "${c.label}" category? Existing clients keep the value, but it won't be selectable.`)) return;
    try {
      await api.deleteClientCategory(c.id);
      await load();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= cats.length) return;
    const reordered = [...cats];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setCats(reordered); // optimistic
    try {
      await api.reorderClientCategories(reordered.map((c) => c.id));
    } catch (err: any) {
      alert('Reorder failed: ' + err.message);
      await load();
    }
  };

  return (
    <div className="form-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Client Categories</h3>
        {isOwner && (
          <Button size="sm" leftIcon={<Plus size={15} />} onClick={openNew}>Add Category</Button>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--pc-text-2)', margin: '6px 0 12px' }}>
        The categories used when classifying a client. Built-in categories can be renamed
        or hidden but not deleted — the app relies on them.
        {!isOwner && ' Only owners can edit this list.'}
      </p>

      {loading ? (
        <p style={{ color: 'var(--pc-text-3)' }}>Loading…</p>
      ) : cats.length === 0 ? (
        <p style={{ color: 'var(--pc-text-3)' }}>No categories yet.</p>
      ) : (
        <table className="export-table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ textAlign: 'center' }}>Active</th>
              <th style={{ textAlign: 'center' }}>Built-in</th>
              {isOwner && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.55 }}>
                <td><strong>{c.label}</strong></td>
                <td style={{ textAlign: 'center' }}>{c.is_active ? '✓' : '—'}</td>
                <td style={{ textAlign: 'center' }}>{c.is_system ? '✓' : '—'}</td>
                {isOwner && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Move up"
                      disabled={i === 0} onClick={() => move(i, -1)}>
                      <ChevronUp size={15} />
                    </Button>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Move down"
                      disabled={i === cats.length - 1} onClick={() => move(i, 1)}>
                      <ChevronDown size={15} />
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Delete"
                      disabled={c.is_system}
                      title={c.is_system ? 'Built-in category — cannot be deleted' : 'Delete'}
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
        title={editingId === 'new' ? 'Add Client Category' : 'Edit Client Category'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormField label="Name" required>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Charity / NGO"
              autoFocus
            />
          </FormField>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active — appears when classifying a client
          </label>
        </div>
      </Modal>
    </div>
  );
}
