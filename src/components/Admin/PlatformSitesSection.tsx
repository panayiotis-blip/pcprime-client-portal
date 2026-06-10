import { useEffect, useState } from 'react';
import { api } from '../../services/api';

// Manages the firm-level catalogue of platforms (TFA / Ergani / JCC /
// banks etc.) referenced by per-client credentials. Sits inside the
// Company Settings page.

type Site = {
  id: number;
  name: string;
  url: string | null;
  notes: string | null;
  ordinal: number;
  enabled: boolean;
};

type DraftRow = {
  // Existing rows have id; brand-new rows have id=null until saved.
  id: number | null;
  name: string;
  url: string;
  notes: string;
  ordinal: number;
  enabled: boolean;
  dirty: boolean;
};

export default function PlatformSitesSection({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null | 'new'>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getPlatformSites();
      setRows((data as Site[]).map(s => ({
        id: s.id, name: s.name, url: s.url || '', notes: s.notes || '',
        ordinal: s.ordinal, enabled: s.enabled, dirty: false,
      })));
    } catch (err: any) {
      alert('Failed to load platform sites: ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const update = (idx: number, patch: Partial<DraftRow>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch, dirty: true } : r));
  };

  const handleSave = async (idx: number) => {
    const row = rows[idx];
    if (!row.name.trim()) { alert('Name is required.'); return; }
    setSavingId(row.id ?? 'new');
    try {
      if (row.id == null) {
        const created = await api.createPlatformSite({
          name: row.name.trim(),
          url: row.url.trim() || null,
          notes: row.notes.trim() || null,
          ordinal: row.ordinal || 0,
          enabled: row.enabled,
        });
        // Replace the placeholder row with the saved one.
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, id: (created as any).id, dirty: false } : r));
      } else {
        await api.updatePlatformSite(row.id, {
          name: row.name.trim(),
          url: row.url.trim() || null,
          notes: row.notes.trim() || null,
          ordinal: row.ordinal || 0,
          enabled: row.enabled,
        });
        setRows(prev => prev.map((r, i) => i === idx ? { ...r, dirty: false } : r));
      }
    } catch (err: any) {
      alert('Save failed: ' + (err?.message || String(err)));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (idx: number) => {
    const row = rows[idx];
    if (row.id == null) {
      // Unsaved — just drop the local row.
      setRows(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    if (!confirm(`Delete platform "${row.name}"?\n\nClient credentials referencing it will keep their data but lose the link to this site.`)) return;
    try {
      await api.deletePlatformSite(row.id);
      setRows(prev => prev.filter((_, i) => i !== idx));
    } catch (err: any) {
      alert('Delete failed: ' + (err?.message || String(err)));
    }
  };

  const handleAddBlank = () => {
    setRows(prev => [
      ...prev,
      { id: null, name: '', url: '', notes: '', ordinal: (prev[prev.length - 1]?.ordinal ?? 0) + 10, enabled: true, dirty: true },
    ]);
  };

  if (loading) return <p style={{ color: '#64748b', fontSize: 13 }}>Loading platform sites…</p>;

  return (
    <div>
      <p style={{ fontSize: 13, color: '#5a6478', margin: '0 0 8px' }}>
        Platforms (TaxisNet, Ergani, JCC, GESY, banks…) used by your clients. URLs entered here
        flow through to every client's Platform Credentials — no need to retype them per client.
      </p>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 4, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr style={{ color: '#64748b', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', fontWeight: 500, width: 70 }}>Order</th>
              <th style={{ padding: '6px 8px', fontWeight: 500, minWidth: 200 }}>Name</th>
              <th style={{ padding: '6px 8px', fontWeight: 500, minWidth: 280 }}>URL</th>
              <th style={{ padding: '6px 8px', fontWeight: 500, minWidth: 180 }}>Notes</th>
              <th style={{ padding: '6px 8px', fontWeight: 500, width: 70, textAlign: 'center' }}>Active</th>
              <th style={{ padding: '6px 8px', fontWeight: 500, width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id ?? `new-${idx}`} style={{ borderTop: '1px solid #f1f5f9', background: row.dirty ? '#fffbe6' : undefined }}>
                <td style={{ padding: '4px 8px' }}>
                  <input type="number" min={0} value={row.ordinal} onChange={(e) => update(idx, { ordinal: parseInt(e.target.value) || 0 })}
                    disabled={!canEdit} className="form-input" style={{ width: 56, padding: '2px 6px', fontSize: 13 }} />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input type="text" value={row.name} onChange={(e) => update(idx, { name: e.target.value })}
                    disabled={!canEdit} className="form-input" style={{ width: '100%', padding: '2px 6px', fontSize: 13 }}
                    placeholder="e.g. Bank of Cyprus business" />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input type="url" value={row.url} onChange={(e) => update(idx, { url: e.target.value })}
                    disabled={!canEdit} className="form-input" style={{ width: '100%', padding: '2px 6px', fontSize: 13 }}
                    placeholder="https://…" />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <input type="text" value={row.notes} onChange={(e) => update(idx, { notes: e.target.value })}
                    disabled={!canEdit} className="form-input" style={{ width: '100%', padding: '2px 6px', fontSize: 13 }} />
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                  <input type="checkbox" checked={row.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })}
                    disabled={!canEdit} />
                </td>
                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                  {canEdit && row.dirty && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleSave(idx)} disabled={savingId === (row.id ?? 'new')}>
                      {savingId === (row.id ?? 'new') ? 'Saving…' : 'Save'}
                    </button>
                  )}
                  {canEdit && (
                    <button className="btn btn-link btn-sm" onClick={() => handleDelete(idx)} style={{ color: '#b91c1c' }}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#94a3b8' }}>No platforms configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={handleAddBlank}>+ Add platform</button>
        </div>
      )}
    </div>
  );
}
