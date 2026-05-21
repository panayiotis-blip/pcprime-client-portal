import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

type Preset = {
  id?: number;
  description: string;
  default_price: number | null;
  vatable: boolean;
  active: boolean;
  sort_order: number;
  _dirty?: boolean;
};

// Manage the catalogue of reusable invoice-line descriptions ("services
// provided"). Picked from when adding lines on an invoice.
export default function ServicePresets() {
  const [rows, setRows]       = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getServicePresets();
      setRows(data.map((r: any) => ({
        id: r.id,
        description: r.description,
        default_price: r.default_price,
        vatable: r.vatable,
        active: r.active,
        sort_order: r.sort_order,
      })));
    } catch (err: any) {
      alert('Failed to load: ' + err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (idx: number, patch: Partial<Preset>) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch, _dirty: true } : r));

  const addRow = () =>
    setRows(prev => [...prev, {
      description: '', default_price: null, vatable: true,
      active: true, sort_order: prev.length, _dirty: true,
    }]);

  const remove = async (idx: number) => {
    const row = rows[idx];
    if (row.id) {
      if (!confirm('Delete this preset?')) return;
      try { await api.deleteServicePreset(row.id); }
      catch (err: any) { alert('Delete failed: ' + err.message); return; }
    }
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const saveAll = async () => {
    const dirty = rows.filter(r => r._dirty && r.description.trim());
    if (dirty.length === 0) { alert('Nothing to save — add or edit a preset first.'); return; }
    setSaving(true);
    try {
      for (const r of dirty) {
        await api.saveServicePreset({
          id: r.id,
          description: r.description.trim(),
          default_price: r.default_price,
          vatable: r.vatable,
          active: r.active,
          sort_order: r.sort_order,
        });
      }
      await load();
      alert('Saved.');
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Service Presets</h2>
        <div className="dashboard-actions" style={{ display: 'flex', gap: 8 }}>
          <Link to="/billing" className="btn btn-secondary">← Invoices</Link>
          <button className="btn btn-secondary" onClick={addRow}>+ Add preset</button>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <p style={{ color: '#64748b', fontSize: 13 }}>
        Reusable descriptions for invoice lines. When adding a line to an invoice you can
        pick one of these — the description (and default price, if set) fills in automatically.
      </p>

      {loading ? (
        <div className="loading-screen">Loading…</div>
      ) : (
        <div className="export-table-wrapper">
          <table className="export-table">
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ width: 140, textAlign: 'right' }}>Default price (€)</th>
                <th style={{ width: 60, textAlign: 'center' }}>VAT</th>
                <th style={{ width: 60, textAlign: 'center' }}>Active</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} style={{ color: '#64748b' }}>No presets yet — add one.</td></tr>
              )}
              {rows.map((r, idx) => (
                <tr key={r.id ?? `new-${idx}`}>
                  <td>
                    <input
                      type="text" className="form-input" style={{ width: '100%' }} value={r.description}
                      onChange={e => update(idx, { description: e.target.value })}
                      placeholder="e.g. Annual accounts preparation"
                    />
                  </td>
                  <td>
                    <input
                      type="number" step="0.01" min="0" className="form-input"
                      style={{ textAlign: 'right' }}
                      value={r.default_price ?? ''}
                      onChange={e => update(idx, {
                        default_price: e.target.value === '' ? null : Number(e.target.value),
                      })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox" checked={r.vatable}
                      onChange={e => update(idx, { vatable: e.target.checked })}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox" checked={r.active}
                      onChange={e => update(idx, { active: e.target.checked })}
                    />
                  </td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(idx)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
