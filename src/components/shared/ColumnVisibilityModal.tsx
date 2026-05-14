import { useState } from 'react';

export interface ColumnDef {
  id: string;
  label: string;
  required?: boolean;       // can't be hidden
  defaultVisible: boolean;
}

interface Props {
  title?: string;
  columns: ColumnDef[];
  visibleIds: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
  onReset?: () => void;
}

// Generic modal for picking which columns to show on a list/table page.
// Stateless w.r.t. persistence — the caller handles save.
export default function ColumnVisibilityModal({
  title = 'Choose columns',
  columns, visibleIds, onChange, onClose, onReset,
}: Props) {
  const [local, setLocal] = useState<Set<string>>(new Set(visibleIds));

  const toggle = (id: string) => {
    const col = columns.find(c => c.id === id);
    if (col?.required) return;
    setLocal(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const apply = () => {
    // Preserve the registry order
    const ordered = columns.filter(c => local.has(c.id)).map(c => c.id);
    onChange(ordered);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
    }}>
      <div style={{ background: 'white', borderRadius: 8, padding: 20, width: '100%', maxWidth: 400, maxHeight: '80vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p style={{ fontSize: 13, color: '#475569' }}>
          Pick which columns appear. Some columns are always shown.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {columns.map(c => (
            <li key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: c.required ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={c.required || local.has(c.id)}
                  disabled={c.required}
                  onChange={() => toggle(c.id)}
                />
                <span style={{ flex: 1 }}>{c.label}</span>
                {c.required && <span style={{ fontSize: 11, color: '#94a3b8' }}>always shown</span>}
              </label>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          {onReset ? (
            <button className="btn btn-link btn-sm" onClick={() => { onReset(); onClose(); }}>↺ Reset to default</button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={apply}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}
